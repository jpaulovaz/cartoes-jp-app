const crypto = require('crypto');
const { createAutomationMonthlyFinancesRepository } = require('../repositories/automationMonthlyFinances.repository');
const { AutomationApiError, normalizeAutomationPhone } = require('./automationApi.service');
const { formatBRLFromCents } = require('../utils');

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

function makeResult(payload = {}, statusCode = 200) {
  return { statusCode, ...payload };
}

function requestHash(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload || {})).digest('hex');
}

function currentSaoPauloDate() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
}

function addMonths(year, month, delta) {
  const d = new Date(Date.UTC(Number(year || 0), Number(month || 1) - 1 + Number(delta || 0), 1));
  return { month: d.getUTCMonth() + 1, year: d.getUTCFullYear() };
}

function resolvePeriod(input = {}) {
  const today = currentSaoPauloDate();
  const [todayYear, todayMonth] = today.split('-').map(Number);
  const rawPeriod = String(input.period || input.when || '').trim().toLowerCase();
  if (['last_month', 'previous_month', 'mes_passado', 'mês passado'].includes(rawPeriod)) return addMonths(todayYear, todayMonth, -1);
  if (['next_month', 'proximo_mes', 'próximo mês', 'mes_que_vem', 'mês que vem'].includes(rawPeriod)) return addMonths(todayYear, todayMonth, 1);
  const month = Number(input.month || input.mes || input.due_month || 0);
  const year = Number(input.year || input.ano || input.due_year || 0);
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

function periodLabel(month, year) {
  return `${MONTH_NAMES[Number(month || 0)] || String(month || '').padStart(2, '0')}/${year}`;
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

function sanitizeDescription(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) throw new AutomationApiError('Dá um nome para essa finança antes de salvar.', { code: 'MISSING_DESCRIPTION', statusCode: 400 });
  return text.slice(0, 120);
}

function normalizeFinanceType(value) {
  const text = String(value || '').trim().toLowerCase();
  if (['income', 'entrada', 'receita', 'ganho', 'receber'].includes(text)) return 'income';
  if (['expense', 'saida', 'saída', 'despesa', 'conta', 'pagar'].includes(text)) return 'expense';
  return null;
}

function normalizeAmountMode(value) {
  const text = String(value || '').trim().toLowerCase();
  if (['variable', 'variavel', 'variável', 'list', 'lista', 'items', 'itens'].includes(text)) return 'variable';
  return 'fixed';
}

function normalizeScheduleKind(value, type) {
  const safeType = normalizeFinanceType(type);
  const text = String(value || '').trim().toLowerCase();
  if (safeType === 'income') return 'receive';
  if (safeType === 'expense') return text === 'pay' || text === 'pago' || text === 'pagamento' ? 'pay' : 'due';
  return null;
}

function normalizeDay(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 31 ? parsed : null;
}

function parseMoneyCents(value, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.round(value));
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  if (/^\d+$/.test(raw)) return Number(raw);
  const digits = raw.replace(/\D/g, '');
  return digits ? Number(digits) : fallback;
}

