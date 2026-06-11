const { createAutomationRemindersService } = require('../services/automationReminders.service');

function createAutomationRemindersController(deps = {}) {
  const service = deps.remindersService || createAutomationRemindersService(deps);

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
    create(req, res) {
      return sendResult(res, service.createReminder(req.body || {}, metaFromRequest(req)));
    },

    search(req, res) {
      return sendResult(res, service.searchReminders(req.body || {}, metaFromRequest(req)));
    },

    due(req, res) {
      return sendResult(res, service.getDueReminders(req.body || {}, metaFromRequest(req)));
    },

    complete(req, res) {
      return sendResult(res, service.completeReminder({
        ...(req.body || {}),
        id: req.params.id,
        reminder_id: req.params.id
      }, metaFromRequest(req)));
    },

    cancel(req, res) {
      return sendResult(res, service.cancelReminder({
        ...(req.body || {}),
        id: req.params.id,
        reminder_id: req.params.id
      }, metaFromRequest(req)));
    },

    snooze(req, res) {
      return sendResult(res, service.snoozeReminder({
        ...(req.body || {}),
        id: req.params.id,
        reminder_id: req.params.id
      }, metaFromRequest(req)));
    },

    markSent(req, res) {
      return sendResult(res, service.markReminderSent({
        ...(req.body || {}),
        id: req.params.id,
        reminder_id: req.params.id
      }, metaFromRequest(req)));
    }
  };
}

module.exports = {
  createAutomationRemindersController
};
