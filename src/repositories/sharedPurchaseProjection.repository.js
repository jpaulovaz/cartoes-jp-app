function createSharedPurchaseProjectionRepository(deps = {}) {
  const { db } = deps;

  if (!db || typeof db.prepare !== 'function') {
    throw new Error('sharedPurchaseProjection.repository precisa de uma conexao db valida.');
  }

  function getAcceptedProjectionRows(userId, month, year) {
    const safeUserId = Number(userId || 0);
    const safeMonth = Number(month || 0);
    const safeYear = Number(year || 0);
    if (!safeUserId || !safeMonth || !safeYear) return [];

    return db.prepare(`
      SELECT
        r.id AS request_id,
        r.requester_user_id,
        r.receiver_user_id,
        r.source_transaction_id,
        r.source_allocation_id,
        r.source_person_id,
        r.source_due_month,
        r.source_due_year,
        r.source_txn_date_snapshot,
        COALESCE(r.source_due_month, i.month, t.due_month) AS projection_month,
        COALESCE(r.source_due_year, i.year, t.due_year) AS projection_year,
        COALESCE(r.source_txn_date_snapshot, t.txn_date, r.created_at) AS display_date,
        r.description_snapshot,
        COALESCE(NULLIF(r.card_name_snapshot, ''), c.name, 'Cartao compartilhado') AS card_name_snapshot,
        r.amount_cents,
        r.amount_paid_cents,
        r.status,
        r.payment_marked_at,
        r.payment_note,
        r.request_note,
        r.created_at,
        r.updated_at,
        r.responded_at,
        r.resolved_at,
        requester.name AS requester_name,
        requester.email AS requester_email,
        receiver.name AS receiver_name,
        receiver.email AS receiver_email,
        pc.name AS category_name,
        t.txn_date AS source_txn_date,
        t.description AS source_description,
        t.amount_cents AS source_amount_cents,
        c.name AS source_card_name
      FROM shared_debt_requests r
      LEFT JOIN transactions t
        ON t.id = r.source_transaction_id
       AND t.user_id = r.requester_user_id
      LEFT JOIN imports i
        ON i.id = t.import_id
       AND i.user_id = t.user_id
      LEFT JOIN cards c
        ON c.id = COALESCE(r.card_id, t.card_id)
       AND c.user_id = r.requester_user_id
      LEFT JOIN users requester
        ON requester.id = r.requester_user_id
      LEFT JOIN users receiver
        ON receiver.id = r.receiver_user_id
      LEFT JOIN purchase_categories pc
        ON pc.id = t.purchase_category_id
       AND pc.user_id = t.user_id
      WHERE r.receiver_user_id = ?
        AND COALESCE(r.request_kind, 'card') = 'card'
        AND r.status IN ('accepted', 'settled')
        AND r.amount_cents > 0
        AND COALESCE(r.source_due_month, i.month, t.due_month) = ?
        AND COALESCE(r.source_due_year, i.year, t.due_year) = ?
      ORDER BY COALESCE(r.source_txn_date_snapshot, t.txn_date, r.created_at) ASC, r.id ASC
    `).all(safeUserId, safeMonth, safeYear);
  }


  function getAcceptedProjectionPeriods(userId) {
    const safeUserId = Number(userId || 0);
    if (!safeUserId) return [];

    return db.prepare(`
      SELECT
        COALESCE(r.source_due_month, i.month, t.due_month) AS month,
        COALESCE(r.source_due_year, i.year, t.due_year) AS year,
        COUNT(*) AS count,
        SUM(CASE WHEN r.amount_cents > 0 THEN r.amount_cents ELSE 0 END) AS total_cents
      FROM shared_debt_requests r
      LEFT JOIN transactions t
        ON t.id = r.source_transaction_id
       AND t.user_id = r.requester_user_id
      LEFT JOIN imports i
        ON i.id = t.import_id
       AND i.user_id = t.user_id
      WHERE r.receiver_user_id = ?
        AND COALESCE(r.request_kind, 'card') = 'card'
        AND r.status IN ('accepted', 'settled')
        AND r.amount_cents > 0
        AND COALESCE(r.source_due_month, i.month, t.due_month) IS NOT NULL
        AND COALESCE(r.source_due_year, i.year, t.due_year) IS NOT NULL
      GROUP BY
        COALESCE(r.source_due_year, i.year, t.due_year),
        COALESCE(r.source_due_month, i.month, t.due_month)
      ORDER BY year DESC, month DESC
    `).all(safeUserId);
  }

  function getReportedPaymentIntentRows(userId, month, year) {
    const safeUserId = Number(userId || 0);
    const safeMonth = Number(month || 0);
    const safeYear = Number(year || 0);
    if (!safeUserId || !safeMonth || !safeYear) return [];

    return db.prepare(`
      SELECT
        id,
        settlement_id,
        requester_user_id,
        receiver_user_id,
        month,
        year,
        amount_cents,
        status,
        reported_at,
        updated_at,
        created_at
      FROM shared_debt_payment_intents
      WHERE receiver_user_id = ?
        AND month = ?
        AND year = ?
        AND COALESCE(request_kind, 'card') = 'card'
        AND status = 'reported'
        AND amount_cents > 0
      ORDER BY COALESCE(reported_at, updated_at, created_at) ASC, id ASC
    `).all(safeUserId, safeMonth, safeYear);
  }

  return {
    getAcceptedProjectionRows,
    getAcceptedProjectionPeriods,
    getReportedPaymentIntentRows
  };
}

module.exports = {
  createSharedPurchaseProjectionRepository
};
