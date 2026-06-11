const { createAutomationMonthlyFinancesService } = require('../services/automationMonthlyFinances.service');

function createAutomationMonthlyFinancesController(deps = {}) {
  const service = deps.monthlyFinancesService || createAutomationMonthlyFinancesService(deps);

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
    create(req, res) {
      return sendResult(res, service.createMonthlyFinance(req.body || {}, metaFromRequest(req)));
    },

    search(req, res) {
      return sendResult(res, service.searchMonthlyFinances(req.body || {}, metaFromRequest(req)));
    },

    markPaid(req, res) {
      return sendResult(res, service.markMonthlyFinancePaid({
        ...(req.body || {}),
        financeId: req.params.id,
        finance_id: req.params.id
      }, metaFromRequest(req), true));
    },

    markUnpaid(req, res) {
      return sendResult(res, service.markMonthlyFinanceUnpaid({
        ...(req.body || {}),
        financeId: req.params.id,
        finance_id: req.params.id
      }, metaFromRequest(req)));
    },

    update(req, res) {
      return sendResult(res, service.updateMonthlyFinance({
        ...(req.body || {}),
        financeId: req.params.id,
        finance_id: req.params.id
      }, metaFromRequest(req)));
    },

    delete(req, res) {
      return sendResult(res, service.deleteMonthlyFinance({
        ...(req.body || {}),
        financeId: req.params.id,
        finance_id: req.params.id
      }, metaFromRequest(req)));
    },

    conversationReply(req, res) {
      return sendResult(res, service.handleConversationReply(req.body || {}, metaFromRequest(req)));
    }
  };
}

module.exports = {
  createAutomationMonthlyFinancesController
};
