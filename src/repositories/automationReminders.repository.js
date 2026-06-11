const db = require('../db');
const { createAutomationApiRepository } = require('./automationApi.repository');

function nowIso() {
  return new Date().toISOString();
}

function safeJsonStringify(value, fallback = '{}') {
  try {
    return JSON.stringify(value == null ? null : value);
  } catch (error) {
    return fallback;
  }
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

function toPositiveInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeReminderRow(row = {}) {
  if (!row) return null;
  return {
    ...row,
    id: Number(row.id || 0),
    user_id: Number(row.user_id || 0),
    source_id: Number(row.source_id || 0) || null,
    sent_count: Number(row.sent_count || 0),
    payload: safeJsonParse(row.payload_json, {}) || {}
  };
}

function createAutomationRemindersRepository() {
  const base = createAutomationApiRepository();

  function insertReminder(payload = {}) {
    const now = nowIso();
    const info = db.prepare(`
      INSERT INTO automation_reminders (
        user_id, phone_e164, whatsapp_number, channel, title, body, remind_at,
        timezone, status, source_kind, source_id, payload_json,
        created_at, updated_at, completed_at, cancelled_at, snoozed_until,
        last_sent_at, sent_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, 0)
    `).run(
      Number(payload.userId || 0),
      payload.phoneE164 || null,
      payload.whatsappNumber || null,
      payload.channel || 'whatsapp',
      payload.title,
      payload.body || null,
      payload.remindAt,
      payload.timezone || 'America/Sao_Paulo',
      payload.sourceKind || 'generic',
      Number(payload.sourceId || 0) || null,
      safeJsonStringify(payload.payload || {}, '{}'),
      now,
      now
    );
    return getReminderById(payload.userId, info.lastInsertRowid);
  }

  function getReminderById(userId, reminderId) {
    const row = db.prepare(`
      SELECT r.*, u.name AS user_name, u.email AS user_email
      FROM automation_reminders r
      LEFT JOIN users u ON u.id = r.user_id
      WHERE r.id = ? AND r.user_id = ?
      LIMIT 1
    `).get(Number(reminderId || 0), Number(userId || 0));
    return normalizeReminderRow(row);
  }

  function searchReminders(userId, options = {}) {
    const where = ['r.user_id = ?'];
    const params = [Number(userId || 0)];
    const status = String(options.status || 'open').trim().toLowerCase();
    if (status && status !== 'all') {
      where.push('r.status = ?');
      params.push(status);
    }
    if (options.from) {
      where.push('datetime(r.remind_at) >= datetime(?)');
      params.push(options.from);
    }
    if (options.to) {
      where.push('datetime(r.remind_at) <= datetime(?)');
      params.push(options.to);
    }
    if (options.sourceKind) {
      where.push('r.source_kind = ?');
      params.push(String(options.sourceKind || '').trim());
    }
    if (options.text) {
      where.push('(lower(r.title) LIKE ? OR lower(COALESCE(r.body, \"\")) LIKE ?)');
      const needle = `%${String(options.text || '').trim().toLowerCase()}%`;
      params.push(needle, needle);
    }
    const order = options.order === 'updated'
      ? 'datetime(r.updated_at) DESC, r.id DESC'
      : 'datetime(r.remind_at) ASC, r.id ASC';
    const limit = Math.max(1, Math.min(50, toPositiveInt(options.limit, 10)));
    params.push(limit);
    return db.prepare(`
      SELECT r.*, u.name AS user_name, u.email AS user_email
      FROM automation_reminders r
      LEFT JOIN users u ON u.id = r.user_id
      WHERE ${where.join(' AND ')}
      ORDER BY ${order}
      LIMIT ?
    `).all(...params).map(normalizeReminderRow);
  }

  function updateReminderStatus({ userId, reminderId, status, completedAt = null, cancelledAt = null, payload = null }) {
    const current = getReminderById(userId, reminderId);
    if (!current) return null;
    const nextPayload = payload ? safeJsonStringify({ ...(current.payload || {}), ...payload }, '{}') : current.payload_json;
    db.prepare(`
      UPDATE automation_reminders
      SET status = ?, completed_at = ?, cancelled_at = ?, payload_json = ?, updated_at = ?
      WHERE id = ? AND user_id = ?
    `).run(status, completedAt, cancelledAt, nextPayload, nowIso(), Number(reminderId || 0), Number(userId || 0));
    return getReminderById(userId, reminderId);
  }

  function snoozeReminder({ userId, reminderId, remindAt, payload = null }) {
    const current = getReminderById(userId, reminderId);
    if (!current) return null;
    const nextPayload = payload ? safeJsonStringify({ ...(current.payload || {}), ...payload }, '{}') : current.payload_json;
    db.prepare(`
      UPDATE automation_reminders
      SET remind_at = ?,
          snoozed_until = ?,
          last_sent_at = NULL,
          status = 'open',
          payload_json = ?,
          updated_at = ?
      WHERE id = ? AND user_id = ?
    `).run(remindAt, remindAt, nextPayload, nowIso(), Number(reminderId || 0), Number(userId || 0));
    return getReminderById(userId, reminderId);
  }

  function findDueReminders(options = {}) {
    const limit = Math.max(1, Math.min(200, toPositiveInt(options.limit, 50)));
    const now = options.now || nowIso();
    return db.prepare(`
      SELECT r.*, u.name AS user_name, u.email AS user_email
      FROM automation_reminders r
      JOIN users u ON u.id = r.user_id AND COALESCE(u.status, 'active') <> 'deleted'
      JOIN automation_whatsapp_authorizations a
        ON a.user_id = r.user_id
       AND a.enabled = 1
       AND (a.phone_e164 = r.phone_e164 OR a.whatsapp_number = r.whatsapp_number)
      WHERE r.status = 'open'
        AND datetime(r.remind_at) <= datetime(?)
        AND (r.last_sent_at IS NULL OR datetime(r.last_sent_at) < datetime(r.remind_at))
      ORDER BY datetime(r.remind_at) ASC, r.id ASC
      LIMIT ?
    `).all(now, limit).map(normalizeReminderRow);
  }

  function markReminderSent({ userId, reminderId, channel = 'whatsapp', meta = null }) {
    const current = getReminderById(userId, reminderId);
    if (!current) return null;
    const now = nowIso();
    const nextPayload = meta ? safeJsonStringify({ ...(current.payload || {}), last_delivery: meta }, '{}') : current.payload_json;
    db.prepare(`
      UPDATE automation_reminders
      SET last_sent_at = ?, sent_count = COALESCE(sent_count, 0) + 1, payload_json = ?, updated_at = ?
      WHERE id = ? AND user_id = ?
    `).run(now, nextPayload, now, Number(reminderId || 0), Number(userId || 0));
    try {
      db.prepare(`
        INSERT INTO notifications (user_id, type, title, body, href, is_read, related_type, related_id, created_at)
        VALUES (?, 'automation_reminder', ?, ?, '/geral', 0, 'automation_reminder', ?, ?)
      `).run(
        Number(userId || 0),
        current.title || 'Lembrete do AcerttaPay',
        current.body || `Lembrete disparado pelo ${channel}.`,
        Number(reminderId || 0),
        now
      );
    } catch (error) {
      // notificação local nao pode derrubar o disparo via WhatsApp
    }
    return getReminderById(userId, reminderId);
  }

  function listPeople(userId) {
    return db.prepare(`
      SELECT id, name, email, phone, active, is_owner, profile_kind, status
      FROM people
      WHERE user_id = ?
        AND COALESCE(status, CASE WHEN COALESCE(active, 1) = 0 THEN 'inactive' ELSE 'active' END) <> 'deleted'
      ORDER BY COALESCE(profile_kind, CASE WHEN COALESCE(is_owner, 0) = 1 THEN 'self' ELSE 'contact' END) = 'self' DESC,
               lower(name), id ASC
    `).all(Number(userId || 0));
  }

  return {
    db,
    nowIso,
    safeJsonParse,
    safeJsonStringify,
    getAppSetting: base.getAppSetting,
    getBooleanSetting: base.getBooleanSetting,
    getIntegerSetting: base.getIntegerSetting,
    getAuthorizationByPhone: base.getAuthorizationByPhone,
    touchAuthorization: base.touchAuthorization,
    getUserById: base.getUserById,
    logRequest: base.logRequest,
    tryCreateIdempotency: base.tryCreateIdempotency,
    finishIdempotency: base.finishIdempotency,
    insertReminder,
    getReminderById,
    searchReminders,
    updateReminderStatus,
    snoozeReminder,
    findDueReminders,
    markReminderSent,
    listPeople
  };
}

module.exports = {
  createAutomationRemindersRepository
};
