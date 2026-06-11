const crypto = require('crypto');
const dayjs = require('dayjs');
const { createAutomationSharedDebtsRepository } = require('../repositories/automationSharedDebts.repository');
const { AutomationApiError, normalizeAutomationPhone } = require('./automationApi.service');
const { formatBRLFromCents } = require('../utils');
const { buildPixPayload, buildSharedDebtCardMonthlyPixTxid, sanitizePixText } = require('../pix');

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

function safeJsonParse(value, fallback = null) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch (error) {
    return fallback;
  }
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
  if (['next_month', 'proximo_mes', 'próximo mês'].includes(rawPeriod)) return addMonths(todayYear, todayMonth, 1);
  const month = Number(input.month || input.due_month || input.mes || 0);
  const year = Number(input.year || input.due_year || input.ano || 0);
  if (month >= 1 && month <= 12 && year >= 2000 && year <= 2100) return { month, year };
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

function isAffirmative(value) {
  const text = normalizeText(value);
  return /^(sim|s|confirmo|confirmar|confirma|ok|pode|pode sim|isso|isso mesmo|enviar|envia|mandar|manda|paguei|feito|concluir|aceitar|aceito)$/i.test(text)
    || text.includes('pode enviar')
    || text.includes('pode marcar')
    || text.includes('confirmo')
    || text.includes('isso mesmo');
}

function isNegative(value) {
  const text = normalizeText(value);
  return /^(nao|não|n|cancelar|cancela|deixa|deixa pra la|deixa para la|voltar)$/i.test(text)
    || text.includes('nao confirma')
    || text.includes('não confirma')
    || text.includes('nao quero')
    || text.includes('não quero');
}

function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseMoneyCents(value, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  if (/^\d+$/.test(raw)) return Number(raw);
  const digits = raw.replace(/\D/g, '');
  return digits ? Number(digits) : fallback;
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
    .sort((a, b) => b.score - a.score || Number(a.item.id || a.item.queue_id || 0) - Number(b.item.id || b.item.queue_id || 0));
  if (!matches.length) return { status: 'not_found', item: null, matches: [] };
  const topScore = matches[0].score;
  const tied = matches.filter((entry) => entry.score === topScore || (topScore - entry.score <= 4 && topScore < 100));
  if (tied.length > 1) return { status: 'ambiguous', item: null, matches: tied.map((entry) => entry.item) };
  return { status: 'found', item: matches[0].item, matches: matches.map((entry) => entry.item) };
}

function plural(count, singular, pluralText) {
  return Number(count || 0) === 1 ? singular : pluralText;
}

function truncateRows(rows = [], limit = 8) {
  return (Array.isArray(rows) ? rows : []).slice(0, Math.max(0, Number(limit || 8) || 8));
}

function sumBy(rows = [], field) {
  return rows.reduce((total, row) => total + Number(row[field] || 0), 0);
}

function openCents(row = {}) {
  const total = Math.max(0, Number(row.amount_cents || 0));
  const paid = Math.min(total, Math.max(0, Number(row.amount_paid_cents || (row.status === 'settled' ? total : 0))));
  return Math.max(0, total - paid);
}

function statusLabel(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'pending') return 'pendente';
  if (normalized === 'accepted') return 'aceito';
  if (normalized === 'settled') return 'quitado';
  if (normalized === 'rejected_by_receiver') return 'recusado';
  if (normalized === 'rejection_contested_by_sender') return 'contestação aberta';
  return normalized || 'status indefinido';
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

function serializeDraftQueue(queue = {}, items = []) {
  const queueItems = (items || []).filter((item) => Number(item.queue_id || 0) === Number(queue.id || 0));
  return {
    id: Number(queue.id || 0),
    receiver_user_id: Number(queue.receiver_user_id || 0),
    receiver_name: queue.receiver_display_name || queue.receiver_name_snapshot || queue.receiver_user_name || queue.receiver_email || 'Contato',
    month: Number(queue.source_due_month || 0),
    year: Number(queue.source_due_year || 0),
    period_label: periodLabel(queue.source_due_month, queue.source_due_year),
    total_cents: Number(queue.total_cents || 0),
    item_count: Number(queue.item_count || queueItems.length || 0),
    status: queue.status || 'draft',
    items: queueItems.map((item) => ({
      id: Number(item.id || 0),
      description: item.description_snapshot,
      amount_cents: Number(item.amount_cents || 0),
      card_name: item.card_name_snapshot || null,
      action_kind: item.action_kind || 'create'
    }))
  };
}

function serializeRequest(row = {}, currentUserId = 0) {
  const direction = Number(row.requester_user_id || 0) === Number(currentUserId || 0) ? 'outgoing' : 'incoming';
  return {
    id: Number(row.id || 0),
    direction,
    status: row.status,
    status_label: statusLabel(row.status),
    request_kind: row.request_kind || 'card',
    description: row.description_snapshot,
    amount_cents: Number(row.amount_cents || 0),
    amount_paid_cents: Number(row.amount_paid_cents || 0),
    open_cents: openCents(row),
    requester_user_id: Number(row.requester_user_id || 0),
    requester_name: row.requester_name || row.requester_email || 'Quem enviou',
    receiver_user_id: Number(row.receiver_user_id || 0),
    receiver_name: row.receiver_name_snapshot || row.receiver_name || row.receiver_email || 'Quem recebeu',
    due_month: Number(row.source_due_month || 0) || null,
    due_year: Number(row.source_due_year || 0) || null,
    period_label: row.source_due_month && row.source_due_year ? periodLabel(row.source_due_month, row.source_due_year) : null,
    payment_marked_at: row.payment_marked_at || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null
  };
}

