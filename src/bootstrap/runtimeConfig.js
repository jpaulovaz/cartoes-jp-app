const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const ENV_DB_PATH = 'ORGANIZAPAY_DB_PATH';
const ENV_SESSION_DB_PATH = 'ORGANIZAPAY_SESSION_DB_PATH';
const ENV_SESSION_DIR = 'ORGANIZAPAY_SESSION_DIR';
const ENV_SESSION_DB_NAME = 'ORGANIZAPAY_SESSION_DB';

let runtimeConfig = null;
let runtimeConfigLocked = false;

function normalizeString(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function resolvePathValue(value, fallbackValue) {
  const normalized = normalizeString(value);
  if (!normalized) return fallbackValue;
  if (normalized === ':memory:') return normalized;
  return path.resolve(normalized);
}

function buildRuntimeConfig(overrides = {}, base = {}) {
  const dbPath = resolvePathValue(
    overrides.dbPath ?? base.dbPath ?? process.env[ENV_DB_PATH],
    path.join(PROJECT_ROOT, 'data', 'app.db')
  );

  const explicitSessionDbPath = resolvePathValue(
    overrides.sessionDbPath ?? base.sessionDbPath ?? process.env[ENV_SESSION_DB_PATH],
    null
  );

  let sessionDir = null;
  let sessionDbName = null;
  let sessionDbPath = null;

  if (explicitSessionDbPath) {
    sessionDbPath = explicitSessionDbPath;
    sessionDir = path.dirname(explicitSessionDbPath);
    sessionDbName = path.basename(explicitSessionDbPath);
  } else {
    sessionDir = resolvePathValue(
      overrides.sessionDir ?? base.sessionDir ?? process.env[ENV_SESSION_DIR],
      process.cwd()
    );
    sessionDbName = normalizeString(
      overrides.sessionDbName ?? base.sessionDbName ?? process.env[ENV_SESSION_DB_NAME]
    ) || 'sessions.sqlite';
    sessionDbPath = path.join(sessionDir, sessionDbName);
  }

  return {
    dbPath,
    sessionDir,
    sessionDbName,
    sessionDbPath
  };
}

function sameRuntimeConfig(left, right) {
  if (!left || !right) return false;
  return left.dbPath === right.dbPath
    && left.sessionDir === right.sessionDir
    && left.sessionDbName === right.sessionDbName
    && left.sessionDbPath === right.sessionDbPath;
}

function configureRuntimeConfig(overrides = {}) {
  const nextConfig = buildRuntimeConfig(overrides, runtimeConfig || {});

  if (runtimeConfigLocked) {
    if (!sameRuntimeConfig(runtimeConfig, nextConfig)) {
      throw new Error('A configuração de runtime do AcerttaPay já foi inicializada nesta execução.');
    }
    return runtimeConfig;
  }

  runtimeConfig = nextConfig;
  return runtimeConfig;
}

function getRuntimeConfig() {
  if (!runtimeConfig) {
    runtimeConfig = buildRuntimeConfig();
  }
  runtimeConfigLocked = true;
  return runtimeConfig;
}

function peekRuntimeConfig() {
  return runtimeConfig ? { ...runtimeConfig } : null;
}

module.exports = {
  configureRuntimeConfig,
  getRuntimeConfig,
  peekRuntimeConfig
};
