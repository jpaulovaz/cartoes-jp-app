const express = require('express');
const { createSocialShareController } = require('../controllers/socialShare.controller');

function createSocialShareRouter(deps = {}) {
  const router = express.Router();
  const controller = createSocialShareController(deps);

  router.get('/share/:year/:month/:personId', deps.ensureAuthenticated, controller.renderSharePage);
  router.get('/whatsapp/:year/:month/:personId', deps.ensureAuthenticated, controller.renderWhatsappPage);
  router.post('/whatsapp/send-automation', deps.ensureAuthenticated, express.json({ limit: '25mb' }), controller.sendWhatsappAutomation);

  return router;
}

module.exports = {
  createSocialShareRouter
};
