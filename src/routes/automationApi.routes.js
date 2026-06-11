const express = require('express');
const { createAutomationApiController } = require('../controllers/automationApi.controller');
const { createAutomationQueriesController } = require('../controllers/automationQueries.controller');

function createAutomationApiRouter(deps = {}) {
  const router = express.Router();
  const controller = createAutomationApiController(deps);
  const queriesController = createAutomationQueriesController(deps);

  router.use(controller.authenticate);
  router.get('/health', controller.health);
  router.post('/whatsapp/resolve', controller.resolveWhatsapp);
  router.post('/purchases', controller.createPurchase);
  router.post('/purchases/recent', controller.listRecentPurchases);
  router.post('/purchases/:id/prepare-edit', controller.preparePurchaseEdit);
  router.post('/purchases/:id/confirm-edit', controller.confirmPurchaseEdit);
  router.post('/purchases/:id/prepare-delete', controller.preparePurchaseDelete);
  router.post('/purchases/:id/confirm-delete', controller.confirmPurchaseDelete);
  router.post('/purchases/:id/participants/reopen', controller.reopenPurchaseParticipants);
  router.get('/purchases/:id/split-options', controller.getSplitOptions);
  router.post('/purchases/:id/split-options', controller.getSplitOptions);
  router.post('/purchases/:id/split', controller.splitPurchase);
  router.post('/conversations/reply', controller.conversationReply);

  router.post('/queries/month-summary', queriesController.monthSummary);
  router.post('/queries/card-summary', queriesController.cardSummary);
  router.post('/queries/recent-purchases', queriesController.recentPurchases);
  router.post('/queries/person-summary', queriesController.personSummary);
  router.post('/queries/debt-summary', queriesController.debtSummary);

  return router;
}

module.exports = {
  createAutomationApiRouter
};
