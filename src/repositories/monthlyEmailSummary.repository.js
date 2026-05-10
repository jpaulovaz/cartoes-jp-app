function createMonthlyEmailSummaryRepository(deps = {}) {
  const {
    parseMonthYear,
    buildMonthlyReviewViewModel,
    buildMonthTransactionsCsvExport,
    getEmailRuntimeConfig,
    isEmailConfigured,
    normalizeEmail,
    buildAppUrl,
    createEmailDeliveryEvent,
    finalizeEmailDeliveryEvent,
    getNextEmailAttemptNo,
    sendEmail,
    logEmailFlowError,
    buildEmailTransportLogContext
  } = deps;

  return {
    parseMonthYear,
    buildMonthlyReviewViewModel,
    buildMonthTransactionsCsvExport,
    getEmailRuntimeConfig,
    isEmailConfigured,
    normalizeEmail,
    buildAppUrl,
    createEmailDeliveryEvent,
    finalizeEmailDeliveryEvent,
    getNextEmailAttemptNo,
    sendEmail,
    logEmailFlowError,
    buildEmailTransportLogContext
  };
}

module.exports = {
  createMonthlyEmailSummaryRepository
};
