const { createNotificationsService } = require('../services/notifications.service');

function createNotificationsController(deps = {}) {
  const {
    setFlash,
    redirectBackOr,
    getFriendlyErrorMessage
  } = deps;

  const service = deps.service || createNotificationsService(deps);

  function applyFlash(req, flash) {
    if (flash) {
      setFlash(req, flash.type, flash.message);
    }
  }

  return {
    subscribePush(req, res) {
      try {
        const result = service.subscribePush({
          userId: req.user.id,
          subscription: req.body?.subscription
        });
        return res.status(result.status).json(result.body);
      } catch (err) {
        console.error('Erro ao salvar subscription de push:', err);
        return res.status(500).json({ ok: false, error: 'subscription_save_failed' });
      }
    },

    unsubscribePush(req, res) {
      try {
        const result = service.unsubscribePush({
          userId: req.user.id,
          endpoint: req.body?.endpoint
        });
        return res.status(result.status).json(result.body);
      } catch (err) {
        console.error('Erro ao remover subscription de push:', err);
        return res.status(500).json({ ok: false, error: 'subscription_remove_failed' });
      }
    },

    notificationsHome(req, res) {
      return res.redirect('/geral');
    },

    markAllAsRead(req, res) {
      const result = service.markAllAsRead(req.user.id);
      applyFlash(req, result.flash);
      return res.redirect(redirectBackOr(req, '/geral'));
    },

    clearRead(req, res) {
      const result = service.clearRead(req.user.id);
      applyFlash(req, result.flash);
      return res.redirect(redirectBackOr(req, '/geral'));
    },

    readNotification(req, res) {
      const result = service.readNotification(Number(req.params.id), req.user.id);
      applyFlash(req, result.flash);
      return res.redirect(result.redirectTo);
    },

    openNotification(req, res) {
      const result = service.openNotification(Number(req.params.id), req.user.id);
      applyFlash(req, result.flash);
      return res.redirect(result.redirectTo);
    }
  };
}

module.exports = {
  createNotificationsController
};
