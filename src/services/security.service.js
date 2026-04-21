const { createSecurityRepository } = require('../repositories/security.repository');

function createSecurityService(deps = {}) {
  const {
    resolvePeopleSettingsRedirectTarget,
    getPinIdleOptionLabel,
    buildPasskeyContext,
    buildPasskeyRequestLogContext,
    logPasskeyEvent,
    PASSKEY_MAX_CREDENTIALS_PER_USER,
    normalizePasskeyLabel,
    generatePasskeyRegistrationOptions,
    buildPasskeyUserHandle,
    getPinPepper,
    normalizeErrorStatus,
    summarizePasskeyErrorForLog,
    getFriendlyErrorMessage,
    verifyPasskeyRegistrationResponse,
    summarizePasskeyFlowForLog,
    summarizePasskeyRegistrationPayload,
    generatePasskeyAuthenticationOptions,
    verifyPasskeyAuthenticationResponse,
    sanitizeInternalRedirectTarget,
    getUserAppPinGuardState,
    buildUserAppPinFailureMessage,
    buildAppLockRecoveryUrl,
    buildAppLockRedirectUrl,
    isAjaxLikeRequest,
    respondWithAppLock,
    syncRequestUserPresence,
    normalizePinIdleSeconds,
    buildAppPinGuardViewModel,
    pinLockMessageForReason,
    safeRenderView,
    buildAppPinViewModel,
    buildPasskeyLockViewModel,
    getEffectiveProfilePhoto,
    isGoogleAuthConfigured,
    passport
  } = deps;

  const repository = deps.repository || createSecurityRepository(deps);

  function configurePin(req, { allowReauthOverride = false } = {}) {
    const userId = req.user.id;
    const redirectTarget = resolvePeopleSettingsRedirectTarget(req, '/settings#security');
    const currentSettings = repository.getUserSecuritySettings(userId);
    repository.saveUserAppPinFromRequest(userId, req, { allowReauthOverride });
    return {
      redirectTarget,
      message: currentSettings.pin_enabled
        ? 'PIN atualizado e app protegido do jeitinho novo.'
        : 'PIN ligado com sucesso. Agora seu app já sabe a hora de pedir proteção.'
    };
  }

  function updatePinIdle(req, { allowReauthOverride = false } = {}) {
    const userId = req.user.id;
    const redirectTarget = resolvePeopleSettingsRedirectTarget(req, '/settings#security');
    const updated = repository.updateUserAppPinIdleSecondsFromRequest(userId, req, { allowReauthOverride });
    return {
      redirectTarget,
      message: `Tempo de bloqueio atualizado. Agora o app volta a pedir PIN em ${getPinIdleOptionLabel(updated.pin_idle_seconds)}.`
    };
  }

  function disablePin(req, { allowReauthOverride = false } = {}) {
    const userId = req.user.id;
    const redirectTarget = resolvePeopleSettingsRedirectTarget(req, '/settings#security');
    repository.disableUserAppPinFromRequest(userId, req, { allowReauthOverride });
    return {
      redirectTarget,
      message: allowReauthOverride
        ? 'PIN desligado depois da confirmação com Google.'
        : 'PIN desligado por aqui. O app volta a abrir sem essa trava extra.'
    };
  }

  async function preparePasskeyRegistrationOptions(req) {
    const userId = req.user.id;
    const settings = repository.getUserSecuritySettings(userId);
    const context = buildPasskeyContext(req);
    const logContext = buildPasskeyRequestLogContext(req, context);

    if (!settings.pin_enabled) {
      logPasskeyEvent('warn', 'register-options-blocked-pin-disabled', {
        ...logContext,
        pinEnabled: false
      });
      return { status: 422, body: { ok: false, message: 'Primeiro liga o PIN. Aí eu consigo preparar o desbloqueio pelo aparelho.' } };
    }

    if (!context.available) {
      logPasskeyEvent('warn', 'register-options-context-unavailable', {
        ...logContext,
        disabledMessage: context.disabledMessage || null
      });
      return { status: 422, body: { ok: false, message: context.disabledMessage || 'Esse desbloqueio ainda não ficou disponível neste ambiente.' } };
    }

    const currentPasskeys = repository.listUserPasskeys(userId);
    if (currentPasskeys.length >= PASSKEY_MAX_CREDENTIALS_PER_USER) {
      logPasskeyEvent('warn', 'register-options-limit-reached', {
        ...logContext,
        existingCount: currentPasskeys.length,
        maxCount: PASSKEY_MAX_CREDENTIALS_PER_USER
      });
      return { status: 409, body: { ok: false, message: `Você já preparou ${PASSKEY_MAX_CREDENTIALS_PER_USER} aparelhos por aqui. Se quiser abrir espaço, é só remover um deles.` } };
    }

    try {
      const friendlyLabel = normalizePasskeyLabel(req.body?.label || '', 'Este aparelho');
      const options = await generatePasskeyRegistrationOptions({
        rpName: context.rpName,
        rpID: context.rpID,
        userID: buildPasskeyUserHandle(userId, getPinPepper()),
        userName: String(req.user.email || `user-${userId}@acerttapay.local`).trim(),
        userDisplayName: String(req.user.name || req.user.email || 'Você').trim(),
        excludeCredentials: currentPasskeys
      });

      repository.setPasskeySessionFlow(req, 'register', {
        userId: Number(userId || 0),
        challenge: options.challenge,
        origin: context.origin,
        rpID: context.rpID,
        label: friendlyLabel
      });

      return {
        status: 200,
        body: {
          ok: true,
          options,
          label: friendlyLabel,
          count: currentPasskeys.length,
          maxCount: PASSKEY_MAX_CREDENTIALS_PER_USER
        }
      };
    } catch (error) {
      const status = normalizeErrorStatus(error, 500);
      logPasskeyEvent(status >= 500 ? 'error' : 'warn', 'register-options-error', {
        ...logContext,
        label: normalizePasskeyLabel(req.body?.label || '', 'Este aparelho'),
        existingCount: currentPasskeys.length,
        maxCount: PASSKEY_MAX_CREDENTIALS_PER_USER,
        error: summarizePasskeyErrorForLog(error)
      });
      return {
        status,
        body: {
          ok: false,
          message: getFriendlyErrorMessage(error, { defaultMessage: 'Não consegui preparar esse aparelho agora.' })
        }
      };
    }
  }

  async function verifyPasskeyRegistration(req) {
    const userId = req.user.id;
    const flow = repository.consumePasskeySessionFlow(req, 'register');
    const logContext = buildPasskeyRequestLogContext(req);

    if (!flow || Number(flow.userId || 0) !== Number(userId || 0)) {
      logPasskeyEvent('warn', 'register-verify-flow-missing', {
        ...logContext,
        flow: summarizePasskeyFlowForLog(flow)
      });
      return { status: 410, body: { ok: false, message: 'Esse preparo perdeu a validade. Começa de novo que eu acompanho daqui.' } };
    }

    try {
      const verification = await verifyPasskeyRegistrationResponse({
        response: req.body,
        expectedChallenge: flow.challenge,
        expectedOrigin: String(flow.origin || '').trim(),
        expectedRPID: String(flow.rpID || '').trim()
      });

      if (!verification.verified || !verification.credential) {
        logPasskeyEvent('warn', 'register-verify-unverified', {
          ...logContext,
          flow: summarizePasskeyFlowForLog(flow),
          response: summarizePasskeyRegistrationPayload(req.body)
        });
        return { status: 422, body: { ok: false, message: 'Não consegui confirmar esse aparelho agora. Vamos tentar de novo?' } };
      }

      const currentPasskeys = repository.listUserPasskeys(userId);
      if (currentPasskeys.length >= PASSKEY_MAX_CREDENTIALS_PER_USER) {
        logPasskeyEvent('warn', 'register-verify-limit-reached', {
          ...logContext,
          flow: summarizePasskeyFlowForLog(flow),
          response: summarizePasskeyRegistrationPayload(req.body),
          existingCount: currentPasskeys.length,
          maxCount: PASSKEY_MAX_CREDENTIALS_PER_USER
        });
        return { status: 409, body: { ok: false, message: `Você já preparou ${PASSKEY_MAX_CREDENTIALS_PER_USER} aparelhos por aqui. Se quiser abrir espaço, é só remover um deles.` } };
      }

      const saved = repository.saveUserPasskey(userId, {
        ...verification.credential,
        label: normalizePasskeyLabel(req.body?.label || flow.label || '', 'Este aparelho')
      });

      return {
        status: 200,
        body: {
          ok: true,
          message: `Pronto, ${saved?.label || 'este aparelho'} já pode entrar em cena no desbloqueio.`,
          count: repository.listUserPasskeys(userId).length
        }
      };
    } catch (error) {
      const status = normalizeErrorStatus(error, 500);
      logPasskeyEvent(status >= 500 ? 'error' : 'warn', 'register-verify-error', {
        ...logContext,
        flow: summarizePasskeyFlowForLog(flow),
        response: summarizePasskeyRegistrationPayload(req.body),
        error: summarizePasskeyErrorForLog(error)
      });
      return {
        status,
        body: {
          ok: false,
          message: getFriendlyErrorMessage(error, { defaultMessage: 'Não consegui confirmar esse aparelho agora.' })
        }
      };
    }
  }

  function deletePasskey(req) {
    const userId = req.user.id;
    const passkey = repository.getUserPasskey(userId, req.params.id);
    const redirectTarget = resolvePeopleSettingsRedirectTarget(req, '/settings#security');

    if (!passkey) {
      return {
        redirectTarget,
        flash: { type: 'error', message: 'Esse aparelho já tinha saído da lista por aqui.' }
      };
    }

    repository.deleteUserPasskey(userId, req.params.id);
    return {
      redirectTarget,
      flash: { type: 'success', message: `${passkey.label || 'Esse aparelho'} saiu da lista de desbloqueio.` }
    };
  }

  async function preparePasskeyUnlockOptions(req) {
    const userId = req.user.id;
    const settings = repository.getUserSecuritySettings(userId);

    if (!settings.pin_enabled) {
      return { status: 422, body: { ok: false, message: 'O desbloqueio pelo aparelho entra em cena junto com o PIN.' } };
    }

    const context = buildPasskeyContext(req);
    if (!context.available) {
      return { status: 422, body: { ok: false, message: context.disabledMessage || 'Hoje esse desbloqueio não ficou disponível neste endereço.' } };
    }

    const passkeys = repository.listUserPasskeys(userId);
    if (!passkeys.length) {
      return { status: 404, body: { ok: false, message: 'Ainda não há nenhum aparelho preparado para esse atalho.' } };
    }

    try {
      const options = await generatePasskeyAuthenticationOptions({
        rpID: context.rpID,
        allowCredentials: passkeys
      });

      repository.setPasskeySessionFlow(req, 'unlock', {
        userId: Number(userId || 0),
        challenge: options.challenge,
        origin: context.origin,
        rpID: context.rpID
      });

      return { status: 200, body: { ok: true, options } };
    } catch (error) {
      return {
        status: normalizeErrorStatus(error, 500),
        body: { ok: false, message: getFriendlyErrorMessage(error, { defaultMessage: 'Não consegui preparar o desbloqueio pelo aparelho agora.' }) }
      };
    }
  }

  async function verifyPasskeyUnlock(req, dashboardHref) {
    const userId = req.user.id;
    const settings = repository.getUserSecuritySettings(userId);

    if (!settings.pin_enabled) {
      repository.clearAppLockSession(req);
      return { status: 200, body: { ok: true, redirect: sanitizeInternalRedirectTarget(req.body?.next || dashboardHref || '/', dashboardHref || '/') } };
    }

    const state = repository.getAppSessionState(req);
    const redirectTarget = sanitizeInternalRedirectTarget(req.body?.next || state.returnTo || dashboardHref || '/', dashboardHref || '/');
    const flow = repository.consumePasskeySessionFlow(req, 'unlock');

    if (!flow || Number(flow.userId || 0) !== Number(userId || 0)) {
      return { status: 410, body: { ok: false, message: 'Esse desbloqueio perdeu a validade. Tenta mais uma vez que eu preparo de novo.' } };
    }

    const credentialId = String(req.body?.id || '').trim();
    const passkey = repository.getUserPasskey(userId, credentialId);
    if (!credentialId || !passkey) {
      return { status: 404, body: { ok: false, message: 'Não encontrei esse aparelho na sua lista de desbloqueio.' } };
    }

    try {
      const verification = await verifyPasskeyAuthenticationResponse({
        response: req.body,
        expectedChallenge: flow.challenge,
        expectedOrigin: String(flow.origin || '').trim(),
        expectedRPID: String(flow.rpID || '').trim(),
        passkey
      });

      if (!verification.verified) {
        return { status: 422, body: { ok: false, message: 'Esse desbloqueio não foi confirmado agora. Pode tentar de novo ou seguir pelo PIN.' } };
      }

      repository.touchUserPasskeyUsage(userId, passkey.id, {
        counter: verification.newCounter,
        origin: String(flow.origin || '').trim()
      });
      repository.resetUserAppPinFailures(userId);
      repository.unlockAppSession(req, { clearReturnTo: true });
      await repository.persistSessionState(req);

      return { status: 200, body: { ok: true, redirect: redirectTarget } };
    } catch (error) {
      return {
        status: normalizeErrorStatus(error, 500),
        body: {
          ok: false,
          message: getFriendlyErrorMessage(error, { defaultMessage: 'Não consegui confirmar esse desbloqueio agora. Você também pode seguir pelo PIN.' })
        }
      };
    }
  }

  function buildLockPage(req, dashboardHref) {
    const userId = req.user.id;
    const settings = repository.getUserSecuritySettings(userId);

    if (!settings.pin_enabled) {
      repository.clearAppLockSession(req);
      repository.clearPinReauthSession(req);
      return { redirectTo: dashboardHref || '/' };
    }

    repository.clearExpiredPinReauthSession(req, userId);
    const reauthFresh = repository.hasFreshPinReauthSession(req, userId);
    const state = repository.getAppSessionState(req);
    const nextTarget = sanitizeInternalRedirectTarget(req.query.next || state.returnTo || dashboardHref || '/', dashboardHref || '/');
    const sessionState = repository.ensureAppLockSession(req);
    if (sessionState && nextTarget) {
      sessionState.returnTo = nextTarget;
    }

    if (state.unlocked && !reauthFresh) {
      return { redirectTo: nextTarget || dashboardHref || '/' };
    }

    const currentUser = repository.getUserRecord(userId, { includeDeleted: false }) || req.user || {};
    const guardView = buildAppPinGuardViewModel(userId);
    const lockMode = String(req.query.mode || '').trim().toLowerCase() === 'recover' && reauthFresh ? 'recover' : 'unlock';
    const baseLockMessage = pinLockMessageForReason(req.query.reason || state.reason || '');
    const lockMessage = guardView.requiresReauth || guardView.cooldownActive
      ? guardView.noticeMessage || baseLockMessage
      : baseLockMessage;

    return {
      view: 'lock',
      locals: {
        title: 'AcerttaPay | Desbloquear',
        lockUser: {
          name: currentUser.name || req.user.name || req.user.email || 'Você',
          email: currentUser.email || req.user.email || '',
          photo_url: getEffectiveProfilePhoto(currentUser)
        },
        appPinSecurity: buildAppPinViewModel(settings, { reauthFresh }),
        appPinGuard: guardView,
        appPasskeyLock: buildPasskeyLockViewModel(req, userId, settings),
        lockReason: String(req.query.reason || state.reason || '').trim().toLowerCase(),
        lockMessage,
        nextTarget,
        lockMode,
        reauthFresh
      }
    };
  }

  function unlockWithPin(req, dashboardHref) {
    const userId = req.user.id;
    const settings = repository.getUserSecuritySettings(userId);

    if (!settings.pin_enabled) {
      repository.clearAppLockSession(req);
      const redirectTarget = sanitizeInternalRedirectTarget(req.body.next || dashboardHref || '/', dashboardHref || '/');
      return isAjaxLikeRequest(req)
        ? { type: 'json', status: 200, body: { ok: true, redirect: redirectTarget } }
        : { type: 'redirect', redirectTo: redirectTarget };
    }

    const redirectTarget = sanitizeInternalRedirectTarget(req.body.next || repository.getAppSessionState(req).returnTo || dashboardHref || '/', dashboardHref || '/');
    const recoveryRedirectTarget = buildAppLockRecoveryUrl(req, { reason: 'locked', returnTo: redirectTarget });
    const preGuardState = getUserAppPinGuardState(userId);

    if (preGuardState.requiresReauth) {
      const message = 'Por segurança, esse PIN entrou em pausa. Confirma sua conta Google para trocar ou desligar a proteção.';
      return isAjaxLikeRequest(req)
        ? { type: 'json', status: 423, body: { ok: false, message, requiresReauth: true, redirect: recoveryRedirectTarget } }
        : { type: 'redirect', redirectTo: recoveryRedirectTarget, flash: { type: 'error', message } };
    }

    if (preGuardState.cooldownActive) {
      const message = `Segura ${preGuardState.cooldownLabel} que eu volto a liberar novas tentativas.`;
      const lockedRedirect = buildAppLockRedirectUrl(req, { reason: 'locked', returnTo: redirectTarget });
      return isAjaxLikeRequest(req)
        ? { type: 'json', status: 429, body: { ok: false, message, retryAfter: preGuardState.cooldownSeconds, redirect: lockedRedirect } }
        : { type: 'redirect', redirectTo: lockedRedirect, flash: { type: 'error', message } };
    }

    const pinCheck = deps.validatePinInput(req.body.pin);
    if (!pinCheck.ok || !repository.verifyUserAppPin(userId, pinCheck.value)) {
      const postGuardState = repository.registerUserAppPinFailure(userId);
      const message = buildUserAppPinFailureMessage(postGuardState);
      return isAjaxLikeRequest(req)
        ? {
            type: 'json',
            status: postGuardState.requiresReauth ? 423 : postGuardState.cooldownActive ? 429 : 422,
            body: {
              ok: false,
              message,
              requiresReauth: postGuardState.requiresReauth,
              retryAfter: postGuardState.cooldownActive ? postGuardState.cooldownSeconds : 0,
              redirect: postGuardState.requiresReauth
                ? recoveryRedirectTarget
                : buildAppLockRedirectUrl(req, { reason: 'locked', returnTo: redirectTarget })
            }
          }
        : {
            type: 'redirect',
            redirectTo: postGuardState.requiresReauth
              ? recoveryRedirectTarget
              : buildAppLockRedirectUrl(req, { reason: 'locked', returnTo: redirectTarget }),
            flash: { type: 'error', message }
          };
    }

    repository.resetUserAppPinFailures(userId);
    repository.unlockAppSession(req);
    const sessionState = repository.ensureAppLockSession(req);
    if (sessionState) {
      sessionState.returnTo = '';
    }

    return isAjaxLikeRequest(req)
      ? { type: 'json', status: 200, body: { ok: true, redirect: redirectTarget } }
      : { type: 'redirect', redirectTo: redirectTarget };
  }

  function engageLock(req, dashboardHref) {
    const reason = String(req.body.reason || req.query.reason || 'manual').trim().toLowerCase() || 'manual';
    const returnTo = sanitizeInternalRedirectTarget(req.body.return_to || req.query.return_to || req.get('referer') || dashboardHref || '/', dashboardHref || '/');
    repository.lockAppSession(req, { reason, returnTo });
    const redirectTarget = buildAppLockRedirectUrl(req, { reason, returnTo });

    return isAjaxLikeRequest(req)
      ? { type: 'json', status: 200, body: { ok: true, redirect: redirectTarget } }
      : { type: 'redirect', redirectTo: redirectTarget };
  }

  function touchLock(req, dashboardHref) {
    const userId = req.user.id;
    const settings = repository.getUserSecuritySettings(userId);

    if (!settings.pin_enabled) {
      repository.clearAppLockSession(req);
      syncRequestUserPresence(req, { force: true });
      return { status: 204, body: null };
    }

    const guardState = getUserAppPinGuardState(userId);
    if (guardState.requiresReauth) {
      const redirect = buildAppLockRecoveryUrl(req, { reason: 'locked', returnTo: repository.getAppSessionState(req).returnTo || dashboardHref || '/' });
      return {
        status: 423,
        headers: {
          'X-App-Locked': '1',
          'X-App-Lock-Redirect': redirect
        },
        body: { ok: false, appLocked: true, requiresReauth: true, redirect }
      };
    }

    const state = repository.getAppSessionState(req);
    const idleSeconds = normalizePinIdleSeconds(settings.pin_idle_seconds);
    const idleMs = idleSeconds > 0 ? idleSeconds * 1000 : 0;
    const lastActiveAt = Number(state.lastActiveAt || 0);

    if (state.unlocked && idleMs > 0 && lastActiveAt && (Date.now() - lastActiveAt) >= idleMs) {
      return { type: 'respondWithAppLock', payload: { reason: 'idle', returnTo: state.returnTo || dashboardHref || '/' } };
    }

    if (!state.unlocked) {
      const redirect = buildAppLockRedirectUrl(req, { reason: state.reason || 'locked', returnTo: state.returnTo || dashboardHref || '/' });
      return {
        status: 423,
        headers: {
          'X-App-Locked': '1',
          'X-App-Lock-Redirect': redirect
        },
        body: { ok: false, appLocked: true, redirect }
      };
    }

    repository.touchAppSession(req);
    syncRequestUserPresence(req, { force: true });
    return { status: 204, body: null };
  }

  function touchPresence(req) {
    syncRequestUserPresence(req, { force: true });
    return { status: 204, body: null };
  }

  function startGoogleReauth(req, dashboardHref) {
    const settings = repository.getUserSecuritySettings(req.user.id);
    if (!settings.pin_enabled) {
      return { redirectTo: dashboardHref || '/' };
    }

    if (!isGoogleAuthConfigured()) {
      return {
        redirectTo: '/lock',
        flash: { type: 'error', message: 'O login com Google não está pronto por aqui para confirmar essa redefinição agora.' }
      };
    }

    repository.startPinReauthSession(req, { returnTo: '/lock?mode=recover' });
    return {
      passportHandler: passport.authenticate('google', {
        scope: ['profile', 'email'],
        prompt: 'select_account',
        loginHint: req.user.email
      })
    };
  }

  function recoverySetup(req, dashboardHref) {
    const userId = req.user.id;
    const redirectTarget = sanitizeInternalRedirectTarget(req.body.next || repository.getAppSessionState(req).returnTo || dashboardHref || '/', dashboardHref || '/');

    if (!repository.hasFreshPinReauthSession(req, userId)) {
      return {
        redirectTo: '/lock',
        flash: { type: 'error', message: 'Antes de redefinir o PIN, preciso que você confirme sua conta Google de novo.' }
      };
    }

    const pinResult = configurePin(req, { allowReauthOverride: true });
    const sessionState = repository.ensureAppLockSession(req);
    if (sessionState) {
      sessionState.returnTo = '';
    }

    return {
      redirectTo: redirectTarget,
      flash: { type: 'success', message: 'Novo PIN salvo com sucesso. Agora o app já pode destravar com ele.' },
      pinResult
    };
  }

  function recoveryDisable(req, dashboardHref) {
    const userId = req.user.id;
    const redirectTarget = sanitizeInternalRedirectTarget(req.body.next || dashboardHref || '/', dashboardHref || '/');

    if (!repository.hasFreshPinReauthSession(req, userId)) {
      return {
        redirectTo: '/lock',
        flash: { type: 'error', message: 'Antes de desligar o PIN, preciso que você confirme sua conta Google de novo.' }
      };
    }

    disablePin(req, { allowReauthOverride: true });
    return {
      redirectTo: redirectTarget,
      flash: { type: 'success', message: 'PIN desligado depois da confirmação com Google.' }
    };
  }

  return {
    configurePin,
    updatePinIdle,
    disablePin,
    preparePasskeyRegistrationOptions,
    verifyPasskeyRegistration,
    deletePasskey,
    preparePasskeyUnlockOptions,
    verifyPasskeyUnlock,
    buildLockPage,
    unlockWithPin,
    engageLock,
    touchLock,
    touchPresence,
    startGoogleReauth,
    recoverySetup,
    recoveryDisable,
    safeRenderView,
    respondWithAppLock
  };
}

module.exports = {
  createSecurityService
};
