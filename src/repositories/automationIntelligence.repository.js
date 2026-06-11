const db = require('../db');
const { createAutomationApiRepository } = require('./automationApi.repository');

function nowIso() {
  return new Date().toISOString();
}

function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
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

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function createAutomationIntelligenceRepository() {
  const base = createAutomationApiRepository();

  function listPurchaseCategories(userId, includeInactive = false) {
    return db.prepare(`
      SELECT id, name, normalized_name, kind, active, sort_order, created_at, updated_at
      FROM purchase_categories
      WHERE user_id = ?
        ${includeInactive ? '' : 'AND COALESCE(active, 1) = 1'}
      ORDER BY COALESCE(active, 1) DESC, COALESCE(sort_order, 0) ASC, lower(name), id ASC
    `).all(Number(userId || 0));
  }

  function getPurchaseCategoryById(userId, categoryId) {
    return db.prepare(`
      SELECT id, name, normalized_name, kind, active, sort_order
      FROM purchase_categories
      WHERE user_id = ? AND id = ?
      LIMIT 1
    `).get(Number(userId || 0), Number(categoryId || 0));
  }

  function getPurchaseCategoryByNormalizedName(userId, normalizedName) {
    return db.prepare(`
      SELECT id, name, normalized_name, kind, active, sort_order
      FROM purchase_categories
      WHERE user_id = ? AND normalized_name = ?
      LIMIT 1
    `).get(Number(userId || 0), String(normalizedName || '').trim());
  }

  function getOrCreatePurchaseCategory(userId, name) {
    const normalizedName = normalizeText(name);
    if (!normalizedName) return null;
    const existing = getPurchaseCategoryByNormalizedName(userId, normalizedName);
    if (existing) return existing;
    const maxSort = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS max_sort FROM purchase_categories WHERE user_id = ?').get(Number(userId || 0));
    const now = nowIso();
    const info = db.prepare(`
      INSERT INTO purchase_categories (user_id, name, normalized_name, kind, active, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, 'custom', 1, ?, ?, ?)
    `).run(Number(userId || 0), String(name || '').trim().slice(0, 60), normalizedName, Number(maxSort?.max_sort || 0) + 1, now, now);
    return getPurchaseCategoryById(userId, info.lastInsertRowid);
  }

  function listMerchantCategoryRules(userId, options = {}) {
    const limit = Math.max(1, Math.min(100, toInt(options.limit, 25)));
    return db.prepare(`
      SELECT r.*, pc.name AS category_name, pc.active AS category_active
      FROM automation_merchant_category_rules r
      LEFT JOIN purchase_categories pc ON pc.id = r.category_id AND pc.user_id = r.user_id
      WHERE r.user_id = ?
        AND COALESCE(r.enabled, 1) = 1
      ORDER BY datetime(r.updated_at) DESC, r.id DESC
      LIMIT ?
    `).all(Number(userId || 0), limit);
  }

  function findMerchantRuleForDescription(userId, description) {
    const normalized = normalizeText(description);
    if (!normalized) return null;
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
  }

  function upsertMerchantCategoryRule(payload = {}) {
    const userId = Number(payload.userId || 0);
    const pattern = normalizeText(payload.pattern || payload.normalizedPattern || payload.merchantLabel || '');
    if (!userId || !pattern) return null;
    const now = nowIso();
    const existing = db.prepare(`
      SELECT * FROM automation_merchant_category_rules
      WHERE user_id = ? AND normalized_pattern = ?
      LIMIT 1
    `).get(userId, pattern);
    if (existing) {
      db.prepare(`
        UPDATE automation_merchant_category_rules
        SET merchant_label = ?,
            category_id = ?,
            enabled = ?,
            source = ?,
            updated_at = ?
        WHERE id = ? AND user_id = ?
      `).run(
        String(payload.merchantLabel || existing.merchant_label || payload.pattern || '').slice(0, 160),
        Number(payload.categoryId || 0),
        payload.enabled === false ? 0 : 1,
        payload.source || existing.source || 'whatsapp',
        now,
        existing.id,
        userId
      );
    } else {
      db.prepare(`
        INSERT INTO automation_merchant_category_rules (
          user_id, normalized_pattern, merchant_label, category_id, enabled, source,
          apply_count, created_at, updated_at, last_applied_at
        ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, NULL)
      `).run(
        userId,
        pattern,
        String(payload.merchantLabel || payload.pattern || '').slice(0, 160),
        Number(payload.categoryId || 0),
        payload.enabled === false ? 0 : 1,
        payload.source || 'whatsapp',
        now,
        now
      );
    }

    db.prepare(`
      INSERT INTO merchant_learning_feedback (user_id, normalized_pattern, merchant_label, search_term, source_sample, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'confirmed', ?, ?)
      ON CONFLICT(user_id, normalized_pattern) DO UPDATE SET
        merchant_label = excluded.merchant_label,
        search_term = excluded.search_term,
        source_sample = excluded.source_sample,
        status = 'confirmed',
        updated_at = excluded.updated_at
    `).run(
      userId,
      pattern,
      String(payload.merchantLabel || payload.pattern || '').slice(0, 160),
      String(payload.categoryName || '').slice(0, 120),
      safeJsonStringify({ category_id: Number(payload.categoryId || 0), category_name: payload.categoryName || '', source: payload.source || 'whatsapp' }),
      now,
      now
    );

    return db.prepare(`
      SELECT r.*, pc.name AS category_name, pc.active AS category_active
      FROM automation_merchant_category_rules r
      LEFT JOIN purchase_categories pc ON pc.id = r.category_id AND pc.user_id = r.user_id
      WHERE r.user_id = ? AND r.normalized_pattern = ?
      LIMIT 1
    `).get(userId, pattern);
  }

  function markMerchantRuleApplied(ruleId, userId, count = 1) {
    if (!Number(ruleId || 0)) return;
    db.prepare(`
      UPDATE automation_merchant_category_rules
      SET apply_count = COALESCE(apply_count, 0) + ?,
          last_applied_at = ?,
          updated_at = ?
      WHERE id = ? AND user_id = ?
    `).run(Math.max(0, Number(count || 0)), nowIso(), nowIso(), Number(ruleId || 0), Number(userId || 0));
  }

  function getPurchaseScope(userId, purchaseId) {
    const root = db.prepare(`
      SELECT
        t.id, t.user_id, t.card_id, c.name AS card_name, t.txn_date, t.description, t.amount_cents,
        COALESCE(t.due_month, i.month) AS due_month,
        COALESCE(t.due_year, i.year) AS due_year,
        t.parent_txn_id, t.recurring_rule_id, t.purchase_category_id,
        pc.name AS category_name, t.created_at
      FROM transactions t
      LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
      LEFT JOIN cards c ON c.id = t.card_id AND c.user_id = t.user_id
      LEFT JOIN purchase_categories pc ON pc.id = t.purchase_category_id AND pc.user_id = t.user_id
      WHERE t.user_id = ? AND t.id = ?
      LIMIT 1
    `).get(Number(userId || 0), Number(purchaseId || 0));
    if (!root) return [];
    const rootId = Number(root.parent_txn_id || 0) || Number(root.id || 0);
    return db.prepare(`
      SELECT
        t.id, t.user_id, t.card_id, c.name AS card_name, t.txn_date, t.description, t.amount_cents,
        COALESCE(t.due_month, i.month) AS due_month,
        COALESCE(t.due_year, i.year) AS due_year,
        t.parent_txn_id, t.recurring_rule_id, t.purchase_category_id,
        pc.name AS category_name, t.created_at
      FROM transactions t
      LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
      LEFT JOIN cards c ON c.id = t.card_id AND c.user_id = t.user_id
      LEFT JOIN purchase_categories pc ON pc.id = t.purchase_category_id AND pc.user_id = t.user_id
      WHERE t.user_id = ?
        AND (t.id = ? OR t.parent_txn_id = ?)
      ORDER BY CASE WHEN t.id = ? THEN 0 ELSE 1 END, t.id ASC
    `).all(Number(userId || 0), rootId, rootId, rootId);
  }

  function findRecentPurchases(userId, options = {}) {
    const limit = Math.max(1, Math.min(30, toInt(options.limit, 10)));
    const params = [Number(userId || 0)];
    const where = ['t.user_id = ?', 'COALESCE(t.parent_txn_id, 0) = 0'];
    const hint = normalizeText(options.text || options.description || options.purchaseHint || '');
    if (hint) {
      where.push('lower(t.description) LIKE ?');
      params.push(`%${hint.split(' ').join('%')}%`);
    }
    if (Number(options.cardId || 0)) {
      where.push('t.card_id = ?');
      params.push(Number(options.cardId || 0));
    }
    if (Number(options.month || 0) && Number(options.year || 0)) {
      where.push('COALESCE(t.due_month, i.month) = ?');
      where.push('COALESCE(t.due_year, i.year) = ?');
      params.push(Number(options.month || 0), Number(options.year || 0));
    }
    params.push(limit);
    return db.prepare(`
      SELECT
        t.id, t.user_id, t.card_id, c.name AS card_name, t.txn_date, t.description,
        (
          SELECT COALESCE(SUM(COALESCE(tx.amount_cents, 0)), 0)
          FROM transactions tx
          WHERE tx.user_id = t.user_id AND (tx.id = t.id OR tx.parent_txn_id = t.id)
        ) AS amount_cents,
        (
          SELECT COUNT(1)
          FROM transactions tx
          WHERE tx.user_id = t.user_id AND (tx.id = t.id OR tx.parent_txn_id = t.id)
        ) AS installments,
        COALESCE(t.due_month, i.month) AS due_month,
        COALESCE(t.due_year, i.year) AS due_year,
        t.purchase_category_id,
        pc.name AS category_name,
        t.created_at
      FROM transactions t
      LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
      LEFT JOIN cards c ON c.id = t.card_id AND c.user_id = t.user_id
      LEFT JOIN purchase_categories pc ON pc.id = t.purchase_category_id AND pc.user_id = t.user_id
      WHERE ${where.join('\n        AND ')}
      ORDER BY datetime(t.created_at) DESC, t.id DESC
      LIMIT ?
    `).all(...params);
  }

  function listUncategorizedPurchases(userId, options = {}) {
    const limit = Math.max(1, Math.min(50, toInt(options.limit, 10)));
    const params = [Number(userId || 0)];
    const where = ['t.user_id = ?', 'COALESCE(t.parent_txn_id, 0) = 0', '(t.purchase_category_id IS NULL OR t.purchase_category_id = 0)'];
    if (Number(options.month || 0) && Number(options.year || 0)) {
      where.push('COALESCE(t.due_month, i.month) = ?');
      where.push('COALESCE(t.due_year, i.year) = ?');
      params.push(Number(options.month || 0), Number(options.year || 0));
    }
    params.push(limit);
    return db.prepare(`
      SELECT
        t.id, t.description, t.txn_date, t.card_id, c.name AS card_name,
        COALESCE(t.due_month, i.month) AS due_month,
        COALESCE(t.due_year, i.year) AS due_year,
        (
          SELECT COALESCE(SUM(COALESCE(tx.amount_cents, 0)), 0)
          FROM transactions tx
          WHERE tx.user_id = t.user_id AND (tx.id = t.id OR tx.parent_txn_id = t.id)
        ) AS amount_cents,
        (
          SELECT COUNT(1)
          FROM transactions tx
          WHERE tx.user_id = t.user_id AND (tx.id = t.id OR tx.parent_txn_id = t.id)
        ) AS installments,
        t.created_at
      FROM transactions t
      LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
      LEFT JOIN cards c ON c.id = t.card_id AND c.user_id = t.user_id
      WHERE ${where.join('\n        AND ')}
      ORDER BY datetime(t.created_at) DESC, t.id DESC
      LIMIT ?
    `).all(...params);
  }

  function updatePurchaseCategory(userId, transactionIds = [], categoryId) {
    const ids = Array.from(new Set((transactionIds || []).map(Number).filter(Boolean)));
    if (!ids.length) return 0;
    const update = db.prepare('UPDATE transactions SET purchase_category_id = ? WHERE user_id = ? AND id = ?');
    let count = 0;
    const tx = db.transaction(() => {
      ids.forEach((id) => {
        const result = update.run(Number(categoryId || 0), Number(userId || 0), id);
        count += Number(result.changes || 0);
      });
    });
    tx();
    return count;
  }

  function applyMerchantRuleToExisting(userId, ruleId, options = {}) {
    const rule = db.prepare(`
      SELECT r.*, pc.name AS category_name
      FROM automation_merchant_category_rules r
      JOIN purchase_categories pc ON pc.id = r.category_id AND pc.user_id = r.user_id
      WHERE r.user_id = ? AND r.id = ? AND COALESCE(r.enabled, 1) = 1
      LIMIT 1
    `).get(Number(userId || 0), Number(ruleId || 0));
    if (!rule) return { count: 0, rule: null };
    const normalized = String(rule.normalized_pattern || '');
    const limit = Math.max(1, Math.min(500, toInt(options.limit, 200)));
    const rows = db.prepare(`
      SELECT id, description
      FROM transactions
      WHERE user_id = ?
        AND (purchase_category_id IS NULL OR purchase_category_id = 0)
      ORDER BY datetime(created_at) DESC, id DESC
      LIMIT ?
    `).all(Number(userId || 0), limit);
    const matchingIds = rows
      .filter((row) => normalizeText(row.description).includes(normalized))
      .map((row) => Number(row.id || 0))
      .filter(Boolean);
    const count = updatePurchaseCategory(userId, matchingIds, rule.category_id);
    if (count) markMerchantRuleApplied(rule.id, userId, count);
    return { count, rule };
  }

  function getCategorySpending(userId, month, year, options = {}) {
    const limit = Math.max(1, Math.min(20, toInt(options.limit, 10)));
    return db.prepare(`
      SELECT
        COALESCE(pc.id, 0) AS category_id,
        COALESCE(pc.name, 'Sem categoria') AS category_name,
        COUNT(t.id) AS purchase_count,
        COALESCE(SUM(COALESCE(t.amount_cents, 0)), 0) AS total_cents
      FROM transactions t
      LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
      LEFT JOIN purchase_categories pc ON pc.id = t.purchase_category_id AND pc.user_id = t.user_id
      WHERE t.user_id = ?
        AND COALESCE(t.due_month, i.month) = ?
        AND COALESCE(t.due_year, i.year) = ?
      GROUP BY COALESCE(pc.id, 0), COALESCE(pc.name, 'Sem categoria')
      ORDER BY total_cents DESC, purchase_count DESC, category_name ASC
      LIMIT ?
    `).all(Number(userId || 0), Number(month || 0), Number(year || 0), limit);
  }

  function getMerchantSpending(userId, month, year, options = {}) {
    const limit = Math.max(1, Math.min(20, toInt(options.limit, 8)));
    return db.prepare(`
      SELECT
        lower(trim(t.description)) AS merchant_key,
        t.description AS merchant_label,
        COUNT(t.id) AS purchase_count,
        COALESCE(SUM(COALESCE(t.amount_cents, 0)), 0) AS total_cents
      FROM transactions t
      LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
      WHERE t.user_id = ?
        AND COALESCE(t.due_month, i.month) = ?
        AND COALESCE(t.due_year, i.year) = ?
      GROUP BY lower(trim(t.description))
      ORDER BY total_cents DESC, purchase_count DESC, merchant_label ASC
      LIMIT ?
    `).all(Number(userId || 0), Number(month || 0), Number(year || 0), limit);
  }

  function getCardSpending(userId, month, year) {
    return db.prepare(`
      SELECT c.id AS card_id, c.name AS card_name, COUNT(t.id) AS purchase_count,
             COALESCE(SUM(COALESCE(t.amount_cents, 0)), 0) AS total_cents
      FROM transactions t
      LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
      JOIN cards c ON c.id = t.card_id AND c.user_id = t.user_id
      WHERE t.user_id = ?
        AND COALESCE(t.due_month, i.month) = ?
        AND COALESCE(t.due_year, i.year) = ?
      GROUP BY c.id, c.name
      ORDER BY total_cents DESC, lower(c.name)
    `).all(Number(userId || 0), Number(month || 0), Number(year || 0));
  }

  function getTotalsByMonth(userId, month, year) {
    return db.prepare(`
      SELECT COUNT(t.id) AS purchase_count,
             COALESCE(SUM(COALESCE(t.amount_cents, 0)), 0) AS total_cents,
             COALESCE(SUM(CASE WHEN t.purchase_category_id IS NULL OR t.purchase_category_id = 0 THEN 1 ELSE 0 END), 0) AS uncategorized_count
      FROM transactions t
      LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
      WHERE t.user_id = ?
        AND COALESCE(t.due_month, i.month) = ?
        AND COALESCE(t.due_year, i.year) = ?
    `).get(Number(userId || 0), Number(month || 0), Number(year || 0));
  }

  function getWeeklyTransactions(userId, startDate, endDate, options = {}) {
    const limit = Math.max(1, Math.min(50, toInt(options.limit, 20)));
    return db.prepare(`
      SELECT t.id, t.txn_date, t.description, t.amount_cents, c.name AS card_name, pc.name AS category_name
      FROM transactions t
      JOIN cards c ON c.id = t.card_id AND c.user_id = t.user_id
      LEFT JOIN purchase_categories pc ON pc.id = t.purchase_category_id AND pc.user_id = t.user_id
      WHERE t.user_id = ?
        AND substr(COALESCE(t.txn_date, t.created_at), 1, 10) >= ?
        AND substr(COALESCE(t.txn_date, t.created_at), 1, 10) <= ?
      ORDER BY substr(COALESCE(t.txn_date, t.created_at), 1, 10) DESC, t.id DESC
      LIMIT ?
    `).all(Number(userId || 0), startDate, endDate, limit);
  }

  function getWeeklyTotals(userId, startDate, endDate) {
    return db.prepare(`
      SELECT COUNT(t.id) AS purchase_count,
             COALESCE(SUM(COALESCE(t.amount_cents, 0)), 0) AS total_cents,
             COALESCE(SUM(CASE WHEN t.purchase_category_id IS NULL OR t.purchase_category_id = 0 THEN 1 ELSE 0 END), 0) AS uncategorized_count
      FROM transactions t
      WHERE t.user_id = ?
        AND substr(COALESCE(t.txn_date, t.created_at), 1, 10) >= ?
        AND substr(COALESCE(t.txn_date, t.created_at), 1, 10) <= ?
    `).get(Number(userId || 0), startDate, endDate);
  }

  function upsertSummaryPreference(payload = {}) {
    const now = nowIso();
    const summaryKind = String(payload.summaryKind || 'weekly').trim().toLowerCase();
    db.prepare(`
      INSERT INTO automation_smart_summary_preferences (
        user_id, phone_e164, whatsapp_number, summary_kind, enabled, schedule_day,
        schedule_hour, timezone, last_sent_period, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
      ON CONFLICT(user_id, summary_kind) DO UPDATE SET
        phone_e164 = excluded.phone_e164,
        whatsapp_number = excluded.whatsapp_number,
        enabled = excluded.enabled,
        schedule_day = excluded.schedule_day,
        schedule_hour = excluded.schedule_hour,
        timezone = excluded.timezone,
        updated_at = excluded.updated_at
    `).run(
      Number(payload.userId || 0),
      payload.phoneE164 || null,
      payload.whatsappNumber || null,
      summaryKind,
      payload.enabled === false ? 0 : 1,
      Number(payload.scheduleDay || 1),
      Number(payload.scheduleHour || 9),
      payload.timezone || 'America/Sao_Paulo',
      now,
      now
    );
    return getSummaryPreference(payload.userId, summaryKind);
  }

  function getSummaryPreference(userId, summaryKind) {
    return db.prepare(`
      SELECT *
      FROM automation_smart_summary_preferences
      WHERE user_id = ? AND summary_kind = ?
      LIMIT 1
    `).get(Number(userId || 0), String(summaryKind || 'weekly').trim().toLowerCase());
  }

  function listDueSummaryPreferences(options = {}) {
    const kind = String(options.summaryKind || '').trim().toLowerCase();
    const limit = Math.max(1, Math.min(200, toInt(options.limit, 50)));
    const where = ['p.enabled = 1', 'a.enabled = 1'];
    const params = [];
    if (kind) {
      where.push('p.summary_kind = ?');
      params.push(kind);
    }
    params.push(limit);
    return db.prepare(`
      SELECT p.*, a.whatsapp_number AS authorized_whatsapp_number, a.phone_e164 AS authorized_phone_e164,
             u.name AS user_name, u.email AS user_email
      FROM automation_smart_summary_preferences p
      JOIN automation_whatsapp_authorizations a ON a.user_id = p.user_id AND a.enabled = 1
      JOIN users u ON u.id = p.user_id AND COALESCE(u.status, 'active') <> 'deleted'
      WHERE ${where.join(' AND ')}
      ORDER BY p.updated_at ASC, p.id ASC
      LIMIT ?
    `).all(...params);
  }

  function markSummarySent(preferenceId, periodKey) {
    db.prepare(`
      UPDATE automation_smart_summary_preferences
      SET last_sent_period = ?, last_sent_at = ?, updated_at = ?
      WHERE id = ?
    `).run(String(periodKey || ''), nowIso(), nowIso(), Number(preferenceId || 0));
  }

  function createLocalNotification(userId, title, body, href = '/geral', relatedId = null) {
    try {
      db.prepare(`
        INSERT INTO notifications (user_id, type, title, body, href, is_read, related_type, related_id, created_at)
        VALUES (?, 'automation_intelligence', ?, ?, ?, 0, 'automation_intelligence', ?, ?)
      `).run(Number(userId || 0), title, body || null, href || '/geral', relatedId || null, nowIso());
    } catch (error) {
      // notificação local não deve derrubar automação
    }
  }

  return {
    ...base,
    db,
    nowIso,
    safeJsonParse,
    safeJsonStringify,
    normalizeText,
    listPurchaseCategories,
    getPurchaseCategoryById,
    getPurchaseCategoryByNormalizedName,
    getOrCreatePurchaseCategory,
    listMerchantCategoryRules,
    findMerchantRuleForDescription,
    upsertMerchantCategoryRule,
    markMerchantRuleApplied,
    getPurchaseScope,
    findRecentPurchases,
    listUncategorizedPurchases,
    updatePurchaseCategory,
    applyMerchantRuleToExisting,
    getCategorySpending,
    getMerchantSpending,
    getCardSpending,
    getTotalsByMonth,
    getWeeklyTransactions,
    getWeeklyTotals,
    upsertSummaryPreference,
    getSummaryPreference,
    listDueSummaryPreferences,
    markSummarySent,
    createLocalNotification
  };
}

module.exports = {
  createAutomationIntelligenceRepository,
  normalizeText
};
