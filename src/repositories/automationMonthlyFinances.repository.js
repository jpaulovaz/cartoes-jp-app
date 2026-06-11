const crypto = require('crypto');
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

function normalizePaidFlag(value) {
  if (value === true || value === 1) return 1;
  const normalized = String(value ?? '').trim().toLowerCase();
  return ['1', 'true', 'sim', 'yes', 'on', 'pago', 'paid'].includes(normalized) ? 1 : 0;
}

function createAutomationMonthlyFinancesRepository() {
  const base = createAutomationApiRepository();

  function createCarryKey() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return `mf_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }

  function getMonthLabel(month, year) {
    return `${String(Number(month || 0)).padStart(2, '0')}/${year}`;
  }

  function isMonthClosed(userId, month, year) {
    return base.isMonthClosed(userId, month, year);
  }

  function getMonthLockMessage(month, year) {
    return `O mês ${getMonthLabel(month, year)} está fechado para edição.`;
  }

  function getFinanceById(userId, financeId) {
    const row = db.prepare(`
      SELECT *
      FROM monthly_finances
      WHERE id = ? AND user_id = ?
      LIMIT 1
    `).get(Number(financeId || 0), Number(userId || 0));
    return normalizeFinanceRow(row);
  }

  function getItemsByFinanceId(userId, financeId) {
    return db.prepare(`
      SELECT *
      FROM monthly_finance_items
      WHERE finance_id = ? AND user_id = ?
      ORDER BY COALESCE(item_date, created_at) ASC, id ASC
    `).all(Number(financeId || 0), Number(userId || 0)).map((item) => ({
      ...item,
      id: Number(item.id || 0),
      finance_id: Number(item.finance_id || 0),
      user_id: Number(item.user_id || 0),
      amount_cents: Number(item.amount_cents || 0),
      is_paid: normalizePaidFlag(item.is_paid),
      paid_at: item.paid_at || null
    }));
  }

  function normalizeFinanceRow(row) {
    if (!row) return null;
    const amountMode = String(row.amount_mode || 'fixed').toLowerCase() === 'variable' ? 'variable' : 'fixed';
    return {
      ...row,
      id: Number(row.id || 0),
      user_id: Number(row.user_id || 0),
      month: Number(row.month || 0),
      year: Number(row.year || 0),
      amount_cents: Number(row.amount_cents || 0),
      amount_mode: amountMode,
      day_of_month: Number(row.day_of_month || 0) || null,
      schedule_kind: row.schedule_kind || null,
      is_paid: normalizePaidFlag(row.is_paid),
      paid_at: row.paid_at || null,
      carry_key: String(row.carry_key || '').trim() || null
    };
  }

  function serializeFinance(userId, financeId) {
    const finance = getFinanceById(userId, financeId);
    if (!finance) return null;
    const items = finance.amount_mode === 'variable' ? getItemsByFinanceId(userId, financeId) : [];
    const totalCents = finance.amount_mode === 'variable'
      ? items.reduce((sum, item) => sum + Number(item.amount_cents || 0), 0)
      : Number(finance.amount_cents || 0);
    const paidCents = finance.amount_mode === 'variable'
      ? items.filter((item) => normalizePaidFlag(item.is_paid) === 1).reduce((sum, item) => sum + Number(item.amount_cents || 0), 0)
      : (normalizePaidFlag(finance.is_paid) === 1 ? totalCents : 0);
    if (finance.amount_mode === 'variable' && Number(finance.amount_cents || 0) !== totalCents) {
      db.prepare('UPDATE monthly_finances SET amount_cents = ?, formula = ? WHERE id = ? AND user_id = ?')
        .run(totalCents, '', financeId, userId);
      finance.amount_cents = totalCents;
    }
    return {
      ...finance,
      amount_cents: totalCents,
      items,
      item_count: items.length,
      paid_cents: paidCents,
      open_cents: Math.max(0, totalCents - paidCents),
      is_fully_paid: totalCents > 0 && paidCents >= totalCents
    };
  }

  function listFinances(userId, filters = {}) {
    const where = ['user_id = ?'];
    const params = [Number(userId || 0)];
    const month = toInt(filters.month, 0);
    const year = toInt(filters.year, 0);
    const type = String(filters.type || '').trim().toLowerCase();
    const status = String(filters.status || '').trim().toLowerCase();
    const text = String(filters.text || filters.finance_hint || filters.description || '').trim().toLowerCase();

    if (month && year) {
      where.push('month = ?');
      where.push('year = ?');
      params.push(month, year);
    }
    if (type === 'income' || type === 'expense') {
      where.push('type = ?');
      params.push(type);
    }
    if (text) {
      where.push('lower(COALESCE(description, "")) LIKE ?');
      params.push(`%${text}%`);
    }

    const limit = Math.max(1, Math.min(50, toInt(filters.limit, 20)));
    params.push(limit);
    let rows = db.prepare(`
      SELECT *
      FROM monthly_finances
      WHERE ${where.join(' AND ')}
      ORDER BY year DESC, month DESC,
               CASE WHEN type = 'income' THEN 0 ELSE 1 END,
               COALESCE(day_of_month, 99) ASC,
               lower(COALESCE(description, '')), id DESC
      LIMIT ?
    `).all(...params).map(normalizeFinanceRow).filter(Boolean);

    rows = rows.map((row) => serializeFinance(userId, row.id)).filter(Boolean);
    if (status === 'paid') return rows.filter((row) => row.is_fully_paid || row.is_paid === 1);
    if (status === 'open' || status === 'unpaid') return rows.filter((row) => !row.is_fully_paid && row.open_cents > 0);
    return rows;
  }

  function insertFinance(payload = {}) {
    const amountMode = String(payload.amountMode || 'fixed') === 'variable' ? 'variable' : 'fixed';
    const now = nowIso();
    const carryKey = payload.carryKey === false ? null : (payload.carryKey || createCarryKey());
    const items = Array.isArray(payload.items) ? payload.items : [];
    const totalCents = amountMode === 'variable'
      ? items.reduce((sum, item) => sum + Number(item.amount_cents || 0), 0)
      : Number(payload.amountCents || 0);
    const isPaid = normalizePaidFlag(payload.isPaid);
    const paidAt = isPaid ? (payload.paidAt || now) : null;

    return db.transaction(() => {
      const info = db.prepare(`
        INSERT INTO monthly_finances (
          user_id, month, year, type, category_id, description, formula, amount_cents,
          amount_mode, carry_key, day_of_month, schedule_kind, is_paid, paid_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        Number(payload.userId || 0),
        Number(payload.month || 0),
        Number(payload.year || 0),
        payload.type,
        payload.categoryId || null,
        payload.description,
        payload.formula || '',
        totalCents,
        amountMode,
        carryKey,
        payload.dayOfMonth || null,
        payload.scheduleKind || null,
        amountMode === 'fixed' ? isPaid : 0,
        amountMode === 'fixed' ? paidAt : null,
        now
      );
      const financeId = Number(info.lastInsertRowid || 0);
      if (amountMode === 'variable') {
        const insertItem = db.prepare(`
          INSERT INTO monthly_finance_items (
            finance_id, user_id, item_date, item_source, amount_cents, is_paid, paid_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const item of items) {
          const itemPaid = normalizePaidFlag(item.is_paid);
          insertItem.run(
            financeId,
            Number(payload.userId || 0),
            item.item_date,
            item.item_source,
            Number(item.amount_cents || 0),
            itemPaid,
            itemPaid ? now : null,
            now,
            now
          );
        }
      }
      return serializeFinance(payload.userId, financeId);
    })();
  }

  function updateFinance(userId, financeId, patch = {}) {
    const current = getFinanceById(userId, financeId);
    if (!current) return null;
    const amountMode = patch.amountMode ? (String(patch.amountMode) === 'variable' ? 'variable' : 'fixed') : current.amount_mode;
    const description = Object.prototype.hasOwnProperty.call(patch, 'description') ? patch.description : current.description;
    const type = patch.type || current.type;
    const amountCents = Object.prototype.hasOwnProperty.call(patch, 'amountCents') ? Number(patch.amountCents || 0) : Number(current.amount_cents || 0);
    const dayOfMonth = Object.prototype.hasOwnProperty.call(patch, 'dayOfMonth') ? (patch.dayOfMonth || null) : current.day_of_month;
    const scheduleKind = Object.prototype.hasOwnProperty.call(patch, 'scheduleKind') ? (patch.scheduleKind || null) : current.schedule_kind;
    const items = Array.isArray(patch.items) ? patch.items : null;
    const now = nowIso();
    const finalTotal = amountMode === 'variable' && items ? items.reduce((sum, item) => sum + Number(item.amount_cents || 0), 0) : amountCents;

    return db.transaction(() => {
      db.prepare(`
        UPDATE monthly_finances
        SET description = ?, type = ?, amount_cents = ?, amount_mode = ?, day_of_month = ?, schedule_kind = ?, formula = ?
        WHERE id = ? AND user_id = ?
      `).run(description, type, finalTotal, amountMode, dayOfMonth, scheduleKind, patch.formula || '', Number(financeId || 0), Number(userId || 0));

      if (items) {
        db.prepare('DELETE FROM monthly_finance_items WHERE finance_id = ? AND user_id = ?').run(Number(financeId || 0), Number(userId || 0));
        const insertItem = db.prepare(`
          INSERT INTO monthly_finance_items (finance_id, user_id, item_date, item_source, amount_cents, is_paid, paid_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const item of items) {
          const itemPaid = normalizePaidFlag(item.is_paid);
          insertItem.run(Number(financeId || 0), Number(userId || 0), item.item_date, item.item_source, Number(item.amount_cents || 0), itemPaid, itemPaid ? now : null, now, now);
        }
      } else if (amountMode === 'fixed') {
        db.prepare('DELETE FROM monthly_finance_items WHERE finance_id = ? AND user_id = ?').run(Number(financeId || 0), Number(userId || 0));
      }
      return serializeFinance(userId, financeId);
    })();
  }

  function setFinancePaid(userId, financeId, paid) {
    const row = getFinanceById(userId, financeId);
    if (!row) return null;
    const now = nowIso();
    const nextPaid = paid ? 1 : 0;
    return db.transaction(() => {
      if (row.amount_mode === 'variable') {
        db.prepare(`
          UPDATE monthly_finance_items
          SET is_paid = ?, paid_at = ?, updated_at = ?
          WHERE finance_id = ? AND user_id = ?
        `).run(nextPaid, nextPaid ? now : null, now, Number(financeId || 0), Number(userId || 0));
        db.prepare('UPDATE monthly_finances SET is_paid = 0, paid_at = NULL WHERE id = ? AND user_id = ?').run(Number(financeId || 0), Number(userId || 0));
      } else {
        db.prepare('UPDATE monthly_finances SET is_paid = ?, paid_at = ? WHERE id = ? AND user_id = ?')
          .run(nextPaid, nextPaid ? now : null, Number(financeId || 0), Number(userId || 0));
      }
      return serializeFinance(userId, financeId);
    })();
  }

  function deleteFinance(userId, financeId) {
    const row = getFinanceById(userId, financeId);
    if (!row) return false;
    const deletedAt = nowIso();
    return db.transaction(() => {
      if (row.carry_key) {
        db.prepare(`
          INSERT OR IGNORE INTO monthly_finance_carry_exceptions (user_id, carry_key, month, year, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(Number(userId || 0), row.carry_key, Number(row.month || 0), Number(row.year || 0), deletedAt);
      }
      db.prepare('DELETE FROM monthly_finance_items WHERE finance_id = ? AND user_id = ?').run(Number(financeId || 0), Number(userId || 0));
      const info = db.prepare('DELETE FROM monthly_finances WHERE id = ? AND user_id = ?').run(Number(financeId || 0), Number(userId || 0));
      return Number(info.changes || 0) > 0;
    })();
  }

  function createLocalNotification(userId, title, body, href = '') {
    try {
      db.prepare(`
        INSERT INTO notifications (user_id, type, title, body, href, related_type, related_id, read_at, created_at)
        VALUES (?, 'automation_monthly_finance', ?, ?, ?, 'monthly_finance', NULL, NULL, ?)
      `).run(Number(userId || 0), title, body, href || null, nowIso());
    } catch (error) {
      // notificação nao pode derrubar a automação
    }
  }

  return {
    ...base,
    db,
    nowIso,
    safeJsonParse,
    safeJsonStringify,
    normalizePaidFlag,
    getMonthLabel,
    isMonthClosed,
    getMonthLockMessage,
    getFinanceById,
    serializeFinance,
    listFinances,
    insertFinance,
    updateFinance,
    setFinancePaid,
    deleteFinance,
    createLocalNotification
  };
}

module.exports = {
  createAutomationMonthlyFinancesRepository
};
