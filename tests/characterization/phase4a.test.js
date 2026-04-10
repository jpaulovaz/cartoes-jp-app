const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', '..', relativePath), 'utf8');
}

test('fase 4A registra routers reais para cards e finances no runtime', () => {
  const runtimeSource = readProjectFile('server.runtime.js');

  assert.match(runtimeSource, /registerCardsRoutes\(app, \{/);
  assert.match(runtimeSource, /registerFinancesRoutes\(app, \{/);

  assert.doesNotMatch(runtimeSource, /app\.get\("\/cards", ensureAuthenticated/);
  assert.doesNotMatch(runtimeSource, /app\.post\("\/cards", ensureAuthenticated/);
  assert.doesNotMatch(runtimeSource, /app\.post\("\/cards\/:id\/update", ensureAuthenticated/);
  assert.doesNotMatch(runtimeSource, /app\.post\("\/cards\/:id\/toggle", ensureAuthenticated/);
  assert.doesNotMatch(runtimeSource, /app\.post\("\/cards\/:id\/delete", ensureAuthenticated/);

  assert.doesNotMatch(runtimeSource, /app\.get\("\/finances\/details\/:id", ensureAuthenticated/);
  assert.doesNotMatch(runtimeSource, /app\.post\("\/finances\/add-row", ensureAuthenticated, express\.json\(\),/);
  assert.doesNotMatch(runtimeSource, /app\.post\("\/finances\/variable\/:id", ensureAuthenticated, express\.json\(\),/);
  assert.doesNotMatch(runtimeSource, /app\.post\("\/finances\/fixed\/:id", ensureAuthenticated, express\.json\(\),/);
  assert.doesNotMatch(runtimeSource, /app\.post\("\/finances\/payment-toggle\/:id", ensureAuthenticated, express\.json\(\),/);
  assert.doesNotMatch(runtimeSource, /app\.post\("\/finance-items\/payment-toggle\/:id", ensureAuthenticated, express\.json\(\),/);
  assert.doesNotMatch(runtimeSource, /app\.post\("\/finances\/update\/:id", ensureAuthenticated, express\.json\(\),/);
  assert.doesNotMatch(runtimeSource, /app\.post\("\/finances\/delete\/:id", ensureAuthenticated/);
  assert.doesNotMatch(runtimeSource, /app\.post\("\/finances\/notes\/:year\/:month", ensureAuthenticated, express\.json\(\),/);
  assert.doesNotMatch(runtimeSource, /app\.post\("\/finances\/toggle-close", ensureAuthenticated, express\.json\(\),/);
});

test('fase 4A cria route controller service e repository para cards e finances', () => {
  const routesIndex = readProjectFile('src/routes/index.js');
  const cardsRoutes = readProjectFile('src/routes/cards.routes.js');
  const financesRoutes = readProjectFile('src/routes/finances.routes.js');
  const cardsController = readProjectFile('src/controllers/cards.controller.js');
  const financesController = readProjectFile('src/controllers/finances.controller.js');
  const cardsService = readProjectFile('src/services/cards.service.js');
  const financesService = readProjectFile('src/services/finances.service.js');
  const cardsRepository = readProjectFile('src/repositories/cards.repository.js');
  const financesRepository = readProjectFile('src/repositories/finances.repository.js');

  assert.match(routesIndex, /registerCardsRoutes/);
  assert.match(routesIndex, /registerFinancesRoutes/);
  assert.match(cardsRoutes, /express\.Router\(\)/);
  assert.match(cardsRoutes, /'\/cards\/:id\/delete'/);
  assert.match(financesRoutes, /express\.Router\(\)/);
  assert.match(financesRoutes, /'\/finances\/toggle-close'/);
  assert.match(cardsController, /createCardsService/);
  assert.match(financesController, /createFinancesService/);
  assert.match(cardsService, /createCardsRepository/);
  assert.match(financesService, /createFinancesRepository/);
  assert.match(cardsRepository, /findCardByNameForUser/);
  assert.match(financesRepository, /serializeFinanceForApi/);
  assert.match(financesRepository, /monthly_finance_items/);
});
