const express = require('express');
const { createAutomationApiController } = require('../controllers/automationApi.controller');
const { createAutomationQueriesController } = require('../controllers/automationQueries.controller');
const { createAutomationRemindersController } = require('../controllers/automationReminders.controller');
const { createAutomationSharedDebtsController } = require('../controllers/automationSharedDebts.controller');
const { createAutomationMonthlyFinancesController } = require('../controllers/automationMonthlyFinances.controller');

function createAutomationApiRouter(deps = {}) {
  const router = express.Router();
  const controller = createAutomationApiController(deps);
  const queriesController = createAutomationQueriesController(deps);
  const remindersController = createAutomationRemindersController(deps);
  const sharedDebtsController = createAutomationSharedDebtsController(deps);
  const monthlyFinancesController = createAutomationMonthlyFinancesController(deps);

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

  router.post('/reminders', remindersController.create);
  router.post('/reminders/search', remindersController.search);
  router.post('/reminders/due', remindersController.due);
  router.post('/reminders/:id/complete', remindersController.complete);
  router.post('/reminders/:id/cancel', remindersController.cancel);
  router.post('/reminders/:id/snooze', remindersController.snooze);
  router.post('/reminders/:id/mark-sent', remindersController.markSent);


  router.post('/shared-debts/summary', sharedDebtsController.summary);
  router.post('/shared-debts/drafts', sharedDebtsController.drafts);
  router.post('/shared-debts/requests', sharedDebtsController.requests);
  router.post('/shared-debts/drafts/:queueId/prepare-send', sharedDebtsController.prepareDraftSend);
  router.post('/shared-debts/drafts/:queueId/confirm-send', sharedDebtsController.confirmDraftSend);
  router.post('/shared-debts/requests/:id/respond', sharedDebtsController.respondRequest);
  router.post('/shared-debts/requests/:id/mark-paid', sharedDebtsController.markPaid);
  router.post('/shared-debts/requests/:id/confirm-received', sharedDebtsController.confirmReceived);
  router.post('/shared-debts/settlements/:id/pix/prepare', sharedDebtsController.prepareSettlementPix);
  router.post('/shared-debts/settlements/:id/pix/create', sharedDebtsController.createSettlementPix);
  router.post('/shared-debts/conversations/reply', sharedDebtsController.conversationReply);

  router.post('/monthly-finances', monthlyFinancesController.create);
  router.post('/monthly-finances/search', monthlyFinancesController.search);
  router.post('/monthly-finances/:id/mark-paid', monthlyFinancesController.markPaid);
  router.post('/monthly-finances/:id/mark-unpaid', monthlyFinancesController.markUnpaid);
  router.post('/monthly-finances/:id/update', monthlyFinancesController.update);
  router.post('/monthly-finances/:id/delete', monthlyFinancesController.delete);
  router.post('/monthly-finances/conversations/reply', monthlyFinancesController.conversationReply);

  return router;
}

module.exports = {
  createAutomationApiRouter
};
