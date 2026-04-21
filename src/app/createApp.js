const { configureRuntimeConfig } = require('../bootstrap/runtimeConfig');

function createApp(options = {}) {
  configureRuntimeConfig(options);
  const serverModule = require('../../server');
  return serverModule.createApp(options);
}

module.exports = createApp;
module.exports.createApp = createApp;
