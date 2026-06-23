const { createImportService } = require('../services/import.service');

function createImportController(deps = {}) {
  const service = deps.service || createImportService(deps);
  const { safeRenderView, formatBRLFromCents, setFlash } = deps;

  function buildErrorViewModel(req, extra = {}) {
    const pageState = service.getImportPage(req.user.id, {
      preview: req.session?.importPreview || null,
      formSeed: extra.formSeed || null,
      importReport: null
    });

    return {
      cards: pageState.cards,
      error: extra.error || null,
      formSeed: extra.formSeed || null,
      importReport: null,
      importPreview: req.session?.importPreview || null,
      importPdfFeature: pageState.importPdfFeature,
      importPdfJobs: pageState.importPdfJobs,
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

    renderPdfJobsPanel(req, res) {
      const panel = service.getPdfJobsPanel(req.user.id);
      res.set('Cache-Control', 'no-store');
      return res.render('partials/import-pdf-jobs', panel);
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
      try {
        const result = service.retryPdfImportJob(req.user.id, Number(req.params.jobId || 0));
        if (result.flash) setFlash(req, result.flash.type, result.flash.message);
        return res.redirect(result.redirectTo || '/import');
      } catch (error) {
        setFlash(req, 'error', error.message || 'Nao consegui recolocar esse job na fila agora.');
        return res.redirect('/import');
      }
    },

    deletePdfImportJob(req, res) {
      const jobId = Number(req.params.jobId || 0);
      try {
        const result = service.deletePdfImportJob(req.user.id, jobId);
        if (result.flash) setFlash(req, result.flash.type, result.flash.message);
        return res.redirect(result.redirectTo || '/import');
      } catch (error) {
        console.error('[statement-pdf] falha ao excluir job', {
          userId: Number(req.user?.id || 0),
          jobId,
          error: error && error.stack ? error.stack : String(error || '')
        });
        setFlash(req, 'error', error.message || 'Nao consegui excluir esse job agora.');
        return res.redirect('/import');
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
