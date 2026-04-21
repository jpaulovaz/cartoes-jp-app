const { createNotificationsRepository } = require('../repositories/notifications.repository');

function createNotificationsService(deps = {}) {
  const {
    formatCountLabel
  } = deps;

  const repository = deps.repository || createNotificationsRepository(deps);

  function subscribePush({ userId, subscription }) {
    if (!repository.isPushConfigured()) {
      return { status: 503, body: { ok: false, error: 'push_unavailable' } };
    }

    const endpoint = String(subscription?.endpoint || '').trim();
    if (!endpoint) {
      return { status: 400, body: { ok: false, error: 'invalid_subscription' } };
    }

    repository.upsertPushSubscription(userId, subscription);
    return { status: 200, body: { ok: true } };
  }

  function unsubscribePush({ userId, endpoint }) {
    if (!String(endpoint || '').trim()) {
      return { status: 400, body: { ok: false, error: 'invalid_endpoint' } };
    }

    repository.removePushSubscriptionForUser(userId, endpoint);
    return { status: 200, body: { ok: true } };
  }

  function markAllAsRead(userId) {
    repository.markAllNotificationsAsRead(userId);
    return {
      flash: {
        type: 'success',
        message: 'Pronto! Seus avisos já foram marcados como lidos.'
      }
    };
  }

  function clearRead(userId) {
    const result = repository.clearReadNotifications(userId);
    const removedCount = Number(result?.changes || 0);

    if (removedCount > 0) {
      return {
        flash: {
          type: 'success',
          message: `Tudo certo! ${formatCountLabel(removedCount, 'aviso antigo saiu da lista', 'avisos antigos saíram da lista')}.`
        }
      };
    }

    return {
      flash: {
        type: 'info',
        message: 'Por enquanto não há aviso antigo para limpar.'
      }
    };
  }

  function readNotification(notificationId, userId) {
    if (!notificationId) {
      return { redirectTo: '/geral', flash: { type: 'error', message: 'Ops, esse aviso não é válido.' } };
    }

    const notification = repository.getNotificationForUser(notificationId, userId);
    if (!notification) {
      return { redirectTo: '/geral', flash: { type: 'error', message: 'Ops, não encontrei esse aviso.' } };
    }

    repository.markNotificationAsRead(notificationId, userId);
    return {
      redirectTo: notification.href || '/geral'
    };
  }

  function openNotification(notificationId, userId) {
    const result = readNotification(notificationId, userId);
    if (result.flash) {
      return result;
    }

    const targetHref = String(result.redirectTo || '').trim();
    return {
      redirectTo: targetHref && targetHref.startsWith('/') ? targetHref : '/geral'
    };
  }

  return {
    subscribePush,
    unsubscribePush,
    markAllAsRead,
    clearRead,
    readNotification,
    openNotification
  };
}

module.exports = {
  createNotificationsService
};
