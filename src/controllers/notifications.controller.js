function createNotificationsController(deps = {}) {
  const {
    isPushConfigured,
    upsertPushSubscription,
    removePushSubscriptionForUser,
    markAllNotificationsAsRead,
    setFlash,
    redirectBackOr,
    clearReadNotifications,
    formatCountLabel,
    getNotificationForUser,
    markNotificationAsRead
  } = deps;

  return {
    subscribePush(req, res) {
      if (!isPushConfigured()) {
        return res.status(503).json({ ok: false, error: 'push_unavailable' });
      }

      const subscription = req.body?.subscription;
      const endpoint = String(subscription?.endpoint || '').trim();

      if (!endpoint) {
        return res.status(400).json({ ok: false, error: 'invalid_subscription' });
      }

      try {
        upsertPushSubscription(req.user.id, subscription);
        return res.json({ ok: true });
      } catch (err) {
        console.error('Erro ao salvar subscription de push:', err);
        return res.status(500).json({ ok: false, error: 'subscription_save_failed' });
      }
    },

    unsubscribePush(req, res) {
      const endpoint = String(req.body?.endpoint || '').trim();

      if (!endpoint) {
        return res.status(400).json({ ok: false, error: 'invalid_endpoint' });
      }

      try {
        removePushSubscriptionForUser(req.user.id, endpoint);
        return res.json({ ok: true });
      } catch (err) {
        console.error('Erro ao remover subscription de push:', err);
        return res.status(500).json({ ok: false, error: 'subscription_remove_failed' });
      }
    },

    notificationsHome(req, res) {
      return res.redirect('/geral');
    },

    markAllAsRead(req, res) {
      markAllNotificationsAsRead(req.user.id);
      setFlash(req, 'success', 'Pronto! Seus avisos já foram marcados como lidos.');
      return res.redirect(redirectBackOr(req, '/geral'));
    },

    clearRead(req, res) {
      const result = clearReadNotifications(req.user.id);
      const removedCount = Number(result?.changes || 0);

      if (removedCount > 0) {
        setFlash(req, 'success', `Tudo certo! ${formatCountLabel(removedCount, 'aviso antigo saiu da lista', 'avisos antigos saíram da lista')}.`);
      } else {
        setFlash(req, 'info', 'Por enquanto não há aviso antigo para limpar.');
      }

      return res.redirect(redirectBackOr(req, '/geral'));
    },

    readNotification(req, res) {
      const notificationId = Number(req.params.id);

      if (!notificationId) {
        setFlash(req, 'error', 'Ops, esse aviso não é válido.');
        return res.redirect('/geral');
      }

      const notification = getNotificationForUser(notificationId, req.user.id);
      if (!notification) {
        setFlash(req, 'error', 'Ops, não encontrei esse aviso.');
        return res.redirect('/geral');
      }

      markNotificationAsRead(notificationId, req.user.id);
      return res.redirect(notification.href || '/geral');
    },

    openNotification(req, res) {
      const notificationId = Number(req.params.id);

      if (!notificationId) {
        setFlash(req, 'error', 'Ops, esse aviso não é válido.');
        return res.redirect('/geral');
      }

      const notification = getNotificationForUser(notificationId, req.user.id);
      if (!notification) {
        setFlash(req, 'error', 'Ops, não encontrei esse aviso.');
        return res.redirect('/geral');
      }

      markNotificationAsRead(notificationId, req.user.id);

      const targetHref = String(notification.href || '').trim();
      if (targetHref && targetHref.startsWith('/')) {
        return res.redirect(targetHref);
      }

      return res.redirect('/geral');
    }
  };
}

module.exports = {
  createNotificationsController
};
