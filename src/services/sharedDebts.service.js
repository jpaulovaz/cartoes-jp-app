const { createSharedDebtsRepository } = require('../repositories/sharedDebts.repository');

function createSharedDebtsService(deps = {}) {
  const repository = deps.repository || createSharedDebtsRepository(deps);

  function groupSharedDebtRowsByBatch(rows = []) {
    const groups = new Map();

    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const batchId = Number(row?.batch_id || 0);
      const requestId = Number(row?.id || 0);
      const key = batchId ? `batch:${batchId}` : `request:${requestId}`;

      if (!groups.has(key)) {
        groups.set(key, {
          batchId: batchId || null,
          requestId: requestId || null,
          rows: [],
          totalCents: 0
        });
      }

      const entry = groups.get(key);
      entry.rows.push(row);
      entry.totalCents += Number(row?.amount_cents || 0);
    });

    return Array.from(groups.values());
  }

  function archiveRequest({ userId, requestId, returnTo, fallback }) {
    const fallbackRedirect = deps.resolveSharedDebtViewPath(returnTo, fallback);

    if (!requestId) {
      return { redirectTo: fallbackRedirect, flash: { type: 'error', message: 'Ops, essa cobrança não parece válida.' } };
    }

    const requestRow = repository.getSharedDebtRequestForParticipant(requestId, userId);
    if (!requestRow) {
      return { redirectTo: fallbackRedirect, flash: { type: 'error', message: 'Não achei esse acerto por aqui.' } };
    }

    if (!deps.canArchiveSharedDebtStatus(requestRow.status)) {
      return {
        redirectTo: fallbackRedirect,
        flash: { type: 'info', message: 'Essa cobrança ainda tem história para acontecer por aqui, então ela fica nas ativas por enquanto.' }
      };
    }

    deps.upsertSharedDebtArchiveState({
      requestId,
      userId,
      isArchived: true,
      archivedFromStatus: requestRow.status,
      timestamp: deps.nowIso()
    });

    return {
      redirectTo: fallbackRedirect,
      flash: { type: 'success', message: 'Acerto arquivado. A fila principal agradeceu o respiro.' }
    };
  }

  function unarchiveRequest({ userId, requestId, returnTo, fallback }) {
    const fallbackRedirect = deps.resolveSharedDebtViewPath(returnTo, fallback);

    if (!requestId) {
      return { redirectTo: fallbackRedirect, flash: { type: 'error', message: 'Ops, essa cobrança não parece válida.' } };
    }

    const requestRow = repository.getSharedDebtRequestForParticipant(requestId, userId);
    if (!requestRow) {
      return { redirectTo: fallbackRedirect, flash: { type: 'error', message: 'Não achei esse acerto por aqui.' } };
    }

    deps.upsertSharedDebtArchiveState({
      requestId,
      userId,
      isArchived: false,
      archivedFromStatus: requestRow.status,
      timestamp: deps.nowIso()
    });

    return {
      redirectTo: fallbackRedirect,
      flash: { type: 'success', message: 'Acerto restaurado. Ele voltou para os ativos sem perder nadinha do histórico.' }
    };
  }

  function archivePrivateReminder({ userId, reminderId, returnTo, fallback }) {
    const fallbackRedirect = deps.resolveSharedDebtViewPath(returnTo, fallback);

    if (!reminderId) {
      return { redirectTo: fallbackRedirect, flash: { type: 'error', message: 'Ops, esse lembrete privado não parece válido.' } };
    }

    const reminder = repository.getPrivateReminderForOwner(userId, reminderId, { includeArchived: true });
    if (!reminder) {
      return { redirectTo: fallbackRedirect, flash: { type: 'error', message: 'Lembrete privado não encontrado.' } };
    }

    if (Number(reminder.is_archived || 0) > 0) {
      return { redirectTo: fallbackRedirect, flash: { type: 'info', message: 'Esse lembrete privado já estava curtindo o arquivo.' } };
    }

    if (!deps.canArchivePrivateDebtStatus(reminder.status)) {
      return {
        redirectTo: fallbackRedirect,
        flash: { type: 'info', message: 'Esse lembrete privado ainda está em aberto, então continua nas ativas até você confirmar o recebimento.' }
      };
    }

    const now = deps.nowIso();
    repository.updatePrivateReminderArchiveState({ reminderId, userId, isArchived: true, now });

    return {
      redirectTo: fallbackRedirect,
      flash: { type: 'success', message: 'Lembrete privado arquivado. A central respirou e o histórico continuou intacto.' }
    };
  }

  function unarchivePrivateReminder({ userId, reminderId, returnTo, fallback }) {
    const fallbackRedirect = deps.resolveSharedDebtViewPath(returnTo, fallback);

    if (!reminderId) {
      return { redirectTo: fallbackRedirect, flash: { type: 'error', message: 'Ops, esse lembrete privado não parece válido.' } };
    }

    const reminder = repository.getPrivateReminderForOwner(userId, reminderId, { includeArchived: true });
    if (!reminder) {
      return { redirectTo: fallbackRedirect, flash: { type: 'error', message: 'Lembrete privado não encontrado.' } };
    }

    if (Number(reminder.is_archived || 0) === 0) {
      return { redirectTo: fallbackRedirect, flash: { type: 'info', message: 'Esse lembrete privado já está nas ativas.' } };
    }

    const now = deps.nowIso();
    repository.updatePrivateReminderArchiveState({ reminderId, userId, isArchived: false, now });

    return {
      redirectTo: fallbackRedirect,
      flash: { type: 'success', message: 'Lembrete privado restaurado. Ele voltou para as ativas sem perder o fio da meada.' }
    };
  }

  function bulkArchive({ userId, requestIds, returnTo, fallback }) {
    const fallbackRedirect = deps.resolveSharedDebtViewPath(returnTo, fallback);

    if (!requestIds.length) {
      return { redirectTo: fallbackRedirect, flash: { type: 'error', message: 'Nenhuma cobrança válida foi escolhida para ir ao arquivo.' } };
    }

    const rows = repository
      .getArchivableSharedDebtRequestsForParticipant(requestIds, userId)
      .filter((row) => deps.canArchiveSharedDebtStatus(row.status));

    if (!rows.length) {
      return {
        redirectTo: fallbackRedirect,
        flash: { type: 'info', message: 'Essas cobranças ainda não estão naquele ponto zen de irem para o arquivo.' }
      };
    }

    const now = deps.nowIso();
    repository.withTransaction(() => {
      rows.forEach((row) => {
        deps.upsertSharedDebtArchiveState({
          requestId: row.id,
          userId,
          isArchived: true,
          archivedFromStatus: row.status,
          timestamp: now
        });
      });
    });

    return {
      redirectTo: fallbackRedirect,
      flash: {
        type: 'success',
        message: `Pronto! ${deps.formatCountLabel(rows.length, 'cobrança foi arquivada', 'cobranças foram arquivadas')} sem apagar o histórico.`
      }
    };
  }

  function bulkUnarchive({ userId, requestIds, returnTo, fallback }) {
    const fallbackRedirect = deps.resolveSharedDebtViewPath(returnTo, fallback);

    if (!requestIds.length) {
      return { redirectTo: fallbackRedirect, flash: { type: 'error', message: 'Nenhuma cobrança válida foi escolhida para sair do arquivo.' } };
    }

    const rows = repository.getArchivedSharedDebtRequestsForParticipant(requestIds, userId);
    if (!rows.length) {
      return { redirectTo: fallbackRedirect, flash: { type: 'info', message: 'Não achei cobranças arquivadas válidas nessa seleção.' } };
    }

    const now = deps.nowIso();
    repository.withTransaction(() => {
      rows.forEach((row) => {
        deps.upsertSharedDebtArchiveState({
          requestId: row.id,
          userId,
          isArchived: false,
          archivedFromStatus: row.status,
          timestamp: now
        });
      });
    });

    return {
      redirectTo: fallbackRedirect,
      flash: {
        type: 'success',
        message: `Pronto! ${deps.formatCountLabel(rows.length, 'cobrança voltou para as ativas', 'cobranças voltaram para as ativas')}.`
      }
    };
  }

  function sendDraftQueue(userId, queueId) {
    const result = deps.sendSharedDebtDraftQueue(userId, queueId);
    return {
      redirectTo: '/shared-debts#draft-queues',
      flash: {
        type: 'success',
        message: `Pronto! ${deps.formatCountLabel(result.itemCount, 'item saiu', 'itens saíram')} da caixa de saída e seguiram o combinado.`
      }
    };
  }

  function discardDraftQueue(userId, queueId) {
    const discarded = deps.discardSharedDebtDraftQueue(userId, queueId);
    return {
      redirectTo: '/shared-debts#draft-queues',
      flash: discarded
        ? { type: 'success', message: 'Rascunho descartado. A divisão local continuou salva por aqui.' }
        : { type: 'info', message: 'Esse rascunho já tinha saído de cena ou não existe mais.' }
    };
  }

  function createManual({ userId, body = {} }) {
    const mode = deps.normalizeManualSharedDebtMode(body.mode || body.delivery_mode || body.kind);
    const personId = Number(body.person_id || 0);
    const description = deps.sanitizePrivateDebtDescription(body.description || '', 120);
    const note = deps.sanitizePrivateDebtNote(body.note || '', 400);
    const promisedPaymentDate = deps.normalizePrivateDebtPromisedPaymentDate(body.promised_payment_date || body.promisedPaymentDate || null);
    const amountCents = deps.centsFromPtBrMoney(body.amount);

    if (!personId) {
      return {
        redirectTo: '/shared-debts',
        flash: {
          type: 'error',
          message: mode === 'private'
            ? 'Escolha um contato para guardar esse lembrete privado.'
            : 'Escolha uma amizade para enviar esse lembrete avulso.'
        }
      };
    }

    if (!description) {
      return { redirectTo: '/shared-debts', flash: { type: 'error', message: 'Dê um nome curto para esse combinado antes de continuar.' } };
    }

    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      return { redirectTo: '/shared-debts', flash: { type: 'error', message: 'Coloque um valor válido para esse lembrete seguir viagem.' } };
    }

    if (mode === 'private') {
      const person = deps.getPrivateDebtReminderSelectablePeople(userId).find((entry) => Number(entry.id || 0) === personId);
      if (!person) {
        return {
          redirectTo: '/shared-debts',
          flash: { type: 'error', message: 'Esse contato não está disponível para virar lembrete privado agora.' }
        };
      }

      const reminderId = deps.createPrivateDebtReminder({
        ownerUserId: userId,
        person,
        description,
        amountCents,
        note,
        promisedPaymentDate,
        createdAt: deps.nowIso()
      });

      if (!reminderId) {
        return {
          redirectTo: '/shared-debts',
          flash: { type: 'error', message: 'Não consegui guardar esse lembrete privado agora. Tenta de novo em um instantinho.' }
        };
      }

      const receiverName = person.name || person.linked_user_name || person.linked_user_email || 'esse contato';
      const promisedLabel = promisedPaymentDate ? ` Pagamento combinado para ${deps.formatDateBR(promisedPaymentDate)}.` : '';
      return {
        redirectTo: `/shared-debts?private=${reminderId}`,
        flash: {
          type: 'success',
          message: person.can_share_charge && person.friendship_active
            ? `Lembrete privado criado para ${receiverName}. Fica só no seu app, sem avisar a outra pessoa.${promisedLabel}`
            : `Lembrete privado criado para ${receiverName}. Agora ele entra no seu controle até você confirmar o recebimento.${promisedLabel}`
        }
      };
    }

    const person = deps.getManualSharedDebtEligiblePeople(userId).find((entry) => Number(entry.id || 0) === personId);
    if (!person) {
      return {
        redirectTo: '/shared-debts',
        flash: {
          type: 'error',
          message: 'Essa amizade não está pronta para receber cobrança avulsa agora. Se preferir, dá para guardar como lembrete privado só no seu app.'
        }
      };
    }

    const linkedUserId = Number(person.linked_user_id || 0);
    if (!linkedUserId || linkedUserId === userId) {
      return {
        redirectTo: '/shared-debts',
        flash: { type: 'error', message: 'Não consegui descobrir quem está do outro lado desse lembrete.' }
      };
    }

    const requesterPerson = deps.getOwnerPerson(userId);
    const actor = deps.getUserRecord(userId);
    const actorName = requesterPerson?.name || actor?.name || actor?.email || 'Um usuário';
    const receiverName = person.name || person.linked_user_name || person.linked_user_email || 'essa amizade';
    const receiverEmail = deps.normalizeEmail(person.email || person.linked_user_email || null);
    const now = deps.nowIso();
    const batchId = deps.createSharedDebtBatch({
      requesterUserId: userId,
      receiverUserId: linkedUserId,
      originKind: 'manual',
      createdAt: now
    });

    const info = repository.createManualSharedDebtRequest({
      requesterUserId: userId,
      requesterPersonId: requesterPerson?.id || null,
      receiverUserId: linkedUserId,
      sourcePersonId: personId,
      sourceTxnDateSnapshot: now,
      descriptionSnapshot: description,
      amountCents,
      receiverEmailSnapshot: receiverEmail,
      receiverNameSnapshot: receiverName,
      requestNote: note,
      promisedPaymentDate,
      batchId,
      createdAt: now,
      updatedAt: now
    });

    const requestId = Number(info.lastInsertRowid || 0);
    deps.addSharedDebtEvent({ requestId, actorUserId: userId, eventType: 'created', note: note || 'Lembrete avulso enviado.' });
    deps.refreshSharedDebtBatch(batchId, now);

    const resolvedManualReminderMessage = deps.resolveCatalogText('notification.shared_debt.single.manual_created', {
      remetente: actorName,
      valor: deps.formatBRLFromCents(amountCents),
      descricao: description,
      nota: note || ''
    }, {
      fallbackTitle: 'Chegou um lembrete avulso',
      fallbackBody: `${actorName} te enviou um lembrete de ${deps.formatBRLFromCents(amountCents)} (${description}).${deps.buildNoteSuffix(note, 'Recado')}`
    });

    deps.createNotification({
      userId: linkedUserId,
      type: 'shared_debt_request',
      title: resolvedManualReminderMessage.title,
      body: resolvedManualReminderMessage.body,
      href: `/shared-debts?request=${requestId}`,
      relatedType: 'shared_debt_request',
      relatedId: requestId,
      groupKey: 'shared_debt_new'
    });

    return {
      redirectTo: `/shared-debts?request=${requestId}`,
      flash: {
        type: 'success',
        message: `Pronto! O lembrete avulso para ${receiverName} já foi enviado com a data de hoje.${promisedPaymentDate ? ` Pagamento combinado para ${deps.formatDateBR(promisedPaymentDate)}.` : ''}`
      }
    };
  }

  function settlePrivateReminder({ userId, reminderId, note, paymentDate }) {
    if (!reminderId) {
      return { redirectTo: '/shared-debts', flash: { type: 'error', message: 'Esse lembrete privado não parece válido.' } };
    }

    const reminder = repository.getPrivateReminderForOwner(userId, reminderId, { includeArchived: false });
    if (!reminder) {
      return { redirectTo: '/shared-debts', flash: { type: 'error', message: 'Não encontrei esse lembrete privado por aqui.' } };
    }

    if (reminder.status === deps.PRIVATE_DEBT_STATUS_SETTLED) {
      return { redirectTo: `/shared-debts?private=${reminderId}`, flash: { type: 'info', message: 'Esse lembrete privado já estava quitado.' } };
    }

    if (reminder.status !== deps.PRIVATE_DEBT_STATUS_OPEN) {
      return { redirectTo: `/shared-debts?private=${reminderId}`, flash: { type: 'info', message: 'Esse lembrete privado não está aberto para confirmação agora.' } };
    }

    const now = deps.nowIso();
    repository.settlePrivateReminder({
      reminderId,
      userId,
      status: deps.PRIVATE_DEBT_STATUS_SETTLED,
      note,
      paymentDate,
      now,
      expectedStatus: deps.PRIVATE_DEBT_STATUS_OPEN
    });

    return {
      redirectTo: `/shared-debts?private=${reminderId}`,
      flash: { type: 'success', message: `Boa! O lembrete privado com ${reminder.display_name || 'esse contato'} foi marcado como recebido.` }
    };
  }

  function respondToBatch({ userId, batchId, action, note, redirectTo }) {
    if (!batchId) {
      return { redirectTo: '/shared-debts', flash: { type: 'error', message: 'Ops, esse envio não é válido.' } };
    }

    if (!['accept', 'reject'].includes(action)) {
      return { redirectTo, flash: { type: 'error', message: 'Essa ação não combina com esse envio.' } };
    }

    const batchRow = repository.getBatchForReceiver(batchId, userId);
    if (!batchRow) {
      return { redirectTo, flash: { type: 'error', message: 'Envio não encontrado.' } };
    }

    const pendingItems = repository.getPendingBatchItems(batchId, userId);
    if (!pendingItems.length) {
      return { redirectTo, flash: { type: 'info', message: 'Este envio não possui mais cobranças pendentes para você.' } };
    }

    const actor = deps.getUserRecord(userId);
    const actorName = actor?.name || actor?.email || 'O destinatário';
    const now = deps.nowIso();
    const accepted = action === 'accept';
    const nextStatus = accepted ? 'accepted' : 'rejected_by_receiver';
    const totalCents = pendingItems.reduce((sum, item) => sum + Number(item.amount_cents || 0), 0);
    const firstRequestId = Number(pendingItems[0]?.id || 0) || null;
    const chargeCountLabel = deps.formatCountLabel(pendingItems.length, 'cobrança', 'cobranças');
    const isManualBatch = deps.normalizeSharedDebtOriginKind(batchRow.origin_kind) === 'manual';
    const itemCountLabel = isManualBatch ? deps.formatCountLabel(pendingItems.length, 'lembrete avulso', 'lembretes avulsos') : chargeCountLabel;
    const batchResponseMessageKey = accepted
      ? (isManualBatch ? 'notification.shared_debt.batch.response.accept.manual' : 'notification.shared_debt.batch.response.accept.regular')
      : (isManualBatch ? 'notification.shared_debt.batch.response.reject.manual' : 'notification.shared_debt.batch.response.reject.regular');
    const fallbackTitle = accepted
      ? (isManualBatch ? 'Seu lembrete avulso foi aceito' : 'Seu envio foi aceito')
      : (isManualBatch ? 'Seu lembrete avulso foi recusado' : 'Seu envio foi recusado');
    const baseBody = accepted
      ? `${actorName} aceitou ${itemCountLabel} do seu envio, somando ${deps.formatBRLFromCents(totalCents)}.`
      : `${actorName} recusou ${itemCountLabel} do seu envio, somando ${deps.formatBRLFromCents(totalCents)}.`;
    const resolvedMessage = deps.resolveCatalogText(batchResponseMessageKey, {
      destinatario: actorName,
      n_cobrancas: chargeCountLabel,
      n_lembretes: itemCountLabel,
      valor_total: deps.formatBRLFromCents(totalCents),
      nota: note || ''
    }, {
      fallbackTitle,
      fallbackBody: `${baseBody}${deps.buildNoteSuffix(note)}`
    });

    repository.withTransaction(() => {
      pendingItems.forEach((item) => {
        repository.db.prepare(`
          UPDATE shared_debt_requests
          SET status = ?, response_note = ?, updated_at = ?, responded_at = ?
          WHERE id = ? AND receiver_user_id = ? AND status = 'pending'
        `).run(nextStatus, note, now, now, item.id, userId);
        deps.addSharedDebtEvent({ requestId: item.id, actorUserId: userId, eventType: nextStatus, note });
      });

      deps.touchSharedDebtBatch(batchId, now);
      deps.createNotification({
        userId: batchRow.requester_user_id,
        type: 'shared_debt_batch',
        title: resolvedMessage.title,
        body: resolvedMessage.body,
        href: firstRequestId ? `/shared-debts?request=${firstRequestId}` : '/shared-debts',
        relatedType: 'shared_debt_batch',
        relatedId: batchId,
        groupKey: 'shared_debt_updates'
      });
    });

    return {
      redirectTo,
      flash: {
        type: 'success',
        message: accepted ? `Pronto! Você aceitou ${chargeCountLabel} deste envio.` : `Pronto! Você recusou ${chargeCountLabel} deste envio.`
      }
    };
  }

  function respondToRequest({ userId, requestId, action, note, redirectTo }) {
    if (!requestId) {
      return { redirectTo: '/shared-debts', flash: { type: 'error', message: 'Ops, essa solicitação não é válida.' } };
    }

    if (!['accept', 'reject'].includes(action)) {
      return { redirectTo, flash: { type: 'error', message: 'Essa ação não combina com essa solicitação.' } };
    }

    const requestRow = repository.getRequestForReceiver(requestId, userId);
    if (!requestRow) {
      return { redirectTo, flash: { type: 'error', message: 'Ops, não encontrei essa solicitação.' } };
    }

    if (requestRow.status !== 'pending') {
      return { redirectTo, flash: { type: 'info', message: 'Essa solicitação já tinha sido resolvida antes.' } };
    }

    const actor = deps.getUserRecord(userId);
    const actorName = actor?.name || requestRow.receiver_name_snapshot || actor?.email || 'O destinatário';
    const now = deps.nowIso();
    const accepted = action === 'accept';
    const nextStatus = accepted ? 'accepted' : 'rejected_by_receiver';
    const requestKind = deps.normalizeSharedDebtRequestKind(requestRow.request_kind);
    const isManualRequest = requestKind === 'manual';
    const messageKey = accepted
      ? (isManualRequest ? 'notification.shared_debt.single.response.accept.manual' : 'notification.shared_debt.single.response.accept.regular')
      : (isManualRequest ? 'notification.shared_debt.single.response.reject.manual' : 'notification.shared_debt.single.response.reject.regular');
    const fallbackTitle = accepted
      ? (isManualRequest ? 'Aceitaram seu lembrete avulso' : 'Aceitaram sua cobrança compartilhada')
      : (isManualRequest ? 'Recusaram seu lembrete avulso' : 'Recusaram sua cobrança compartilhada');
    const baseBody = accepted
      ? `${actorName} aceitou ${isManualRequest ? 'o lembrete avulso' : 'a cobrança'} de ${deps.formatBRLFromCents(requestRow.amount_cents)} (${requestRow.description_snapshot}).`
      : `${actorName} recusou ${isManualRequest ? 'o lembrete avulso' : 'a cobrança'} de ${deps.formatBRLFromCents(requestRow.amount_cents)} (${requestRow.description_snapshot}).`;
    const resolvedMessage = deps.resolveCatalogText(messageKey, {
      destinatario: actorName,
      valor: deps.formatBRLFromCents(requestRow.amount_cents),
      descricao: requestRow.description_snapshot,
      nota: note || ''
    }, {
      fallbackTitle,
      fallbackBody: `${baseBody}${deps.buildNoteSuffix(note)}`
    });

    repository.withTransaction(() => {
      repository.db.prepare(`
        UPDATE shared_debt_requests
        SET status = ?, response_note = ?, updated_at = ?, responded_at = ?
        WHERE id = ? AND receiver_user_id = ? AND status = 'pending'
      `).run(nextStatus, note, now, now, requestId, userId);

      deps.addSharedDebtEvent({ requestId, actorUserId: userId, eventType: nextStatus, note });
      deps.touchSharedDebtBatch(requestRow.batch_id, now);
      deps.createNotification({
        userId: requestRow.requester_user_id,
        type: 'shared_debt_request',
        title: resolvedMessage.title,
        body: resolvedMessage.body,
        href: `/shared-debts?request=${requestId}`,
        relatedType: 'shared_debt_request',
        relatedId: requestId,
        groupKey: 'shared_debt_updates'
      });
    });

    return {
      redirectTo,
      flash: {
        type: 'success',
        message: accepted ? 'Pronto! Você aceitou essa solicitação.' : 'Pronto! Você recusou essa solicitação.'
      }
    };
  }

  function senderAction({ userId, requestId, action, note, redirectTo }) {
    if (!requestId) {
      return { redirectTo: '/shared-debts', flash: { type: 'error', message: 'Ops, essa solicitação não é válida.' } };
    }

    if (!['accept_rejection', 'contest_rejection'].includes(action)) {
      return { redirectTo, flash: { type: 'error', message: 'Essa ação não combina com essa solicitação.' } };
    }

    const requestRow = repository.getRequestForRequester(requestId, userId);
    if (!requestRow) {
      return { redirectTo, flash: { type: 'error', message: 'Ops, não encontrei essa solicitação.' } };
    }

    if (requestRow.status !== 'rejected_by_receiver') {
      return { redirectTo, flash: { type: 'info', message: 'Essa solicitação não está esperando uma decisão de quem enviou.' } };
    }

    const actor = deps.getUserRecord(userId);
    const actorName = actor?.name || actor?.email || 'O remetente';
    const now = deps.nowIso();
    const acceptingRejection = action === 'accept_rejection';
    const nextStatus = acceptingRejection ? 'rejection_accepted_by_sender' : 'rejection_contested_by_sender';
    const requestKind = deps.normalizeSharedDebtRequestKind(requestRow.request_kind);
    const isManualRequest = requestKind === 'manual';
    const messageKey = acceptingRejection
      ? (isManualRequest ? 'notification.shared_debt.single.sender_action.accept_rejection.manual' : 'notification.shared_debt.single.sender_action.accept_rejection.regular')
      : (isManualRequest ? 'notification.shared_debt.single.sender_action.contest_rejection.manual' : 'notification.shared_debt.single.sender_action.contest_rejection.regular');
    const fallbackTitle = acceptingRejection
      ? (isManualRequest ? 'A recusa do lembrete foi aceita' : 'Sua recusa foi aceita')
      : (isManualRequest ? 'A recusa do lembrete foi contestada' : 'Sua recusa foi contestada');
    const baseBody = acceptingRejection
      ? `${actorName} aceitou a sua recusa ${isManualRequest ? 'do lembrete avulso' : 'da cobrança'} de ${deps.formatBRLFromCents(requestRow.amount_cents)} (${requestRow.description_snapshot}).`
      : `${actorName} contestou a sua recusa ${isManualRequest ? 'do lembrete avulso' : 'da cobrança'} de ${deps.formatBRLFromCents(requestRow.amount_cents)} (${requestRow.description_snapshot}).`;
    const resolvedMessage = deps.resolveCatalogText(messageKey, {
      remetente: actorName,
      valor: deps.formatBRLFromCents(requestRow.amount_cents),
      descricao: requestRow.description_snapshot,
      nota: note || ''
    }, {
      fallbackTitle,
      fallbackBody: `${baseBody}${deps.buildNoteSuffix(note)}`
    });

    repository.withTransaction(() => {
      if (acceptingRejection) {
        repository.db.prepare(`
          UPDATE shared_debt_requests
          SET status = ?, updated_at = ?, resolved_at = ?
          WHERE id = ? AND requester_user_id = ? AND status = 'rejected_by_receiver'
        `).run(nextStatus, now, now, requestId, userId);
      } else {
        repository.db.prepare(`
          UPDATE shared_debt_requests
          SET status = ?, updated_at = ?, resolved_at = NULL
          WHERE id = ? AND requester_user_id = ? AND status = 'rejected_by_receiver'
        `).run(nextStatus, now, requestId, userId);
      }

      deps.addSharedDebtEvent({ requestId, actorUserId: userId, eventType: nextStatus, note });
      deps.touchSharedDebtBatch(requestRow.batch_id, now);
      deps.createNotification({
        userId: requestRow.receiver_user_id,
        type: 'shared_debt_request',
        title: resolvedMessage.title,
        body: resolvedMessage.body,
        href: `/shared-debts?request=${requestId}`,
        relatedType: 'shared_debt_request',
        relatedId: requestId,
        groupKey: 'shared_debt_updates'
      });
    });

    return {
      redirectTo,
      flash: {
        type: 'success',
        message: acceptingRejection ? 'Pronto! Você aceitou a recusa e encerrou esse acerto.' : 'Pronto! Você contestou a recusa desse acerto.'
      }
    };
  }

  function prepareMonthlySettlement({ userId, settlementId }) {
    if (!settlementId) {
      return { status: 400, body: { ok: false, message: 'Não consegui descobrir qual mês você quer acertar por Pix.' } };
    }

    const settlementRow = deps.getSharedDebtCardMonthlySettlementRowById(settlementId);
    if (!settlementRow || (Number(settlementRow.requester_user_id || 0) !== Number(userId || 0) && Number(settlementRow.receiver_user_id || 0) !== Number(userId || 0))) {
      return { status: 404, body: { ok: false, message: 'Essa carteira mensal não apareceu por aqui.' } };
    }

    if (Number(settlementRow.receiver_user_id || 0) !== Number(userId || 0)) {
      return { status: 403, body: { ok: false, message: 'Esse Pix mensal fica do lado de quem vai pagar.' } };
    }

    const snapshot = deps.getSharedDebtCardMonthlySettlementSnapshotById(settlementId);
    if (!snapshot || !Number(snapshot.requestCount || 0)) {
      return { status: 404, body: { ok: false, message: 'Ainda não encontrei acertos aceitos para montar esse mês por aqui.' } };
    }

    const creditorProfile = deps.getUserPixProfile(settlementRow.requester_user_id);
    const creditorRecord = deps.getUserRecord(settlementRow.requester_user_id);
    const preview = deps.buildSharedDebtCardMonthlyIntentPreview(snapshot, snapshot.openCents);

    let pixAvailable = false;
    let pixUnavailableReason = null;
    if (!creditorProfile || !creditorProfile.pixEnabled) {
      pixUnavailableReason = 'Quem vai receber ainda não deixou um Pix prontinho por aqui.';
    } else if (!creditorProfile.pixValid) {
      pixUnavailableReason = creditorProfile.pixReason || 'O Pix de quem vai receber ainda precisa de um acerto.';
    } else if (!Number(snapshot.openCents || 0)) {
      pixUnavailableReason = 'Esse mês já está sem saldo aberto para um novo Pix agora.';
    } else {
      pixAvailable = true;
    }

    return {
      status: 200,
      body: {
        ok: true,
        settlementId,
        month: Number(snapshot.month || settlementRow.month || 0),
        year: Number(snapshot.year || settlementRow.year || 0),
        monthLabel: deps.monthLabel(snapshot.month || settlementRow.month, snapshot.year || settlementRow.year),
        counterpartName: creditorRecord?.name || creditorRecord?.email || 'quem vai receber',
        totalAcceptedCents: Number(snapshot.totalAcceptedCents || 0),
        totalAcceptedFormatted: deps.formatBRLFromCents(snapshot.totalAcceptedCents || 0),
        confirmedCents: Number(snapshot.confirmedCents || 0),
        confirmedFormatted: deps.formatBRLFromCents(snapshot.confirmedCents || 0),
        reservedCents: Number(snapshot.reservedCents || 0),
        reservedFormatted: deps.formatBRLFromCents(snapshot.reservedCents || 0),
        openCents: Number(snapshot.openCents || 0),
        openFormatted: deps.formatBRLFromCents(snapshot.openCents || 0),
        requestCount: Number(snapshot.requestCount || 0),
        preview,
        pixAvailable,
        pixUnavailableReason,
        maskedKey: creditorProfile?.pixMaskedKey || null,
        keyType: creditorProfile?.pixKeyType || null,
        keyTypeLabel: creditorProfile?.pixKeyTypeLabel || null,
        city: creditorProfile?.pixCity || null
      }
    };
  }

  async function createMonthlySettlementPix({ userId, settlementId, rawAmount }) {
    if (!settlementId) {
      return { status: 400, body: { ok: false, message: 'Ainda falta me contar qual mês você quer acertar agora.' } };
    }

    const settlementRow = deps.getSharedDebtCardMonthlySettlementRowById(settlementId);
    if (!settlementRow || Number(settlementRow.receiver_user_id || 0) !== Number(userId || 0)) {
      return { status: 404, body: { ok: false, message: 'Essa carteira mensal não apareceu do seu lado por aqui.' } };
    }

    const snapshot = deps.getSharedDebtCardMonthlySettlementSnapshotById(settlementId);
    if (!snapshot || !Number(snapshot.requestCount || 0)) {
      return { status: 404, body: { ok: false, message: 'Ainda não encontrei acertos aceitos para montar esse mês por aqui.' } };
    }

    const openCents = Math.max(0, Number(snapshot.openCents || 0));
    if (!openCents) {
      return { status: 409, body: { ok: false, message: 'Esse mês já está sem saldo aberto para um novo Pix agora.' } };
    }

    const requestedAmountCents = deps.coerceMoneyValueToCents(rawAmount, openCents);
    if (!requestedAmountCents) {
      return { status: 400, body: { ok: false, message: 'Me conta quanto vai entrar nesse Pix para eu montar o código certinho.' } };
    }

    if (requestedAmountCents > openCents) {
      return { status: 409, body: { ok: false, message: `Por aqui, o máximo disponível agora é ${deps.formatBRLFromCents(openCents)}.` } };
    }

    const creditorProfile = deps.getUserPixProfile(settlementRow.requester_user_id);
    const creditorRecord = deps.getUserRecord(settlementRow.requester_user_id);
    if (!creditorProfile || !creditorProfile.pixEnabled) {
      return { status: 409, body: { ok: false, message: 'Quem vai receber ainda não deixou um Pix prontinho por aqui.' } };
    }

    if (!creditorProfile.pixValid) {
      return { status: 409, body: { ok: false, message: creditorProfile.pixReason || 'Ainda falta um ajuste no Pix de quem vai receber.' } };
    }

    const now = deps.nowIso();
    let intentId = null;
    let txid = null;
    let payload = null;

    repository.withTransaction(() => {
      deps.cancelSharedDebtGeneratedMonthlyIntents(settlementId, userId);

      const insert = repository.db.prepare(`
        INSERT INTO shared_debt_payment_intents (
          settlement_id, requester_user_id, receiver_user_id, month, year, request_kind,
          requested_by_user_id, amount_cents, status, created_at, updated_at, generated_at
        ) VALUES (?, ?, ?, ?, ?, 'card', ?, ?, 'generated', ?, ?, ?)
      `).run(
        settlementId,
        settlementRow.requester_user_id,
        settlementRow.receiver_user_id,
        settlementRow.month,
        settlementRow.year,
        userId,
        requestedAmountCents,
        now,
        now,
        now
      );

      intentId = Number(insert.lastInsertRowid || 0);
      txid = deps.buildSharedDebtCardMonthlyPixTxid(settlementId, intentId);
      payload = deps.buildPixPayload({
        keyType: creditorProfile.pixKeyType,
        keyValue: creditorProfile.pixKeyValue,
        merchantName: creditorProfile.pixMerchantName || creditorProfile.ownerName || creditorRecord?.name,
        merchantCity: creditorProfile.pixCity,
        amountCents: requestedAmountCents,
        txid,
        description: deps.sanitizePixText(`CARTAO ${String(settlementRow.month).padStart(2, '0')}/${settlementRow.year}`, { max: 72 })
      });

      repository.db.prepare(`
        UPDATE shared_debt_payment_intents
        SET pix_payload = ?,
            pix_txid = ?,
            updated_at = ?,
            generated_at = COALESCE(generated_at, ?)
        WHERE id = ?
      `).run(payload, txid, now, now, intentId);
    });

    const preview = deps.buildSharedDebtCardMonthlyIntentPreview(snapshot, requestedAmountCents);
    const qrDataUrl = deps.QRCode
      ? await deps.QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', margin: 1, width: 320 })
      : null;
    const shareContent = deps.buildSharedDebtCardMonthlyPixShareText({
      creditorName: creditorProfile.ownerName || creditorRecord?.name || creditorRecord?.email || 'quem vai receber',
      amountCents: requestedAmountCents,
      month: settlementRow.month,
      year: settlementRow.year,
      payload
    });

    return {
      status: 200,
      body: {
        ok: true,
        settlementId,
        intentId,
        payload,
        txid,
        qrDataUrl,
        qrSupported: !!deps.QRCode,
        amountCents: requestedAmountCents,
        amountFormatted: deps.formatBRLFromCents(requestedAmountCents),
        creditorName: creditorProfile.ownerName || creditorRecord?.name || creditorRecord?.email || 'Quem vai receber',
        maskedKey: creditorProfile.pixMaskedKey,
        keyType: creditorProfile.pixKeyType,
        keyTypeLabel: creditorProfile.pixKeyTypeLabel,
        city: creditorProfile.pixCity,
        shareText: shareContent.text,
        shareTitle: shareContent.title,
        keyValue: creditorProfile.pixKeyValue,
        monthLabel: deps.monthLabel(settlementRow.month, settlementRow.year),
        preview,
        settlement: {
          totalAcceptedCents: Number(snapshot.totalAcceptedCents || 0),
          confirmedCents: Number(snapshot.confirmedCents || 0),
          reservedCents: Number(snapshot.reservedCents || 0),
          openCents,
          requestCount: Number(snapshot.requestCount || 0)
        }
      }
    };
  }

  function reportMonthlySettlementPayment({ userId, settlementId, intentId, note }) {
    if (!settlementId || !intentId) {
      return { status: 400, body: { ok: false, message: 'Ainda falta me dizer qual Pix do mês você acabou de informar.' } };
    }

    const settlementRow = deps.getSharedDebtCardMonthlySettlementRowById(settlementId);
    if (!settlementRow || Number(settlementRow.receiver_user_id || 0) !== Number(userId || 0)) {
      return { status: 404, body: { ok: false, message: 'Essa carteira mensal não apareceu do seu lado por aqui.' } };
    }

    const intentRow = repository.getMonthlySettlementIntentForReceiver(intentId, settlementId, userId);
    if (!intentRow) {
      return { status: 404, body: { ok: false, message: 'Não encontrei esse Pix do mês para confirmar o envio agora.' } };
    }

    const intentStatus = deps.normalizeSharedDebtPaymentIntentStatus(intentRow.status);
    if (intentStatus === 'reported') {
      return { status: 409, body: { ok: false, message: 'Esse Pix do mês já foi informado e agora só está esperando a confirmação final.' } };
    }

    if (intentStatus !== 'generated') {
      return { status: 409, body: { ok: false, message: 'Esse Pix do mês já saiu da fase de aviso por aqui.' } };
    }

    const snapshotBefore = deps.getSharedDebtCardMonthlySettlementSnapshotById(settlementId);
    const openCents = Math.max(0, Number(snapshotBefore?.openCents || 0));
    const intentAmountCents = Math.max(0, Number(intentRow.amount_cents || 0));

    if (!openCents) {
      return { status: 409, body: { ok: false, message: 'Esse mês já não tem saldo aberto para receber esse Pix agora.' } };
    }

    if (intentAmountCents > openCents) {
      return { status: 409, body: { ok: false, message: `Enquanto você estava por aqui, o saldo do mês mudou. Agora o máximo disponível é ${deps.formatBRLFromCents(openCents)}.` } };
    }

    const actor = deps.getUserRecord(userId);
    const actorName = actor?.name || actor?.email || 'Quem vai pagar';
    const now = deps.nowIso();

    repository.withTransaction(() => {
      const result = repository.db.prepare(`
        UPDATE shared_debt_payment_intents
        SET status = 'reported',
            payer_note = ?,
            reported_at = ?,
            updated_at = ?
        WHERE id = ?
          AND settlement_id = ?
          AND receiver_user_id = ?
          AND status = 'generated'
      `).run(note, now, now, intentId, settlementId, userId);

      if (!result.changes) {
        throw new Error('Esse Pix do mês já mudou de estado enquanto você estava por aqui.');
      }

      deps.cancelSharedDebtGeneratedMonthlyIntents(settlementId, userId);

      const resolvedMessage = deps.resolveCatalogText('notification.monthly_pix.reported', {
        pagador: actorName,
        valor: deps.formatBRLFromCents(intentAmountCents),
        mes_referencia: deps.monthLabel(settlementRow.month, settlementRow.year),
        nota: note || ''
      }, {
        fallbackTitle: 'Pix do mês informado',
        fallbackBody: `${actorName} avisou um Pix de ${deps.formatBRLFromCents(intentAmountCents)} para ${deps.monthLabel(settlementRow.month, settlementRow.year)}.${deps.buildNoteSuffix(note)}`
      });

      deps.createNotification({
        userId: settlementRow.requester_user_id,
        type: 'shared_debt_request',
        title: resolvedMessage.title,
        body: resolvedMessage.body,
        href: `/shared-debts?settlement=${settlementId}`,
        relatedType: 'shared_debt_payment_intent',
        relatedId: intentId,
        groupKey: 'monthly_pix_updates'
      });
    });

    const snapshotAfter = deps.getSharedDebtCardMonthlySettlementSnapshotById(settlementId);
    return {
      status: 200,
      body: {
        ok: true,
        settlementId,
        message: 'Pronto! Agora é só aguardar a confirmação de quem vai receber.',
        redirectTo: `/shared-debts?settlement=${settlementId}`,
        snapshot: snapshotAfter ? {
          status: snapshotAfter.status,
          totalAcceptedCents: Number(snapshotAfter.totalAcceptedCents || 0),
          confirmedCents: Number(snapshotAfter.confirmedCents || 0),
          reservedCents: Number(snapshotAfter.reservedCents || 0),
          openCents: Number(snapshotAfter.openCents || 0)
        } : null
      }
    };
  }

  function confirmMonthlySettlementPayment({ userId, settlementId, intentId, note }) {
    const fallbackRedirect = settlementId ? `/shared-debts?settlement=${settlementId}` : '/shared-debts';

    if (!settlementId || !intentId) {
      return { redirectTo: fallbackRedirect, flash: { type: 'error', message: 'Ainda falta me dizer qual Pix do mês você quer conferir por aqui.' } };
    }

    const settlementRow = deps.getSharedDebtCardMonthlySettlementRowById(settlementId);
    if (!settlementRow || Number(settlementRow.requester_user_id || 0) !== Number(userId || 0)) {
      return { redirectTo: '/shared-debts', flash: { type: 'error', message: 'Essa carteira mensal não apareceu do seu lado para confirmar.' } };
    }

    const intentRow = repository.getMonthlySettlementIntentForRequester(intentId, settlementId, userId);
    if (!intentRow) {
      return { redirectTo: fallbackRedirect, flash: { type: 'error', message: 'Não encontrei esse Pix do mês para conferir agora.' } };
    }

    const intentStatus = deps.normalizeSharedDebtPaymentIntentStatus(intentRow.status);
    if (intentStatus === 'confirmed') {
      return { redirectTo: fallbackRedirect, flash: { type: 'info', message: 'Esse Pix do mês já foi confirmado antes.' } };
    }

    if (intentStatus === 'rejected') {
      return { redirectTo: fallbackRedirect, flash: { type: 'info', message: 'Esse Pix do mês já foi devolvido para o saldo aberto antes.' } };
    }

    if (intentStatus !== 'reported') {
      return { redirectTo: fallbackRedirect, flash: { type: 'info', message: 'Esse Pix do mês ainda não foi marcado como pago do outro lado.' } };
    }

    const snapshotBefore = deps.getSharedDebtCardMonthlySettlementSnapshotById(settlementId);
    if (!snapshotBefore) {
      return { redirectTo: fallbackRedirect, flash: { type: 'error', message: 'Não consegui abrir a carteira desse mês para confirmar o recebimento agora.' } };
    }

    const preview = deps.buildSharedDebtCardMonthlyIntentPreview(snapshotBefore, intentRow.amount_cents, {
      maxAmountCents: Math.max(0, Number(snapshotBefore.totalAcceptedCents || 0) - Number(snapshotBefore.confirmedCents || 0))
    });

    if (!Number(preview.allocatedCents || 0)) {
      return { redirectTo: fallbackRedirect, flash: { type: 'info', message: 'Enquanto você estava por aqui, esse mês mudou e não sobrou saldo em aberto para esse Pix. Abre a carteira de novo para conferir a foto atual.' } };
    }

    if (Number(preview.allocatedCents || 0) !== Math.max(0, Number(intentRow.amount_cents || 0))) {
      return { redirectTo: fallbackRedirect, flash: { type: 'info', message: `Enquanto você estava por aqui, o saldo desse mês mudou. Agora esse Pix não encaixa inteiro (${deps.formatBRLFromCents(preview.allocatedCents || 0)} ainda cabem). Melhor gerar um novo retrato antes de confirmar.` } };
    }

    const actor = deps.getUserRecord(userId);
    const actorName = actor?.name || actor?.email || 'Quem vai receber';
    const monthText = deps.monthLabel(settlementRow.month, settlementRow.year);
    const now = deps.nowIso();
    const allocationRows = Array.isArray(preview.allocationRows) ? preview.allocationRows.filter((row) => Number(row?.id || 0) && Number(row?.appliedCents || 0) > 0) : [];
    const requestRowById = new Map((Array.isArray(snapshotBefore.requestRows) ? snapshotBefore.requestRows : []).map((row) => [Number(row?.id || 0), row]));

    repository.withTransaction(() => {
      const result = repository.db.prepare(`
        UPDATE shared_debt_payment_intents
        SET status = 'confirmed',
            creditor_note = ?,
            confirmed_at = ?,
            updated_at = ?
        WHERE id = ?
          AND settlement_id = ?
          AND requester_user_id = ?
          AND status = 'reported'
      `).run(note, now, now, intentId, settlementId, userId);

      if (!result.changes) {
        throw new Error('Esse Pix do mês já mudou de estado enquanto você estava por aqui.');
      }

      allocationRows.forEach((allocation) => {
        const requestRow = requestRowById.get(Number(allocation.id || 0)) || null;
        const totalCents = Math.max(0, Number(requestRow?.amount_cents || allocation.totalCents || 0));
        const nextPaidCents = Math.min(totalCents, Math.max(0, Number(allocation.afterPaidCents || 0)));
        const nextPendingCents = Math.max(0, totalCents - nextPaidCents);
        const nextStatus = nextPendingCents <= 0 ? 'settled' : 'accepted';
        const resolvedAt = nextStatus === 'settled' ? (requestRow?.resolved_at || now) : null;

        repository.db.prepare(`
          INSERT OR REPLACE INTO shared_debt_payment_allocations (settlement_id, intent_id, request_id, allocated_cents, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(settlementId, intentId, allocation.id, Math.max(0, Number(allocation.appliedCents || 0)), now);

        repository.db.prepare(`
          UPDATE shared_debt_requests
          SET amount_paid_cents = ?,
              status = ?,
              payment_marked_at = NULL,
              payment_note = NULL,
              updated_at = ?,
              resolved_at = ?
          WHERE id = ?
            AND requester_user_id = ?
            AND receiver_user_id = ?
            AND COALESCE(request_kind, 'card') = 'card'
        `).run(
          nextPaidCents,
          nextStatus,
          now,
          resolvedAt,
          allocation.id,
          settlementRow.requester_user_id,
          settlementRow.receiver_user_id
        );

        deps.addSharedDebtEvent({
          requestId: allocation.id,
          actorUserId: userId,
          eventType: nextStatus === 'settled' ? 'settled_via_monthly_pix' : 'partial_payment_confirmed_via_monthly_pix',
          note
        });
      });

      Array.from(new Set(
        allocationRows
          .map((allocation) => requestRowById.get(Number(allocation.id || 0))?.batch_id)
          .map((value) => Number(value || 0))
          .filter(Boolean)
      )).forEach((batchId) => {
        deps.touchSharedDebtBatch(batchId, now);
      });

      const resolvedMessage = deps.resolveCatalogText('notification.monthly_pix.confirmed', {
        credor: actorName,
        valor: deps.formatBRLFromCents(intentRow.amount_cents),
        mes_referencia: monthText,
        resumo_distribuicao_pix: deps.buildSharedDebtCardMonthlyIntentResultSummary(preview),
        nota: note || ''
      }, {
        fallbackTitle: 'Pix do mês confirmado',
        fallbackBody: `${actorName} confirmou o Pix de ${deps.formatBRLFromCents(intentRow.amount_cents)} em ${monthText}. ${deps.buildSharedDebtCardMonthlyIntentResultSummary(preview)}${deps.buildNoteSuffix(note)}`
      });

      deps.createNotification({
        userId: settlementRow.receiver_user_id,
        type: 'shared_debt_request',
        title: resolvedMessage.title,
        body: resolvedMessage.body,
        href: `/shared-debts?settlement=${settlementId}`,
        relatedType: 'shared_debt_payment_intent',
        relatedId: intentId,
        groupKey: 'monthly_pix_updates'
      });
    });

    const snapshotAfter = deps.getSharedDebtCardMonthlySettlementSnapshotById(settlementId);
    const successPieces = [
      `Recebimento confirmado de ${deps.formatBRLFromCents(intentRow.amount_cents)}.`,
      deps.buildSharedDebtCardMonthlyIntentResultSummary(preview)
    ];
    if (snapshotAfter) {
      successPieces.push(`Agora ainda ficam ${deps.formatBRLFromCents(snapshotAfter.openCents || 0)} em aberto nessa carteira.`);
    }

    return { redirectTo: fallbackRedirect, flash: { type: 'success', message: successPieces.join(' ') } };
  }

  function rejectMonthlySettlementPayment({ userId, settlementId, intentId, note }) {
    const fallbackRedirect = settlementId ? `/shared-debts?settlement=${settlementId}` : '/shared-debts';

    if (!settlementId || !intentId) {
      return { redirectTo: fallbackRedirect, flash: { type: 'error', message: 'Ainda falta me dizer qual Pix do mês não encaixou por aqui.' } };
    }

    const settlementRow = deps.getSharedDebtCardMonthlySettlementRowById(settlementId);
    if (!settlementRow || Number(settlementRow.requester_user_id || 0) !== Number(userId || 0)) {
      return { redirectTo: '/shared-debts', flash: { type: 'error', message: 'Essa carteira mensal não apareceu do seu lado para revisar.' } };
    }

    const intentRow = repository.getMonthlySettlementIntentForRequester(intentId, settlementId, userId);
    if (!intentRow) {
      return { redirectTo: fallbackRedirect, flash: { type: 'error', message: 'Não encontrei esse Pix do mês para revisar agora.' } };
    }

    const intentStatus = deps.normalizeSharedDebtPaymentIntentStatus(intentRow.status);
    if (intentStatus === 'rejected') {
      return { redirectTo: fallbackRedirect, flash: { type: 'info', message: 'Esse Pix do mês já tinha voltado para o saldo aberto antes.' } };
    }

    if (intentStatus === 'confirmed') {
      return { redirectTo: fallbackRedirect, flash: { type: 'info', message: 'Esse Pix do mês já foi confirmado antes, então não dá para voltar atrás por aqui.' } };
    }

    if (intentStatus !== 'reported') {
      return { redirectTo: fallbackRedirect, flash: { type: 'info', message: 'Esse Pix do mês ainda não foi marcado como pago do outro lado.' } };
    }

    const actor = deps.getUserRecord(userId);
    const actorName = actor?.name || actor?.email || 'Quem vai receber';
    const monthText = deps.monthLabel(settlementRow.month, settlementRow.year);
    const now = deps.nowIso();

    repository.withTransaction(() => {
      const result = repository.db.prepare(`
        UPDATE shared_debt_payment_intents
        SET status = 'rejected',
            creditor_note = ?,
            rejected_at = ?,
            updated_at = ?
        WHERE id = ?
          AND settlement_id = ?
          AND requester_user_id = ?
          AND status = 'reported'
      `).run(note, now, now, intentId, settlementId, userId);

      if (!result.changes) {
        throw new Error('Esse Pix do mês já mudou de estado enquanto você estava por aqui.');
      }

      const resolvedMessage = deps.resolveCatalogText('notification.monthly_pix.revision', {
        credor: actorName,
        valor: deps.formatBRLFromCents(intentRow.amount_cents),
        mes_referencia: monthText,
        nota: note || ''
      }, {
        fallbackTitle: 'Pix do mês voltou para revisão',
        fallbackBody: `${actorName} não confirmou o Pix de ${deps.formatBRLFromCents(intentRow.amount_cents)} em ${monthText}. O valor voltou para o saldo aberto dessa carteira.${deps.buildNoteSuffix(note)}`
      });

      deps.createNotification({
        userId: settlementRow.receiver_user_id,
        type: 'shared_debt_request',
        title: resolvedMessage.title,
        body: resolvedMessage.body,
        href: `/shared-debts?settlement=${settlementId}`,
        relatedType: 'shared_debt_payment_intent',
        relatedId: intentId,
        groupKey: 'monthly_pix_updates'
      });
    });

    const snapshotAfter = deps.getSharedDebtCardMonthlySettlementSnapshotById(settlementId);
    const infoPieces = [`Pronto. ${deps.formatBRLFromCents(intentRow.amount_cents)} voltou para o saldo aberto desse mês.`];
    if (snapshotAfter) {
      infoPieces.push(`Agora a carteira mostra ${deps.formatBRLFromCents(snapshotAfter.openCents || 0)} em aberto.`);
    }

    return { redirectTo: fallbackRedirect, flash: { type: 'success', message: infoPieces.join(' ') } };
  }

  async function getRequestPix({ userId, requestId }) {
    if (!requestId) {
      return { status: 400, body: { ok: false, message: 'Não consegui descobrir qual acerto avulso você quer abrir no Pix.' } };
    }

    const requestRow = repository.getManualSharedDebtRequestForParticipant(requestId, userId);
    if (!requestRow) {
      return { status: 404, body: { ok: false, message: 'Esse acerto avulso não apareceu por aqui.' } };
    }

    if (deps.normalizeSharedDebtRequestKind(requestRow.request_kind) !== 'manual') {
      return { status: 400, body: { ok: false, message: 'Nesta fase, o Pix vive só nos acertos avulsos.' } };
    }

    const status = String(requestRow.status || 'pending').trim().toLowerCase();
    const totalCents = Math.max(0, Number(requestRow.amount_cents || 0));
    const alreadyPaidCents = Math.min(totalCents, Math.max(0, Number(requestRow.amount_paid_cents || (status === 'settled' ? totalCents : 0))));
    const pendingCents = Math.max(0, totalCents - alreadyPaidCents);

    if (!['pending', 'accepted'].includes(status)) {
      return { status: 409, body: { ok: false, message: 'Esse lembrete já saiu da fase de pagamento.' } };
    }

    if (requestRow.payment_marked_at) {
      return { status: 409, body: { ok: false, message: 'Esse pagamento já foi marcado como feito e agora só está esperando a confirmação final.' } };
    }

    if (!pendingCents) {
      return { status: 409, body: { ok: false, message: 'Esse lembrete já está com o valor fechado por aqui.' } };
    }

    const creditorProfile = deps.getUserPixProfile(requestRow.requester_user_id);
    if (!creditorProfile || !creditorProfile.pixEnabled) {
      return { status: 409, body: { ok: false, message: 'Quem vai receber ainda não deixou um Pix prontinho aqui.' } };
    }

    if (!creditorProfile.pixValid) {
      return { status: 409, body: { ok: false, message: creditorProfile.pixReason || 'Ainda falta um ajuste no Pix de quem vai receber.' } };
    }

    const txid = deps.buildSharedDebtPixTxid(requestRow.id, Number(requestRow.pix_version || 0));
    const payload = deps.buildPixPayload({
      keyType: creditorProfile.pixKeyType,
      keyValue: creditorProfile.pixKeyValue,
      merchantName: creditorProfile.pixMerchantName || creditorProfile.ownerName || requestRow.requester_name,
      merchantCity: creditorProfile.pixCity,
      amountCents: pendingCents,
      txid,
      description: deps.sanitizePixText(requestRow.description_snapshot, { max: 72 })
    });
    const qrDataUrl = deps.QRCode
      ? await deps.QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', margin: 1, width: 320 })
      : null;
    const shareContent = deps.buildManualSharedDebtPixShareText({
      creditorName: creditorProfile.ownerName || requestRow.requester_name || requestRow.requester_email || 'quem vai receber',
      amountCents: pendingCents,
      description: requestRow.description_snapshot,
      payload
    });

    repository.updateManualSharedDebtLastPix({
      requestId,
      payload,
      txid,
      generatedAt: deps.nowIso(),
      amountCents: pendingCents
    });

    return {
      status: 200,
      body: {
        ok: true,
        requestId,
        payload,
        txid,
        qrDataUrl,
        qrSupported: !!deps.QRCode,
        amountCents: pendingCents,
        amountFormatted: deps.formatBRLFromCents(pendingCents),
        creditorName: creditorProfile.ownerName || requestRow.requester_name || requestRow.requester_email || 'Quem vai receber',
        maskedKey: creditorProfile.pixMaskedKey,
        keyType: creditorProfile.pixKeyType,
        keyTypeLabel: creditorProfile.pixKeyTypeLabel,
        city: creditorProfile.pixCity,
        shareText: shareContent.text,
        shareTitle: shareContent.title,
        keyValue: creditorProfile.pixKeyValue,
        description: requestRow.description_snapshot,
        isCreditor: Number(requestRow.requester_user_id || 0) === Number(userId || 0)
      }
    };
  }

  function markPaid({ userId, requestId, note, redirectTo }) {
    if (!requestId) {
      return { redirectTo: '/shared-debts', flash: { type: 'error', message: 'Ops, essa solicitação não é válida.' } };
    }

    const requestRow = repository.getRequestForReceiver(requestId, userId);
    if (!requestRow) {
      return { redirectTo, flash: { type: 'error', message: 'Ops, não encontrei essa solicitação.' } };
    }

    const requestKind = deps.normalizeSharedDebtRequestKind(requestRow.request_kind);
    if (requestKind === 'card') {
      const snapshot = deps.getSharedDebtCardMonthlySettlementSnapshot({
        requesterUserId: requestRow.requester_user_id,
        receiverUserId: requestRow.receiver_user_id,
        month: requestRow.source_due_month,
        year: requestRow.source_due_year
      });
      const redirectHref = snapshot?.id ? `/shared-debts?settlement=${snapshot.id}` : `/shared-debts?request=${requestId}`;
      return {
        redirectTo: redirectTo || redirectHref,
        flash: { type: 'info', message: 'Agora o pagamento do cartão anda pela carteira do mês. Abre a competência e usa “Pagar este mês”.' }
      };
    }

    if (requestRow.status === 'settled') {
      return { redirectTo, flash: { type: 'info', message: 'Esse acerto já foi encerrado antes.' } };
    }

    if (requestRow.status !== 'accepted') {
      return { redirectTo, flash: { type: 'info', message: 'Só dá para marcar pagamento em solicitações já aceitas.' } };
    }

    if (requestRow.payment_marked_at) {
      return { redirectTo, flash: { type: 'info', message: 'O pagamento dessa solicitação já foi avisado e agora está esperando confirmação.' } };
    }

    const actor = deps.getUserRecord(userId);
    const actorName = actor?.name || requestRow.receiver_name_snapshot || actor?.email || 'O destinatário';
    const now = deps.nowIso();
    const isManualRequest = requestKind === 'manual';
    const resolvedMessage = deps.resolveCatalogText(
      isManualRequest ? 'notification.shared_debt.payment_marked.manual' : 'notification.shared_debt.payment_marked.regular',
      {
        pagador: actorName,
        valor: deps.formatBRLFromCents(requestRow.amount_cents),
        descricao: requestRow.description_snapshot,
        nota: note || ''
      },
      {
        fallbackTitle: isManualRequest ? 'Pagamento do lembrete marcado como feito' : 'Pagamento marcado como feito',
        fallbackBody: `${actorName} avisou que já pagou ${isManualRequest ? 'o lembrete avulso' : 'a cobrança'} de ${deps.formatBRLFromCents(requestRow.amount_cents)} (${requestRow.description_snapshot}).${deps.buildNoteSuffix(note)}`
      }
    );

    repository.withTransaction(() => {
      repository.db.prepare(`
        UPDATE shared_debt_requests
        SET payment_marked_at = ?, payment_note = ?, updated_at = ?
        WHERE id = ? AND receiver_user_id = ? AND status = 'accepted' AND payment_marked_at IS NULL
      `).run(now, note, now, requestId, userId);

      deps.addSharedDebtEvent({ requestId, actorUserId: userId, eventType: 'payment_marked_by_receiver', note });
      deps.touchSharedDebtBatch(requestRow.batch_id, now);
      deps.createNotification({
        userId: requestRow.requester_user_id,
        type: 'shared_debt_request',
        title: resolvedMessage.title,
        body: resolvedMessage.body,
        href: `/shared-debts?request=${requestId}`,
        relatedType: 'shared_debt_request',
        relatedId: requestId,
        groupKey: 'shared_debt_payments'
      });
    });

    return { redirectTo, flash: { type: 'success', message: 'Pronto! Agora quem enviou o acerto já pode confirmar o recebimento.' } };
  }

  function confirmReceipt({ userId, requestId, note, redirectTo }) {
    if (!requestId) {
      return { redirectTo: '/shared-debts', flash: { type: 'error', message: 'Ops, essa solicitação não é válida.' } };
    }

    const requestRow = repository.getRequestForRequester(requestId, userId);
    if (!requestRow) {
      return { redirectTo, flash: { type: 'error', message: 'Ops, não encontrei essa solicitação.' } };
    }

    if (requestRow.status === 'settled') {
      return { redirectTo, flash: { type: 'info', message: 'Esse acerto já foi encerrado antes.' } };
    }

    if (requestRow.status !== 'accepted') {
      return { redirectTo, flash: { type: 'info', message: 'Só dá para encerrar solicitações já aceitas.' } };
    }

    if (!requestRow.payment_marked_at) {
      return { redirectTo, flash: { type: 'info', message: 'Esse acerto ainda não foi marcado como pago por quem recebeu.' } };
    }

    const actor = deps.getUserRecord(userId);
    const actorName = actor?.name || actor?.email || 'O remetente';
    const now = deps.nowIso();
    const requestKind = deps.normalizeSharedDebtRequestKind(requestRow.request_kind);
    const isManualRequest = requestKind === 'manual';
    const resolvedMessage = deps.resolveCatalogText(
      isManualRequest ? 'notification.shared_debt.payment_confirmed.manual' : 'notification.shared_debt.payment_confirmed.regular',
      {
        credor: actorName,
        valor: deps.formatBRLFromCents(requestRow.amount_cents),
        descricao: requestRow.description_snapshot,
        nota: note || ''
      },
      {
        fallbackTitle: isManualRequest ? 'Pagamento do lembrete confirmado' : 'Pagamento confirmado',
        fallbackBody: `${actorName} confirmou o recebimento ${isManualRequest ? 'do lembrete avulso' : 'da cobrança'} de ${deps.formatBRLFromCents(requestRow.amount_cents)} (${requestRow.description_snapshot}).${deps.buildNoteSuffix(note)}`
      }
    );

    repository.withTransaction(() => {
      repository.db.prepare(`
        UPDATE shared_debt_requests
        SET status = 'settled',
            amount_paid_cents = amount_cents,
            updated_at = ?,
            resolved_at = ?
        WHERE id = ? AND requester_user_id = ? AND status = 'accepted' AND payment_marked_at IS NOT NULL
      `).run(now, now, requestId, userId);

      deps.addSharedDebtEvent({ requestId, actorUserId: userId, eventType: 'settled', note });
      deps.touchSharedDebtBatch(requestRow.batch_id, now);
      deps.createNotification({
        userId: requestRow.receiver_user_id,
        type: 'shared_debt_request',
        title: resolvedMessage.title,
        body: resolvedMessage.body,
        href: `/shared-debts?request=${requestId}`,
        relatedType: 'shared_debt_request',
        relatedId: requestId,
        groupKey: 'shared_debt_payments'
      });
    });

    return { redirectTo, flash: { type: 'success', message: 'Pronto! Recebimento confirmado e acerto encerrado.' } };
  }

  function bulkMarkPaid({ userId, requestIds, note, redirectTo }) {
    if (!requestIds.length) {
      return { redirectTo, flash: { type: 'error', message: 'Nenhum acerto válido foi escolhido para marcar como pago.' } };
    }

    const rows = repository.getAcceptedRequestsForReceiver(requestIds, userId);
    if (!rows.length) {
      return { redirectTo, flash: { type: 'info', message: 'Não achei acertos desse grupo esperando marcação de pagamento.' } };
    }

    const actor = deps.getUserRecord(userId);
    const actorName = actor?.name || actor?.email || 'O destinatário';
    const now = deps.nowIso();

    repository.withTransaction(() => {
      rows.forEach((row) => {
        repository.db.prepare(`
          UPDATE shared_debt_requests
          SET payment_marked_at = ?, payment_note = ?, updated_at = ?
          WHERE id = ? AND receiver_user_id = ? AND status = 'accepted' AND payment_marked_at IS NULL
        `).run(now, note, now, row.id, userId);
        deps.addSharedDebtEvent({ requestId: row.id, actorUserId: userId, eventType: 'payment_marked_by_receiver', note });
      });

      groupSharedDebtRowsByBatch(rows).forEach((group) => {
        const periodLabel = deps.buildSharedDebtBulkPeriodLabel(group.rows);
        if (group.batchId) deps.touchSharedDebtBatch(group.batchId, now);

        const chargeCountLabel = deps.formatCountLabel(group.rows.length, 'cobrança', 'cobranças');
        const resolvedMessage = deps.resolveCatalogText('notification.shared_debt.payment_marked.bulk', {
          pagador: actorName,
          n_cobrancas: chargeCountLabel,
          periodo: periodLabel || '',
          valor_total: deps.formatBRLFromCents(group.totalCents),
          nota: note || ''
        }, {
          fallbackTitle: group.rows.length > 1 ? 'Pagamentos marcados como feitos' : 'Pagamento marcado como feito',
          fallbackBody: `${actorName} avisou o pagamento de ${chargeCountLabel}${periodLabel ? ` no período ${periodLabel}` : ''}, somando ${deps.formatBRLFromCents(group.totalCents)}.${deps.buildNoteSuffix(note)}`
        });
        const firstRow = group.rows[0];

        deps.createNotification({
          userId: firstRow.requester_user_id,
          type: group.batchId ? 'shared_debt_batch' : 'shared_debt_request',
          title: resolvedMessage.title,
          body: resolvedMessage.body,
          href: group.batchId ? `/shared-debts?batch=${group.batchId}` : `/shared-debts?request=${firstRow.id}`,
          relatedType: group.batchId ? 'shared_debt_batch' : 'shared_debt_request',
          relatedId: group.batchId || firstRow.id,
          groupKey: 'shared_debt_payments'
        });
      });
    });

    return {
      redirectTo,
      flash: { type: 'success', message: `Pronto! ${deps.formatCountLabel(rows.length, 'cobrança foi marcada como paga', 'cobranças foram marcadas como pagas')} de uma vez.` }
    };
  }

  function bulkConfirmReceipt({ userId, requestIds, note, redirectTo }) {
    if (!requestIds.length) {
      return { redirectTo, flash: { type: 'error', message: 'Nenhum acerto válido foi escolhido para confirmar o recebimento.' } };
    }

    const rows = repository.getAcceptedMarkedRequestsForRequester(requestIds, userId);
    if (!rows.length) {
      return { redirectTo, flash: { type: 'info', message: 'Não achei acertos desse grupo esperando confirmação de recebimento.' } };
    }

    const actor = deps.getUserRecord(userId);
    const actorName = actor?.name || actor?.email || 'O remetente';
    const now = deps.nowIso();

    repository.withTransaction(() => {
      rows.forEach((row) => {
        repository.db.prepare(`
          UPDATE shared_debt_requests
          SET status = 'settled', updated_at = ?, resolved_at = ?
          WHERE id = ? AND requester_user_id = ? AND status = 'accepted' AND payment_marked_at IS NOT NULL
        `).run(now, now, row.id, userId);
        deps.addSharedDebtEvent({ requestId: row.id, actorUserId: userId, eventType: 'settled', note });
      });

      groupSharedDebtRowsByBatch(rows).forEach((group) => {
        const periodLabel = deps.buildSharedDebtBulkPeriodLabel(group.rows);
        if (group.batchId) deps.touchSharedDebtBatch(group.batchId, now);

        const chargeCountLabel = deps.formatCountLabel(group.rows.length, 'cobrança', 'cobranças');
        const resolvedMessage = deps.resolveCatalogText('notification.shared_debt.payment_confirmed.bulk', {
          credor: actorName,
          n_cobrancas: chargeCountLabel,
          periodo: periodLabel || '',
          valor_total: deps.formatBRLFromCents(group.totalCents),
          nota: note || ''
        }, {
          fallbackTitle: group.rows.length > 1 ? 'Pagamentos confirmados' : 'Pagamento confirmado',
          fallbackBody: `${actorName} confirmou o recebimento de ${chargeCountLabel}${periodLabel ? ` no período ${periodLabel}` : ''}, somando ${deps.formatBRLFromCents(group.totalCents)}.${deps.buildNoteSuffix(note)}`
        });
        const firstRow = group.rows[0];

        deps.createNotification({
          userId: firstRow.receiver_user_id,
          type: group.batchId ? 'shared_debt_batch' : 'shared_debt_request',
          title: resolvedMessage.title,
          body: resolvedMessage.body,
          href: group.batchId ? `/shared-debts?batch=${group.batchId}` : `/shared-debts?request=${firstRow.id}`,
          relatedType: group.batchId ? 'shared_debt_batch' : 'shared_debt_request',
          relatedId: group.batchId || firstRow.id,
          groupKey: 'shared_debt_payments'
        });
      });
    });

    return {
      redirectTo,
      flash: { type: 'success', message: `Pronto! ${deps.formatCountLabel(rows.length, 'cobrança foi encerrada', 'cobranças foram encerradas')} de uma vez.` }
    };
  }

  return {
    archiveRequest,
    unarchiveRequest,
    archivePrivateReminder,
    unarchivePrivateReminder,
    bulkArchive,
    bulkUnarchive,
    sendDraftQueue,
    discardDraftQueue,
    createManual,
    settlePrivateReminder,
    respondToBatch,
    respondToRequest,
    senderAction,
    prepareMonthlySettlement,
    createMonthlySettlementPix,
    reportMonthlySettlementPayment,
    confirmMonthlySettlementPayment,
    rejectMonthlySettlementPayment,
    getRequestPix,
    markPaid,
    confirmReceipt,
    bulkMarkPaid,
    bulkConfirmReceipt
  };
}

module.exports = {
  createSharedDebtsService
};
