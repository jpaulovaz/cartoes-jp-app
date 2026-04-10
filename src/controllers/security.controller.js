const { createSecurityService } = require('../services/security.service');

function createSecurityController(deps = {}) {
  const {
    setFlash,
    setNoStoreHeaders
  } = deps;

  const service = deps.service || createSecurityService(deps);

  function applyFlash(req, flash) {
    if (flash) {
      setFlash(req, flash.type, flash.message);
    }
  }

  return {
    configurePin(req, res) {
      try {
        const result = service.configurePin(req);
        applyFlash(req, { type: 'success', message: result.message });
        return res.redirect(result.redirectTarget);
      } catch (error) {
        setFlash(req, 'error', error.message || 'Não consegui salvar seu PIN agora.');
        return res.redirect(deps.resolvePeopleSettingsRedirectTarget(req, '/settings#security'));
      }
    },

    updatePinIdle(req, res) {
      try {
        const result = service.updatePinIdle(req);
        applyFlash(req, { type: 'success', message: result.message });
        return res.redirect(result.redirectTarget);
      } catch (error) {
        setFlash(req, 'error', error.message || 'Não consegui atualizar o tempo de bloqueio agora.');
        return res.redirect(deps.resolvePeopleSettingsRedirectTarget(req, '/settings#security'));
      }
    },

    disablePin(req, res) {
      try {
        const result = service.disablePin(req);
        applyFlash(req, { type: 'success', message: result.message });
        return res.redirect(result.redirectTarget);
      } catch (error) {
        setFlash(req, 'error', error.message || 'Não consegui desligar o PIN agora.');
        return res.redirect(deps.resolvePeopleSettingsRedirectTarget(req, '/settings#security'));
      }
    },

    async preparePasskeyRegistrationOptions(req, res) {
      setNoStoreHeaders(res);
      const result = await service.preparePasskeyRegistrationOptions(req);
      return res.status(result.status).json(result.body);
    },

    async verifyPasskeyRegistration(req, res) {
      setNoStoreHeaders(res);
      const result = await service.verifyPasskeyRegistration(req);
      return res.status(result.status).json(result.body);
    },

    deletePasskey(req, res) {
      const result = service.deletePasskey(req);
      applyFlash(req, result.flash);
      return res.redirect(result.redirectTarget);
    },

    async preparePasskeyUnlockOptions(req, res) {
      setNoStoreHeaders(res);
      const result = await service.preparePasskeyUnlockOptions(req);
      return res.status(result.status).json(result.body);
    },

    async verifyPasskeyUnlock(req, res) {
      setNoStoreHeaders(res);
      const result = await service.verifyPasskeyUnlock(req, res.locals.dashboardHref);
      return res.status(result.status).json(result.body);
    },

    renderLock(req, res) {
      setNoStoreHeaders(res);
      const result = service.buildLockPage(req, res.locals.dashboardHref);
      if (result.redirectTo) {
        return res.redirect(result.redirectTo);
      }

      return service.safeRenderView(res, result.view, result.locals);
    },

    unlockWithPin(req, res) {
      const outcome = service.unlockWithPin(req, res.locals.dashboardHref);
      if (outcome.flash) {
        applyFlash(req, outcome.flash);
      }
      if (outcome.type === 'json') {
        return res.status(outcome.status).json(outcome.body);
      }
      return res.redirect(outcome.redirectTo);
    },

    engageLock(req, res) {
      setNoStoreHeaders(res);
      const outcome = service.engageLock(req, res.locals.dashboardHref);
      if (outcome.type === 'json') {
        return res.status(outcome.status).json(outcome.body);
      }
      return res.redirect(outcome.redirectTo);
    },

    touchLock(req, res) {
      setNoStoreHeaders(res);
      const outcome = service.touchLock(req, res.locals.dashboardHref);
      if (outcome.type === 'respondWithAppLock') {
        return service.respondWithAppLock(req, res, outcome.payload);
      }
      if (outcome.headers) {
        Object.entries(outcome.headers).forEach(([key, value]) => res.set(key, value));
      }
      if (outcome.body) {
        return res.status(outcome.status).json(outcome.body);
      }
      return res.status(outcome.status).end();
    },

    touchPresence(req, res) {
      setNoStoreHeaders(res);
      const outcome = service.touchPresence(req);
      return res.status(outcome.status).end();
    },

    startGoogleReauth(req, res, next) {
      const outcome = service.startGoogleReauth(req, res.locals.dashboardHref);
      if (outcome.flash) {
        applyFlash(req, outcome.flash);
      }
      if (outcome.passportHandler) {
        return outcome.passportHandler(req, res, next);
      }
      return res.redirect(outcome.redirectTo);
    },

    recoverySetup(req, res) {
      try {
        const outcome = service.recoverySetup(req, res.locals.dashboardHref);
        applyFlash(req, outcome.flash);
        return res.redirect(outcome.redirectTo);
      } catch (error) {
        setFlash(req, 'error', error.message || 'Não consegui redefinir o PIN agora.');
        return res.redirect('/lock?mode=recover');
      }
    },

    recoveryDisable(req, res) {
      try {
        const outcome = service.recoveryDisable(req, res.locals.dashboardHref);
        applyFlash(req, outcome.flash);
        return res.redirect(outcome.redirectTo);
      } catch (error) {
        setFlash(req, 'error', error.message || 'Não consegui desligar o PIN agora.');
        return res.redirect('/lock?mode=recover');
      }
    }
  };
}

module.exports = {
  createSecurityController
};
