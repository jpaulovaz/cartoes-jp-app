const express = require('express');
const { createSecurityController } = require('../controllers/security.controller');

function createSecurityRouter(deps = {}) {
  const router = express.Router();
  const controller = createSecurityController(deps);

  router.post('/people/security/pin/setup', deps.ensureAuthenticated, controller.configurePin);
  router.post('/people/security/pin/idle', deps.ensureAuthenticated, controller.updatePinIdle);
  router.post('/people/security/pin/disable', deps.ensureAuthenticated, controller.disablePin);
  router.post('/people/security/passkeys/register/options', deps.ensureAuthenticated, controller.preparePasskeyRegistrationOptions);
  router.post('/people/security/passkeys/register/verify', deps.ensureAuthenticated, controller.verifyPasskeyRegistration);
  router.post('/people/security/passkeys/:id/delete', deps.ensureAuthenticated, controller.deletePasskey);
  router.post('/lock/passkey/options', deps.ensureAuthenticatedIgnoringPin, controller.preparePasskeyUnlockOptions);
  router.post('/lock/passkey/verify', deps.ensureAuthenticatedIgnoringPin, controller.verifyPasskeyUnlock);
  router.get('/lock', deps.ensureAuthenticatedIgnoringPin, controller.renderLock);
  router.post('/lock/unlock', deps.ensureAuthenticatedIgnoringPin, controller.unlockWithPin);
  router.post('/lock/engage', deps.ensureAuthenticatedIgnoringPin, controller.engageLock);
  router.post('/lock/touch', deps.ensureAuthenticatedIgnoringPin, controller.touchLock);
  router.post('/presence/touch', deps.ensureAuthenticatedIgnoringPin, controller.touchPresence);
  router.get('/lock/reauth/google', deps.ensureAuthenticatedIgnoringPin, controller.startGoogleReauth);
  router.post('/lock/recovery/setup', deps.ensureAuthenticatedIgnoringPin, controller.recoverySetup);
  router.post('/lock/recovery/disable', deps.ensureAuthenticatedIgnoringPin, controller.recoveryDisable);

  return router;
}

module.exports = {
  createSecurityRouter
};
