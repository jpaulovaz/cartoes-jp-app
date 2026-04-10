const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', '..', relativePath), 'utf8');
}

test('fase 3A registra routers reais de auth e security no runtime', () => {
  const runtimeSource = readProjectFile('server.runtime.js');

  assert.match(runtimeSource, /registerAuthRoutes\(app, \{/);
  assert.match(runtimeSource, /registerSecurityRoutes\(app, \{/);

  assert.doesNotMatch(runtimeSource, /app\.get\('\/setup'/);
  assert.doesNotMatch(runtimeSource, /app\.post\('\/setup'/);
  assert.doesNotMatch(runtimeSource, /app\.get\('\/login'/);
  assert.doesNotMatch(runtimeSource, /app\.get\('\/auth\/google'/);
  assert.doesNotMatch(runtimeSource, /app\.get\('\/auth\/google\/callback'/);
  assert.doesNotMatch(runtimeSource, /app\.post\('\/login'/);
  assert.doesNotMatch(runtimeSource, /app\.get\('\/logout'/);

  assert.doesNotMatch(runtimeSource, /app\.post\('\/people\/security\/pin\/setup'/);
  assert.doesNotMatch(runtimeSource, /app\.post\('\/people\/security\/pin\/idle'/);
  assert.doesNotMatch(runtimeSource, /app\.post\('\/people\/security\/pin\/disable'/);
  assert.doesNotMatch(runtimeSource, /app\.post\('\/people\/security\/passkeys\/register\/options'/);
  assert.doesNotMatch(runtimeSource, /app\.post\('\/lock\/passkey\/options'/);
  assert.doesNotMatch(runtimeSource, /app\.get\('\/lock'/);
  assert.doesNotMatch(runtimeSource, /app\.post\('\/lock\/unlock'/);
  assert.doesNotMatch(runtimeSource, /app\.post\('\/lock\/engage'/);
  assert.doesNotMatch(runtimeSource, /app\.post\('\/lock\/touch'/);
  assert.doesNotMatch(runtimeSource, /app\.get\('\/lock\/reauth\/google'/);
  assert.doesNotMatch(runtimeSource, /app\.post\('\/lock\/recovery\/setup'/);
  assert.doesNotMatch(runtimeSource, /app\.post\('\/lock\/recovery\/disable'/);
});

test('fase 3A cria services e repositories reais para auth security notifications e admin messages', () => {
  const routesIndex = readProjectFile('src/routes/index.js');
  const authRoutes = readProjectFile('src/routes/auth.routes.js');
  const securityRoutes = readProjectFile('src/routes/security.routes.js');
  const authController = readProjectFile('src/controllers/auth.controller.js');
  const securityController = readProjectFile('src/controllers/security.controller.js');
  const notificationsController = readProjectFile('src/controllers/notifications.controller.js');
  const adminMessagesController = readProjectFile('src/controllers/adminMessages.controller.js');
  const authService = readProjectFile('src/services/auth.service.js');
  const securityService = readProjectFile('src/services/security.service.js');
  const notificationsService = readProjectFile('src/services/notifications.service.js');
  const adminMessagesService = readProjectFile('src/services/adminMessages.service.js');
  const authRepository = readProjectFile('src/repositories/auth.repository.js');
  const securityRepository = readProjectFile('src/repositories/security.repository.js');
  const notificationsRepository = readProjectFile('src/repositories/notifications.repository.js');
  const adminMessagesRepository = readProjectFile('src/repositories/adminMessages.repository.js');

  assert.match(routesIndex, /registerAuthRoutes/);
  assert.match(routesIndex, /registerSecurityRoutes/);

  assert.match(authRoutes, /express\.Router\(\)/);
  assert.match(authRoutes, /'\/auth\/google\/callback'/);
  assert.match(securityRoutes, /express\.Router\(\)/);
  assert.match(securityRoutes, /'\/lock\/reauth\/google'/);

  assert.match(authController, /createAuthService/);
  assert.match(securityController, /createSecurityService/);
  assert.match(notificationsController, /createNotificationsService/);
  assert.match(adminMessagesController, /createAdminMessagesService/);

  assert.match(authService, /createAuthRepository/);
  assert.match(securityService, /createSecurityRepository/);
  assert.match(notificationsService, /createNotificationsRepository/);
  assert.match(adminMessagesService, /createAdminMessagesRepository/);

  assert.match(authRepository, /completeInitialSetup/);
  assert.match(securityRepository, /getUserSecuritySettings/);
  assert.match(notificationsRepository, /markAllNotificationsAsRead/);
  assert.match(adminMessagesRepository, /buildMessageCsvExport/);
});
