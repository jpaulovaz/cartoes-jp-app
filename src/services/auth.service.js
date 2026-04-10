const { createAuthRepository } = require('../repositories/auth.repository');

function createAuthService(deps = {}) {
  const {
    isInitialSetupRequired,
    normalizeEmail,
    GOOGLE_SETUP_KEYS,
    getSettingDefinition,
    sanitizeSettingValue,
    buildSeedValue,
    currentConfigTimestamp,
    DEFAULT_FINANCE_CATEGORIES,
    refreshRuntimeSettings,
    getFriendlyErrorMessage,
    isGoogleAuthConfigured,
    clearPinReauthSession,
    sanitizeInternalRedirectTarget,
    grantPinReauthSession
  } = deps;

  const repository = deps.repository || createAuthRepository(deps);

  function buildSetupForm(body = {}) {
    return {
      admin_name: String(body.admin_name || '').trim(),
      admin_email: String(body.admin_email || '').trim(),
      GOOGLE_CLIENT_ID: body.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: body.GOOGLE_CLIENT_SECRET,
      GOOGLE_CALLBACK_URL: body.GOOGLE_CALLBACK_URL
    };
  }

  function ensureInitialSetupState() {
    return !!isInitialSetupRequired();
  }

  function completeInitialSetupFromBody(body = {}) {
    const rawForm = buildSetupForm(body);
    const safeAdminEmail = normalizeEmail(rawForm.admin_email);
    const safeAdminName = String(rawForm.admin_name || '').trim();

    if (!safeAdminEmail || !safeAdminEmail.includes('@')) {
      const error = new Error('Me passa um e-mail válido para o admin inaugural. É ele que vai ganhar a chave mestra do app.');
      error.status = 422;
      error.exposeToUser = true;
      error.form = rawForm;
      throw error;
    }

    const nextSettings = {};
    GOOGLE_SETUP_KEYS.forEach((key) => {
      const definition = getSettingDefinition(key);
      const sanitized = sanitizeSettingValue(definition, rawForm[key]);
      nextSettings[key] = key === 'GOOGLE_CALLBACK_URL' && !String(sanitized || '').trim()
        ? buildSeedValue(definition)
        : sanitized;
    });

    if (!String(nextSettings.GOOGLE_CLIENT_ID || '').trim() || !String(nextSettings.GOOGLE_CLIENT_SECRET || '').trim()) {
      const error = new Error('Para o Google acordar bonito, preciso de Client ID e Client secret completos.');
      error.status = 422;
      error.exposeToUser = true;
      error.form = rawForm;
      throw error;
    }

    const now = currentConfigTimestamp();
    repository.completeInitialSetup({
      safeAdminEmail,
      safeAdminName,
      nextSettings,
      now,
      defaultFinanceCategories: DEFAULT_FINANCE_CATEGORIES
    });

    refreshRuntimeSettings();
    return { rawForm };
  }

  function buildLoginViewState(query = {}) {
    let error = null;
    let notice = null;
    const reason = String(query.reason || '').trim().toLowerCase();
    const errorKey = String(query.error || '').trim().toLowerCase();
    const setupKey = String(query.setup || '').trim().toLowerCase();

    if (reason === 'idle') {
      error = 'Fiquei um tempinho sem te ver por aqui, então fechei a porta por segurança. Entra de novo e seguimos.';
    } else if (errorKey === 'auth_failed') {
      error = 'Não consegui te trazer com o Google agora. Tenta mais uma vez que eu ajeito daqui.';
    } else if (errorKey === 'google_not_configured') {
      error = 'O botão de entrar com Google ainda não foi ligado por aqui. Vale ajustar isso primeiro em Administração.';
    }

    if (setupKey === 'done') {
      notice = 'Tudo pronto por aqui. Agora é só entrar com a conta principal do Google e começar.';
    }

    return { error, notice };
  }

  function ensureGoogleAuthConfiguredOrThrow() {
    if (!isGoogleAuthConfigured()) {
      const error = new Error('google_not_configured');
      error.code = 'google_not_configured';
      throw error;
    }
  }

  function resolveGoogleLoginRedirect() {
    if (ensureInitialSetupState()) {
      return '/setup';
    }

    if (!isGoogleAuthConfigured()) {
      return '/login?error=google_not_configured';
    }

    return null;
  }

  function handleGoogleLoginSuccess(req, user) {
    const reauthFlow = req.session?.appPinReauthFlow || null;
    if (reauthFlow && Number(reauthFlow.userId || 0) > 0 && Number(user.id || 0) !== Number(reauthFlow.userId || 0)) {
      clearPinReauthSession(req);
      return {
        redirectTo: '/lock?reason=reauth-mismatch',
        flash: {
          type: 'error',
          message: 'Para redefinir o PIN, confirme com a mesma conta Google que está usando aqui no app.'
        }
      };
    }

    if (reauthFlow && Number(reauthFlow.userId || 0) > 0) {
      const returnTo = sanitizeInternalRedirectTarget(reauthFlow.returnTo, '/lock?mode=recover');
      grantPinReauthSession(req, user.id, { returnTo });
      return {
        redirectTo: returnTo || '/lock?mode=recover',
        flash: {
          type: 'success',
          message: 'Conta confirmada com o Google. Agora você pode redefinir ou desligar o PIN por alguns minutinhos.'
        }
      };
    }

    return {
      redirectTo: '/'
    };
  }

  function getSetupErrorMessage(error) {
    if (error?.exposeToUser) {
      return error.message;
    }

    return getFriendlyErrorMessage(error, {
      defaultMessage: 'A primeira configuração tropeçou aqui. Tenta de novo que eu arrumo a passarela.'
    });
  }

  return {
    ensureInitialSetupState,
    buildSetupForm,
    completeInitialSetupFromBody,
    buildLoginViewState,
    resolveGoogleLoginRedirect,
    handleGoogleLoginSuccess,
    getSetupErrorMessage
  };
}

module.exports = {
  createAuthService
};