function parseIsoDate(value) {
  const raw = String(value || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '';
  const date = new Date(`${raw}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? '' : raw;
}

function sanitizeItems(items = [], fallback = {}) {
  const list = Array.isArray(items) ? items : [];
  const normalized = [];
  for (const raw of list.slice(0, 80)) {
    const amountCents = parseMoneyCents(raw.amount_cents ?? raw.amountCents ?? raw.amount, 0);
    const itemDate = parseIsoDate(raw.item_date || raw.date) || fallback.date || `${fallback.year}-${String(fallback.month).padStart(2, '0')}-01`;
    const itemSource = sanitizeDescription(raw.item_source || raw.source || raw.description || fallback.description || 'Lançamento');
    if (amountCents <= 0) continue;
    normalized.push({
      item_date: itemDate,
      item_source: itemSource,
      amount_cents: amountCents,
      is_paid: raw.is_paid === true || raw.isPaid === true || raw.paid === true ? 1 : 0
    });
  }
  return normalized;
}

function isAffirmative(value) {
  const text = normalizeText(value);
  return /^(sim|s|confirmo|confirmar|confirma|ok|pode|pode sim|isso|isso mesmo|feito|lançar|lancar|salvar|apagar|excluir|marcar)$/i.test(text)
    || text.includes('pode salvar')
    || text.includes('pode lancar')
    || text.includes('pode lançar')
    || text.includes('confirmo');
}

function isNegative(value) {
  const text = normalizeText(value);
  return /^(nao|não|n|cancelar|cancela|deixa|deixa pra la|deixa para la|voltar)$/i.test(text)
    || text.includes('nao confirma')
    || text.includes('não confirma')
    || text.includes('nao quero')
    || text.includes('não quero');
}

function scoreName(row, hint) {
  const needle = normalizeText(hint);
  const hay = normalizeText(row.description || row.name || '');
  if (!needle || !hay) return 0;
  if (hay === needle) return 100;
  if (hay.startsWith(needle)) return 92;
  if (needle.startsWith(hay)) return 88;
  if (hay.includes(needle) || needle.includes(hay)) return 78;
  const tokens = needle.split(' ').filter(Boolean);
  const hayTokens = new Set(hay.split(' ').filter(Boolean));
  const hits = tokens.filter((token) => hayTokens.has(token)).length;
  return hits ? Math.min(72, 44 + hits * 12) : 0;
}

function resolveFinanceFromHint(rows = [], hint = '', id = 0) {
  const targetId = Number(id || 0);
  if (targetId) {
    const exact = rows.find((row) => Number(row.id || 0) === targetId) || null;
    return exact ? { status: 'found', item: exact, matches: [exact] } : { status: 'not_found', item: null, matches: [] };
  }
  const needle = normalizeText(hint);
  if (!needle) return { status: 'missing', item: null, matches: [] };
  const matches = rows
    .map((row) => ({ row, score: scoreName(row, needle) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || Number(b.row.id || 0) - Number(a.row.id || 0));
  if (!matches.length) return { status: 'not_found', item: null, matches: [] };
  const topScore = matches[0].score;
  const tied = matches.filter((entry) => entry.score === topScore || (topScore - entry.score <= 4 && topScore < 100));
  if (tied.length > 1) return { status: 'ambiguous', item: null, matches: tied.map((entry) => entry.row) };
  return { status: 'found', item: matches[0].row, matches: matches.map((entry) => entry.row) };
}

function serializePublicFinance(finance = {}) {
  return {
    id: Number(finance.id || 0),
    type: finance.type,
    type_label: finance.type === 'income' ? 'entrada' : 'saída',
    description: finance.description || 'Item mensal',
    amount_cents: Number(finance.amount_cents || 0),
    amount_mode: finance.amount_mode || 'fixed',
    month: Number(finance.month || 0),
    year: Number(finance.year || 0),
    period_label: periodLabel(finance.month, finance.year),
    day_of_month: finance.day_of_month || null,
    schedule_kind: finance.schedule_kind || null,
    is_paid: finance.is_fully_paid ? true : Number(finance.is_paid || 0) === 1,
    paid_at: finance.paid_at || null,
    paid_cents: Number(finance.paid_cents || 0),
    open_cents: Number(finance.open_cents || 0),
    item_count: Number(finance.item_count || 0)
  };
}

function financeLine(finance = {}) {
  const icon = finance.type === 'income' ? '✨' : '🧾';
  const paid = finance.is_fully_paid || finance.is_paid ? ' · pago' : '';
  const day = finance.day_of_month ? ` · dia ${String(finance.day_of_month).padStart(2, '0')}` : '';
  return `${icon} #${finance.id} — ${finance.description}: *${formatBRLFromCents(finance.amount_cents)}*${day}${paid}`;
}

function createAutomationMonthlyFinancesService(deps = {}) {
  const repository = deps.monthlyFinancesAutomationRepository || createAutomationMonthlyFinancesRepository();

  function assertApiEnabled() {
    if (!repository.getBooleanSetting('AUTOMATION_API_ENABLED', false)) {
      throw new AutomationApiError('A API de automações está desligada no AcerttaPay.', {
        code: 'AUTOMATION_DISABLED',
        statusCode: 503
      });
    }
  }

  function handleServiceError(error) {
    if (error instanceof AutomationApiError) {
      return makeResult({
        ok: false,
        code: error.code || 'MONTHLY_FINANCE_VALIDATION_ERROR',
        message: error.message,
        details: error.details || null,
        whatsapp: { text: error.message }
      }, error.statusCode || 400);
    }
    return makeResult({
      ok: false,
      code: 'MONTHLY_FINANCE_INTERNAL_ERROR',
      message: 'A automação das finanças mensais tropeçou por aqui. Tenta de novo em instantes.',
      whatsapp: { text: 'A automação das finanças mensais tropeçou por aqui. Tenta de novo em instantes.' }
    }, 500);
  }

  function resolveAuthorizedPhone(phone) {
    const normalized = normalizeAutomationPhone(phone);
    if (!normalized.ok) {
      throw new AutomationApiError(normalized.reason || 'Telefone inválido.', { code: 'INVALID_PHONE', statusCode: 400 });
    }
    const authorization = repository.getAuthorizationByPhone(normalized.e164, normalized.whatsappNumber);
    if (!authorization || Number(authorization.enabled || 0) === 0 || String(authorization.user_status || 'active') === 'deleted') {
      throw new AutomationApiError('Esse número ainda não está liberado no AcerttaPay. Ative o WhatsApp nas Configurações do app.', { code: 'NOT_AUTHORIZED', statusCode: 403 });
    }
    const user = repository.getUserById(authorization.user_id);
    if (!user) throw new AutomationApiError('Não encontrei esse usuário no AcerttaPay.', { code: 'USER_NOT_FOUND', statusCode: 404 });
    repository.touchAuthorization(authorization.id);
    return { user, phone: normalized, authorization };
  }

  function withHandling(payload, meta, operation, fn) {
    let resolved = null;
    try {
      assertApiEnabled();
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

  function normalizeFinancePayload(input = {}) {
    const raw = input.finance || input.monthly_finance || input;
    const period = resolvePeriod({ ...payload, ...raw });
    const type = normalizeFinanceType(raw.type || raw.kind || raw.direction) || 'expense';
    const description = sanitizeDescription(raw.description || raw.title || raw.name);
    const amountMode = normalizeAmountMode(raw.amount_mode || raw.amountMode || raw.mode);
    const amountCents = parseMoneyCents(raw.amount_cents ?? raw.amountCents ?? raw.amount, 0);
    const dayOfMonth = normalizeDay(raw.day_of_month || raw.dayOfMonth || raw.due_day || raw.dueDay || raw.day);
    const scheduleKind = dayOfMonth ? normalizeScheduleKind(raw.schedule_kind || raw.scheduleKind || raw.date_kind, type) : null;
    const itemDate = parseIsoDate(raw.date || raw.item_date || raw.due_date) || `${period.year}-${String(period.month).padStart(2, '0')}-${String(dayOfMonth || 1).padStart(2, '0')}`;
    const variableItems = amountMode === 'variable'
      ? sanitizeItems(raw.items && raw.items.length ? raw.items : [{
        item_date: itemDate,
        item_source: description,
        amount_cents: amountCents,
        is_paid: raw.is_paid ?? raw.isPaid ?? raw.paid
      }], { date: itemDate, description, month: period.month, year: period.year })
      : [];

    const totalCents = amountMode === 'variable'
      ? variableItems.reduce((sum, item) => sum + Number(item.amount_cents || 0), 0)
      : amountCents;

    if (totalCents <= 0) {
      throw new AutomationApiError('Me manda um valor maior que zero para essa finança mensal.', { code: 'INVALID_AMOUNT', statusCode: 400 });
    }

    return {
      month: period.month,
      year: period.year,
      type,
      description,
      amountMode,
      amountCents: totalCents,
      dayOfMonth,
      scheduleKind,
      isPaid: raw.is_paid ?? raw.isPaid ?? raw.paid ?? false,
      items: variableItems,
      formula: String(raw.formula || '').trim(),
      isRecurring: raw.is_recurring === true || raw.recurring === true || raw.recurrence === 'monthly',
      requiresConfirmation: raw.requires_confirmation === true || raw.confirmation_required === true || raw.is_recurring === true || raw.recurring === true || raw.recurrence === 'monthly' || amountMode === 'fixed'
    };
  }

  function assertMonthOpen(userId, month, year) {
    if (repository.isMonthClosed(userId, month, year)) {
      throw new AutomationApiError(`O mês ${repository.getMonthLabel(month, year)} já está fechado. Não mexi nele para não bagunçar o que já foi conferido.`, {
        code: 'MONTH_CLOSED',
        statusCode: 423
      });
    }
  }

  function buildCreatedText(finance = {}) {
    const typeLabel = finance.type === 'income' ? 'entrada' : 'saída';
    const scheduleLine = finance.day_of_month
      ? `📅 Dia: *${String(finance.day_of_month).padStart(2, '0')}*${finance.schedule_kind === 'pay' ? ' · pagamento' : finance.schedule_kind === 'receive' ? ' · recebimento' : ' · vencimento'}`
      : '📅 Dia: sem data fixa';
    return [
      `✅ *${typeLabel[0].toUpperCase()}${typeLabel.slice(1)} mensal registrada!*`,
      '',
      `🧾 ${finance.description}`,
      `💰 Valor: *${formatBRLFromCents(finance.amount_cents)}*`,
      `🗓️ Mês: *${periodLabel(finance.month, finance.year)}*`,
      scheduleLine,
      `🔖 Código: *#${finance.id}*`,
      '',
      'Ficou fora do cartão, do jeitinho que a vida real gosta de complicar. 😉'
    ].join('\n');
  }

  function buildListText(rows = [], month, year) {
    const incomeRows = rows.filter((row) => row.type === 'income');
    const expenseRows = rows.filter((row) => row.type === 'expense');
    const incomeTotal = incomeRows.reduce((sum, row) => sum + Number(row.amount_cents || 0), 0);
    const expenseTotal = expenseRows.reduce((sum, row) => sum + Number(row.amount_cents || 0), 0);
    const openExpenses = expenseRows.reduce((sum, row) => sum + Number(row.open_cents || 0), 0);
    const lines = [
      `📒 *Finanças mensais — ${periodLabel(month, year)}*`,
      '',
      `✨ Entradas: *${formatBRLFromCents(incomeTotal)}*`,
      `🧾 Saídas: *${formatBRLFromCents(expenseTotal)}*`,
      `⏳ Saídas em aberto: *${formatBRLFromCents(openExpenses)}*`,
      ''
    ];
    if (!rows.length) {
      lines.push('Nada fora do cartão por aqui. Mês comportado... por enquanto. 😄');
      return lines.join('\n');
    }
    if (incomeRows.length) {
      lines.push('✨ *Entradas*');
      incomeRows.slice(0, 8).forEach((row) => lines.push(financeLine(row)));
      lines.push('');
    }
    if (expenseRows.length) {
      lines.push('🧾 *Saídas*');
      expenseRows.slice(0, 10).forEach((row) => lines.push(financeLine(row)));
    }
    lines.push('', 'Para marcar uma conta, responda algo como *marcar internet como paga* ou *cancelar #3*.');
    return lines.join('\n');
  }

  function createConversationForConfirmation({ resolved, state = 'awaiting_monthly_finance_action_confirmation', action, payload, source }) {
    const conversation = repository.createConversationState({
      userId: resolved.user.id,
      phoneE164: resolved.phone.e164,
      channel: source?.channel || 'whatsapp',
      state,
      relatedPurchaseId: null,
      payload: {
        domain: 'monthly_finances',
        action,
        payload,
        source: source || {}
      }
    });
    return conversation;
  }

  function executeIdempotentWrite({ userId, phoneE164, channel = 'whatsapp', idempotencyKey, operation, hashPayload, fn }) {
    const key = String(idempotencyKey || '').trim();
    if (!key) {
      throw new AutomationApiError('Idempotency-Key é obrigatório para alterações financeiras pelo WhatsApp.', {
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        statusCode: 400
      });
    }
    const idempotency = repository.tryCreateIdempotency({
      userId,
      channel,
      idempotencyKey: key,
      operation,
      requestHash: requestHash(hashPayload || {})
    });
    if (!idempotency.created) {
      const cached = repository.safeJsonParse(idempotency.row?.response_json, null);
      if (cached) return makeResult({ ...cached, duplicate: true }, 200);
      throw new AutomationApiError('Essa confirmação já está em processamento. Não dupliquei a ação.', {
        code: 'IDEMPOTENCY_IN_PROGRESS',
        statusCode: 409
      });
    }
    try {
      const response = fn();
      repository.finishIdempotency({ channel, idempotencyKey: key, response, status: response.ok ? 'success' : 'completed' });
      return response;
    } catch (error) {
      const response = handleServiceError(error);
      repository.finishIdempotency({ channel, idempotencyKey: key, response, status: 'error' });
      throw error;
    }
  }

  function createFinanceNow(resolved, financeInput, meta, source = {}) {
    assertMonthOpen(resolved.user.id, financeInput.month, financeInput.year);
    return executeIdempotentWrite({
      userId: resolved.user.id,
      phoneE164: resolved.phone.e164,
      channel: source.channel || 'whatsapp',
      idempotencyKey: meta.idempotencyKey,
      operation: 'monthly_finance.create',
      hashPayload: financeInput,
      fn: () => {
        const finance = repository.insertFinance({
          userId: resolved.user.id,
          month: financeInput.month,
          year: financeInput.year,
          type: financeInput.type,
          description: financeInput.description,
          amountMode: financeInput.amountMode,
          amountCents: financeInput.amountCents,
          dayOfMonth: financeInput.dayOfMonth,
          scheduleKind: financeInput.scheduleKind,
          isPaid: financeInput.isPaid,
          items: financeInput.items,
          formula: financeInput.formula
        });
        repository.createLocalNotification(
          resolved.user.id,
          'Finança mensal criada pelo WhatsApp',
          `${finance.description} em ${periodLabel(finance.month, finance.year)} por ${formatBRLFromCents(finance.amount_cents)}.`,
          `/detalhamento/${finance.year}/${finance.month}`
        );
        return makeResult({
          ok: true,
          code: 'MONTHLY_FINANCE_CREATED',
          finance: serializePublicFinance(finance),
          whatsapp: { text: buildCreatedText(finance) }
        });
      }
    });
  }

  function createMonthlyFinance(payload = {}, meta = {}) {
    return withHandling(payload, meta, 'monthly_finance.create', (resolved) => {
      const financeInput = normalizeFinancePayload(payload);
      assertMonthOpen(resolved.user.id, financeInput.month, financeInput.year);
      const source = payload.source || { channel: payload.channel || 'whatsapp' };
      if (financeInput.requiresConfirmation && payload.confirmed !== true) {
        const conversation = createConversationForConfirmation({ resolved, action: 'create', payload: financeInput, source });
        return makeResult({
          ok: false,
          code: 'NEEDS_MONTHLY_FINANCE_CONFIRMATION',
          conversation: {
            id: Number(conversation.id || 0),
            state: conversation.state,
            expires_at: conversation.expires_at
          },
          whatsapp: {
            text: [
              '🧾 *Confirmar finança mensal?*',
              '',
              `${financeInput.type === 'income' ? '✨ Entrada' : '🧾 Saída'}: *${financeInput.description}*`,
              `💰 Valor: *${formatBRLFromCents(financeInput.amountCents)}*`,
              `🗓️ Mês: *${periodLabel(financeInput.month, financeInput.year)}*`,
              financeInput.dayOfMonth ? `📅 Dia: *${String(financeInput.dayOfMonth).padStart(2, '0')}*` : '📅 Dia: sem data fixa',
              '',
              'Responde *confirmar* para salvar ou *cancelar* para deixar quieto.'
            ].join('\n')
          }
        }, 202);
      }
      return createFinanceNow(resolved, financeInput, meta, source);
    });
  }

  function searchMonthlyFinances(payload = {}, meta = {}) {
    return withHandling(payload, meta, 'monthly_finance.search', (resolved) => {
      const query = payload.query || payload.filters || payload || {};
      const period = resolvePeriod(query);
      const rows = repository.listFinances(resolved.user.id, {
        month: period.month,
        year: period.year,
        type: normalizeFinanceType(query.type || query.direction) || '',
        status: query.status || '',
        text: query.finance_hint || query.description || query.text || '',
        limit: query.limit || 20
      });
      return makeResult({
        ok: true,
        code: 'MONTHLY_FINANCES_LIST',
        finances: rows.map(serializePublicFinance),
        totals: {
          income_cents: rows.filter((row) => row.type === 'income').reduce((sum, row) => sum + Number(row.amount_cents || 0), 0),
          expense_cents: rows.filter((row) => row.type === 'expense').reduce((sum, row) => sum + Number(row.amount_cents || 0), 0),
          open_expense_cents: rows.filter((row) => row.type === 'expense').reduce((sum, row) => sum + Number(row.open_cents || 0), 0)
        },
        whatsapp: { text: buildListText(rows, period.month, period.year) }
      });
    });
  }

  function resolveFinanceTarget(userId, payload = {}) {
    const query = payload.query || payload.filters || payload || {};
    const period = resolvePeriod(query);
    const rows = repository.listFinances(userId, {
      month: period.month,
      year: period.year,
      type: normalizeFinanceType(query.type || query.direction) || '',
      status: query.status || '',
      limit: 50
    });
    const id = Number(payload.financeId || payload.finance_id || payload.id || 0);
    const hint = query.finance_hint || query.description || query.text || payload.finance_hint || payload.description || '';
    const resolved = resolveFinanceFromHint(rows, hint, id);
    if (resolved.status === 'found') return resolved.item;
    if (resolved.status === 'ambiguous') {
      throw new AutomationApiError([
        'Encontrei mais de um item parecido. Qual deles é?',
        '',
        ...resolved.matches.slice(0, 8).map(financeLine)
      ].join('\n'), { code: 'NEEDS_FINANCE_CLARIFICATION', statusCode: 409, details: { matches: resolved.matches.map(serializePublicFinance) } });
    }
    throw new AutomationApiError('Não encontrei essa finança mensal nesse período. Me manda o nome ou o código dela, tipo *#3*.', {
      code: 'MONTHLY_FINANCE_NOT_FOUND',
      statusCode: 404
    });
  }

  function markMonthlyFinancePaid(payload = {}, meta = {}, paid = true) {
    return withHandling(payload, meta, paid ? 'monthly_finance.mark_paid' : 'monthly_finance.mark_unpaid', (resolved) => {
      const target = resolveFinanceTarget(resolved.user.id, payload);
      assertMonthOpen(resolved.user.id, target.month, target.year);
      return executeIdempotentWrite({
        userId: resolved.user.id,
        phoneE164: resolved.phone.e164,
        channel: payload.source?.channel || payload.channel || 'whatsapp',
        idempotencyKey: meta.idempotencyKey,
        operation: paid ? 'monthly_finance.mark_paid' : 'monthly_finance.mark_unpaid',
        hashPayload: { financeId: target.id, paid },
        fn: () => {
          const finance = repository.setFinancePaid(resolved.user.id, target.id, paid);
          const text = paid
            ? `✅ *Conta marcada como paga!*\n\n${financeLine(finance)}\n\nUma pendência a menos para ocupar a cabeça. 🧠✨`
            : `↩️ *Conta voltou para aberta!*\n\n${financeLine(finance)}\n\nEla voltou para o radar do mês.`;
          return makeResult({
            ok: true,
            code: paid ? 'MONTHLY_FINANCE_MARKED_PAID' : 'MONTHLY_FINANCE_MARKED_UNPAID',
            finance: serializePublicFinance(finance),
            whatsapp: { text }
          });
        }
      });
    });
  }

  function normalizeUpdatePatch(payload = {}) {
    const raw = payload.patch || payload.finance || payload.monthly_finance || payload;
    const patch = {};
    if (Object.prototype.hasOwnProperty.call(raw, 'description') || Object.prototype.hasOwnProperty.call(raw, 'title')) patch.description = sanitizeDescription(raw.description || raw.title);
    if (Object.prototype.hasOwnProperty.call(raw, 'amount_cents') || Object.prototype.hasOwnProperty.call(raw, 'amount')) patch.amountCents = parseMoneyCents(raw.amount_cents ?? raw.amount, 0);
    if (Object.prototype.hasOwnProperty.call(raw, 'day_of_month') || Object.prototype.hasOwnProperty.call(raw, 'due_day')) patch.dayOfMonth = normalizeDay(raw.day_of_month || raw.due_day || raw.day);
    if (Object.prototype.hasOwnProperty.call(raw, 'type')) patch.type = normalizeFinanceType(raw.type);
    if (Object.prototype.hasOwnProperty.call(raw, 'amount_mode')) patch.amountMode = normalizeAmountMode(raw.amount_mode);
    if (Object.prototype.hasOwnProperty.call(raw, 'schedule_kind')) patch.scheduleKind = normalizeScheduleKind(raw.schedule_kind, raw.type || 'expense');
    if (Array.isArray(raw.items)) patch.items = sanitizeItems(raw.items, {});
    return patch;
  }

  function prepareOrApplyMutation(payload = {}, meta = {}, action) {
    return withHandling(payload, meta, `monthly_finance.${action}`, (resolved) => {
      const target = resolveFinanceTarget(resolved.user.id, payload);
      assertMonthOpen(resolved.user.id, target.month, target.year);
      const source = payload.source || { channel: payload.channel || 'whatsapp' };
      const patch = action === 'update' ? normalizeUpdatePatch(payload) : {};
      if (action === 'update' && !Object.keys(patch).length) {
        throw new AutomationApiError('Não encontrei o que deve mudar nessa finança mensal.', { code: 'MISSING_UPDATE_PATCH', statusCode: 400 });
      }
      if (payload.confirmed !== true) {
        const conversation = createConversationForConfirmation({
          resolved,
          action,
          source,
          payload: { finance_id: target.id, patch }
        });
        const summary = action === 'delete'
          ? `apagar *${target.description}* (${formatBRLFromCents(target.amount_cents)})`
          : `alterar *${target.description}*`;
        return makeResult({
          ok: false,
          code: 'NEEDS_MONTHLY_FINANCE_CONFIRMATION',
          conversation: { id: Number(conversation.id || 0), state: conversation.state, expires_at: conversation.expires_at },
          finance: serializePublicFinance(target),
          whatsapp: { text: `⚠️ *Confirmar alteração?*\n\nVou ${summary} em *${periodLabel(target.month, target.year)}*.\n\nResponde *confirmar* para aplicar ou *cancelar* para não mexer.` }
        }, 202);
      }
      return applyConfirmedMutation(resolved, action, { finance_id: target.id, patch, source }, meta);
    });
  }

  function applyConfirmedMutation(resolved, action, storedPayload = {}, meta = {}) {
    if (action === 'create') {
      return createFinanceNow(resolved, storedPayload, meta, storedPayload.source || {});
    }
    const financeId = Number(storedPayload.finance_id || storedPayload.financeId || 0);
    const current = repository.serializeFinance(resolved.user.id, financeId);
    if (!current) throw new AutomationApiError('Não encontrei essa finança mensal para confirmar.', { code: 'MONTHLY_FINANCE_NOT_FOUND', statusCode: 404 });
    assertMonthOpen(resolved.user.id, current.month, current.year);
    return executeIdempotentWrite({
      userId: resolved.user.id,
      phoneE164: resolved.phone.e164,
      channel: storedPayload.source?.channel || 'whatsapp',
      idempotencyKey: meta.idempotencyKey,
      operation: `monthly_finance.${action}.confirm`,
      hashPayload: { action, financeId, patch: storedPayload.patch || {} },
      fn: () => {
        if (action === 'delete') {
          repository.deleteFinance(resolved.user.id, financeId);
          return makeResult({
            ok: true,
            code: 'MONTHLY_FINANCE_DELETED',
            finance: serializePublicFinance(current),
            whatsapp: { text: `🗑️ *Finança mensal removida!*\n\n${current.description} saiu de *${periodLabel(current.month, current.year)}*.` }
          });
        }
        if (action === 'update') {
          const updated = repository.updateFinance(resolved.user.id, financeId, storedPayload.patch || {});
          return makeResult({
            ok: true,
            code: 'MONTHLY_FINANCE_UPDATED',
            finance: serializePublicFinance(updated),
            whatsapp: { text: `✅ *Finança mensal atualizada!*\n\n${financeLine(updated)}\n\nA planilha mental pode tirar folga. 😉` }
          });
        }
        throw new AutomationApiError('Não reconheci essa confirmação de finanças mensais.', { code: 'UNKNOWN_MONTHLY_FINANCE_ACTION', statusCode: 400 });
      }
    });
  }

  function handleConversationReply(payload = {}, meta = {}) {
    return withHandling(payload, meta, 'monthly_finance.conversation_reply', (resolved) => {
      const conversation = repository.getOpenConversationByPhone(resolved.phone.e164);
      if (!conversation || conversation.state !== 'awaiting_monthly_finance_action_confirmation') {
        throw new AutomationApiError('Não achei uma confirmação pendente de finanças mensais por aqui.', { code: 'NO_PENDING_MONTHLY_FINANCE_CONVERSATION', statusCode: 404 });
      }
      const text = payload.reply?.raw_text || payload.raw_text || payload.source?.raw_text || payload.message || '';
      if (isNegative(text)) {
        repository.resolveConversationState(conversation.id);
        return makeResult({
          ok: true,
          code: 'MONTHLY_FINANCE_ACTION_CANCELLED',
          whatsapp: { text: 'Combinado, não mexi nessa finança mensal. Zero bagunça no orçamento. ✅' }
        });
      }
      if (!isAffirmative(text)) {
        return makeResult({
          ok: false,
          code: 'NEEDS_MONTHLY_FINANCE_CONFIRMATION',
          whatsapp: { text: 'Só para confirmar sem susto: responde *confirmar* para aplicar ou *cancelar* para não mexer.' }
        }, 202);
      }
      const data = repository.getConversationPayload(conversation) || {};
      const action = data.action;
      const stored = data.payload || {};
      stored.source = data.source || payload.source || { channel: 'whatsapp' };
      const result = action === 'create'
        ? createFinanceNow(resolved, stored, meta, stored.source || {})
        : applyConfirmedMutation(resolved, action, stored, meta);
      repository.resolveConversationState(conversation.id);
      return result;
    });
  }

  return {
    createMonthlyFinance,
    searchMonthlyFinances,
    markMonthlyFinancePaid,
    markMonthlyFinanceUnpaid(payload, meta) {
      return markMonthlyFinancePaid(payload, meta, false);
    },
    updateMonthlyFinance(payload, meta) {
      return prepareOrApplyMutation(payload, meta, 'update');
    },
    deleteMonthlyFinance(payload, meta) {
      return prepareOrApplyMutation(payload, meta, 'delete');
    },
    handleConversationReply
  };
}

module.exports = {
  createAutomationMonthlyFinancesService
};
