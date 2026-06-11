const { createAutomationIntelligenceService } = require('../services/automationIntelligence.service');

function createAutomationIntelligenceController(deps = {}) {
  const service = deps.intelligenceService || createAutomationIntelligenceService(deps);

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
    categoryOptions(req, res) {
      return sendResult(res, service.categoryOptions(req.body || {}, metaFromRequest(req)));
    },

    uncategorizedPurchases(req, res) {
      return sendResult(res, service.uncategorizedPurchases(req.body || {}, metaFromRequest(req)));
    },

    applyCategoryToPurchase(req, res) {
      return sendResult(res, service.applyCategoryToPurchase(req.body || {}, metaFromRequest(req)));
    },

    createMerchantRule(req, res) {
      return sendResult(res, service.createMerchantRule(req.body || {}, metaFromRequest(req)));
    },

    categoryConversationReply(req, res) {
      return sendResult(res, service.categoryConversationReply(req.body || {}, metaFromRequest(req)));
    },

    monthlyInsights(req, res) {
      return sendResult(res, service.monthlyInsights(req.body || {}, metaFromRequest(req)));
    },

    weeklyInsights(req, res) {
      return sendResult(res, service.weeklyInsights(req.body || {}, metaFromRequest(req)));
    },

    sendSummary(req, res) {
      return sendResult(res, service.sendSummary(req.body || {}, metaFromRequest(req)));
    },

    summaryPreferences(req, res) {
      return sendResult(res, service.summaryPreferences(req.body || {}, metaFromRequest(req)));
    },

    dueSummaries(req, res) {
      return sendResult(res, service.dueSummaries(req.body || {}, metaFromRequest(req)));
    },

    markSummarySent(req, res) {
      return sendResult(res, service.markSummarySent({ ...(req.body || {}), preference_id: req.params.id }, metaFromRequest(req)));
    }
  };
}

module.exports = {
  createAutomationIntelligenceController
};
