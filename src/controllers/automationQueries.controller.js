const { createAutomationQueriesService } = require('../services/automationQueries.service');

function createAutomationQueriesController(deps = {}) {
  const service = deps.queriesService || createAutomationQueriesService(deps);

  function sendResult(res, result) {
    const statusCode = Number(result?.statusCode || 200) || 200;
    const payload = { ...(result || {}) };
    delete payload.statusCode;
    return res.status(statusCode).json(payload);
  }

  function metaFromRequest(req) {
    return {
      ipAddress: String(req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '')
    };
  }

  return {
    monthSummary(req, res) {
      return sendResult(res, service.getMonthSummary(req.body || {}, metaFromRequest(req)));
    },

    cardSummary(req, res) {
      return sendResult(res, service.getCardSummary(req.body || {}, metaFromRequest(req)));
    },

    recentPurchases(req, res) {
      return sendResult(res, service.getRecentPurchases(req.body || {}, metaFromRequest(req)));
    },

    personSummary(req, res) {
      return sendResult(res, service.getPersonSummary(req.body || {}, metaFromRequest(req)));
    },

    debtSummary(req, res) {
      return sendResult(res, service.getDebtSummary(req.body || {}, metaFromRequest(req)));
    }
  };
}

module.exports = {
  createAutomationQueriesController
};
