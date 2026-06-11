const crypto = require('crypto');
const { createAutomationIntelligenceRepository, normalizeText } = require('../repositories/automationIntelligence.repository');
const { AutomationApiError, normalizeAutomationPhone } = require('./automationApi.service');
const { formatBRLFromCents } = require('../utils');

const MONTH_NAMES = [
  '', 'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'
];

function makeResult(payload = {}, statusCode = 200) {
  return { statusCode, ...payload };
}

function requestHash(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload || {})).digest('hex');
}

function currentSaoPauloDate() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
}

function currentSaoPauloDateTimeParts() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short'
  }).formatToParts(new Date()).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {});
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour || 0),
    weekday: parts.weekday || ''
  };
}

function parseIsoDate(value) {
  const raw = String(value || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '';
  const date = new Date(`${raw}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? '' : raw;
}

function addMonths(year, month, delta) {
  const d = new Date(Date.UTC(Number(year || 0), Number(month || 1) - 1 + Number(delta || 0), 1));
  return { month: d.getUTCMonth() + 1, year: d.getUTCFullYear() };
}

function resolvePeriod(input = {}) {
  const today = currentSaoPauloDate();
  const [todayYear, todayMonth] = today.split('-').map(Number);
  const rawPeriod = normalizeText(input.period || input.when || input.periodo || '');
  if (['last month', 'previous month', 'mes passado', 'mês passado'].map(normalizeText).includes(rawPeriod)) return addMonths(todayYear, todayMonth, -1);
  if (['next month', 'proximo mes', 'próximo mês'].map(normalizeText).includes(rawPeriod)) return addMonths(todayYear, todayMonth, 1);
  const month = Number(input.month || input.due_month || input.mes || 0);
  const year = Number(input.year || input.due_year || input.ano || 0);
  if (month >= 1 && month <= 12 && year >= 2000 && year <= 2100) return { month, year };
  return { month: todayMonth, year: todayYear };
}

function periodLabel(month, year) {
  return `${MONTH_NAMES[Number(month || 0)] || String(month).padStart(2, '0')}/${year}`;
}

function formatDateBR(value) {
  const raw = parseIsoDate(value);
  if (!raw) return '';
  return `${raw.slice(8, 10)}/${raw.slice(5, 7)}/${raw.slice(0, 4)}`;
}

function isoDateFromUtcDate(date) {
  return date.toISOString().slice(0, 10);
}

function resolveWeek(input = {}) {
  const rawStart = parseIsoDate(input.start_date || input.startDate || input.from);
  const rawEnd = parseIsoDate(input.end_date || input.endDate || input.to);
  if (rawStart && rawEnd) return { startDate: rawStart, endDate: rawEnd };
  const todayRaw = parseIsoDate(input.date) || currentSaoPauloDate();
  const date = new Date(`${todayRaw}T12:00:00Z`);
  const day = date.getUTCDay() || 7;
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - day + 1);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return { startDate: isoDateFromUtcDate(monday), endDate: isoDateFromUtcDate(sunday) };
}

function isAffirmative(value) {
  const text = normalizeText(value);
  return /^(sim|s|confirmar|confirmo|confirma|ok|pode|pode sim|isso|isso mesmo|salvar|aplicar|criar regra|pode criar|ativar)$/i.test(text)
    || text.includes('pode salvar')
    || text.includes('pode aplicar')
    || text.includes('criar regra')
    || text.includes('confirmo');
}

function isNegative(value) {
  const text = normalizeText(value);
  return /^(nao|não|n|cancelar|cancela|deixa|deixa pra la|deixa para la|voltar)$/i.test(text)
    || text.includes('nao quero')
    || text.includes('não quero')
    || text.includes('cancela');
}

function sanitizeText(value, fallback = '') {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, 180) : fallback;
}

function summarizeRows(rows = [], mapper, emptyLine = 'Nada encontrado por aqui.') {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  if (!list.length) return [emptyLine];
  return list.map(mapper);
}

function percentDelta(current, previous) {
  const c = Number(current || 0);
  const p = Number(previous || 0);
  if (!p && !c) return 'sem movimento';
  if (!p) return 'novo gasto no radar';
  const delta = ((c - p) / Math.abs(p)) * 100;
  const sign = delta >= 0 ? '+' : '';
  return `${sign}${Math.round(delta)}% vs. mês anterior`;
}

function serializeCategory(row = {}) {
  return {
    id: Number(row.id || 0),
    name: row.name || 'Categoria',
    active: Number(row.active ?? 1) !== 0,
    kind: row.kind || 'default'
  };
}

function serializePurchase(row = {}) {
  return {
    id: Number(row.id || 0),
    description: row.description || 'Compra',
    amount_cents: Number(row.amount_cents || 0),
    card_id: Number(row.card_id || 0) || null,
    card_name: row.card_name || null,
    txn_date: row.txn_date || null,
    due_month: Number(row.due_month || 0) || null,
    due_year: Number(row.due_year || 0) || null,
    installments: Number(row.installments || 1) || 1,
    purchase_category_id: Number(row.purchase_category_id || 0) || null,
    category_name: row.category_name || null
  };
}

function purchaseLine(row = {}) {
  const date = row.txn_date ? ` · ${formatDateBR(row.txn_date)}` : '';
  const card = row.card_name ? ` · ${row.card_name}` : '';
  const category = row.category_name ? ` · ${row.category_name}` : ' · sem categoria';
  return `#${row.id} — ${row.description}: *${formatBRLFromCents(row.amount_cents)}*${card}${date}${category}`;
}

function createAutomationIntelligenceService(deps = {}) {
  const repository = deps.intelligenceAutomationRepository || createAutomationIntelligenceRepository();

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
        code: error.code || 'INTELLIGENCE_VALIDATION_ERROR',
        message: error.message,
        details: error.details || null,
        whatsapp: { text: error.message }
      }, error.statusCode || 400);
    }
    return makeResult({
      ok: false,
      code: 'INTELLIGENCE_INTERNAL_ERROR',
      message: 'A inteligência financeira tropeçou por aqui. Tenta de novo em instantes.',
      whatsapp: { text: 'A inteligência financeira tropeçou por aqui. Tenta de novo em instantes.' }
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

  function executeIdempotentWrite({ userId, channel = 'whatsapp', idempotencyKey, operation, hashPayload, fn }) {
    const key = String(idempotencyKey || '').trim();
    if (!key) {
      throw new AutomationApiError('Idempotency-Key é obrigatório para alterações de categoria pelo WhatsApp.', {
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
      throw new AutomationApiError('Essa alteração já está em processamento. Não dupliquei a ação.', {
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
      return response;
    }
  }

  function resolveCategory(userId, payload = {}, options = {}) {
    const categoryId = Number(payload.category_id || payload.categoryId || 0) || 0;
    if (categoryId) {
      const category = repository.getPurchaseCategoryById(userId, categoryId);
      if (!category || Number(category.active || 0) === 0) {
        throw new AutomationApiError('Essa categoria não existe ou está desativada no AcerttaPay.', { code: 'CATEGORY_NOT_FOUND', statusCode: 404 });
      }
      return category;
    }
    const name = sanitizeText(payload.category_hint || payload.categoryHint || payload.category_name || payload.categoryName || payload.category || '', '');
    if (!name) {
      throw new AutomationApiError('Me diz qual categoria devo usar.', { code: 'CATEGORY_REQUIRED', statusCode: 400 });
    }
    const normalized = normalizeText(name);
    let category = repository.getPurchaseCategoryByNormalizedName(userId, normalized);
    if (!category && options.createIfMissing) category = repository.getOrCreatePurchaseCategory(userId, name);
    if (!category || Number(category.active || 0) === 0) {
      throw new AutomationApiError(`Não encontrei a categoria "${name}". Você pode escolher uma das categorias existentes ou criar pelo app.`, {
        code: 'CATEGORY_NOT_FOUND',
        statusCode: 404,
        details: { category: name }
      });
    }
    return category;
  }

  function assertScopeOpen(userId, rows = []) {
    for (const row of rows) {
      if (repository.isMonthClosed(userId, row.due_month, row.due_year)) {
        throw new AutomationApiError(`A fatura ${periodLabel(row.due_month, row.due_year)} já está fechada. Não mexi nessa categoria para não bagunçar o que foi pago.`, {
          code: 'MONTH_CLOSED',
          statusCode: 423,
          details: { month: row.due_month, year: row.due_year }
        });
      }
    }
  }

  function resolvePurchase(userId, payload = {}) {
    const purchaseId = Number(payload.purchase_id || payload.purchaseId || payload.transaction_id || payload.transactionId || 0) || 0;
    if (purchaseId) {
      const rows = repository.getPurchaseScope(userId, purchaseId);
      if (!rows.length) throw new AutomationApiError('Não encontrei essa compra no AcerttaPay.', { code: 'PURCHASE_NOT_FOUND', statusCode: 404 });
      return { rows, purchase: serializePurchase(rows[0]) };
    }
    const recent = repository.findRecentPurchases(userId, {
      limit: 5,
      text: payload.purchase_hint || payload.purchaseHint || payload.description || payload.merchant || '',
      month: payload.month,
      year: payload.year,
      cardId: payload.card_id || payload.cardId
    });
    if (!recent.length) {
      throw new AutomationApiError('Não achei uma compra recente com essa pista. Me manda o código da compra, tipo #123.', { code: 'PURCHASE_NOT_FOUND', statusCode: 404 });
    }
    if ((payload.purchase_hint || payload.description || payload.merchant) && recent.length > 1) {
      return { ambiguous: true, matches: recent.map(serializePurchase) };
    }
    const rows = repository.getPurchaseScope(userId, recent[0].id);
    return { rows, purchase: serializePurchase(rows[0] || recent[0]) };
  }

  function buildCategoryOptionsText(categories = [], rules = []) {
    const lines = ['🏷️ *Categorias disponíveis*', ''];
    if (!categories.length) lines.push('Ainda não achei categorias ativas para sua conta.');
    categories.slice(0, 30).forEach((category, index) => {
      lines.push(`${index + 1}. ${category.name}`);
    });
    if (rules.length) {
      lines.push('', '🧠 *Regras aprendidas*');
      rules.slice(0, 8).forEach((rule) => lines.push(`• ${rule.merchant_label} → ${rule.category_name || 'categoria'}`));
    }
    lines.push('', 'Pode dizer algo como: *essa compra da Amazon é Casa* ou *sempre classifique iFood como Alimentação*.' );
    return lines.join('\n');
  }

  function categoryOptions(payload = {}, meta = {}) {
    return withHandling(payload, meta, 'category.options', (resolved) => {
      const categories = repository.listPurchaseCategories(resolved.user.id).map(serializeCategory);
      const rules = repository.listMerchantCategoryRules(resolved.user.id, { limit: 10 });
      return makeResult({
        ok: true,
        code: 'CATEGORY_OPTIONS',
        categories,
        rules,
        whatsapp: { text: buildCategoryOptionsText(categories, rules) }
      });
    });
  }

  function uncategorizedPurchases(payload = {}, meta = {}) {
    return withHandling(payload, meta, 'category.uncategorized', (resolved) => {
      const period = resolvePeriod(payload.query || payload);
      const rows = repository.listUncategorizedPurchases(resolved.user.id, { month: period.month, year: period.year, limit: payload.limit || 12 });
      const lines = [`🏷️ *Compras sem categoria — ${periodLabel(period.month, period.year)}*`, ''];
      if (!rows.length) {
        lines.push('Tudo categorizado por aqui. Organização que dá gosto. ✅');
      } else {
        rows.forEach((row) => lines.push(purchaseLine(row)));
        lines.push('', 'Para arrumar uma, responda algo como: *compra #123 é Alimentação*.' );
      }
      return makeResult({
        ok: true,
        code: 'UNCATEGORIZED_PURCHASES',
        period,
        purchases: rows.map(serializePurchase),
        whatsapp: { text: lines.join('\n') }
      });
    });
  }

  function applyCategoryToPurchase(payload = {}, meta = {}) {
    return withHandling(payload, meta, 'category.apply_to_purchase', (resolved) => {
      return executeIdempotentWrite({
        userId: resolved.user.id,
        channel: payload.source?.channel || payload.channel || 'whatsapp',
        idempotencyKey: meta.idempotencyKey || payload.idempotency_key,
        operation: 'category.apply_to_purchase',
        hashPayload: payload,
        fn: () => {
          const category = resolveCategory(resolved.user.id, payload, { createIfMissing: payload.create_category === true || payload.createCategory === true });
          const purchaseResolution = resolvePurchase(resolved.user.id, payload);
          if (purchaseResolution.ambiguous) {
            return makeResult({
              ok: false,
              code: 'PURCHASE_AMBIGUOUS',
              matches: purchaseResolution.matches,
              whatsapp: {
                text: [
                  'Achei mais de uma compra parecida. Me manda o código da que você quer categorizar:',
                  '',
                  ...purchaseResolution.matches.slice(0, 5).map(purchaseLine)
                ].join('\n')
              }
            }, 409);
          }
          const rows = purchaseResolution.rows;
          assertScopeOpen(resolved.user.id, rows);
          const before = rows.map(serializePurchase);
          const ids = rows.map((row) => row.id);
          const updatedCount = repository.updatePurchaseCategory(resolved.user.id, ids, category.id);
          const afterRows = repository.getPurchaseScope(resolved.user.id, rows[0].id).map(serializePurchase);
          repository.insertAutomationMutationEvent({
            userId: resolved.user.id,
            phoneE164: resolved.phone.e164,
            operation: 'category.apply_to_purchase',
            entityType: 'transaction',
            entityId: rows[0].id,
            before,
            after: afterRows,
            sourceMessageId: payload.source?.message_id || payload.message_id || null
          });
          repository.createLocalNotification(
            resolved.user.id,
            'Categoria ajustada pelo WhatsApp',
            `${rows[0].description} agora está em ${category.name}.`,
            `/detalhamento/${rows[0].due_year}/${rows[0].due_month}`,
            rows[0].id
          );
          return makeResult({
            ok: true,
            code: 'PURCHASE_CATEGORY_APPLIED',
            category: serializeCategory(category),
            purchase: serializePurchase(afterRows[0] || rows[0]),
            updated_count: updatedCount,
            whatsapp: {
              text: [
                '🏷️ *Categoria aplicada!*',
                '',
                `🧾 Compra: *${rows[0].description}*`,
                `💰 Valor: *${formatBRLFromCents(rows.reduce((sum, row) => sum + Number(row.amount_cents || 0), 0))}*`,
                `🏷️ Categoria: *${category.name}*`,
                rows.length > 1 ? `🔢 Parcelas atualizadas: *${rows.length}*` : '',
                '',
                'A compra saiu da gaveta dos “sem categoria”. 😉'
              ].filter(Boolean).join('\n')
            }
          });
        }
      });
    });
  }

  function createRuleNow(resolved, ruleInput, meta = {}) {
    return executeIdempotentWrite({
      userId: resolved.user.id,
      channel: ruleInput.source?.channel || 'whatsapp',
      idempotencyKey: meta.idempotencyKey || ruleInput.idempotency_key,
      operation: 'category.create_merchant_rule',
      hashPayload: ruleInput,
      fn: () => {
        const category = resolveCategory(resolved.user.id, ruleInput, { createIfMissing: ruleInput.create_category === true || ruleInput.createCategory === true });
        const merchantLabel = sanitizeText(ruleInput.merchant_label || ruleInput.merchantLabel || ruleInput.merchant_hint || ruleInput.merchantHint || ruleInput.pattern, 'estabelecimento');
        const pattern = sanitizeText(ruleInput.normalized_pattern || ruleInput.pattern || merchantLabel, merchantLabel);
        const rule = repository.upsertMerchantCategoryRule({
          userId: resolved.user.id,
          pattern,
          merchantLabel,
          categoryId: category.id,
          categoryName: category.name,
          source: ruleInput.source?.channel || 'whatsapp'
        });
        const applyExisting = ruleInput.apply_existing === true || ruleInput.applyExisting === true;
        const applied = applyExisting ? repository.applyMerchantRuleToExisting(resolved.user.id, rule.id, { limit: 300 }) : { count: 0 };
        repository.insertAutomationMutationEvent({
          userId: resolved.user.id,
          phoneE164: resolved.phone.e164,
          operation: 'category.create_merchant_rule',
          entityType: 'automation_merchant_category_rule',
          entityId: rule.id,
          before: null,
          after: { rule, applied_count: applied.count },
          sourceMessageId: ruleInput.source?.message_id || null
        });
        return makeResult({
          ok: true,
          code: 'MERCHANT_CATEGORY_RULE_CREATED',
          rule,
          applied_existing_count: applied.count,
          whatsapp: {
            text: [
              '🧠 *Aprendizado salvo!*',
              '',
              `Quando aparecer *${merchantLabel}*, vou sugerir/aplicar *${category.name}*.`,
              applied.count ? `Também atualizei *${applied.count}* compra(s) antigas sem categoria.` : 'Compras antigas não foram mexidas agora.',
              '',
              'A memória financeira está ficando musculosa. 💪'
            ].join('\n')
          }
        });
      }
    });
  }

  function createMerchantRule(payload = {}, meta = {}) {
    return withHandling(payload, meta, 'category.create_merchant_rule', (resolved) => {
      const ruleInput = {
        ...payload,
        source: payload.source || { channel: payload.channel || 'whatsapp' }
      };
      if (!sanitizeText(ruleInput.merchant_label || ruleInput.merchantLabel || ruleInput.merchant_hint || ruleInput.merchantHint || ruleInput.pattern, '')) {
        throw new AutomationApiError('Me diz qual estabelecimento devo aprender.', { code: 'MERCHANT_REQUIRED', statusCode: 400 });
      }
      resolveCategory(resolved.user.id, ruleInput, { createIfMissing: ruleInput.create_category === true || ruleInput.createCategory === true });
      if (payload.confirmed !== true) {
        const conversation = repository.createConversationState({
          userId: resolved.user.id,
          phoneE164: resolved.phone.e164,
          channel: ruleInput.source?.channel || 'whatsapp',
          state: 'awaiting_category_learning_confirmation',
          relatedPurchaseId: null,
          payload: { domain: 'intelligence', action: 'create_merchant_rule', payload: ruleInput }
        });
        const categoryName = ruleInput.category_hint || ruleInput.category_name || ruleInput.category || `#${ruleInput.category_id}`;
        return makeResult({
          ok: false,
          code: 'NEEDS_CATEGORY_RULE_CONFIRMATION',
          conversation: { id: conversation.id, state: conversation.state, expires_at: conversation.expires_at },
          whatsapp: {
            text: [
              '🧠 *Criar regra de categoria?*',
              '',
              `Estabelecimento: *${sanitizeText(ruleInput.merchant_label || ruleInput.merchant_hint || ruleInput.pattern)}*`,
              `Categoria: *${categoryName}*`,
              '',
              'Essa regra vale para próximas compras parecidas.',
              'Responde *confirmar* para criar ou *cancelar* para deixar sem regra.'
            ].join('\n')
          }
        }, 202);
      }
      return createRuleNow(resolved, ruleInput, meta);
    });
  }

  function categoryConversationReply(payload = {}, meta = {}) {
    return withHandling(payload, meta, 'category.conversation_reply', (resolved) => {
      const conversation = repository.getOpenConversationByPhone(resolved.phone.e164);
      if (!conversation || conversation.state !== 'awaiting_category_learning_confirmation') {
        throw new AutomationApiError('Não achei uma regra de categoria esperando confirmação.', { code: 'NO_PENDING_CATEGORY_CONVERSATION', statusCode: 404 });
      }
      const text = payload.reply?.raw_text || payload.raw_text || payload.source?.raw_text || payload.message || '';
      if (isNegative(text)) {
        repository.resolveConversationState(conversation.id);
        return makeResult({
          ok: true,
          code: 'CATEGORY_RULE_CANCELLED',
          whatsapp: { text: 'Combinado, não criei a regra. A categoria fica sem pressa e sem bagunça. ✅' }
        });
      }
      if (!isAffirmative(text)) {
        return makeResult({
          ok: false,
          code: 'NEEDS_CATEGORY_RULE_CONFIRMATION',
          whatsapp: { text: 'Só para não ensinar errado: responde *confirmar* para criar a regra ou *cancelar* para não mexer.' }
        }, 202);
      }
      const data = repository.getConversationPayload(conversation) || {};
      const stored = data.payload || {};
      stored.source = stored.source || data.source || payload.source || { channel: 'whatsapp' };
      const result = createRuleNow(resolved, stored, meta);
      repository.resolveConversationState(conversation.id);
      return result;
    });
  }

  function buildMonthlyInsightText({ month, year, totals, previousTotals, categories, merchants, cards }) {
    const total = Number(totals?.total_cents || 0);
    const previous = Number(previousTotals?.total_cents || 0);
    const lines = [
      `📊 *Resumo inteligente — ${periodLabel(month, year)}*`,
      '',
      `💳 Total em compras: *${formatBRLFromCents(total)}*`,
      `🧭 Tendência: *${percentDelta(total, previous)}*`,
      `🧾 Compras: *${Number(totals?.purchase_count || 0)}*`,
      `🏷️ Sem categoria: *${Number(totals?.uncategorized_count || 0)}*`,
      ''
    ];
    lines.push('🏷️ *Top categorias*');
    lines.push(...summarizeRows(categories.slice(0, 5), (row) => `• ${row.category_name}: *${formatBRLFromCents(row.total_cents)}* · ${row.purchase_count} compra(s)`, 'Sem categorias suficientes ainda.'));
    lines.push('', '🏬 *Maiores estabelecimentos*');
    lines.push(...summarizeRows(merchants.slice(0, 5), (row) => `• ${row.merchant_label}: *${formatBRLFromCents(row.total_cents)}* · ${row.purchase_count} compra(s)`, 'Sem estabelecimentos suficientes ainda.'));
    lines.push('', '💳 *Por cartão*');
    lines.push(...summarizeRows(cards.slice(0, 5), (row) => `• ${row.card_name}: *${formatBRLFromCents(row.total_cents)}*`, 'Sem compras por cartão nesse período.'));
    if (Number(totals?.uncategorized_count || 0) > 0) {
      lines.push('', `Tem *${Number(totals.uncategorized_count)}* compra(s) sem categoria. Posso te mostrar com *compras sem categoria*.`);
    }
    return lines.join('\n');
  }

  function monthlyInsights(payload = {}, meta = {}) {
    return withHandling(payload, meta, 'insights.monthly', (resolved) => {
      const period = resolvePeriod(payload.query || payload);
      const previous = addMonths(period.year, period.month, -1);
      const totals = repository.getTotalsByMonth(resolved.user.id, period.month, period.year) || {};
      const previousTotals = repository.getTotalsByMonth(resolved.user.id, previous.month, previous.year) || {};
      const categories = repository.getCategorySpending(resolved.user.id, period.month, period.year, { limit: 10 });
      const merchants = repository.getMerchantSpending(resolved.user.id, period.month, period.year, { limit: 8 });
      const cards = repository.getCardSpending(resolved.user.id, period.month, period.year);
      return makeResult({
        ok: true,
        code: 'MONTHLY_INTELLIGENT_SUMMARY',
        period,
        totals,
        previous_totals: previousTotals,
        categories,
        merchants,
        cards,
        whatsapp: { text: buildMonthlyInsightText({ month: period.month, year: period.year, totals, previousTotals, categories, merchants, cards }) }
      });
    });
  }

  function weeklyInsights(payload = {}, meta = {}) {
    return withHandling(payload, meta, 'insights.weekly', (resolved) => {
      const week = resolveWeek(payload.query || payload);
      const totals = repository.getWeeklyTotals(resolved.user.id, week.startDate, week.endDate) || {};
      const rows = repository.getWeeklyTransactions(resolved.user.id, week.startDate, week.endDate, { limit: payload.limit || 10 });
      const lines = [
        `📆 *Resumo da semana*`,
        `${formatDateBR(week.startDate)} a ${formatDateBR(week.endDate)}`,
        '',
        `💳 Total: *${formatBRLFromCents(totals.total_cents)}*`,
        `🧾 Compras: *${Number(totals.purchase_count || 0)}*`,
        `🏷️ Sem categoria: *${Number(totals.uncategorized_count || 0)}*`,
        '',
        '🧾 *Últimas compras da semana*'
      ];
      lines.push(...summarizeRows(rows.slice(0, 8), (row) => `• ${formatDateBR(row.txn_date)} · ${row.description}: *${formatBRLFromCents(row.amount_cents)}*${row.category_name ? ` · ${row.category_name}` : ''}`, 'Semana quietinha por aqui. O cartão agradece. 😄'));
      return makeResult({
        ok: true,
        code: 'WEEKLY_INTELLIGENT_SUMMARY',
        week,
        totals,
        purchases: rows.map(serializePurchase),
        whatsapp: { text: lines.join('\n') }
      });
    });
  }

  function sendSummary(payload = {}, meta = {}) {
    const kind = String(payload.summary_kind || payload.summaryKind || payload.kind || 'monthly').trim().toLowerCase();
    if (kind === 'weekly' || kind === 'week') return weeklyInsights(payload, meta);
    return monthlyInsights(payload, meta);
  }

  function summaryPreferences(payload = {}, meta = {}) {
    return withHandling(payload, meta, 'insights.summary_preferences', (resolved) => {
      const kind = String(payload.summary_kind || payload.summaryKind || payload.kind || 'weekly').trim().toLowerCase() === 'monthly' ? 'monthly' : 'weekly';
      const enabled = payload.enabled !== false && !['off', '0', 'false', 'desativar', 'desligar'].includes(String(payload.enabled || '').toLowerCase());
      const preference = repository.upsertSummaryPreference({
        userId: resolved.user.id,
        phoneE164: resolved.phone.e164,
        whatsappNumber: resolved.phone.whatsappNumber,
        summaryKind: kind,
        enabled,
        scheduleDay: Number(payload.schedule_day || payload.scheduleDay || (kind === 'weekly' ? 1 : 1)) || 1,
        scheduleHour: Number(payload.schedule_hour || payload.scheduleHour || 9) || 9,
        timezone: payload.timezone || 'America/Sao_Paulo'
      });
      return makeResult({
        ok: true,
        code: enabled ? 'SMART_SUMMARY_OPT_IN_SAVED' : 'SMART_SUMMARY_OPT_OUT_SAVED',
        preference,
        whatsapp: {
          text: enabled
            ? `✅ Resumo *${kind === 'weekly' ? 'semanal' : 'mensal'}* ativado por WhatsApp. Vou mandar só nesse combinado, sem virar spam financeiro.`
            : `Combinado, resumo *${kind === 'weekly' ? 'semanal' : 'mensal'}* automático desligado. Sem notificação surpresa por aqui. ✅`
        }
      });
    });
  }

  function dueSummaries(payload = {}, meta = {}) {
    try {
      assertApiEnabled();
      if (!repository.getBooleanSetting('AUTOMATION_SMART_SUMMARIES_ENABLED', true)) {
        return makeResult({ ok: true, code: 'SMART_SUMMARIES_DISABLED', summaries: [] });
      }
      const query = payload.query || payload || {};
      const rows = repository.listDueSummaryPreferences({ summaryKind: query.summary_kind || query.summaryKind || '', limit: query.limit || 50 });
      const now = currentSaoPauloDateTimeParts();
      const due = rows.filter((row) => {
        const kind = String(row.summary_kind || 'weekly');
        const periodKey = kind === 'monthly'
          ? now.date.slice(0, 7)
          : `${resolveWeek({ date: now.date }).startDate}:${resolveWeek({ date: now.date }).endDate}`;
        if (String(row.last_sent_period || '') === periodKey) return false;
        if (Number(row.schedule_hour || 9) > now.hour) return false;
        if (kind === 'monthly') return Number(now.date.slice(8, 10)) >= Number(row.schedule_day || 1);
        const weekdayNumber = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[now.weekday] || 1;
        return weekdayNumber >= Number(row.schedule_day || 1);
      }).map((row) => ({
        preference_id: Number(row.id || 0),
        user_id: Number(row.user_id || 0),
        phone: row.authorized_whatsapp_number || String(row.authorized_phone_e164 || '').replace(/\D/g, ''),
        phone_e164: row.authorized_phone_e164 || row.phone_e164 || '',
        summary_kind: row.summary_kind,
        user_name: row.user_name || row.user_email || 'Usuário'
      }));
      return makeResult({ ok: true, code: 'DUE_SMART_SUMMARIES', summaries: due });
    } catch (error) {
      return handleServiceError(error);
    }
  }

  function markSummarySent(payload = {}, meta = {}) {
    try {
      assertApiEnabled();
      const preferenceId = Number(payload.preference_id || payload.preferenceId || 0);
      if (!preferenceId) throw new AutomationApiError('Preferência de resumo inválida.', { code: 'INVALID_SUMMARY_PREFERENCE', statusCode: 400 });
      const kind = String(payload.summary_kind || payload.summaryKind || 'weekly').trim().toLowerCase();
      const now = currentSaoPauloDate();
      const periodKey = payload.period_key || payload.periodKey || (kind === 'monthly' ? now.slice(0, 7) : `${resolveWeek({ date: now }).startDate}:${resolveWeek({ date: now }).endDate}`);
      repository.markSummarySent(preferenceId, periodKey);
      return makeResult({ ok: true, code: 'SMART_SUMMARY_MARKED_SENT', period_key: periodKey });
    } catch (error) {
      return handleServiceError(error);
    }
  }

  return {
    categoryOptions,
    uncategorizedPurchases,
    applyCategoryToPurchase,
    createMerchantRule,
    categoryConversationReply,
    monthlyInsights,
    weeklyInsights,
    sendSummary,
    summaryPreferences,
    dueSummaries,
    markSummarySent
  };
}

module.exports = {
  createAutomationIntelligenceService,
  resolvePeriod,
  resolveWeek
};
