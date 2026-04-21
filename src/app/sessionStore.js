const fs = require('fs');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const { configureRuntimeConfig, getRuntimeConfig } = require('../bootstrap/runtimeConfig');

function createSessionStore(overrides = {}) {
  const runtimeConfig = Object.keys(overrides || {}).length
    ? configureRuntimeConfig(overrides)
    : getRuntimeConfig();

  if (runtimeConfig.sessionDir && runtimeConfig.sessionDir !== ':memory:') {
    fs.mkdirSync(runtimeConfig.sessionDir, { recursive: true });
  }

  return new SQLiteStore({
    db: runtimeConfig.sessionDbName,
    dir: runtimeConfig.sessionDir
  });
}

module.exports = {
  createSessionStore
};
