const { createImportService } = require('../services/import.service');

function createImportController(deps = {}) {
  const service = deps.service || createImportService(deps);
  const { safeRenderView, formatBRLFromCents, setFlash } = deps;

  function buildErrorViewModel(req, extra = {}) {
    return {
      cards: service.getCardsForUser(req.user.id),
      error: extra.error || null,
      formSeed: extra.formSeed || null,
      importReport: null,
      importPreview: req.session?.importPreview || null,
      importPdfFeature: service.getImportPage(req.user.id, {
        preview: req.session?.importPreview || null,
        formSeed: extra.formSeed || null,
        importReport: null
      }).importPdfFeature,
      importPdfJobs: service.getImportPage(req.user.id, {
        preview: req.session?.importPreview || null,
        formSeed: extra.formSeed || null,
        importReport: null
      }).importPdfJobs,
      formatBRLFromCents
    };
  }

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
      try {
        const result = service.createImportPreview(req.user.id, req.body, req.file, req);
        if (result.flash) setFlash(req, result.flash.type, result.flash.message);
        return res.redirect(result.redirectTo || '/import');
      } catch (error) {
        return res.status(400).render('import', buildErrorViewModel(req, {
          error: error.message || String(error),
          formSeed: {
            cardId: Number(req.body.card_id) || null,
            month: Number(req.body.month) || null,
            year: Number(req.body.year) || null
          }
        }));
      }
    },

    createPdfImportJob(req, res) {
      try {
        const files = Array.isArray(req.files) ? req.files : (req.file ? [req.file] : []);
        const result = service.createPdfImportJob(req.user.id, req.body, files);
        if (result.flash) setFlash(req, result.flash.type, result.flash.message);
        return res.redirect(result.redirectTo || '/import');
      } catch (error) {
        return res.status(400).render('import', buildErrorViewModel(req, {
          error: error.message || String(error),
          formSeed: {
            cardId: Number(req.body.card_id) || null,
            month: Number(req.body.month) || null,
            year: Number(req.body.year) || null
          }
        }));
      }
    },

    openPdfImportReview(req, res) {
      const result = service.openPdfImportReview(req.user.id, Number(req.params.jobId || 0), req);
      if (result.flash) setFlash(req, result.flash.type, result.flash.message);
      return res.redirect(result.redirectTo || '/import');
    },

    downloadPdfImportCsv(req, res) {
      try {
        const result = service.getPdfImportCsvDownload(req.user.id, Number(req.params.jobId || 0));
        return res.download(result.downloadPath, result.filename);
      } catch (error) {
        setFlash(req, 'error', error.message || 'Nao consegui liberar o CSV agora.');
        return res.redirect('/import');
      }
    },

    retryPdfImportJob(req, res) {
      const result = service.retryPdfImportJob(req.user.id, Number(req.params.jobId || 0));
      if (result.flash) setFlash(req, result.flash.type, result.flash.message);
      return res.redirect(result.redirectTo || '/import');
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
