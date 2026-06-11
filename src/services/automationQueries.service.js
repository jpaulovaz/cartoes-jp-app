const { createAutomationQueriesRepository } = require('../repositories/automationQueries.repository');
const { AutomationApiError, normalizeAutomationPhone } = require('./automationApi.service');
const { formatBRLFromCents } = require('../utils');
const { computeDueDate } = require('../dueDate');

const MONTH_NAMES = [
  '', 'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'
];

const MONTH_ALIASES = {
  janeiro: 1, jan: 1,
  fevereiro: 2, fev: 2,
  marco: 3, março: 3, mar: 3,
  abril: 4, abr: 4,
  maio: 5, mai: 5,
  junho: 6, jun: 6,
  julho: 7, jul: 7,
  agosto: 8, ago: 8,
  setembro: 9, set: 9,
  outubro: 10, out: 10,
  novembro: 11, nov: 11,
  dezembro: 12, dez: 12
};

function currentSaoPauloDate() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
}

function parseIsoDate(value) {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return raw;
}

function addMonths(year, month, delta) {
  const d = new Date(Date.UTC(Number(year || 0), Number(month || 1) - 1 + Number(delta || 0), 1));
  return { month: d.getUTCMonth() + 1, year: d.getUTCFullYear() };
}

function resolvePeriod(input = {}) {
  const today = currentSaoPauloDate();
  const [todayYear, todayMonth] = today.split('-').map(Number);
  const rawPeriod = String(input.period || input.when || '').trim().toLowerCase();
  if (rawPeriod === 'last_month' || rawPeriod === 'previous_month' || rawPeriod === 'mes_passado' || rawPeriod === 'mês passado') {
    return addMonths(todayYear, todayMonth, -1);
  }
  if (rawPeriod === 'next_month' || rawPeriod === 'proximo_mes' || rawPeriod === 'próximo mês' || rawPeriod === 'mes_que_vem' || rawPeriod === 'mês que vem') {
    return addMonths(todayYear, todayMonth, 1);
  }
  const month = Number(input.month || input.due_month || input.mes || 0);
  const year = Number(input.year || input.due_year || input.ano || 0);
  if (month >= 1 && month <= 12 && year >= 2000 && year <= 2100) return { month, year };

  const text = normalizeText([
    input.raw_text,
    input.text,
    input.message_text,
    input.source?.raw_text,
    input.whatsapp?.message_text,
    input.query_text
  ].filter(Boolean).join(' '));
  if (text.includes('mes que vem')) return addMonths(todayYear, todayMonth, 1);
  if (text.includes('mes passado')) return addMonths(todayYear, todayMonth, -1);
  for (const [alias, aliasMonth] of Object.entries(MONTH_ALIASES)) {
    const re = new RegExp(`\\b${alias}\\b`, 'i');
    if (!re.test(text)) continue;
    const yearMatch = text.match(/\b(20\d{2}|21\d{2})\b/);
    let resolvedYear = yearMatch ? Number(yearMatch[1]) : todayYear;
    if (!yearMatch && aliasMonth < todayMonth && /proximo|prox|futuro|seguinte/.test(text)) resolvedYear += 1;
    return { month: aliasMonth, year: resolvedYear };
  }
  return { month: todayMonth, year: todayYear };
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreName(row, hint, fields = []) {
  const needle = normalizeText(hint);
  if (!needle) return 0;
  return fields.reduce((best, field) => {
    const hay = normalizeText(row[field] || '');
    if (!hay) return best;
    let score = 0;
    if (hay === needle) score = 100;
    else if (hay.startsWith(needle)) score = 92;
    else if (needle.startsWith(hay)) score = 88;
    else if (hay.includes(needle) || needle.includes(hay)) score = 78;
    else {
      const needleTokens = needle.split(' ').filter(Boolean);
      const hayTokens = new Set(hay.split(' ').filter(Boolean));
      const hits = needleTokens.filter((token) => hayTokens.has(token)).length;
      if (hits) score = Math.min(72, 44 + hits * 12);
    }
    return Math.max(best, score);
  }, 0);
}

function resolveByHint(rows = [], hint = '', fields = []) {
  const needle = normalizeText(hint);
  if (!needle) return { status: 'missing', item: null, matches: [] };
  const matches = (rows || [])
    .map((row) => ({ item: row, score: scoreName(row, needle, fields) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || Number(a.item.id || a.item.card_id || a.item.person_id || 0) - Number(b.item.id || b.item.card_id || b.item.person_id || 0));
  if (!matches.length) return { status: 'not_found', item: null, matches: [] };
  const topScore = matches[0].score;
  const tied = matches.filter((entry) => entry.score === topScore || (topScore - entry.score <= 4 && topScore < 100));
  if (tied.length > 1) return { status: 'ambiguous', item: null, matches: tied.map((entry) => entry.item) };
  return { status: 'found', item: matches[0].item, matches: matches.map((entry) => entry.item) };
}

function truncateRows(rows = [], limit = 5) {
  return (Array.isArray(rows) ? rows : []).slice(0, Math.max(0, Number(limit || 5) || 5));
}

function periodLabel(month, year) {
  return `${MONTH_NAMES[Number(month || 0)] || String(month).padStart(2, '0')}/${year}`;
}


function hasExplicitPurchasePeriod(input = {}) {
  const source = input.query && typeof input.query === 'object'
    ? { ...input, ...input.query }
    : input;

  if (source.date || source.day) return true;
  if (source.month || source.due_month || source.mes || source.year || source.due_year || source.ano) return true;

  const rawPeriod = String(source.period || source.when || '').trim().toLowerCase();
  if (['last_month', 'previous_month', 'mes_passado', 'mês passado', 'next_month', 'proximo_mes', 'próximo mês', 'mes_que_vem', 'mês que vem'].includes(rawPeriod)) {
    return true;
  }

  const text = normalizeText([
    source.raw_text,
    source.text,
    source.message_text,
    source.source?.raw_text,
    source.whatsapp?.message_text,
    source.query_text
  ].filter(Boolean).join(' '));
  if (!text) return false;

  const monthNames = Object.keys(MONTH_ALIASES).join('|');
  if (new RegExp(`\\b(${monthNames})\\b`, 'i').test(text)) return true;
  if (/\b(20\d{2}|21\d{2})\b/.test(text)) return true;
  if (/\b(este|esse|deste|desse|atual|passado|proximo|prox|seguinte)\s+mes\b/.test(text)) return true;
  if (/\bmes\s+(atual|passado|que vem|seguinte)\b/.test(text)) return true;
  if (/\b(compras?|gastos?|lancamentos?)\s+(do|de|da|para|em)\s+mes\b/.test(text)) return true;

  return false;
}

function formatDateBR(value) {
  const raw = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '';
  return `${raw.slice(8, 10)}/${raw.slice(5, 7)}/${raw.slice(0, 4)}`;
}

function plural(count, singular, pluralText) {
  return Number(count || 0) === 1 ? singular : pluralText;
}

function formatDisplayTitle(value, options = {}) {
  const raw = String(value || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  const lowerWords = new Set(['a', 'as', 'o', 'os', 'de', 'da', 'das', 'do', 'dos', 'e']);
  const preserveWords = new Set(['pix', 'ted', 'doc', 'iof', 'ipva', 'iptu', 'tim', 'claro', 'vivo', 'nubank', 'ifood', 'uber', '99', 'c6', 'bb']);
  return raw.split(/(\s+)/).map((part, index) => {
    if (/^\s+$/.test(part)) return part;
    return part.split('-').map((piece, pieceIndex) => {
      if (!piece) return piece;
      const normalized = normalizeText(piece);
      if (preserveWords.has(normalized)) {
        const canonical = {
          pix: 'Pix',
          ted: 'TED',
          doc: 'DOC',
          iof: 'IOF',
          ipva: 'IPVA',
          iptu: 'IPTU',
          tim: 'TIM',
          claro: 'Claro',
          vivo: 'Vivo',
          nubank: 'Nubank',
          ifood: 'iFood',
          uber: 'Uber',
          '99': '99',
          c6: 'C6',
          bb: 'BB'
        };
        return canonical[normalized] || piece;
      }
      if ((index > 0 || pieceIndex > 0) && lowerWords.has(normalized)) return normalized;
      return piece.toLocaleLowerCase('pt-BR').replace(/^([\p{L}\p{N}])/u, (match) => match.toLocaleUpperCase('pt-BR'));
    }).join('-');
  }).join('');
}

function formatCardName(value) {
  return formatDisplayTitle(value || 'Cartão');
}

function formatMerchantName(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'Compra';
  return formatDisplayTitle(raw);
}

function sumBy(rows = [], field) {
  return rows.reduce((total, row) => total + Number(row[field] || 0), 0);
}

function buildLines(title, rows, mapper, emptyLine = 'Nada encontrado por aqui.') {
  const list = truncateRows(rows, 8);
  if (!list.length) return [`${title}`, emptyLine];
  return [title, ...list.map(mapper)];
}

function createAutomationQueriesService(deps = {}) {
  const repository = deps.repository || createAutomationQueriesRepository();

  function makeResult(payload = {}, statusCode = 200) {
    return { statusCode, ...payload };
  }

  function handleServiceError(error) {
    if (error instanceof AutomationApiError) {
      return makeResult({
        ok: false,
        code: error.code || 'QUERY_VALIDATION_ERROR',
        message: error.message,
        details: error.details || null,
        whatsapp: { text: error.message }
      }, error.statusCode || 400);
    }
    return makeResult({
      ok: false,
      code: 'QUERY_INTERNAL_ERROR',
      message: 'A consulta tropeçou por aqui. Tenta de novo em instantes.',
      whatsapp: { text: 'A consulta tropeçou por aqui. Tenta de novo em instantes.' }
    }, 500);
  }

  function resolveAuthorizedPhone(phone) {
    const normalized = normalizeAutomationPhone(phone);
    if (!normalized.ok) {
      throw new AutomationApiError(normalized.reason || 'Telefone inválido.', {
        code: 'INVALID_PHONE',
        statusCode: 400
      });
    }

    const authorization = repository.getAuthorizationByPhone(normalized.e164, normalized.whatsappNumber);
    if (!authorization || Number(authorization.enabled || 0) === 0 || String(authorization.user_status || 'active') === 'deleted') {
      throw new AutomationApiError('Esse número ainda não está liberado no AcerttaPay. Ative o WhatsApp nas Configurações do app.', {
        code: 'NOT_AUTHORIZED',
        statusCode: 403
      });
    }

    const user = repository.getUserById(authorization.user_id);
    if (!user) {
      throw new AutomationApiError('Não encontrei esse usuário no AcerttaPay.', {
        code: 'USER_NOT_FOUND',
        statusCode: 404
      });
    }
    repository.touchAuthorization(authorization.id);
    return { user, phone: normalized, authorization };
  }

  function withQueryHandling(payload, meta, operation, fn) {
    let resolved = null;
    try {
      resolved = resolveAuthorizedPhone(payload.phone || payload.user_phone || payload.number);
      const result = fn(resolved);
      repository.logRequest({
        userId: resolved.user.id,
        phoneE164: resolved.phone.e164,
        channel: payload.source?.channel || payload.channel || 'whatsapp',
        operation,
        statusCode: result.statusCode,
        resultCode: result.code,
        sourceMessageId: payload.source?.message_id || payload.message_id || null,
        ipAddress: meta?.ipAddress || null
      });
      return result;
    } catch (error) {
      const result = handleServiceError(error);
      repository.logRequest({
        userId: resolved?.user?.id || null,
        phoneE164: resolved?.phone?.e164 || null,
        channel: payload.source?.channel || payload.channel || 'whatsapp',
        operation,
        statusCode: result.statusCode,
        resultCode: result.code,
        sourceMessageId: payload.source?.message_id || payload.message_id || null,
        ipAddress: meta?.ipAddress || null
      });
      return result;
    }
  }

  function serializeCard(row = {}) {
    const month = Number(row.month || row.due_month || 0);
    const year = Number(row.year || row.due_year || 0);
    const dueDay = Number(row.due_day || 0);
    const fallbackDueDate = month && year && dueDay
      ? computeDueDate({ month, year, dueDay, holidayScope: row.holiday_scope || 'BR' })
      : null;
    return {
      id: Number(row.card_id || row.id || 0),
      name: formatCardName(row.card_name || row.name || 'Cartão'),
      brand: row.brand || null,
      total_cents: Number(row.total_cents || 0),
      paid_cents: Number(row.paid_cents || 0),
      open_cents: Math.max(0, Number(row.total_cents || 0) - Number(row.paid_cents || 0)),
      purchase_count: Number(row.purchase_count || 0),
      due_date: row.effective_due_date || row.override_due_date || row.computed_due_date || fallbackDueDate,
      active: Number(row.active ?? 1) !== 0
    };
  }

  function serializePerson(row = {}) {
    const total = Number(row.total_cents || 0);
    const paid = Number(row.paid_cents || 0);
    return {
      id: Number(row.person_id || row.id || 0),
      name: row.person_name || row.name || 'Pessoa',
      profile_kind: row.profile_kind || 'contact',
      total_cents: total,
      paid_cents: paid,
      open_cents: Math.max(0, total - paid),
      purchase_count: Number(row.purchase_count || 0)
    };
  }

  function buildMonthSummaryText({ month, year, cards, people, topPurchases, debt, monthlyFinances, personalSummary, fullCardSummary }) {
    const cardsTotal = Number(fullCardSummary?.total_cents ?? sumBy(cards, 'total_cents'));
    const cardsPaid = Number(fullCardSummary?.paid_cents ?? sumBy(cards, 'paid_cents'));
    const cardsOpen = Math.max(0, Number(fullCardSummary?.open_cents ?? (cardsTotal - cardsPaid)));
    const finances = Array.isArray(monthlyFinances) ? monthlyFinances : [];
    const incomeFinances = finances.filter((row) => row.type === 'income');
    const expenseFinances = finances.filter((row) => row.type !== 'income');
    const incomeTotal = sumBy(incomeFinances, 'amount_cents');
    const expenseTotal = sumBy(expenseFinances, 'amount_cents');
    const openExpenseTotal = sumBy(expenseFinances, 'open_cents');
    const selfCardTotal = Math.max(0, Number(personalSummary?.self_card_total_cents || 0));
    const selfCardPaid = Math.max(0, Number(personalSummary?.self_card_paid_cents || 0));
    const selfCardOpen = Math.max(0, Number(personalSummary?.self_card_open_cents ?? (selfCardTotal - selfCardPaid)));
    const sharedReceivedTotal = Math.max(0, Number(personalSummary?.shared_received_total_cents || 0));
    const personalCommittedTotal = Math.max(0, Number(personalSummary?.personal_committed_cents ?? (selfCardTotal + expenseTotal + sharedReceivedTotal)));
    const forecastBalance = Number(personalSummary?.forecast_balance_cents ?? (incomeTotal - personalCommittedTotal));
    const cardLines = cards.length
      ? truncateRows(cards, 8).map((card) => `• ${formatCardName(card.name)}: *${formatBRLFromCents(card.total_cents)}*${card.due_date ? ` · vence ${formatDateBR(card.due_date)}` : ''}`)
      : ['• Nenhuma compra de cartão nesse período.'];
    const incomeLines = incomeFinances.length
      ? truncateRows(incomeFinances, 5).map((row) => `• #${row.id} — ${row.description}: *${formatBRLFromCents(row.amount_cents)}*${row.day_of_month ? ` · dia ${String(row.day_of_month).padStart(2, '0')}` : ''}`)
      : ['• Nenhuma entrada registrada no mês.'];
    const expenseLines = expenseFinances.length
      ? truncateRows(expenseFinances, 6).map((row) => `• #${row.id} — ${row.description}: *${formatBRLFromCents(row.amount_cents)}*${row.open_cents ? ` · aberto ${formatBRLFromCents(row.open_cents)}` : ' · pago'}`)
      : ['• Nenhuma despesa fora do cartão registrada.'];
    const personLines = people.length
      ? people.map((person) => `• ${formatDisplayTitle(person.name)}: *${formatBRLFromCents(person.total_cents)}*`)
      : ['• Sem participantes com valores nesse período.'];
    const purchaseLines = topPurchases.length
      ? truncateRows(topPurchases, 5).map((purchase, index) => `${index + 1}. ${formatMerchantName(purchase.description)} — *${formatBRLFromCents(purchase.amount_cents)}* no ${formatCardName(purchase.card_name)}`)
      : ['• Sem compras para destacar.'];
    const outgoing = Number(debt?.outgoing_open_cents || 0);
    const incoming = Number(debt?.incoming_open_cents || 0);
    const drafts = Number(debt?.draft_cents || 0);
    const personalIntro = 'Inclui apenas a sua parte nos cartões.';
    const sharedReceivedLine = sharedReceivedTotal > 0
      ? [`🤝 Compras compartilhadas aceitas: *${formatBRLFromCents(sharedReceivedTotal)}*`]
      : [];

    return [
      `📊 *Resumo de ${periodLabel(month, year)}*`,
      '',
      '*Seu mês*',
      `✨ Entradas do mês: *${formatBRLFromCents(incomeTotal)}*`,
      `📒 Despesas do mês: *${formatBRLFromCents(expenseTotal)}*`,
      `💳 Sua parte nos cartões: *${formatBRLFromCents(selfCardTotal)}*`,
      ...sharedReceivedLine,
      `🧮 Total dos seus gastos: *${formatBRLFromCents(personalCommittedTotal)}*`,
      `💰 Saldo previsto: *${formatBRLFromCents(forecastBalance)}*`,
      `✅ Sua parte paga nos cartões: *${formatBRLFromCents(selfCardPaid)}*`,
      `🧾 Sua parte em aberto nos cartões: *${formatBRLFromCents(selfCardOpen)}*`,
      `⏳ Despesas mensais em aberto: *${formatBRLFromCents(openExpenseTotal)}*`,
      `_ ${personalIntro}_`,
      '',
      '*Por cartão — total das faturas*',
      ...cardLines,
      `💳 Total dos cartões: *${formatBRLFromCents(cardsTotal)}*`,
      `✅ Já pago nos cartões: *${formatBRLFromCents(cardsPaid)}*`,
      `🧾 Ainda em aberto nos cartões: *${formatBRLFromCents(cardsOpen)}*`,
      '',
      '*Entradas do mês*',
      ...incomeLines,
      '',
      '*Despesas fora do cartão*',
      ...expenseLines,
      '',
      '*Por participante — cartões*',
      ...personLines,
      '',
      '*Maiores compras no cartão*',
      ...purchaseLines,
      '',
      `👥 A receber: *${formatBRLFromCents(outgoing)}*${drafts ? ` · rascunhos: *${formatBRLFromCents(drafts)}*` : ''}`,
      `🙋 A pagar: *${formatBRLFromCents(incoming)}*`,
      '',
      'Quer abrir por *cartão*, *pessoa*, *finanças mensais* ou ver as *compras de hoje*?'
    ].join('\n');
  }

  function getMonthSummary(payload = {}, meta = {}) {
    return withQueryHandling(payload, meta, 'queries.month_summary', ({ user }) => {
      const period = resolvePeriod({ ...payload, ...(payload.query || {}) });
      const rawCards = repository.getCardMonthTotals(user.id, period.month, period.year);
      const cards = rawCards.map(serializeCard);
      const people = repository.getPersonMonthTotals(user.id, period.month, period.year).map(serializePerson);
      const topPurchases = repository.getTopPurchasesByMonth(user.id, period.month, period.year, { limit: payload.limit || payload.query?.limit || 5 });
      const outgoing = repository.getSharedDebtOutgoing(user.id, period.month, period.year);
      const incoming = repository.getSharedDebtIncoming(user.id, period.month, period.year);
      const drafts = repository.getDraftQueues(user.id, period.month, period.year);
      const monthlyFinances = repository.getMonthlyFinancesSummary(user.id, period.month, period.year);
      const selfPerson = repository.getSelfPerson(user.id);
      const selfCardTotal = repository.getSelfCardMonthTotal(user.id, period.month, period.year, selfPerson?.id);
      const selfCardPayment = repository.getPersonPaymentBreakdownForMonth(user.id, period.month, period.year, selfPerson?.id);
      const sharedProjection = repository.getSharedPurchaseProjectionSummary(user.id, period.month, period.year);
      const debt = {
        outgoing_open_cents: sumBy(outgoing, 'open_cents'),
        incoming_open_cents: sumBy(incoming, 'open_cents'),
        draft_cents: sumBy(drafts, 'total_cents')
      };
      const fullCardSummary = {
        total_cents: sumBy(cards, 'total_cents'),
        paid_cents: sumBy(cards, 'paid_cents')
      };
      fullCardSummary.open_cents = Math.max(0, fullCardSummary.total_cents - fullCardSummary.paid_cents);

      const incomeTotal = sumBy(monthlyFinances.filter((row) => row.type === 'income'), 'amount_cents');
      const expenseTotal = sumBy(monthlyFinances.filter((row) => row.type !== 'income'), 'amount_cents');
      const selfCardTotalCents = Math.max(0, Number(selfCardTotal?.total_cents || 0));
      const selfCardPaidCents = Math.min(selfCardTotalCents, Math.max(0, Number(selfCardPayment?.total_paid_cents || 0)));
      const sharedReceivedTotalCents = Math.max(0, Number(sharedProjection?.total_cents || 0));
      const personalCommittedCents = selfCardTotalCents + expenseTotal + sharedReceivedTotalCents;
      const personalSummary = {
        self_person_id: Number(selfPerson?.id || 0) || null,
        self_name: selfPerson?.name || user.name || user.email || 'Você',
        self_card_total_cents: selfCardTotalCents,
        self_card_paid_cents: selfCardPaidCents,
        self_card_open_cents: Math.max(0, selfCardTotalCents - selfCardPaidCents),
        self_card_purchase_count: Number(selfCardTotal?.purchase_count || 0),
        self_card_manual_paid_cents: Math.max(0, Number(selfCardPayment?.manual_cents || 0)),
        self_card_auto_paid_cents: Math.max(0, Number(selfCardPayment?.auto_cents || 0)),
        shared_received_total_cents: sharedReceivedTotalCents,
        shared_received_paid_cents: Math.max(0, Number(sharedProjection?.confirmed_paid_cents || 0)),
        shared_received_open_cents: Math.max(0, Number(sharedProjection?.open_cents || 0)),
        shared_received_count: Number(sharedProjection?.item_count || 0),
        income_cents: incomeTotal,
        expense_cents: expenseTotal,
        personal_committed_cents: personalCommittedCents,
        forecast_balance_cents: incomeTotal - personalCommittedCents
      };

      return makeResult({
        ok: true,
        code: 'MONTH_SUMMARY',
        data: { period, cards, people, top_purchases: topPurchases, debt, monthly_finances: monthlyFinances, personal_summary: personalSummary, full_card_summary: fullCardSummary },
        whatsapp: { text: buildMonthSummaryText({ ...period, cards, people, topPurchases, debt, monthlyFinances, personalSummary, fullCardSummary }) }
      });
    });
  }

  function buildCardSummaryText({ card, period, purchases }) {
    const lines = purchases.length
      ? truncateRows(purchases, 6).map((purchase, index) => `${index + 1}. ${purchase.description} — *${formatBRLFromCents(purchase.amount_cents)}*${purchase.txn_date ? ` · ${formatDateBR(purchase.txn_date)}` : ''}`)
      : ['• Nenhuma compra nessa fatura.'];
    return [
      `💳 *${card.name}* — ${periodLabel(period.month, period.year)}`,
      '',
      `🧾 Total da fatura: *${formatBRLFromCents(card.total_cents)}*`,
      `✅ Pago registrado: *${formatBRLFromCents(card.paid_cents)}*`,
      `📌 Em aberto: *${formatBRLFromCents(card.open_cents)}*`,
      card.due_date ? `📅 Vencimento: *${formatDateBR(card.due_date)}*` : '📅 Vencimento: não informado',
      `🛍️ ${card.purchase_count} ${plural(card.purchase_count, 'compra', 'compras')}`,
      '',
      '*Maiores compras*',
      ...lines,
      '',
      'Quer que eu mostre as *últimas compras* desse cartão?'
    ].join('\n');
  }

  function getCardSummary(payload = {}, meta = {}) {
    return withQueryHandling(payload, meta, 'queries.card_summary', ({ user }) => {
      const query = payload.query || payload;
      const period = resolvePeriod({ ...payload, ...query });
      const cards = repository.getCardMonthTotals(user.id, period.month, period.year).map(serializeCard);
      const allCards = repository.listCards(user.id);
      const hint = query.card_hint || query.card || query.card_name || '';
      let selectedCard = null;

      if (hint) {
        const resolved = resolveByHint(allCards, hint, ['name', 'brand']);
        if (resolved.status === 'not_found') {
          throw new AutomationApiError(`Não encontrei cartão parecido com "${hint}". Me manda o nome como aparece no AcerttaPay?`, {
            code: 'CARD_NOT_FOUND',
            statusCode: 404,
            details: { card_hint: hint }
          });
        }
        if (resolved.status === 'ambiguous') {
          const options = resolved.matches.map((card, index) => `${index + 1}. ${card.name}`).join('\n');
          throw new AutomationApiError(`Encontrei mais de um cartão parecido. Qual deles?\n${options}`, {
            code: 'NEEDS_CARD_CLARIFICATION',
            statusCode: 200,
            details: { matches: resolved.matches }
          });
        }
        selectedCard = resolved.item;
      }

      if (!selectedCard && cards.length === 1) selectedCard = { id: cards[0].id, name: cards[0].name };
      if (!selectedCard && !hint) {
        const total = sumBy(cards, 'total_cents');
        const cardLines = cards.length
          ? truncateRows(cards, 8).map((card, index) => `${index + 1}. ${card.name}: *${formatBRLFromCents(card.total_cents)}*`)
          : ['• Nenhum cartão com compra nessa fatura.'];
        return makeResult({
          ok: true,
          code: 'CARD_SUMMARY_LIST',
          data: { period, cards },
          whatsapp: {
            text: [`💳 *Faturas de ${periodLabel(period.month, period.year)}*`, '', `Total nos cartões: *${formatBRLFromCents(total)}*`, '', ...cardLines, '', 'Me diz o cartão para eu abrir o detalhe. Ex.: *fatura do Nubank*.'].join('\n')
          }
        });
      }

      const cardSummary = cards.find((card) => Number(card.id || 0) === Number(selectedCard.id || selectedCard.card_id || 0)) || serializeCard({
        ...selectedCard,
        card_id: selectedCard.id,
        card_name: selectedCard.name,
        month: period.month,
        year: period.year,
        total_cents: 0,
        paid_cents: 0,
        purchase_count: 0
      });
      const purchases = repository.getTopPurchasesByMonth(user.id, period.month, period.year, { cardId: cardSummary.id, limit: query.limit || 6 });
      return makeResult({
        ok: true,
        code: 'CARD_SUMMARY',
        data: { period, card: cardSummary, purchases },
        whatsapp: { text: buildCardSummaryText({ card: cardSummary, period, purchases }) }
      });
    });
  }

  function buildPurchasesText({ rows, title, emptyText }) {
    if (!rows.length) {
      return [title, '', emptyText || 'Não encontrei compras nesse recorte. Nada de fantasma na fatura por aqui.'].join('\n');
    }
    const total = sumBy(rows, 'amount_cents');
    return [
      title,
      '',
      `Total encontrado: *${formatBRLFromCents(total)}* em ${rows.length} ${plural(rows.length, 'compra', 'compras')}.`,
      '',
      ...truncateRows(rows, 12).map((purchase, index) => `${index + 1}. ${purchase.description} — *${formatBRLFromCents(purchase.amount_cents)}* · ${purchase.card_name}${purchase.txn_date ? ` · ${formatDateBR(purchase.txn_date)}` : ''}`)
    ].join('\n');
  }

  function getRecentPurchases(payload = {}, meta = {}) {
    return withQueryHandling(payload, meta, 'queries.recent_purchases', ({ user }) => {
      const query = payload.query || payload;
      const period = resolvePeriod({ ...payload, ...query });
      const date = parseIsoDate(query.date || query.day || '');
      const hasPeriodFilter = !date && hasExplicitPurchasePeriod({ ...payload, ...query });
      let cardId = 0;
      const hint = query.card_hint || query.card || query.card_name || '';
      if (hint) {
        const resolved = resolveByHint(repository.listCards(user.id), hint, ['name', 'brand']);
        if (resolved.status === 'not_found') throw new AutomationApiError(`Não encontrei cartão parecido com "${hint}".`, { code: 'CARD_NOT_FOUND', statusCode: 404 });
        if (resolved.status === 'ambiguous') throw new AutomationApiError(`Encontrei mais de um cartão parecido com "${hint}". Me diz o nome certinho?`, { code: 'NEEDS_CARD_CLARIFICATION', statusCode: 200, details: { matches: resolved.matches } });
        cardId = Number(resolved.item.id || 0);
      }
      const rows = repository.getRecentPurchases(user.id, {
        limit: query.limit || 10,
        date,
        month: hasPeriodFilter ? period.month : 0,
        year: hasPeriodFilter ? period.year : 0,
        cardId
      });
      const title = date
        ? `🧾 *Compras de ${formatDateBR(date)}*${hint ? ` no ${hint}` : ''}`
        : hasPeriodFilter
          ? `🧾 *Compras de ${periodLabel(period.month, period.year)}*${hint ? ` no ${hint}` : ''}`
          : `🧾 *Últimas compras*${hint ? ` no ${hint}` : ''}`;
      return makeResult({
        ok: true,
        code: date ? 'PURCHASES_BY_DAY' : 'RECENT_PURCHASES',
        data: { period: hasPeriodFilter ? period : null, date, purchases: rows, chronological: !date && !hasPeriodFilter },
        whatsapp: { text: buildPurchasesText({ rows, title }) }
      });
    });
  }

  function buildPersonSummaryText({ person, period, purchases }) {
    const lines = purchases.length
      ? truncateRows(purchases, 8).map((purchase, index) => `${index + 1}. ${purchase.description} — parte: *${formatBRLFromCents(purchase.share_cents)}* · compra: ${formatBRLFromCents(purchase.purchase_amount_cents)} · ${purchase.card_name}`)
      : ['• Nenhuma compra alocada para essa pessoa nesse mês.'];
    return [
      `👥 *${person.name}* — ${periodLabel(period.month, period.year)}`,
      '',
      `Total alocado: *${formatBRLFromCents(person.total_cents)}*`,
      `✅ Pago registrado: *${formatBRLFromCents(person.paid_cents)}*`,
      `📌 Em aberto no controle: *${formatBRLFromCents(person.open_cents)}*`,
      `🧾 ${person.purchase_count} ${plural(person.purchase_count, 'compra', 'compras')}`,
      '',
      '*Principais compras*',
      ...lines
    ].join('\n');
  }

  function getPersonSummary(payload = {}, meta = {}) {
    return withQueryHandling(payload, meta, 'queries.person_summary', ({ user }) => {
      const query = payload.query || payload;
      const period = resolvePeriod({ ...payload, ...query });
      const people = repository.listPeople(user.id);
      const hint = query.person_hint || query.person || query.person_name || '';
      if (!hint) {
        const totals = repository.getPersonMonthTotals(user.id, period.month, period.year).map(serializePerson);
        const lines = totals.length
          ? truncateRows(totals, 10).map((person, index) => `${index + 1}. ${person.name}: *${formatBRLFromCents(person.total_cents)}*`)
          : ['• Nenhum participante com valor nesse período.'];
        return makeResult({
          ok: true,
          code: 'PERSON_SUMMARY_LIST',
          data: { period, people: totals },
          whatsapp: { text: [`👥 *Participantes em ${periodLabel(period.month, period.year)}*`, '', ...lines, '', 'Me diz uma pessoa para eu abrir o detalhe. Ex.: *quanto a Ana tem comigo?*'].join('\n') }
        });
      }
      const resolved = resolveByHint(people, hint, ['name', 'email', 'phone']);
      if (resolved.status === 'not_found') {
        throw new AutomationApiError(`Não encontrei "${hint}" nos seus contatos do AcerttaPay.`, { code: 'PERSON_NOT_FOUND', statusCode: 404 });
      }
      if (resolved.status === 'ambiguous') {
        const options = resolved.matches.map((person, index) => `${index + 1}. ${person.name}`).join('\n');
        throw new AutomationApiError(`Encontrei mais de uma pessoa parecida. Qual delas?\n${options}`, { code: 'NEEDS_PERSON_CLARIFICATION', statusCode: 200, details: { matches: resolved.matches } });
      }
      const personId = Number(resolved.item.id || 0);
      const summary = serializePerson(repository.getPersonMonthSummary(user.id, personId, period.month, period.year) || {
        person_id: personId,
        person_name: resolved.item.name,
        profile_kind: resolved.item.profile_kind || 'contact',
        total_cents: 0,
        paid_cents: 0,
        purchase_count: 0
      });
      const purchases = repository.getPersonTransactions(user.id, personId, period.month, period.year, query.limit || 8);
      return makeResult({
        ok: true,
        code: 'PERSON_SUMMARY',
        data: { period, person: summary, purchases },
        whatsapp: { text: buildPersonSummaryText({ person: summary, period, purchases }) }
      });
    });
  }

  function aggregateDebtByPerson(rows = [], valueField = 'open_cents') {
    const map = new Map();
    rows.forEach((row) => {
      const key = `${row.user_id || row.person_name}`;
      const current = map.get(key) || { name: row.person_name || 'Pessoa', open_cents: 0, total_cents: 0, item_count: 0, statuses: {} };
      current.open_cents += Number(row[valueField] || 0);
      current.total_cents += Number(row.total_cents || row[valueField] || 0);
      current.item_count += Number(row.item_count || 0);
      current.statuses[row.status || 'open'] = (current.statuses[row.status || 'open'] || 0) + Number(row.item_count || 0);
      map.set(key, current);
    });
    return Array.from(map.values()).sort((a, b) => b.open_cents - a.open_cents || a.name.localeCompare(b.name));
  }

  function buildDebtSummaryText({ period, direction, outgoing, incoming, drafts, privateReminders }) {
    const outgoingPeople = aggregateDebtByPerson(outgoing);
    const incomingPeople = aggregateDebtByPerson(incoming);
    const privatePeople = aggregateDebtByPerson(privateReminders);
    const draftPeople = aggregateDebtByPerson(drafts, 'total_cents');
    const outgoingTotal = sumBy(outgoingPeople, 'open_cents') + sumBy(privatePeople, 'open_cents');
    const incomingTotal = sumBy(incomingPeople, 'open_cents');
    const draftTotal = sumBy(draftPeople, 'open_cents');

    if (direction === 'i_owe') {
      const lines = incomingPeople.length
        ? truncateRows(incomingPeople, 8).map((row) => `• ${row.name}: *${formatBRLFromCents(row.open_cents)}* em ${row.item_count} ${plural(row.item_count, 'item', 'itens')}`)
        : ['• Nenhuma pendência encontrada para você pagar nesse mês.'];
      return [`🙋 *O que você deve em ${periodLabel(period.month, period.year)}*`, '', `Total em aberto: *${formatBRLFromCents(incomingTotal)}*`, '', ...lines].join('\n');
    }

    if (direction === 'owed_to_me') {
      const lines = outgoingPeople.length || privatePeople.length || draftPeople.length
        ? [
          ...truncateRows(outgoingPeople, 8).map((row) => `• ${row.name}: *${formatBRLFromCents(row.open_cents)}* em ${row.item_count} ${plural(row.item_count, 'cobrança', 'cobranças')}`),
          ...truncateRows(privatePeople, 8).map((row) => `• ${row.name}: *${formatBRLFromCents(row.open_cents)}* em lembrete interno`),
          ...truncateRows(draftPeople, 8).map((row) => `• ${row.name}: *${formatBRLFromCents(row.open_cents)}* em rascunho ainda não enviado`)
        ]
        : ['• Ninguém aparece te devendo nesse recorte. Milagre financeiro registrado.'];
      return [`👥 *Quem te deve em ${periodLabel(period.month, period.year)}*`, '', `Total em aberto: *${formatBRLFromCents(outgoingTotal)}*`, draftTotal ? `Rascunhos não enviados: *${formatBRLFromCents(draftTotal)}*` : '', '', ...lines].filter((line) => line !== '').join('\n');
    }

    return [
      `👥 *Pendências em ${periodLabel(period.month, period.year)}*`,
      '',
      `A receber: *${formatBRLFromCents(outgoingTotal)}*`,
      `A pagar: *${formatBRLFromCents(incomingTotal)}*`,
      draftTotal ? `Rascunhos: *${formatBRLFromCents(draftTotal)}*` : '',
      '',
      'Quer abrir *quem me deve* ou *o que eu devo*?'
    ].filter((line) => line !== '').join('\n');
  }

  function getDebtSummary(payload = {}, meta = {}) {
    return withQueryHandling(payload, meta, 'queries.debt_summary', ({ user }) => {
      const query = payload.query || payload;
      const period = resolvePeriod({ ...payload, ...query });
      const direction = ['owed_to_me', 'i_owe', 'overview'].includes(query.direction) ? query.direction : 'overview';
      const outgoing = repository.getSharedDebtOutgoing(user.id, period.month, period.year);
      const incoming = repository.getSharedDebtIncoming(user.id, period.month, period.year);
      const drafts = repository.getDraftQueues(user.id, period.month, period.year);
      const privateReminders = repository.getPrivateDebtReminders(user.id, period.month, period.year);
      return makeResult({
        ok: true,
        code: 'DEBT_SUMMARY',
        data: { period, direction, outgoing, incoming, drafts, private_reminders: privateReminders },
        whatsapp: { text: buildDebtSummaryText({ period, direction, outgoing, incoming, drafts, privateReminders }) }
      });
    });
  }

  return {
    getMonthSummary,
    getCardSummary,
    getRecentPurchases,
    getPersonSummary,
    getDebtSummary,
    handleServiceError
  };
}

module.exports = {
  createAutomationQueriesService
};
