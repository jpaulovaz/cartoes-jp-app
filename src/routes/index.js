const { createAuthRouter } = require('./auth.routes');
const { createSecurityRouter } = require('./security.routes');
const { createNotificationsRouter } = require('./notifications.routes');
const { createAdminMessagesRouter } = require('./adminMessages.routes');
const { createAdminCoreRouter } = require('./adminCore.routes');
const { createCardsRouter } = require('./cards.routes');
const { createFinancesRouter } = require('./finances.routes');
const { createImportRouter } = require('./import.routes');
const { createSummaryRouter } = require('./summary.routes');
const { createSharedDebtsRouter } = require('./sharedDebts.routes');
const { createPeopleRouter } = require('./people.routes');
const { createSocialShareRouter } = require('./socialShare.routes');

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

function registerImportRoutes(app, deps = {}) {
  app.use(createImportRouter(deps));
}

function registerSummaryRoutes(app, deps = {}) {
  app.use(createSummaryRouter(deps));
}

function registerSharedDebtsRoutes(app, deps = {}) {
  app.use(createSharedDebtsRouter(deps));
}

function registerPeopleRoutes(app, deps = {}) {
  app.use(createPeopleRouter(deps));
}

function registerSocialShareRoutes(app, deps = {}) {
  app.use(createSocialShareRouter(deps));
}

module.exports = {
  registerAuthRoutes,
  registerSecurityRoutes,
  registerNotificationsRoutes,
  registerAdminCoreRoutes,
  registerAdminMessagesRoutes,
  registerCardsRoutes,
  registerFinancesRoutes,
  registerImportRoutes,
  registerSummaryRoutes,
  registerSharedDebtsRoutes,
  registerPeopleRoutes,
  registerSocialShareRoutes,
  createAuthRouter,
  createSecurityRouter,
  createNotificationsRouter,
  createAdminCoreRouter,
  createAdminMessagesRouter,
  createCardsRouter,
  createFinancesRouter,
  createImportRouter,
  createSummaryRouter,
  createSharedDebtsRouter,
  createPeopleRouter,
  createSocialShareRouter
};
