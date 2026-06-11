const { createAutomationMonthCloseService } = require('../services/automationMonthClose.service');

function createAutomationMonthCloseController(deps = {}) {
  const service = deps.monthCloseAutomationService || createAutomationMonthCloseService(deps);

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
    readiness(req, res) {
      return sendResult(res, service.getReadiness(req.body || {}, metaFromRequest(req)));
    },

    prepareClose(req, res) {
      return sendResult(res, service.prepareClose(req.body || {}, metaFromRequest(req)));
    },

    confirmClose(req, res) {
      return sendResult(res, service.confirmClose(req.body || {}, metaFromRequest(req)));
    },

    prepareReopen(req, res) {
      return sendResult(res, service.prepareReopen(req.body || {}, metaFromRequest(req)));
    },

    confirmReopen(req, res) {
      return sendResult(res, service.confirmReopen(req.body || {}, metaFromRequest(req)));
    },

    conversationReply(req, res) {
      return sendResult(res, service.handleConversationReply(req.body || {}, metaFromRequest(req)));
    }
  };
}

module.exports = {
  createAutomationMonthCloseController
};
