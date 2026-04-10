const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', '..', relativePath), 'utf8');
}

test('fase 4B registra routers reais para import e summary no runtime', () => {
  const runtimeSource = readProjectFile('server.runtime.js');

  assert.match(runtimeSource, /registerImportRoutes\(app, \{/);
  assert.match(runtimeSource, /registerSummaryRoutes\(app, \{/);

  assert.doesNotMatch(runtimeSource, /app\.get\("\/import", ensureAuthenticated, ensureCanImport/);
  assert.doesNotMatch(runtimeSource, /app\.post\("\/import", ensureAuthenticated, ensureCanImport/);
  assert.doesNotMatch(runtimeSource, /app\.post\('\/import\/confirm', ensureAuthenticated, ensureCanImport/);
  assert.doesNotMatch(runtimeSource, /app\.post\('\/import\/preview\/cancel', ensureAuthenticated, ensureCanImport/);

  assert.doesNotMatch(runtimeSource, /app\.get\("\/analytics\/:year\/:month", ensureAuthenticated/);
  assert.doesNotMatch(runtimeSource, /app\.get\("\/summary\/:year\/:month", ensureAuthenticated/);
  assert.doesNotMatch(runtimeSource, /merchant-suggestions\/confirm"\], ensureAuthenticated/);
  assert.doesNotMatch(runtimeSource, /merchant-suggestions\/dismiss"\], ensureAuthenticated/);
  assert.doesNotMatch(runtimeSource, /merchant-learning\/pause"\], ensureAuthenticated/);
  assert.doesNotMatch(runtimeSource, /merchant-learning\/resume"\], ensureAuthenticated/);
  assert.doesNotMatch(runtimeSource, /app\.post\("\/summary\/:year\/:month\/cards", ensureAuthenticated/);
  assert.doesNotMatch(runtimeSource, /app\.post\("\/summary\/:year\/:month\/cards\/async", ensureAuthenticated/);
  assert.doesNotMatch(runtimeSource, /app\.post\("\/summary\/:year\/:month\/people", ensureAuthenticated/);
  assert.doesNotMatch(runtimeSource, /app\.post\("\/summary\/:year\/:month\/people\/async", ensureAuthenticated/);
});

test('fase 4B cria route controller service e repository para import e summary', () => {
  const routesIndex = readProjectFile('src/routes/index.js');
  const importRoutes = readProjectFile('src/routes/import.routes.js');
  const summaryRoutes = readProjectFile('src/routes/summary.routes.js');
  const importController = readProjectFile('src/controllers/import.controller.js');
  const summaryController = readProjectFile('src/controllers/summary.controller.js');
  const importService = readProjectFile('src/services/import.service.js');
  const summaryService = readProjectFile('src/services/summary.service.js');
  const importRepository = readProjectFile('src/repositories/import.repository.js');
  const summaryRepository = readProjectFile('src/repositories/summary.repository.js');

  assert.match(routesIndex, /registerImportRoutes/);
  assert.match(routesIndex, /registerSummaryRoutes/);
  assert.match(importRoutes, /express\.Router\(\)/);
  assert.match(importRoutes, /'\/import\/preview\/cancel'/);
  assert.match(summaryRoutes, /express\.Router\(\)/);
  assert.match(summaryRoutes, /'\/summary\/:year\/:month\/people\/async'/);
  assert.match(importController, /createImportService/);
  assert.match(summaryController, /createSummaryService/);
  assert.match(importService, /createImportRepository/);
  assert.match(summaryService, /createSummaryRepository/);
  assert.match(importRepository, /persistImportConfirmation/);
  assert.match(summaryRepository, /buildMonthlyReviewViewModel/);
  assert.match(summaryRepository, /upsertMerchantLearningFeedback/);
});
