const crypto = require('crypto');
const dayjs = require('dayjs');
const { createAutomationApiRepository } = require('../repositories/automationApi.repository');
const { createAutomationOperationsRepository } = require('../repositories/automationOperations.repository');
const { createPurchaseCreationService, PurchaseCreationError } = require('./purchaseCreation.service');
const { createAutomationReceiptPurchasesService } = require('./automationReceiptPurchases.service');
const { DEFAULT_PHONE_COUNTRY, normalizePhoneForWhatsapp } = require('../phone');
const { formatBRLFromCents } = require('../utils');

class AutomationApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'AutomationApiError';
    this.code = options.code || 'AUTOMATION_ERROR';
    this.statusCode = options.statusCode || 400;
    this.details = options.details || null;
  }
}

const rateLimitBuckets = new Map();
const keyRateLimitBuckets = new Map();
const workflowRateLimitBuckets = new Map();

function safeJsonParse(value, fallback = null) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch (error) {
    return fallback;
  }
}

function safeCompare(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function requestHash(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload || {})).digest('hex');
}

function normalizeDigits(value) {
  return String(value || '')
    .replace(/@s\.whatsapp\.net$/i, '')
    .replace(/@c\.us$/i, '')
    .replace(/\D/g, '');
}

function normalizeAutomationPhone(rawPhone, options = {}) {
  const fallbackCountry = options.fallbackCountry || DEFAULT_PHONE_COUNTRY;
  const raw = String(rawPhone || '').trim();
  if (!raw) {
    return { ok: false, reason: 'Telefone não informado.' };
  }

  const digits = normalizeDigits(raw);
  const candidate = raw.trim().startsWith('+')
    ? raw.trim()
    : (digits.startsWith('55') && digits.length >= 12 ? `+${digits}` : raw.trim());
  const normalized = normalizePhoneForWhatsapp(candidate, { fallbackCountry });
  if (!normalized.ok) {
    return { ok: false, reason: normalized.reason || 'Não consegui normalizar esse telefone.' };
  }
  return {
    ok: true,
    e164: normalized.e164,
    whatsappNumber: normalized.number,
    countryCode: normalized.countryCode || fallbackCountry
  };
}

function normalizeIntentText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}


const AUTOMATION_WHATSAPP_SIMPLE_WORKFLOWS = new Set(['1.1', '1.2', '1.3', '1.4', '2.1', '3.1', '5.1', '7.1']);
const PURCHASE_PERIOD_MONTH_NAMES = [
  '', 'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'
];
const PURCHASE_PERIOD_ALIASES = {
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

function currentSaoPauloParts() {
  const [year, month] = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }).split('-').map(Number);
  return { month, year };
}

function addPurchasePeriodMonths(year, month, delta) {
  const date = new Date(Date.UTC(Number(year || 0), Number(month || 1) - 1 + Number(delta || 0), 1));
  return { month: date.getUTCMonth() + 1, year: date.getUTCFullYear() };
}

