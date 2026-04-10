const { createAdminMessagesService } = require('../services/adminMessages.service');

function createAdminMessagesController(deps = {}) {
  const {
    renderAdminMessages,
    setFlash
  } = deps;

  const service = deps.service || createAdminMessagesService(deps);

  function renderForbidden(res, result) {
    if (result.body) {
      return res.status(result.status).json(result.body);
    }
    return res.status(result.status).send(result.text);
  }

  function applyFlash(req, flash) {
    if (flash) {
      setFlash(req, flash.type, flash.message);
    }
  }

  return {
    renderMessagesPage(req, res) {
      const forbidden = service.ensureAdmin(req.user.id);
      if (forbidden) {
        return renderForbidden(res, forbidden);
      }

      return renderAdminMessages(res, service.buildPageState(req.query, req));
    },

    exportCsv(req, res) {
      const forbidden = service.ensureAdmin(req.user.id);
      if (forbidden) {
        return res.status(403).send('Acesso negado.');
      }

      try {
        const exportFile = service.exportCsv();
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${exportFile.filename}"`);
        return res.send(exportFile.content);
      } catch (error) {
        return renderAdminMessages(res, {
          ...service.buildPageState(req.query, req),
          error: service.getFriendlyMessage(error, 'Não consegui montar o CSV do catálogo agora.')
        });
      }
    },

    importPreview(req, res) {
      const forbidden = service.ensureAdmin(req.user.id);
      if (forbidden) {
        return res.status(403).send('Acesso negado.');
      }

      try {
        const result = service.buildImportPreview(req, req.body, req.file);
        return renderAdminMessages(res, result);
      } catch (error) {
        return renderAdminMessages(res, {
          filters: deps.normalizeAdminMessageActionFilters(req.body),
          importPreview: null,
          error: service.getFriendlyMessage(error, 'Não consegui ler esse CSV agora.')
        });
      }
    },

    confirmImport(req, res) {
      const forbidden = service.ensureAdmin(req.user.id);
      if (forbidden) {
        return res.status(403).send('Acesso negado.');
      }

      try {
        const result = service.confirmImport(req, req.user.id, req.body);
        applyFlash(req, result.flash);
        return res.redirect(result.redirectTo);
      } catch (error) {
        return renderAdminMessages(res, {
          filters: deps.normalizeAdminMessageActionFilters(req.body),
          importPreview: deps.getAdminMessageImportPreview(req),
          error: service.getFriendlyMessage(error, 'Não consegui aplicar esse lote agora.')
        });
      }
    },

    cancelImport(req, res) {
      const forbidden = service.ensureAdmin(req.user.id);
      if (forbidden) {
        return res.status(403).send('Acesso negado.');
      }

      const result = service.cancelImport(req, req.body);
      applyFlash(req, result.flash);
      return res.redirect(result.redirectTo);
    },

    saveCustomization(req, res) {
      const forbidden = service.ensureAdmin(req.user.id);
      if (forbidden) {
        return res.status(403).send('Acesso negado.');
      }

      const messageKey = String(req.params.messageKey || '').trim();
      try {
        const result = service.saveCustomization(req.user.id, messageKey, req.body);
        deps.clearAdminMessageImportPreview(req);
        applyFlash(req, result.flash);
        return res.redirect(result.redirectTo);
      } catch (error) {
        const validationMessage = Array.isArray(error?.validationErrors) && error.validationErrors.length
          ? error.validationErrors.map((item) => item.message).join(' ')
          : service.getFriendlyMessage(error, 'Não consegui salvar essa mensagem agora.');

        return renderAdminMessages(res, {
          error: validationMessage,
          filters: deps.normalizeAdminMessageActionFilters(req.body),
          openMessageKey: messageKey,
          importPreview: deps.getAdminMessageImportPreview(req),
          draftByMessageKey: {
            [messageKey]: {
              custom_title: req.body.custom_title,
              custom_body: req.body.custom_body
            }
          }
        });
      }
    },

    resetCustomization(req, res) {
      const forbidden = service.ensureAdmin(req.user.id);
      if (forbidden) {
        return res.status(403).send('Acesso negado.');
      }

      const messageKey = String(req.params.messageKey || '').trim();
      try {
        const result = service.resetCustomization(req.user.id, messageKey, req.body);
        deps.clearAdminMessageImportPreview(req);
        applyFlash(req, result.flash);
        return res.redirect(result.redirectTo);
      } catch (error) {
        return renderAdminMessages(res, {
          error: service.getFriendlyMessage(error, 'Não consegui restaurar essa mensagem agora.'),
          filters: deps.normalizeAdminMessageActionFilters(req.body),
          openMessageKey: messageKey,
          importPreview: deps.getAdminMessageImportPreview(req)
        });
      }
    },

    previewMessage(req, res) {
      const forbidden = service.ensureAdmin(req.user.id, { json: true });
      if (forbidden) {
        return renderForbidden(res, forbidden);
      }

      const messageKey = String(req.params.messageKey || '').trim();
      try {
        const result = service.previewMessage(messageKey, req.body);
        return res.status(result.status).json(result.body);
      } catch (error) {
        return res.status(error?.status || 500).json({
          ok: false,
          message: service.getFriendlyMessage(error, 'Não consegui montar a prévia agora.')
        });
      }
    },

    async pushTest(req, res) {
      const forbidden = service.ensureAdmin(req.user.id, { json: true });
      if (forbidden) {
        return renderForbidden(res, forbidden);
      }

      const messageKey = String(req.params.messageKey || '').trim();
      const result = await service.pushTest(req.user.id, messageKey, req.body);
      return res.status(result.status).json(result.body);
    }
  };
}

module.exports = {
  createAdminMessagesController
};
