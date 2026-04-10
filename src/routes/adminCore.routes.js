const express = require('express');
const { createAdminCoreController } = require('../controllers/adminCore.controller');

function createAdminCoreRouter(deps = {}) {
  const router = express.Router();
  const controller = createAdminCoreController(deps);

  router.get('/', deps.ensureAuthenticated, controller.renderAdminPage);
  router.post('/settings/:section', deps.ensureAuthenticated, controller.saveSettingsSection);
  router.post('/email/test-connection', deps.ensureAuthenticated, controller.testEmailConnection);
  router.post('/email/send-test', deps.ensureAuthenticated, controller.sendTestEmail);
  router.get('/backup/guide', deps.ensureAuthenticated, controller.downloadBackupGuide);
  router.get('/backup/google/connect', deps.ensureAuthenticated, controller.connectGoogleBackup);
  router.get('/backup/google/callback', deps.ensureAuthenticated, controller.handleGoogleBackupCallback);
  router.post('/backup/google/disconnect', deps.ensureAuthenticated, controller.disconnectGoogleBackup);
  router.post('/backup/run', deps.ensureAuthenticated, controller.runBackup);
  router.post('/backup/restore', deps.ensureAuthenticated, deps.backupRestoreUpload.single('backup_zip'), controller.restoreBackup);
  router.get('/backup/download/:backupId/:slot', deps.ensureAuthenticated, controller.downloadBackupFile);

  return router;
}

module.exports = {
  createAdminCoreRouter
};
