const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', '..', relativePath), 'utf8');
}

test('fase 2 registra routers reais por area no runtime', () => {
  const runtimeSource = readProjectFile('server.runtime.js');

  assert.match(runtimeSource, /registerNotificationsRoutes\(app, \{/);
  assert.match(runtimeSource, /registerAdminMessagesRoutes\(app, \{/);

  assert.doesNotMatch(runtimeSource, /app\.post\('\/push\/subscribe'/);
  assert.doesNotMatch(runtimeSource, /app\.post\('\/push\/unsubscribe'/);
  assert.doesNotMatch(runtimeSource, /app\.get\("\/notifications"/);
  assert.doesNotMatch(runtimeSource, /app\.post\("\/notifications\/read-all"/);
  assert.doesNotMatch(runtimeSource, /app\.post\('\/notifications\/clear-read'/);
  assert.doesNotMatch(runtimeSource, /app\.post\("\/notifications\/:id\/read"/);
  assert.doesNotMatch(runtimeSource, /app\.get\("\/notifications\/:id\/open"/);

  assert.doesNotMatch(runtimeSource, /app\.get\('\/admin\/messages'/);
  assert.doesNotMatch(runtimeSource, /app\.get\('\/admin\/messages\/export\.csv'/);
  assert.doesNotMatch(runtimeSource, /app\.post\('\/admin\/messages\/import'/);
  assert.doesNotMatch(runtimeSource, /app\.post\('\/admin\/messages\/import\/confirm'/);
  assert.doesNotMatch(runtimeSource, /app\.post\('\/admin\/messages\/import\/cancel'/);
  assert.doesNotMatch(runtimeSource, /app\.post\('\/admin\/messages\/:messageKey'/);
  assert.doesNotMatch(runtimeSource, /app\.post\('\/admin\/messages\/:messageKey\/reset'/);
  assert.doesNotMatch(runtimeSource, /app\.post\('\/admin\/messages\/:messageKey\/preview'/);
  assert.doesNotMatch(runtimeSource, /app\.post\('\/admin\/messages\/:messageKey\/push-test'/);
});

test('fase 2 cria shell de routes e controllers para notifications e admin messages', () => {
  const indexSource = readProjectFile('src/routes/index.js');
  const notificationsRoutesSource = readProjectFile('src/routes/notifications.routes.js');
  const adminMessagesRoutesSource = readProjectFile('src/routes/adminMessages.routes.js');
  const notificationsControllerSource = readProjectFile('src/controllers/notifications.controller.js');
  const adminMessagesControllerSource = readProjectFile('src/controllers/adminMessages.controller.js');

  assert.match(indexSource, /registerNotificationsRoutes/);
  assert.match(indexSource, /registerAdminMessagesRoutes/);

  assert.match(notificationsRoutesSource, /express\.Router\(\)/);
  assert.match(notificationsRoutesSource, /'\/push\/subscribe'/);
  assert.match(notificationsRoutesSource, /'\/notifications\/:id\/open'/);

  assert.match(adminMessagesRoutesSource, /express\.Router\(\)/);
  assert.match(adminMessagesRoutesSource, /'\/messages\/export\.csv'/);
  assert.match(adminMessagesRoutesSource, /'\/messages\/:messageKey\/push-test'/);

  assert.match(notificationsControllerSource, /function createNotificationsController/);
  assert.match(adminMessagesControllerSource, /function createAdminMessagesController/);
});
