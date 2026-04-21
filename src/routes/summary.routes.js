const express = require('express');
const { createSummaryController } = require('../controllers/summary.controller');

function createSummaryRouter(deps = {}) {
  const router = express.Router();
  const controller = createSummaryController(deps);

  router.get('/analytics/:year/:month', deps.ensureAuthenticated, controller.renderAnalyticsPage);
  router.get('/summary/:year/:month', deps.ensureAuthenticated, controller.renderSummaryPage);
  router.post(['/summary/:year/:month/merchant-suggestions/confirm', '/analytics/:year/:month/merchant-suggestions/confirm'], deps.ensureAuthenticated, controller.confirmMerchantSuggestion);
  router.post(['/summary/:year/:month/merchant-suggestions/dismiss', '/analytics/:year/:month/merchant-suggestions/dismiss'], deps.ensureAuthenticated, controller.dismissMerchantSuggestion);
  router.post(['/summary/:year/:month/merchant-learning/pause', '/analytics/:year/:month/merchant-learning/pause'], deps.ensureAuthenticated, controller.pauseMerchantLearning);
  router.post(['/summary/:year/:month/merchant-learning/resume', '/analytics/:year/:month/merchant-learning/resume'], deps.ensureAuthenticated, controller.resumeMerchantLearning);
  router.post('/summary/:year/:month/cards', deps.ensureAuthenticated, controller.saveCardStatements);
  router.post('/summary/:year/:month/cards/async', deps.ensureAuthenticated, controller.saveCardStatementsAsync);
  router.post('/summary/:year/:month/people', deps.ensureAuthenticated, controller.savePersonPayments);
  router.post('/summary/:year/:month/people/async', deps.ensureAuthenticated, controller.savePersonPaymentsAsync);

  return router;
}

module.exports = {
  createSummaryRouter
};
