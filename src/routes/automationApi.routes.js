const express = require('express');
const { createAutomationApiController } = require('../controllers/automationApi.controller');

function createAutomationApiRouter(deps = {}) {
  const router = express.Router();
  const controller = createAutomationApiController(deps);

  router.use(controller.authenticate);
  router.get('/health', controller.health);
  router.post('/whatsapp/resolve', controller.resolveWhatsapp);
  router.post('/purchases', controller.createPurchase);
  router.get('/purchases/:id/split-options', controller.getSplitOptions);
  router.post('/purchases/:id/split-options', controller.getSplitOptions);
  router.post('/purchases/:id/split', controller.splitPurchase);
  router.post('/conversations/reply', controller.conversationReply);

  return router;
}

module.exports = {
  createAutomationApiRouter
};
