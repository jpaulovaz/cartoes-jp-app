const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', '..', relativePath), 'utf8');
}

test('fase 3B registra router real para admin previsivel no runtime', () => {
  const runtimeSource = readProjectFile('server.runtime.js');

  assert.match(runtimeSource, /registerAdminCoreRoutes\(app, \{/);

  assert.doesNotMatch(runtimeSource, /app\.get\("\/admin", ensureAuthenticated/);
  assert.doesNotMatch(runtimeSource, /app\.post\("\/admin\/settings\/:section", ensureAuthenticated/);
  assert.doesNotMatch(runtimeSource, /app\.post\('\/admin\/email\/test-connection', ensureAuthenticated/);
  assert.doesNotMatch(runtimeSource, /app\.post\('\/admin\/email\/send-test', ensureAuthenticated/);
  assert.doesNotMatch(runtimeSource, /app\.get\('\/admin\/backup\/guide', ensureAuthenticated/);
  assert.doesNotMatch(runtimeSource, /app\.get\('\/admin\/backup\/google\/connect', ensureAuthenticated/);
  assert.doesNotMatch(runtimeSource, /app\.get\('\/admin\/backup\/google\/callback', ensureAuthenticated/);
  assert.doesNotMatch(runtimeSource, /app\.post\('\/admin\/backup\/google\/disconnect', ensureAuthenticated/);
  assert.doesNotMatch(runtimeSource, /app\.post\('\/admin\/backup\/run', ensureAuthenticated/);
  assert.doesNotMatch(runtimeSource, /app\.post\('\/admin\/backup\/restore', ensureAuthenticated/);
  assert.doesNotMatch(runtimeSource, /app\.get\('\/admin\/backup\/download\/:backupId\/:slot', ensureAuthenticated/);
});

test('fase 3B cria route controller service e repository para admin previsivel', () => {
  const routesIndex = readProjectFile('src/routes/index.js');
  const adminCoreRoutes = readProjectFile('src/routes/adminCore.routes.js');
  const adminCoreController = readProjectFile('src/controllers/adminCore.controller.js');
  const adminCoreService = readProjectFile('src/services/adminCore.service.js');
  const adminCoreRepository = readProjectFile('src/repositories/adminCore.repository.js');

  assert.match(routesIndex, /registerAdminCoreRoutes/);
  assert.match(adminCoreRoutes, /express\.Router\(\)/);
  assert.match(adminCoreRoutes, /'\/backup\/restore'/);
  assert.match(adminCoreRoutes, /'\/email\/send-test'/);
  assert.match(adminCoreController, /createAdminCoreService/);
  assert.match(adminCoreService, /createAdminCoreRepository/);
  assert.match(adminCoreRepository, /createServerBackup/);
  assert.match(adminCoreRepository, /restoreServerBackupFromZip/);
});
