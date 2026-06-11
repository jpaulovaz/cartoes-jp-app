const { createAutomationSharedDebtsService } = require('../services/automationSharedDebts.service');

function createAutomationSharedDebtsController(deps = {}) {
  const service = deps.sharedDebtsAutomationService || createAutomationSharedDebtsService(deps);

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

  return {
    summary(req, res) {
      return sendResult(res, service.getSummary(req.body || {}, metaFromRequest(req)));
    },

    drafts(req, res) {
      return sendResult(res, service.listDraftQueues(req.body || {}, metaFromRequest(req)));
    },

    requests(req, res) {
      return sendResult(res, service.getRequests(req.body || {}, metaFromRequest(req)));
    },

    prepareDraftSend(req, res) {
      return sendResult(res, service.prepareDraftSend({
        ...(req.body || {}),
        queueId: req.params.queueId,
        queue_id: req.params.queueId
      }, metaFromRequest(req)));
    },

    confirmDraftSend(req, res) {
      return sendResult(res, service.confirmDraftSend({
        ...(req.body || {}),
        queueId: req.params.queueId,
        queue_id: req.params.queueId
      }, metaFromRequest(req)));
    },

    respondRequest(req, res) {
      return sendResult(res, service.respondRequest({
        ...(req.body || {}),
        requestId: req.params.id,
        request_id: req.params.id
      }, metaFromRequest(req)));
    },

    markPaid(req, res) {
      return sendResult(res, service.markPaid({
        ...(req.body || {}),
        requestId: req.params.id,
        request_id: req.params.id
      }, metaFromRequest(req)));
    },

    confirmReceived(req, res) {
      return sendResult(res, service.confirmReceived({
        ...(req.body || {}),
        requestId: req.params.id,
        request_id: req.params.id
      }, metaFromRequest(req)));
    },

    prepareSettlementPix(req, res) {
      return sendResult(res, service.prepareSettlementPix({
        ...(req.body || {}),
        settlementId: req.params.id,
        settlement_id: req.params.id
      }, metaFromRequest(req)));
    },

    createSettlementPix(req, res) {
      return sendResult(res, service.createSettlementPix({
        ...(req.body || {}),
        settlementId: req.params.id,
        settlement_id: req.params.id
      }, metaFromRequest(req)));
    },

    conversationReply(req, res) {
      return sendResult(res, service.handleConversationReply(req.body || {}, metaFromRequest(req)));
    }
  };
}

module.exports = {
  createAutomationSharedDebtsController
};
