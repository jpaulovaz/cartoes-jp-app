function createNotificationsRepository(deps = {}) {
  const {
    isPushConfigured,
    upsertPushSubscription,
    removePushSubscriptionForUser,
    markAllNotificationsAsRead,
    clearReadNotifications,
    getNotificationForUser,
    markNotificationAsRead
  } = deps;

  return {
    isPushConfigured,
    upsertPushSubscription,
    removePushSubscriptionForUser,
    markAllNotificationsAsRead,
    clearReadNotifications,
    getNotificationForUser,
    markNotificationAsRead
  };
}

module.exports = {
  createNotificationsRepository
};
