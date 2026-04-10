function createSocialShareRepository(deps = {}) {
  return {
    getPersonStatementExportData: deps.getPersonStatementExportData,
    buildSharePixContext: deps.buildSharePixContext,
    decoratePersonPhoneForView: deps.decoratePersonPhoneForView,
    normalizePhoneForWhatsapp: deps.normalizePhoneForWhatsapp,
    getSettingText: deps.getSettingText,
    isAdminUser: deps.isAdminUser,
    parseMonthYear: deps.parseMonthYear,
    parseChronologicalOrder: deps.parseChronologicalOrder,
    DEFAULT_PHONE_COUNTRY: deps.DEFAULT_PHONE_COUNTRY
  };
}

module.exports = {
  createSocialShareRepository
};
