const { createAuthService } = require('../services/auth.service');

function createAuthController(deps = {}) {
  const {
    renderSetup,
    safeRenderView,
    passport,
    setFlash
  } = deps;

  const service = deps.service || createAuthService(deps);

  return {
    renderSetup(req, res) {
      if (!service.ensureInitialSetupState()) {
        return res.redirect(req.isAuthenticated?.() ? '/' : '/login');
      }

      return renderSetup(res);
    },

    submitSetup(req, res) {
      if (!service.ensureInitialSetupState()) {
        return res.redirect('/login');
      }

      const rawForm = service.buildSetupForm(req.body);

      try {
        service.completeInitialSetupFromBody(req.body);
        return res.redirect('/login?setup=done');
      } catch (error) {
        return renderSetup(res, {
          error: service.getSetupErrorMessage(error),
          form: error?.form || rawForm
        });
      }
    },

    renderLogin(req, res) {
      if (service.ensureInitialSetupState()) {
        return res.redirect('/setup');
      }

      return safeRenderView(res, 'login_oauth', service.buildLoginViewState(req.query));
    },

    startGoogleAuth(req, res, next) {
      const redirectTarget = service.resolveGoogleLoginRedirect();
      if (redirectTarget) {
        return res.redirect(redirectTarget);
      }

      return passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
    },

    handleGoogleCallback(req, res, next) {
      const redirectTarget = service.resolveGoogleLoginRedirect();
      if (redirectTarget) {
        return res.redirect(redirectTarget);
      }

      return passport.authenticate('google', (error, user) => {
        if (error || !user) {
          return res.redirect('/login?error=auth_failed');
        }

        return req.logIn(user, (loginError) => {
          if (loginError) {
            return next(loginError);
          }

          const outcome = service.handleGoogleLoginSuccess(req, user);
          if (outcome.flash) {
            setFlash(req, outcome.flash.type, outcome.flash.message);
          }
          return res.redirect(outcome.redirectTo || '/');
        });
      })(req, res, next);
    },

    redirectLoginPost(req, res) {
      if (service.ensureInitialSetupState()) {
        return res.redirect('/setup');
      }

      return res.redirect('/auth/google');
    },

    logout(req, res) {
      req.logout((err) => {
        if (err) {
          return res.status(500).send('Erro ao fazer logout');
        }

        req.session.destroy(() => {
          res.redirect(service.ensureInitialSetupState() ? '/setup' : '/login');
        });
      });
    }
  };
}

module.exports = {
  createAuthController
};
