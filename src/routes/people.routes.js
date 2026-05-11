const express = require('express');
const { createPeopleController } = require('../controllers/people.controller');

function createPeopleRouter(deps = {}) {
  const router = express.Router();
  const controller = createPeopleController(deps);

  router.post('/people/profile-photo', deps.ensureAuthenticated, controller.uploadProfilePhoto);
  router.post('/people/profile-photo/use-default', deps.ensureAuthenticated, controller.useDefaultProfilePhoto);
  router.post('/people/profile-photo/remove', deps.ensureAuthenticated, controller.removeProfilePhoto);
  router.get('/people', deps.ensureAuthenticated, controller.renderPeoplePage);
  router.get('/settings', deps.ensureAuthenticated, controller.renderSettingsPage);
  router.get('/people/:id/compras-comigo', deps.ensureAuthenticated, controller.redirectComprasComigo);
  router.get('/people/:id/compras-comigo/:year/:month', deps.ensureAuthenticated, controller.renderComprasComigoPage);
  router.post('/people/:id/compras-comigo/:year/:month/create-charge', deps.ensureAuthenticated, controller.createComprasComigoChargeDraft);
  router.post('/people/notification-preferences', deps.ensureAuthenticated, controller.saveNotificationPreferences);
  router.post('/people', deps.ensureAuthenticated, controller.savePerson);
  router.post('/people/:id/send-friend-request', deps.ensureAuthenticated, controller.sendFriendRequest);
  router.post('/friend-requests/:id/cancel', deps.ensureAuthenticated, controller.cancelFriendRequest);
  router.post('/friend-requests/:id/respond', deps.ensureAuthenticated, controller.respondFriendRequest);
  router.post('/people/:id/unfriend', deps.ensureAuthenticated, controller.unfriend);
  router.post('/people/:id/toggle', deps.ensureAuthenticated, controller.togglePerson);
  router.post('/people/:id/delete', deps.ensureAuthenticated, controller.deletePerson);
  router.post('/people/:id/set-owner', deps.ensureAuthenticated, controller.setOwner);

  return router;
}

module.exports = {
  createPeopleRouter
};
