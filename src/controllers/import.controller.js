const { createImportService } = require('../services/import.service');

function createImportController(deps = {}) {
  const service = deps.service || createImportService(deps);
  const { safeRenderView, formatBRLFromCents, setFlash } = deps;

  return {
    renderImportPage(req, res) {
      const viewModel = service.getImportPage(req.user.id, {
        preview: req.session?.importPreview || null,
        formSeed: (req.session?.importPreview || null)?.formSeed || res.locals.importFormSeed || null,
        importReport: res.locals.importReport || null
      });

      return safeRenderView(res, 'import', {
        ...viewModel,
        formatBRLFromCents
      });
    },

    createImportPreview(req, res) {
      const cards = service.getCardsForUser(req.user.id);

      try {
        const result = service.createImportPreview(req.user.id, req.body, req.file, req);
        if (result.flash) setFlash(req, result.flash.type, result.flash.message);
        return res.redirect(result.redirectTo || '/import');
      } catch (error) {
        return res.status(400).render('import', {
          cards,
          error: error.message || String(error),
          formSeed: {
            cardId: Number(req.body.card_id) || null,
            month: Number(req.body.month) || null,
            year: Number(req.body.year) || null
          },
          importReport: null,
          importPreview: null,
          formatBRLFromCents
        });
      }
    },

    confirmImportPreview(req, res) {
      const result = service.confirmImportPreview(req.user.id, req.session?.importPreview || null, req.body, req);
      if (result.flash) setFlash(req, result.flash.type, result.flash.message);
      return res.redirect(result.redirectTo || '/import');
    },

    cancelImportPreview(req, res) {
      const result = service.cancelImportPreview(req.session?.importPreview || null, req.body, req);
      if (result.flash) setFlash(req, result.flash.type, result.flash.message);
      return res.redirect(result.redirectTo || '/import');
    }
  };
}

module.exports = {
  createImportController
};
