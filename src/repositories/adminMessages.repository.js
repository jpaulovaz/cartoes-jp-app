function createAdminMessagesRepository(deps = {}) {
  const {
    isAdminUser,
    normalizeAdminMessageActionFilters,
    getAdminMessageImportPreview,
    clearAdminMessageImportPreview,
    buildImportPreviewFromBuffer,
    setAdminMessageImportPreview,
    applyImportPreview,
    buildAdminMessagesPath,
    buildMessageCsvExport,
    saveMessageTemplateCustomization,
    resetMessageTemplateCustomization,
    buildMessagePreview,
    buildPushTestPayload,
    isPushConfigured,
    webPush,
    ADMIN_MESSAGE_PUSH_TEST_RATE_LIMIT_MS,
    adminMessagePushTestRateLimit,
    upsertPushSubscription,
    removePushSubscriptionForUser
  } = deps;

  return {
    isAdminUser,
    normalizeAdminMessageActionFilters,
    getAdminMessageImportPreview,
    clearAdminMessageImportPreview,
    buildImportPreviewFromBuffer,
    setAdminMessageImportPreview,
    applyImportPreview,
    buildAdminMessagesPath,
    buildMessageCsvExport,
    saveMessageTemplateCustomization,
    resetMessageTemplateCustomization,
    buildMessagePreview,
    buildPushTestPayload,
    isPushConfigured,
    webPush,
    ADMIN_MESSAGE_PUSH_TEST_RATE_LIMIT_MS,
    adminMessagePushTestRateLimit,
    upsertPushSubscription,
    removePushSubscriptionForUser
  };
}

module.exports = {
  createAdminMessagesRepository
};
