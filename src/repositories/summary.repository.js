function createSummaryRepository(deps = {}) {
  const {
    parseMonthYear,
    buildMonthlyReviewViewModel,
    buildMerchantPatternFromDescription,
    humanizeMerchantLabel,
    normalizeMerchantText,
    upsertMerchantLearningFeedback,
    getFriendlyErrorDetails,
    isMonthClosed,
    getMonthLockMessage,
    upsertCardStatementsForMonth,
    upsertPersonPaymentsForMonth
  } = deps;

  return {
    parseMonthYear,
    buildMonthlyReviewViewModel,
    buildMerchantPatternFromDescription,
    humanizeMerchantLabel,
    normalizeMerchantText,
    upsertMerchantLearningFeedback,
    getFriendlyErrorDetails,
    isMonthClosed,
    getMonthLockMessage,
    upsertCardStatementsForMonth,
    upsertPersonPaymentsForMonth
  };
}

module.exports = {
  createSummaryRepository
};
