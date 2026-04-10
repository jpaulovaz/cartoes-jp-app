const { createFinancesService } = require('../services/finances.service');

function createFinancesController(deps = {}) {
  const service = deps.service || createFinancesService(deps);

  function renderJson(res, result) {
    return res.status(result.status || 200).json(result.body);
  }

  return {
    financeDetails(req, res) {
      return renderJson(res, service.financeDetails(req.user.id, req.params.id));
    },
    addRow(req, res) {
      return renderJson(res, service.addRow(req.user.id, req.body));
    },
    updateVariableFinance(req, res) {
      return renderJson(res, service.updateVariableFinance(req.user.id, req.params.id, req.body));
    },
    updateFixedFinance(req, res) {
      return renderJson(res, service.updateFixedFinance(req.user.id, req.params.id, req.body));
    },
    toggleFinancePayment(req, res) {
      return renderJson(res, service.toggleFinancePayment(req.user.id, req.params.id, req.body));
    },
    toggleFinanceItemPayment(req, res) {
      return renderJson(res, service.toggleFinanceItemPayment(req.user.id, req.params.id, req.body));
    },
    updateFinance(req, res) {
      return renderJson(res, service.updateFinance(req.user.id, req.params.id, req.body));
    },
    deleteFinance(req, res) {
      return renderJson(res, service.deleteFinance(req.user.id, req.params.id));
    },
    saveFinanceNotes(req, res) {
      return renderJson(res, service.saveFinanceNotes(req.user.id, req.params.year, req.params.month, req.body));
    },
    toggleMonthClose(req, res) {
      return renderJson(res, service.toggleMonthClose(req.user.id, req.body));
    }
  };
}

module.exports = {
  createFinancesController
};
