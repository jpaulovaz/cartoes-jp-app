const { createNotificationsRouter } = require('./notifications.routes');
const { createAdminMessagesRouter } = require('./adminMessages.routes');

function registerNotificationsRoutes(app, deps = {}) {
  app.use(createNotificationsRouter(deps));
}

function registerAdminMessagesRoutes(app, deps = {}) {
  app.use('/admin', createAdminMessagesRouter(deps));
}

module.exports = {
  registerNotificationsRoutes,
  registerAdminMessagesRoutes,
  createNotificationsRouter,
  createAdminMessagesRouter
};
