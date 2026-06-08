const db = require('../db');

function nowIso() {
  return new Date().toISOString();
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

function safeJsonStringify(value, fallback = '{}') {
  try {
    return JSON.stringify(value == null ? null : value);
  } catch (error) {
    return fallback;
  }
}

function createAutomationApiRepository() {
  function getAppSetting(key, fallback = '') {
    const row = db.prepare('SELECT value FROM app_settings WHERE key = ? LIMIT 1').get(String(key || '').trim());
    if (row && row.value !== null && row.value !== undefined) return String(row.value);
    if (process.env[key] !== undefined && process.env[key] !== null) return String(process.env[key]);
    return fallback;
  }

  function getBooleanSetting(key, fallback = false) {
    const raw = String(getAppSetting(key, fallback ? '1' : '0') || '').trim().toLowerCase();
    if (['1', 'true', 'on', 'yes', 'sim', 'enabled', 'ativo'].includes(raw)) return true;
    if (['0', 'false', 'off', 'no', 'nao', 'não', 'disabled', 'inativo'].includes(raw)) return false;
    return !!fallback;
  }

  function getIntegerSetting(key, fallback = 0) {
    const parsed = Number.parseInt(String(getAppSetting(key, String(fallback)) || ''), 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function getUserById(userId) {
    return db.prepare(`
      SELECT id, email, name, role, status
      FROM users
      WHERE id = ? AND COALESCE(status, 'active') <> 'deleted'
      LIMIT 1
    `).get(Number(userId || 0));
  }

  function getSelfPerson(userId) {
    return db.prepare(`
      SELECT *
      FROM people
      WHERE user_id = ?
        AND COALESCE(profile_kind, CASE WHEN COALESCE(is_owner, 0) = 1 THEN 'self' ELSE 'contact' END) = 'self'
        AND COALESCE(status, CASE WHEN COALESCE(active, 1) = 0 THEN 'inactive' ELSE 'active' END) <> 'deleted'
      ORDER BY id ASC
      LIMIT 1
    `).get(Number(userId || 0));
  }

  function getAuthorizationForUser(userId) {
    return db.prepare(`
      SELECT *
      FROM automation_whatsapp_authorizations
      WHERE user_id = ?
      ORDER BY updated_at DESC, id DESC
      LIMIT 1
    `).get(Number(userId || 0));
  }

  function getAuthorizationByPhone(phoneE164, whatsappNumber = '') {
    const phone = String(phoneE164 || '').trim();
    const digits = String(whatsappNumber || '').replace(/\D/g, '');
    return db.prepare(`
      SELECT a.*, u.email AS user_email, u.name AS user_name, u.status AS user_status
      FROM automation_whatsapp_authorizations a
      JOIN users u ON u.id = a.user_id
      WHERE (a.phone_e164 = ? OR (? <> '' AND a.whatsapp_number = ?))
      ORDER BY a.enabled DESC, a.updated_at DESC, a.id DESC
      LIMIT 1
    `).get(phone, digits, digits);
  }

  function findAuthorizationConflict(phoneE164, userId) {
    const phone = String(phoneE164 || '').trim();
    if (!phone) return null;
    return db.prepare(`
      SELECT a.*, u.email AS user_email, u.name AS user_name
      FROM automation_whatsapp_authorizations a
      JOIN users u ON u.id = a.user_id
      WHERE a.phone_e164 = ? AND a.user_id <> ?
      LIMIT 1
    `).get(phone, Number(userId || 0));
  }

  function upsertAuthorization({ userId, phoneE164, whatsappNumber, enabled, label = null, allowedActions = null }) {
    const now = nowIso();
    const actionsJson = safeJsonStringify(allowedActions || ['purchase:create', 'purchase:split'], '["purchase:create","purchase:split"]');
    const existing = getAuthorizationForUser(userId);
    if (existing) {
      db.prepare(`
        UPDATE automation_whatsapp_authorizations
        SET phone_e164 = ?,
            whatsapp_number = ?,
            enabled = ?,
            label = ?,
            allowed_actions_json = ?,
            updated_at = ?
        WHERE id = ? AND user_id = ?
      `).run(phoneE164, whatsappNumber, enabled ? 1 : 0, label, actionsJson, now, existing.id, userId);
      return getAuthorizationForUser(userId);
    }

    const info = db.prepare(`
      INSERT INTO automation_whatsapp_authorizations (
        user_id, phone_e164, whatsapp_number, enabled, label, allowed_actions_json,
        created_at, updated_at, last_used_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `).run(userId, phoneE164, whatsappNumber, enabled ? 1 : 0, label, actionsJson, now, now);

    return db.prepare('SELECT * FROM automation_whatsapp_authorizations WHERE id = ? LIMIT 1').get(info.lastInsertRowid);
  }

  function disableAuthorizationForUser(userId) {
    const now = nowIso();
    db.prepare(`
      UPDATE automation_whatsapp_authorizations
      SET enabled = 0,
          updated_at = ?
      WHERE user_id = ?
    `).run(now, Number(userId || 0));
    return getAuthorizationForUser(userId);
  }

  function syncAuthorizationPhoneForUser({ userId, phoneE164, whatsappNumber, label = null, enabled = false }) {
    const existing = getAuthorizationForUser(userId);
    if (!existing) return null;
    return upsertAuthorization({
      userId,
      phoneE164,
      whatsappNumber,
      enabled,
      label: label || existing.label || null,
      allowedActions: safeJsonParse(existing.allowed_actions_json, ['purchase:create', 'purchase:split'])
    });
  }

  function touchAuthorization(id) {
    db.prepare(`
      UPDATE automation_whatsapp_authorizations
      SET last_used_at = ?, updated_at = updated_at
      WHERE id = ?
    `).run(nowIso(), Number(id || 0));
  }

  function getActiveCards(userId) {
    return db.prepare(`
      SELECT id, name, close_day, due_day, brand
      FROM cards
      WHERE user_id = ? AND COALESCE(active, 1) = 1
      ORDER BY lower(name), id ASC
    `).all(Number(userId || 0));
  }

  function getActiveCardById(userId, cardId) {
    return db.prepare(`
      SELECT id, name, close_day, due_day, brand
      FROM cards
      WHERE id = ? AND user_id = ? AND COALESCE(active, 1) = 1
      LIMIT 1
    `).get(Number(cardId || 0), Number(userId || 0));
  }

  function getPurchaseCategory(userId, categoryId) {
    if (!Number(categoryId || 0)) return null;
    return db.prepare(`
      SELECT id, name, active
      FROM purchase_categories
      WHERE id = ? AND user_id = ?
      LIMIT 1
    `).get(Number(categoryId || 0), Number(userId || 0));
  }

  function isMonthClosed(userId, month, year) {
    return !!db.prepare(`
      SELECT 1
      FROM closed_months
      WHERE user_id = ? AND month = ? AND year = ?
      LIMIT 1
    `).get(Number(userId || 0), Number(month || 0), Number(year || 0));
  }

  function insertRecurringRule(payload) {
    const now = nowIso();
    const info = db.prepare(`
      INSERT INTO recurring_rules (
        user_id, card_id, description, amount_cents, purchase_category_id,
        start_txn_date, start_due_month, start_due_year,
        active_from_month, active_from_year, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(
      payload.userId,
      payload.cardId,
      payload.description,
      payload.amountCents,
      payload.purchaseCategoryId || null,
      payload.date,
      payload.startDueMonth,
      payload.startDueYear,
      payload.startDueMonth,
      payload.startDueYear,
      now,
      now
    );
    return Number(info.lastInsertRowid || 0);
  }

  function insertTransaction(payload) {
    const info = db.prepare(`
      INSERT INTO transactions (
        user_id, card_id, txn_date, description, amount_cents,
        due_month, due_year, parent_txn_id, recurring_rule_id,
        purchase_category_id, raw_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      payload.userId,
      payload.cardId,
      payload.date,
      payload.description,
      payload.amountCents,
      payload.dueMonth,
      payload.dueYear,
      payload.parentTxnId || null,
      payload.recurringRuleId || null,
      payload.purchaseCategoryId || null,
      payload.rawJson || null,
      nowIso()
    );
    return Number(info.lastInsertRowid || 0);
  }

  function insertAllocation({ userId, transactionId, personId, shareCents }) {
    db.prepare(`
      INSERT INTO allocations (user_id, transaction_id, person_id, share_cents, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(transaction_id, person_id) DO UPDATE SET
        share_cents = excluded.share_cents,
        created_at = excluded.created_at
    `).run(Number(userId || 0), Number(transactionId || 0), Number(personId || 0), Number(shareCents || 0), nowIso());
  }

  function deleteAllocationsForTransaction(userId, transactionId) {
    db.prepare('DELETE FROM allocations WHERE user_id = ? AND transaction_id = ?').run(Number(userId || 0), Number(transactionId || 0));
  }

  function getTransactionById(userId, transactionId) {
    return db.prepare(`
      SELECT t.id, t.user_id, t.import_id, t.card_id, t.txn_date, t.description, t.amount_cents,
             t.due_month, t.due_year, t.parent_txn_id, t.recurring_rule_id, t.purchase_category_id,
             c.name AS card_name,
             COALESCE(t.due_month, i.month) AS month,
             COALESCE(t.due_year, i.year) AS year
      FROM transactions t
      LEFT JOIN cards c ON c.id = t.card_id AND c.user_id = t.user_id
      LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
      WHERE t.id = ? AND t.user_id = ?
      LIMIT 1
    `).get(Number(transactionId || 0), Number(userId || 0));
  }

  function getPurchaseScopeRows(userId, transactionId) {
    const txn = getTransactionById(userId, transactionId);
    if (!txn) return [];
    const rootId = Number(txn.parent_txn_id || txn.id || 0);
    return db.prepare(`
      SELECT t.id, t.user_id, t.import_id, t.card_id, t.txn_date, t.description, t.amount_cents,
             t.due_month, t.due_year, t.parent_txn_id, t.recurring_rule_id, t.purchase_category_id,
             c.name AS card_name,
             COALESCE(t.due_month, i.month) AS month,
             COALESCE(t.due_year, i.year) AS year
      FROM transactions t
      LEFT JOIN cards c ON c.id = t.card_id AND c.user_id = t.user_id
      LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
      WHERE t.user_id = ? AND (t.id = ? OR t.parent_txn_id = ?)
      ORDER BY COALESCE(t.due_year, i.year) ASC, COALESCE(t.due_month, i.month) ASC, t.id ASC
    `).all(Number(userId || 0), rootId, rootId);
  }

  function getPeopleForUser(userId) {
    return db.prepare(`
      SELECT id, name, email, phone, active, is_owner, profile_kind, status
      FROM people
      WHERE user_id = ?
        AND COALESCE(status, CASE WHEN COALESCE(active, 1) = 0 THEN 'inactive' ELSE 'active' END) <> 'deleted'
      ORDER BY COALESCE(profile_kind, CASE WHEN COALESCE(is_owner, 0) = 1 THEN 'self' ELSE 'contact' END) = 'self' DESC,
               lower(name), id ASC
    `).all(Number(userId || 0));
  }

  function getSplitEligiblePeople(userId) {
    const self = getSelfPerson(userId);
    const friends = db.prepare(`
      SELECT
        p.id,
        p.name,
        p.email,
        p.phone,
        pal.linked_user_id,
        u.name AS linked_user_name,
        u.email AS linked_user_email,
        1 AS friendship_active,
        1 AS can_share_charge
      FROM people p
      JOIN person_app_links pal ON pal.owner_user_id = p.user_id AND pal.person_id = p.id
      JOIN users u ON u.id = pal.linked_user_id AND COALESCE(u.status, 'active') <> 'deleted'
      JOIN friendships f
        ON f.status = 'active'
       AND f.user_low_id = CASE WHEN p.user_id < pal.linked_user_id THEN p.user_id ELSE pal.linked_user_id END
       AND f.user_high_id = CASE WHEN p.user_id < pal.linked_user_id THEN pal.linked_user_id ELSE p.user_id END
      WHERE p.user_id = ?
        AND COALESCE(p.active, 1) = 1
        AND COALESCE(p.status, CASE WHEN COALESCE(p.active, 1) = 0 THEN 'inactive' ELSE 'active' END) <> 'deleted'
        AND COALESCE(p.profile_kind, CASE WHEN COALESCE(p.is_owner, 0) = 1 THEN 'self' ELSE 'contact' END) <> 'self'
        AND pal.linked_user_id <> ?
      ORDER BY lower(p.name), p.id ASC
    `).all(Number(userId || 0), Number(userId || 0));

    const options = [];
    if (self) {
      options.push({
        id: 'self',
        person_id: Number(self.id || 0),
        label: 'Apenas eu',
        name: 'Apenas eu',
        can_create_shared_debt: false,
        is_self: true
      });
    }

    friends.forEach((row) => {
      options.push({
        id: Number(row.id || 0),
        person_id: Number(row.id || 0),
        label: row.name || row.linked_user_name || 'Amizade',
        name: row.name || row.linked_user_name || 'Amizade',
        linked_user_id: Number(row.linked_user_id || 0),
        linked_user_name: row.linked_user_name || null,
        linked_user_email: row.linked_user_email || null,
        can_create_shared_debt: true,
        friendship_active: true,
        is_self: false
      });
    });

    return options;
  }

  function clearDraftSharedDebtItemsForTransactions(userId, transactionIds) {
    const ids = Array.from(new Set((transactionIds || []).map(Number).filter(Boolean)));
    if (!ids.length) return { removedCount: 0, queueIds: [] };

    const rows = db.prepare(`
      SELECT i.id, i.queue_id
      FROM shared_debt_send_queue_items i
      JOIN shared_debt_send_queues q ON q.id = i.queue_id
      WHERE q.requester_user_id = ?
        AND q.request_kind = 'card'
        AND q.status = 'draft'
        AND i.cancelled_at IS NULL
        AND i.source_transaction_id IN (${ids.map(() => '?').join(',')})
    `).all(Number(userId || 0), ...ids);

    if (!rows.length) return { removedCount: 0, queueIds: [] };
    const queueIds = Array.from(new Set(rows.map((row) => Number(row.queue_id || 0)).filter(Boolean)));
    const deleteItem = db.prepare('DELETE FROM shared_debt_send_queue_items WHERE id = ?');
    rows.forEach((row) => deleteItem.run(row.id));
    queueIds.forEach((queueId) => refreshSharedDebtQueue(queueId));
    return { removedCount: rows.length, queueIds };
  }

  function getSharedDebtEligibleAllocationRows(userId, transactionId) {
    return db.prepare(`
      SELECT
        a.id AS allocation_id,
        a.person_id,
        a.share_cents,
        p.name AS person_name,
        COALESCE(p.email, remote_u.email) AS person_email,
        remote_u.id AS receiver_user_id,
        remote_u.name AS receiver_user_name,
        remote_u.email AS receiver_user_email
      FROM allocations a
      JOIN people p ON p.id = a.person_id AND p.user_id = a.user_id AND COALESCE(p.status, CASE WHEN COALESCE(p.active, 1) = 0 THEN 'inactive' ELSE 'active' END) <> 'deleted'
      JOIN person_app_links pal ON pal.owner_user_id = p.user_id AND pal.person_id = p.id
      JOIN users remote_u ON remote_u.id = pal.linked_user_id AND COALESCE(remote_u.status, 'active') <> 'deleted'
      JOIN friendships f
        ON f.status = 'active'
       AND f.user_low_id = CASE WHEN p.user_id < pal.linked_user_id THEN p.user_id ELSE pal.linked_user_id END
       AND f.user_high_id = CASE WHEN p.user_id < pal.linked_user_id THEN pal.linked_user_id ELSE p.user_id END
      WHERE a.user_id = ?
        AND a.transaction_id = ?
        AND COALESCE(p.active, 1) = 1
        AND COALESCE(p.profile_kind, CASE WHEN COALESCE(p.is_owner, 0) = 1 THEN 'self' ELSE 'contact' END) <> 'self'
        AND remote_u.id <> ?
        AND a.share_cents > 0
      ORDER BY a.id ASC
    `).all(Number(userId || 0), Number(transactionId || 0), Number(userId || 0));
  }

  function getDraftQueue({ requesterUserId, receiverUserId, month, year }) {
    return db.prepare(`
      SELECT *
      FROM shared_debt_send_queues
      WHERE requester_user_id = ?
        AND receiver_user_id = ?
        AND source_due_month = ?
        AND source_due_year = ?
        AND request_kind = 'card'
        AND status = 'draft'
      ORDER BY id DESC
      LIMIT 1
    `).get(Number(requesterUserId || 0), Number(receiverUserId || 0), Number(month || 0), Number(year || 0));
  }

  function createDraftQueue({ requesterUserId, receiverUserId, month, year, receiverEmailSnapshot, receiverNameSnapshot }) {
    const now = nowIso();
    const info = db.prepare(`
      INSERT INTO shared_debt_send_queues (
        requester_user_id, receiver_user_id, source_due_month, source_due_year,
        request_kind, status, receiver_email_snapshot, receiver_name_snapshot,
        total_cents, item_count, last_item_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'card', 'draft', ?, ?, 0, 0, ?, ?, ?)
    `).run(
      Number(requesterUserId || 0),
      Number(receiverUserId || 0),
      Number(month || 0),
      Number(year || 0),
      receiverEmailSnapshot || null,
      receiverNameSnapshot || null,
      now,
      now,
      now
    );
    return Number(info.lastInsertRowid || 0);
  }

  function upsertDraftQueueItem(item) {
    const now = nowIso();
    db.prepare(`
      INSERT INTO shared_debt_send_queue_items (
        queue_id, requester_user_id, receiver_user_id, source_transaction_id,
        source_allocation_id, source_person_id, source_due_month, source_due_year,
        source_txn_date_snapshot, card_id, card_name_snapshot, description_snapshot,
        amount_cents, receiver_email_snapshot, receiver_name_snapshot, action_kind,
        target_request_id, baseline_status_snapshot, sent_request_id, cancelled_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'create', NULL, NULL, NULL, NULL, ?, ?)
      ON CONFLICT(queue_id, source_transaction_id, source_person_id) DO UPDATE SET
        requester_user_id = excluded.requester_user_id,
        receiver_user_id = excluded.receiver_user_id,
        source_allocation_id = excluded.source_allocation_id,
        source_due_month = excluded.source_due_month,
        source_due_year = excluded.source_due_year,
        source_txn_date_snapshot = excluded.source_txn_date_snapshot,
        card_id = excluded.card_id,
        card_name_snapshot = excluded.card_name_snapshot,
        description_snapshot = excluded.description_snapshot,
        amount_cents = excluded.amount_cents,
        receiver_email_snapshot = excluded.receiver_email_snapshot,
        receiver_name_snapshot = excluded.receiver_name_snapshot,
        action_kind = 'create',
        target_request_id = NULL,
        baseline_status_snapshot = NULL,
        sent_request_id = NULL,
        cancelled_at = NULL,
        updated_at = excluded.updated_at
    `).run(
      item.queueId,
      item.requesterUserId,
      item.receiverUserId,
      item.sourceTransactionId,
      item.sourceAllocationId || null,
      item.sourcePersonId,
      item.sourceDueMonth,
      item.sourceDueYear,
      item.sourceTxnDateSnapshot || null,
      item.cardId || null,
      item.cardNameSnapshot || null,
      item.descriptionSnapshot,
      item.amountCents,
      item.receiverEmailSnapshot || null,
      item.receiverNameSnapshot || null,
      now,
      now
    );
  }

  function refreshSharedDebtQueue(queueId) {
    const queue = db.prepare('SELECT * FROM shared_debt_send_queues WHERE id = ? LIMIT 1').get(Number(queueId || 0));
    if (!queue) return null;

    const items = db.prepare(`
      SELECT amount_cents, updated_at, created_at
      FROM shared_debt_send_queue_items
      WHERE queue_id = ? AND cancelled_at IS NULL
    `).all(Number(queueId || 0));

    if (!items.length && String(queue.status || '').toLowerCase() === 'draft') {
      db.prepare('DELETE FROM shared_debt_send_queues WHERE id = ?').run(Number(queueId || 0));
      return null;
    }

    const totalCents = items.reduce((sum, row) => sum + Math.max(0, Number(row.amount_cents || 0)), 0);
    const lastItemAt = items
      .map((row) => row.updated_at || row.created_at || null)
      .filter(Boolean)
      .sort()
      .pop() || nowIso();
    db.prepare(`
      UPDATE shared_debt_send_queues
      SET total_cents = ?, item_count = ?, last_item_at = ?, updated_at = ?
      WHERE id = ?
    `).run(totalCents, items.length, lastItemAt, nowIso(), Number(queueId || 0));
    return db.prepare('SELECT * FROM shared_debt_send_queues WHERE id = ? LIMIT 1').get(Number(queueId || 0));
  }

  function getOpenConversationByPhone(phoneE164) {
    const now = nowIso();
    return db.prepare(`
      SELECT *
      FROM automation_conversation_states
      WHERE phone_e164 = ?
        AND resolved_at IS NULL
        AND datetime(expires_at) > datetime(?)
      ORDER BY updated_at DESC, id DESC
      LIMIT 1
    `).get(String(phoneE164 || '').trim(), now);
  }

  function getOpenConversationForUser(userId, phoneE164 = '') {
    const now = nowIso();
    const params = [Number(userId || 0), now];
    let phoneWhere = '';
    if (phoneE164) {
      phoneWhere = 'AND phone_e164 = ?';
      params.push(String(phoneE164 || '').trim());
    }
    return db.prepare(`
      SELECT *
      FROM automation_conversation_states
      WHERE user_id = ?
        AND resolved_at IS NULL
        AND datetime(expires_at) > datetime(?)
        ${phoneWhere}
      ORDER BY updated_at DESC, id DESC
      LIMIT 1
    `).get(...params);
  }

  function createConversationState(payload) {
    const now = nowIso();
    const ttlMinutes = Math.max(1, Number(payload.ttlMinutes || getIntegerSetting('AUTOMATION_CONVERSATION_TTL_MINUTES', 20)) || 20);
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
    const data = safeJsonStringify(payload.payload || {}, '{}');

    db.prepare(`
      UPDATE automation_conversation_states
      SET resolved_at = ?, updated_at = ?
      WHERE user_id = ? AND phone_e164 = ? AND resolved_at IS NULL
    `).run(now, now, Number(payload.userId || 0), String(payload.phoneE164 || '').trim());

    const info = db.prepare(`
      INSERT INTO automation_conversation_states (
        user_id, phone_e164, channel, state, related_purchase_id,
        payload_json, expires_at, created_at, updated_at, resolved_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `).run(
      Number(payload.userId || 0),
      String(payload.phoneE164 || '').trim(),
      payload.channel || 'whatsapp',
      payload.state,
      Number(payload.relatedPurchaseId || 0) || null,
      data,
      expiresAt,
      now,
      now
    );

    return db.prepare('SELECT * FROM automation_conversation_states WHERE id = ? LIMIT 1').get(info.lastInsertRowid);
  }

  function updateConversationState(id, patch = {}) {
    const current = db.prepare('SELECT * FROM automation_conversation_states WHERE id = ? LIMIT 1').get(Number(id || 0));
    if (!current) return null;
    const nextState = patch.state || current.state;
    const nextPayload = Object.prototype.hasOwnProperty.call(patch, 'payload') ? safeJsonStringify(patch.payload || {}, '{}') : current.payload_json;
    const ttlMinutes = Math.max(1, Number(patch.ttlMinutes || getIntegerSetting('AUTOMATION_CONVERSATION_TTL_MINUTES', 20)) || 20);
    const expiresAt = patch.expiresAt || new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
    const now = nowIso();
    db.prepare(`
      UPDATE automation_conversation_states
      SET state = ?, payload_json = ?, related_purchase_id = COALESCE(?, related_purchase_id), expires_at = ?, updated_at = ?
      WHERE id = ?
    `).run(nextState, nextPayload, patch.relatedPurchaseId || null, expiresAt, now, Number(id || 0));
    return db.prepare('SELECT * FROM automation_conversation_states WHERE id = ? LIMIT 1').get(Number(id || 0));
  }

  function resolveConversationState(id) {
    const now = nowIso();
    db.prepare(`
      UPDATE automation_conversation_states
      SET resolved_at = ?, updated_at = ?
      WHERE id = ?
    `).run(now, now, Number(id || 0));
  }

  function getConversationPayload(row) {
    return safeJsonParse(row?.payload_json, {});
  }

  function getIdempotency(channel, idempotencyKey) {
    return db.prepare(`
      SELECT *
      FROM automation_idempotency_keys
      WHERE channel = ? AND idempotency_key = ?
      LIMIT 1
    `).get(String(channel || 'whatsapp'), String(idempotencyKey || '').trim());
  }

  function tryCreateIdempotency({ userId, channel = 'whatsapp', idempotencyKey, operation, requestHash }) {
    const key = String(idempotencyKey || '').trim();
    if (!key) return { created: false, row: null };
    const now = nowIso();
    try {
      const info = db.prepare(`
        INSERT INTO automation_idempotency_keys (
          user_id, channel, idempotency_key, operation, request_hash, response_json,
          status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, NULL, 'processing', ?, ?)
      `).run(Number(userId || 0) || null, channel, key, operation, requestHash || null, now, now);
      return { created: true, row: db.prepare('SELECT * FROM automation_idempotency_keys WHERE id = ? LIMIT 1').get(info.lastInsertRowid) };
    } catch (error) {
      const existing = getIdempotency(channel, key);
      return { created: false, row: existing || null };
    }
  }

  function finishIdempotency({ channel = 'whatsapp', idempotencyKey, response, status = 'success' }) {
    db.prepare(`
      UPDATE automation_idempotency_keys
      SET response_json = ?, status = ?, updated_at = ?
      WHERE channel = ? AND idempotency_key = ?
    `).run(safeJsonStringify(response || {}, '{}'), status, nowIso(), channel, String(idempotencyKey || '').trim());
  }

  function logRequest(payload = {}) {
    try {
      db.prepare(`
        INSERT INTO automation_request_logs (
          user_id, phone_e164, channel, operation, status_code, result_code,
          source_message_id, request_meta_json, response_meta_json, ip_address, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        Number(payload.userId || 0) || null,
        payload.phoneE164 || null,
        payload.channel || 'whatsapp',
        payload.operation || 'unknown',
        Number(payload.statusCode || 0) || null,
        payload.resultCode || null,
        payload.sourceMessageId || null,
        safeJsonStringify(payload.requestMeta || {}, '{}'),
        safeJsonStringify(payload.responseMeta || {}, '{}'),
        payload.ipAddress || null,
        nowIso()
      );
    } catch (error) {
      // logging nao pode quebrar o fluxo financeiro
    }
  }

  return {
    db,
    nowIso,
    safeJsonParse,
    safeJsonStringify,
    getAppSetting,
    getBooleanSetting,
    getIntegerSetting,
    getUserById,
    getSelfPerson,
    getAuthorizationForUser,
    getAuthorizationByPhone,
    findAuthorizationConflict,
    upsertAuthorization,
    disableAuthorizationForUser,
    syncAuthorizationPhoneForUser,
    touchAuthorization,
    getActiveCards,
    getActiveCardById,
    getPurchaseCategory,
    isMonthClosed,
    insertRecurringRule,
    insertTransaction,
    insertAllocation,
    deleteAllocationsForTransaction,
    getTransactionById,
    getPurchaseScopeRows,
    getPeopleForUser,
    getSplitEligiblePeople,
    clearDraftSharedDebtItemsForTransactions,
    getSharedDebtEligibleAllocationRows,
    getDraftQueue,
    createDraftQueue,
    upsertDraftQueueItem,
    refreshSharedDebtQueue,
    getOpenConversationByPhone,
    getOpenConversationForUser,
    createConversationState,
    updateConversationState,
    resolveConversationState,
    getConversationPayload,
    getIdempotency,
    tryCreateIdempotency,
    finishIdempotency,
    logRequest
  };
}

module.exports = {
  createAutomationApiRepository
};
