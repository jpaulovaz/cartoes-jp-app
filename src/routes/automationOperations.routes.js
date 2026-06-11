const express = require('express');
const { createAutomationOperationsController } = require('../controllers/automationOperations.controller');

function createAutomationOperationsRouter(deps = {}) {
  const router = express.Router();
  const controller = createAutomationOperationsController(deps);

  router.get('/automation', deps.ensureAuthenticated, controller.dashboard);
  router.post('/automation/workflows/:key/update', deps.ensureAuthenticated, controller.updateWorkflow);
  router.post('/automation/users/:userId/preferences', deps.ensureAuthenticated, controller.updateUserPreferences);
  router.post('/automation/tokens/rotate', deps.ensureAuthenticated, controller.rotateToken);
  router.post('/automation/logs/prune', deps.ensureAuthenticated, controller.pruneLogs);

  return router;
}

module.exports = {
  createAutomationOperationsRouter
};
