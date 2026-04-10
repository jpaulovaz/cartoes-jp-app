const express = require('express');
const { createAuthController } = require('../controllers/auth.controller');

function createAuthRouter(deps = {}) {
  const router = express.Router();
  const controller = createAuthController(deps);

  router.get('/setup', controller.renderSetup);
  router.post('/setup', controller.submitSetup);
  router.get('/login', controller.renderLogin);
  router.get('/auth/google', controller.startGoogleAuth);
  router.get('/auth/google/callback', controller.handleGoogleCallback);
  router.get('/auth/callback', controller.handleGoogleCallback);
  router.post('/login', controller.redirectLoginPost);
  router.get('/logout', controller.logout);

  return router;
}

module.exports = {
  createAuthRouter
};
