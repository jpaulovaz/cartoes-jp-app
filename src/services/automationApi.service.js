const crypto = require('crypto');
const { createAutomationApiRepository } = require('../repositories/automationApi.repository');
const { createPurchaseCreationService, PurchaseCreationError } = require('./purchaseCreation.service');
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

function isAffirmativeText(value) {
  const text = normalizeIntentText(value);
  return /^(sim|s|quero|bora|pode|ok|claro|vamos|dividir|quero dividir|manda|isso)$/i.test(text)
    || text.includes('quero dividir')
    || text.includes('pode dividir');
}

function isNegativeText(value) {
  const text = normalizeIntentText(value);
  return /^(nao|n|não|deixa|deixa assim|so eu|só eu|apenas eu|eu mesmo)$/i.test(text)
    || text.includes('nao quero')
    || text.includes('não quero')
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
    option: index + 1
  }));
}

function createAutomationApiService(deps = {}) {
  const repository = deps.repository || createAutomationApiRepository();
  const purchaseService = deps.purchaseService || createPurchaseCreationService({ repository });

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

  function verifyAutomationRequest(req) {
    if (!isEnabled()) {
      return { ok: false, statusCode: 503, code: 'AUTOMATION_DISABLED', message: 'A API de automações está desligada.' };
    }

    const expected = getToken();
    if (!expected) {
      return { ok: false, statusCode: 503, code: 'AUTOMATION_TOKEN_MISSING', message: 'Token da API de automações não configurado.' };
    }

    const header = String(req.get('authorization') || '').trim();
    const provided = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
    if (!provided || !safeCompare(provided, expected)) {
      return { ok: false, statusCode: 401, code: 'UNAUTHORIZED', message: 'Token de automação inválido.' };
    }

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
      const requestIp = String(req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
      if (!allowedIps.includes(requestIp)) {
        return { ok: false, statusCode: 403, code: 'IP_NOT_ALLOWED', message: 'Origem não autorizada para a API de automações.' };
      }
    }

    return { ok: true };
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

      const purchase = payload.purchase || {};
      const requestedCardId = Number(purchase.card_id || purchase.cardId || 0) || null;
      let response;
      if (!requestedCardId) {
        const activeCards = repository.getActiveCards(resolved.user.id);
        if (!activeCards.length) {
          response = makeResult({
            ok: false,
            code: 'NO_ACTIVE_CARD',
            whatsapp: { text: 'Você ainda não tem cartão ativo para lançar essa compra. Crie ou reative um cartão no AcerttaPay primeiro.' }
          }, 409);
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
      const names = options.options.map((option, index) => `${index + 1}. ${option.label || option.name}`).join(' ');
      return makeResult({
        ok: true,
        code: 'SPLIT_OPTIONS',
        ...options,
        whatsapp: { text: `Quem participa dessa compra? ${names}` }
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
        participants: payload.participants,
        shares: payload.shares
      });
      const queueCount = Number(result.queue_summary?.itemCount || 0);
      return makeResult({
        ok: true,
        code: 'SPLIT_APPLIED',
        split: result,
        whatsapp: {
          text: queueCount > 0
            ? `Divisão salva. ${queueCount} item(ns) foram para a caixa de saída da Central de Acertos, sem enviar nada automaticamente.`
            : 'Divisão salva. Ficou tudo redondinho por aqui.'
        }
      });
    } catch (error) {
      return handleServiceError(error);
    }
  }

  function parseParticipantsFromReply(reply = {}, text = '', options = []) {
    if (Array.isArray(reply.participants) && reply.participants.length) return reply.participants;
    if (Array.isArray(reply.shares) && reply.shares.length) {
      return reply.shares.map((row) => row.participant ?? row.id ?? row.person_id ?? row.name).filter(Boolean);
    }
    if (reply.include_self === true || reply.only_self === true) return ['self'];

    const normalized = normalizeIntentText(text || reply.text || reply.raw_text || '');
    if (!normalized) return [];
    if (normalized.includes('apenas eu') || normalized === 'eu' || normalized === 'so eu' || normalized === 'só eu') return ['self'];

    const selected = [];
    options.forEach((option, index) => {
      const label = normalizeIntentText(option.label || option.name);
      if (!label) return;
      if (normalized.includes(label) || normalized.split(/[,+/& e]+/).includes(label)) selected.push(option.id);
      if (normalized === String(index + 1)) selected.push(option.id);
    });
    return Array.from(new Set(selected));
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
    try {
      assertApiEnabled();
      const resolved = resolveAuthorizedPhone(payload.phone || payload.user_phone || payload.number);
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

      const data = repository.getConversationPayload(conversation) || {};
      const reply = payload.reply || {};
      const rawText = payload.source?.raw_text || payload.source?.rawText || reply.text || payload.text || '';
      const state = String(conversation.state || '').trim();

      if (state === 'awaiting_card_choice') {
        const cards = Array.isArray(data.cards) ? data.cards : [];
        const selectedCardId = parseCardIdFromReply(reply, rawText, cards);
        if (!selectedCardId) {
          const cardList = cards.map((card) => `${card.option}. ${card.label}`).join(' ');
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
        const names = options.options.map((option, index) => `${index + 1}. ${option.label || option.name}`).join(' ');
        return makeResult({
          ok: false,
          code: 'NEEDS_SPLIT_PARTICIPANTS',
          conversation: publicConversation(next, repository),
          options: options.options,
          whatsapp: { text: `Com quem vai dividir? ${names}. Pode responder "Apenas eu" ou os nomes dos amigos.` }
        });
      }

      if (state === 'awaiting_split_participants') {
        const options = Array.isArray(data.options) ? data.options : purchaseService.getSplitOptions({ userId: resolved.user.id, purchaseId: data.purchase_id }).options;
        const participants = parseParticipantsFromReply(reply, rawText, options);
        if (!participants.length) {
          const names = options.map((option, index) => `${index + 1}. ${option.label || option.name}`).join(' ');
          return makeResult({
            ok: false,
            code: 'NEEDS_SPLIT_PARTICIPANTS',
            conversation: publicConversation(conversation, repository),
            options,
            whatsapp: { text: `Não achei esses participantes na sua rede. Tenta com: ${names}` }
          });
        }
        const mode = parseModeFromReply(reply, rawText);
        const purchaseId = Number(data.purchase_id || conversation.related_purchase_id || 0);
        if (participants.length === 1 && String(participants[0]) === 'self') {
          const split = applySplitForConversation({ userId: resolved.user.id, purchaseId, mode: 'equal', participants: ['self'] });
          repository.resolveConversationState(conversation.id);
          return makeResult({
            ok: true,
            code: 'SPLIT_APPLIED',
            split,
            whatsapp: { text: 'Pronto, essa compra ficou só com você. Lance solo confirmado.' }
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
            whatsapp: { text: queueCount > 0 ? `Divisão em partes iguais salva. ${queueCount} item(ns) ficaram em rascunho na Central de Acertos.` : 'Divisão em partes iguais salva.' }
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
            whatsapp: { text: queueCount > 0 ? `Divisão por valores salva. ${queueCount} item(ns) ficaram em rascunho na Central de Acertos.` : 'Divisão por valores salva.' }
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
          whatsapp: { text: 'Vai ser em partes iguais ou você quer definir o valor de cada um?' }
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
            whatsapp: { text: queueCount > 0 ? `Divisão em partes iguais salva. ${queueCount} item(ns) ficaram em rascunho na Central de Acertos.` : 'Divisão em partes iguais salva.' }
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
            whatsapp: { text: 'Me diga quanto fica para cada pessoa, por exemplo: Eu 99,90, Ana 50, Bruno 50.' }
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
            whatsapp: { text: 'Ainda faltaram os valores de cada pessoa. Me manda no formato: Eu 99,90, Ana 50, Bruno 50.' }
          });
        }
        const split = applySplitForConversation({ userId: resolved.user.id, purchaseId, mode: 'exact', shares: reply.shares });
        repository.resolveConversationState(conversation.id);
        const queueCount = Number(split.queue_summary?.itemCount || 0);
        return makeResult({
          ok: true,
          code: 'SPLIT_APPLIED',
          split,
          whatsapp: { text: queueCount > 0 ? `Divisão por valores salva. ${queueCount} item(ns) ficaram em rascunho na Central de Acertos.` : 'Divisão por valores salva.' }
        });
      }

      repository.resolveConversationState(conversation.id);
      return makeResult({
        ok: false,
        code: 'UNKNOWN_CONVERSATION_STATE',
        whatsapp: { text: 'Esse papo ficou antigo demais para eu seguir com segurança. Me manda a compra de novo?' }
      }, 409);
    } catch (error) {
      return handleServiceError(error);
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
    isEnabled,
    handleServiceError
  };
}

module.exports = {
  AutomationApiError,
  createAutomationApiService,
  normalizeAutomationPhone
};
