const db = require('../db');
const { createAutomationApiRepository } = require('./automationApi.repository');
const { validatePixProfile } = require('../pix');

function nowIso() {
  return new Date().toISOString();
}

function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function placeholders(values = []) {
  return values.map(() => '?').join(', ');
}

function createAutomationSharedDebtsRepository() {
  const base = createAutomationApiRepository();

  function listPeople(userId) {
    return db.prepare(`
      SELECT id, name, email, phone, linked_user_id, profile_kind, is_owner, active, status
      FROM people
      WHERE user_id = ?
        AND COALESCE(status, CASE WHEN COALESCE(active, 1) = 0 THEN 'inactive' ELSE 'active' END) <> 'deleted'
      ORDER BY lower(name), id ASC
    `).all(Number(userId || 0));
  }

  function getUserRecord(userId) {
    return db.prepare(`
      SELECT id, name, email, status
      FROM users
      WHERE id = ? AND COALESCE(status, 'active') <> 'deleted'
      LIMIT 1
    `).get(Number(userId || 0));
  }

  function getSelfPerson(userId) {
    return base.getSelfPerson(userId);
  }

  function getDraftQueues(userId, filters = {}) {
    const month = toInt(filters.month, 0);
    const year = toInt(filters.year, 0);
    const params = [Number(userId || 0)];
    const where = [`q.requester_user_id = ?`, `q.status = 'draft'`];
    if (month && year) {
      where.push('q.source_due_month = ?');
      where.push('q.source_due_year = ?');
      params.push(month, year);
    }
    const limit = Math.max(1, Math.min(30, toInt(filters.limit, 12)));
    params.push(limit);

    return db.prepare(`
      SELECT
        q.*,
        COALESCE(NULLIF(q.receiver_name_snapshot, ''), u.name, u.email, 'Contato') AS receiver_display_name,
        u.email AS receiver_email,
        u.name AS receiver_user_name
      FROM shared_debt_send_queues q
      LEFT JOIN users u ON u.id = q.receiver_user_id
      WHERE ${where.join('\n        AND ')}
      ORDER BY q.source_due_year DESC, q.source_due_month DESC, q.updated_at DESC, q.id DESC
      LIMIT ?
    `).all(...params);
  }

  function getDraftQueueItems(queueIds = []) {
    const ids = Array.from(new Set((queueIds || []).map(Number).filter(Boolean)));
    if (!ids.length) return [];
    return db.prepare(`
      SELECT *
      FROM shared_debt_send_queue_items
      WHERE queue_id IN (${placeholders(ids)})
        AND cancelled_at IS NULL
      ORDER BY queue_id ASC, COALESCE(source_txn_date_snapshot, created_at) ASC, id ASC
    `).all(...ids);
  }

  function getDraftQueueForRequester(userId, queueId) {
    return db.prepare(`
      SELECT
        q.*,
        COALESCE(NULLIF(q.receiver_name_snapshot, ''), u.name, u.email, 'Contato') AS receiver_display_name,
        u.email AS receiver_email,
        u.name AS receiver_user_name
      FROM shared_debt_send_queues q
      LEFT JOIN users u ON u.id = q.receiver_user_id
      WHERE q.id = ? AND q.requester_user_id = ?
      LIMIT 1
    `).get(Number(queueId || 0), Number(userId || 0));
  }

  function getRequestByIdForParticipant(userId, requestId) {
    return db.prepare(`
      SELECT
        r.*,
        requester.name AS requester_name,
        requester.email AS requester_email,
        receiver.name AS receiver_name,
        receiver.email AS receiver_email
      FROM shared_debt_requests r
      LEFT JOIN users requester ON requester.id = r.requester_user_id
      LEFT JOIN users receiver ON receiver.id = r.receiver_user_id
      WHERE r.id = ?
        AND (r.requester_user_id = ? OR r.receiver_user_id = ?)
      LIMIT 1
    `).get(Number(requestId || 0), Number(userId || 0), Number(userId || 0));
  }

  function listRequests(userId, filters = {}) {
    const direction = String(filters.direction || 'both').trim().toLowerCase();
    const month = toInt(filters.month, 0);
    const year = toInt(filters.year, 0);
    const statuses = Array.isArray(filters.statuses) && filters.statuses.length
      ? filters.statuses.map((status) => String(status || '').trim()).filter(Boolean)
      : ['pending', 'accepted', 'rejected_by_receiver', 'rejection_contested_by_sender'];
    const limit = Math.max(1, Math.min(50, toInt(filters.limit, 20)));

    const params = [];
    const where = [];
    if (direction === 'incoming') {
      where.push('r.receiver_user_id = ?');
      params.push(Number(userId || 0));
    } else if (direction === 'outgoing') {
      where.push('r.requester_user_id = ?');
      params.push(Number(userId || 0));
    } else {
      where.push('(r.requester_user_id = ? OR r.receiver_user_id = ?)');
      params.push(Number(userId || 0), Number(userId || 0));
    }

    if (statuses.length) {
      where.push(`r.status IN (${placeholders(statuses)})`);
      params.push(...statuses);
    }
    if (month && year) {
      where.push(`COALESCE(r.source_due_month, CAST(strftime('%m', r.created_at) AS INTEGER)) = ?`);
      where.push(`COALESCE(r.source_due_year, CAST(strftime('%Y', r.created_at) AS INTEGER)) = ?`);
      params.push(month, year);
    }

    params.push(limit);
    return db.prepare(`
      SELECT
        r.*,
        requester.name AS requester_name,
        requester.email AS requester_email,
        receiver.name AS receiver_name,
        receiver.email AS receiver_email,
        CASE WHEN r.requester_user_id = ? THEN 'outgoing' ELSE 'incoming' END AS user_direction
      FROM shared_debt_requests r
      LEFT JOIN users requester ON requester.id = r.requester_user_id
      LEFT JOIN users receiver ON receiver.id = r.receiver_user_id
      WHERE ${where.join('\n        AND ')}
      ORDER BY COALESCE(r.updated_at, r.created_at) DESC, r.id DESC
      LIMIT ?
    `).all(Number(userId || 0), ...params);
  }

  function getSharedDebtSummary(userId, month, year) {
    const params = [Number(userId || 0), Number(month || 0), Number(year || 0)];
    const outgoing = db.prepare(`
      SELECT
        r.receiver_user_id AS counterpart_user_id,
        COALESCE(NULLIF(r.receiver_name_snapshot, ''), receiver.name, receiver.email, 'Contato') AS counterpart_name,
        r.status,
        COUNT(*) AS item_count,
        SUM(MAX(COALESCE(r.amount_cents, 0) - COALESCE(r.amount_paid_cents, 0), 0)) AS open_cents,
        SUM(COALESCE(r.amount_cents, 0)) AS total_cents
      FROM shared_debt_requests r
      LEFT JOIN users receiver ON receiver.id = r.receiver_user_id
      WHERE r.requester_user_id = ?
        AND COALESCE(r.source_due_month, CAST(strftime('%m', r.created_at) AS INTEGER)) = ?
        AND COALESCE(r.source_due_year, CAST(strftime('%Y', r.created_at) AS INTEGER)) = ?
        AND r.status IN ('pending', 'accepted', 'rejected_by_receiver', 'rejection_contested_by_sender')
        AND MAX(COALESCE(r.amount_cents, 0) - COALESCE(r.amount_paid_cents, 0), 0) > 0
      GROUP BY r.receiver_user_id, counterpart_name, r.status
      ORDER BY open_cents DESC, lower(counterpart_name)
    `).all(...params);

    const incoming = db.prepare(`
      SELECT
        r.requester_user_id AS counterpart_user_id,
        COALESCE(requester.name, requester.email, 'Contato') AS counterpart_name,
        r.status,
        COUNT(*) AS item_count,
        SUM(MAX(COALESCE(r.amount_cents, 0) - COALESCE(r.amount_paid_cents, 0), 0)) AS open_cents,
        SUM(COALESCE(r.amount_cents, 0)) AS total_cents
      FROM shared_debt_requests r
      LEFT JOIN users requester ON requester.id = r.requester_user_id
      WHERE r.receiver_user_id = ?
        AND COALESCE(r.source_due_month, CAST(strftime('%m', r.created_at) AS INTEGER)) = ?
        AND COALESCE(r.source_due_year, CAST(strftime('%Y', r.created_at) AS INTEGER)) = ?
        AND r.status IN ('pending', 'accepted', 'rejection_contested_by_sender')
        AND MAX(COALESCE(r.amount_cents, 0) - COALESCE(r.amount_paid_cents, 0), 0) > 0
      GROUP BY r.requester_user_id, counterpart_name, r.status
      ORDER BY open_cents DESC, lower(counterpart_name)
    `).all(...params);

    const drafts = getDraftQueues(userId, { month, year, limit: 20 });
    return { outgoing, incoming, drafts };
  }

  function insertSharedDebtEvent({ requestId, actorUserId, eventType, note = null, createdAt = nowIso() }) {
    db.prepare(`
      INSERT INTO shared_debt_events (request_id, actor_user_id, event_type, note, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(Number(requestId || 0), Number(actorUserId || 0), String(eventType || ''), note || null, createdAt);
  }

  function createNotification({ userId, type, title, body = null, href = null, relatedType = null, relatedId = null }) {
    if (!getUserRecord(userId)) return null;
    return db.prepare(`
      INSERT INTO notifications (user_id, type, title, body, href, is_read, related_type, related_id, created_at)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
    `).run(Number(userId || 0), String(type || 'shared_debt_request'), title, body, href, relatedType, relatedId, nowIso());
  }

  function touchBatch(batchId, timestamp = nowIso()) {
    if (!Number(batchId || 0)) return;
    db.prepare('UPDATE shared_debt_batches SET updated_at = ? WHERE id = ?').run(timestamp, Number(batchId || 0));
  }

  function createBatch({ requesterUserId, receiverUserId, originKind = 'single', createdAt = nowIso() }) {
    const info = db.prepare(`
      INSERT INTO shared_debt_batches (requester_user_id, receiver_user_id, origin_kind, status_summary, created_at, updated_at)
      VALUES (?, ?, ?, 'pending', ?, ?)
    `).run(Number(requesterUserId || 0), Number(receiverUserId || 0), originKind, createdAt, createdAt);
    return Number(info.lastInsertRowid || 0);
  }

  function sendDraftQueue({ userId, queueId }) {
    const queue = getDraftQueueForRequester(userId, queueId);
    if (!queue || String(queue.status || '').toLowerCase() !== 'draft') {
      const error = new Error('Não encontrei esse rascunho para enviar agora.');
      error.code = 'QUEUE_NOT_FOUND';
      throw error;
    }

    const items = getDraftQueueItems([queue.id]).map((item) => ({
      ...item,
      action_kind: ['create', 'update', 'cancel'].includes(String(item.action_kind || '').toLowerCase())
        ? String(item.action_kind || '').toLowerCase()
        : 'create'
    }));
    if (!items.length) {
      const error = new Error('Esse rascunho ficou vazio no caminho. Dá uma conferida na caixa de saída.');
      error.code = 'QUEUE_EMPTY';
      throw error;
    }

    const requesterPerson = getSelfPerson(userId);
    const actor = getUserRecord(userId);
    const requesterName = requesterPerson?.name || actor?.name || actor?.email || 'Alguém';
    const now = nowIso();
    const requestIds = [];
    const actionCounts = { create: 0, update: 0, cancel: 0 };
    const batchId = createBatch({
      requesterUserId: userId,
      receiverUserId: queue.receiver_user_id,
      originKind: items.length > 1 ? 'multiple' : 'single',
      createdAt: now
    });

    db.transaction(() => {
      items.forEach((item) => {
        if (item.action_kind === 'cancel') {
          if (Number(item.target_request_id || 0)) {
            db.prepare(`
              UPDATE shared_debt_requests
              SET status = 'cancelled', updated_at = ?, resolved_at = COALESCE(resolved_at, ?)
              WHERE id = ? AND requester_user_id = ? AND status = 'pending'
            `).run(now, now, item.target_request_id, userId);
            insertSharedDebtEvent({ requestId: item.target_request_id, actorUserId: userId, eventType: 'cancelled_by_sender', note: 'Cancelado por envio de rascunho atualizado.', createdAt: now });
            requestIds.push(Number(item.target_request_id));
          }
          actionCounts.cancel += 1;
          db.prepare('UPDATE shared_debt_send_queue_items SET sent_request_id = ?, updated_at = ? WHERE id = ?').run(Number(item.target_request_id || 0) || null, now, item.id);
          return;
        }

        if (item.action_kind === 'update' && Number(item.target_request_id || 0)) {
          const target = db.prepare(`
            SELECT id
            FROM shared_debt_requests
            WHERE id = ? AND requester_user_id = ? AND status = 'pending'
            LIMIT 1
          `).get(item.target_request_id, userId);
          if (target) {
            db.prepare(`
              UPDATE shared_debt_requests
              SET source_allocation_id = ?, source_due_month = ?, source_due_year = ?, source_txn_date_snapshot = ?,
                  card_id = ?, card_name_snapshot = ?, description_snapshot = ?, amount_cents = ?,
                  receiver_email_snapshot = ?, receiver_name_snapshot = ?, batch_id = ?, updated_at = ?
              WHERE id = ? AND requester_user_id = ?
            `).run(
              Number(item.source_allocation_id || 0) || null,
              item.source_due_month,
              item.source_due_year,
              item.source_txn_date_snapshot || null,
              Number(item.card_id || 0) || null,
              item.card_name_snapshot || null,
              item.description_snapshot,
              Number(item.amount_cents || 0),
              item.receiver_email_snapshot || queue.receiver_email_snapshot || null,
              item.receiver_name_snapshot || queue.receiver_name_snapshot || null,
              batchId,
              now,
              item.target_request_id,
              userId
            );
            insertSharedDebtEvent({ requestId: item.target_request_id, actorUserId: userId, eventType: 'updated_by_sender', note: 'Atualizado por envio de rascunho.', createdAt: now });
            requestIds.push(Number(item.target_request_id));
            actionCounts.update += 1;
            db.prepare('UPDATE shared_debt_send_queue_items SET sent_request_id = ?, updated_at = ? WHERE id = ?').run(item.target_request_id, now, item.id);
            return;
          }
        }

        const insert = db.prepare(`
          INSERT INTO shared_debt_requests (
            requester_user_id, requester_person_id, receiver_user_id, source_person_id,
            source_transaction_id, source_allocation_id, source_due_month, source_due_year, source_txn_date_snapshot,
            card_id, card_name_snapshot, description_snapshot, amount_cents,
            receiver_email_snapshot, receiver_name_snapshot, request_note, response_note,
            status, batch_id, request_kind, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'pending', ?, 'card', ?, ?)
        `).run(
          userId,
          requesterPerson?.id || null,
          queue.receiver_user_id,
          item.source_person_id,
          item.source_transaction_id,
          Number(item.source_allocation_id || 0) || null,
          item.source_due_month,
          item.source_due_year,
          item.source_txn_date_snapshot || null,
          Number(item.card_id || 0) || null,
          item.card_name_snapshot || null,
          item.description_snapshot,
          Number(item.amount_cents || 0),
          item.receiver_email_snapshot || queue.receiver_email_snapshot || null,
          item.receiver_name_snapshot || queue.receiver_name_snapshot || null,
          batchId,
          now,
          now
        );
        const requestId = Number(insert.lastInsertRowid || 0);
        requestIds.push(requestId);
        actionCounts.create += 1;
        insertSharedDebtEvent({ requestId, actorUserId: userId, eventType: 'created_by_sender', note: 'Enviado por automação WhatsApp.', createdAt: now });
        db.prepare('UPDATE shared_debt_send_queue_items SET sent_request_id = ?, updated_at = ? WHERE id = ?').run(requestId, now, item.id);
      });

      db.prepare(`
        UPDATE shared_debt_send_queues
        SET status = 'sent', sent_at = ?, batch_id = ?, updated_at = ?
        WHERE id = ?
      `).run(now, batchId, now, queue.id);

      createNotification({
        userId: queue.receiver_user_id,
        type: 'shared_debt_batch',
        title: 'Novo acerto recebido',
        body: `${requesterName} enviou ${items.length} item(ns), somando ${formatCentsText(queue.total_cents)}.`,
        href: requestIds[0] ? `/shared-debts?request=${requestIds[0]}` : '/shared-debts',
        relatedType: 'shared_debt_batch',
        relatedId: batchId
      });
    })();

    return { queue, items, batchId, requestIds, itemCount: items.length, totalCents: Number(queue.total_cents || 0), actionCounts };
  }

  function formatCentsText(cents) {
    const value = Number(cents || 0) / 100;
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function updateRequestStatus({ requestId, userId, role, action, note = null }) {
    const request = getRequestByIdForParticipant(userId, requestId);
    if (!request) return { changed: false, request: null, reason: 'not_found' };
    const now = nowIso();
    const status = String(request.status || '').toLowerCase();

    if (role === 'receiver') {
      if (Number(request.receiver_user_id || 0) !== Number(userId || 0)) return { changed: false, request, reason: 'forbidden' };
      if (status !== 'pending') return { changed: false, request, reason: 'invalid_status' };
      const nextStatus = action === 'accept' ? 'accepted' : 'rejected_by_receiver';
      db.transaction(() => {
        db.prepare(`
          UPDATE shared_debt_requests
          SET status = ?, response_note = ?, responded_at = ?, updated_at = ?
          WHERE id = ? AND receiver_user_id = ? AND status = 'pending'
        `).run(nextStatus, note || null, now, now, requestId, userId);
        insertSharedDebtEvent({ requestId, actorUserId: userId, eventType: nextStatus, note, createdAt: now });
        touchBatch(request.batch_id, now);
        createNotification({
          userId: request.requester_user_id,
          type: 'shared_debt_request',
          title: action === 'accept' ? 'Acerto aceito' : 'Acerto recusado',
          body: action === 'accept'
            ? `${request.receiver_name || request.receiver_email || 'A pessoa'} aceitou ${formatCentsText(request.amount_cents)} (${request.description_snapshot}).`
            : `${request.receiver_name || request.receiver_email || 'A pessoa'} recusou ${formatCentsText(request.amount_cents)} (${request.description_snapshot}).`,
          href: `/shared-debts?request=${requestId}`,
          relatedType: 'shared_debt_request',
          relatedId: requestId
        });
      })();
      return { changed: true, request: getRequestByIdForParticipant(userId, requestId), previous: request };
    }

    if (role === 'requester' && action === 'contest') {
      if (Number(request.requester_user_id || 0) !== Number(userId || 0)) return { changed: false, request, reason: 'forbidden' };
      if (status !== 'rejected_by_receiver') return { changed: false, request, reason: 'invalid_status' };
      db.transaction(() => {
        db.prepare(`
          UPDATE shared_debt_requests
          SET status = 'rejection_contested_by_sender', response_note = ?, updated_at = ?
          WHERE id = ? AND requester_user_id = ? AND status = 'rejected_by_receiver'
        `).run(note || null, now, requestId, userId);
        insertSharedDebtEvent({ requestId, actorUserId: userId, eventType: 'rejection_contested_by_sender', note, createdAt: now });
        touchBatch(request.batch_id, now);
        createNotification({
          userId: request.receiver_user_id,
          type: 'shared_debt_request',
          title: 'Recusa contestada',
          body: `${request.requester_name || request.requester_email || 'Quem enviou'} contestou a recusa do acerto ${request.description_snapshot}.`,
          href: `/shared-debts?request=${requestId}`,
          relatedType: 'shared_debt_request',
          relatedId: requestId
        });
      })();
      return { changed: true, request: getRequestByIdForParticipant(userId, requestId), previous: request };
    }

    return { changed: false, request, reason: 'unsupported_action' };
  }

  function markRequestPaid({ userId, requestId, note = null }) {
    const request = getRequestByIdForParticipant(userId, requestId);
    if (!request) return { changed: false, request: null, reason: 'not_found' };
    if (Number(request.receiver_user_id || 0) !== Number(userId || 0)) return { changed: false, request, reason: 'forbidden' };
    if (String(request.status || '').toLowerCase() !== 'accepted') return { changed: false, request, reason: 'invalid_status' };
    if (request.payment_marked_at) return { changed: false, request, reason: 'already_marked' };

    const now = nowIso();
    db.transaction(() => {
      db.prepare(`
        UPDATE shared_debt_requests
        SET payment_marked_at = ?, payment_note = ?, updated_at = ?
        WHERE id = ? AND receiver_user_id = ? AND status = 'accepted' AND payment_marked_at IS NULL
      `).run(now, note || null, now, requestId, userId);
      insertSharedDebtEvent({ requestId, actorUserId: userId, eventType: 'payment_marked_by_receiver', note, createdAt: now });
      touchBatch(request.batch_id, now);
      createNotification({
        userId: request.requester_user_id,
        type: 'shared_debt_request',
        title: 'Pagamento marcado como feito',
        body: `${request.receiver_name || request.receiver_email || 'Quem deve'} avisou que pagou ${formatCentsText(request.amount_cents)} (${request.description_snapshot}).`,
        href: `/shared-debts?request=${requestId}`,
        relatedType: 'shared_debt_request',
        relatedId: requestId
      });
      if (String(request.request_kind || 'card') === 'card') {
        recalcCardMonthlySettlement(request.requester_user_id, request.receiver_user_id, request.source_due_month, request.source_due_year);
      }
    })();
    return { changed: true, request: getRequestByIdForParticipant(userId, requestId), previous: request };
  }

  function confirmRequestReceived({ userId, requestId, note = null }) {
    const request = getRequestByIdForParticipant(userId, requestId);
    if (!request) return { changed: false, request: null, reason: 'not_found' };
    if (Number(request.requester_user_id || 0) !== Number(userId || 0)) return { changed: false, request, reason: 'forbidden' };
    if (String(request.status || '').toLowerCase() !== 'accepted') return { changed: false, request, reason: 'invalid_status' };
    if (!request.payment_marked_at) return { changed: false, request, reason: 'payment_not_marked' };

    const now = nowIso();
    db.transaction(() => {
      db.prepare(`
        UPDATE shared_debt_requests
        SET status = 'settled', amount_paid_cents = amount_cents, updated_at = ?, resolved_at = ?
        WHERE id = ? AND requester_user_id = ? AND status = 'accepted'
      `).run(now, now, requestId, userId);
      insertSharedDebtEvent({ requestId, actorUserId: userId, eventType: 'settled_by_requester', note, createdAt: now });
      touchBatch(request.batch_id, now);
      createNotification({
        userId: request.receiver_user_id,
        type: 'shared_debt_request',
        title: 'Pagamento confirmado',
        body: `${request.requester_name || request.requester_email || 'Quem recebeu'} confirmou o pagamento de ${formatCentsText(request.amount_cents)} (${request.description_snapshot}).`,
        href: `/shared-debts?request=${requestId}`,
        relatedType: 'shared_debt_request',
        relatedId: requestId
      });
      if (String(request.request_kind || 'card') === 'card') {
        recalcCardMonthlySettlement(request.requester_user_id, request.receiver_user_id, request.source_due_month, request.source_due_year);
      }
    })();
    return { changed: true, request: getRequestByIdForParticipant(userId, requestId), previous: request };
  }

  function getCardSettlementRowById(settlementId) {
    return db.prepare(`
      SELECT s.*, requester.name AS requester_name, requester.email AS requester_email, receiver.name AS receiver_name, receiver.email AS receiver_email
      FROM shared_debt_monthly_settlements s
      LEFT JOIN users requester ON requester.id = s.requester_user_id
      LEFT JOIN users receiver ON receiver.id = s.receiver_user_id
      WHERE s.id = ? AND s.request_kind = 'card'
      LIMIT 1
    `).get(Number(settlementId || 0));
  }

  function getCardSettlementRow(requesterUserId, receiverUserId, month, year) {
    return db.prepare(`
      SELECT *
      FROM shared_debt_monthly_settlements
      WHERE requester_user_id = ? AND receiver_user_id = ? AND month = ? AND year = ? AND request_kind = 'card'
      LIMIT 1
    `).get(Number(requesterUserId || 0), Number(receiverUserId || 0), Number(month || 0), Number(year || 0));
  }

  function ensureCardSettlementRow(requesterUserId, receiverUserId, month, year, now = nowIso()) {
    const existing = getCardSettlementRow(requesterUserId, receiverUserId, month, year);
    if (existing) return existing;
    const info = db.prepare(`
      INSERT INTO shared_debt_monthly_settlements (
        requester_user_id, receiver_user_id, month, year, request_kind, status,
        request_count, total_accepted_cents, reserved_cents, confirmed_cents, open_cents,
        created_at, updated_at, last_activity_at
      ) VALUES (?, ?, ?, ?, 'card', 'open', 0, 0, 0, 0, 0, ?, ?, ?)
    `).run(Number(requesterUserId || 0), Number(receiverUserId || 0), Number(month || 0), Number(year || 0), now, now, now);
    return getCardSettlementRowById(info.lastInsertRowid);
  }

  function getCardSettlementRequestRows(requesterUserId, receiverUserId, month, year) {
    return db.prepare(`
      SELECT *
      FROM shared_debt_requests
      WHERE requester_user_id = ?
        AND receiver_user_id = ?
        AND COALESCE(request_kind, 'card') = 'card'
        AND COALESCE(source_due_month, CAST(strftime('%m', created_at) AS INTEGER)) = ?
        AND COALESCE(source_due_year, CAST(strftime('%Y', created_at) AS INTEGER)) = ?
        AND status IN ('accepted', 'settled')
      ORDER BY COALESCE(source_txn_date_snapshot, created_at) ASC, id ASC
    `).all(Number(requesterUserId || 0), Number(receiverUserId || 0), Number(month || 0), Number(year || 0));
  }

  function getSettlementIntentRows(settlementId) {
    if (!Number(settlementId || 0)) return [];
    return db.prepare(`
      SELECT *
      FROM shared_debt_payment_intents
      WHERE settlement_id = ?
      ORDER BY COALESCE(reported_at, generated_at, created_at) DESC, id DESC
    `).all(Number(settlementId || 0));
  }

  function recalcCardMonthlySettlement(requesterUserId, receiverUserId, month, year) {
    const safeMonth = Number(month || 0);
    const safeYear = Number(year || 0);
    if (!Number(requesterUserId || 0) || !Number(receiverUserId || 0) || !safeMonth || !safeYear) return null;
    const now = nowIso();
    const settlement = ensureCardSettlementRow(requesterUserId, receiverUserId, safeMonth, safeYear, now);
    const requestRows = getCardSettlementRequestRows(requesterUserId, receiverUserId, safeMonth, safeYear);
    const intentRows = getSettlementIntentRows(settlement.id);
    const totals = requestRows.reduce((acc, row) => {
      const total = Math.max(0, Number(row.amount_cents || 0));
      const paid = Math.min(total, Math.max(0, Number(row.amount_paid_cents || (row.status === 'settled' ? total : 0))));
      acc.totalAcceptedCents += total;
      acc.confirmedCents += paid;
      if (row.status === 'accepted' && row.payment_marked_at && paid < total) acc.reservedCents += total - paid;
      return acc;
    }, { totalAcceptedCents: 0, confirmedCents: 0, reservedCents: 0 });

    intentRows.forEach((row) => {
      if (String(row.status || '').toLowerCase() === 'reported') totals.reservedCents += Math.max(0, Number(row.amount_cents || 0));
      if (String(row.status || '').toLowerCase() === 'confirmed') totals.confirmedCents += Math.max(0, Number(row.amount_cents || 0));
    });

    const openCents = Math.max(0, totals.totalAcceptedCents - totals.confirmedCents - totals.reservedCents);
    const status = totals.totalAcceptedCents > 0 && openCents === 0 && totals.reservedCents === 0
      ? 'settled'
      : totals.confirmedCents > 0
        ? 'partial'
        : totals.reservedCents > 0
          ? 'awaiting_confirmation'
          : 'open';

    db.prepare(`
      UPDATE shared_debt_monthly_settlements
      SET status = ?, request_count = ?, total_accepted_cents = ?, reserved_cents = ?, confirmed_cents = ?, open_cents = ?, updated_at = ?, last_activity_at = ?
      WHERE id = ?
    `).run(status, requestRows.length, totals.totalAcceptedCents, totals.reservedCents, totals.confirmedCents, openCents, now, now, settlement.id);

    return getCardSettlementSnapshotById(settlement.id);
  }

  function getCardSettlementSnapshotById(settlementId) {
    const row = getCardSettlementRowById(settlementId);
    if (!row) return null;
    const requestRows = getCardSettlementRequestRows(row.requester_user_id, row.receiver_user_id, row.month, row.year);
    const intentRows = getSettlementIntentRows(row.id);
    return {
      ...row,
      requestRows,
      intentRows,
      totalAcceptedCents: Number(row.total_accepted_cents || 0),
      reservedCents: Number(row.reserved_cents || 0),
      confirmedCents: Number(row.confirmed_cents || 0),
      openCents: Number(row.open_cents || 0),
      requestCount: Number(row.request_count || requestRows.length || 0)
    };
  }


  function listCardSettlementsForReceiver(userId, filters = {}) {
    const month = toInt(filters.month, 0);
    const year = toInt(filters.year, 0);
    const params = [Number(userId || 0)];
    const where = [`s.receiver_user_id = ?`, `s.request_kind = 'card'`, `COALESCE(s.open_cents, 0) > 0`];
    if (month && year) {
      where.push('s.month = ?');
      where.push('s.year = ?');
      params.push(month, year);
    }
    const limit = Math.max(1, Math.min(30, toInt(filters.limit, 12)));
    params.push(limit);
    return db.prepare(`
      SELECT s.*, requester.name AS requester_name, requester.email AS requester_email
      FROM shared_debt_monthly_settlements s
      LEFT JOIN users requester ON requester.id = s.requester_user_id
      WHERE ${where.join('\n        AND ')}
      ORDER BY s.year DESC, s.month DESC, s.open_cents DESC, lower(COALESCE(requester.name, requester.email, '')) ASC
      LIMIT ?
    `).all(...params);
  }

  function getUserPixProfile(userId) {
    const row = db.prepare(`
      SELECT
        id AS person_id, user_id, name, email, pix_enabled, pix_key_type, pix_key_value,
        pix_city, pix_state, pix_label, pix_updated_at
      FROM people
      WHERE user_id = ?
        AND COALESCE(profile_kind, CASE WHEN COALESCE(is_owner, 0) = 1 THEN 'self' ELSE 'contact' END) = 'self'
        AND COALESCE(status, CASE WHEN COALESCE(active, 1) = 0 THEN 'inactive' ELSE 'active' END) <> 'deleted'
      ORDER BY id ASC
      LIMIT 1
    `).get(Number(userId || 0));
    if (!row) return null;
    const validation = validatePixProfile({
      enabled: row.pix_enabled,
      keyType: row.pix_key_type,
      keyValue: row.pix_key_value,
      city: row.pix_city,
      state: row.pix_state,
      label: row.pix_label,
      name: row.name || row.email || 'ACERTTAPAY'
    });
    return {
      userId: Number(row.user_id || 0),
      personId: Number(row.person_id || 0) || null,
      ownerName: row.name || null,
      ownerEmail: row.email || null,
      pixEnabled: !!validation.enabled,
      pixValid: !!validation.valid,
      pixReason: validation.reason || null,
      pixKeyType: validation.keyType,
      pixKeyTypeLabel: validation.keyTypeLabel,
      pixKeyValue: validation.keyValue,
      pixMaskedKey: validation.keyMasked,
      pixCity: validation.city,
      pixMerchantName: validation.merchantName
    };
  }

  function cancelGeneratedSettlementIntents(settlementId, receiverUserId, exceptIntentId = 0) {
    db.prepare(`
      UPDATE shared_debt_payment_intents
      SET status = 'cancelled', cancelled_at = ?, updated_at = ?
      WHERE settlement_id = ?
        AND receiver_user_id = ?
        AND status = 'generated'
        AND id <> ?
    `).run(nowIso(), nowIso(), Number(settlementId || 0), Number(receiverUserId || 0), Number(exceptIntentId || 0));
  }

  function insertSettlementPixIntent({ settlement, userId, amountCents, payload, txid }) {
    const now = nowIso();
    const info = db.prepare(`
      INSERT INTO shared_debt_payment_intents (
        settlement_id, requester_user_id, receiver_user_id, month, year, request_kind,
        requested_by_user_id, amount_cents, status, pix_payload, pix_txid,
        created_at, updated_at, generated_at
      ) VALUES (?, ?, ?, ?, ?, 'card', ?, ?, 'generated', ?, ?, ?, ?, ?)
    `).run(
      settlement.id,
      settlement.requester_user_id,
      settlement.receiver_user_id,
      settlement.month,
      settlement.year,
      userId,
      amountCents,
      payload,
      txid,
      now,
      now,
      now
    );
    return Number(info.lastInsertRowid || 0);
  }

  return {
    ...base,
    db,
    nowIso,
    listPeople,
    getUserRecord,
    getSelfPerson,
    getDraftQueues,
    getDraftQueueItems,
    getDraftQueueForRequester,
    sendDraftQueue,
    listRequests,
    getSharedDebtSummary,
    getRequestByIdForParticipant,
    updateRequestStatus,
    markRequestPaid,
    confirmRequestReceived,
    getCardSettlementRowById,
    getCardSettlementSnapshotById,
    listCardSettlementsForReceiver,
    recalcCardMonthlySettlement,
    getUserPixProfile,
    cancelGeneratedSettlementIntents,
    insertSettlementPixIntent,
    createNotification,
    insertSharedDebtEvent
  };
}

module.exports = {
  createAutomationSharedDebtsRepository
};
