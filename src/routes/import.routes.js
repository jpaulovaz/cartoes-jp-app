const express = require('express');
const { createImportController } = require('../controllers/import.controller');

function createImportRouter(deps = {}) {
  const router = express.Router();
  const controller = createImportController(deps);

  router.get('/import', deps.ensureAuthenticated, deps.ensureCanImport, controller.renderImportPage);
  router.post('/import', deps.ensureAuthenticated, deps.ensureCanImport, deps.upload.single('csvfile'), controller.createImportPreview);
  router.post('/import/confirm', deps.ensureAuthenticated, deps.ensureCanImport, controller.confirmImportPreview);
  router.post('/import/preview/cancel', deps.ensureAuthenticated, deps.ensureCanImport, controller.cancelImportPreview);

  return router;
}

module.exports = {
  createImportRouter
};
