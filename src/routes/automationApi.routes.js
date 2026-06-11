const express = require('express');
const { createAutomationApiController } = require('../controllers/automationApi.controller');
const { createAutomationQueriesController } = require('../controllers/automationQueries.controller');
const { createAutomationRemindersController } = require('../controllers/automationReminders.controller');
const { createAutomationSharedDebtsController } = require('../controllers/automationSharedDebts.controller');
const { createAutomationMonthlyFinancesController } = require('../controllers/automationMonthlyFinances.controller');
const { createAutomationMonthCloseController } = require('../controllers/automationMonthClose.controller');
const { createAutomationPdfImportsController } = require('../controllers/automationPdfImports.controller');
const { createAutomationIntelligenceController } = require('../controllers/automationIntelligence.controller');
const { createAutomationReceiptPurchasesController } = require('../controllers/automationReceiptPurchases.controller');

function createAutomationApiRouter(deps = {}) {
  const router = express.Router();
  const controller = createAutomationApiController(deps);
  const queriesController = createAutomationQueriesController(deps);
  const remindersController = createAutomationRemindersController(deps);
  const sharedDebtsController = createAutomationSharedDebtsController(deps);
  const monthlyFinancesController = createAutomationMonthlyFinancesController(deps);
  const monthCloseController = createAutomationMonthCloseController(deps);
  const pdfImportsController = createAutomationPdfImportsController(deps);
  const intelligenceController = createAutomationIntelligenceController(deps);
  const receiptPurchasesController = createAutomationReceiptPurchasesController(deps);

  router.use(controller.observeRequest);
  router.use(controller.authenticate);
  router.use(controller.enforceUserPreferences);
  router.get('/health', controller.health);
  router.post('/whatsapp/resolve', controller.resolveWhatsapp);
  router.post('/router/context', controller.routerContext);
  router.post('/router/capabilities', controller.routerCapabilities);
  router.post('/router/intent-log', controller.routerIntentLog);
  router.post('/purchases', controller.createPurchase);
  router.post('/purchases/receipt-image/prepare', receiptPurchasesController.prepare);
  router.post('/purchases/receipt-image/conversations/reply', receiptPurchasesController.conversationReply);
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


  router.post('/month-close/readiness', monthCloseController.readiness);
  router.post('/month-close/prepare-close', monthCloseController.prepareClose);
  router.post('/month-close/confirm-close', monthCloseController.confirmClose);
  router.post('/month-close/prepare-reopen', monthCloseController.prepareReopen);
  router.post('/month-close/confirm-reopen', monthCloseController.confirmReopen);
  router.post('/month-close/conversations/reply', monthCloseController.conversationReply);


  router.post('/imports/pdf/jobs', pdfImportsController.createPdfJob);
  router.post('/imports/pdf/jobs/list', pdfImportsController.listJobs);
  router.post('/imports/pdf/jobs/:id/status', pdfImportsController.jobStatus);
  router.post('/imports/pdf/jobs/:id/cancel', pdfImportsController.cancelJob);
  router.post('/imports/pdf/conversations/reply', pdfImportsController.conversationReply);


  router.post('/categories/options', intelligenceController.categoryOptions);
  router.post('/categories/uncategorized', intelligenceController.uncategorizedPurchases);
  router.post('/categories/apply-to-purchase', intelligenceController.applyCategoryToPurchase);
  router.post('/categories/create-merchant-rule', intelligenceController.createMerchantRule);
  router.post('/categories/conversations/reply', intelligenceController.categoryConversationReply);
  router.post('/insights/monthly', intelligenceController.monthlyInsights);
  router.post('/insights/weekly', intelligenceController.weeklyInsights);
  router.post('/insights/send-summary', intelligenceController.sendSummary);
  router.post('/insights/preferences', intelligenceController.summaryPreferences);
  router.post('/insights/due-summaries', intelligenceController.dueSummaries);
  router.post('/insights/preferences/:id/mark-sent', intelligenceController.markSummarySent);

  return router;
}

module.exports = {
  createAutomationApiRouter
};