function normalizePeriodText(value) {
  return normalizeIntentText(value)
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolvePurchasePeriodInput(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const today = currentSaoPauloParts();
  const month = Number(source.month || source.due_month || source.dueMonth || source.mes || 0) || 0;
  const year = Number(source.year || source.due_year || source.dueYear || source.ano || 0) || 0;
  if (month >= 1 && month <= 12) {
    return { month, year: year >= 2000 && year <= 2100 ? year : today.year, explicit: true };
  }

  const rawPeriod = normalizePeriodText(source.period || source.when || '');
  if (['last_month', 'last month', 'previous_month', 'previous month', 'mes passado', 'mês passado'].includes(rawPeriod)) return { ...addPurchasePeriodMonths(today.year, today.month, -1), explicit: true };
  if (['next_month', 'next month', 'proximo mes', 'próximo mês', 'mes que vem', 'mês que vem'].includes(rawPeriod)) return { ...addPurchasePeriodMonths(today.year, today.month, 1), explicit: true };

  const rawTextSource = [
    source.period,
    source.when,
    source.raw_text,
    source.text,
    source.message_text,
    source.query_text,
    source.source?.raw_text,
    source.source?.rawText,
    source.whatsapp?.message_text
  ].filter(Boolean).join(' ');
  const numericRaw = String(rawTextSource || '').match(/\b(0?[1-9]|1[0-2])\s*[\/\-]\s*(20\d{2}|21\d{2})\b/);
  if (numericRaw) return { month: Number(numericRaw[1]), year: Number(numericRaw[2]), explicit: true };

  const text = normalizePeriodText(rawTextSource);
  if (!text) return null;
  if (/\b(mes passado|fatura passada)\b/.test(text)) return { ...addPurchasePeriodMonths(today.year, today.month, -1), explicit: true };
  if (/\b(mes que vem|proximo mes|fatura que vem|proxima fatura)\b/.test(text)) return { ...addPurchasePeriodMonths(today.year, today.month, 1), explicit: true };
  if (/\b(este|esse|deste|desse|atual)\s+mes\b|\bmes\s+(atual|corrente)\b|\bfatura\s+(atual|desse mes|deste mes)\b/.test(text)) return { month: today.month, year: today.year, explicit: true };

  const numeric = text.match(/\b(0?[1-9]|1[0-2])(?:[\/\-]|\s+)(20\d{2}|21\d{2})\b/);
  if (numeric) return { month: Number(numeric[1]), year: Number(numeric[2]), explicit: true };

  for (const [alias, aliasMonth] of Object.entries(PURCHASE_PERIOD_ALIASES)) {
    const re = new RegExp(`\\b${alias}\\b`, 'i');
    if (!re.test(text)) continue;
    const yearMatch = text.match(/\b(20\d{2}|21\d{2})\b/);
    return { month: aliasMonth, year: yearMatch ? Number(yearMatch[1]) : today.year, explicit: true };
  }
  return null;
}

function purchasePeriodLabel(month, year) {
  const m = Number(month || 0);
  return `${PURCHASE_PERIOD_MONTH_NAMES[m] || String(m).padStart(2, '0')}/${year}`;
}

function purposeWantsParticipants(purpose = '') {
  const normalized = normalizeIntentText(purpose);
  return normalized.includes('participant') || normalized.includes('divid') || normalized.includes('rate');
}

function purposeWantsQuery(purpose = '') {
  const normalized = normalizeIntentText(purpose);
  return normalized.includes('query') || normalized.includes('consulta') || normalized.includes('list');
}

function monthQuestionForPurpose(purpose = '') {
  if (purposeWantsParticipants(purpose)) return 'Qual fatura/mês você quer olhar para dividir uma compra? Ex.: *junho*, *06/2026* ou *mês passado*.';
  if (purposeWantsQuery(purpose)) return 'Qual fatura/mês você quer listar? Ex.: *junho*, *06/2026* ou *mês passado*.';
  return 'Qual fatura/mês você quer olhar para corrigir ou apagar uma compra? Ex.: *junho*, *06/2026* ou *mês passado*.';
}

function periodStateForPurpose(purpose = '') {
  if (purposeWantsParticipants(purpose)) return 'awaiting_purchase_participants_period';
  if (purposeWantsQuery(purpose)) return 'awaiting_purchase_query_period';
  return 'awaiting_purchase_mutation_period';
}

function selectionStateForPurpose(purpose = '') {
  return purposeWantsParticipants(purpose) ? 'awaiting_purchase_selection_for_participants' : 'awaiting_purchase_selection_for_correction';
}

function detectPurchaseMutationAction(text = '') {
  const normalized = normalizeIntentText(text);
  if (/\b(apagar|apaga|excluir|exclui|deletar|deleta|remover|remove)\b/.test(normalized)) return 'delete';
  if (/\b(dividir|divide|ratear|rateia|participante|participantes)\b/.test(normalized)) return 'split';
  return 'edit';
}

function parsePurchaseSelectionFromText(text = '', purchases = []) {
  const normalized = normalizeIntentText(text);
  if (!normalized) return 0;
  const hashMatch = normalized.match(/#\s*(\d+)/);
  if (hashMatch) return Number(hashMatch[1]);
  const optionMatch = normalized.match(/(?:^|\b)(?:opcao|opção|numero|n|item)?\s*(\d{1,3})(?:\b|$)/);
  if (optionMatch) {
    const value = Number(optionMatch[1]);
    const byOption = (purchases || []).find((item) => Number(item.option || 0) === value);
    if (byOption) return Number(byOption.id || byOption.purchase_id || 0);
    const byId = (purchases || []).find((item) => Number(item.id || item.purchase_id || 0) === value);
    if (byId) return Number(byId.id || byId.purchase_id || 0);
  }
  return 0;
}

function parseSimpleEditPatchFromText(text = '') {
  const normalized = normalizeIntentText(text);
  const patch = {};
  if (/\b(valor|preco|preço|custou|era|corrige|corrigir|ajusta|ajustar)\b/.test(normalized)) {
    const moneyMatches = Array.from(normalized.matchAll(/(?:r\$\s*)?(\d{1,7})(?:[,.](\d{1,2}))?\s*(?:reais|real|rs)?/g));
    const moneyMatch = moneyMatches.length ? moneyMatches[moneyMatches.length - 1] : null;
    if (moneyMatch) {
      patch.amount_cents = Number(moneyMatch[1]) * 100 + Number(String(moneyMatch[2] || '').padEnd(2, '0') || 0);
    }
  }
  const installmentsMatch = normalized.match(/\b(?:em\s*)?(\d{1,2})\s*x\b|\bparcelas?\s*(?:para|em)?\s*(\d{1,2})\b/);
  if (installmentsMatch) patch.installments = Number(installmentsMatch[1] || installmentsMatch[2]);
  return patch;
}

function selectedPurchaseLabelFromRows(rows = []) {
  const root = rows[0] || {};
  const total = rows.reduce((sum, row) => sum + Number(row.amount_cents || 0), 0);
  return {
    description: stripInstallmentMarker(root.description || 'Compra'),
    amount_cents: total,
    card_name: root.card_name || 'cartão',
    installments: rows.length || 1
  };
}

function selectedPurchaseLabelFromListedPurchase(purchase = {}) {
  return {
    description: stripInstallmentMarker(purchase.description || purchase.merchant || 'Compra'),
    amount_cents: Number(purchase.amount_cents || purchase.amountCents || 0),
    card_name: purchase.card_name || purchase.cardName || 'cartão',
    installments: Number(purchase.installments || 1) || 1
  };
}

function findListedPurchaseById(purchases = [], purchaseId) {
  const id = Number(purchaseId || 0);
  if (!id) return null;
  return (Array.isArray(purchases) ? purchases : []).find((purchase) => Number(purchase.id || purchase.purchase_id || 0) === id) || null;
}

function compactAutomationText(value, limit = 320) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const safeLimit = Math.max(40, Number(limit || 320) || 320);
  return text.length > safeLimit ? `${text.slice(0, safeLimit)}...` : text;
}

function formatAutomationDateBR(value) {
  if (!value) return '';
  const parsed = dayjs(value);
  if (!parsed.isValid()) return '';
  return parsed.format('DD/MM/YYYY');
}

function formatAutomationPeriod(month, year) {
  const parsedMonth = Number(month || 0);
  const parsedYear = Number(year || 0);
  if (!parsedMonth || !parsedYear) return '';
  return `${String(parsedMonth).padStart(2, '0')}/${parsedYear}`;
}

function isAffirmativeText(value) {
  const text = normalizeIntentText(value);
  return /^(sim|s|quero|bora|pode|ok|claro|vamos|dividir|quero dividir|manda|isso|isso mesmo|correto|confere|confirmo|confirmar|confirma|confirmado|e esse|é esse|esse mesmo)$/i.test(text)
    || text.includes('confirmar')
    || text.includes('confirma')
    || text.includes('quero dividir')
    || text.includes('pode dividir')
    || text.includes('isso mesmo')
    || text.includes('esse mesmo')
    || text.includes('pode ser esse');
}

function isNegativeText(value) {
  const text = normalizeIntentText(value);
  return /^(nao|n|não|cancelar|cancela|cancelado|desistir|desisto|desisti|descartar|descarta|parar|para|sair|voltar|deixa|deixa assim|deixa pra la|deixa para la|esquece|nao quero|não quero|so eu|só eu|apenas eu|eu mesmo|outro|outro cartao|outro cartão)$/i.test(text)
    || text.includes('cancelar')
    || text.includes('cancela')
    || text.includes('desist')
    || text.includes('descart')
    || text.includes('deixa pra la')
    || text.includes('deixa para la')
    || text.includes('esquece')
    || text.includes('nao quero')
    || text.includes('não quero')
    || text.includes('nao e esse')
    || text.includes('não é esse')
    || text.includes('nao foi esse')
    || text.includes('não foi esse')
    || text.includes('outro cartao')
    || text.includes('outro cartão')
    || text.includes('apenas eu');
}

function parseSplitModeFromText(value) {
  const text = normalizeIntentText(value);
  if (text.includes('valor') || text.includes('cada') || text.includes('definir')) return 'exact';
  if (text.includes('igual') || text.includes('iguais') || text.includes('meio') || text.includes('metade')) return 'equal';
  return '';
}

function parseCardIdFromReply(reply = {}, text = '', cards = []) {
  const direct = Number(reply.card_id || reply.cardId || reply.selected_card_id || 0);
  if (direct && cards.some((card) => Number(card.id || 0) === direct)) return direct;

  const raw = normalizeIntentText(text || reply.text || reply.raw_text || '');
  if (!raw) return 0;
  const asNumber = Number.parseInt(raw, 10);
  if (Number.isFinite(asNumber) && asNumber > 0) {
    const byIndex = cards[asNumber - 1];
    if (byIndex) return Number(byIndex.id || 0);
    if (cards.some((card) => Number(card.id || 0) === asNumber)) return asNumber;
  }

  const matched = cards.find((card) => normalizeIntentText(card.label || card.name).includes(raw) || raw.includes(normalizeIntentText(card.label || card.name)));
  return matched ? Number(matched.id || 0) : 0;
}

function makeResult(payload = {}, statusCode = 200) {
  return { statusCode, ...payload };
}

function publicConversation(row, repository) {
  if (!row) return null;
  return {
    id: Number(row.id || 0),
    state: row.state,
    related_purchase_id: Number(row.related_purchase_id || 0) || null,
    expires_at: row.expires_at,
    payload: repository ? repository.getConversationPayload(row) : safeJsonParse(row.payload_json, {})
  };
}

function buildCardOptions(cards = []) {
  return cards.map((card, index) => ({
    id: Number(card.id || 0),
    name: card.name,
    label: card.name,
    brand: card.brand || null,
    option: index + 1
  }));
}

function normalizeLookupText(value) {
  return normalizeIntentText(value)
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveCardByHint(cards = [], hint = '') {
  const needle = normalizeLookupText(hint);
  if (!needle || needle.length < 2) return null;

  const matches = cards
    .map((card) => {
      const name = normalizeLookupText(card.name || card.label || '');
      const brand = normalizeLookupText(card.brand || '');
      let score = 0;
      if (name && name === needle) score = Math.max(score, 100);
      if (name && name.startsWith(needle)) score = Math.max(score, 92);
      if (name && (name.includes(needle) || needle.includes(name))) score = Math.max(score, 82);
      if (brand && brand === needle) score = Math.max(score, 64);
      if (brand && (brand.includes(needle) || needle.includes(brand))) score = Math.max(score, 54);
      return { card, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || Number(a.card.id || 0) - Number(b.card.id || 0));

  if (!matches.length) return null;
  const topScore = matches[0].score;
  const topMatches = matches.filter((entry) => entry.score === topScore);
  if (topMatches.length > 1) return null;
  return matches[0].card;
}


function canBypassPurchaseCreateConfirmation(payload = {}, meta = {}) {
  // Confirmacao direta so vale quando veio do proprio backend apos uma conversa pendente.
  // Chamadas externas do N8N/API nunca devem pular a primeira confirmacao de compra por texto.
  return payload.confirmed === true && meta.confirmedByConversationReply === true;
}

function createAutomationApiService(deps = {}) {
  const repository = deps.repository || createAutomationApiRepository();
  const operationsRepository = deps.operationsRepository || createAutomationOperationsRepository();
  const purchaseService = deps.purchaseService || createPurchaseCreationService({ repository });
  const receiptPurchasesService = deps.receiptPurchasesService || createAutomationReceiptPurchasesService(deps);

  function isEnabled() {
    return repository.getBooleanSetting('AUTOMATION_API_ENABLED', false);
  }

  function getToken() {
    return String(repository.getAppSetting('AUTOMATION_API_TOKEN', '') || '').trim();
  }

  function assertApiEnabled() {
    if (!isEnabled()) {
      throw new AutomationApiError('A API de automações está desligada no AcerttaPay.', {
        code: 'AUTOMATION_DISABLED',
        statusCode: 503
      });
    }
  }

  function getRequestIp(req) {
    return String(req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  }

  function getAutomationRequestContext(req) {
    return operationsRepository.inferWorkflowFromPath(req.path || req.originalUrl || '', req.method || '');
  }

  function getHmacSecret() {
    return String(repository.getAppSetting('AUTOMATION_HMAC_SECRET', '') || '').trim();
  }

  function isHmacRequired() {
    return repository.getBooleanSetting('AUTOMATION_HMAC_REQUIRED', false);
  }

  function verifyHmacSignature(req) {
    const secret = getHmacSecret();
    const signatureHeader = String(req.get('x-acerttapay-signature') || req.get('x-signature') || '').trim();
    const timestamp = String(req.get('x-acerttapay-timestamp') || req.get('x-timestamp') || '').trim();
    const required = isHmacRequired();

    if (!required && !signatureHeader) return { ok: true, skipped: true };
    if (!secret) {
      return { ok: false, statusCode: 503, code: 'AUTOMATION_HMAC_SECRET_MISSING', message: 'Segredo HMAC não configurado.' };
    }
    if (!signatureHeader || !timestamp) {
      return { ok: false, statusCode: 401, code: 'HMAC_MISSING', message: 'Assinatura HMAC ausente.' };
    }

    const timestampMs = Number(timestamp) > 9999999999 ? Number(timestamp) : Number(timestamp) * 1000;
    const maxSkewSeconds = Math.max(30, repository.getIntegerSetting('AUTOMATION_HMAC_MAX_SKEW_SECONDS', 300));
    if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > maxSkewSeconds * 1000) {
      return { ok: false, statusCode: 401, code: 'HMAC_TIMESTAMP_INVALID', message: 'Timestamp da assinatura fora da janela permitida.' };
    }

    const rawBody = typeof req.rawBody === 'string' ? req.rawBody : JSON.stringify(req.body || {});
    const signedPayload = `${timestamp}.${rawBody}`;
    const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
    const provided = signatureHeader.replace(/^sha256=/i, '').trim();
    if (!safeCompare(provided, expected)) {
      return { ok: false, statusCode: 401, code: 'HMAC_INVALID', message: 'Assinatura HMAC inválida.' };
    }
    return { ok: true };
  }

  function verifyWorkflowAvailability(context = {}) {
    const workflow = operationsRepository.getWorkflowByKey(context.workflowKey || 'automation-api');
    if (!workflow) return { ok: true, workflow: null };
    if (Number(workflow.enabled || 0) === 0) {
      return { ok: false, statusCode: 503, code: 'WORKFLOW_DISABLED', message: 'Essa família de automação está desligada no AcerttaPay.' };
    }
    if (Number(workflow.maintenance_mode || 0) !== 0) {
      return { ok: false, statusCode: 503, code: 'WORKFLOW_MAINTENANCE', message: 'Esse fluxo está em manutenção. Nada de bagunçar o caixa agora.' };
    }
    try {
      checkWorkflowRateLimit(workflow.workflow_key, workflow.rate_limit_per_minute || repository.getIntegerSetting('AUTOMATION_DEFAULT_WORKFLOW_RATE_LIMIT_PER_MINUTE', 120));
    } catch (error) {
      return { ok: false, statusCode: error.statusCode || 429, code: error.code || 'WORKFLOW_RATE_LIMITED', message: error.message };
    }
    return { ok: true, workflow };
  }

  function verifyAutomationRequest(req) {
    const context = getAutomationRequestContext(req);
    req.automationContext = context;

    if (!isEnabled()) {
      return { ok: false, statusCode: 503, code: 'AUTOMATION_DISABLED', message: 'A API de automações está desligada.' };
    }

    const expected = getToken();
    if (!expected) {
      return { ok: false, statusCode: 503, code: 'AUTOMATION_TOKEN_MISSING', message: 'Token da API de automações não configurado.' };
    }

    const workflowCheck = verifyWorkflowAvailability(context);
    if (!workflowCheck.ok) return workflowCheck;

    const header = String(req.get('authorization') || '').trim();
    const provided = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
    if (!provided || !safeCompare(provided, expected)) {
      return { ok: false, statusCode: 401, code: 'UNAUTHORIZED', message: 'Token de automação inválido.' };
    }

    const hmacCheck = verifyHmacSignature(req);
    if (!hmacCheck.ok) return hmacCheck;

    try {
      checkKeyRateLimit(provided);
    } catch (error) {
      return { ok: false, statusCode: error.statusCode || 429, code: error.code || 'RATE_LIMITED', message: error.message };
    }

    const allowedIps = String(repository.getAppSetting('AUTOMATION_ALLOWED_IPS', '') || '')
      .split(',')
      .map((ip) => ip.trim())
      .filter(Boolean);
    if (allowedIps.length) {
      const requestIp = getRequestIp(req);
      if (!allowedIps.includes(requestIp)) {
        return { ok: false, statusCode: 403, code: 'IP_NOT_ALLOWED', message: 'Origem não autorizada para a API de automações.' };
      }
    }

    return { ok: true, workflowKey: context.workflowKey, familyKey: context.familyKey };
  }

  function assertBucketRateLimit({ bucketMap, key, limit, message }) {
    const safeKey = String(key || '').trim();
    if (!safeKey) return;
    const maxPerMinute = Math.max(1, Number(limit || 1) || 1);
    const now = Date.now();
    const windowMs = 60 * 1000;
    const bucket = bucketMap.get(safeKey) || [];
    const recent = bucket.filter((timestamp) => now - timestamp < windowMs);
    if (recent.length >= maxPerMinute) {
      bucketMap.set(safeKey, recent);
      throw new AutomationApiError(message || 'Recebi requisições demais em pouco tempo. Tenta de novo em instantes.', {
        code: 'RATE_LIMITED',
        statusCode: 429
      });
    }
    recent.push(now);
    bucketMap.set(safeKey, recent);
  }

  function checkKeyRateLimit(token) {
    const limit = Math.max(1, repository.getIntegerSetting('AUTOMATION_RATE_LIMIT_PER_KEY_PER_MINUTE', 300));
    const keyHash = crypto.createHash('sha256').update(String(token || '')).digest('hex').slice(0, 24);
    assertBucketRateLimit({
      bucketMap: keyRateLimitBuckets,
      key: keyHash,
      limit,
      message: 'Recebi requisições demais dessa chave em pouco tempo. Tenta de novo em instantes.'
    });
  }

  function checkRateLimit(phoneE164) {
    const limit = Math.max(1, repository.getIntegerSetting('AUTOMATION_RATE_LIMIT_PER_PHONE_PER_MINUTE', 10));
    assertBucketRateLimit({
      bucketMap: rateLimitBuckets,
      key: phoneE164,
      limit,
      message: 'Muita mensagem seguida desse número. Segurei um minutinho para não virar bagunça.'
    });
  }

  function checkWorkflowRateLimit(workflowKey, limit) {
    const safeWorkflowKey = String(workflowKey || 'automation-api').trim();
    assertBucketRateLimit({
      bucketMap: workflowRateLimitBuckets,
      key: safeWorkflowKey,
      limit: Math.max(1, Number(limit || 60) || 60),
      message: 'Esse fluxo recebeu requisições demais em pouco tempo. Segurei para não virar efeito dominó.'
    });
  }

  function getRequestMetaFromHttp(req, context = {}) {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    return {
      method: req.method,
      path: req.path || req.originalUrl || '',
      workflow_key: context.workflowKey || null,
      family_key: context.familyKey || null,
      ip_address: getRequestIp(req),
      idempotency_key: req.get('Idempotency-Key') || req.get('X-Idempotency-Key') || '',
      source_message_id: body.source?.message_id || body.message_id || body.source_message_id || null
    };
  }

  function verifyWorkflowUserPreference(req) {
    const context = req.automationContext || getAutomationRequestContext(req);
    if (!context.workflowKey || context.workflowKey === 'automation-api') return { ok: true };
    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    const phone = operationsRepository.extractPhoneFromPayload(payload) || String(req.query?.phone || '').trim();
    if (!phone) return { ok: true };
    const normalized = normalizeAutomationPhone(phone);
    if (!normalized.ok) return { ok: true };
    const authorization = repository.getAuthorizationByPhone(normalized.e164, normalized.whatsappNumber);
    if (!authorization || !authorization.user_id) return { ok: true };
    if (!operationsRepository.isUserWorkflowEnabled(authorization.user_id, context.workflowKey)) {
      return {
        ok: false,
        statusCode: 403,
        code: 'AUTOMATION_USER_WORKFLOW_DISABLED',
        message: 'Essa função do WhatsApp está desligada para este usuário.'
      };
    }
    return { ok: true };
  }

  function recordAutomationHttpEvent(req, responsePayload = {}, statusCode = 200) {
    const context = req.automationContext || getAutomationRequestContext(req);
    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    const phone = operationsRepository.extractPhoneFromPayload(payload) || null;
    let resolvedUser = null;
    let phoneE164 = null;
    if (phone) {
      const normalized = normalizeAutomationPhone(phone);
      if (normalized.ok) {
        phoneE164 = normalized.e164;
        resolvedUser = operationsRepository.findAutomationUserByPhone(normalized.e164);
      }
    }
    const resultCode = responsePayload?.code || (Number(statusCode || 0) >= 400 ? 'HTTP_ERROR' : 'OK');
    const intent = payload.intent || payload.reply?.intent || responsePayload?.intent || null;
    const sourceMessageId = payload.source?.message_id || payload.message_id || payload.source_message_id || null;
    const requestMeta = getRequestMetaFromHttp(req, context);
    const responseMeta = {
      ok: responsePayload?.ok,
      code: resultCode,
      statusCode,
      conversation_state: responsePayload?.conversation?.state || null
    };

    try {
      operationsRepository.logIntentEvent({
        userId: resolvedUser?.user_id || null,
        phoneE164,
        workflowKey: context.workflowKey,
        familyKey: context.familyKey,
        intent,
        operation: context.operation,
        statusCode,
        resultCode,
        channel: payload.source?.channel || payload.channel || 'whatsapp',
        sourceMessageId,
        requestMeta,
        responseMeta
      });
      if (Number(statusCode || 0) >= 400 || responsePayload?.ok === false) {
        operationsRepository.logErrorEvent({
          userId: resolvedUser?.user_id || null,
          phoneE164,
          workflowKey: context.workflowKey,
          familyKey: context.familyKey,
          operation: context.operation,
          statusCode,
          resultCode,
          errorMessage: responsePayload?.message || responsePayload?.error || resultCode,
          requestMeta: {
            ...requestMeta,
            response_meta: responseMeta,
            source_excerpt: compactAutomationText(payload.source?.raw_text || payload.source?.rawText || payload.text || payload.reply?.text || '')
          }
        });
      }
    } catch (error) {
      // Observabilidade nunca deve quebrar o fluxo financeiro.
    }
  }

  function logConciergeFailure({ error, response, payload = {}, meta = {}, resolved = null, conversation = null, state = '', operation = 'conversation.reply' } = {}) {
    try {
      const source = payload.source || {};
      const reply = payload.reply || {};
      const phoneE164 = resolved?.normalized?.e164 || normalizeAutomationPhone(payload.phone || payload.user_phone || payload.number || '').e164 || null;
      const userId = resolved?.user?.id || null;
      const workflowKey = state.includes('receipt')
        ? '1.4'
        : (state.includes('participant') || state.includes('split') || state.includes('amount') ? '1.3'
          : (state.includes('correction') || state.includes('edit') || state.includes('delete') || state.includes('mutation') ? '1.2' : '1.1'));
      const requestMeta = {
        endpoint: meta.endpoint || '/api/automation/v1/conversations/reply',
        idempotency_key: meta.idempotencyKey || meta.idempotency_key || '',
        source_message_id: source.message_id || payload.message_id || payload.source_message_id || null,
        conversation_id: conversation?.id || null,
        conversation_state: state || conversation?.state || null,
        related_purchase_id: conversation?.related_purchase_id || null,
        reply_intent: reply.intent || null,
        reply_purchase_id: reply.purchase_id || reply.purchaseId || null,
        source_excerpt: compactAutomationText(source.raw_text || source.rawText || reply.text || payload.text || ''),
        error_name: error?.name || null,
        error_code: error?.code || response?.code || 'INTERNAL_ERROR'
      };
      repository.logRequest({
        userId,
        phoneE164,
        channel: source.channel || payload.channel || 'whatsapp',
        operation,
        statusCode: response?.statusCode || error?.statusCode || 500,
        resultCode: response?.code || error?.code || 'INTERNAL_ERROR',
        sourceMessageId: requestMeta.source_message_id,
        ipAddress: meta.ipAddress || null,
        requestMeta,
        responseMeta: {
          ok: response?.ok,
          code: response?.code,
          message: response?.message || null
        }
      });
      operationsRepository.logErrorEvent({
        userId,
        phoneE164,
        workflowKey,
        familyKey: '1.x',
        operation,
        statusCode: response?.statusCode || error?.statusCode || 500,
        resultCode: response?.code || error?.code || 'INTERNAL_ERROR',
        errorMessage: error?.message || response?.message || 'Erro interno no concierge.',
        errorStack: error?.stack || null,
        requestMeta
      });
    } catch (logError) {
      // Logs do concierge nunca podem quebrar ou mascarar a resposta ao WhatsApp.
    }
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
      return { authorized: false, normalized, authorization: authorization || null, user: null };
    }

    const user = repository.getUserById(authorization.user_id);
    if (!user) return { authorized: false, normalized, authorization, user: null };

    repository.touchAuthorization(authorization.id);
    return { authorized: true, normalized, authorization, user };
  }

  function buildPurchaseCreatedResponse({ purchase, conversation }) {
    return makeResult({
      ok: true,
      code: 'PURCHASE_CREATED',
      purchase: {
        id: purchase.id,
        root_transaction_id: purchase.root_transaction_id,
        transaction_ids: purchase.transaction_ids,
        description: purchase.description,
        amount_cents: purchase.amount_cents,
        installments: purchase.installments,
        is_recurring: purchase.is_recurring,
        card_id: purchase.card_id,
        card_name: purchase.card_name,
        due_month: purchase.due_month,
        due_year: purchase.due_year
      },
      conversation: publicConversation(conversation, repository),
      whatsapp: {
        text: `Compra salva: ${purchase.description} por ${formatBRLFromCents(purchase.amount_cents)} no ${purchase.card_name}. Quer definir os participantes dessa compra?`
      }
    });
  }


  function buildPurchaseCreateConfirmationResponse({ userId, phoneE164, purchase, source }) {
    const conversation = repository.createConversationState({
      userId,
      phoneE164,
      channel: source?.channel || 'whatsapp',
      state: 'awaiting_purchase_create_confirmation',
      payload: { purchase, source }
    });
    const lines = [
      '🧾 *Confirmar nova compra?*',
      '',
      `Compra: *${purchase.description || 'sem descrição'}*`,
      `Valor: *${formatBRLFromCents(purchase.amount_cents || 0)}*`,
      purchase.date ? `Data: *${purchase.date}*` : '',
      purchase.installments && Number(purchase.installments) > 1 ? `Parcelas: *${purchase.installments}x*` : 'Parcelas: *1x*',
      purchase.card_hint ? `Cartão informado: *${purchase.card_hint}*` : 'Cartão: vou confirmar antes de lançar.',
      '',
      'Responde *confirmar* para eu seguir ou *cancelar* para descartar. Sem chute na fatura. 😉'
    ].filter(Boolean);
    return makeResult({
      ok: false,
      code: 'NEEDS_PURCHASE_CREATE_CONFIRMATION',
      conversation: publicConversation(conversation, repository),
      whatsapp: { text: lines.join('\n') }
    }, 202);
  }

  function buildCardSelectionResponse({ userId, phoneE164, purchase, source, cards }) {
    const options = buildCardOptions(cards);
    const conversation = repository.createConversationState({
      userId,
      phoneE164,
      channel: source?.channel || 'whatsapp',
      state: 'awaiting_card_choice',
      payload: { purchase, source, cards: options }
    });
    const cardList = options.map((card) => `${card.option}. ${card.label}`).join(' ');
    return makeResult({
      ok: false,
      code: 'NEEDS_CARD_SELECTION',
      conversation: publicConversation(conversation, repository),
      cards: options,
      whatsapp: {
        text: `Essa compra entrou em qual cartão? ${cardList}`
      }
    }, 200);
  }


  function buildCardConfirmationResponse({ userId, phoneE164, purchase, source, cards, suggestedCard, cardHint }) {
    const options = buildCardOptions(cards);
    const suggested = options.find((card) => Number(card.id || 0) === Number(suggestedCard?.id || 0));
    if (!suggested) {
      return buildCardSelectionResponse({ userId, phoneE164, purchase, source, cards });
    }
    const conversation = repository.createConversationState({
      userId,
      phoneE164,
      channel: source?.channel || 'whatsapp',
      state: 'awaiting_card_confirmation',
      payload: {
        purchase,
        source,
        cards: options,
        suggested_card_id: Number(suggested.id || 0),
        suggested_card: suggested,
        card_hint: cardHint || null
      }
    });
    return makeResult({
      ok: false,
      code: 'NEEDS_CARD_CONFIRMATION',
      conversation: publicConversation(conversation, repository),
      card: suggested,
      cards: options,
      whatsapp: {
        text: `Pelo que entendi, foi no cartão ${suggested.label}. Confirma para eu lançar sem bagunçar a fatura?`
      }
    }, 200);
  }

  function createPurchaseWithResolvedCard({ userId, phoneE164, purchase, source, cardId }) {
    const created = purchaseService.createAutomationPurchase({
      userId,
      purchase: { ...(purchase || {}), card_id: cardId },
      source,
      cardId,
      assignToSelf: true
    });
    const conversation = repository.createConversationState({
      userId,
      phoneE164,
      channel: source?.channel || 'whatsapp',
      state: 'awaiting_split_confirmation',
      relatedPurchaseId: created.id,
      payload: {
        purchase_id: created.id,
        transaction_ids: created.transaction_ids,
        description: created.description,
        amount_cents: created.amount_cents,
        card_name: created.card_name
      }
    });
    return buildPurchaseCreatedResponse({ purchase: created, conversation });
  }


  function normalizeMoneyPatch(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
    const raw = String(value || '').trim();
    if (!raw) return null;
    if (/^-?\d+$/.test(raw)) return Number(raw);
    const digits = raw.replace(/\D/g, '');
    return digits ? Number(digits) : null;
  }

  function normalizeEditDescription(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 180);
  }

  function stripInstallmentMarker(description) {
    return String(description || '').replace(/\s*\(\d{1,3}\/\d{1,3}\)\s*$/g, '').trim();
  }

  function formatInstallmentLabel(description, index, total) {
    const base = stripInstallmentMarker(description);
    const totalCount = Math.max(1, Number(total || 1) || 1);
    if (totalCount <= 1) return base;
    return `${base} (${String(index).padStart(2, '0')}/${String(totalCount).padStart(2, '0')})`;
  }

  function normalizeInstallmentCount(value, fallback) {
    if (value === null || value === undefined || value === '') return fallback;
    const parsed = Number.parseInt(String(value || ''), 10);
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    return Math.min(120, parsed);
  }

  function normalizeMutationDate(value, fallback) {
    const raw = String(value || '').trim();
    if (!raw) return fallback;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || !dayjs(raw).isValid()) {
      throw new AutomationApiError('Essa data não ficou válida para mim. Me manda no formato dia/mês ou uma data clara.', {
        code: 'INVALID_DATE',
        statusCode: 400
      });
    }
    return raw;
  }

  function getInstallmentMonths(startYear, startMonth, installments) {
    const months = [];
    let currentYear = Number(startYear || 0);
    let currentMonth = Number(startMonth || 0);
    for (let i = 0; i < Math.max(1, Number(installments || 1)); i += 1) {
      months.push({ year: currentYear, month: currentMonth, index: i + 1 });
      currentMonth += 1;
      if (currentMonth > 12) {
        currentMonth = 1;
        currentYear += 1;
      }
    }
    return months;
  }

  function normalizeDayNumber(value) {
    const parsed = Number.parseInt(String(value || '').trim(), 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 31) return null;
    return parsed;
  }

  function suggestFirstDueMonthForMutation(purchaseDate, closeDay, dueDay) {
    const purchase = dayjs(purchaseDate);
    if (!purchase.isValid()) return null;
    const normalizedCloseDay = normalizeDayNumber(closeDay);
    const normalizedDueDay = normalizeDayNumber(dueDay);
    let target = purchase.startOf('month');

    if (normalizedCloseDay && normalizedDueDay && normalizedCloseDay > normalizedDueDay) {
      target = target.add(1, 'month');
    }

    if (normalizedCloseDay) {
      const effectiveCloseDay = Math.min(normalizedCloseDay, purchase.daysInMonth());
      if (purchase.date() >= effectiveCloseDay) {
        target = target.add(1, 'month');
      }
    }

    return target.format('YYYY-MM');
  }

  function distributeTotal(totalCents, installments) {
    const count = Math.max(1, Number(installments || 1) || 1);
    const total = Math.round(Number(totalCents || 0));
    const share = Math.trunc(total / count);
    const remainder = total - (share * count);
    return Array.from({ length: count }, (_, index) => share + (index < Math.abs(remainder) ? Math.sign(remainder) : 0));
  }

  function serializePurchaseRow(row = {}) {
    return {
      id: Number(row.id || 0),
      card_id: Number(row.card_id || 0) || null,
      card_name: row.card_name || null,
      txn_date: row.txn_date || null,
      description: row.description || '',
      amount_cents: Number(row.amount_cents || 0),
      due_month: Number(row.month || row.due_month || 0) || null,
      due_year: Number(row.year || row.due_year || 0) || null,
      parent_txn_id: Number(row.parent_txn_id || 0) || null,
      recurring_rule_id: Number(row.recurring_rule_id || 0) || null,
      purchase_category_id: Number(row.purchase_category_id || 0) || null,
      created_at: row.created_at || null
    };
  }

  function buildPurchaseSnapshot(userId, rows = []) {
    const cleanRows = (rows || []).filter(Boolean);
    const ids = cleanRows.map((row) => Number(row.id || 0)).filter(Boolean);
    const allocations = repository.getAllocationsForTransactions(userId, ids).map((row) => ({
      transaction_id: Number(row.transaction_id || 0),
      person_id: Number(row.person_id || 0),
      person_name: row.person_name || null,
      share_cents: Number(row.share_cents || 0)
    }));
    return {
      purchase_id: Number(cleanRows[0]?.parent_txn_id || cleanRows[0]?.id || 0) || null,
      total_cents: cleanRows.reduce((sum, row) => sum + Number(row.amount_cents || 0), 0),
      installments: cleanRows.length,
      rows: cleanRows.map(serializePurchaseRow),
      allocations
    };
  }

  function buildPurchasePeriodPrompt({ resolved, payload = {}, purpose = 'mutation' }) {
    const conversation = repository.createConversationState({
      userId: resolved.user.id,
      phoneE164: resolved.normalized.e164,
      channel: payload.source?.channel || payload.channel || 'whatsapp',
      state: periodStateForPurpose(purpose),
      relatedPurchaseId: null,
      payload: { purpose, source: payload.source || {}, limit: payload.limit || null }
    });
    return makeResult({
      ok: false,
      code: 'NEEDS_PURCHASE_PERIOD',
      conversation: publicConversation(conversation, repository),
      whatsapp: { text: monthQuestionForPurpose(purpose) }
    });
  }

  function listRecentPurchases(payload = {}, meta = {}) {
    let resolved = null;
    try {
      assertApiEnabled();
      resolved = resolveAuthorizedPhone(payload.phone || payload.user_phone || payload.number);
      if (!resolved.authorized) {
        throw new AutomationApiError('Esse número ainda não está liberado no AcerttaPay.', {
          code: 'NOT_AUTHORIZED',
          statusCode: 403
        });
      }
      const limit = Math.max(1, Math.min(20, Number(payload.limit || 8) || 8));
      const purpose = normalizeIntentText(payload.purpose || payload.reason || 'mutation');
      const period = resolvePurchasePeriodInput({ ...payload, raw_text: payload.source?.raw_text || payload.source?.rawText || payload.raw_text || payload.text || '' });
      if (!period) {
        const response = buildPurchasePeriodPrompt({ resolved, payload, purpose });
        repository.logRequest({
          userId: resolved.user.id,
          phoneE164: resolved.normalized.e164,
          channel: payload.source?.channel || payload.channel || 'whatsapp',
          operation: 'purchase.period.prompt',
          statusCode: response.statusCode,
          resultCode: response.code,
          sourceMessageId: payload.source?.message_id || payload.message_id || null,
          ipAddress: meta.ipAddress || null
        });
        return response;
      }

      const rows = repository.getRecentPurchasesForAutomation(resolved.user.id, {
        limit,
        windowHours: payload.window_hours || payload.windowHours || null,
        eligibleOnly: true,
        month: period.month,
        year: period.year
      });
      const purchases = rows.map((row, index) => ({
        option: index + 1,
        id: Number(row.purchase_id || row.id || 0),
        description: stripInstallmentMarker(row.description || ''),
        amount_cents: Number(row.amount_cents || 0),
        card_id: Number(row.card_id || 0),
        card_name: row.card_name,
        date: row.txn_date,
        created_at: row.created_at || null,
        due_month: Number(row.due_month || 0) || null,
        due_year: Number(row.due_year || 0) || null,
        installments: Number(row.installments || 1) || 1,
        created_by_automation: Number(row.created_by_automation || 0) === 1,
        mutation_window_open: Number(row.is_mutation_window_open || 0) === 1,
        month_closed: Number(row.closed_month_count || 0) > 0,
        protected_shared_debt: Number(row.protected_shared_debt_count || 0) > 0
      }));
      const periodText = purchasePeriodLabel(period.month, period.year);
      const isParticipants = purposeWantsParticipants(purpose);
      const title = isParticipants
        ? `🧾 *Compras da fatura ${periodText} para dividir*`
        : `🧾 *Compras da fatura ${periodText} para ajustar*`;
      const lines = purchases.length
        ? purchases.map((purchase) => {
          const metaParts = [];
          const txnDate = formatAutomationDateBR(purchase.date);
          if (txnDate) metaParts.push(txnDate);
          if (purchase.installments > 1) metaParts.push(`${purchase.installments}x`);
          return `${purchase.option}. #${purchase.id} — ${purchase.description} — *${formatBRLFromCents(purchase.amount_cents)}* no ${purchase.card_name || 'cartão'}${metaParts.length ? ` · ${metaParts.join(' · ')}` : ''}`;
        })
        : ['Não encontrei compras elegíveis nessa fatura para mexer pelo WhatsApp.'];
      const guidance = isParticipants
        ? 'Escolhe pelo *número* da lista ou pelo *código #*. Ex.: *2* ou *#123*.'
        : 'Escolhe pelo *número* ou *#* e já me fala o ajuste. Ex.: *2 valor 89,90*, *#123 apagar* ou *#123 dividir*.';
      let conversation = null;
      if (purchases.length) {
        conversation = repository.createConversationState({
          userId: resolved.user.id,
          phoneE164: resolved.normalized.e164,
          channel: payload.source?.channel || payload.channel || 'whatsapp',
          state: selectionStateForPurpose(purpose),
          relatedPurchaseId: null,
          payload: {
            purpose,
            period: { month: period.month, year: period.year },
            purchases,
            source: payload.source || {}
          }
        });
      }
      const emptyFallback = 'Para faturas fechadas, compras protegidas por acerto ou itens fora da janela segura, faça o ajuste pelo app.';
      const response = makeResult({
        ok: true,
        code: 'PURCHASES_FOR_PERIOD',
        purchases,
        period: { month: period.month, year: period.year, label: periodText },
        conversation: conversation ? publicConversation(conversation, repository) : null,
        criteria: {
          ordered_by: 'txn_date_desc',
          eligible_only: true,
          limit,
          month: period.month,
          year: period.year
        },
        whatsapp: {
          text: purchases.length
            ? [title, '', ...lines, '', guidance].join('\n')
            : [`Não encontrei compras elegíveis na fatura ${periodText}.`, emptyFallback].join('\n')
        }
      });
      repository.logRequest({
        userId: resolved.user.id,
        phoneE164: resolved.normalized.e164,
        channel: payload.source?.channel || payload.channel || 'whatsapp',
        operation: 'purchase.period_list',
        statusCode: response.statusCode,
        resultCode: response.code,
        sourceMessageId: payload.source?.message_id || payload.message_id || null,
        ipAddress: meta.ipAddress || null
      });
      return response;
    } catch (error) {
      const response = handleServiceError(error);
      repository.logRequest({
        userId: resolved?.user?.id || null,
        phoneE164: resolved?.normalized?.e164 || null,
        channel: payload.source?.channel || payload.channel || 'whatsapp',
        operation: 'purchase.period_list',
        statusCode: response.statusCode,
        resultCode: response.code,
        sourceMessageId: payload.source?.message_id || payload.message_id || null,
        ipAddress: meta.ipAddress || null
      });
      return response;
    }
  }

  function resolvePurchaseIdForMutation(userId, rawPurchaseId) {
    const raw = String(rawPurchaseId || '').trim().toLowerCase();
    if (raw && raw !== 'last' && raw !== 'ultima' && raw !== 'última') {
      const parsed = Number(raw);
      if (parsed) return parsed;
    }
    const recent = repository.getRecentPurchasesForAutomation(userId, { limit: 1 });
    const first = recent[0];
    if (!first) {
      throw new AutomationApiError('Não encontrei uma compra recente para mexer. Me diz qual compra ou ajusta pelo app.', {
        code: 'NO_RECENT_PURCHASE',
        statusCode: 404
      });
    }
    return Number(first.purchase_id || first.id || 0);
  }

  function getMutationRows(userId, rawPurchaseId) {
    const purchaseId = resolvePurchaseIdForMutation(userId, rawPurchaseId);
    const rows = repository.getPurchaseScopeRows(userId, purchaseId);
    if (!rows.length) {
      throw new AutomationApiError('Não encontrei essa compra por aqui.', {
        code: 'PURCHASE_NOT_FOUND',
        statusCode: 404
      });
    }
    return rows;
  }

  function assertRowsMutable(userId, rows = []) {
    const cleanRows = (rows || []).filter(Boolean);
    if (!cleanRows.length) {
      throw new AutomationApiError('Não encontrei essa compra por aqui.', {
        code: 'PURCHASE_NOT_FOUND',
        statusCode: 404
      });
    }
    const locked = cleanRows.find((row) => repository.isMonthClosed(userId, row.month, row.year));
    if (locked) {
      throw new AutomationApiError(`Essa fatura já foi fechada (${purchaseService.monthLabel(locked.month, locked.year)}). Não mexi nela para não bagunçar o que já foi pago.`, {
        code: 'MONTH_CLOSED',
        statusCode: 423,
        details: { month: locked.month, year: locked.year }
      });
    }
    const root = cleanRows[0];
    const createdByAutomation = String(root.raw_json || '').includes('automation_api_v1');
    const windowHours = Math.max(1, repository.getIntegerSetting('AUTOMATION_PURCHASE_MUTATION_WINDOW_HOURS', 72));
    const createdAt = root.created_at ? dayjs(root.created_at) : null;
    const withinWindow = createdAt?.isValid() ? dayjs().diff(createdAt, 'hour') <= windowHours : false;
    if (!createdByAutomation && !withinWindow) {
      throw new AutomationApiError(`Por segurança, pelo WhatsApp eu só corrijo compras criadas por automação ou lançamentos recentes (${windowHours}h). Essa fica melhor ajustar pelo app.`, {
        code: 'MUTATION_WINDOW_CLOSED',
        statusCode: 409,
        details: { window_hours: windowHours }
      });
    }
    const protectedRows = repository.getProtectedSharedDebtRowsForTransactions(userId, cleanRows.map((row) => row.id));
    if (protectedRows.length) {
      const first = protectedRows[0];
      throw new AutomationApiError(`Essa compra já foi enviada para ${first.receiver_name || 'alguém'} no app. Para não bagunçar saldo combinado, segura esse ajuste pelo app.`, {
        code: 'SHARED_DEBT_ALREADY_SENT',
        statusCode: 409,
        details: { request_count: protectedRows.length }
      });
    }
  }

  function normalizeEditPatch(rawPatch = {}) {
    const source = rawPatch || {};
    const patch = {};
    const amount = normalizeMoneyPatch(source.amount_cents ?? source.amountCents ?? source.amount ?? source.value);
    if (amount !== null) patch.amount_cents = amount;
    const date = source.date || source.txn_date || source.purchase_date;
    if (date) patch.date = date;
    const description = normalizeEditDescription(source.description || source.merchant || source.title || '');
    if (description) patch.description = description;
    const installmentsRaw = source.installments ?? source.parcelas;
    if (installmentsRaw !== undefined && installmentsRaw !== null && installmentsRaw !== '') patch.installments = normalizeInstallmentCount(installmentsRaw, 1);
    const cardId = Number(source.card_id || source.cardId || 0);
    if (cardId) patch.card_id = cardId;
    const cardHint = source.card_hint || source.cardHint || source.card_name || source.cardName || '';
    if (cardHint) patch.card_hint = String(cardHint).trim();
    return patch;
  }

  function patchHasMutation(patch = {}) {
    return ['amount_cents', 'date', 'description', 'installments', 'card_id', 'card_hint'].some((key) => Object.prototype.hasOwnProperty.call(patch, key));
  }

  function resolveMutationCard(userId, rows, patch = {}) {
    const root = rows[0];
    if (patch.card_id) {
      const card = repository.getActiveCardById(userId, patch.card_id);
      if (!card) {
        throw new AutomationApiError('Não encontrei esse cartão ativo para fazer a troca.', {
          code: 'INVALID_CARD',
          statusCode: 400
        });
      }
      return card;
    }
    if (patch.card_hint) {
      const cards = repository.getActiveCards(userId);
      const card = resolveCardByHint(cards, patch.card_hint);
      if (!card) {
        const options = cards.map((item, index) => `${index + 1}. ${item.name}`).join(' ');
        throw new AutomationApiError(`Não consegui bater esse cartão com segurança. Escolhe pelo nome ou número: ${options}`, {
          code: 'CARD_HINT_NOT_MATCHED',
          statusCode: 400,
          details: { cards: buildCardOptions(cards) }
        });
      }
      return card;
    }
    const card = repository.getActiveCardById(userId, root.card_id);
    if (!card) {
      throw new AutomationApiError('O cartão atual dessa compra não está ativo. Ajuste pelo app para evitar bagunça na fatura.', {
        code: 'CURRENT_CARD_INACTIVE',
        statusCode: 409
      });
    }
    return card;
  }

  function buildRawMutationJson(existingRawJson, operation, source = {}) {
    const parsed = safeJsonParse(existingRawJson, {});
    return repository.safeJsonStringify({
      ...(parsed && typeof parsed === 'object' ? parsed : {}),
      last_automation_mutation: {
        operation,
        channel: source.channel || 'whatsapp',
        message_id: source.message_id || source.messageId || null,
        raw_text: source.raw_text || source.rawText || null,
        mutated_at: new Date().toISOString()
      }
    }, '{}');
  }

  function buildMutationPlan({ userId, rows, patch, source = {} }) {
    const root = rows[0];
    const totalBefore = rows.reduce((sum, row) => sum + Number(row.amount_cents || 0), 0);
    const totalAfter = Object.prototype.hasOwnProperty.call(patch, 'amount_cents') ? Number(patch.amount_cents || 0) : totalBefore;
    if (!Number.isFinite(totalAfter) || totalAfter <= 0) {
      throw new AutomationApiError('O novo valor precisa ser maior que zero.', {
        code: 'INVALID_AMOUNT',
        statusCode: 400
      });
    }

    const installments = Object.prototype.hasOwnProperty.call(patch, 'installments')
      ? normalizeInstallmentCount(patch.installments, rows.length || 1)
      : rows.length || 1;
    if (Number(root.recurring_rule_id || 0) && installments !== 1) {
      throw new AutomationApiError('Essa compra parece recorrente. Para transformar em parcelada, melhor ajustar pelo app.', {
        code: 'RECURRING_INSTALLMENTS_UNSUPPORTED',
        statusCode: 409
      });
    }

    const card = resolveMutationCard(userId, rows, patch);
    const date = normalizeMutationDate(patch.date, root.txn_date || new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }));
    const baseDescription = normalizeEditDescription(patch.description || stripInstallmentMarker(root.description || ''));
    if (!baseDescription) {
      throw new AutomationApiError('A descrição não pode ficar vazia.', {
        code: 'MISSING_DESCRIPTION',
        statusCode: 400
      });
    }

    const firstDue = suggestFirstDueMonthForMutation(date, card.close_day, card.due_day);
    if (!firstDue) {
      throw new AutomationApiError('Não consegui recalcular a fatura dessa compra.', {
        code: 'INVALID_DUE_MONTH',
        statusCode: 400
      });
    }
    const [startYear, startMonth] = firstDue.split('-').map(Number);
    const months = getInstallmentMonths(startYear, startMonth, installments);
    const locked = months.find((item) => repository.isMonthClosed(userId, item.month, item.year));
    if (locked) {
      throw new AutomationApiError(`A nova fatura cairia em mês fechado (${purchaseService.monthLabel(locked.month, locked.year)}). Não mexi para não bagunçar o que já foi pago.`, {
        code: 'MONTH_CLOSED',
        statusCode: 423,
        details: { month: locked.month, year: locked.year }
      });
    }

    const amounts = distributeTotal(totalAfter, installments);
    return {
      rootId: Number(root.parent_txn_id || root.id || 0),
      totalBefore,
      totalAfter,
      installmentsBefore: rows.length,
      installmentsAfter: installments,
      card,
      date,
      baseDescription,
      amounts,
      months,
      rawJson: buildRawMutationJson(root.raw_json, 'purchase.edit', source)
    };
  }

  function allocationTemplateForRows(userId, rows = []) {
    const ids = rows.map((row) => Number(row.id || 0)).filter(Boolean);
    const allocations = repository.getAllocationsForTransactions(userId, ids);
    const byTxn = new Map();
    allocations.forEach((row) => {
      const key = Number(row.transaction_id || 0);
      if (!byTxn.has(key)) byTxn.set(key, []);
      byTxn.get(key).push(row);
    });
    const firstWithAllocations = rows.map((row) => byTxn.get(Number(row.id || 0)) || []).find((items) => items.length);
    const self = repository.getSelfPerson(userId);
    return { byTxn, fallback: firstWithAllocations?.length ? firstWithAllocations : (self?.id ? [{ person_id: self.id, share_cents: rows[0]?.amount_cents || 0 }] : []) };
  }

  function distributeAllocationShares(newAmount, allocationRows = []) {
    const rows = (allocationRows || []).filter((row) => Number(row.person_id || row.personId || 0));
    if (!rows.length) return [];
    const oldAbsTotal = rows.reduce((sum, row) => sum + Math.abs(Number(row.share_cents ?? row.shareCents ?? 0)), 0);
    const targetAbs = Math.abs(Number(newAmount || 0));
    if (!oldAbsTotal) {
      const share = distributeTotal(newAmount, rows.length);
      return rows.map((row, index) => ({ personId: Number(row.person_id || row.personId || 0), shareCents: share[index] || 0 }));
    }
    const sign = Math.sign(Number(newAmount || 0)) || 1;
    let used = 0;
    const out = rows.map((row, index) => {
      const personId = Number(row.person_id || row.personId || 0);
      if (index === rows.length - 1) {
        const remaining = (targetAbs - used) * sign;
        return { personId, shareCents: remaining };
      }
      const raw = Math.floor((Math.abs(Number(row.share_cents ?? row.shareCents ?? 0)) / oldAbsTotal) * targetAbs);
      used += raw;
      return { personId, shareCents: raw * sign };
    });
    return out;
  }

  function applyPurchaseEditMutation({ userId, phoneE164, purchaseId, patch, source = {}, meta = {} }) {
    const idempotencyKey = String(meta.idempotencyKey || '').trim();
    const channel = source.channel || 'whatsapp';
    if (!idempotencyKey) {
      throw new AutomationApiError('Idempotency-Key é obrigatório para confirmar correções por WhatsApp.', {
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        statusCode: 400
      });
    }
    const rows = getMutationRows(userId, purchaseId);
    assertRowsMutable(userId, rows);
    const normalizedPatch = normalizeEditPatch(patch || {});
    if (!patchHasMutation(normalizedPatch)) {
      throw new AutomationApiError('Não encontrei o que deve ser corrigido nessa compra.', {
        code: 'MISSING_EDIT_PATCH',
        statusCode: 400
      });
    }

    const idempotency = repository.tryCreateIdempotency({
      userId,
      channel,
      idempotencyKey,
      operation: 'purchase.edit.confirm',
      requestHash: requestHash({ purchaseId, patch: normalizedPatch })
    });
    if (!idempotency.created) {
      const cached = safeJsonParse(idempotency.row?.response_json, null);
      if (cached) return makeResult({ ...cached, duplicate: true }, 200);
      throw new AutomationApiError('Essa confirmação já está em processamento. Não dupliquei o ajuste.', {
        code: 'IDEMPOTENCY_IN_PROGRESS',
        statusCode: 409
      });
    }

    let response;
    try {
      const before = buildPurchaseSnapshot(userId, rows);
      const plan = buildMutationPlan({ userId, rows, patch: normalizedPatch, source });
      const allocationTemplate = allocationTemplateForRows(userId, rows);
      const rowsByIndex = rows.map((row) => ({ ...row }));
      const extraRows = rowsByIndex.slice(plan.installmentsAfter);

      repository.db.transaction(() => {
        extraRows.forEach((row) => {
          if (row.recurring_rule_id && row.month && row.year) {
            repository.insertRecurringException({ userId, ruleId: row.recurring_rule_id, month: row.month, year: row.year });
          }
        });
        if (extraRows.length) repository.deleteTransactionsForAutomation(userId, extraRows);

        plan.months.forEach((monthInfo, index) => {
          const existing = rowsByIndex[index];
          const amountCents = plan.amounts[index];
          const description = formatInstallmentLabel(plan.baseDescription, index + 1, plan.installmentsAfter);
          const parentTxnId = index === 0 ? null : plan.rootId;
          const recurringRuleId = Number(rows[0].recurring_rule_id || 0) && plan.installmentsAfter === 1 ? Number(rows[0].recurring_rule_id || 0) : null;
          if (existing) {
            repository.updateTransactionForAutomation({
              userId,
              transactionId: existing.id,
              cardId: plan.card.id,
              date: plan.date,
              description,
              amountCents,
              dueMonth: monthInfo.month,
              dueYear: monthInfo.year,
              parentTxnId,
              recurringRuleId,
              purchaseCategoryId: existing.purchase_category_id || rows[0].purchase_category_id || null,
              rawJson: plan.rawJson
            });
            const allocs = allocationTemplate.byTxn.get(Number(existing.id || 0)) || allocationTemplate.fallback;
            repository.replaceAllocationsForTransaction(userId, existing.id, distributeAllocationShares(amountCents, allocs));
          } else {
            const transactionId = repository.insertTransaction({
              userId,
              cardId: Number(plan.card.id || 0),
              date: plan.date,
              description,
              amountCents,
              dueMonth: monthInfo.month,
              dueYear: monthInfo.year,
              parentTxnId: plan.rootId,
              recurringRuleId: null,
              purchaseCategoryId: rows[0].purchase_category_id || null,
              rawJson: plan.rawJson
            });
            repository.replaceAllocationsForTransaction(userId, transactionId, distributeAllocationShares(amountCents, allocationTemplate.fallback));
          }
        });

        if (Number(rows[0].recurring_rule_id || 0) && plan.installmentsAfter === 1) {
          repository.updateRecurringRuleForAutomation({
            userId,
            ruleId: rows[0].recurring_rule_id,
            cardId: plan.card.id,
            description: plan.baseDescription,
            amountCents: plan.totalAfter,
            date: plan.date,
            dueMonth: plan.months[0].month,
            dueYear: plan.months[0].year,
            purchaseCategoryId: rows[0].purchase_category_id || null
          });
        }
      })();

      const afterRows = repository.getPurchaseScopeRows(userId, plan.rootId);
      let queueSummary = { queueCount: 0, itemCount: 0, totalCents: 0, shareableCount: 0, createCount: 0 };
      try {
        queueSummary = purchaseService.queueSharedDebtDraftsForRows(userId, afterRows) || queueSummary;
      } catch (queueError) {
        // A compra ja foi corrigida. Falha ao recriar rascunhos nao deve transformar a correcao em erro para o usuario.
        repository.insertAutomationMutationEvent({
          userId,
          phoneE164,
          operation: 'purchase.edit.queue_warning',
          entityType: 'transaction',
          entityId: plan.rootId,
          before: { warning: 'queue_shared_debt_drafts_failed' },
          after: { message: queueError?.message || String(queueError) },
          sourceMessageId: source.message_id || source.messageId || null
        });
      }
      const after = buildPurchaseSnapshot(userId, afterRows);
      repository.insertAutomationMutationEvent({
        userId,
        phoneE164,
        operation: 'purchase.edit',
        entityType: 'transaction',
        entityId: plan.rootId,
        before,
        after,
        sourceMessageId: source.message_id || source.messageId || null
      });
      const rootAfter = afterRows[0] || {};
      response = makeResult({
        ok: true,
        code: 'PURCHASE_EDITED',
        purchase: {
          id: plan.rootId,
          description: stripInstallmentMarker(rootAfter.description || plan.baseDescription),
          amount_cents: after.total_cents,
          installments: afterRows.length,
          card_id: Number(rootAfter.card_id || plan.card.id || 0),
          card_name: rootAfter.card_name || plan.card.name,
          date: rootAfter.txn_date || plan.date,
          due_month: Number(rootAfter.month || rootAfter.due_month || 0) || null,
          due_year: Number(rootAfter.year || rootAfter.due_year || 0) || null
        },
        queue_summary: queueSummary,
        whatsapp: {
          text: [
            '✅ *Compra corrigida!*',
            '',
            `🧾 ${stripInstallmentMarker(rootAfter.description || plan.baseDescription)} — *${formatBRLFromCents(after.total_cents)}*`,
            `💳 Cartão: *${rootAfter.card_name || plan.card.name}*`,
            `🔢 Parcelas: *${afterRows.length}x*`,
            queueSummary.itemCount > 0 ? `📬 ${queueSummary.itemCount} rascunho(s) atualizado(s) no app.` : '📌 Divisão interna atualizada sem enviar nada automaticamente.'
          ].join('\n')
        }
      });
      repository.finishIdempotency({ channel, idempotencyKey, response, status: 'success' });
      return response;
    } catch (error) {
      response = handleServiceError(error);
      repository.finishIdempotency({ channel, idempotencyKey, response, status: 'error' });
      throw error;
    }
  }

  function describePatchForConfirmation(patch = {}, rows = []) {
    const pieces = [];
    if (Object.prototype.hasOwnProperty.call(patch, 'amount_cents')) pieces.push(`valor para *${formatBRLFromCents(patch.amount_cents)}*`);
    if (patch.date) pieces.push(`data para *${patch.date}*`);
    if (patch.description) pieces.push(`descrição para *${patch.description}*`);
    if (patch.installments) pieces.push(`parcelas para *${patch.installments}x*`);
    if (patch.card_hint || patch.card_id) pieces.push(`cartão para *${patch.card_hint || `#${patch.card_id}`}*`);
    return pieces.length ? pieces.join(', ') : 'os dados dessa compra';
  }

  function preparePurchaseEdit(payload = {}, meta = {}) {
    let resolved = null;
    try {
      assertApiEnabled();
      resolved = resolveAuthorizedPhone(payload.phone || payload.user_phone || payload.number);
      if (!resolved.authorized) throw new AutomationApiError('Esse número ainda não está liberado no AcerttaPay.', { code: 'NOT_AUTHORIZED', statusCode: 403 });
      const purchaseId = resolvePurchaseIdForMutation(resolved.user.id, payload.purchaseId || payload.purchase_id || payload.id || 'last');
      const rows = repository.getPurchaseScopeRows(resolved.user.id, purchaseId);
      assertRowsMutable(resolved.user.id, rows);
      const patch = normalizeEditPatch(payload.patch || payload.edit || payload);
      if (!patchHasMutation(patch)) {
        throw new AutomationApiError('Me diz o que você quer corrigir: valor, cartão, data, descrição ou parcelas.', {
          code: 'MISSING_EDIT_PATCH',
          statusCode: 400
        });
      }
      buildMutationPlan({ userId: resolved.user.id, rows, patch, source: payload.source || {} });
      const conversation = repository.createConversationState({
        userId: resolved.user.id,
        phoneE164: resolved.normalized.e164,
        channel: payload.source?.channel || payload.channel || 'whatsapp',
        state: 'awaiting_purchase_edit_confirmation',
        relatedPurchaseId: purchaseId,
        payload: { purchase_id: purchaseId, patch, source: payload.source || {}, preview: describePatchForConfirmation(patch, rows) }
      });
      const root = rows[0];
      const response = makeResult({
        ok: false,
        code: 'NEEDS_PURCHASE_EDIT_CONFIRMATION',
        conversation: publicConversation(conversation, repository),
        purchase: {
          id: purchaseId,
          description: stripInstallmentMarker(root.description || ''),
          amount_cents: rows.reduce((sum, row) => sum + Number(row.amount_cents || 0), 0),
          card_name: root.card_name,
          installments: rows.length
        },
        patch,
        whatsapp: {
          text: [`⚠️ *Confirmar correção?*`, '', `Compra: *${stripInstallmentMarker(root.description || '')}*`, `Atual: *${formatBRLFromCents(rows.reduce((sum, row) => sum + Number(row.amount_cents || 0), 0))}* no ${root.card_name}`, `Vou ajustar: ${describePatchForConfirmation(patch, rows)}.`, '', 'Responde *confirmar* para aplicar ou *cancelar* para deixar como está.'].join('\n')
        }
      });
      repository.logRequest({ userId: resolved.user.id, phoneE164: resolved.normalized.e164, channel: payload.source?.channel || payload.channel || 'whatsapp', operation: 'purchase.edit.prepare', statusCode: response.statusCode, resultCode: response.code, sourceMessageId: payload.source?.message_id || payload.message_id || null, ipAddress: meta.ipAddress || null });
      return response;
    } catch (error) {
      const response = handleServiceError(error);
      repository.logRequest({ userId: resolved?.user?.id || null, phoneE164: resolved?.normalized?.e164 || null, channel: payload.source?.channel || payload.channel || 'whatsapp', operation: 'purchase.edit.prepare', statusCode: response.statusCode, resultCode: response.code, sourceMessageId: payload.source?.message_id || payload.message_id || null, ipAddress: meta.ipAddress || null });
      return response;
    }
  }

  function confirmPurchaseEdit(payload = {}, meta = {}) {
    let resolved = null;
    try {
      assertApiEnabled();
      resolved = resolveAuthorizedPhone(payload.phone || payload.user_phone || payload.number);
      if (!resolved.authorized) throw new AutomationApiError('Esse número ainda não está liberado no AcerttaPay.', { code: 'NOT_AUTHORIZED', statusCode: 403 });
      const conversation = repository.getOpenConversationForUser(resolved.user.id, resolved.normalized.e164);
      const data = conversation && String(conversation.state || '') === 'awaiting_purchase_edit_confirmation'
        ? repository.getConversationPayload(conversation)
        : {};
      const rawText = payload.source?.raw_text || payload.text || payload.reply?.raw_text || '';
      const confirmed = payload.confirm === true || payload.reply?.confirm === true || isAffirmativeText(rawText) || payload.reply?.intent === 'confirm_edit';
      if (!confirmed) {
        if (isNegativeText(rawText) || payload.confirm === false || payload.reply?.confirm === false) {
          if (conversation) repository.resolveConversationState(conversation.id);
          return makeResult({ ok: true, code: 'PURCHASE_EDIT_CANCELLED', whatsapp: { text: 'Combinado, não alterei essa compra. Às vezes o melhor ajuste é não mexer mesmo.' } });
        }
        return makeResult({ ok: false, code: 'NEEDS_PURCHASE_EDIT_CONFIRMATION', conversation: publicConversation(conversation, repository), whatsapp: { text: 'Para aplicar essa correção, responde *confirmar*. Para desistir, responde *cancelar*.' } });
      }
      const purchaseId = payload.purchaseId || payload.purchase_id || data.purchase_id || payload.id || 'last';
      const patch = normalizeEditPatch(payload.patch || payload.edit || data.patch || {});
      const result = applyPurchaseEditMutation({ userId: resolved.user.id, phoneE164: resolved.normalized.e164, purchaseId, patch, source: payload.source || data.source || {}, meta });
      if (conversation) repository.resolveConversationState(conversation.id);
      repository.logRequest({ userId: resolved.user.id, phoneE164: resolved.normalized.e164, channel: payload.source?.channel || payload.channel || 'whatsapp', operation: 'purchase.edit.confirm', statusCode: result.statusCode, resultCode: result.code, sourceMessageId: payload.source?.message_id || payload.message_id || null, ipAddress: meta.ipAddress || null });
      return result;
    } catch (error) {
      const response = handleServiceError(error);
      repository.logRequest({ userId: resolved?.user?.id || null, phoneE164: resolved?.normalized?.e164 || null, channel: payload.source?.channel || payload.channel || 'whatsapp', operation: 'purchase.edit.confirm', statusCode: response.statusCode, resultCode: response.code, sourceMessageId: payload.source?.message_id || payload.message_id || null, ipAddress: meta.ipAddress || null });
      return response;
    }
  }

  function preparePurchaseDelete(payload = {}, meta = {}) {
    let resolved = null;
    try {
      assertApiEnabled();
      resolved = resolveAuthorizedPhone(payload.phone || payload.user_phone || payload.number);
      if (!resolved.authorized) throw new AutomationApiError('Esse número ainda não está liberado no AcerttaPay.', { code: 'NOT_AUTHORIZED', statusCode: 403 });
      const purchaseId = resolvePurchaseIdForMutation(resolved.user.id, payload.purchaseId || payload.purchase_id || payload.id || 'last');
      const rows = repository.getPurchaseScopeRows(resolved.user.id, purchaseId);
      assertRowsMutable(resolved.user.id, rows);
      const root = rows[0];
      const total = rows.reduce((sum, row) => sum + Number(row.amount_cents || 0), 0);
      const conversation = repository.createConversationState({
        userId: resolved.user.id,
        phoneE164: resolved.normalized.e164,
        channel: payload.source?.channel || payload.channel || 'whatsapp',
        state: 'awaiting_purchase_delete_confirmation',
        relatedPurchaseId: purchaseId,
        payload: { purchase_id: purchaseId, source: payload.source || {}, description: stripInstallmentMarker(root.description || ''), amount_cents: total }
      });
      const response = makeResult({
        ok: false,
        code: 'NEEDS_PURCHASE_DELETE_CONFIRMATION',
        conversation: publicConversation(conversation, repository),
        purchase: { id: purchaseId, description: stripInstallmentMarker(root.description || ''), amount_cents: total, card_name: root.card_name, installments: rows.length },
        whatsapp: { text: [`⚠️ *Confirmar exclusão?*`, '', `Vou apagar: *${stripInstallmentMarker(root.description || '')}*`, `Valor: *${formatBRLFromCents(total)}*`, `Cartão: *${root.card_name || 'cartão'}*`, rows.length > 1 ? `Parcelas afetadas: *${rows.length}*` : '', '', 'Responde *apagar* para confirmar ou *cancelar* para manter tudo como está.'].filter(Boolean).join('\n') }
      });
      repository.logRequest({ userId: resolved.user.id, phoneE164: resolved.normalized.e164, channel: payload.source?.channel || payload.channel || 'whatsapp', operation: 'purchase.delete.prepare', statusCode: response.statusCode, resultCode: response.code, sourceMessageId: payload.source?.message_id || payload.message_id || null, ipAddress: meta.ipAddress || null });
      return response;
    } catch (error) {
      const response = handleServiceError(error);
      repository.logRequest({ userId: resolved?.user?.id || null, phoneE164: resolved?.normalized?.e164 || null, channel: payload.source?.channel || payload.channel || 'whatsapp', operation: 'purchase.delete.prepare', statusCode: response.statusCode, resultCode: response.code, sourceMessageId: payload.source?.message_id || payload.message_id || null, ipAddress: meta.ipAddress || null });
      return response;
    }
  }

  function applyPurchaseDeleteMutation({ userId, phoneE164, purchaseId, source = {}, meta = {} }) {
    const idempotencyKey = String(meta.idempotencyKey || '').trim();
    const channel = source.channel || 'whatsapp';
    if (!idempotencyKey) {
      throw new AutomationApiError('Idempotency-Key é obrigatório para confirmar exclusões por WhatsApp.', {
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        statusCode: 400
      });
    }
    const rows = getMutationRows(userId, purchaseId);
    assertRowsMutable(userId, rows);
    const rootId = Number(rows[0]?.parent_txn_id || rows[0]?.id || 0);
    const idempotency = repository.tryCreateIdempotency({ userId, channel, idempotencyKey, operation: 'purchase.delete.confirm', requestHash: requestHash({ purchaseId: rootId }) });
    if (!idempotency.created) {
      const cached = safeJsonParse(idempotency.row?.response_json, null);
      if (cached) return makeResult({ ...cached, duplicate: true }, 200);
      throw new AutomationApiError('Essa exclusão já está em processamento. Não fiz duas vezes.', { code: 'IDEMPOTENCY_IN_PROGRESS', statusCode: 409 });
    }
    let response;
    try {
      const before = buildPurchaseSnapshot(userId, rows);
      repository.db.transaction(() => {
        rows.forEach((row) => {
          if (row.recurring_rule_id && row.month && row.year) {
            repository.insertRecurringException({ userId, ruleId: row.recurring_rule_id, month: row.month, year: row.year });
          }
        });
        repository.deleteTransactionsForAutomation(userId, rows);
      })();
      repository.insertAutomationMutationEvent({ userId, phoneE164, operation: 'purchase.delete', entityType: 'transaction', entityId: rootId, before, after: { deleted: true, affected_count: rows.length }, sourceMessageId: source.message_id || source.messageId || null });
      response = makeResult({ ok: true, code: 'PURCHASE_DELETED', deleted_count: rows.length, whatsapp: { text: rows.length > 1 ? `🗑️ Pronto, apaguei ${rows.length} parcelas dessa compra. Sem duplicar bagunça por aqui.` : '🗑️ Pronto, apaguei essa compra. Errou, corrigiu, vida que segue.' } });
      repository.finishIdempotency({ channel, idempotencyKey, response, status: 'success' });
      return response;
    } catch (error) {
      response = handleServiceError(error);
      repository.finishIdempotency({ channel, idempotencyKey, response, status: 'error' });
      throw error;
    }
  }

  function confirmPurchaseDelete(payload = {}, meta = {}) {
    let resolved = null;
    try {
      assertApiEnabled();
      resolved = resolveAuthorizedPhone(payload.phone || payload.user_phone || payload.number);
      if (!resolved.authorized) throw new AutomationApiError('Esse número ainda não está liberado no AcerttaPay.', { code: 'NOT_AUTHORIZED', statusCode: 403 });
      const conversation = repository.getOpenConversationForUser(resolved.user.id, resolved.normalized.e164);
      const data = conversation && String(conversation.state || '') === 'awaiting_purchase_delete_confirmation'
        ? repository.getConversationPayload(conversation)
        : {};
      const rawText = payload.source?.raw_text || payload.text || payload.reply?.raw_text || '';
      const confirmed = payload.confirm === true || payload.reply?.confirm === true || payload.reply?.intent === 'confirm_delete' || ['apagar', 'excluir', 'deletar', 'confirmar'].includes(normalizeIntentText(rawText));
      if (!confirmed) {
        if (isNegativeText(rawText) || payload.confirm === false || payload.reply?.confirm === false) {
          if (conversation) repository.resolveConversationState(conversation.id);
          return makeResult({ ok: true, code: 'PURCHASE_DELETE_CANCELLED', whatsapp: { text: 'Combinado, mantive a compra. Nada foi apagado.' } });
        }
        return makeResult({ ok: false, code: 'NEEDS_PURCHASE_DELETE_CONFIRMATION', conversation: publicConversation(conversation, repository), whatsapp: { text: 'Para apagar essa compra, responde *apagar*. Para desistir, responde *cancelar*.' } });
      }
      const purchaseId = payload.purchaseId || payload.purchase_id || data.purchase_id || payload.id || 'last';
      const result = applyPurchaseDeleteMutation({ userId: resolved.user.id, phoneE164: resolved.normalized.e164, purchaseId, source: payload.source || data.source || {}, meta });
      if (conversation) repository.resolveConversationState(conversation.id);
      repository.logRequest({ userId: resolved.user.id, phoneE164: resolved.normalized.e164, channel: payload.source?.channel || payload.channel || 'whatsapp', operation: 'purchase.delete.confirm', statusCode: result.statusCode, resultCode: result.code, sourceMessageId: payload.source?.message_id || payload.message_id || null, ipAddress: meta.ipAddress || null });
      return result;
    } catch (error) {
      const response = handleServiceError(error);
      repository.logRequest({ userId: resolved?.user?.id || null, phoneE164: resolved?.normalized?.e164 || null, channel: payload.source?.channel || payload.channel || 'whatsapp', operation: 'purchase.delete.confirm', statusCode: response.statusCode, resultCode: response.code, sourceMessageId: payload.source?.message_id || payload.message_id || null, ipAddress: meta.ipAddress || null });
      return response;
    }
  }

  function reopenParticipantsForPurchase(payload = {}, meta = {}) {
    let resolved = null;
    try {
      assertApiEnabled();
      resolved = resolveAuthorizedPhone(payload.phone || payload.user_phone || payload.number);
      if (!resolved.authorized) throw new AutomationApiError('Esse número ainda não está liberado no AcerttaPay.', { code: 'NOT_AUTHORIZED', statusCode: 403 });
      const purchaseId = resolvePurchaseIdForMutation(resolved.user.id, payload.purchaseId || payload.purchase_id || payload.id || 'last');
      const rows = repository.getPurchaseScopeRows(resolved.user.id, purchaseId);
      assertRowsMutable(resolved.user.id, rows);
      const selected = selectedPurchaseLabelFromRows(rows);
      const options = purchaseService.getSplitOptions({ userId: resolved.user.id, purchaseId });
      const conversation = repository.createConversationState({
        userId: resolved.user.id,
        phoneE164: resolved.normalized.e164,
        channel: payload.source?.channel || payload.channel || 'whatsapp',
        state: 'awaiting_split_participants',
        relatedPurchaseId: purchaseId,
        payload: {
          purchase_id: purchaseId,
          options: options.options,
          purchase_total_cents: selected.amount_cents,
          purchase_description: selected.description,
          purchase_card_name: selected.card_name
        }
      });
      const names = options.options.map((option, index) => `${index + 1}. ${option.label || option.name}`).join('\n');
      const response = makeResult({
        ok: false,
        code: 'NEEDS_SPLIT_PARTICIPANTS',
        conversation: publicConversation(conversation, repository),
        purchase: { id: purchaseId, ...selected },
        options: options.options,
        whatsapp: {
          text: [
            `Vamos dividir: *${selected.description}* — *${formatBRLFromCents(selected.amount_cents)}* no ${selected.card_name}.`,
            '',
            '*Com quem vai ficar essa compra?*',
            names,
            '',
            'Pode responder *Apenas eu*, *Ana* ou *Eu, Ana e Bruno*. Se você também entra no rateio, escreva *Eu* junto.'
          ].join('\n')
        }
      });
      repository.logRequest({ userId: resolved.user.id, phoneE164: resolved.normalized.e164, channel: payload.source?.channel || payload.channel || 'whatsapp', operation: 'purchase.participants.reopen', statusCode: response.statusCode, resultCode: response.code, sourceMessageId: payload.source?.message_id || payload.message_id || null, ipAddress: meta.ipAddress || null });
      return response;
    } catch (error) {
      const response = handleServiceError(error);
      repository.logRequest({ userId: resolved?.user?.id || null, phoneE164: resolved?.normalized?.e164 || null, channel: payload.source?.channel || payload.channel || 'whatsapp', operation: 'purchase.participants.reopen', statusCode: response.statusCode, resultCode: response.code, sourceMessageId: payload.source?.message_id || payload.message_id || null, ipAddress: meta.ipAddress || null });
      return response;
    }
  }

  function handleServiceError(error) {
    if (error instanceof AutomationApiError || error instanceof PurchaseCreationError) {
      return makeResult({
        ok: false,
        code: error.code || 'VALIDATION_ERROR',
        message: error.message,
        details: error.details || null,
        whatsapp: { text: error.message }
      }, error.statusCode || 400);
    }
    return makeResult({
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'Algo tropeçou por aqui. Tenta de novo que eu seguro as pontas deste lado.',
      whatsapp: { text: 'Algo tropeçou por aqui. Tenta de novo que eu seguro as pontas deste lado.' }
    }, 500);
  }

  function resolveWhatsapp(payload = {}, meta = {}) {
    try {
      assertApiEnabled();
      const resolved = resolveAuthorizedPhone(payload.phone || payload.user_phone || payload.number);
      const code = resolved.authorized ? 'AUTHORIZED' : 'NOT_AUTHORIZED';
      if (!resolved.authorized) {
        const response = makeResult({
          ok: false,
          authorized: false,
          code,
          whatsapp: {
            text: 'Esse número ainda não está liberado no AcerttaPay. Entra no app e ativa o WhatsApp em Configurações.'
          }
        }, 200);
        repository.logRequest({
          userId: resolved.authorization?.user_id || null,
          phoneE164: resolved.normalized?.e164 || null,
          channel: payload.channel || 'whatsapp',
          operation: 'whatsapp.resolve',
          statusCode: response.statusCode,
          resultCode: code,
          sourceMessageId: payload.message_id || null,
          ipAddress: meta.ipAddress || null
        });
        return response;
      }

      checkRateLimit(resolved.normalized.e164);
      const conversation = repository.getOpenConversationForUser(resolved.user.id, resolved.normalized.e164);
      const response = makeResult({
        ok: true,
        authorized: true,
        code,
        user: {
          id: Number(resolved.user.id || 0),
          name: resolved.user.name || resolved.user.email || 'Usuário AcerttaPay',
          email: resolved.user.email
        },
        phone: {
          e164: resolved.normalized.e164,
          whatsapp_number: resolved.normalized.whatsappNumber
        },
        conversation: publicConversation(conversation, repository)
      });
      repository.logRequest({
        userId: resolved.user.id,
        phoneE164: resolved.normalized.e164,
        channel: payload.channel || 'whatsapp',
        operation: 'whatsapp.resolve',
        statusCode: response.statusCode,
        resultCode: code,
        sourceMessageId: payload.message_id || null,
        ipAddress: meta.ipAddress || null
      });
      return response;
    } catch (error) {
      const response = handleServiceError(error);
      repository.logRequest({
        userId: null,
        phoneE164: null,
        channel: payload.channel || 'whatsapp',
        operation: 'whatsapp.resolve',
        statusCode: response.statusCode,
        resultCode: response.code,
        sourceMessageId: payload.message_id || null,
        ipAddress: meta.ipAddress || null
      });
      return response;
    }
  }


  function workflowEnabledForUser(userId, workflow = {}) {
    if (!workflow || !workflow.workflow_key) return false;
    if (Number(workflow.enabled || 0) === 0) return false;
    if (Number(workflow.maintenance_mode || 0) !== 0) return false;
    return operationsRepository.isUserWorkflowEnabled(userId, workflow.workflow_key);
  }

  function buildRouterCapabilitiesForUser(userId) {
    return operationsRepository.listWorkflows()
      .filter((workflow) => {
        const key = String(workflow.workflow_key || '');
        return !['automation-api', '9.1'].includes(key) && AUTOMATION_WHATSAPP_SIMPLE_WORKFLOWS.has(key);
      })
      .map((workflow) => ({
        workflow_key: workflow.workflow_key,
        family_key: workflow.family_key,
        name: workflow.name,
        title: workflow.title || workflow.name,
        description: workflow.description || '',
        risk_level: workflow.risk_level || 'medium',
        enabled: workflowEnabledForUser(userId, workflow),
        maintenance_mode: Number(workflow.maintenance_mode || 0) !== 0,
        rate_limit_per_minute: Number(workflow.rate_limit_per_minute || 0) || null
      }));
  }

  function buildRouterMenuText(capabilities = []) {
    const enabled = new Set((capabilities || []).filter((item) => item.enabled).map((item) => item.workflow_key));
    const sections = [];
    if (enabled.has('1.1') || enabled.has('1.2') || enabled.has('1.3') || enabled.has('1.4')) sections.push(['🧾 Compras', '• registrar compra por texto', '• enviar foto de comprovante', '• corrigir ou apagar compra por fatura/mês', '• dividir uma compra escolhida com amigos ou contatos'].join('\n'));
    if (enabled.has('2.1')) sections.push(['📊 Consultas', '• gastos do mês', '• fatura do cartão', '• listar compras por fatura/mês'].join('\n'));
    if (enabled.has('3.1')) sections.push(['⏰ Lembretes', '• criar, listar, concluir ou adiar lembretes'].join('\n'));
    if (enabled.has('5.1')) sections.push(['📒 Finanças mensais', '• lançar aluguel, salário, contas e receitas fora do cartão'].join('\n'));
    if (enabled.has('7.1')) sections.push(['📄 PDF', '• enviar fatura para revisão no app'].join('\n'));
    const body = sections.length ? sections.join('\n\n') : 'Nenhuma função do WhatsApp está liberada para este usuário agora.';
    return ['Oi! Eu sou o concierge do AcerttaPay. 🟢', '', 'Posso te ajudar com:', '', body, '', 'Me manda do seu jeito. Ex.: “Quanto gastei esse mês?” ou “Nova compra hoje de R$ 50 no iFood”.'].join('\n');
  }

  function buildRouterPayloadSource(payload = {}) {
    const whatsapp = payload.whatsapp && typeof payload.whatsapp === 'object' ? payload.whatsapp : {};
    return {
      phone: payload.phone || whatsapp.phone || payload.user_phone || payload.number || '',
      channel: payload.source?.channel || payload.channel || 'whatsapp',
      instance: payload.source?.instance || whatsapp.instance || payload.instance || '',
      message_id: payload.source?.message_id || whatsapp.message_id || payload.message_id || '',
      push_name: payload.push_name || whatsapp.push_name || '',
      raw_text: payload.source?.raw_text || payload.source?.rawText || whatsapp.message_text || payload.message_text || payload.text || ''
    };
  }

  function normalizeRouterText(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  function looksLikeRouterNewTopic(rawText) {
    const text = normalizeRouterText(rawText);
    if (!text) return false;
    const menuLike = /^(oi|ola|bom dia|boa tarde|boa noite|ajuda|menu|o que voce faz\??)$/i.test(text);
    const queryLike = /(quanto|qto|gastei|gasto|gastos|ultimas compras|ultimos lancamentos|listar.*compras|lista.*compras|compras?.*(dezembro|janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|mes|ano)|fatura|resumo|quem me deve|o que devo|central de acertos|fechamento|categoria)/i.test(text);
    const newActionLike = /(nova compra|comprei|passei no cartao|corrigir uma compra|corrige uma compra|apagar uma compra|dividir uma compra|dividir compras|lancar|lanca|lança|adicionar|cadastrar|criar lembrete|me lembra|enviar.*fatura|mandar.*fatura|pdf|importar.*fatura|comprovante|foto.*compra|imagem.*compra)/i.test(text);
    return menuLike || queryLike || newActionLike;
  }

  function looksLikeRouterContinuation(state, rawText) {
    const text = normalizeRouterText(rawText);
    if (!state || !text) return true;
    const commandLike = /^(sim|s|ok|confirmar|confirma|pode|pode sim|aplica|aplicar|manda|enviar|cancelar|cancela|cancelado|desistir|desisto|desisti|descartar|descarta|parar|para|sair|voltar|deixa|deixa pra la|deixa para la|esquece|nao|não|n)$/.test(text);
    if (commandLike) return true;
    if (/awaiting_card/.test(state)) return /(cartao|cartao|nubank|itau|itaucard|visa|master|elo|\b\d+\b|sim|nao|não|trocar|outro)/i.test(text);
    if (/awaiting_split|awaiting_exact/.test(state)) return /(eu|apenas eu|partes iguais|igual|valores|definidos|ana|bruno|,|\b\d+[,.]?\d*\b)/i.test(text);
    if (/awaiting_pdf_import_details/.test(state)) return /(cartao|nubank|itau|mes|ano|janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|\b20\d{2}\b)/i.test(text);
    if (/awaiting_receipt_purchase/.test(state)) {
      if (looksLikeRouterNewTopic(rawText)) return false;
      return /(corrigir|valor|data|cartao|cartão|parcela|compra|loja|estabelecimento|nubank|inter|itau|itaú|visa|master|elo|\b\d+[,.]?\d*\b)/i.test(text)
        || (state === 'awaiting_receipt_purchase_details' && text.length <= 90);
    }
    if (/awaiting_purchase_(edit|delete|create)_confirmation/.test(state)) return /^(sim|s|ok|confirmar|confirma|pode|aplica|apagar|excluir|deletar|cancelar|cancela|nao|não|n)$/.test(text);
    return /^(sim|s|ok|confirmar|cancelar|nao|não|n)$/.test(text);
  }

  function shouldInterruptRouterConversation(conversation, rawText) {
    const state = String(conversation?.state || '').trim();
    if (!state) return false;
    return looksLikeRouterNewTopic(rawText) && !looksLikeRouterContinuation(state, rawText);
  }

  function buildRouterContext(payload = {}, meta = {}) {
    try {
      assertApiEnabled();
      const source = buildRouterPayloadSource(payload);
      const resolved = resolveAuthorizedPhone(source.phone);
      const base = {
        ok: true,
        code: resolved.authorized ? 'ROUTER_CONTEXT_READY' : 'ROUTER_NOT_AUTHORIZED',
        authorized: resolved.authorized,
        phone: resolved.normalized ? { e164: resolved.normalized.e164, whatsapp_number: resolved.normalized.whatsappNumber } : null,
        whatsapp: {
          phone: resolved.normalized?.whatsappNumber || normalizeDigits(source.phone),
          phone_e164: resolved.normalized?.e164 || null,
          instance: source.instance || null,
          message_id: source.message_id || null,
          push_name: source.push_name || null
        }
      };
      if (!resolved.authorized) {
        return makeResult({
          ...base,
          ok: false,
          user: null,
          conversation: null,
          capabilities: [],
          whatsapp: {
            ...base.whatsapp,
            text: 'Esse número ainda não está liberado no AcerttaPay. Entra no app e ativa o WhatsApp em Configurações.'
          }
        }, 200);
      }
      checkRateLimit(resolved.normalized.e164);
      const conversation = repository.getOpenConversationForUser(resolved.user.id, resolved.normalized.e164);
      // A decisão de continuar, cancelar ou trocar de assunto fica com o roteador de IA do n8n.
      // O backend apenas entrega o estado pendente como contexto e aplica a resolução quando o
      // roteador registra uma interrupção explícita com o id da conversa.
      const interruptedConversation = null;
      const capabilities = buildRouterCapabilitiesForUser(resolved.user.id);
      return makeResult({
        ...base,
        user: {
          id: Number(resolved.user.id || 0),
          name: resolved.user.name || resolved.user.email || 'Usuário AcerttaPay',
          email: resolved.user.email
        },
        conversation: publicConversation(conversation, repository),
        interrupted_conversation: interruptedConversation,
        capabilities,
        menu: { text: buildRouterMenuText(capabilities) },
        router: { workflow_key: '0.0', family_key: '0.x' }
      });
    } catch (error) {
      return handleServiceError(error);
    }
  }

  function buildRouterCapabilities(payload = {}, meta = {}) {
    const context = buildRouterContext(payload, meta);
    if (context.ok === false) return context;
    return makeResult({
      ok: true,
      code: 'ROUTER_CAPABILITIES',
      user: context.user,
      phone: context.phone,
      capabilities: context.capabilities || [],
      menu: context.menu || { text: buildRouterMenuText(context.capabilities || []) }
    });
  }

  function recordRouterIntent(payload = {}, meta = {}) {
    try {
      const phone = payload.phone || payload.whatsapp?.phone || payload.source?.phone || '';
      let phoneE164 = null;
      let userId = Number(payload.user?.id || payload.user_id || 0) || null;
      const normalized = phone ? normalizeAutomationPhone(phone) : null;
      if (normalized?.ok) {
        phoneE164 = normalized.e164;
        if (!userId) {
          const found = operationsRepository.findAutomationUserByPhone(normalized.e164);
          userId = Number(found?.user_id || 0) || null;
        }
      }
      const requestMeta = payload.request_meta || payload.requestMeta || {};
      const interruptConversationId = Number(requestMeta.interrupt_conversation_id || requestMeta.interrupted_conversation_id || 0);
      let interruptedConversationResolved = false;
      if (requestMeta.interrupt_conversation === true && interruptConversationId > 0) {
        repository.resolveConversationState(interruptConversationId);
        interruptedConversationResolved = true;
      }

      operationsRepository.logIntentEvent({
        userId,
        phoneE164,
        workflowKey: payload.workflow_key || payload.router?.workflow_key || '0.0',
        familyKey: payload.family_key || payload.router?.family_key || '0.x',
        intent: payload.intent || payload.router?.intent || null,
        operation: payload.operation || 'router.intent',
        statusCode: payload.status_code || 200,
        resultCode: payload.result_code || payload.code || 'ROUTER_INTENT_RECORDED',
        channel: payload.channel || payload.source?.channel || 'whatsapp',
        sourceMessageId: payload.source_message_id || payload.source?.message_id || payload.whatsapp?.message_id || null,
        requestMeta,
        responseMeta: {
          ...(payload.response_meta || payload.responseMeta || {}),
          interrupted_conversation_resolved: interruptedConversationResolved
        }
      });
      return makeResult({ ok: true, code: 'ROUTER_INTENT_RECORDED', interrupted_conversation_resolved: interruptedConversationResolved });
    } catch (error) {
      return handleServiceError(error);
    }
  }

  function createPurchaseFromAutomation(payload = {}, meta = {}) {
    const channel = payload.source?.channel || payload.channel || 'whatsapp';
    const sourceMessageId = payload.source?.message_id || payload.source?.messageId || payload.message_id || null;
    const idempotencyKey = String(meta.idempotencyKey || payload.idempotency_key || '').trim();
    let resolved = null;
    let idempotencyCreated = false;

    try {
      assertApiEnabled();
      if (!idempotencyKey) {
        throw new AutomationApiError('Idempotency-Key é obrigatório para criar compra por automação.', {
          code: 'IDEMPOTENCY_KEY_REQUIRED',
          statusCode: 400
        });
      }
      resolved = resolveAuthorizedPhone(payload.phone || payload.user_phone || payload.number);
      if (!resolved.authorized) {
        throw new AutomationApiError('Esse número ainda não está liberado no AcerttaPay.', {
          code: 'NOT_AUTHORIZED',
          statusCode: 403
        });
      }
      checkRateLimit(resolved.normalized.e164);

      const purchase = payload.purchase || {};
      if (!canBypassPurchaseCreateConfirmation(payload, meta)) {
        const response = buildPurchaseCreateConfirmationResponse({
          userId: resolved.user.id,
          phoneE164: resolved.normalized.e164,
          purchase,
          source: payload.source || {}
        });
        repository.logRequest({
          userId: resolved.user.id,
          phoneE164: resolved.normalized.e164,
          channel,
          operation: 'purchase.create.prepare',
          statusCode: response.statusCode,
          resultCode: response.code,
          sourceMessageId,
          ipAddress: meta.ipAddress || null
        });
        return response;
      }

      const idempotency = repository.tryCreateIdempotency({
        userId: resolved.user.id,
        channel,
        idempotencyKey,
        operation: 'purchase.create',
        requestHash: requestHash(payload)
      });

      if (!idempotency.created) {
        const cached = safeJsonParse(idempotency.row?.response_json, null);
        if (cached) return makeResult({ ...cached, duplicate: true }, 200);
        throw new AutomationApiError('Essa mensagem já está sendo processada. Não dupliquei a compra.', {
          code: 'IDEMPOTENCY_IN_PROGRESS',
          statusCode: 409
        });
      }
      idempotencyCreated = true;

      const requestedCardId = Number(purchase.card_id || purchase.cardId || 0) || null;
      const cardHint = purchase.card_hint || purchase.cardHint || payload.card_hint || payload.cardHint || '';
      const cardHintAlreadyConfirmed = payload.card_hint_confirmed === true
        || payload.confirmed_card_hint === true
        || payload.skip_card_confirmation === true
        || purchase.card_hint_confirmed === true
        || purchase.confirmed_card_hint === true;
      let response;
      if (!requestedCardId) {
        const activeCards = repository.getActiveCards(resolved.user.id);
        if (!activeCards.length) {
          response = makeResult({
            ok: false,
            code: 'NO_ACTIVE_CARD',
            whatsapp: { text: 'Você ainda não tem cartão ativo para lançar essa compra. Crie ou reative um cartão no AcerttaPay primeiro.' }
          }, 409);
        } else if (cardHint) {
          const suggestedCard = resolveCardByHint(activeCards, cardHint);
          response = suggestedCard
            ? (cardHintAlreadyConfirmed
              ? createPurchaseWithResolvedCard({
                userId: resolved.user.id,
                phoneE164: resolved.normalized.e164,
                purchase,
                source: payload.source || {},
                cardId: suggestedCard.id
              })
              : buildCardConfirmationResponse({
                userId: resolved.user.id,
                phoneE164: resolved.normalized.e164,
                purchase,
                source: payload.source || {},
                cards: activeCards,
                suggestedCard,
                cardHint
              }))
            : buildCardSelectionResponse({
              userId: resolved.user.id,
              phoneE164: resolved.normalized.e164,
              purchase,
              source: payload.source || {},
              cards: activeCards
            });
        } else if (activeCards.length === 1) {
          response = createPurchaseWithResolvedCard({
            userId: resolved.user.id,
            phoneE164: resolved.normalized.e164,
            purchase,
            source: payload.source || {},
            cardId: activeCards[0].id
          });
        } else {
          response = buildCardSelectionResponse({
            userId: resolved.user.id,
            phoneE164: resolved.normalized.e164,
            purchase,
            source: payload.source || {},
            cards: activeCards
          });
        }
      } else {
        response = createPurchaseWithResolvedCard({
          userId: resolved.user.id,
          phoneE164: resolved.normalized.e164,
          purchase,
          source: payload.source || {},
          cardId: requestedCardId
        });
      }

      repository.finishIdempotency({ channel, idempotencyKey, response, status: response.ok ? 'success' : 'completed' });
      repository.logRequest({
        userId: resolved.user.id,
        phoneE164: resolved.normalized.e164,
        channel,
        operation: 'purchase.create',
        statusCode: response.statusCode,
        resultCode: response.code,
        sourceMessageId,
        ipAddress: meta.ipAddress || null
      });
      return response;
    } catch (error) {
      const response = handleServiceError(error);
      if (idempotencyCreated && idempotencyKey && resolved?.authorized) {
        repository.finishIdempotency({ channel, idempotencyKey, response, status: 'error' });
      }
      repository.logRequest({
        userId: resolved?.user?.id || null,
        phoneE164: resolved?.normalized?.e164 || null,
        channel,
        operation: 'purchase.create',
        statusCode: response.statusCode,
        resultCode: response.code,
        sourceMessageId,
        ipAddress: meta.ipAddress || null
      });
      return response;
    }
  }

  function getSplitOptionsForPurchase(payload = {}, meta = {}) {
    try {
      assertApiEnabled();
      const resolved = resolveAuthorizedPhone(payload.phone || payload.user_phone || payload.number);
      if (!resolved.authorized) {
        throw new AutomationApiError('Esse número ainda não está liberado no AcerttaPay.', {
          code: 'NOT_AUTHORIZED',
          statusCode: 403
        });
      }
      const options = purchaseService.getSplitOptions({ userId: resolved.user.id, purchaseId: payload.purchaseId || payload.purchase_id });
      const names = options.options.map((option, index) => `${index + 1}. ${option.label || option.name}`).join('\n');
      return makeResult({
        ok: true,
        code: 'SPLIT_OPTIONS',
        ...options,
        whatsapp: { text: `Quem participa dessa compra? ${names}. Se você também entra no rateio, responda "Eu" junto com os nomes. Ex.: "Eu, Ana e Bruno". Para deixar só com você, responda "Apenas eu". Contatos locais entram só no seu controle interno; amigos com Acerto disponível geram rascunho no app.` }
      });
    } catch (error) {
      return handleServiceError(error);
    }
  }

  function splitPurchaseFromAutomation(payload = {}, meta = {}) {
    try {
      assertApiEnabled();
      const resolved = resolveAuthorizedPhone(payload.phone || payload.user_phone || payload.number);
      if (!resolved.authorized) {
        throw new AutomationApiError('Esse número ainda não está liberado no AcerttaPay.', {
          code: 'NOT_AUTHORIZED',
          statusCode: 403
        });
      }
      const result = purchaseService.applySplit({
        userId: resolved.user.id,
        purchaseId: payload.purchaseId || payload.purchase_id,
        mode: payload.mode,
        participants: mergeSelfParticipant(payload.participants || [], payload, payload.source?.raw_text || payload.raw_text || payload.text || ''),
        shares: payload.shares
      });
      const queueCount = Number(result.queue_summary?.itemCount || 0);
      return makeResult({
        ok: true,
        code: 'SPLIT_APPLIED',
        split: result,
        whatsapp: {
          text: queueCount > 0
            ? `Divisão salva. ${queueCount} item(ns) foram para a área de acertos do app, sem enviar nada automaticamente.`
            : 'Divisão salva. Ficou tudo redondinho por aqui.'
        }
      });
    } catch (error) {
      return handleServiceError(error);
    }
  }

  function participantToken(entry) {
    if (entry && typeof entry === 'object') {
      return entry.participant ?? entry.id ?? entry.person_id ?? entry.personId ?? entry.name ?? entry.label;
    }
    return entry;
  }

  function normalizeParticipantToken(entry) {
    const token = participantToken(entry);
    const normalized = normalizeIntentText(token);
    if (['self', 'eu', 'mim', 'me', 'apenas eu', 'so eu', 'só eu', 'somente eu'].includes(normalized)) return 'self';
    return token;
  }

  function uniqueParticipants(values = []) {
    const seen = new Set();
    const out = [];
    (Array.isArray(values) ? values : [values]).forEach((entry) => {
      const token = normalizeParticipantToken(entry);
      const key = String(token ?? '').trim();
      if (!key) return;
      const normalizedKey = key.toLowerCase();
      if (seen.has(normalizedKey)) return;
      seen.add(normalizedKey);
      out.push(token);
    });
    return out;
  }

  function hasOnlySelfIntent(reply = {}, normalizedText = '') {
    if (reply.only_self === true || reply.intent === 'only_self') return true;
    const text = normalizedText || '';
    return text === 'eu'
      || text === 'so eu'
      || text === 'só eu'
      || text === 'somente eu'
      || text.includes('apenas eu')
      || text.includes('so comigo')
      || text.includes('só comigo');
  }

  function hasSelfParticipantIntent(reply = {}, normalizedText = '') {
    if (reply.include_self === true || reply.with_self === true) return true;
    const text = ` ${normalizedText || ''} `;
    if (!text.trim()) return false;
    if (hasOnlySelfIntent(reply, normalizedText)) return true;
    return /(^|[\s,;+/&])(eu|mim)(?=$|[\s,;+/&])/.test(text);
  }

  function mergeSelfParticipant(participants = [], reply = {}, rawText = '') {
    const normalized = normalizeIntentText(rawText || reply.text || reply.raw_text || '');
    const selected = uniqueParticipants(participants);
    if (hasSelfParticipantIntent(reply, normalized)) {
      return uniqueParticipants(['self', ...selected]);
    }
    return selected;
  }

  function parseParticipantsFromReply(reply = {}, text = '', options = []) {
    const normalized = normalizeIntentText(text || reply.text || reply.raw_text || '');
    if (hasOnlySelfIntent(reply, normalized)) return ['self'];

    if (Array.isArray(reply.participants) && reply.participants.length) {
      return mergeSelfParticipant(reply.participants, reply, normalized);
    }

    if (Array.isArray(reply.shares) && reply.shares.length) {
      return reply.shares.map((row) => row.participant ?? row.id ?? row.person_id ?? row.name).filter(Boolean);
    }

    const selected = [];
    if (normalized) {
      options.forEach((option, index) => {
        const label = normalizeIntentText(option.label || option.name);
        if (!label) return;
        if (normalized.includes(label) || normalized.split(/[,+/& e]+/).includes(label)) selected.push(option.id);
        if (normalized === String(index + 1)) selected.push(option.id);
      });
    }

    return mergeSelfParticipant(selected, reply, normalized);
  }

  function parseModeFromReply(reply = {}, text = '') {
    const direct = String(reply.mode || reply.split_mode || '').trim().toLowerCase();
    if (direct === 'equal' || direct === 'exact') return direct;
    return parseSplitModeFromText(text || reply.text || reply.raw_text || '');
  }

  function applySplitForConversation({ userId, purchaseId, mode, participants, shares }) {
    return purchaseService.applySplit({ userId, purchaseId, mode, participants, shares });
  }

  function handleConversationReply(payload = {}, meta = {}) {
    let resolved = null;
    let conversation = null;
    let data = {};
    let state = '';
    try {
      assertApiEnabled();
      resolved = resolveAuthorizedPhone(payload.phone || payload.user_phone || payload.number);
      if (!resolved.authorized) {
        throw new AutomationApiError('Esse número ainda não está liberado no AcerttaPay.', {
          code: 'NOT_AUTHORIZED',
          statusCode: 403
        });
      }
      checkRateLimit(resolved.normalized.e164);
      const conversation = repository.getOpenConversationForUser(resolved.user.id, resolved.normalized.e164);
      if (!conversation) {
        return makeResult({
          ok: false,
          code: 'NO_PENDING_CONVERSATION',
          whatsapp: { text: 'Não encontrei uma conversa pendente. Me manda a compra completa para começarmos de novo?' }
        }, 404);
      }

      data = repository.getConversationPayload(conversation) || {};
      const reply = payload.reply || {};
      const rawText = payload.source?.raw_text || payload.source?.rawText || reply.text || payload.text || '';
      state = String(conversation.state || '').trim();

      if (reply.abandon === true || reply.intent === 'new_topic') {
        repository.resolveConversationState(conversation.id);
        return makeResult({
          ok: true,
          code: 'CONVERSATION_INTERRUPTED',
          whatsapp: { text: 'Parei aquela ação pendente para não misturar assuntos. Me manda o novo pedido do jeito que você quer seguir.' }
        });
      }

      if (state === 'awaiting_purchase_mutation_period' || state === 'awaiting_purchase_participants_period') {
        const purpose = state === 'awaiting_purchase_participants_period' ? 'participants' : 'mutation';
        const period = resolvePurchasePeriodInput({ raw_text: rawText, text: rawText, ...reply });
        if (!period) {
          return makeResult({
            ok: false,
            code: 'NEEDS_PURCHASE_PERIOD',
            conversation: publicConversation(conversation, repository),
            whatsapp: { text: monthQuestionForPurpose(purpose) }
          });
        }
        repository.resolveConversationState(conversation.id);
        return listRecentPurchases({
          phone: resolved.normalized.e164,
          source: payload.source || data.source || {},
          purpose,
          limit: data.limit || (purposeWantsParticipants(purpose) ? 8 : 8),
          month: period.month,
          year: period.year
        }, meta);
      }

      if (state === 'awaiting_purchase_selection_for_participants') {
        const purchases = Array.isArray(data.purchases) ? data.purchases : [];
        const purchaseId = Number(reply.purchase_id || reply.purchaseId || parsePurchaseSelectionFromText(rawText, purchases) || data.selected_purchase_id || 0);
        if (!purchaseId) {
          return makeResult({
            ok: false,
            code: 'NEEDS_PURCHASE_SELECTION',
            conversation: publicConversation(conversation, repository),
            whatsapp: { text: 'Me diz qual compra da lista você quer dividir. Pode responder com o *número* ou com o *código #*.' }
          });
        }
        repository.resolveConversationState(conversation.id);
        return reopenParticipantsForPurchase({
          phone: resolved.normalized.e164,
          source: payload.source || data.source || {},
          purchaseId,
          purchase_id: purchaseId
        }, meta);
      }

      if (state === 'awaiting_purchase_selection_for_correction' || state === 'awaiting_purchase_correction_details') {
        const purchases = Array.isArray(data.purchases) ? data.purchases : [];
        const selectedId = Number(data.selected_purchase_id || 0);
        const purchaseId = Number(reply.purchase_id || reply.purchaseId || parsePurchaseSelectionFromText(rawText, purchases) || selectedId || 0);
        if (!purchaseId) {
          return makeResult({
            ok: false,
            code: 'NEEDS_PURCHASE_SELECTION',
            conversation: publicConversation(conversation, repository),
            whatsapp: { text: 'Me diz qual compra da lista você quer ajustar. Pode responder com o *número* ou com o *código #*.' }
          });
        }
        const action = detectPurchaseMutationAction(rawText || reply.intent || '');
        const patch = normalizeEditPatch(reply.patch || parseSimpleEditPatchFromText(rawText));
        if (action === 'delete') {
          repository.resolveConversationState(conversation.id);
          return preparePurchaseDelete({ phone: resolved.normalized.e164, source: payload.source || data.source || {}, purchaseId, purchase_id: purchaseId }, meta);
        }
        if (action === 'split') {
          repository.resolveConversationState(conversation.id);
          return reopenParticipantsForPurchase({ phone: resolved.normalized.e164, source: payload.source || data.source || {}, purchaseId, purchase_id: purchaseId }, meta);
        }
        if (patchHasMutation(patch)) {
          repository.resolveConversationState(conversation.id);
          return preparePurchaseEdit({ phone: resolved.normalized.e164, source: payload.source || data.source || {}, purchaseId, purchase_id: purchaseId, patch }, meta);
        }
        const listedPurchase = findListedPurchaseById(purchases, purchaseId);
        const selected = listedPurchase
          ? selectedPurchaseLabelFromListedPurchase(listedPurchase)
          : selectedPurchaseLabelFromRows(repository.getPurchaseScopeRows(resolved.user.id, purchaseId));
        const next = repository.updateConversationState(conversation.id, {
          state: 'awaiting_purchase_correction_details',
          payload: { ...data, selected_purchase_id: purchaseId, selected_purchase: selected },
          relatedPurchaseId: purchaseId
        });
        return makeResult({
          ok: false,
          code: 'NEEDS_PURCHASE_CORRECTION_DETAILS',
          conversation: publicConversation(next, repository),
          whatsapp: { text: [`Beleza, achei: *${selected.description}* — *${formatBRLFromCents(selected.amount_cents)}* no ${selected.card_name}.`, '', 'O que você quer fazer?', '• *valor 89,90*', '• *apagar*', '• *dividir*'].join('\n') }
        });
      }

      if (state === 'awaiting_receipt_purchase_confirmation' || state === 'awaiting_receipt_purchase_details') {
        return receiptPurchasesService.handleConversationReply(payload, meta);
      }

      if (state === 'awaiting_purchase_create_confirmation') {
        if (isNegativeText(rawText) || reply.confirm === false || reply.intent === 'cancel_purchase_create') {
          repository.resolveConversationState(conversation.id);
          return makeResult({
            ok: true,
            code: 'PURCHASE_CREATE_CANCELLED',
            whatsapp: { text: 'Fechado, não lancei essa compra. Cartão salvo do susto. 😉' }
          });
        }
        if (!isAffirmativeText(rawText) && reply.confirm !== true && reply.intent !== 'confirm_purchase_create') {
          return makeResult({
            ok: false,
            code: 'NEEDS_PURCHASE_CREATE_CONFIRMATION',
            conversation: publicConversation(conversation, repository),
            whatsapp: { text: 'Para lançar essa compra, responde *confirmar*. Para desistir, responde *cancelar*.' }
          });
        }
        repository.resolveConversationState(conversation.id);
        const confirmedPurchase = data.purchase || {};
        const confirmedCardHint = confirmedPurchase.card_hint || confirmedPurchase.cardHint || '';
        return createPurchaseFromAutomation({
          phone: resolved.normalized.e164,
          purchase: confirmedPurchase,
          source: payload.source || data.source || {},
          confirmed: true,
          card_hint_confirmed: Boolean(confirmedCardHint)
        }, { ...meta, confirmedByConversationReply: true });
      }

      if (state === 'awaiting_card_confirmation') {
        const cards = Array.isArray(data.cards) ? data.cards : [];
        const suggestedCardId = Number(data.suggested_card_id || data.suggested_card?.id || 0);
        const selectedCardId = parseCardIdFromReply(reply, rawText, cards);

        if (selectedCardId && selectedCardId !== suggestedCardId) {
          repository.resolveConversationState(conversation.id);
          return createPurchaseWithResolvedCard({
            userId: resolved.user.id,
            phoneE164: resolved.normalized.e164,
            purchase: data.purchase || {},
            source: payload.source || data.source || {},
            cardId: selectedCardId
          });
        }

        if (isNegativeText(rawText) || reply.confirm === false || reply.intent === 'decline_card' || reply.intent === 'change_card') {
          const next = repository.updateConversationState(conversation.id, {
            state: 'awaiting_card_choice',
            payload: { ...data, cards },
            relatedPurchaseId: null
          });
          const cardList = cards.map((card) => `${card.option}. ${card.label}`).join('\n');
          return makeResult({
            ok: false,
            code: 'NEEDS_CARD_SELECTION',
            conversation: publicConversation(next, repository),
            cards,
            whatsapp: { text: `Sem problema. Qual cartão foi então? ${cardList}` }
          });
        }

        if (selectedCardId || isAffirmativeText(rawText) || reply.confirm === true || reply.intent === 'confirm_card') {
          repository.resolveConversationState(conversation.id);
          return createPurchaseWithResolvedCard({
            userId: resolved.user.id,
            phoneE164: resolved.normalized.e164,
            purchase: data.purchase || {},
            source: payload.source || data.source || {},
            cardId: selectedCardId || suggestedCardId
          });
        }

        return makeResult({
          ok: false,
          code: 'NEEDS_CARD_CONFIRMATION',
          conversation: publicConversation(conversation, repository),
          card: data.suggested_card || cards.find((card) => Number(card.id || 0) === suggestedCardId) || null,
          cards,
          whatsapp: { text: `Confirma se foi no cartão ${data.suggested_card?.label || 'que eu identifiquei'}? Responde sim ou não.` }
        });
      }

      if (state === 'awaiting_card_choice') {
        const cards = Array.isArray(data.cards) ? data.cards : [];
        const selectedCardId = parseCardIdFromReply(reply, rawText, cards);
        if (!selectedCardId) {
          const cardList = cards.map((card) => `${card.option}. ${card.label}`).join('\n');
          return makeResult({
            ok: false,
            code: 'NEEDS_CARD_SELECTION',
            conversation: publicConversation(conversation, repository),
            cards,
            whatsapp: { text: `Não identifiquei o cartão. Escolhe pelo número ou nome: ${cardList}` }
          });
        }
        repository.resolveConversationState(conversation.id);
        return createPurchaseWithResolvedCard({
          userId: resolved.user.id,
          phoneE164: resolved.normalized.e164,
          purchase: data.purchase || {},
          source: payload.source || data.source || {},
          cardId: selectedCardId
        });
      }

      if (state === 'awaiting_split_confirmation') {
        const purchaseId = Number(data.purchase_id || conversation.related_purchase_id || 0);
        if (isNegativeText(rawText) || reply.intent === 'skip_split' || reply.confirm === false) {
          repository.resolveConversationState(conversation.id);
          return makeResult({
            ok: true,
            code: 'SPLIT_SKIPPED',
            whatsapp: { text: 'Fechado, deixei essa compra só com você. Sem plateia no boleto dessa vez.' }
          });
        }
        if (!isAffirmativeText(rawText) && reply.confirm !== true && reply.intent !== 'confirm_split') {
          return makeResult({
            ok: false,
            code: 'NEEDS_SPLIT_CONFIRMATION',
            conversation: publicConversation(conversation, repository),
            whatsapp: { text: 'Quer definir participantes dessa compra? Responde sim ou não para eu seguir sem inventar moda.' }
          });
        }
        const options = purchaseService.getSplitOptions({ userId: resolved.user.id, purchaseId });
        const next = repository.updateConversationState(conversation.id, {
          state: 'awaiting_split_participants',
          payload: { ...data, options: options.options, purchase_id: purchaseId },
          relatedPurchaseId: purchaseId
        });
        const names = options.options.map((option, index) => `${index + 1}. ${option.label || option.name}`).join('\n');
        return makeResult({
          ok: false,
          code: 'NEEDS_SPLIT_PARTICIPANTS',
          conversation: publicConversation(next, repository),
          options: options.options,
          whatsapp: { text: `Com quem vai dividir? ${names}. Pode responder "Apenas eu", "Eu, Ana e Bruno" ou só os nomes dos amigos. Se você quiser entrar no rateio, escreva "Eu" na resposta. Contatos locais entram só no seu controle interno.` }
        });
      }

      if (state === 'awaiting_split_participants') {
        const options = Array.isArray(data.options) ? data.options : purchaseService.getSplitOptions({ userId: resolved.user.id, purchaseId: data.purchase_id }).options;
        const participants = parseParticipantsFromReply(reply, rawText, options);
        if (!participants.length) {
          const names = options.map((option, index) => `${index + 1}. ${option.label || option.name}`).join('\n');
          return makeResult({
            ok: false,
            code: 'NEEDS_SPLIT_PARTICIPANTS',
            conversation: publicConversation(conversation, repository),
            options,
            whatsapp: { text: `Não achei esses participantes na sua rede. Tenta com: ${names}. Se você também participa, escreva "Eu" junto com os nomes.` }
          });
        }
        const mode = parseModeFromReply(reply, rawText);
        const purchaseId = Number(data.purchase_id || conversation.related_purchase_id || 0);
        if (participants.length === 1) {
          const split = applySplitForConversation({ userId: resolved.user.id, purchaseId, mode: 'equal', participants });
          repository.resolveConversationState(conversation.id);
          const onlySelf = String(participants[0]) === 'self';
          return makeResult({
            ok: true,
            code: 'SPLIT_APPLIED',
            split,
            whatsapp: { text: onlySelf ? 'Pronto, essa compra ficou só com você. Lance solo confirmado.' : 'Pronto, atribuí essa compra para a pessoa escolhida. Sem rateio freestyle por aqui.' }
          });
        }
        if (mode === 'equal') {
          const split = applySplitForConversation({ userId: resolved.user.id, purchaseId, mode: 'equal', participants });
          repository.resolveConversationState(conversation.id);
          const queueCount = Number(split.queue_summary?.itemCount || 0);
          return makeResult({
            ok: true,
            code: 'SPLIT_APPLIED',
            split,
            whatsapp: { text: queueCount > 0 ? `Divisão em partes iguais salva. ${queueCount} item(ns) ficaram em rascunho no app.` : 'Divisão em partes iguais salva.' }
          });
        }
        if (mode === 'exact' && Array.isArray(reply.shares) && reply.shares.length) {
          const split = applySplitForConversation({ userId: resolved.user.id, purchaseId, mode: 'exact', shares: reply.shares });
          repository.resolveConversationState(conversation.id);
          const queueCount = Number(split.queue_summary?.itemCount || 0);
          return makeResult({
            ok: true,
            code: 'SPLIT_APPLIED',
            split,
            whatsapp: { text: queueCount > 0 ? `Divisão por valores salva. ${queueCount} item(ns) ficaram em rascunho no app.` : 'Divisão por valores salva.' }
          });
        }
        const next = repository.updateConversationState(conversation.id, {
          state: 'awaiting_split_mode',
          payload: { ...data, participants, purchase_id: purchaseId },
          relatedPurchaseId: purchaseId
        });
        return makeResult({
          ok: false,
          code: 'NEEDS_SPLIT_MODE',
          conversation: publicConversation(next, repository),
          whatsapp: { text: [`Compra total: *${formatBRLFromCents(Number(data.purchase_total_cents || 0))}*`, '', 'Vai ser em *partes iguais* ou você quer *definir o valor de cada um*?'].join('\n') }
        });
      }

      if (state === 'awaiting_split_mode') {
        const mode = parseModeFromReply(reply, rawText);
        const purchaseId = Number(data.purchase_id || conversation.related_purchase_id || 0);
        const participants = Array.isArray(data.participants) ? data.participants : [];
        if (mode === 'equal') {
          const split = applySplitForConversation({ userId: resolved.user.id, purchaseId, mode: 'equal', participants });
          repository.resolveConversationState(conversation.id);
          const queueCount = Number(split.queue_summary?.itemCount || 0);
          return makeResult({
            ok: true,
            code: 'SPLIT_APPLIED',
            split,
            whatsapp: { text: queueCount > 0 ? `Divisão em partes iguais salva. ${queueCount} item(ns) ficaram em rascunho no app.` : 'Divisão em partes iguais salva.' }
          });
        }
        if (mode === 'exact') {
          const next = repository.updateConversationState(conversation.id, {
            state: 'awaiting_exact_amounts',
            payload: data,
            relatedPurchaseId: purchaseId
          });
          return makeResult({
            ok: false,
            code: 'NEEDS_EXACT_AMOUNTS',
            conversation: publicConversation(next, repository),
            whatsapp: { text: [`Compra total: *${formatBRLFromCents(Number(data.purchase_total_cents || 0))}*`, '', 'Me diga quanto fica para cada pessoa. Ex.: *Eu 99,90, Ana 50, Bruno 50*.', '', 'A soma precisa bater com o total, sem malabarismo de centavos.'].join('\n') }
          });
        }
        return makeResult({
          ok: false,
          code: 'NEEDS_SPLIT_MODE',
          conversation: publicConversation(conversation, repository),
          whatsapp: { text: 'Não decidi por você: responde "partes iguais" ou "valores definidos".' }
        });
      }

      if (state === 'awaiting_exact_amounts') {
        const purchaseId = Number(data.purchase_id || conversation.related_purchase_id || 0);
        if (!Array.isArray(reply.shares) || !reply.shares.length) {
          return makeResult({
            ok: false,
            code: 'NEEDS_EXACT_AMOUNTS',
            conversation: publicConversation(conversation, repository),
            whatsapp: { text: [`Compra total: *${formatBRLFromCents(Number(data.purchase_total_cents || 0))}*`, '', 'Ainda faltaram os valores de cada pessoa. Me manda no formato: *Eu 99,90, Ana 50, Bruno 50*.'].join('\n') }
          });
        }
        const split = applySplitForConversation({ userId: resolved.user.id, purchaseId, mode: 'exact', shares: reply.shares });
        repository.resolveConversationState(conversation.id);
        const queueCount = Number(split.queue_summary?.itemCount || 0);
        return makeResult({
          ok: true,
          code: 'SPLIT_APPLIED',
          split,
          whatsapp: { text: queueCount > 0 ? `Divisão por valores salva. ${queueCount} item(ns) ficaram em rascunho no app.` : 'Divisão por valores salva.' }
        });
      }

      if (state === 'awaiting_purchase_edit_confirmation') {
        return confirmPurchaseEdit({
          phone: resolved.normalized.e164,
          source: payload.source || {},
          reply,
          text: rawText,
          purchaseId: data.purchase_id || conversation.related_purchase_id || 'last',
          patch: data.patch || {}
        }, meta);
      }

      if (state === 'awaiting_purchase_delete_confirmation') {
        return confirmPurchaseDelete({
          phone: resolved.normalized.e164,
          source: payload.source || {},
          reply,
          text: rawText,
          purchaseId: data.purchase_id || conversation.related_purchase_id || 'last'
        }, meta);
      }

      repository.resolveConversationState(conversation.id);
      return makeResult({
        ok: false,
        code: 'UNKNOWN_CONVERSATION_STATE',
        whatsapp: { text: 'Esse papo ficou antigo demais para eu seguir com segurança. Me manda a compra de novo?' }
      }, 409);
    } catch (error) {
      const response = handleServiceError(error);
      logConciergeFailure({
        error,
        response,
        payload,
        meta,
        resolved,
        conversation,
        state,
        operation: state ? `conversation.reply.${state}` : 'conversation.reply'
      });
      return response;
    }
  }

  function getWhatsappActivationViewModel(userId) {
    const selfPerson = repository.getSelfPerson(userId);
    const normalized = normalizeAutomationPhone(selfPerson?.phone || '');
    const authorization = repository.getAuthorizationForUser(userId);
    const conflict = normalized.ok ? repository.findAuthorizationConflict(normalized.e164, userId) : null;
    const enabled = !!authorization && Number(authorization.enabled || 0) !== 0;
    return {
      apiEnabled: isEnabled(),
      hasToken: !!getToken(),
      selfPhone: selfPerson?.phone || '',
      selfPhoneE164: normalized.ok ? normalized.e164 : '',
      selfWhatsappNumber: normalized.ok ? normalized.whatsappNumber : '',
      selfPhoneValid: normalized.ok,
      phoneError: normalized.ok ? '' : (normalized.reason || 'Cadastre um telefone válido no perfil.'),
      authorization: authorization || null,
      enabled,
      activePhoneE164: authorization?.phone_e164 || '',
      activeWhatsappNumber: authorization?.whatsapp_number || '',
      lastUsedAt: authorization?.last_used_at || null,
      updatedAt: authorization?.updated_at || null,
      hasConflict: !!conflict,
      conflictLabel: conflict ? (conflict.user_name || conflict.user_email || 'outro usuário') : '',
      canEnable: normalized.ok && !conflict
    };
  }

  function enableWhatsappForUser(userId) {
    const selfPerson = repository.getSelfPerson(userId);
    const normalized = normalizeAutomationPhone(selfPerson?.phone || '');
    if (!normalized.ok) {
      throw new AutomationApiError(normalized.reason || 'Cadastre um telefone válido no perfil antes de ativar o WhatsApp.', {
        code: 'INVALID_SELF_PHONE',
        statusCode: 400
      });
    }
    const conflict = repository.findAuthorizationConflict(normalized.e164, userId);
    if (conflict) {
      throw new AutomationApiError('Esse telefone já está autorizado em outro usuário. Para sua segurança, não ativei por aqui.', {
        code: 'PHONE_ALREADY_AUTHORIZED',
        statusCode: 409
      });
    }
    const authorization = repository.upsertAuthorization({
      userId,
      phoneE164: normalized.e164,
      whatsappNumber: normalized.whatsappNumber,
      enabled: true,
      label: selfPerson?.name || 'WhatsApp principal'
    });
    return authorization;
  }

  function disableWhatsappForUser(userId) {
    return repository.disableAuthorizationForUser(userId);
  }

  function ensurePhoneAvailableForUser(userId, phoneE164) {
    const normalized = normalizeAutomationPhone(phoneE164 || '');
    if (!normalized.ok) return { ok: true, normalized: null };
    const conflict = repository.findAuthorizationConflict(normalized.e164, userId);
    if (conflict) {
      return {
        ok: false,
        code: 'PHONE_ALREADY_AUTHORIZED',
        message: 'Esse telefone já está autorizado em outro usuário. Use outro número para manter sua conta no trilho.',
        conflict
      };
    }
    return { ok: true, normalized };
  }

  function syncAuthorizationAfterSelfPhoneChange(userId, nextPhone) {
    const authorization = repository.getAuthorizationForUser(userId);
    if (!authorization) return { changed: false, disabled: false };
    const normalized = normalizeAutomationPhone(nextPhone || '');
    if (!normalized.ok) {
      repository.disableAuthorizationForUser(userId);
      return { changed: true, disabled: true };
    }
    if (String(authorization.phone_e164 || '') === normalized.e164) return { changed: false, disabled: false };
    repository.syncAuthorizationPhoneForUser({
      userId,
      phoneE164: normalized.e164,
      whatsappNumber: normalized.whatsappNumber,
      label: authorization.label || null,
      enabled: false
    });
    return { changed: true, disabled: true };
  }

  return {
    normalizeAutomationPhone,
    verifyAutomationRequest,
    verifyWorkflowUserPreference,
    recordAutomationHttpEvent,
    getAutomationRequestContext,
    buildRouterContext,
    buildRouterCapabilities,
    recordRouterIntent,
    resolveWhatsapp,
    createPurchaseFromAutomation,
    getSplitOptionsForPurchase,
    splitPurchaseFromAutomation,
    handleConversationReply,
    getWhatsappActivationViewModel,
    enableWhatsappForUser,
    disableWhatsappForUser,
    ensurePhoneAvailableForUser,
    syncAuthorizationAfterSelfPhoneChange,
    listRecentPurchases,
    preparePurchaseEdit,
    confirmPurchaseEdit,
    preparePurchaseDelete,
    confirmPurchaseDelete,
    reopenParticipantsForPurchase,
    isEnabled,
    handleServiceError
  };
}

module.exports = {
  AutomationApiError,
  createAutomationApiService,
  normalizeAutomationPhone
};
