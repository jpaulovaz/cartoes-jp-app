require('dotenv').config();

const { configureRuntimeConfig } = require('./src/bootstrap/runtimeConfig');
const { bootstrapDatabase } = require('./src/bootstrap/databaseBootstrap');

let runtimeModule = null;

function loadRuntimeModule(options = {}) {
  configureRuntimeConfig(options);
  bootstrapDatabase(options);

  if (!runtimeModule) {
    runtimeModule = require('./server.runtime');
  }

  return runtimeModule;
}

function createApp(options = {}) {
  return loadRuntimeModule(options).createApp(options);
}

function startServer(options = {}) {
  return loadRuntimeModule(options).startServer(options);
}

function startSchedulers(options = {}) {
  return loadRuntimeModule(options).startSchedulers(options);
}

function stopSchedulers(options = {}) {
  return loadRuntimeModule(options).stopSchedulers(options);
}

module.exports = {
  get app() {
    return createApp();
  },
  createApp,
  startServer,
  startSchedulers,
  stopSchedulers,
  bootstrapDatabase
};

if (require.main === module) {
  startServer();
}
