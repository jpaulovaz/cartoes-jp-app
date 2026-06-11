const { createAutomationOperationsService } = require('../services/automationOperations.service');

function createAutomationOperationsController(deps = {}) {
  const service = deps.service || createAutomationOperationsService(deps);
  const renderAutomationAdmin = deps.renderAutomationAdmin;

  function renderForbidden(res, result) {
    return res.status(result.status || 403).send(result.text || 'Acesso negado.');
  }

  function renderState(req, res, result) {
    if (result?.forbidden) return renderForbidden(res, result.forbidden);
    return renderAutomationAdmin(res, result?.state || {});
  }

  return {
    dashboard(req, res) {
      return renderState(req, res, service.buildPageState(req.user.id, req.query || {}));
    },

    updateWorkflow(req, res) {
      return renderState(req, res, service.updateWorkflow(req.user.id, req.params.key, req.body || {}));
    },

    updateUserPreferences(req, res) {
      return renderState(req, res, service.updateUserPreferences(req.user.id, req.params.userId, req.body || {}));
    },

    rotateToken(req, res) {
      return renderState(req, res, service.rotateToken(req.user.id, req.body || {}));
    },

    pruneLogs(req, res) {
      return renderState(req, res, service.pruneLogs(req.user.id, req.body || {}));
    }
  };
}

module.exports = {
  createAutomationOperationsController
};
