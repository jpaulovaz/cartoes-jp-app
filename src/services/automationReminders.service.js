const crypto = require('crypto');
const dayjs = require('dayjs');
const { createAutomationRemindersRepository } = require('../repositories/automationReminders.repository');
const { AutomationApiError, normalizeAutomationPhone } = require('./automationApi.service');

const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

function makeResult(payload = {}, statusCode = 200) {
  return { statusCode, ...payload };
}

function requestHash(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload || {})).digest('hex');
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

function clampText(value = '', max = 180) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, Math.max(1, Number(max || 0) || 180));
}

function formatDateTimeBR(value, timezone = DEFAULT_TIMEZONE) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: timezone || DEFAULT_TIMEZONE,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date).replace(',', ' às');
  } catch (error) {
    return date.toISOString().slice(0, 16).replace('T', ' ');
  }
}

function formatDateBR(value, timezone = DEFAULT_TIMEZONE) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: timezone || DEFAULT_TIMEZONE,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }).format(date);
  } catch (error) {
    return String(value || '').slice(0, 10);
  }
}

function addDaysIso(dateLike, days) {
  const date = new Date(dateLike);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString();
}

function parseReminderDateTime(value, options = {}) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const defaultTime = String(options.defaultTime || '09:00').trim() || '09:00';
    const candidate = new Date(`${raw}T${defaultTime}:00-03:00`);
    return Number.isNaN(candidate.getTime()) ? null : candidate.toISOString();
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)) {
    const candidate = new Date(`${raw}:00-03:00`);
    return Number.isNaN(candidate.getTime()) ? null : candidate.toISOString();
  }

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function resolveSearchWindow(query = {}) {
  const currentDate = new Date().toLocaleDateString('sv-SE', { timeZone: DEFAULT_TIMEZONE });
  const today = new Date(`${currentDate}T00:00:00-03:00`);
  const period = String(query.period || query.when || '').trim().toLowerCase();
  let from = parseReminderDateTime(query.from || query.start_date || query.startDate || '');
  let to = parseReminderDateTime(query.to || query.end_date || query.endDate || '');

  if (period === 'today' || period === 'hoje') {
    from = today.toISOString();
    to = addDaysIso(today, 1);
  } else if (period === 'tomorrow' || period === 'amanha' || period === 'amanhã') {
    const start = new Date(today);
    start.setUTCDate(start.getUTCDate() + 1);
    from = start.toISOString();
    to = addDaysIso(start, 1);
  } else if (period === 'week' || period === 'this_week' || period === 'semana' || period === 'esta semana') {
    from = today.toISOString();
    to = addDaysIso(today, 7);
  } else if (period === 'month' || period === 'this_month' || period === 'mes' || period === 'mês') {
    from = today.toISOString();
    to = addDaysIso(today, 31);
  }

  if (!from && !to) {
    from = today.toISOString();
    to = addDaysIso(today, 30);
  }

  return { from, to };
}

function scoreName(row, hint) {
  const needle = normalizeText(hint);
  if (!needle) return 0;
  const hay = normalizeText(row.name || row.title || row.body || '');
  if (!hay) return 0;
  if (hay === needle) return 100;
  if (hay.startsWith(needle)) return 92;
  if (needle.startsWith(hay)) return 88;
  if (hay.includes(needle) || needle.includes(hay)) return 78;
  const tokens = needle.split(' ').filter(Boolean);
  const hayTokens = new Set(hay.split(' ').filter(Boolean));
  const hits = tokens.filter((token) => hayTokens.has(token)).length;
  return hits ? Math.min(70, 40 + hits * 10) : 0;
}

