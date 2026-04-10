const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', '..', relativePath), 'utf8');
}

test('fase 5A registra router real para shared-debts no runtime', () => {
  const runtimeSource = readProjectFile('server.runtime.js');

  assert.match(runtimeSource, /registerSharedDebtsRoutes\(app, \{/);
  assert.doesNotMatch(runtimeSource, /app\.get\('\/shared-debts', ensureAuthenticated/);
  assert.doesNotMatch(runtimeSource, /app\.get\('\/shared-debts\/archive', ensureAuthenticated/);
  assert.doesNotMatch(runtimeSource, /app\.post\('\/shared-debts\/:id\/archive', ensureAuthenticated/);
  assert.doesNotMatch(runtimeSource, /app\.post\('\/shared-debts\/manual', ensureAuthenticated/);
  assert.doesNotMatch(runtimeSource, /app\.post\('\/shared-debts\/batches\/:id\/respond', ensureAuthenticated/);
  assert.doesNotMatch(runtimeSource, /app\.get\('\/shared-debts\/monthly-settlements\/:id\/prepare', ensureAuthenticated/);
  assert.doesNotMatch(runtimeSource, /app\.get\('\/shared-debts\/:id\/pix', ensureAuthenticated/);
  assert.doesNotMatch(runtimeSource, /app\.post\('\/shared-debts\/bulk\/confirm-receipt', ensureAuthenticated/);
});

test('fase 5A cria route controller service e repository para shared-debts', () => {
  const routesIndex = readProjectFile('src/routes/index.js');
  const routesSource = readProjectFile('src/routes/sharedDebts.routes.js');
  const controllerSource = readProjectFile('src/controllers/sharedDebts.controller.js');
  const serviceSource = readProjectFile('src/services/sharedDebts.service.js');
  const repositorySource = readProjectFile('src/repositories/sharedDebts.repository.js');

  assert.match(routesIndex, /registerSharedDebtsRoutes/);
  assert.match(routesSource, /express\.Router\(\)/);
  assert.match(routesSource, /'\/shared-debts\/monthly-settlements\/:id\/confirm-payment'/);
  assert.match(controllerSource, /createSharedDebtsService/);
  assert.match(controllerSource, /controller\.createMonthlySettlementPix|async createMonthlySettlementPix/);
  assert.match(serviceSource, /createSharedDebtsRepository/);
  assert.match(serviceSource, /createMonthlySettlementPix/);
  assert.match(serviceSource, /bulkConfirmReceipt/);
  assert.match(repositorySource, /getBatchForReceiver/);
  assert.match(repositorySource, /getManualSharedDebtRequestForParticipant/);
});
