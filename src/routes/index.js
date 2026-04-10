const { createAuthRouter } = require('./auth.routes');
const { createSecurityRouter } = require('./security.routes');
const { createNotificationsRouter } = require('./notifications.routes');
const { createAdminMessagesRouter } = require('./adminMessages.routes');
const { createAdminCoreRouter } = require('./adminCore.routes');
const { createCardsRouter } = require('./cards.routes');
const { createFinancesRouter } = require('./finances.routes');

function registerAuthRoutes(app, deps = {}) {
  app.use(createAuthRouter(deps));
}

function registerSecurityRoutes(app, deps = {}) {
  app.use(createSecurityRouter(deps));
}

function registerNotificationsRoutes(app, deps = {}) {
  app.use(createNotificationsRouter(deps));
}

function registerAdminCoreRoutes(app, deps = {}) {
  app.use('/admin', createAdminCoreRouter(deps));
}

function registerAdminMessagesRoutes(app, deps = {}) {
  app.use('/admin', createAdminMessagesRouter(deps));
}

function registerCardsRoutes(app, deps = {}) {
  app.use(createCardsRouter(deps));
}

function registerFinancesRoutes(app, deps = {}) {
  app.use(createFinancesRouter(deps));
}

module.exports = {
  registerAuthRoutes,
  registerSecurityRoutes,
  registerNotificationsRoutes,
  registerAdminCoreRoutes,
  registerAdminMessagesRoutes,
  registerCardsRoutes,
  registerFinancesRoutes,
  createAuthRouter,
  createSecurityRouter,
  createNotificationsRouter,
  createAdminCoreRouter,
  createAdminMessagesRouter,
  createCardsRouter,
  createFinancesRouter
};
