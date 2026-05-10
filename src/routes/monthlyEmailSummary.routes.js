const express = require('express');
const { createMonthlyEmailSummaryController } = require('../controllers/monthlyEmailSummary.controller');

function createMonthlyEmailSummaryRouter(deps = {}) {
  const router = express.Router();
  const controller = createMonthlyEmailSummaryController(deps);

  router.post('/monthly-summary-email/:year/:month/send', deps.ensureAuthenticated, controller.send);

  return router;
}

module.exports = {
  createMonthlyEmailSummaryRouter
};
