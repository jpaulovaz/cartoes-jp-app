const { createAuthRouter } = require('./auth.routes');
const { createSecurityRouter } = require('./security.routes');
const { createNotificationsRouter } = require('./notifications.routes');
const { createAdminMessagesRouter } = require('./adminMessages.routes');

function registerAuthRoutes(app, deps = {}) {
  app.use(createAuthRouter(deps));
}

function registerSecurityRoutes(app, deps = {}) {
  app.use(createSecurityRouter(deps));
}

function registerNotificationsRoutes(app, deps = {}) {
  app.use(createNotificationsRouter(deps));
}

function registerAdminMessagesRoutes(app, deps = {}) {
  app.use('/admin', createAdminMessagesRouter(deps));
}

module.exports = {
  registerAuthRoutes,
  registerSecurityRoutes,
  registerNotificationsRoutes,
  registerAdminMessagesRoutes,
  createAuthRouter,
  createSecurityRouter,
  createNotificationsRouter,
  createAdminMessagesRouter
};
