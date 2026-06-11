const { createAutomationPdfImportsService } = require('../services/automationPdfImports.service');

function createAutomationPdfImportsController(deps = {}) {
  const service = deps.pdfImportsAutomationService || createAutomationPdfImportsService(deps);

  function sendResult(res, result) {
    const statusCode = Number(result?.statusCode || 200) || 200;
    const payload = { ...(result || {}) };
    delete payload.statusCode;
    return res.status(statusCode).json(payload);
  }

  function metaFromRequest(req) {
    return {
      idempotencyKey: req.get('Idempotency-Key') || req.get('X-Idempotency-Key') || '',
      ipAddress: String(req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '')
    };
  }

  return {
    createPdfJob(req, res) {
      return sendResult(res, service.createPdfImportJob(req.body || {}, metaFromRequest(req), req.file || null));
    },

    jobStatus(req, res) {
      return sendResult(res, service.getJobStatus({
        ...(req.body || {}),
        job_id: req.params.id,
        id: req.params.id
      }, metaFromRequest(req)));
    },

    cancelJob(req, res) {
      return sendResult(res, service.cancelJob({
        ...(req.body || {}),
        job_id: req.params.id,
        id: req.params.id
      }, metaFromRequest(req)));
    },

    listJobs(req, res) {
      return sendResult(res, service.listRecentJobs(req.body || {}, metaFromRequest(req)));
    },

    conversationReply(req, res) {
      return sendResult(res, service.handleConversationReply(req.body || {}, metaFromRequest(req)));
    }
  };
}

module.exports = {
  createAutomationPdfImportsController
};
