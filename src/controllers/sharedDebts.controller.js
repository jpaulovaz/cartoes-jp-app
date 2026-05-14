const { createSharedDebtsService } = require('../services/sharedDebts.service');

function createSharedDebtsController(deps = {}) {
  const service = deps.service || createSharedDebtsService(deps);
  const { setFlash, redirectBackOr, renderSharedDebtsPage } = deps;

  function applyFlash(req, flash) {
    if (flash) setFlash(req, flash.type, flash.message);
  }

  function redirectWithResult(req, res, result, fallback = '/shared-debts') {
    applyFlash(req, result.flash);
    return res.redirect(result.redirectTo || fallback);
  }

  function getReturnTarget(req, fallback = '/shared-debts') {
    const explicitTarget = req.body?.return_to || req.body?.returnTo || null;
    if (explicitTarget && typeof deps.resolveSharedDebtViewPath === 'function') {
      return deps.resolveSharedDebtViewPath(explicitTarget, fallback);
    }
    return redirectBackOr(req, fallback);
  }

  return {
    activePage(req, res) {
      return renderSharedDebtsPage(req, res, { archiveMode: false });
    },

    archivePage(req, res) {
      return renderSharedDebtsPage(req, res, { archiveMode: true });
    },

    archiveRequest(req, res) {
      const result = service.archiveRequest({
        userId: req.user.id,
        requestId: Number(req.params.id),
        returnTo: req.body.return_to,
        fallback: getReturnTarget(req, '/shared-debts')
      });
      return redirectWithResult(req, res, result);
    },

    unarchiveRequest(req, res) {
      const result = service.unarchiveRequest({
        userId: req.user.id,
        requestId: Number(req.params.id),
        returnTo: req.body.return_to,
        fallback: redirectBackOr(req, '/shared-debts/archive')
      });
      return redirectWithResult(req, res, result);
    },

    archivePrivateReminder(req, res) {
      const result = service.archivePrivateReminder({
        userId: req.user.id,
        reminderId: Number(req.params.id || 0),
        returnTo: req.body.return_to,
        fallback: getReturnTarget(req, '/shared-debts')
      });
      return redirectWithResult(req, res, result);
    },

    unarchivePrivateReminder(req, res) {
      const result = service.unarchivePrivateReminder({
        userId: req.user.id,
        reminderId: Number(req.params.id || 0),
        returnTo: req.body.return_to,
        fallback: redirectBackOr(req, '/shared-debts/archive')
      });
      return redirectWithResult(req, res, result);
    },

    bulkArchive(req, res) {
      const result = service.bulkArchive({
        userId: req.user.id,
        requestIds: deps.parseSharedDebtRequestIds(req.body.request_ids || req.body.requestIds || req.body.request_id),
        returnTo: req.body.return_to,
        fallback: getReturnTarget(req, '/shared-debts')
      });
      return redirectWithResult(req, res, result);
    },

    bulkUnarchive(req, res) {
      const result = service.bulkUnarchive({
        userId: req.user.id,
        requestIds: deps.parseSharedDebtRequestIds(req.body.request_ids || req.body.requestIds || req.body.request_id),
        returnTo: req.body.return_to,
        fallback: redirectBackOr(req, '/shared-debts/archive')
      });
      return redirectWithResult(req, res, result);
    },

    sendDraftQueue(req, res) {
      const returnTarget = getReturnTarget(req, '/shared-debts#draft-queues');
      try {
        const result = service.sendDraftQueue(req.user.id, Number(req.params.id));
        result.redirectTo = returnTarget || result.redirectTo;
        return redirectWithResult(req, res, result);
      } catch (error) {
        setFlash(req, 'error', error.message || 'Não consegui disparar esse rascunho agora.');
        return res.redirect(returnTarget || '/shared-debts#draft-queues');
      }
    },

    discardDraftQueue(req, res) {
      const result = service.discardDraftQueue(req.user.id, Number(req.params.id));
      result.redirectTo = getReturnTarget(req, result.redirectTo || '/shared-debts#draft-queues');
      return redirectWithResult(req, res, result);
    },

    bulkSendDraftQueues(req, res) {
      const result = service.sendDraftQueues({
        userId: req.user.id,
        queueIds: deps.parseSharedDebtRequestIds(req.body.queue_ids || req.body.queueIds || req.body.queue_id),
        returnTo: req.body.return_to,
        fallback: redirectBackOr(req, '/shared-debts#draft-queues')
      });
      return redirectWithResult(req, res, result);
    },

    createManual(req, res) {
      const result = service.createManual({ userId: req.user.id, body: req.body });
      return redirectWithResult(req, res, result);
    },

    settlePrivateReminder(req, res) {
      const result = service.settlePrivateReminder({
        userId: req.user.id,
        reminderId: Number(req.params.id || 0),
        note: deps.sanitizePrivateDebtNote(req.body.note || '', 400),
        paymentDate: deps.normalizePrivateDebtPaymentDate(req.body.payment_date || req.body.paymentDate || null)
      });
      return redirectWithResult(req, res, result);
    },

    respondToBatch(req, res) {
      const batchId = Number(req.params.id);
      const fallbackRedirect = batchId ? `/shared-debts?batch=${batchId}` : '/shared-debts';
      const result = service.respondToBatch({
        userId: req.user.id,
        batchId,
        action: String(req.body.action || '').trim().toLowerCase(),
        note: String(req.body.note || '').trim() || null,
        redirectTo: getReturnTarget(req, fallbackRedirect)
      });
      return redirectWithResult(req, res, result);
    },

    respondToRequest(req, res) {
      const requestId = Number(req.params.id);
      const fallbackRedirect = requestId ? `/shared-debts?request=${requestId}` : '/shared-debts';
      const result = service.respondToRequest({
        userId: req.user.id,
        requestId,
        action: String(req.body.action || '').trim().toLowerCase(),
        note: String(req.body.note || '').trim() || null,
        redirectTo: getReturnTarget(req, fallbackRedirect)
      });
      return redirectWithResult(req, res, result);
    },

    senderAction(req, res) {
      const requestId = Number(req.params.id);
      const fallbackRedirect = requestId ? `/shared-debts?request=${requestId}` : '/shared-debts';
      const result = service.senderAction({
        userId: req.user.id,
        requestId,
        action: String(req.body.action || '').trim().toLowerCase(),
        note: String(req.body.note || '').trim() || null,
        redirectTo: getReturnTarget(req, fallbackRedirect)
      });
      return redirectWithResult(req, res, result);
    },

    prepareMonthlySettlement(req, res) {
      const result = service.prepareMonthlySettlement({
        userId: req.user.id,
        settlementId: Number(req.params.id)
      });
      return res.status(result.status).json(result.body);
    },

    async createMonthlySettlementPix(req, res) {
      try {
        const result = await service.createMonthlySettlementPix({
          userId: req.user.id,
          settlementId: Number(req.params.id),
          rawAmount: req.body.amount_cents ?? req.body.amount ?? req.body.amountCents
        });
        return res.status(result.status).json(result.body);
      } catch (error) {
        return res.status(500).json({ ok: false, message: error?.message || 'O Pix do mês quase saiu, mas ainda tropeçou num detalhe aqui.' });
      }
    },

    reportMonthlySettlementPayment(req, res) {
      try {
        const result = service.reportMonthlySettlementPayment({
          userId: req.user.id,
          settlementId: Number(req.params.id),
          intentId: Number(req.body.intent_id || req.body.intentId || 0),
          note: String(req.body.note || '').trim() || null
        });
        return res.status(result.status).json(result.body);
      } catch (error) {
        return res.status(500).json({ ok: false, message: error?.message || 'Não consegui avisar esse Pix do mês agora.' });
      }
    },

    confirmMonthlySettlementPayment(req, res) {
      try {
        const result = service.confirmMonthlySettlementPayment({
          userId: req.user.id,
          settlementId: Number(req.params.id),
          intentId: Number(req.body.intent_id || req.body.intentId || 0),
          note: String(req.body.note || '').trim() || null
        });
        return redirectWithResult(req, res, result);
      } catch (error) {
        setFlash(req, 'error', error.message || 'Não consegui confirmar esse Pix do mês agora.');
        return res.redirect(Number(req.params.id) ? `/shared-debts?settlement=${Number(req.params.id)}` : '/shared-debts');
      }
    },

    rejectMonthlySettlementPayment(req, res) {
      try {
        const result = service.rejectMonthlySettlementPayment({
          userId: req.user.id,
          settlementId: Number(req.params.id),
          intentId: Number(req.body.intent_id || req.body.intentId || 0),
          note: String(req.body.note || '').trim() || null
        });
        return redirectWithResult(req, res, result);
      } catch (error) {
        setFlash(req, 'error', error.message || 'Não consegui devolver esse Pix do mês para revisão agora.');
        return res.redirect(Number(req.params.id) ? `/shared-debts?settlement=${Number(req.params.id)}` : '/shared-debts');
      }
    },

    async getRequestPix(req, res) {
      try {
        const result = await service.getRequestPix({
          userId: req.user.id,
          requestId: Number(req.params.id)
        });
        return res.status(result.status).json(result.body);
      } catch (error) {
        return res.status(500).json({ ok: false, message: error?.message || 'O Pix quase saiu, mas ainda tropeçou num detalhe aqui.' });
      }
    },

    markPaid(req, res) {
      const requestId = Number(req.params.id);
      const fallbackRedirect = requestId ? `/shared-debts?request=${requestId}` : '/shared-debts';
      const result = service.markPaid({
        userId: req.user.id,
        requestId,
        note: String(req.body.note || '').trim() || null,
        redirectTo: getReturnTarget(req, fallbackRedirect)
      });
      return redirectWithResult(req, res, result);
    },

    confirmReceipt(req, res) {
      const requestId = Number(req.params.id);
      const fallbackRedirect = requestId ? `/shared-debts?request=${requestId}` : '/shared-debts';
      const result = service.confirmReceipt({
        userId: req.user.id,
        requestId,
        note: String(req.body.note || '').trim() || null,
        redirectTo: getReturnTarget(req, fallbackRedirect)
      });
      return redirectWithResult(req, res, result);
    },

    bulkRespond(req, res) {
      const result = service.bulkRespondToRequests({
        userId: req.user.id,
        requestIds: deps.parseSharedDebtRequestIds(req.body.request_ids || req.body.requestIds || req.body.request_id),
        action: String(req.body.action || '').trim().toLowerCase(),
        note: String(req.body.note || '').trim() || null,
        redirectTo: getReturnTarget(req, '/shared-debts#received-inbox')
      });
      return redirectWithResult(req, res, result);
    },

    bulkMarkPaid(req, res) {
      const result = service.bulkMarkPaid({
        userId: req.user.id,
        requestIds: deps.parseSharedDebtRequestIds(req.body.request_ids || req.body.requestIds || req.body.request_id),
        note: String(req.body.note || '').trim() || null,
        redirectTo: getReturnTarget(req, '/shared-debts')
      });
      return redirectWithResult(req, res, result);
    },

    bulkSenderAction(req, res) {
      const result = service.bulkSenderAction({
        userId: req.user.id,
        requestIds: deps.parseSharedDebtRequestIds(req.body.request_ids || req.body.requestIds || req.body.request_id),
        action: String(req.body.action || '').trim().toLowerCase(),
        note: String(req.body.note || '').trim() || null,
        redirectTo: getReturnTarget(req, '/shared-debts')
      });
      return redirectWithResult(req, res, result);
    },

    bulkConfirmReceipt(req, res) {
      const result = service.bulkConfirmReceipt({
        userId: req.user.id,
        requestIds: deps.parseSharedDebtRequestIds(req.body.request_ids || req.body.requestIds || req.body.request_id),
        note: String(req.body.note || '').trim() || null,
        redirectTo: getReturnTarget(req, '/shared-debts')
      });
      return redirectWithResult(req, res, result);
    },

    bulkConfirmOutsideApp(req, res) {
      const result = service.bulkConfirmOutsideApp({
        userId: req.user.id,
        requestIds: deps.parseSharedDebtRequestIds(req.body.request_ids || req.body.requestIds || req.body.request_id),
        note: String(req.body.note || '').trim() || null,
        amountMode: String(req.body.amount_mode || req.body.mode || 'full').trim().toLowerCase(),
        rawAmount: req.body.amount_cents ?? req.body.amount ?? req.body.amountCents,
        returnTo: req.body.return_to,
        fallback: getReturnTarget(req, '/shared-debts')
      });
      return redirectWithResult(req, res, result);
    }
  };
}

module.exports = {
  createSharedDebtsController
};
