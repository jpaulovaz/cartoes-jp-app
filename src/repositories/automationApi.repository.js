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

function normalizeAutomationText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

  function getPurchaseCategoryByName(userId, categoryName) {
    const normalized = normalizeAutomationText(categoryName);
    if (!normalized) return null;
    return db.prepare(`
      SELECT id, name, active
      FROM purchase_categories
      WHERE user_id = ? AND normalized_name = ?
      LIMIT 1
    `).get(Number(userId || 0), normalized);
  }

  function findMerchantCategoryRuleForDescription(userId, description) {
    const normalized = normalizeAutomationText(description);
    if (!normalized) return null;
    try {
      const rows = db.prepare(`
        SELECT r.*, pc.name AS category_name, pc.active AS category_active
        FROM automation_merchant_category_rules r
        JOIN purchase_categories pc ON pc.id = r.category_id AND pc.user_id = r.user_id
        WHERE r.user_id = ?
          AND COALESCE(r.enabled, 1) = 1
          AND COALESCE(pc.active, 1) = 1
        ORDER BY length(r.normalized_pattern) DESC, datetime(r.updated_at) DESC, r.id DESC
      `).all(Number(userId || 0));
      return rows.find((row) => normalized.includes(String(row.normalized_pattern || '')) || String(row.normalized_pattern || '').includes(normalized)) || null;
    } catch (error) {
      return null;
    }
  }

  function markMerchantCategoryRuleApplied(ruleId, userId) {
    if (!Number(ruleId || 0)) return;
    try {
      db.prepare(`
        UPDATE automation_merchant_category_rules
        SET apply_count = COALESCE(apply_count, 0) + 1,
            last_applied_at = ?,
            updated_at = ?
        WHERE id = ? AND user_id = ?
      `).run(nowIso(), nowIso(), Number(ruleId || 0), Number(userId || 0));
    } catch (error) {
      // aprendizado nao deve impedir criacao de compra
    }
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
             t.raw_json, t.created_at,
             c.name AS card_name, c.close_day, c.due_day, c.brand,
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
             t.raw_json, t.created_at,
             c.name AS card_name, c.close_day, c.due_day, c.brand,
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
    const safeUserId = Number(userId || 0);
    const self = getSelfPerson(safeUserId);
    const contacts = db.prepare(`
      SELECT
        p.id,
        p.name,
        p.email,
        p.phone,
        pal.linked_user_id,
        u.name AS linked_user_name,
        u.email AS linked_user_email,
        f.id AS friendship_id,
        CASE
          WHEN pal.linked_user_id IS NOT NULL
           AND pal.linked_user_id <> p.user_id
           AND u.id IS NOT NULL
           AND f.id IS NOT NULL
          THEN 1 ELSE 0
        END AS can_share_charge
      FROM people p
      LEFT JOIN person_app_links pal
        ON pal.owner_user_id = p.user_id
       AND pal.person_id = p.id
      LEFT JOIN users u
        ON u.id = pal.linked_user_id
       AND COALESCE(u.status, 'active') <> 'deleted'
      LEFT JOIN friendships f
        ON f.status = 'active'
       AND pal.linked_user_id IS NOT NULL
       AND f.user_low_id = CASE WHEN p.user_id < pal.linked_user_id THEN p.user_id ELSE pal.linked_user_id END
       AND f.user_high_id = CASE WHEN p.user_id < pal.linked_user_id THEN pal.linked_user_id ELSE p.user_id END
      WHERE p.user_id = ?
        AND COALESCE(p.active, 1) = 1
        AND COALESCE(p.status, CASE WHEN COALESCE(p.active, 1) = 0 THEN 'inactive' ELSE 'active' END) <> 'deleted'
        AND COALESCE(p.profile_kind, CASE WHEN COALESCE(p.is_owner, 0) = 1 THEN 'self' ELSE 'contact' END) <> 'self'
      ORDER BY can_share_charge DESC, lower(p.name), p.id ASC
    `).all(safeUserId);

    const options = [];
    if (self) {
      options.push({
        id: 'self',
        person_id: Number(self.id || 0),
        label: 'Apenas eu',
        name: 'Apenas eu',
        can_create_shared_debt: false,
        can_share_charge: false,
        friendship_active: false,
        is_self: true,
        group: 'self',
        section: 'self',
        section_label: 'Apenas eu'
      });
    }

    contacts.forEach((row) => {
      const canShareCharge = Number(row.can_share_charge || 0) === 1;
      options.push({
        id: Number(row.id || 0),
        person_id: Number(row.id || 0),
        label: row.name || row.linked_user_name || 'Contato',
        name: row.name || row.linked_user_name || 'Contato',
        email: row.email || row.linked_user_email || null,
        phone: row.phone || null,
        linked_user_id: Number(row.linked_user_id || 0) || null,
        linked_user_name: row.linked_user_name || null,
        linked_user_email: row.linked_user_email || null,
        can_create_shared_debt: canShareCharge,
        can_share_charge: canShareCharge,
        friendship_active: canShareCharge,
        is_self: false,
        group: canShareCharge ? 'shared_debt' : 'local_contact',
        section: canShareCharge ? 'shared_debt' : 'local_contact',
        section_label: canShareCharge ? 'Amigos com Acerto disponível' : 'Contatos locais'
      });
    });

    return options;
  }


  function unlinkAutomationPurchaseReferences(userId, transactionIds) {
    const ids = Array.from(new Set((transactionIds || []).map(Number).filter(Boolean)));
    if (!ids.length) return { conversationCount: 0, receiptCount: 0 };
    const placeholders = ids.map(() => '?').join(',');
    let conversationCount = 0;
    let receiptCount = 0;
    try {
      conversationCount = db.prepare(`
        UPDATE automation_conversation_states
        SET related_purchase_id = NULL,
            updated_at = ?
        WHERE user_id = ?
          AND related_purchase_id IN (${placeholders})
      `).run(nowIso(), Number(userId || 0), ...ids).changes || 0;
    } catch (error) {
      // A tabela pode nao existir em bancos antigos durante migracao.
    }
    try {
      receiptCount = db.prepare(`
        UPDATE automation_receipt_image_staging
        SET purchase_id = NULL,
            updated_at = ?
        WHERE user_id = ?
          AND purchase_id IN (${placeholders})
      `).run(nowIso(), Number(userId || 0), ...ids).changes || 0;
    } catch (error) {
      // A tabela pode nao existir em bancos antigos durante migracao.
    }
    return { conversationCount, receiptCount };
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


  function getRecentPurchasesForAutomation(userId, options = {}) {
    const limit = Math.max(1, Math.min(20, Number(options.limit || 5) || 5));
    const windowHours = Math.max(1, Math.min(24 * 30, Number(options.windowHours || getIntegerSetting('AUTOMATION_PURCHASE_MUTATION_WINDOW_HOURS', 72)) || 72));
    const hoursModifier = `-${windowHours} hours`;
    const eligibleOnly = options.eligibleOnly === true || options.onlyEligible === true;
    const where = [
      't.user_id = ?',
      'COALESCE(t.parent_txn_id, 0) = 0'
    ];
    const params = [hoursModifier, Number(userId || 0)];

    if (eligibleOnly) {
      where.push(`(
        COALESCE(t.raw_json, '') LIKE '%automation_api_v1%'
        OR datetime(t.created_at) >= datetime('now', ?)
      )`);
      params.push(hoursModifier);
      where.push(`NOT EXISTS (
        SELECT 1
        FROM transactions tx
        LEFT JOIN imports ii ON ii.id = tx.import_id AND ii.user_id = tx.user_id
        JOIN closed_months cm
          ON cm.user_id = tx.user_id
         AND cm.month = COALESCE(tx.due_month, ii.month)
         AND cm.year = COALESCE(tx.due_year, ii.year)
        WHERE tx.user_id = t.user_id
          AND (tx.id = t.id OR tx.parent_txn_id = t.id)
      )`);
      where.push(`NOT EXISTS (
        SELECT 1
        FROM transactions tx
        JOIN shared_debt_requests r
          ON r.requester_user_id = tx.user_id
         AND r.source_transaction_id = tx.id
         AND COALESCE(r.request_kind, 'card') = 'card'
         AND COALESCE(r.status, 'pending') <> 'cancelled'
        WHERE tx.user_id = t.user_id
          AND (tx.id = t.id OR tx.parent_txn_id = t.id)
      )`);
    }

    params.push(limit);
    return db.prepare(`
      SELECT
        t.id,
        t.id AS purchase_id,
        t.user_id,
        t.card_id,
        c.name AS card_name,
        t.txn_date,
        t.description,
        t.amount_cents AS first_amount_cents,
        (
          SELECT COALESCE(SUM(COALESCE(tx.amount_cents, 0)), 0)
          FROM transactions tx
          WHERE tx.user_id = t.user_id
            AND (tx.id = t.id OR tx.parent_txn_id = t.id)
        ) AS amount_cents,
        (
          SELECT COUNT(1)
          FROM transactions tx
          WHERE tx.user_id = t.user_id
            AND (tx.id = t.id OR tx.parent_txn_id = t.id)
        ) AS installments,
        COALESCE(t.due_month, i.month) AS due_month,
        COALESCE(t.due_year, i.year) AS due_year,
        t.purchase_category_id,
        t.recurring_rule_id,
        t.raw_json,
        t.created_at,
        CASE WHEN COALESCE(t.raw_json, '') LIKE '%automation_api_v1%' THEN 1 ELSE 0 END AS created_by_automation,
        CASE
          WHEN COALESCE(t.raw_json, '') LIKE '%automation_api_v1%' THEN 1
          WHEN datetime(t.created_at) >= datetime('now', ?) THEN 1
          ELSE 0
        END AS is_mutation_window_open,
        (
          SELECT COUNT(1)
          FROM transactions tx
          LEFT JOIN imports ii ON ii.id = tx.import_id AND ii.user_id = tx.user_id
          JOIN closed_months cm
            ON cm.user_id = tx.user_id
           AND cm.month = COALESCE(tx.due_month, ii.month)
           AND cm.year = COALESCE(tx.due_year, ii.year)
          WHERE tx.user_id = t.user_id
            AND (tx.id = t.id OR tx.parent_txn_id = t.id)
        ) AS closed_month_count,
        (
          SELECT COUNT(1)
          FROM transactions tx
          JOIN shared_debt_requests r
            ON r.requester_user_id = tx.user_id
           AND r.source_transaction_id = tx.id
           AND COALESCE(r.request_kind, 'card') = 'card'
           AND COALESCE(r.status, 'pending') <> 'cancelled'
          WHERE tx.user_id = t.user_id
            AND (tx.id = t.id OR tx.parent_txn_id = t.id)
        ) AS protected_shared_debt_count
      FROM transactions t
      LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
      LEFT JOIN cards c ON c.id = t.card_id AND c.user_id = t.user_id
      WHERE ${where.join('\n        AND ')}
      ORDER BY datetime(t.created_at) DESC, t.id DESC
      LIMIT ?
    `).all(...params);
  }

  function getAllocationsForTransactions(userId, transactionIds = []) {
    const ids = Array.from(new Set((transactionIds || []).map(Number).filter(Boolean)));
    if (!ids.length) return [];
    return db.prepare(`
      SELECT a.id, a.user_id, a.transaction_id, a.person_id, a.share_cents, a.created_at,
             p.name AS person_name,
             COALESCE(p.profile_kind, CASE WHEN COALESCE(p.is_owner, 0) = 1 THEN 'self' ELSE 'contact' END) AS profile_kind
      FROM allocations a
      LEFT JOIN people p ON p.id = a.person_id AND p.user_id = a.user_id
      WHERE a.user_id = ?
        AND a.transaction_id IN (${ids.map(() => '?').join(', ')})
      ORDER BY a.transaction_id ASC, a.id ASC
    `).all(Number(userId || 0), ...ids);
  }

  function replaceAllocationsForTransaction(userId, transactionId, allocationRows = []) {
    const cleanRows = (Array.isArray(allocationRows) ? allocationRows : [])
      .map((row) => ({ personId: Number(row.personId || row.person_id || 0), shareCents: Number(row.shareCents ?? row.share_cents ?? 0) }))
      .filter((row) => row.personId);
    deleteAllocationsForTransaction(userId, transactionId);
    cleanRows.forEach((row) => insertAllocation({
      userId,
      transactionId,
      personId: row.personId,
      shareCents: row.shareCents
    }));
  }

  function updateTransactionForAutomation(payload = {}) {
    db.prepare(`
      UPDATE transactions
      SET card_id = ?,
          txn_date = ?,
          description = ?,
          amount_cents = ?,
          due_month = ?,
          due_year = ?,
          parent_txn_id = ?,
          recurring_rule_id = ?,
          purchase_category_id = ?,
          raw_json = COALESCE(?, raw_json)
      WHERE id = ? AND user_id = ?
    `).run(
      Number(payload.cardId || 0),
      payload.date || null,
      payload.description,
      Number(payload.amountCents || 0),
      Number(payload.dueMonth || 0) || null,
      Number(payload.dueYear || 0) || null,
      Number(payload.parentTxnId || 0) || null,
      Number(payload.recurringRuleId || 0) || null,
      Number(payload.purchaseCategoryId || 0) || null,
      payload.rawJson || null,
      Number(payload.transactionId || 0),
      Number(payload.userId || 0)
    );
  }

  function deleteTransactionsForAutomation(userId, rows = []) {
    const uniqueRows = Array.from(new Map((rows || [])
      .map((row) => ({ id: Number(row.id || 0), import_id: row.import_id ? Number(row.import_id) : null }))
      .filter((row) => row.id)
      .map((row) => [row.id, row])).values());
    if (!uniqueRows.length) return 0;

    const deleteAllocation = db.prepare('DELETE FROM allocations WHERE transaction_id = ? AND user_id = ?');
    const deleteTransaction = db.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?');
    const deleteImportIfEmpty = db.prepare(`
      DELETE FROM imports
      WHERE id = ? AND user_id = ?
        AND NOT EXISTS (
          SELECT 1 FROM transactions t
          WHERE t.import_id = imports.id AND t.user_id = imports.user_id
        )
    `);

    const importIds = new Set();
    unlinkAutomationPurchaseReferences(userId, uniqueRows.map((row) => row.id));
    uniqueRows.forEach((row) => {
      clearDraftSharedDebtItemsForTransactions(userId, [row.id]);
      db.prepare(`
        UPDATE shared_debt_requests
        SET source_transaction_id = NULL,
            source_allocation_id = NULL,
            card_id = NULL,
            updated_at = ?
        WHERE requester_user_id = ?
          AND source_transaction_id = ?
          AND status = 'cancelled'
      `).run(nowIso(), Number(userId || 0), row.id);
      deleteAllocation.run(row.id, Number(userId || 0));
      deleteTransaction.run(row.id, Number(userId || 0));
      if (row.import_id) importIds.add(row.import_id);
    });
    importIds.forEach((importId) => deleteImportIfEmpty.run(importId, Number(userId || 0)));
    return uniqueRows.length;
  }

  function insertRecurringException({ userId, ruleId, month, year }) {
    if (!Number(ruleId || 0) || !Number(month || 0) || !Number(year || 0)) return;
    db.prepare(`
      INSERT OR IGNORE INTO recurring_exceptions (user_id, rule_id, month, year, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(Number(userId || 0), Number(ruleId || 0), Number(month || 0), Number(year || 0), nowIso());
  }

  function updateRecurringRuleForAutomation({ userId, ruleId, cardId, description, amountCents, date, dueMonth, dueYear, purchaseCategoryId }) {
    if (!Number(ruleId || 0)) return;
    db.prepare(`
      UPDATE recurring_rules
      SET card_id = COALESCE(?, card_id),
          description = COALESCE(?, description),
          amount_cents = COALESCE(?, amount_cents),
          purchase_category_id = COALESCE(?, purchase_category_id),
          start_txn_date = COALESCE(?, start_txn_date),
          start_due_month = COALESCE(?, start_due_month),
          start_due_year = COALESCE(?, start_due_year),
          active_from_month = COALESCE(?, active_from_month),
          active_from_year = COALESCE(?, active_from_year),
          updated_at = ?
      WHERE id = ? AND user_id = ?
    `).run(
      Number(cardId || 0) || null,
      description || null,
      Number.isFinite(Number(amountCents)) ? Number(amountCents) : null,
      Number(purchaseCategoryId || 0) || null,
      date || null,
      Number(dueMonth || 0) || null,
      Number(dueYear || 0) || null,
      Number(dueMonth || 0) || null,
      Number(dueYear || 0) || null,
      nowIso(),
      Number(ruleId || 0),
      Number(userId || 0)
    );
  }

  function getProtectedSharedDebtRowsForTransactions(userId, transactionIds = []) {
    const ids = Array.from(new Set((transactionIds || []).map(Number).filter(Boolean)));
    if (!ids.length) return [];
    return db.prepare(`
      SELECT r.id, r.status, r.receiver_user_id, r.source_transaction_id,
             r.description_snapshot, r.amount_cents,
             COALESCE(u.name, u.email, r.receiver_name_snapshot, 'essa pessoa') AS receiver_name
      FROM shared_debt_requests r
      LEFT JOIN users u ON u.id = r.receiver_user_id
      WHERE r.requester_user_id = ?
        AND COALESCE(r.request_kind, 'card') = 'card'
        AND r.source_transaction_id IN (${ids.map(() => '?').join(', ')})
        AND COALESCE(r.status, 'pending') <> 'cancelled'
      ORDER BY r.updated_at DESC, r.id DESC
    `).all(Number(userId || 0), ...ids);
  }

  function insertAutomationMutationEvent(payload = {}) {
    try {
      db.prepare(`
        INSERT INTO automation_mutation_events (
          user_id, phone_e164, operation, entity_type, entity_id,
          before_json, after_json, source_message_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        Number(payload.userId || 0) || null,
        payload.phoneE164 || null,
        payload.operation || 'unknown',
        payload.entityType || 'transaction',
        Number(payload.entityId || 0) || null,
        safeJsonStringify(payload.before || null, 'null'),
        safeJsonStringify(payload.after || null, 'null'),
        payload.sourceMessageId || null,
        nowIso()
      );
    } catch (error) {
      // auditoria nao deve derrubar a operacao principal
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
    getPurchaseCategoryByName,
    findMerchantCategoryRuleForDescription,
    markMerchantCategoryRuleApplied,
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
    unlinkAutomationPurchaseReferences,
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
    logRequest,
    getRecentPurchasesForAutomation,
    getAllocationsForTransactions,
    replaceAllocationsForTransaction,
    updateTransactionForAutomation,
    deleteTransactionsForAutomation,
    insertRecurringException,
    updateRecurringRuleForAutomation,
    getProtectedSharedDebtRowsForTransactions,
    insertAutomationMutationEvent
  };
}

module.exports = {
  createAutomationApiRepository
};
