function createSecurityRepository(deps = {}) {
  const {
    getUserSecuritySettings,
    saveUserAppPinFromRequest,
    updateUserAppPinIdleSecondsFromRequest,
    disableUserAppPinFromRequest,
    listUserPasskeys,
    getUserPasskey,
    deleteUserPasskey,
    saveUserPasskey,
    setPasskeySessionFlow,
    consumePasskeySessionFlow,
    clearAppLockSession,
    clearPinReauthSession,
    clearExpiredPinReauthSession,
    hasFreshPinReauthSession,
    getAppSessionState,
    ensureAppLockSession,
    verifyUserAppPin,
    registerUserAppPinFailure,
    resetUserAppPinFailures,
    unlockAppSession,
    lockAppSession,
    touchAppSession,
    persistSessionState,
    getUserRecord,
    startPinReauthSession,
    touchUserPasskeyUsage
  } = deps;

  return {
    getUserSecuritySettings,
    saveUserAppPinFromRequest,
    updateUserAppPinIdleSecondsFromRequest,
    disableUserAppPinFromRequest,
    listUserPasskeys,
    getUserPasskey,
    deleteUserPasskey,
    saveUserPasskey,
    setPasskeySessionFlow,
    consumePasskeySessionFlow,
    clearAppLockSession,
    clearPinReauthSession,
    clearExpiredPinReauthSession,
    hasFreshPinReauthSession,
    getAppSessionState,
    ensureAppLockSession,
    verifyUserAppPin,
    registerUserAppPinFailure,
    resetUserAppPinFailures,
    unlockAppSession,
    lockAppSession,
    touchAppSession,
    persistSessionState,
    getUserRecord,
    startPinReauthSession,
    touchUserPasskeyUsage
  };
}

module.exports = {
  createSecurityRepository
};
