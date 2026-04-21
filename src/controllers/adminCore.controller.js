const { createAdminCoreService } = require('../services/adminCore.service');

function createAdminCoreController(deps = {}) {
  const { renderAdmin } = deps;
  const service = deps.service || createAdminCoreService(deps);

  function renderForbidden(res, result) {
    if (result.body) {
      return res.status(result.status).json(result.body);
    }
    return res.status(result.status).send(result.text);
  }

  function renderAdminState(res, state) {
    return renderAdmin(res, state || {});
  }

  return {
    renderAdminPage(req, res) {
      const result = service.renderAdminPage(req.user.id);
      if (result.forbidden) return renderForbidden(res, result.forbidden);
      return renderAdminState(res, result.state);
    },

    saveSettingsSection(req, res) {
      const result = service.saveSettingsSection(req.user.id, req.params.section, req.body);
      if (result.forbidden) return renderForbidden(res, result.forbidden);
      return renderAdminState(res, result.state);
    },

    async testEmailConnection(req, res) {
      const result = await service.testEmailConnection(req.user.id);
      if (result.forbidden) return renderForbidden(res, result.forbidden);
      return renderAdminState(res, result.state);
    },

    async sendTestEmail(req, res) {
      const result = await service.sendTestEmail({
        userId: req.user.id,
        body: req.body,
        req,
        currentUser: req.user
      });
      if (result.forbidden) return renderForbidden(res, result.forbidden);
      return renderAdminState(res, result.state);
    },

    downloadBackupGuide(req, res) {
      const result = service.downloadBackupGuide(req.user.id);
      if (result.forbidden) return renderForbidden(res, result.forbidden);
      if (result.downloadPath) {
        return res.download(result.downloadPath, result.filename);
      }
      return renderAdminState(res, result.state);
    },

    connectGoogleBackup(req, res) {
      const result = service.connectGoogleBackup(req.user.id, req);
      if (result.forbidden) return renderForbidden(res, result.forbidden);
      if (result.redirectTo) {
        return res.redirect(result.redirectTo);
      }
      return renderAdminState(res, result.state);
    },

    async handleGoogleBackupCallback(req, res) {
      const result = await service.handleGoogleBackupCallback(req.user.id, req);
      if (result.forbidden) return renderForbidden(res, result.forbidden);
      return renderAdminState(res, result.state);
    },

    disconnectGoogleBackup(req, res) {
      const result = service.disconnectGoogleBackup(req.user.id);
      if (result.forbidden) return renderForbidden(res, result.forbidden);
      return renderAdminState(res, result.state);
    },

    async runBackup(req, res) {
      const result = await service.runBackup(req.user.id);
      if (result.forbidden) return renderForbidden(res, result.forbidden);
      return renderAdminState(res, result.state);
    },

    async restoreBackup(req, res) {
      const uploadedPath = req.file?.path;
      const uploadedName = req.file?.originalname || 'backup.zip';
      const result = await service.restoreBackup({
        userId: req.user.id,
        uploadedPath,
        uploadedName
      });
      if (uploadedPath) {
        await service.cleanupUploadedBackup(uploadedPath);
      }
      if (result.forbidden) return renderForbidden(res, result.forbidden);
      return renderAdminState(res, result.state);
    },

    downloadBackupFile(req, res) {
      const result = service.downloadBackupFile(req.user.id, req.params.backupId, req.params.slot);
      if (result.forbidden) return renderForbidden(res, result.forbidden);
      if (result.downloadPath) {
        return res.download(result.downloadPath, result.filename);
      }
      return renderAdminState(res, result.state);
    }
  };
}

module.exports = {
  createAdminCoreController
};
