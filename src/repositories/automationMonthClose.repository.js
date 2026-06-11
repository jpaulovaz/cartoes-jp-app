const db = require('../db');
const { createAutomationApiRepository } = require('./automationApi.repository');
const { computeDueDate } = require('../dueDate');

function nowIso() {
  return new Date().toISOString();
}

function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function monthLabel(month, year) {
  return `${String(Number(month || 0)).padStart(2, '0')}/${year}`;
}

function createAutomationMonthCloseRepository() {
  const base = createAutomationApiRepository();

  function getMonthLabel(month, year) {
    return monthLabel(month, year);
  }

  function isMonthClosed(userId, month, year) {
    return base.isMonthClosed(userId, month, year);
  }

  function getCardReadiness(userId, month, year) {
    return db.prepare(`
      SELECT
        c.id AS card_id,
        c.name AS card_name,
        c.brand,
        c.due_day,
        c.holiday_scope,
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
        AND COALESCE(c.active, 1) = 1
      GROUP BY c.id
      HAVING total_cents > 0 OR COALESCE(cs.paid_cents, 0) > 0
      ORDER BY total_cents DESC, lower(c.name), c.id ASC
    `).all(Number(month || 0), Number(year || 0), Number(month || 0), Number(year || 0), Number(userId || 0)).map((row) => {
      const computedDueDate = row.computed_due_date || (row.due_day ? computeDueDate({
        month: Number(month || 0),
        year: Number(year || 0),
        dueDay: Number(row.due_day || 0),
        holidayScope: row.holiday_scope || 'BR'
      }) : null);
      const totalCents = Number(row.total_cents || 0);
      const paidCents = Number(row.paid_cents || 0);
      return {
        ...row,
        card_id: Number(row.card_id || 0),
        total_cents: totalCents,
        paid_cents: paidCents,
        open_cents: Math.max(0, totalCents - paidCents),
        purchase_count: Number(row.purchase_count || 0),
        due_date: row.override_due_date || computedDueDate || null
      };
    });
  }

  function getPersonReadiness(userId, month, year) {
    return db.prepare(`
      SELECT
        p.id AS person_id,
        p.name AS person_name,
        COALESCE(p.profile_kind, CASE WHEN COALESCE(p.is_owner, 0) = 1 THEN 'self' ELSE 'contact' END) AS profile_kind,
        COALESCE(SUM(COALESCE(a.share_cents, 0)), 0) AS total_cents,
        COUNT(DISTINCT t.id) AS purchase_count,
        COALESCE(pp.paid_cents, 0) AS paid_cents
      FROM allocations a
      JOIN transactions t ON t.id = a.transaction_id AND t.user_id = a.user_id
      JOIN people p ON p.id = a.person_id AND p.user_id = a.user_id
      LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
      LEFT JOIN person_payments pp ON pp.person_id = p.id AND pp.user_id = p.user_id AND pp.month = ? AND pp.year = ?
      WHERE a.user_id = ?
        AND COALESCE(t.due_month, i.month) = ?
        AND COALESCE(t.due_year, i.year) = ?
        AND COALESCE(p.status, CASE WHEN COALESCE(p.active, 1) = 0 THEN 'inactive' ELSE 'active' END) <> 'deleted'
      GROUP BY p.id
      HAVING total_cents > 0 OR COALESCE(pp.paid_cents, 0) > 0
      ORDER BY profile_kind = 'self' DESC, total_cents DESC, lower(p.name), p.id ASC
    `).all(Number(month || 0), Number(year || 0), Number(userId || 0), Number(month || 0), Number(year || 0)).map((row) => {
      const totalCents = Number(row.total_cents || 0);
      const paidCents = Number(row.paid_cents || 0);
      return {
        ...row,
        person_id: Number(row.person_id || 0),
        total_cents: totalCents,
        paid_cents: paidCents,
        open_cents: Math.max(0, totalCents - paidCents),
        purchase_count: Number(row.purchase_count || 0)
      };
    });
  }

  function getOpenMonthlyFinances(userId, month, year) {
    return db.prepare(`
      SELECT
        mf.id,
        mf.description,
        mf.type,
        mf.amount_mode,
        mf.day_of_month,
        CASE WHEN COALESCE(mf.amount_mode, 'fixed') = 'variable'
          THEN COALESCE(SUM(COALESCE(mfi.amount_cents, 0)), 0)
          ELSE COALESCE(mf.amount_cents, 0)
        END AS total_cents,
        CASE WHEN COALESCE(mf.amount_mode, 'fixed') = 'variable'
          THEN COALESCE(SUM(CASE WHEN COALESCE(mfi.is_paid, 0) = 1 THEN COALESCE(mfi.amount_cents, 0) ELSE 0 END), 0)
          ELSE CASE WHEN COALESCE(mf.is_paid, 0) = 1 THEN COALESCE(mf.amount_cents, 0) ELSE 0 END
        END AS paid_cents,
        COUNT(mfi.id) AS item_count
      FROM monthly_finances mf
      LEFT JOIN monthly_finance_items mfi ON mfi.finance_id = mf.id AND mfi.user_id = mf.user_id
      WHERE mf.user_id = ?
        AND mf.month = ?
        AND mf.year = ?
        AND mf.type = 'expense'
      GROUP BY mf.id
      HAVING total_cents > paid_cents
      ORDER BY COALESCE(mf.day_of_month, 99) ASC, lower(mf.description), mf.id ASC
    `).all(Number(userId || 0), Number(month || 0), Number(year || 0)).map((row) => ({
      ...row,
      id: Number(row.id || 0),
      total_cents: Number(row.total_cents || 0),
      paid_cents: Number(row.paid_cents || 0),
      open_cents: Math.max(0, Number(row.total_cents || 0) - Number(row.paid_cents || 0)),
      item_count: Number(row.item_count || 0)
    }));
  }

  function getDraftQueues(userId, month, year) {
    return db.prepare(`
      SELECT
        q.id,
        q.receiver_user_id,
        COALESCE(NULLIF(q.receiver_name_snapshot, ''), u.name, u.email, 'Contato') AS receiver_name,
        q.item_count,
        q.total_cents,
        q.updated_at
      FROM shared_debt_send_queues q
      LEFT JOIN users u ON u.id = q.receiver_user_id
      WHERE q.requester_user_id = ?
        AND q.source_due_month = ?
        AND q.source_due_year = ?
        AND q.status = 'draft'
        AND COALESCE(q.total_cents, 0) > 0
      ORDER BY q.total_cents DESC, lower(receiver_name), q.id ASC
    `).all(Number(userId || 0), Number(month || 0), Number(year || 0)).map((row) => ({
      ...row,
      id: Number(row.id || 0),
      item_count: Number(row.item_count || 0),
      total_cents: Number(row.total_cents || 0)
    }));
  }

  function getSharedDebtPending(userId, month, year) {
    const statuses = ['pending', 'accepted', 'rejected_by_receiver', 'rejection_contested_by_sender'];
    const outgoing = db.prepare(`
      SELECT
        r.id,
        'outgoing' AS direction,
        COALESCE(NULLIF(r.receiver_name_snapshot, ''), receiver.name, receiver.email, 'Contato') AS person_name,
        r.status,
        r.description_snapshot,
        COALESCE(r.amount_cents, 0) AS amount_cents,
        MAX(COALESCE(r.amount_cents, 0) - COALESCE(r.amount_paid_cents, 0), 0) AS open_cents
      FROM shared_debt_requests r
      LEFT JOIN users receiver ON receiver.id = r.receiver_user_id
      WHERE r.requester_user_id = ?
        AND COALESCE(r.source_due_month, CAST(strftime('%m', r.created_at) AS INTEGER)) = ?
        AND COALESCE(r.source_due_year, CAST(strftime('%Y', r.created_at) AS INTEGER)) = ?
        AND r.status IN (${statuses.map(() => '?').join(', ')})
        AND COALESCE(r.request_kind, 'card') IN ('card', 'manual')
        AND MAX(COALESCE(r.amount_cents, 0) - COALESCE(r.amount_paid_cents, 0), 0) > 0
      ORDER BY open_cents DESC, lower(person_name), r.id ASC
    `).all(Number(userId || 0), Number(month || 0), Number(year || 0), ...statuses);

    const incoming = db.prepare(`
      SELECT
        r.id,
        'incoming' AS direction,
        COALESCE(requester.name, requester.email, 'Contato') AS person_name,
        r.status,
        r.description_snapshot,
        COALESCE(r.amount_cents, 0) AS amount_cents,
        MAX(COALESCE(r.amount_cents, 0) - COALESCE(r.amount_paid_cents, 0), 0) AS open_cents
      FROM shared_debt_requests r
      LEFT JOIN users requester ON requester.id = r.requester_user_id
      WHERE r.receiver_user_id = ?
        AND COALESCE(r.source_due_month, CAST(strftime('%m', r.created_at) AS INTEGER)) = ?
        AND COALESCE(r.source_due_year, CAST(strftime('%Y', r.created_at) AS INTEGER)) = ?
        AND r.status IN (${statuses.map(() => '?').join(', ')})
        AND COALESCE(r.request_kind, 'card') IN ('card', 'manual')
        AND MAX(COALESCE(r.amount_cents, 0) - COALESCE(r.amount_paid_cents, 0), 0) > 0
      ORDER BY open_cents DESC, lower(person_name), r.id ASC
    `).all(Number(userId || 0), Number(month || 0), Number(year || 0), ...statuses);

    return outgoing.concat(incoming).map((row) => ({
      ...row,
      id: Number(row.id || 0),
      amount_cents: Number(row.amount_cents || 0),
      open_cents: Number(row.open_cents || 0)
    }));
  }

  function getPurchasesWithoutParticipants(userId, month, year) {
    return db.prepare(`
      SELECT
        t.id,
        t.description,
        t.amount_cents,
        t.txn_date,
        c.name AS card_name
      FROM transactions t
      LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
      JOIN cards c ON c.id = t.card_id AND c.user_id = t.user_id
      LEFT JOIN allocations a ON a.transaction_id = t.id AND a.user_id = t.user_id
      WHERE t.user_id = ?
        AND COALESCE(t.due_month, i.month) = ?
        AND COALESCE(t.due_year, i.year) = ?
      GROUP BY t.id
      HAVING COUNT(a.id) = 0
      ORDER BY COALESCE(t.txn_date, t.created_at) DESC, t.id DESC
      LIMIT 20
    `).all(Number(userId || 0), Number(month || 0), Number(year || 0)).map((row) => ({
      ...row,
      id: Number(row.id || 0),
      amount_cents: Number(row.amount_cents || 0)
    }));
  }

  function getUncategorizedPurchases(userId, month, year) {
    return db.prepare(`
      SELECT
        t.id,
        t.description,
        t.amount_cents,
        t.txn_date,
        c.name AS card_name
      FROM transactions t
      LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
      JOIN cards c ON c.id = t.card_id AND c.user_id = t.user_id
      WHERE t.user_id = ?
        AND COALESCE(t.due_month, i.month) = ?
        AND COALESCE(t.due_year, i.year) = ?
        AND (t.purchase_category_id IS NULL OR t.purchase_category_id = 0)
      ORDER BY ABS(t.amount_cents) DESC, COALESCE(t.txn_date, t.created_at) DESC, t.id DESC
      LIMIT 20
    `).all(Number(userId || 0), Number(month || 0), Number(year || 0)).map((row) => ({
      ...row,
      id: Number(row.id || 0),
      amount_cents: Number(row.amount_cents || 0)
    }));
  }

  function closeMonth(userId, month, year) {
    const now = nowIso();
    return db.transaction(() => {
      db.prepare(`
        INSERT OR IGNORE INTO closed_months (user_id, month, year)
        VALUES (?, ?, ?)
      `).run(Number(userId || 0), Number(month || 0), Number(year || 0));
      createLocalNotification({
        userId,
        title: 'Mês fechado pelo WhatsApp',
        body: `O período ${getMonthLabel(month, year)} foi fechado pela automação assistida.`,
        href: `/detalhamento/${year}/${month}`,
        relatedType: 'month_close',
        relatedId: null
      });
      return { month: Number(month || 0), year: Number(year || 0), closed_at: now };
    })();
  }

  function reopenMonth(userId, month, year) {
    const now = nowIso();
    return db.transaction(() => {
      db.prepare('DELETE FROM closed_months WHERE user_id = ? AND month = ? AND year = ?')
        .run(Number(userId || 0), Number(month || 0), Number(year || 0));
      createLocalNotification({
        userId,
        title: 'Mês reaberto pelo WhatsApp',
        body: `O período ${getMonthLabel(month, year)} foi reaberto pela automação assistida.`,
        href: `/detalhamento/${year}/${month}`,
        relatedType: 'month_close',
        relatedId: null
      });
      return { month: Number(month || 0), year: Number(year || 0), reopened_at: now };
    })();
  }

  function createLocalNotification({ userId, title, body, href = '', relatedType = null, relatedId = null }) {
    try {
      db.prepare(`
        INSERT INTO notifications (user_id, type, title, body, href, is_read, related_type, related_id, created_at)
        VALUES (?, 'automation_month_close', ?, ?, ?, 0, ?, ?, ?)
      `).run(Number(userId || 0), title, body || null, href || null, relatedType || null, relatedId || null, nowIso());
    } catch (error) {
      // notificação nao pode derrubar a ação principal
    }
  }

  return {
    ...base,
    db,
    nowIso,
    toInt,
    getMonthLabel,
    isMonthClosed,
    getCardReadiness,
    getPersonReadiness,
    getOpenMonthlyFinances,
    getDraftQueues,
    getSharedDebtPending,
    getPurchasesWithoutParticipants,
    getUncategorizedPurchases,
    closeMonth,
    reopenMonth,
    createLocalNotification
  };
}

module.exports = {
  createAutomationMonthCloseRepository
};
