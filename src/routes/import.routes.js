const express = require('express');
const { createImportController } = require('../controllers/import.controller');
const { ensureStatementPdfWorkerStarted } = require('../services/statementPdf.service');

function createImportRouter(deps = {}) {
  ensureStatementPdfWorkerStarted(deps);

  const router = express.Router();
  const controller = createImportController(deps);

  router.get('/import', deps.ensureAuthenticated, deps.ensureCanImport, controller.renderImportPage);
  router.post('/import', deps.ensureAuthenticated, deps.ensureCanImport, deps.upload.single('csvfile'), controller.createImportPreview);
  router.post('/import/pdf', deps.ensureAuthenticated, deps.ensureCanImport, deps.upload.array('pdffiles', 10), controller.createPdfImportJob);
  router.get('/import/pdf/jobs/:jobId/review', deps.ensureAuthenticated, deps.ensureCanImport, controller.openPdfImportReview);
  router.get('/import/pdf/jobs/:jobId/download', deps.ensureAuthenticated, deps.ensureCanImport, controller.downloadPdfImportCsv);
  router.post('/import/pdf/jobs/:jobId/retry', deps.ensureAuthenticated, deps.ensureCanImport, controller.retryPdfImportJob);
  router.post('/import/confirm', deps.ensureAuthenticated, deps.ensureCanImport, controller.confirmImportPreview);
  router.post('/import/preview/cancel', deps.ensureAuthenticated, deps.ensureCanImport, controller.cancelImportPreview);

  return router;
}

module.exports = {
  createImportRouter
};
