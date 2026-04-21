const { createSummaryService } = require('../services/summary.service');

function createSummaryController(deps = {}) {
  const service = deps.service || createSummaryService(deps);
  const { safeRenderView, formatBRLFromCents, setFlash } = deps;

  function applyFlash(req, flash) {
    if (flash) setFlash(req, flash.type, flash.message);
  }

  function sendBadRequest(res, message, asJson = false) {
    if (asJson) {
      return res.status(400).json({ ok: false, error: message });
    }
    return res.status(400).send(message);
  }

  return {
    renderAnalyticsPage(req, res) {
      const result = service.getAnalyticsPage(req.user.id, req.params);
      if (result.badRequest) return sendBadRequest(res, result.badRequest);
      return safeRenderView(res, 'analytics', {
        ...result.viewModel,
        formatBRLFromCents
      });
    },

    renderSummaryPage(req, res) {
      const result = service.getSummaryPage(req.user.id, req.params);
      if (result.badRequest) return sendBadRequest(res, result.badRequest);
      return safeRenderView(res, 'summary', {
        ...result.viewModel,
        formatBRLFromCents
      });
    },

    confirmMerchantSuggestion(req, res) {
      const result = service.confirmMerchantSuggestion(req.user.id, req.params, req.body);
      if (result.badRequest) return sendBadRequest(res, result.badRequest);
      applyFlash(req, result.flash);
      return res.redirect(result.redirectTo);
    },

    dismissMerchantSuggestion(req, res) {
      const result = service.dismissMerchantSuggestion(req.user.id, req.params, req.body);
      if (result.badRequest) return sendBadRequest(res, result.badRequest);
      applyFlash(req, result.flash);
      return res.redirect(result.redirectTo);
    },

    pauseMerchantLearning(req, res) {
      const result = service.pauseMerchantLearning(req.user.id, req.params, req.body);
      if (result.badRequest) return sendBadRequest(res, result.badRequest);
      applyFlash(req, result.flash);
      return res.redirect(result.redirectTo);
    },

    resumeMerchantLearning(req, res) {
      const result = service.resumeMerchantLearning(req.user.id, req.params, req.body);
      if (result.badRequest) return sendBadRequest(res, result.badRequest);
      applyFlash(req, result.flash);
      return res.redirect(result.redirectTo);
    },

    saveCardStatements(req, res) {
      const result = service.saveCardStatements(req.user.id, req.params, req.body);
      if (result.badRequest) return sendBadRequest(res, result.badRequest);
      applyFlash(req, result.flash);
      return res.redirect(result.redirectTo);
    },

    saveCardStatementsAsync(req, res) {
      const result = service.saveCardStatementsAsync(req.user.id, req.params, req.body);
      if (result.badRequest) return sendBadRequest(res, result.badRequest, true);
      if (result.status && result.status !== 200) {
        return res.status(result.status).json(result.body);
      }
      return res.json(result.body);
    },

    savePersonPayments(req, res) {
      const result = service.savePersonPayments(req.user.id, req.params, req.body);
      if (result.badRequest) return sendBadRequest(res, result.badRequest);
      applyFlash(req, result.flash);
      return res.redirect(result.redirectTo);
    },

    savePersonPaymentsAsync(req, res) {
      const result = service.savePersonPaymentsAsync(req.user.id, req.params, req.body);
      if (result.badRequest) return sendBadRequest(res, result.badRequest, true);
      if (result.status && result.status !== 200) {
        return res.status(result.status).json(result.body);
      }
      return res.json(result.body);
    }
  };
}

module.exports = {
  createSummaryController
};
