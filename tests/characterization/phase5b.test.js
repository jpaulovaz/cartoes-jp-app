const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', '..', relativePath), 'utf8');
}

test('fase 5B registra routers reais para people e share/whatsapp no runtime', () => {
  const runtimeSource = readProjectFile('server.runtime.js');

  assert.match(runtimeSource, /registerPeopleRoutes\(app, \{/);
  assert.match(runtimeSource, /registerSocialShareRoutes\(app, \{/);

  assert.doesNotMatch(runtimeSource, /app\.post\('\/people\/profile-photo', ensureAuthenticated/);
  assert.doesNotMatch(runtimeSource, /app\.get\("\/people", ensureAuthenticated/);
  assert.doesNotMatch(runtimeSource, /app\.get\('\/people\/:id\/compras-comigo', ensureAuthenticated/);
  assert.doesNotMatch(runtimeSource, /app\.post\("\/people", ensureAuthenticated/);
  assert.doesNotMatch(runtimeSource, /app\.post\('\/friend-requests\/:id\/respond', ensureAuthenticated/);
  assert.doesNotMatch(runtimeSource, /app\.post\("\/people\/:id\/delete", ensureAuthenticated/);
  assert.doesNotMatch(runtimeSource, /app\.post\("\/people\/:id\/set-owner", ensureAuthenticated/);
  assert.doesNotMatch(runtimeSource, /app\.get\("\/share\/:year\/:month\/:personId", ensureAuthenticated/);
  assert.doesNotMatch(runtimeSource, /app\.get\("\/whatsapp\/:year\/:month\/:personId", ensureAuthenticated/);
  assert.doesNotMatch(runtimeSource, /app\.post\("\/whatsapp\/send-automation", ensureAuthenticated/);
});

test('fase 5B cria route controller service e repository para people e share/whatsapp', () => {
  const routesIndex = readProjectFile('src/routes/index.js');
  const peopleRoutes = readProjectFile('src/routes/people.routes.js');
  const socialShareRoutes = readProjectFile('src/routes/socialShare.routes.js');
  const peopleController = readProjectFile('src/controllers/people.controller.js');
  const socialShareController = readProjectFile('src/controllers/socialShare.controller.js');
  const peopleService = readProjectFile('src/services/people.service.js');
  const socialShareService = readProjectFile('src/services/socialShare.service.js');
  const peopleRepository = readProjectFile('src/repositories/people.repository.js');
  const socialShareRepository = readProjectFile('src/repositories/socialShare.repository.js');

  assert.match(routesIndex, /registerPeopleRoutes/);
  assert.match(routesIndex, /registerSocialShareRoutes/);
  assert.match(peopleRoutes, /express\.Router\(\)/);
  assert.match(peopleRoutes, /'\/friend-requests\/:id\/respond'/);
  assert.match(socialShareRoutes, /express\.Router\(\)/);
  assert.match(socialShareRoutes, /'\/whatsapp\/send-automation'/);
  assert.match(peopleController, /createPeopleService/);
  assert.match(socialShareController, /createSocialShareService/);
  assert.match(peopleService, /createPeopleRepository/);
  assert.match(socialShareService, /createSocialShareRepository/);
  assert.match(peopleService, /sendFriendRequest/);
  assert.match(peopleService, /deletePerson/);
  assert.match(socialShareService, /sendWhatsappAutomation/);
  assert.match(socialShareService, /sendEvolutionMediaWithFallback/);
  assert.match(peopleRepository, /insertFriendRequest/);
  assert.match(peopleRepository, /updateUserProfileSignature/);
  assert.match(socialShareRepository, /getPersonStatementExportData/);
  assert.match(socialShareRepository, /normalizePhoneForWhatsapp/);
});