function resolveByHint(rows = [], hint = '') {
  const matches = (rows || [])
    .map((row) => ({ row, score: scoreName(row, hint) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || Number(a.row.id || 0) - Number(b.row.id || 0));
  if (!matches.length) return { status: 'not_found', item: null, matches: [] };
  const topScore = matches[0].score;
  const tied = matches.filter((entry) => entry.score === topScore || (topScore - entry.score <= 4 && topScore < 100));
  if (tied.length > 1) return { status: 'ambiguous', item: null, matches: tied.map((entry) => entry.row) };
  return { status: 'found', item: matches[0].row, matches: matches.map((entry) => entry.row) };
}

function serializeReminder(row = {}) {
  return {
    id: Number(row.id || 0),
    title: row.title || '',
    body: row.body || null,
    remind_at: row.remind_at || null,
    timezone: row.timezone || DEFAULT_TIMEZONE,
    status: row.status || 'open',
    source_kind: row.source_kind || 'generic',
    source_id: Number(row.source_id || 0) || null,
    completed_at: row.completed_at || null,
    cancelled_at: row.cancelled_at || null,
    snoozed_until: row.snoozed_until || null,
    last_sent_at: row.last_sent_at || null,
    sent_count: Number(row.sent_count || 0),
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    payload: row.payload || {}
  };
}

function createAutomationRemindersService(deps = {}) {
  const repository = deps.remindersRepository || deps.repository || createAutomationRemindersRepository();

  function handleServiceError(error) {
    if (error instanceof AutomationApiError) {
      return makeResult({
        ok: false,
        code: error.code || 'REMINDER_VALIDATION_ERROR',
        message: error.message,
        details: error.details || null,
        whatsapp: { text: error.message }
      }, error.statusCode || 400);
    }
    return makeResult({
      ok: false,
      code: 'REMINDER_INTERNAL_ERROR',
      message: 'O lembrete tropeçou por aqui. Tenta de novo em instantes.',
      whatsapp: { text: 'O lembrete tropeçou por aqui. Tenta de novo em instantes.' }
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

  function withReminderHandling(payload, meta, operation, fn) {
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

  function resolvePersonForReminder(userId, personHint) {
    const hint = String(personHint || '').trim();
    if (!hint) return null;
    const people = repository.listPeople(userId).filter((person) => Number(person.active ?? 1) !== 0);
    const resolved = resolveByHint(people, hint);
    if (resolved.status === 'found') return resolved.item;
    return null;
  }

  function normalizeReminderPayload(payload = {}, resolved) {
    const reminder = payload.reminder || payload;
    const defaultTime = repository.getAppSetting('AUTOMATION_REMINDER_DEFAULT_TIME', '09:00') || '09:00';
    const title = clampText(reminder.title || reminder.description || reminder.text || payload.title || '', 140);
    if (!title) {
      throw new AutomationApiError('Me diz o que você quer lembrar. Ex.: *me lembra amanhã de pagar a fatura do Nubank*.', {
        code: 'MISSING_REMINDER_TITLE',
        statusCode: 400
      });
    }
    const remindAt = parseReminderDateTime(reminder.remind_at || reminder.remindAt || reminder.date_time || reminder.datetime || payload.remind_at, { defaultTime });
    if (!remindAt) {
      throw new AutomationApiError('Não consegui entender quando te lembrar. Me manda uma data ou horário claro, tipo *amanhã às 9h* ou *dia 15 às 10h*.', {
        code: 'MISSING_REMINDER_DATE',
        statusCode: 400
      });
    }
    if (dayjs(remindAt).isBefore(dayjs().subtract(1, 'minute'))) {
      throw new AutomationApiError('Esse horário já passou. Me manda um horário futuro para eu não virar máquina do tempo.', {
        code: 'REMINDER_DATE_IN_PAST',
        statusCode: 400
      });
    }
    const personHint = reminder.person_hint || reminder.personHint || payload.person_hint || '';
    const person = resolvePersonForReminder(resolved.user.id, personHint);
    const sourceKind = person ? 'person' : clampText(reminder.source_kind || reminder.sourceKind || payload.source_kind || 'generic', 40) || 'generic';
    return {
      userId: resolved.user.id,
      phoneE164: resolved.phone.e164,
      whatsappNumber: resolved.phone.whatsappNumber,
      channel: payload.source?.channel || payload.channel || 'whatsapp',
      title,
      body: clampText(reminder.body || reminder.note || payload.body || '', 400) || null,
      remindAt,
      timezone: reminder.timezone || payload.timezone || DEFAULT_TIMEZONE,
      sourceKind,
      sourceId: person ? person.id : Number(reminder.source_id || reminder.sourceId || payload.source_id || 0) || null,
      payload: {
        source: payload.source || {},
        person_hint: personHint || null,
        person: person ? { id: Number(person.id || 0), name: person.name || null } : null,
        raw: reminder
      }
    };
  }

  function buildReminderCreatedText(row) {
    const when = formatDateTimeBR(row.remind_at, row.timezone);
    const person = row.payload?.person?.name ? `\n👤 Pessoa: *${row.payload.person.name}*` : '';
    return [
      '⏰ *Lembrete criado!*',
      '',
      `📝 ${row.title}`,
      `📅 Quando: *${when}*`,
      person,
      '',
      'Quando chegar a hora, eu te chamo por aqui. Memória humana agora pode respirar. ✅'
    ].filter(Boolean).join('\n');
  }

  function createReminder(payload = {}, meta = {}) {
    return withReminderHandling(payload, meta, 'reminder.create', (resolved) => {
      const idempotencyKey = String(meta?.idempotencyKey || payload.idempotency_key || '').trim();
      if (!idempotencyKey) {
        throw new AutomationApiError('Idempotency-Key é obrigatório para criar lembrete por automação.', {
          code: 'IDEMPOTENCY_KEY_REQUIRED',
          statusCode: 400
        });
      }
      const idempotency = repository.tryCreateIdempotency({
        userId: resolved.user.id,
        channel: payload.source?.channel || payload.channel || 'whatsapp',
        idempotencyKey,
        operation: 'reminder.create',
        requestHash: requestHash(payload)
      });
      if (!idempotency.created) {
        const cached = repository.safeJsonParse(idempotency.row?.response_json, null);
        if (cached) return makeResult({ ...cached, duplicate: true }, 200);
        throw new AutomationApiError('Esse lembrete já está sendo processado. Não criei duas vezes.', {
          code: 'IDEMPOTENCY_IN_PROGRESS',
          statusCode: 409
        });
      }
      let response;
      try {
        const normalized = normalizeReminderPayload(payload, resolved);
        const row = repository.insertReminder(normalized);
        response = makeResult({
          ok: true,
          code: 'REMINDER_CREATED',
          reminder: serializeReminder(row),
          whatsapp: { text: buildReminderCreatedText(row) }
        });
        repository.finishIdempotency({ channel: payload.source?.channel || payload.channel || 'whatsapp', idempotencyKey, response, status: 'success' });
        return response;
      } catch (error) {
        response = handleServiceError(error);
        repository.finishIdempotency({ channel: payload.source?.channel || payload.channel || 'whatsapp', idempotencyKey, response, status: 'error' });
        throw error;
      }
    });
  }

  function buildReminderListText(rows = [], title = '⏰ *Seus lembretes*') {
    if (!rows.length) {
      return `${title}\n\nNada aberto por aqui. Sua cabeça ganhou folga e eu também.`;
    }
    const lines = rows.map((row, index) => {
      const when = formatDateTimeBR(row.remind_at, row.timezone);
      return `${index + 1}. *#${row.id}* — ${row.title}\n   📅 ${when}`;
    });
    return [title, '', ...lines, '', 'Para concluir ou cancelar, pode responder: *concluir lembrete #2* ou *cancelar lembrete #2*.'].join('\n');
  }

  function searchReminders(payload = {}, meta = {}) {
    return withReminderHandling(payload, meta, 'reminder.search', (resolved) => {
      const query = payload.query || {};
      const window = resolveSearchWindow(query);
      const rows = repository.searchReminders(resolved.user.id, {
        status: query.status || payload.status || 'open',
        from: query.from || window.from,
        to: query.to || window.to,
        text: query.text || query.title_hint || payload.text || '',
        limit: query.limit || payload.limit || 10
      });
      return makeResult({
        ok: true,
        code: 'REMINDERS_LIST',
        reminders: rows.map(serializeReminder),
        whatsapp: { text: buildReminderListText(rows) }
      });
    });
  }

  function resolveReminderTarget(userId, payload = {}) {
    const target = payload.target || {};
    const rawId = target.reminder_id || target.id || payload.reminder_id || payload.id || payload.reminderId || '';
    const parsedId = Number.parseInt(String(rawId || '').replace(/[^0-9]/g, ''), 10);
    if (Number.isFinite(parsedId) && parsedId > 0) {
      const row = repository.getReminderById(userId, parsedId);
      if (!row) {
        throw new AutomationApiError('Não encontrei esse lembrete. Confere o número dele?', {
          code: 'REMINDER_NOT_FOUND',
          statusCode: 404
        });
      }
      return row;
    }
    const hint = target.title_hint || target.text || payload.title_hint || payload.text || '';
    const rows = repository.searchReminders(userId, {
      status: 'open',
      text: hint,
      order: hint ? 'due' : 'updated',
      limit: hint ? 5 : 1
    });
    if (!rows.length) {
      throw new AutomationApiError('Não encontrei lembrete aberto para mexer. Me manda o número do lembrete ou peça a lista.', {
        code: 'REMINDER_NOT_FOUND',
        statusCode: 404
      });
    }
    if (hint && rows.length > 1) {
      throw new AutomationApiError(buildReminderListText(rows, 'Achei mais de um lembrete parecido. Qual deles?'), {
        code: 'NEEDS_REMINDER_SELECTION',
        statusCode: 409,
        details: { reminders: rows.map(serializeReminder) }
      });
    }
    return rows[0];
  }

  function completeReminder(payload = {}, meta = {}) {
    return withReminderHandling(payload, meta, 'reminder.complete', (resolved) => {
      const current = resolveReminderTarget(resolved.user.id, payload);
      if (current.status !== 'open') {
        return makeResult({
          ok: true,
          code: 'REMINDER_ALREADY_RESOLVED',
          reminder: serializeReminder(current),
          whatsapp: { text: 'Esse lembrete já não está aberto. Gaveta organizada por aqui.' }
        });
      }
      const row = repository.updateReminderStatus({
        userId: resolved.user.id,
        reminderId: current.id,
        status: 'completed',
        completedAt: repository.nowIso(),
        payload: { completed_source: payload.source || {} }
      });
      return makeResult({
        ok: true,
        code: 'REMINDER_COMPLETED',
        reminder: serializeReminder(row),
        whatsapp: { text: `✅ Pronto, concluí o lembrete *#${row.id}* — ${row.title}. Uma pendência a menos na mochila.` }
      });
    });
  }

  function cancelReminder(payload = {}, meta = {}) {
    return withReminderHandling(payload, meta, 'reminder.cancel', (resolved) => {
      const current = resolveReminderTarget(resolved.user.id, payload);
      if (current.status !== 'open') {
        return makeResult({
          ok: true,
          code: 'REMINDER_ALREADY_RESOLVED',
          reminder: serializeReminder(current),
          whatsapp: { text: 'Esse lembrete já não está aberto. Nada novo para cancelar.' }
        });
      }
      const row = repository.updateReminderStatus({
        userId: resolved.user.id,
        reminderId: current.id,
        status: 'cancelled',
        cancelledAt: repository.nowIso(),
        payload: { cancelled_source: payload.source || {} }
      });
      return makeResult({
        ok: true,
        code: 'REMINDER_CANCELLED',
        reminder: serializeReminder(row),
        whatsapp: { text: `🗑️ Cancelado o lembrete *#${row.id}* — ${row.title}. Não vou te cutucar sobre isso.` }
      });
    });
  }

  function resolveSnoozeDate(payload = {}) {
    const snooze = payload.snooze || payload;
    const explicit = parseReminderDateTime(snooze.remind_at || snooze.remindAt || snooze.date_time || snooze.datetime || '');
    if (explicit) return explicit;
    const minutes = Number(snooze.minutes || snooze.delay_minutes || payload.minutes || 0);
    if (Number.isFinite(minutes) && minutes > 0) {
      return new Date(Date.now() + minutes * 60 * 1000).toISOString();
    }
    const hours = Number(snooze.hours || payload.hours || 0);
    if (Number.isFinite(hours) && hours > 0) {
      return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
    }
    return null;
  }

  function snoozeReminder(payload = {}, meta = {}) {
    return withReminderHandling(payload, meta, 'reminder.snooze', (resolved) => {
      const current = resolveReminderTarget(resolved.user.id, payload);
      const nextDate = resolveSnoozeDate(payload);
      if (!nextDate) {
        throw new AutomationApiError('Por quanto tempo eu adio? Ex.: *adiar 1 hora* ou *me lembra amanhã às 9h*.', {
          code: 'MISSING_SNOOZE_DATE',
          statusCode: 400
        });
      }
      if (dayjs(nextDate).isBefore(dayjs().subtract(1, 'minute'))) {
        throw new AutomationApiError('Esse novo horário já passou. Me manda um horário futuro para adiar certinho.', {
          code: 'REMINDER_DATE_IN_PAST',
          statusCode: 400
        });
      }
      const row = repository.snoozeReminder({
        userId: resolved.user.id,
        reminderId: current.id,
        remindAt: nextDate,
        payload: { snoozed_source: payload.source || {} }
      });
      return makeResult({
        ok: true,
        code: 'REMINDER_SNOOZED',
        reminder: serializeReminder(row),
        whatsapp: { text: `😴 Combinado, adiei o lembrete *#${row.id}* para *${formatDateTimeBR(row.remind_at, row.timezone)}*.` }
      });
    });
  }

  function getDueReminders(payload = {}, meta = {}) {
    try {
      const limit = Math.max(1, Math.min(200, Number(payload.limit || repository.getIntegerSetting('AUTOMATION_REMINDER_DUE_BATCH_LIMIT', 50)) || 50));
      const reminders = repository.findDueReminders({ limit });
      const response = makeResult({
        ok: true,
        code: 'DUE_REMINDERS',
        reminders: reminders.map((row) => ({
          ...serializeReminder(row),
          user_id: Number(row.user_id || 0),
          phone_e164: row.phone_e164,
          whatsapp_number: row.whatsapp_number,
          channel: row.channel || 'whatsapp',
          outbound_text: [
            '⏰ *Lembrete do AcerttaPay*',
            '',
            row.title,
            row.body ? `\n${row.body}` : '',
            '',
            `Agendado para: *${formatDateTimeBR(row.remind_at, row.timezone)}*`,
            '',
            'Responde *concluir lembrete #' + row.id + '* quando resolver ou *adiar lembrete #' + row.id + ' por 1 hora* se quiser mais uns minutinhos.'
          ].filter(Boolean).join('\n')
        }))
      });
      repository.logRequest({
        operation: 'reminder.due',
        statusCode: response.statusCode,
        resultCode: response.code,
        channel: payload.channel || 'whatsapp',
        ipAddress: meta?.ipAddress || null,
        responseMeta: { count: reminders.length }
      });
      return response;
    } catch (error) {
      return handleServiceError(error);
    }
  }

  function markReminderSent(payload = {}, meta = {}) {
    try {
      const userId = Number(payload.user_id || payload.userId || 0);
      const reminderId = Number(payload.reminder_id || payload.reminderId || payload.id || 0);
      if (!userId || !reminderId) {
        throw new AutomationApiError('user_id e reminder_id são obrigatórios para marcar disparo.', {
          code: 'MISSING_REMINDER_DISPATCH_TARGET',
          statusCode: 400
        });
      }
      const row = repository.markReminderSent({
        userId,
        reminderId,
        channel: payload.channel || 'whatsapp',
        meta: {
          message_id: payload.message_id || payload.messageId || null,
          source: payload.source || null,
          marked_at: repository.nowIso()
        }
      });
      if (!row) {
        throw new AutomationApiError('Não encontrei esse lembrete para marcar como enviado.', {
          code: 'REMINDER_NOT_FOUND',
          statusCode: 404
        });
      }
      const response = makeResult({ ok: true, code: 'REMINDER_MARKED_SENT', reminder: serializeReminder(row) });
      repository.logRequest({
        userId,
        phoneE164: row.phone_e164 || null,
        channel: payload.channel || 'whatsapp',
        operation: 'reminder.mark_sent',
        statusCode: response.statusCode,
        resultCode: response.code,
        sourceMessageId: payload.message_id || null,
        ipAddress: meta?.ipAddress || null
      });
      return response;
    } catch (error) {
      return handleServiceError(error);
    }
  }

  return {
    createReminder,
    searchReminders,
    completeReminder,
    cancelReminder,
    snoozeReminder,
    getDueReminders,
    markReminderSent,
    handleServiceError
  };
}

module.exports = {
  createAutomationRemindersService,
  parseReminderDateTime,
  formatDateTimeBR,
  resolveSearchWindow
};