function buildRequestLine(request, currentUserId) {
  const data = serializeRequest(request, currentUserId);
  const name = data.direction === 'outgoing' ? data.receiver_name : data.requester_name;
  return `#${data.id} — ${name}: *${formatBRLFromCents(data.open_cents || data.amount_cents)}* · ${data.description} · ${data.status_label}`;
}

function createAutomationSharedDebtsService(deps = {}) {
  const repository = deps.sharedDebtsAutomationRepository || createAutomationSharedDebtsRepository();

  function assertApiEnabled() {
    if (!repository.getBooleanSetting('AUTOMATION_API_ENABLED', false)) {
      throw new AutomationApiError('A API de automações está desligada no AcerttaPay.', {
        code: 'AUTOMATION_DISABLED',
        statusCode: 503
      });
    }
  }

  function resolveAuthorizedPhone(phone) {
    const normalized = normalizeAutomationPhone(phone);
    if (!normalized.ok) {
      throw new AutomationApiError(normalized.reason || 'Telefone inválido.', { code: 'INVALID_PHONE', statusCode: 400 });
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

  function handleServiceError(error) {
    if (error instanceof AutomationApiError) {
      return makeResult({
        ok: false,
        code: error.code || 'AUTOMATION_ERROR',
        message: error.message,
        details: error.details || null,
        whatsapp: { text: error.message }
      }, error.statusCode || 400);
    }
    return makeResult({
      ok: false,
      code: 'AUTOMATION_ERROR',
      message: error?.message || 'Não consegui concluir essa ação agora.',
      whatsapp: { text: error?.message || 'Não consegui concluir essa ação agora.' }
    }, 500);
  }

  function withHandling(payload = {}, meta = {}, operation, fn) {
    let resolved = null;
    try {
      assertApiEnabled();
      resolved = resolveAuthorizedPhone(payload.phone || payload.user_phone || payload.number);
      if (!resolved.authorized) {
        throw new AutomationApiError('Esse número ainda não está liberado no AcerttaPay. Ative o WhatsApp nas Configurações do app.', {
          code: 'NOT_AUTHORIZED',
          statusCode: 403
        });
      }
      const result = fn(resolved);
      repository.logRequest({
        userId: resolved.user.id,
        phoneE164: resolved.normalized.e164,
        channel: payload.source?.channel || payload.channel || 'whatsapp',
        operation,
        statusCode: result.statusCode || 200,
        resultCode: result.code || null,
        sourceMessageId: payload.source?.message_id || payload.message_id || null,
        ipAddress: meta.ipAddress || null
      });
      return result;
    } catch (error) {
      const response = handleServiceError(error);
      repository.logRequest({
        userId: resolved?.user?.id || null,
        phoneE164: resolved?.normalized?.e164 || null,
        channel: payload.source?.channel || payload.channel || 'whatsapp',
        operation,
        statusCode: response.statusCode || 500,
        resultCode: response.code || null,
        sourceMessageId: payload.source?.message_id || payload.message_id || null,
        ipAddress: meta.ipAddress || null
      });
      return response;
    }
  }

  function getIdempotentOrStart({ userId, channel, idempotencyKey, operation, payload }) {
    const key = String(idempotencyKey || '').trim();
    if (!key) {
      throw new AutomationApiError('Idempotency-Key é obrigatório para confirmar ações da Central de Acertos por WhatsApp.', {
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        statusCode: 400
      });
    }
    const idempotency = repository.tryCreateIdempotency({
      userId,
      channel,
      idempotencyKey: key,
      operation,
      requestHash: requestHash(payload)
    });
    if (!idempotency.created) {
      const cached = safeJsonParse(idempotency.row?.response_json, null);
      if (cached) return { duplicate: true, response: makeResult({ ...cached, duplicate: true }, 200) };
      throw new AutomationApiError('Essa confirmação já está em processamento. Não dupliquei a ação.', {
        code: 'IDEMPOTENCY_IN_PROGRESS',
        statusCode: 409
      });
    }
    return { duplicate: false, idempotencyKey: key };
  }

  function finishIdempotency(channel, idempotencyKey, response, status = 'success') {
    repository.finishIdempotency({ channel, idempotencyKey, response, status });
  }

  function createConfirmation({ user, phoneE164, source, operation, payload, text, code = 'NEEDS_SHARED_DEBT_CONFIRMATION' }) {
    const conversation = repository.createConversationState({
      userId: user.id,
      phoneE164,
      channel: source?.channel || 'whatsapp',
      state: 'awaiting_shared_debt_action_confirmation',
      payload: { operation, payload, source: source || {} }
    });
    return makeResult({
      ok: false,
      code,
      conversation: publicConversation(conversation, repository),
      whatsapp: { text }
    }, 200);
  }

  function buildDraftQueueListText(queues = []) {
    if (!queues.length) {
      return '📬 *Caixa de saída vazia por aqui.*\n\nNenhum rascunho da Central de Acertos esperando envio nesse período.';
    }
    return [
      '📬 *Rascunhos da Central de Acertos*',
      '',
      ...queues.map((queue, index) => `${index + 1}. #${queue.id} — ${queue.receiver_name}: *${formatBRLFromCents(queue.total_cents)}* · ${queue.item_count} ${plural(queue.item_count, 'item', 'itens')} · ${queue.period_label}`),
      '',
      'Para enviar, responda: *enviar rascunho #ID*.'
    ].join('\n');
  }

  function listDraftQueues(payload = {}, meta = {}) {
    return withHandling(payload, meta, 'shared_debts.drafts', ({ user }) => {
      const query = payload.query || payload;
      const period = resolvePeriod(query);
      const rows = repository.getDraftQueues(user.id, { month: period.month, year: period.year, limit: query.limit || 12 });
      const items = repository.getDraftQueueItems(rows.map((row) => row.id));
      let queues = rows.map((row) => serializeDraftQueue(row, items));
      const hint = query.person_hint || query.person || query.receiver_hint || '';
      if (hint) {
        const resolved = resolveByHint(queues, hint, ['receiver_name']);
        if (resolved.status === 'not_found') throw new AutomationApiError(`Não encontrei rascunho para "${hint}" nesse período.`, { code: 'DRAFT_QUEUE_NOT_FOUND', statusCode: 404 });
        if (resolved.status === 'ambiguous') throw new AutomationApiError('Encontrei mais de um rascunho parecido. Me manda o número #ID.', { code: 'NEEDS_DRAFT_QUEUE_CLARIFICATION', statusCode: 200, details: { matches: resolved.matches } });
        queues = [resolved.item];
      }
      return makeResult({
        ok: true,
        code: 'DRAFT_QUEUES',
        data: { period, queues },
        whatsapp: { text: buildDraftQueueListText(queues) }
      });
    });
  }

  function buildSummaryText({ period, outgoing, incoming, drafts }) {
    const outgoingTotal = sumBy(outgoing, 'open_cents');
    const incomingTotal = sumBy(incoming, 'open_cents');
    const draftTotal = sumBy(drafts, 'total_cents');
    const outgoingLines = outgoing.length
      ? truncateRows(outgoing, 6).map((row) => `• ${row.counterpart_name}: *${formatBRLFromCents(row.open_cents)}* · ${row.item_count} ${plural(row.item_count, 'item', 'itens')} · ${statusLabel(row.status)}`)
      : ['• Ninguém aparece te devendo nesse período.'];
    const incomingLines = incoming.length
      ? truncateRows(incoming, 6).map((row) => `• ${row.counterpart_name}: *${formatBRLFromCents(row.open_cents)}* · ${row.item_count} ${plural(row.item_count, 'item', 'itens')} · ${statusLabel(row.status)}`)
      : ['• Você não tem pendências para pagar nesse período.'];
    const draftLines = drafts.length
      ? truncateRows(drafts, 4).map((row) => `• #${row.id} ${row.receiver_display_name}: *${formatBRLFromCents(row.total_cents)}* em rascunho`)
      : ['• Nenhum rascunho esperando envio.'];
    return [
      `🤝 *Central de Acertos — ${periodLabel(period.month, period.year)}*`,
      '',
      `📥 A receber: *${formatBRLFromCents(outgoingTotal)}*`,
      `📤 A pagar: *${formatBRLFromCents(incomingTotal)}*`,
      draftTotal ? `📬 Em rascunhos: *${formatBRLFromCents(draftTotal)}*` : '',
      '',
      '*Quem te deve*',
      ...outgoingLines,
      '',
      '*O que você deve*',
      ...incomingLines,
      '',
      '*Caixa de saída*',
      ...draftLines
    ].filter((line) => line !== '').join('\n');
  }

  function getSummary(payload = {}, meta = {}) {
    return withHandling(payload, meta, 'shared_debts.summary', ({ user }) => {
      const query = payload.query || payload;
      const period = resolvePeriod(query);
      const summary = repository.getSharedDebtSummary(user.id, period.month, period.year);
      return makeResult({
        ok: true,
        code: 'SHARED_DEBT_SUMMARY',
        data: { period, ...summary },
        whatsapp: { text: buildSummaryText({ period, ...summary }) }
      });
    });
  }

  function resolveQueueIdForUser(userId, rawQueueId, payload = {}) {
    const direct = toInt(rawQueueId || payload.queue_id || payload.queueId || payload.id, 0);
    if (direct) return direct;
    const query = payload.query || payload;
    const period = resolvePeriod(query);
    const queues = repository.getDraftQueues(userId, { month: period.month, year: period.year, limit: 30 })
      .map((row) => serializeDraftQueue(row, []));
    const hint = query.person_hint || query.person || query.receiver_hint || query.name || '';
    if (!hint && queues.length === 1) return queues[0].id;
    const resolved = resolveByHint(queues, hint, ['receiver_name']);
    if (resolved.status === 'found') return resolved.item.id;
    if (resolved.status === 'ambiguous') {
      throw new AutomationApiError('Encontrei mais de um rascunho parecido. Me manda o número #ID.', { code: 'NEEDS_DRAFT_QUEUE_CLARIFICATION', statusCode: 200, details: { matches: resolved.matches } });
    }
    throw new AutomationApiError('Não encontrei qual rascunho você quer enviar. Peça *listar rascunhos* para eu te mostrar os IDs.', { code: 'DRAFT_QUEUE_NOT_FOUND', statusCode: 404 });
  }

  function prepareDraftSend(payload = {}, meta = {}) {
    return withHandling(payload, meta, 'shared_debts.drafts.prepare_send', ({ user, normalized }) => {
      const queueId = resolveQueueIdForUser(user.id, payload.queueId || payload.queue_id || payload.id, payload);
      const queue = repository.getDraftQueueForRequester(user.id, queueId);
      if (!queue || String(queue.status || '').toLowerCase() !== 'draft') throw new AutomationApiError('Esse rascunho não está disponível para envio.', { code: 'DRAFT_QUEUE_NOT_FOUND', statusCode: 404 });
      const items = repository.getDraftQueueItems([queue.id]);
      const serialized = serializeDraftQueue(queue, items);
      return createConfirmation({
        user,
        phoneE164: normalized.e164,
        source: payload.source || {},
        operation: 'send_draft_queue',
        payload: { queue_id: serialized.id },
        code: 'NEEDS_DRAFT_SEND_CONFIRMATION',
        text: [
          '📬 *Confirmar envio de rascunho*',
          '',
          `Vou enviar para *${serialized.receiver_name}*:` ,
          `• ${serialized.item_count} ${plural(serialized.item_count, 'item', 'itens')}`,
          `• Total: *${formatBRLFromCents(serialized.total_cents)}*`,
          `• Período: *${serialized.period_label}*`,
          '',
          'Responde *enviar* para confirmar ou *cancelar* para deixar quietinho na caixa de saída.'
        ].join('\n')
      });
    });
  }

  function confirmDraftSend(payload = {}, meta = {}) {
    return withHandling(payload, meta, 'shared_debts.drafts.confirm_send', ({ user }) => {
      const confirmed = payload.confirmed === true || payload.confirm === true || isAffirmative(payload.confirmation || payload.raw_text || payload.text || '');
      if (!confirmed) {
        return makeResult({ ok: false, code: 'CONFIRMATION_REQUIRED', whatsapp: { text: 'Sem confirmação explícita, não enviei o rascunho. Segurança financeira em primeiro lugar.' } }, 200);
      }
      const queueId = resolveQueueIdForUser(user.id, payload.queueId || payload.queue_id || payload.id, payload);
      const idempotency = getIdempotentOrStart({
        userId: user.id,
        channel: payload.source?.channel || payload.channel || 'whatsapp',
        idempotencyKey: meta.idempotencyKey || payload.idempotency_key,
        operation: 'shared_debts.draft_send.confirm',
        payload: { queueId }
      });
      if (idempotency.duplicate) return idempotency.response;
      try {
        const result = repository.sendDraftQueue({ userId: user.id, queueId });
        const response = makeResult({
          ok: true,
          code: 'DRAFT_QUEUE_SENT',
          data: { queue_id: queueId, batch_id: result.batchId, request_ids: result.requestIds, item_count: result.itemCount, total_cents: result.totalCents },
          whatsapp: {
            text: [
              '✅ *Rascunho enviado!*',
              '',
              `${result.itemCount} ${plural(result.itemCount, 'item saiu', 'itens saíram')} da caixa de saída para *${result.queue.receiver_display_name || 'o contato'}*.`,
              `Total enviado: *${formatBRLFromCents(result.totalCents)}*`,
              '',
              'Agora a pessoa pode aceitar, recusar ou combinar o pagamento pela Central de Acertos.'
            ].join('\n')
          }
        });
        finishIdempotency(payload.source?.channel || payload.channel || 'whatsapp', idempotency.idempotencyKey, response, 'success');
        return response;
      } catch (error) {
        const response = handleServiceError(error);
        finishIdempotency(payload.source?.channel || payload.channel || 'whatsapp', idempotency.idempotencyKey, response, 'error');
        throw error;
      }
    });
  }

  function resolveRequestIdForUser(userId, rawRequestId, payload = {}, preferredDirection = 'both') {
    const direct = toInt(rawRequestId || payload.request_id || payload.requestId || payload.id, 0);
    if (direct) return direct;
    const query = payload.query || payload;
    const period = resolvePeriod(query);
    const direction = preferredDirection === 'incoming' || preferredDirection === 'outgoing' ? preferredDirection : 'both';
    const requests = repository.listRequests(userId, { direction, month: period.month, year: period.year, limit: 30 });
    const hint = query.person_hint || query.person || query.counterpart_hint || query.name || '';
    if (!hint && requests.length === 1) return Number(requests[0].id || 0);
    const enriched = requests.map((row) => ({
      ...row,
      counterpart_name: Number(row.requester_user_id || 0) === Number(userId || 0)
        ? (row.receiver_name_snapshot || row.receiver_name || row.receiver_email || '')
        : (row.requester_name || row.requester_email || '')
    }));
    const resolved = resolveByHint(enriched, hint, ['counterpart_name', 'description_snapshot']);
    if (resolved.status === 'found') return Number(resolved.item.id || 0);
    if (resolved.status === 'ambiguous') {
      throw new AutomationApiError('Encontrei mais de um acerto parecido. Me manda o número #ID.', { code: 'NEEDS_REQUEST_CLARIFICATION', statusCode: 200, details: { matches: resolved.matches.map((row) => serializeRequest(row, userId)) } });
    }
    throw new AutomationApiError('Não encontrei qual acerto você quer mexer. Peça *listar acertos* para eu te mostrar os IDs.', { code: 'REQUEST_NOT_FOUND', statusCode: 404 });
  }

  function getRequests(payload = {}, meta = {}) {
    return withHandling(payload, meta, 'shared_debts.requests.list', ({ user }) => {
      const query = payload.query || payload;
      const period = resolvePeriod(query);
      const direction = ['incoming', 'outgoing', 'both'].includes(String(query.direction || '').toLowerCase()) ? String(query.direction).toLowerCase() : 'both';
      const rows = repository.listRequests(user.id, { direction, month: period.month, year: period.year, limit: query.limit || 20 });
      const title = direction === 'incoming'
        ? `📤 *O que você deve — ${periodLabel(period.month, period.year)}*`
        : direction === 'outgoing'
          ? `📥 *Quem te deve — ${periodLabel(period.month, period.year)}*`
          : `🤝 *Acertos ativos — ${periodLabel(period.month, period.year)}*`;
      const lines = rows.length
        ? truncateRows(rows, 12).map((row) => buildRequestLine(row, user.id))
        : ['Nada em aberto nesse recorte. A Central de Acertos está respirando leve.'];
      return makeResult({
        ok: true,
        code: 'SHARED_DEBT_REQUESTS',
        data: { period, direction, requests: rows.map((row) => serializeRequest(row, user.id)) },
        whatsapp: { text: [title, '', ...lines].join('\n') }
      });
    });
  }

  function requireConfirmationOrCreate({ payload, resolved, meta, operation, confirmationText, statePayload, code }) {
    const confirmed = payload.confirmed === true || payload.confirm === true || isAffirmative(payload.confirmation || payload.raw_text || payload.text || '');
    if (confirmed) return null;
    return createConfirmation({
      user: resolved.user,
      phoneE164: resolved.normalized.e164,
      source: payload.source || {},
      operation,
      payload: statePayload,
      code,
      text: confirmationText
    });
  }

  function respondRequest(payload = {}, meta = {}) {
    return withHandling(payload, meta, 'shared_debts.requests.respond', (resolved) => {
      const { user } = resolved;
      const action = String(payload.action || payload.reply?.action || '').trim().toLowerCase();
      const normalizedAction = ['accept', 'accepted', 'aceitar', 'aceito'].includes(action)
        ? 'accept'
        : ['reject', 'rejected', 'recusar', 'recuso'].includes(action)
          ? 'reject'
          : ['contest', 'contestar', 'contestacao', 'contestação'].includes(action)
            ? 'contest'
            : '';
      if (!normalizedAction) throw new AutomationApiError('Me diz se é para aceitar, recusar ou contestar esse acerto.', { code: 'MISSING_ACTION', statusCode: 400 });
      const preferredDirection = normalizedAction === 'contest' ? 'outgoing' : 'incoming';
      const requestId = resolveRequestIdForUser(user.id, payload.requestId || payload.request_id || payload.id, payload, preferredDirection);
      const row = repository.getRequestByIdForParticipant(user.id, requestId);
      if (!row) throw new AutomationApiError('Não encontrei esse acerto para você.', { code: 'REQUEST_NOT_FOUND', statusCode: 404 });
      if (normalizedAction === 'reject' && !(payload.note || payload.reason || payload.response_note)) {
        throw new AutomationApiError('Para recusar, me manda uma observação curta. Ex.: *recusar #12, já paguei por fora*.', { code: 'REJECTION_NOTE_REQUIRED', statusCode: 400 });
      }
      if (normalizedAction === 'contest' && !(payload.note || payload.reason || payload.response_note)) {
        throw new AutomationApiError('Para contestar, me manda o motivo. Sem contexto, a treta vira planilha sem legenda.', { code: 'CONTEST_NOTE_REQUIRED', statusCode: 400 });
      }
      const note = payload.note || payload.reason || payload.response_note || null;
      const actionLabel = normalizedAction === 'accept' ? 'aceitar' : normalizedAction === 'reject' ? 'recusar' : 'contestar';
      const confirmation = requireConfirmationOrCreate({
        payload,
        resolved,
        meta,
        operation: 'respond_request',
        statePayload: { request_id: requestId, action: normalizedAction, note },
        code: 'NEEDS_SHARED_DEBT_CONFIRMATION',
        confirmationText: [
          `⚠️ *Confirmar ${actionLabel} acerto*`,
          '',
          buildRequestLine(row, user.id),
          note ? `Nota: ${note}` : '',
          '',
          `Responde *confirmar* para ${actionLabel} ou *cancelar* para não mexer.`
        ].filter(Boolean).join('\n')
      });
      if (confirmation) return confirmation;

      const idempotency = getIdempotentOrStart({
        userId: user.id,
        channel: payload.source?.channel || payload.channel || 'whatsapp',
        idempotencyKey: meta.idempotencyKey || payload.idempotency_key,
        operation: 'shared_debts.request.respond.confirm',
        payload: { requestId, action: normalizedAction, note }
      });
      if (idempotency.duplicate) return idempotency.response;
      try {
        const result = repository.updateRequestStatus({
          requestId,
          userId: user.id,
          role: normalizedAction === 'contest' ? 'requester' : 'receiver',
          action: normalizedAction,
          note
        });
        if (!result.changed) throw new AutomationApiError(reasonMessage(result.reason, 'Não consegui atualizar esse acerto agora.'), { code: 'INVALID_SHARED_DEBT_STATE', statusCode: 409 });
        if (String(result.request.request_kind || 'card') === 'card' && normalizedAction === 'accept') {
          repository.recalcCardMonthlySettlement(result.request.requester_user_id, result.request.receiver_user_id, result.request.source_due_month, result.request.source_due_year);
        }
        const response = makeResult({
          ok: true,
          code: 'SHARED_DEBT_REQUEST_UPDATED',
          data: { request: serializeRequest(result.request, user.id) },
          whatsapp: { text: `✅ Pronto! Acerto #${requestId} ${normalizedAction === 'accept' ? 'aceito' : normalizedAction === 'reject' ? 'recusado' : 'contestado'} com segurança.` }
        });
        finishIdempotency(payload.source?.channel || payload.channel || 'whatsapp', idempotency.idempotencyKey, response, 'success');
        return response;
      } catch (error) {
        const response = handleServiceError(error);
        finishIdempotency(payload.source?.channel || payload.channel || 'whatsapp', idempotency.idempotencyKey, response, 'error');
        throw error;
      }
    });
  }

  function reasonMessage(reason, fallback) {
    if (reason === 'not_found') return 'Não encontrei esse acerto.';
    if (reason === 'forbidden') return 'Esse acerto não pertence ao seu lado da conversa.';
    if (reason === 'invalid_status') return 'Esse acerto não está no status certo para essa ação.';
    if (reason === 'already_marked') return 'Esse pagamento já tinha sido marcado como feito.';
    if (reason === 'payment_not_marked') return 'A outra pessoa ainda não marcou esse pagamento como feito.';
    return fallback;
  }

  function markPaid(payload = {}, meta = {}) {
    return withHandling(payload, meta, 'shared_debts.requests.mark_paid', (resolved) => {
      const { user } = resolved;
      const requestId = resolveRequestIdForUser(user.id, payload.requestId || payload.request_id || payload.id, payload, 'incoming');
      const row = repository.getRequestByIdForParticipant(user.id, requestId);
      if (!row) throw new AutomationApiError('Não encontrei esse acerto para você.', { code: 'REQUEST_NOT_FOUND', statusCode: 404 });
      const note = payload.note || payload.payment_note || null;
      const confirmation = requireConfirmationOrCreate({
        payload,
        resolved,
        meta,
        operation: 'mark_paid',
        statePayload: { request_id: requestId, note },
        code: 'NEEDS_PAYMENT_MARK_CONFIRMATION',
        confirmationText: [
          '⚠️ *Confirmar pagamento feito*',
          '',
          buildRequestLine(row, user.id),
          '',
          'Responde *confirmar* para avisar que você pagou ou *cancelar* para não mexer.'
        ].join('\n')
      });
      if (confirmation) return confirmation;
      const idempotency = getIdempotentOrStart({ userId: user.id, channel: payload.source?.channel || payload.channel || 'whatsapp', idempotencyKey: meta.idempotencyKey || payload.idempotency_key, operation: 'shared_debts.request.mark_paid.confirm', payload: { requestId, note } });
      if (idempotency.duplicate) return idempotency.response;
      try {
        const result = repository.markRequestPaid({ userId: user.id, requestId, note });
        if (!result.changed) throw new AutomationApiError(reasonMessage(result.reason, 'Não consegui marcar esse pagamento agora.'), { code: 'INVALID_SHARED_DEBT_STATE', statusCode: 409 });
        const response = makeResult({
          ok: true,
          code: 'PAYMENT_MARKED',
          data: { request: serializeRequest(result.request, user.id) },
          whatsapp: { text: '✅ Pagamento marcado como feito. Agora falta quem recebeu confirmar para fechar o acerto.' }
        });
        finishIdempotency(payload.source?.channel || payload.channel || 'whatsapp', idempotency.idempotencyKey, response, 'success');
        return response;
      } catch (error) {
        const response = handleServiceError(error);
        finishIdempotency(payload.source?.channel || payload.channel || 'whatsapp', idempotency.idempotencyKey, response, 'error');
        throw error;
      }
    });
  }

  function confirmReceived(payload = {}, meta = {}) {
    return withHandling(payload, meta, 'shared_debts.requests.confirm_received', (resolved) => {
      const { user } = resolved;
      const requestId = resolveRequestIdForUser(user.id, payload.requestId || payload.request_id || payload.id, payload, 'outgoing');
      const row = repository.getRequestByIdForParticipant(user.id, requestId);
      if (!row) throw new AutomationApiError('Não encontrei esse acerto para você.', { code: 'REQUEST_NOT_FOUND', statusCode: 404 });
      const note = payload.note || payload.creditor_note || null;
      const confirmation = requireConfirmationOrCreate({
        payload,
        resolved,
        meta,
        operation: 'confirm_received',
        statePayload: { request_id: requestId, note },
        code: 'NEEDS_RECEIPT_CONFIRMATION',
        confirmationText: [
          '⚠️ *Confirmar recebimento*',
          '',
          buildRequestLine(row, user.id),
          '',
          'Responde *confirmar* para encerrar o acerto ou *cancelar* para deixar em aberto.'
        ].join('\n')
      });
      if (confirmation) return confirmation;
      const idempotency = getIdempotentOrStart({ userId: user.id, channel: payload.source?.channel || payload.channel || 'whatsapp', idempotencyKey: meta.idempotencyKey || payload.idempotency_key, operation: 'shared_debts.request.confirm_received.confirm', payload: { requestId, note } });
      if (idempotency.duplicate) return idempotency.response;
      try {
        const result = repository.confirmRequestReceived({ userId: user.id, requestId, note });
        if (!result.changed) throw new AutomationApiError(reasonMessage(result.reason, 'Não consegui confirmar esse recebimento agora.'), { code: 'INVALID_SHARED_DEBT_STATE', statusCode: 409 });
        const response = makeResult({
          ok: true,
          code: 'PAYMENT_RECEIVED_CONFIRMED',
          data: { request: serializeRequest(result.request, user.id) },
          whatsapp: { text: '✅ Recebimento confirmado e acerto encerrado. Mais uma pendência que saiu da fila.' }
        });
        finishIdempotency(payload.source?.channel || payload.channel || 'whatsapp', idempotency.idempotencyKey, response, 'success');
        return response;
      } catch (error) {
        const response = handleServiceError(error);
        finishIdempotency(payload.source?.channel || payload.channel || 'whatsapp', idempotency.idempotencyKey, response, 'error');
        throw error;
      }
    });
  }


  function resolveSettlementIdForUser(userId, rawSettlementId, payload = {}) {
    const direct = toInt(rawSettlementId || payload.settlement_id || payload.settlementId || payload.id, 0);
    if (direct) return direct;
    const query = payload.query || payload;
    const period = resolvePeriod(query);
    const rows = repository.listCardSettlementsForReceiver(userId, { month: period.month, year: period.year, limit: 30 })
      .map((row) => ({
        ...row,
        counterpart_name: row.requester_name || row.requester_email || 'quem vai receber',
        openCents: Number(row.open_cents || 0)
      }));
    const hint = query.person_hint || query.person || query.counterpart_hint || query.name || '';
    if (!hint && rows.length === 1) return Number(rows[0].id || 0);
    const resolved = resolveByHint(rows, hint, ['counterpart_name', 'requester_name', 'requester_email']);
    if (resolved.status === 'found') return Number(resolved.item.id || 0);
    if (resolved.status === 'ambiguous') {
      throw new AutomationApiError('Encontrei mais de um acerto mensal parecido. Me manda o número #ID.', {
        code: 'NEEDS_SETTLEMENT_CLARIFICATION',
        statusCode: 200,
        details: { matches: resolved.matches.map((row) => ({ id: row.id, person: row.counterpart_name, month: row.month, year: row.year, open_cents: row.open_cents })) }
      });
    }
    throw new AutomationApiError('Não encontrei uma carteira mensal em aberto para gerar Pix. Peça *o que eu devo* para ver as opções.', { code: 'SETTLEMENT_NOT_FOUND', statusCode: 404 });
  }

  function buildPixPrepareText({ snapshot, profile, amountCents }) {
    return [
      '💸 *Pix do acerto mensal*',
      '',
      `Pessoa: *${snapshot.requester_name || snapshot.requester_email || 'quem vai receber'}*`,
      `Período: *${periodLabel(snapshot.month, snapshot.year)}*`,
      `Valor disponível: *${formatBRLFromCents(snapshot.openCents)}*`,
      `Valor do Pix: *${formatBRLFromCents(amountCents)}*`,
      profile?.pixMaskedKey ? `Chave: *${profile.pixMaskedKey}*` : '',
      '',
      'Responde *gerar* para eu montar o Pix copia e cola.'
    ].filter(Boolean).join('\n');
  }

  function prepareSettlementPix(payload = {}, meta = {}) {
    return withHandling(payload, meta, 'shared_debts.settlements.pix.prepare', (resolved) => {
      const { user } = resolved;
      const settlementId = resolveSettlementIdForUser(user.id, payload.settlementId || payload.settlement_id || payload.id, payload);
      let snapshot = repository.recalcCardMonthlySettlementFromId
        ? repository.recalcCardMonthlySettlementFromId(settlementId)
        : repository.getCardSettlementSnapshotById(settlementId);
      if (!snapshot) throw new AutomationApiError('Essa carteira mensal não apareceu por aqui.', { code: 'SETTLEMENT_NOT_FOUND', statusCode: 404 });
      if (Number(snapshot.receiver_user_id || 0) !== Number(user.id || 0)) throw new AutomationApiError('Esse Pix mensal fica do lado de quem vai pagar.', { code: 'FORBIDDEN', statusCode: 403 });
      snapshot = repository.recalcCardMonthlySettlement(snapshot.requester_user_id, snapshot.receiver_user_id, snapshot.month, snapshot.year) || snapshot;
      const open = Math.max(0, Number(snapshot.openCents || snapshot.open_cents || 0));
      if (!open) throw new AutomationApiError('Esse mês já está sem saldo aberto para um novo Pix agora.', { code: 'NO_OPEN_AMOUNT', statusCode: 409 });
      const amountCents = Math.min(open, Math.max(0, parseMoneyCents(payload.amount_cents || payload.amount || payload.raw_amount, open)) || open);
      const profile = repository.getUserPixProfile(snapshot.requester_user_id);
      if (!profile || !profile.pixEnabled) throw new AutomationApiError('Quem vai receber ainda não deixou um Pix prontinho por aqui.', { code: 'PIX_NOT_CONFIGURED', statusCode: 409 });
      if (!profile.pixValid) throw new AutomationApiError(profile.pixReason || 'O Pix de quem vai receber ainda precisa de um acerto.', { code: 'PIX_INVALID', statusCode: 409 });
      return createConfirmation({
        user,
        phoneE164: resolved.normalized.e164,
        source: payload.source || {},
        operation: 'create_settlement_pix',
        payload: { settlement_id: settlementId, amount_cents: amountCents },
        code: 'NEEDS_PIX_CONFIRMATION',
        text: buildPixPrepareText({ snapshot, profile, amountCents })
      });
    });
  }

  function createSettlementPix(payload = {}, meta = {}) {
    return withHandling(payload, meta, 'shared_debts.settlements.pix.create', ({ user }) => {
      const settlementId = resolveSettlementIdForUser(user.id, payload.settlementId || payload.settlement_id || payload.id, payload);
      let snapshot = repository.getCardSettlementSnapshotById(settlementId);
      if (!snapshot) throw new AutomationApiError('Essa carteira mensal não apareceu por aqui.', { code: 'SETTLEMENT_NOT_FOUND', statusCode: 404 });
      if (Number(snapshot.receiver_user_id || 0) !== Number(user.id || 0)) throw new AutomationApiError('Esse Pix mensal fica do lado de quem vai pagar.', { code: 'FORBIDDEN', statusCode: 403 });
      snapshot = repository.recalcCardMonthlySettlement(snapshot.requester_user_id, snapshot.receiver_user_id, snapshot.month, snapshot.year) || snapshot;
      const open = Math.max(0, Number(snapshot.openCents || snapshot.open_cents || 0));
      if (!open) throw new AutomationApiError('Esse mês já está sem saldo aberto para um novo Pix agora.', { code: 'NO_OPEN_AMOUNT', statusCode: 409 });
      const amountCents = Math.min(open, Math.max(0, parseMoneyCents(payload.amount_cents || payload.amount || payload.raw_amount, open)) || open);
      const confirmed = payload.confirmed === true || payload.confirm === true || isAffirmative(payload.confirmation || payload.raw_text || payload.text || '');
      if (!confirmed) {
        return makeResult({ ok: false, code: 'CONFIRMATION_REQUIRED', whatsapp: { text: 'Para gerar o Pix, responde *gerar* ou *confirmar*.' } }, 200);
      }
      const profile = repository.getUserPixProfile(snapshot.requester_user_id);
      if (!profile || !profile.pixEnabled) throw new AutomationApiError('Quem vai receber ainda não deixou um Pix prontinho por aqui.', { code: 'PIX_NOT_CONFIGURED', statusCode: 409 });
      if (!profile.pixValid) throw new AutomationApiError(profile.pixReason || 'O Pix de quem vai receber ainda precisa de um acerto.', { code: 'PIX_INVALID', statusCode: 409 });
      const idempotency = getIdempotentOrStart({ userId: user.id, channel: payload.source?.channel || payload.channel || 'whatsapp', idempotencyKey: meta.idempotencyKey || payload.idempotency_key, operation: 'shared_debts.settlement_pix.create', payload: { settlementId, amountCents } });
      if (idempotency.duplicate) return idempotency.response;
      try {
        let response;
        repository.db.transaction(() => {
          repository.cancelGeneratedSettlementIntents(settlementId, user.id);
          const intentId = repository.insertSettlementPixIntent({ settlement: snapshot, userId: user.id, amountCents, payload: null, txid: null });
          const txid = buildSharedDebtCardMonthlyPixTxid(settlementId, intentId);
          const finalPayload = buildPixPayload({
            keyType: profile.pixKeyType,
            keyValue: profile.pixKeyValue,
            merchantName: profile.ownerName || profile.pixMerchantName || snapshot.requester_name || 'ACERTTAPAY',
            merchantCity: profile.pixCity,
            amountCents,
            txid,
            referenceLabel: '***',
            pointOfInitiationMethod: '11',
            description: sanitizePixText(`CARTAO ${String(snapshot.month).padStart(2, '0')}/${snapshot.year}`, { max: 72 })
          });
          repository.db.prepare('UPDATE shared_debt_payment_intents SET pix_payload = ?, pix_txid = ?, updated_at = ? WHERE id = ?').run(finalPayload, txid, repository.nowIso(), intentId);
          response = makeResult({
            ok: true,
            code: 'PIX_CREATED',
            data: { settlement_id: settlementId, intent_id: intentId, amount_cents: amountCents, txid, payload: finalPayload, masked_key: profile.pixMaskedKey },
            whatsapp: {
              text: [
                '💸 *Pix gerado!*',
                '',
                `Valor: *${formatBRLFromCents(amountCents)}*`,
                `Para: *${profile.ownerName || snapshot.requester_name || 'quem vai receber'}*`,
                profile.pixMaskedKey ? `Chave: *${profile.pixMaskedKey}*` : '',
                '',
                '*Pix copia e cola:*',
                finalPayload,
                '',
                'Depois de pagar, pode me avisar com *marcar como pago*.'
              ].filter(Boolean).join('\n')
            }
          });
        })();
        finishIdempotency(payload.source?.channel || payload.channel || 'whatsapp', idempotency.idempotencyKey, response, 'success');
        return response;
      } catch (error) {
        const response = handleServiceError(error);
        finishIdempotency(payload.source?.channel || payload.channel || 'whatsapp', idempotency.idempotencyKey, response, 'error');
        throw error;
      }
    });
  }

  function handleConversationReply(payload = {}, meta = {}) {
    return withHandling(payload, meta, 'shared_debts.conversation.reply', (resolved) => {
      const { user } = resolved;
      const conversation = repository.getOpenConversationForUser(user.id, resolved.normalized.e164);
      if (!conversation || conversation.state !== 'awaiting_shared_debt_action_confirmation') {
        throw new AutomationApiError('Não encontrei uma confirmação pendente da Central de Acertos por aqui.', { code: 'NO_PENDING_SHARED_DEBT_CONVERSATION', statusCode: 404 });
      }
      const data = repository.getConversationPayload(conversation) || {};
      const reply = payload.reply || payload;
      const rawText = reply.raw_text || payload.source?.raw_text || payload.raw_text || payload.text || '';
      if (isNegative(rawText) || reply.confirm === false || reply.cancel === true) {
        repository.resolveConversationState(conversation.id);
        return makeResult({ ok: true, code: 'SHARED_DEBT_ACTION_CANCELLED', whatsapp: { text: 'Combinado. Não mexi na Central de Acertos.' } });
      }
      if (!isAffirmative(rawText) && reply.confirm !== true && reply.confirmed !== true) {
        return makeResult({ ok: false, code: 'CONFIRMATION_REQUIRED', whatsapp: { text: 'Ainda preciso de uma confirmação clara: responde *confirmar* para seguir ou *cancelar* para não mexer.' } }, 200);
      }
      const basePayload = {
        ...(data.payload || {}),
        phone: payload.phone || payload.user_phone || payload.number,
        source: payload.source || data.source || {},
        confirmed: true,
        confirmation: rawText || 'confirmar'
      };
      repository.resolveConversationState(conversation.id);
      if (data.operation === 'send_draft_queue') return confirmDraftSend(basePayload, meta);
      if (data.operation === 'respond_request') return respondRequest(basePayload, meta);
      if (data.operation === 'mark_paid') return markPaid(basePayload, meta);
      if (data.operation === 'confirm_received') return confirmReceived(basePayload, meta);
      if (data.operation === 'create_settlement_pix') return createSettlementPix(basePayload, meta);
      throw new AutomationApiError('Essa confirmação pendente não é mais reconhecida.', { code: 'UNKNOWN_SHARED_DEBT_CONVERSATION_STATE', statusCode: 400 });
    });
  }

  return {
    getSummary,
    listDraftQueues,
    getRequests,
    prepareDraftSend,
    confirmDraftSend,
    respondRequest,
    markPaid,
    confirmReceived,
    prepareSettlementPix,
    createSettlementPix,
    handleConversationReply,
    handleServiceError
  };
}

module.exports = {
  createAutomationSharedDebtsService
};
