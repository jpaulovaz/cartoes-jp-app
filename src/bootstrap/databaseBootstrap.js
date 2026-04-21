const { configureRuntimeConfig, getRuntimeConfig } = require('./runtimeConfig');

let successfulBootstrap = null;

function sameBootstrapTarget(left, right) {
  if (!left || !right) return false;
  return left.dbPath === right.dbPath
    && left.sessionDbPath === right.sessionDbPath;
}

function buildFailureMessage(runtimeConfig, error) {
  const dbPath = runtimeConfig?.dbPath || 'desconhecido';
  const message = error?.message || 'Erro sem mensagem durante a migração oficial.';
  return `Falha crítica ao executar a trilha oficial de migração do OrganizaPay para o banco ${dbPath}: ${message}`;
}

function bootstrapDatabase(options = {}) {
  configureRuntimeConfig(options);
  const runtimeConfig = getRuntimeConfig();

  if (!options.force && sameBootstrapTarget(successfulBootstrap, runtimeConfig)) {
    return successfulBootstrap;
  }

  try {
    const runMigrations = require('../../scripts/migrate');
    runMigrations();
    successfulBootstrap = {
      dbPath: runtimeConfig.dbPath,
      sessionDbPath: runtimeConfig.sessionDbPath
    };
    return successfulBootstrap;
  } catch (error) {
    const wrappedError = new Error(buildFailureMessage(runtimeConfig, error), { cause: error });
    wrappedError.code = 'ORGANIZAPAY_BOOTSTRAP_MIGRATION_FAILED';
    throw wrappedError;
  }
}

module.exports = {
  bootstrapDatabase
};
