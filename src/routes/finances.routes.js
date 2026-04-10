const express = require('express');
const { createFinancesController } = require('../controllers/finances.controller');

function createFinancesRouter(deps = {}) {
  const router = express.Router();
  const controller = createFinancesController(deps);
  const json = express.json();

  router.get('/finances/details/:id', deps.ensureAuthenticated, controller.financeDetails);
  router.post('/finances/add-row', deps.ensureAuthenticated, json, controller.addRow);
  router.post('/finances/variable/:id', deps.ensureAuthenticated, json, controller.updateVariableFinance);
  router.post('/finances/fixed/:id', deps.ensureAuthenticated, json, controller.updateFixedFinance);
  router.post('/finances/payment-toggle/:id', deps.ensureAuthenticated, json, controller.toggleFinancePayment);
  router.post('/finance-items/payment-toggle/:id', deps.ensureAuthenticated, json, controller.toggleFinanceItemPayment);
  router.post('/finances/update/:id', deps.ensureAuthenticated, json, controller.updateFinance);
  router.post('/finances/delete/:id', deps.ensureAuthenticated, controller.deleteFinance);
  router.post('/finances/notes/:year/:month', deps.ensureAuthenticated, json, controller.saveFinanceNotes);
  router.post('/finances/toggle-close', deps.ensureAuthenticated, json, controller.toggleMonthClose);

  return router;
}

module.exports = {
  createFinancesRouter
};
