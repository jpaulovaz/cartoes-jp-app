const db = require('../db');
const { computeDueDate } = require('../dueDate');
const { createAutomationApiRepository } = require('./automationApi.repository');

function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function attachDueDate(row = {}) {
  const month = toInt(row.month || row.due_month, 0);
  const year = toInt(row.year || row.due_year, 0);
  const dueDay = toInt(row.due_day, 0);
  return {
    ...row,
    computed_due_date: row.computed_due_date || (month && year && dueDay ? computeDueDate({
      month,
      year,
      dueDay,
      holidayScope: row.holiday_scope || 'BR'
    }) : null),
    effective_due_date: row.override_due_date || row.computed_due_date || (month && year && dueDay ? computeDueDate({
      month,
      year,
      dueDay,
      holidayScope: row.holiday_scope || 'BR'
    }) : null)
  };
}

function createAutomationQueriesRepository() {
  const base = createAutomationApiRepository();

  function listCards(userId) {
    return db.prepare(`
      SELECT id, name, brand, due_day, close_day, holiday_scope, active
      FROM cards
      WHERE user_id = ?
      ORDER BY COALESCE(active, 1) DESC, lower(name), id ASC
    `).all(Number(userId || 0));
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

  function getCardMonthTotals(userId, month, year) {
    return db.prepare(`
      SELECT
        c.id AS card_id,
        c.name AS card_name,
        c.brand,
        c.due_day,
        c.close_day,
        c.holiday_scope,
        COALESCE(c.active, 1) AS active,
        ? AS month,
        ? AS year,
        COALESCE(SUM(COALESCE(t.amount_cents, 0)), 0) AS total_cents,
        COUNT(t.id) AS purchase_count,
        COALESCE(cs.paid_cents, 0) AS paid_cents,
        cs.override_due_date,
        cs.computed_due_date
      FROM cards c
      LEFT JOIN transactions t
        ON t.card_id = c.id
       AND t.user_id = c.user_id
       AND COALESCE(t.due_month, (SELECT i.month FROM imports i WHERE i.id = t.import_id AND i.user_id = t.user_id)) = ?
       AND COALESCE(t.due_year, (SELECT i.year FROM imports i WHERE i.id = t.import_id AND i.user_id = t.user_id)) = ?
      LEFT JOIN card_statements cs
        ON cs.card_id = c.id
       AND cs.user_id = c.user_id
       AND cs.month = ?
       AND cs.year = ?
      WHERE c.user_id = ?
      GROUP BY c.id
      HAVING purchase_count > 0 OR COALESCE(cs.paid_cents, 0) <> 0
      ORDER BY total_cents DESC, lower(c.name), c.id ASC
    `).all(Number(month || 0), Number(year || 0), Number(month || 0), Number(year || 0), Number(month || 0), Number(year || 0), Number(userId || 0)).map(attachDueDate);
  }

  function getPersonMonthTotals(userId, month, year) {
    return db.prepare(`
      SELECT
        p.id AS person_id,
        p.name AS person_name,
        p.email,
        p.phone,
        COALESCE(p.profile_kind, CASE WHEN COALESCE(p.is_owner, 0) = 1 THEN 'self' ELSE 'contact' END) AS profile_kind,
        COALESCE(SUM(CASE WHEN t.id IS NOT NULL THEN COALESCE(a.share_cents, 0) ELSE 0 END), 0) AS total_cents,
        COUNT(DISTINCT a.transaction_id) AS purchase_count,
        COALESCE(pp.paid_cents, 0) AS paid_cents
      FROM people p
      LEFT JOIN allocations a
        ON a.person_id = p.id
       AND a.user_id = p.user_id
      LEFT JOIN transactions t
        ON t.id = a.transaction_id
       AND t.user_id = a.user_id
       AND COALESCE(t.due_month, (SELECT i.month FROM imports i WHERE i.id = t.import_id AND i.user_id = t.user_id)) = ?
       AND COALESCE(t.due_year, (SELECT i.year FROM imports i WHERE i.id = t.import_id AND i.user_id = t.user_id)) = ?
      LEFT JOIN person_payments pp
        ON pp.person_id = p.id
       AND pp.user_id = p.user_id
       AND pp.month = ?
       AND pp.year = ?
      WHERE p.user_id = ?
        AND COALESCE(p.status, CASE WHEN COALESCE(p.active, 1) = 0 THEN 'inactive' ELSE 'active' END) <> 'deleted'
      GROUP BY p.id
      HAVING total_cents <> 0 OR COALESCE(pp.paid_cents, 0) <> 0
      ORDER BY profile_kind = 'self' DESC, total_cents DESC, lower(p.name), p.id ASC
    `).all(Number(month || 0), Number(year || 0), Number(month || 0), Number(year || 0), Number(userId || 0));
  }

  function getTopPurchasesByMonth(userId, month, year, options = {}) {
    const limit = Math.max(1, Math.min(20, toInt(options.limit, 5)));
    const cardId = toInt(options.cardId, 0);
    const params = [Number(userId || 0), Number(month || 0), Number(year || 0)];
    let cardWhere = '';
    if (cardId) {
      cardWhere = 'AND t.card_id = ?';
      params.push(cardId);
    }
    params.push(limit);
    return db.prepare(`
      SELECT
        t.id,
        t.txn_date,
        t.description,
        t.amount_cents,
        COALESCE(t.due_month, i.month) AS due_month,
        COALESCE(t.due_year, i.year) AS due_year,
        c.id AS card_id,
        c.name AS card_name
      FROM transactions t
      LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
      JOIN cards c ON c.id = t.card_id AND c.user_id = t.user_id
      WHERE t.user_id = ?
        AND COALESCE(t.due_month, i.month) = ?
        AND COALESCE(t.due_year, i.year) = ?
        ${cardWhere}
      ORDER BY ABS(t.amount_cents) DESC, COALESCE(t.txn_date, t.created_at) DESC, t.id DESC
      LIMIT ?
    `).all(...params);
  }

  function getRecentPurchases(userId, options = {}) {
    const limit = Math.max(1, Math.min(30, toInt(options.limit, 10)));
    const cardId = toInt(options.cardId, 0);
    const month = toInt(options.month, 0);
    const year = toInt(options.year, 0);
    const date = String(options.date || '').slice(0, 10);
    const params = [Number(userId || 0)];
    const where = ['t.user_id = ?'];

    if (date) {
      where.push('substr(COALESCE(t.txn_date, t.created_at), 1, 10) = ?');
      params.push(date);
    } else if (month && year) {
      where.push('COALESCE(t.due_month, i.month) = ?');
      where.push('COALESCE(t.due_year, i.year) = ?');
      params.push(month, year);
    }

    if (cardId) {
      where.push('t.card_id = ?');
      params.push(cardId);
    }

    params.push(limit);
    return db.prepare(`
      SELECT
        t.id,
        t.txn_date,
        t.description,
        t.amount_cents,
        COALESCE(t.due_month, i.month) AS due_month,
        COALESCE(t.due_year, i.year) AS due_year,
        c.id AS card_id,
        c.name AS card_name,
        t.created_at
      FROM transactions t
      LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
      JOIN cards c ON c.id = t.card_id AND c.user_id = t.user_id
      WHERE ${where.join('\n        AND ')}
      ORDER BY substr(COALESCE(t.txn_date, t.created_at), 1, 10) DESC, t.id DESC
      LIMIT ?
    `).all(...params);
  }

  function getPersonTransactions(userId, personId, month, year, limit = 10) {
    return db.prepare(`
      SELECT
        t.id,
        t.txn_date,
        t.description,
        t.amount_cents AS purchase_amount_cents,
        a.share_cents,
        COALESCE(t.due_month, i.month) AS due_month,
        COALESCE(t.due_year, i.year) AS due_year,
        c.id AS card_id,
        c.name AS card_name
      FROM allocations a
      JOIN transactions t ON t.id = a.transaction_id AND t.user_id = a.user_id
      LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
      JOIN cards c ON c.id = t.card_id AND c.user_id = t.user_id
      WHERE a.user_id = ?
        AND a.person_id = ?
        AND COALESCE(t.due_month, i.month) = ?
        AND COALESCE(t.due_year, i.year) = ?
      ORDER BY ABS(a.share_cents) DESC, COALESCE(t.txn_date, t.created_at) DESC, t.id DESC
      LIMIT ?
    `).all(Number(userId || 0), Number(personId || 0), Number(month || 0), Number(year || 0), Math.max(1, Math.min(20, toInt(limit, 10))));
  }

  function getPersonMonthSummary(userId, personId, month, year) {
    return db.prepare(`
      SELECT
        p.id AS person_id,
        p.name AS person_name,
        p.email,
        p.phone,
        COALESCE(p.profile_kind, CASE WHEN COALESCE(p.is_owner, 0) = 1 THEN 'self' ELSE 'contact' END) AS profile_kind,
        COALESCE(SUM(CASE WHEN t.id IS NOT NULL THEN COALESCE(a.share_cents, 0) ELSE 0 END), 0) AS total_cents,
        COUNT(DISTINCT a.transaction_id) AS purchase_count,
        COALESCE(pp.paid_cents, 0) AS paid_cents
      FROM people p
      LEFT JOIN allocations a ON a.person_id = p.id AND a.user_id = p.user_id
      LEFT JOIN transactions t
        ON t.id = a.transaction_id
       AND t.user_id = a.user_id
       AND COALESCE(t.due_month, (SELECT i.month FROM imports i WHERE i.id = t.import_id AND i.user_id = t.user_id)) = ?
       AND COALESCE(t.due_year, (SELECT i.year FROM imports i WHERE i.id = t.import_id AND i.user_id = t.user_id)) = ?
      LEFT JOIN person_payments pp ON pp.person_id = p.id AND pp.user_id = p.user_id AND pp.month = ? AND pp.year = ?
      WHERE p.user_id = ? AND p.id = ?
      GROUP BY p.id
      LIMIT 1
    `).get(Number(month || 0), Number(year || 0), Number(month || 0), Number(year || 0), Number(userId || 0), Number(personId || 0));
  }

  function getSharedDebtOutgoing(userId, month, year) {
    return db.prepare(`
      SELECT
        COALESCE(NULLIF(r.receiver_name_snapshot, ''), u.name, u.email, 'Contato') AS person_name,
        r.receiver_user_id AS user_id,
        r.status,
        COUNT(*) AS item_count,
        SUM(MAX(COALESCE(r.amount_cents, 0) - COALESCE(r.amount_paid_cents, 0), 0)) AS open_cents,
        SUM(COALESCE(r.amount_cents, 0)) AS total_cents
      FROM shared_debt_requests r
      LEFT JOIN users u ON u.id = r.receiver_user_id
      WHERE r.requester_user_id = ?
        AND COALESCE(r.request_kind, 'card') IN ('card', 'manual')
        AND COALESCE(r.source_due_month, CAST(strftime('%m', r.created_at) AS INTEGER)) = ?
        AND COALESCE(r.source_due_year, CAST(strftime('%Y', r.created_at) AS INTEGER)) = ?
        AND r.status IN ('pending', 'accepted', 'rejection_contested_by_sender')
        AND MAX(COALESCE(r.amount_cents, 0) - COALESCE(r.amount_paid_cents, 0), 0) > 0
      GROUP BY r.receiver_user_id, person_name, r.status
      ORDER BY open_cents DESC, lower(person_name)
    `).all(Number(userId || 0), Number(month || 0), Number(year || 0));
  }

  function getSharedDebtIncoming(userId, month, year) {
    return db.prepare(`
      SELECT
        COALESCE(u.name, u.email, 'Contato') AS person_name,
        r.requester_user_id AS user_id,
        r.status,
        COUNT(*) AS item_count,
        SUM(MAX(COALESCE(r.amount_cents, 0) - COALESCE(r.amount_paid_cents, 0), 0)) AS open_cents,
        SUM(COALESCE(r.amount_cents, 0)) AS total_cents
      FROM shared_debt_requests r
      LEFT JOIN users u ON u.id = r.requester_user_id
      WHERE r.receiver_user_id = ?
        AND COALESCE(r.request_kind, 'card') IN ('card', 'manual')
        AND COALESCE(r.source_due_month, CAST(strftime('%m', r.created_at) AS INTEGER)) = ?
        AND COALESCE(r.source_due_year, CAST(strftime('%Y', r.created_at) AS INTEGER)) = ?
        AND r.status IN ('pending', 'accepted', 'rejection_contested_by_sender')
        AND MAX(COALESCE(r.amount_cents, 0) - COALESCE(r.amount_paid_cents, 0), 0) > 0
      GROUP BY r.requester_user_id, person_name, r.status
      ORDER BY open_cents DESC, lower(person_name)
    `).all(Number(userId || 0), Number(month || 0), Number(year || 0));
  }

  function getDraftQueues(userId, month, year) {
    return db.prepare(`
      SELECT
        COALESCE(NULLIF(receiver_name_snapshot, ''), u.name, u.email, 'Contato') AS person_name,
        q.receiver_user_id AS user_id,
        q.item_count,
        q.total_cents
      FROM shared_debt_send_queues q
      LEFT JOIN users u ON u.id = q.receiver_user_id
      WHERE q.requester_user_id = ?
        AND q.source_due_month = ?
        AND q.source_due_year = ?
        AND q.status = 'draft'
        AND COALESCE(q.total_cents, 0) > 0
      ORDER BY q.total_cents DESC, lower(person_name)
    `).all(Number(userId || 0), Number(month || 0), Number(year || 0));
  }



  function getMonthlyFinancesSummary(userId, month, year) {
    const rows = db.prepare(`
      SELECT
        mf.*,
        COALESCE(item_totals.total_cents, mf.amount_cents, 0) AS resolved_amount_cents,
        COALESCE(item_totals.paid_cents, CASE WHEN COALESCE(mf.is_paid, 0) = 1 THEN COALESCE(mf.amount_cents, 0) ELSE 0 END, 0) AS resolved_paid_cents,
        COALESCE(item_totals.item_count, 0) AS item_count
      FROM monthly_finances mf
      LEFT JOIN (
        SELECT
          finance_id,
          user_id,
          SUM(COALESCE(amount_cents, 0)) AS total_cents,
          SUM(CASE WHEN COALESCE(is_paid, 0) = 1 THEN COALESCE(amount_cents, 0) ELSE 0 END) AS paid_cents,
          COUNT(*) AS item_count
        FROM monthly_finance_items
        WHERE user_id = ?
        GROUP BY finance_id, user_id
      ) item_totals ON item_totals.finance_id = mf.id AND item_totals.user_id = mf.user_id
      WHERE mf.user_id = ?
        AND mf.month = ?
        AND mf.year = ?
      ORDER BY CASE WHEN mf.type = 'income' THEN 0 ELSE 1 END,
               COALESCE(mf.day_of_month, 99), lower(COALESCE(mf.description, '')), mf.id ASC
    `).all(Number(userId || 0), Number(userId || 0), Number(month || 0), Number(year || 0));

    return rows.map((row) => {
      const amount = Number(row.resolved_amount_cents || row.amount_cents || 0);
      const paid = Number(row.resolved_paid_cents || 0);
      return {
        id: Number(row.id || 0),
        description: row.description || 'Item mensal',
        type: row.type || 'expense',
        amount_cents: amount,
        paid_cents: paid,
        open_cents: Math.max(0, amount - paid),
        amount_mode: row.amount_mode || 'fixed',
        day_of_month: row.day_of_month ? Number(row.day_of_month) : null,
        schedule_kind: row.schedule_kind || null,
        item_count: Number(row.item_count || 0),
        is_paid: Number(row.is_paid || 0) === 1 || (amount > 0 && paid >= amount)
      };
    });
  }

  function getPrivateDebtReminders(userId, month, year) {
    return db.prepare(`
      SELECT
        person_name_snapshot AS person_name,
        COUNT(*) AS item_count,
        SUM(COALESCE(amount_cents, 0)) AS open_cents
      FROM private_debt_reminders
      WHERE owner_user_id = ?
        AND status = 'open'
        AND COALESCE(is_archived, 0) = 0
        AND CAST(strftime('%m', COALESCE(promised_payment_date, created_at)) AS INTEGER) = ?
        AND CAST(strftime('%Y', COALESCE(promised_payment_date, created_at)) AS INTEGER) = ?
      GROUP BY person_name_snapshot
      ORDER BY open_cents DESC, lower(person_name_snapshot)
    `).all(Number(userId || 0), Number(month || 0), Number(year || 0));
  }

  return {
    ...base,
    listCards,
    listPeople,
    getCardMonthTotals,
    getPersonMonthTotals,
    getTopPurchasesByMonth,
    getRecentPurchases,
    getPersonTransactions,
    getPersonMonthSummary,
    getSharedDebtOutgoing,
    getSharedDebtIncoming,
    getDraftQueues,
    getPrivateDebtReminders,
    getMonthlyFinancesSummary
  };
}

module.exports = {
  createAutomationQueriesRepository
};
