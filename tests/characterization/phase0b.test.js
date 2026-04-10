const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const { DEFAULT_ADMIN_EMAIL, startIsolatedApp, stopIsolatedApp } = require('../helpers/isolatedAppHarness');

let harness = null;

before(async () => {
  harness = await startIsolatedApp();
});

after(async () => {
  await stopIsolatedApp();
});

test('Fase 0B - caracterização mínima preserva auth, mês, shared-debts e admin/messages', async (t) => {
  await t.test('helper de boot isolado usa banco e sessão temporários', async () => {
    assert.ok(harness, 'O helper precisa iniciar antes dos testes de caracterização.');
    assert.match(harness.dbPath, /organizapay-phase0b-/);
    assert.match(harness.sessionDbPath, /organizapay-phase0b-/);
  });

  await t.test('banco vazio manda /login para /setup e expõe a tela inicial', async () => {
    const loginResponse = await harness.request('/login');
    assert.equal(loginResponse.statusCode, 302);
    assert.equal(loginResponse.headers.location, '/setup');

    const setupResponse = await harness.request('/setup');
    assert.equal(setupResponse.statusCode, 200);
    assert.match(String(setupResponse.headers['content-type'] || ''), /text\/html/i);
    assert.match(setupResponse.body, /Primeira configuração/i);
  });

  await t.test('setup inaugural libera login e preserva o redirect do POST /login', async () => {
    const setupResponse = await harness.completeInitialSetup();
    assert.equal(setupResponse.statusCode, 302);
    assert.equal(setupResponse.headers.location, '/login?setup=done');

    const loginPage = await harness.request('/login');
    assert.equal(loginPage.statusCode, 200);
    assert.match(String(loginPage.headers['content-type'] || ''), /text\/html/i);
    assert.match(loginPage.body, /Entre com sua conta Google/i);

    const legacyLogin = await harness.requestForm('/login');
    assert.equal(legacyLogin.statusCode, 302);
    assert.equal(legacyLogin.headers.location, '/auth/google');
  });

  await t.test('sem sessão, mês, shared-debts e admin/messages voltam para /login depois do setup', async () => {
    const protectedPaths = [
      `/month/${harness.reference.year}/${String(harness.reference.month).padStart(2, '0')}`,
      '/shared-debts',
      '/admin/messages'
    ];

    for (const targetPath of protectedPaths) {
      const response = await harness.request(targetPath);
      assert.equal(response.statusCode, 302, `esperava redirect em ${targetPath}`);
      assert.equal(response.headers.location, '/login');
    }
  });

  await t.test('sessão autenticada renderiza mês, shared-debts e admin/messages sem mexer nas URLs', async () => {
    const session = await harness.createAuthenticatedSession(DEFAULT_ADMIN_EMAIL);
    const authHeaders = { Cookie: session.cookie };
    const monthPath = `/month/${harness.reference.year}/${String(harness.reference.month).padStart(2, '0')}`;

    const monthResponse = await harness.request(monthPath, { headers: authHeaders });
    assert.equal(monthResponse.statusCode, 200);
    assert.match(String(monthResponse.headers['content-type'] || ''), /text\/html/i);
    assert.match(monthResponse.body, /Compras do mês/i);

    const sharedDebtsResponse = await harness.request('/shared-debts', { headers: authHeaders });
    assert.equal(sharedDebtsResponse.statusCode, 200);
    assert.match(String(sharedDebtsResponse.headers['content-type'] || ''), /text\/html/i);
    assert.match(sharedDebtsResponse.body, /Central de acertos/i);

    const adminMessagesResponse = await harness.request('/admin/messages', { headers: authHeaders });
    assert.equal(adminMessagesResponse.statusCode, 200);
    assert.match(String(adminMessagesResponse.headers['content-type'] || ''), /text\/html/i);
    assert.match(adminMessagesResponse.body, /Textos que o app fala/i);
  });
});
