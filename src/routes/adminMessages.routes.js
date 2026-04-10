const express = require('express');
const { createAdminMessagesController } = require('../controllers/adminMessages.controller');

function createAdminMessagesRouter(deps = {}) {
  const router = express.Router();
  const controller = createAdminMessagesController(deps);

  router.get('/messages', deps.ensureAuthenticated, controller.renderMessagesPage);
  router.get('/messages/export.csv', deps.ensureAuthenticated, controller.exportCsv);
  router.post('/messages/import', deps.ensureAuthenticated, deps.upload.single('catalog_csv'), controller.importPreview);
  router.post('/messages/import/confirm', deps.ensureAuthenticated, controller.confirmImport);
  router.post('/messages/import/cancel', deps.ensureAuthenticated, controller.cancelImport);
  router.post('/messages/:messageKey', deps.ensureAuthenticated, controller.saveCustomization);
  router.post('/messages/:messageKey/reset', deps.ensureAuthenticated, controller.resetCustomization);
  router.post('/messages/:messageKey/preview', deps.ensureAuthenticated, controller.previewMessage);
  router.post('/messages/:messageKey/push-test', deps.ensureAuthenticated, controller.pushTest);

  return router;
}

module.exports = {
  createAdminMessagesRouter
};
