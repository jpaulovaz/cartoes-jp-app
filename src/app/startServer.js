const { configureRuntimeConfig } = require('../bootstrap/runtimeConfig');

function startServer(options = {}) {
  configureRuntimeConfig(options);
  const serverModule = require('../../server');
  return serverModule.startServer(options);
}

module.exports = startServer;
module.exports.startServer = startServer;
