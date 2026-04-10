const express = require('express');
const { createNotificationsController } = require('../controllers/notifications.controller');

function createNotificationsRouter(deps = {}) {
  const router = express.Router();
  const controller = createNotificationsController(deps);

  router.post('/push/subscribe', deps.ensureAuthenticated, controller.subscribePush);
  router.post('/push/unsubscribe', deps.ensureAuthenticated, controller.unsubscribePush);
  router.get('/notifications', deps.ensureAuthenticated, controller.notificationsHome);
  router.post('/notifications/read-all', deps.ensureAuthenticated, controller.markAllAsRead);
  router.post('/notifications/clear-read', deps.ensureAuthenticated, controller.clearRead);
  router.post('/notifications/:id/read', deps.ensureAuthenticated, controller.readNotification);
  router.get('/notifications/:id/open', deps.ensureAuthenticated, controller.openNotification);

  return router;
}

module.exports = {
  createNotificationsRouter
};
