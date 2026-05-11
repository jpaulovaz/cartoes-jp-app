const express = require('express');
const { createSharedDebtsController } = require('../controllers/sharedDebts.controller');

function createSharedDebtsRouter(deps = {}) {
  const router = express.Router();
  const controller = createSharedDebtsController(deps);

  router.get('/shared-debts', deps.ensureAuthenticated, controller.activePage);
  router.get('/shared-debts/archive', deps.ensureAuthenticated, controller.archivePage);

  router.post('/shared-debts/bulk/archive', deps.ensureAuthenticated, controller.bulkArchive);
  router.post('/shared-debts/bulk/unarchive', deps.ensureAuthenticated, controller.bulkUnarchive);
  router.post('/shared-debts/bulk/mark-paid', deps.ensureAuthenticated, controller.bulkMarkPaid);
  router.post('/shared-debts/bulk/sender-action', deps.ensureAuthenticated, controller.bulkSenderAction);
  router.post('/shared-debts/bulk/confirm-receipt', deps.ensureAuthenticated, controller.bulkConfirmReceipt);
  router.post('/shared-debts/bulk/confirm-outside-app', deps.ensureAuthenticated, controller.bulkConfirmOutsideApp);

  router.post('/shared-debts/draft-queues/bulk/send', deps.ensureAuthenticated, controller.bulkSendDraftQueues);
  router.post('/shared-debts/draft-queues/:id/send', deps.ensureAuthenticated, controller.sendDraftQueue);
  router.post('/shared-debts/draft-queues/:id/discard', deps.ensureAuthenticated, controller.discardDraftQueue);
  router.post('/shared-debts/manual', deps.ensureAuthenticated, controller.createManual);

  router.post('/shared-debts/private/:id/archive', deps.ensureAuthenticated, controller.archivePrivateReminder);
  router.post('/shared-debts/private/:id/unarchive', deps.ensureAuthenticated, controller.unarchivePrivateReminder);
  router.post('/shared-debts/private/:id/settle', deps.ensureAuthenticated, controller.settlePrivateReminder);

  router.post('/shared-debts/batches/:id/respond', deps.ensureAuthenticated, controller.respondToBatch);

  router.get('/shared-debts/monthly-settlements/:id/prepare', deps.ensureAuthenticated, controller.prepareMonthlySettlement);
  router.post('/shared-debts/monthly-settlements/:id/pix', deps.ensureAuthenticated, controller.createMonthlySettlementPix);
  router.post('/shared-debts/monthly-settlements/:id/report-payment', deps.ensureAuthenticated, controller.reportMonthlySettlementPayment);
  router.post('/shared-debts/monthly-settlements/:id/confirm-payment', deps.ensureAuthenticated, controller.confirmMonthlySettlementPayment);
  router.post('/shared-debts/monthly-settlements/:id/reject-payment', deps.ensureAuthenticated, controller.rejectMonthlySettlementPayment);

  router.post('/shared-debts/:id/archive', deps.ensureAuthenticated, controller.archiveRequest);
  router.post('/shared-debts/:id/unarchive', deps.ensureAuthenticated, controller.unarchiveRequest);
  router.post('/shared-debts/:id/respond', deps.ensureAuthenticated, controller.respondToRequest);
  router.post('/shared-debts/:id/sender-action', deps.ensureAuthenticated, controller.senderAction);
  router.get('/shared-debts/:id/pix', deps.ensureAuthenticated, controller.getRequestPix);
  router.post('/shared-debts/:id/mark-paid', deps.ensureAuthenticated, controller.markPaid);
  router.post('/shared-debts/:id/confirm-receipt', deps.ensureAuthenticated, controller.confirmReceipt);

  return router;
}

module.exports = {
  createSharedDebtsRouter
};
