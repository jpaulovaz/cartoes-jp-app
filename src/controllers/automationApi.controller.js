const { createAutomationApiService } = require('../services/automationApi.service');

function createAutomationApiController(deps = {}) {
  const service = deps.service || createAutomationApiService(deps);

  function sendResult(res, result) {
    const statusCode = Number(result?.statusCode || 200) || 200;
    const payload = { ...(result || {}) };
    delete payload.statusCode;
    return res.status(statusCode).json(payload);
  }

  function metaFromRequest(req) {
    return {
      idempotencyKey: req.get('Idempotency-Key') || req.get('X-Idempotency-Key') || '',
      ipAddress: String(req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '')
    };
  }

  function authenticate(req, res, next) {
    const auth = service.verifyAutomationRequest(req);
    if (!auth.ok) {
      return res.status(auth.statusCode || 401).json({
        ok: false,
        code: auth.code || 'UNAUTHORIZED',
        message: auth.message || 'Requisição não autorizada.'
      });
    }
    return next();
  }

  return {
    authenticate,

    health(req, res) {
      return res.json({ ok: true, service: 'automation-api', version: 'v1' });
    },

    resolveWhatsapp(req, res) {
      return sendResult(res, service.resolveWhatsapp(req.body || {}, metaFromRequest(req)));
    },

    createPurchase(req, res) {
      return sendResult(res, service.createPurchaseFromAutomation(req.body || {}, metaFromRequest(req)));
    },

    listRecentPurchases(req, res) {
      return sendResult(res, service.listRecentPurchases(req.body || {}, metaFromRequest(req)));
    },

    preparePurchaseEdit(req, res) {
      return sendResult(res, service.preparePurchaseEdit({
        ...(req.body || {}),
        purchaseId: req.params.id,
        purchase_id: req.params.id
      }, metaFromRequest(req)));
    },

    confirmPurchaseEdit(req, res) {
      return sendResult(res, service.confirmPurchaseEdit({
        ...(req.body || {}),
        purchaseId: req.params.id,
        purchase_id: req.params.id
      }, metaFromRequest(req)));
    },

    preparePurchaseDelete(req, res) {
      return sendResult(res, service.preparePurchaseDelete({
        ...(req.body || {}),
        purchaseId: req.params.id,
        purchase_id: req.params.id
      }, metaFromRequest(req)));
    },

    confirmPurchaseDelete(req, res) {
      return sendResult(res, service.confirmPurchaseDelete({
        ...(req.body || {}),
        purchaseId: req.params.id,
        purchase_id: req.params.id
      }, metaFromRequest(req)));
    },

    reopenPurchaseParticipants(req, res) {
      return sendResult(res, service.reopenParticipantsForPurchase({
        ...(req.body || {}),
        purchaseId: req.params.id,
        purchase_id: req.params.id
      }, metaFromRequest(req)));
    },

    getSplitOptions(req, res) {
      return sendResult(res, service.getSplitOptionsForPurchase({
        ...(req.body || {}),
        ...(req.query || {}),
        purchaseId: req.params.id,
        purchase_id: req.params.id
      }, metaFromRequest(req)));
    },

    splitPurchase(req, res) {
      return sendResult(res, service.splitPurchaseFromAutomation({
        ...(req.body || {}),
        purchaseId: req.params.id,
        purchase_id: req.params.id
      }, metaFromRequest(req)));
    },

    conversationReply(req, res) {
      return sendResult(res, service.handleConversationReply(req.body || {}, metaFromRequest(req)));
    }
  };
}

module.exports = {
  createAutomationApiController
};
