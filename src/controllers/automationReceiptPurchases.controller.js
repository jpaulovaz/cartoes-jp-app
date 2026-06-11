const { createAutomationReceiptPurchasesService } = require('../services/automationReceiptPurchases.service');

function createAutomationReceiptPurchasesController(deps = {}) {
  const service = deps.receiptPurchasesService || createAutomationReceiptPurchasesService(deps);

  async function sendResult(res, result) {
    const resolved = await Promise.resolve(result);
    const statusCode = Number(resolved?.statusCode || 200) || 200;
    const payload = { ...(resolved || {}) };
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
    prepare(req, res) {
      return sendResult(res, service.prepareReceiptImagePurchase(req.body || {}, metaFromRequest(req)));
    },

    conversationReply(req, res) {
      return sendResult(res, service.handleConversationReply(req.body || {}, metaFromRequest(req)));
    }
  };
}

module.exports = {
  createAutomationReceiptPurchasesController
};
