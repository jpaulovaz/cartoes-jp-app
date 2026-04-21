const express = require('express');
const { createCardsController } = require('../controllers/cards.controller');

function createCardsRouter(deps = {}) {
  const router = express.Router();
  const controller = createCardsController(deps);

  router.get('/cards', deps.ensureAuthenticated, controller.renderCardsPage);
  router.post('/cards', deps.ensureAuthenticated, controller.saveCard);
  router.post('/cards/:id/update', deps.ensureAuthenticated, controller.updateCard);
  router.post('/cards/:id/toggle', deps.ensureAuthenticated, controller.toggleCard);
  router.post('/cards/:id/delete', deps.ensureAuthenticated, controller.deleteCard);

  return router;
}

module.exports = {
  createCardsRouter
};
