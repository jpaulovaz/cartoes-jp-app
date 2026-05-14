function createSharedDebtsRepository(deps = {}) {
  const { db } = deps;

  function withTransaction(fn) {
    return db.transaction(fn)();
  }

  function getSharedDebtRequestForParticipant(requestId, userId) {
    return db.prepare(`
      SELECT id, status
      FROM shared_debt_requests
      WHERE id = ? AND (requester_user_id = ? OR receiver_user_id = ?)
      LIMIT 1
    `).get(requestId, userId, userId);
  }

  function getArchivableSharedDebtRequestsForParticipant(requestIds, userId) {
    const placeholders = requestIds.map(() => '?').join(', ');
    return db.prepare(`
      SELECT id, status
      FROM shared_debt_requests
      WHERE id IN (${placeholders})
        AND (requester_user_id = ? OR receiver_user_id = ?)
    `).all(...requestIds, userId, userId);
  }

  function getArchivedSharedDebtRequestsForParticipant(requestIds, userId) {
    const placeholders = requestIds.map(() => '?').join(', ');
    return db.prepare(`
      SELECT r.id, r.status
      FROM shared_debt_requests r
      JOIN shared_debt_archives a ON a.request_id = r.id AND a.user_id = ? AND a.is_archived = 1
      WHERE r.id IN (${placeholders})
        AND (r.requester_user_id = ? OR r.receiver_user_id = ?)
    `).all(userId, ...requestIds, userId, userId);
  }

  function getPrivateReminderForOwner(userId, reminderId, options = {}) {
    return deps.getPrivateDebtReminderRowForOwner(userId, reminderId, options);
  }

  function updatePrivateReminderArchiveState({ reminderId, userId, isArchived, now }) {
    if (isArchived) {
      return db.prepare(`
        UPDATE private_debt_reminders
        SET is_archived = 1,
            archived_at = ?,
            restored_at = NULL,
            updated_at = ?
        WHERE id = ? AND owner_user_id = ?
      `).run(now, now, reminderId, userId);
    }

    return db.prepare(`
      UPDATE private_debt_reminders
      SET is_archived = 0,
          restored_at = ?,
          updated_at = ?
      WHERE id = ? AND owner_user_id = ?
    `).run(now, now, reminderId, userId);
  }

  function settlePrivateReminder({ reminderId, userId, status, note, paymentDate, now, expectedStatus }) {
    return db.prepare(`
      UPDATE private_debt_reminders
      SET status = ?,
          settlement_note = ?,
          payment_date = ?,
          settled_at = ?,
          updated_at = ?
      WHERE id = ?
        AND owner_user_id = ?
        AND status = ?
        AND COALESCE(is_archived, 0) = 0
    `).run(status, note, paymentDate, now, now, reminderId, userId, expectedStatus);
  }

  function createManualSharedDebtRequest(payload = {}) {
    return db.prepare(`
      INSERT INTO shared_debt_requests (
        requester_user_id, requester_person_id, receiver_user_id, source_person_id,
        source_transaction_id, source_allocation_id, source_due_month, source_due_year, source_txn_date_snapshot,
        card_id, card_name_snapshot, description_snapshot, amount_cents,
        receiver_email_snapshot, receiver_name_snapshot, request_note, promised_payment_date, response_note,
        status, batch_id, request_kind, created_at, updated_at
      ) VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, NULL, 'pending', ?, 'manual', ?, ?)
    `).run(
      payload.requesterUserId,
      payload.requesterPersonId,
      payload.receiverUserId,
      payload.sourcePersonId,
      payload.sourceTxnDateSnapshot,
      payload.descriptionSnapshot,
      payload.amountCents,
      payload.receiverEmailSnapshot,
      payload.receiverNameSnapshot,
      payload.requestNote,
      payload.promisedPaymentDate,
      payload.batchId,
      payload.createdAt,
      payload.updatedAt
    );
  }

  function getBatchForReceiver(batchId, userId) {
    return db.prepare(`
      SELECT b.*, u.name AS requester_name, u.email AS requester_email
      FROM shared_debt_batches b
      JOIN users u ON u.id = b.requester_user_id
      WHERE b.id = ? AND b.receiver_user_id = ?
      LIMIT 1
    `).get(batchId, userId);
  }

  function getPendingBatchItems(batchId, userId) {
    return db.prepare(`
      SELECT id, amount_cents, description_snapshot
      FROM shared_debt_requests
      WHERE batch_id = ?
        AND receiver_user_id = ?
        AND status = 'pending'
      ORDER BY created_at ASC, id ASC
    `).all(batchId, userId);
  }

  function getPendingRequestsForReceiver(requestIds, userId) {
    const cleanIds = Array.from(new Set((Array.isArray(requestIds) ? requestIds : [])
      .map((value) => Number(value || 0))
      .filter(Boolean)));
    const safeUserId = Number(userId || 0);
    if (!cleanIds.length || !safeUserId) return [];

    const placeholders = cleanIds.map(() => '?').join(', ');
    return db.prepare(`
      SELECT
        r.*,
        u.name AS requester_name,
        u.email AS requester_email
      FROM shared_debt_requests r
      JOIN users u ON u.id = r.requester_user_id
      WHERE r.id IN (${placeholders})
        AND r.receiver_user_id = ?
        AND r.status = 'pending'
      ORDER BY
        r.requester_user_id ASC,
        COALESCE(r.source_due_year, 0) ASC,
        COALESCE(r.source_due_month, 0) ASC,
        COALESCE(r.source_txn_date_snapshot, r.created_at) ASC,
        r.id ASC
    `).all(...cleanIds, safeUserId);
  }

  function getRequestForReceiver(requestId, userId) {
    return db.prepare(`
      SELECT r.*, u.name AS requester_name, u.email AS requester_email
      FROM shared_debt_requests r
      JOIN users u ON u.id = r.requester_user_id
      WHERE r.id = ? AND r.receiver_user_id = ?
      LIMIT 1
    `).get(requestId, userId);
  }

  function getRequestForRequester(requestId, userId) {
    return db.prepare(`
      SELECT r.*, u.name AS receiver_name, u.email AS receiver_email
      FROM shared_debt_requests r
      JOIN users u ON u.id = r.receiver_user_id
      WHERE r.id = ? AND r.requester_user_id = ?
      LIMIT 1
    `).get(requestId, userId);
  }

  function getMonthlySettlementIntentForReceiver(intentId, settlementId, userId) {
    return db.prepare(`
      SELECT *
      FROM shared_debt_payment_intents
      WHERE id = ?
        AND settlement_id = ?
        AND receiver_user_id = ?
        AND request_kind = 'card'
      LIMIT 1
    `).get(intentId, settlementId, userId);
  }

  function getMonthlySettlementIntentForRequester(intentId, settlementId, userId) {
    return db.prepare(`
      SELECT *
      FROM shared_debt_payment_intents
      WHERE id = ?
        AND settlement_id = ?
        AND requester_user_id = ?
        AND request_kind = 'card'
      LIMIT 1
    `).get(intentId, settlementId, userId);
  }

  function getManualSharedDebtRequestForParticipant(requestId, userId) {
    return db.prepare(`
      SELECT
        r.*,
        ru.name AS requester_name,
        ru.email AS requester_email,
        uu.name AS receiver_name,
        uu.email AS receiver_email
      FROM shared_debt_requests r
      JOIN users ru ON ru.id = r.requester_user_id
      JOIN users uu ON uu.id = r.receiver_user_id
      WHERE r.id = ?
        AND (r.requester_user_id = ? OR r.receiver_user_id = ?)
      LIMIT 1
    `).get(requestId, userId, userId);
  }

  function updateManualSharedDebtLastPix({ requestId, payload, txid, generatedAt, amountCents }) {
    return db.prepare(`
      UPDATE shared_debt_requests
      SET last_pix_payload = ?,
          last_pix_txid = ?,
          last_pix_generated_at = ?,
          last_pix_amount_cents = ?
      WHERE id = ?
    `).run(payload, txid, generatedAt, amountCents, requestId);
  }

  function getAcceptedRequestsForReceiver(requestIds, userId) {
    const placeholders = requestIds.map(() => '?').join(', ');
    return db.prepare(`
      SELECT r.*, u.name AS requester_name, u.email AS requester_email
      FROM shared_debt_requests r
      JOIN users u ON u.id = r.requester_user_id
      WHERE r.id IN (${placeholders})
        AND r.receiver_user_id = ?
        AND r.status = 'accepted'
        AND r.payment_marked_at IS NULL
      ORDER BY COALESCE(r.source_due_year, 0) DESC, COALESCE(r.source_due_month, 0) DESC, r.id ASC
    `).all(...requestIds, userId);
  }

  function getAcceptedOpenRequestsForRequester(requestIds, userId) {
    const placeholders = requestIds.map(() => '?').join(', ');
    return db.prepare(`
      SELECT r.*, u.name AS receiver_name, u.email AS receiver_email
      FROM shared_debt_requests r
      JOIN users u ON u.id = r.receiver_user_id
      WHERE r.id IN (${placeholders})
        AND r.requester_user_id = ?
        AND r.status = 'accepted'
        AND COALESCE(r.request_kind, 'card') = 'card'
        AND r.payment_marked_at IS NULL
        AND COALESCE(r.amount_cents, 0) > COALESCE(r.amount_paid_cents, 0)
      ORDER BY COALESCE(r.source_due_year, 0) ASC, COALESCE(r.source_due_month, 0) ASC, r.id ASC
    `).all(...requestIds, userId);
  }

  function getAcceptedMarkedRequestsForRequester(requestIds, userId) {
    const placeholders = requestIds.map(() => '?').join(', ');
    return db.prepare(`
      SELECT r.*, u.name AS receiver_name, u.email AS receiver_email
      FROM shared_debt_requests r
      JOIN users u ON u.id = r.receiver_user_id
      WHERE r.id IN (${placeholders})
        AND r.requester_user_id = ?
        AND r.status = 'accepted'
        AND r.payment_marked_at IS NOT NULL
      ORDER BY COALESCE(r.source_due_year, 0) DESC, COALESCE(r.source_due_month, 0) DESC, r.id ASC
    `).all(...requestIds, userId);
  }

  function getRejectedRequestsForRequester(requestIds, userId) {
    const placeholders = requestIds.map(() => '?').join(', ');
    return db.prepare(`
      SELECT r.*, u.name AS receiver_name, u.email AS receiver_email
      FROM shared_debt_requests r
      JOIN users u ON u.id = r.receiver_user_id
      WHERE r.id IN (${placeholders})
        AND r.requester_user_id = ?
        AND r.status = 'rejected_by_receiver'
      ORDER BY COALESCE(r.source_due_year, 0) DESC, COALESCE(r.source_due_month, 0) DESC, r.id ASC
    `).all(...requestIds, userId);
  }

  return {
    db,
    withTransaction,
    getSharedDebtRequestForParticipant,
    getArchivableSharedDebtRequestsForParticipant,
    getArchivedSharedDebtRequestsForParticipant,
    getPrivateReminderForOwner,
    updatePrivateReminderArchiveState,
    settlePrivateReminder,
    createManualSharedDebtRequest,
    getBatchForReceiver,
    getPendingBatchItems,
    getPendingRequestsForReceiver,
    getRequestForReceiver,
    getRequestForRequester,
    getMonthlySettlementIntentForReceiver,
    getMonthlySettlementIntentForRequester,
    getManualSharedDebtRequestForParticipant,
    updateManualSharedDebtLastPix,
    getAcceptedRequestsForReceiver,
    getAcceptedOpenRequestsForRequester,
    getAcceptedMarkedRequestsForRequester,
    getRejectedRequestsForRequester
  };
}

module.exports = {
  createSharedDebtsRepository
};
