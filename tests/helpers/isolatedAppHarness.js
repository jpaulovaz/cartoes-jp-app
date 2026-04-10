const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const HOST = '127.0.0.1';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_ADMIN_EMAIL = 'admin.phase0b@organizapay.test';
const DEFAULT_ADMIN_NAME = 'Admin Fase 0B';

let activeHarnessPromise = null;

function signSessionId(sessionId, secret) {
  const signature = crypto
    .createHmac('sha256', secret)
    .update(sessionId)
    .digest('base64')
    .replace(/=+$/, '');

  return `${sessionId}.${signature}`;
}

function buildSessionCookie(sessionId, secret) {
  const signedValue = `s:${signSessionId(sessionId, secret)}`;
  return `connect.sid=${encodeURIComponent(signedValue)}`;
}

function request(baseUrl, targetPath, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const body = typeof options.body === 'string' ? options.body : null;
  const headers = { ...(options.headers || {}) };
  const targetUrl = new URL(targetPath, baseUrl);

  if (body !== null && !Object.prototype.hasOwnProperty.call(headers, 'Content-Length')) {
    headers['Content-Length'] = Buffer.byteLength(body);
  }

  return new Promise((resolve, reject) => {
    const req = http.request({
      protocol: targetUrl.protocol,
      hostname: targetUrl.hostname,
      port: targetUrl.port,
      path: `${targetUrl.pathname}${targetUrl.search}`,
      method,
      headers
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode || 0,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8')
        });
      });
    });

    req.on('error', reject);

    if (body !== null) {
      req.write(body);
    }

    req.end();
  });
}

function requestForm(baseUrl, targetPath, formData = {}, options = {}) {
  const body = new URLSearchParams(formData).toString();
  return request(baseUrl, targetPath, {
    ...options,
    method: options.method || 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(options.headers || {})
    },
    body
  });
}

function setStoreSession(store, sessionId, sessionPayload) {
  return new Promise((resolve, reject) => {
    store.set(sessionId, sessionPayload, (error) => {
      if (error) return reject(error);
      return resolve();
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    if (!server || typeof server.close !== 'function') {
      resolve();
      return;
    }

    server.close(() => resolve());
  });
}

function closeStore(store) {
  return new Promise((resolve) => {
    if (!store || typeof store.close !== 'function') {
      resolve();
      return;
    }

    store.close(() => resolve());
  });
}

function getCurrentReference() {
  const now = new Date();
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1
  };
}

function readSessionSecret(db) {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ? LIMIT 1').get('SESSION_SECRET');
  return String(row?.value || 'chave-secreta-padrao');
}

function buildPassportUser(userRow) {
  return {
    id: Number(userRow.id),
    email: userRow.email,
    name: userRow.name,
    role: userRow.role,
    can_import: Number(userRow.can_import ?? 1),
    status: userRow.status || 'active'
  };
}

async function startIsolatedApp() {
  if (activeHarnessPromise) {
    return activeHarnessPromise;
  }

  activeHarnessPromise = (async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'organizapay-phase0b-'));
    const dbPath = path.join(tempRoot, 'data', 'app.test.db');
    const sessionDbPath = path.join(tempRoot, 'sessions', 'sessions.test.sqlite');

    const createApp = require(path.join(PROJECT_ROOT, 'src', 'app', 'createApp'));
    const { createSessionStore } = require(path.join(PROJECT_ROOT, 'src', 'app', 'sessionStore'));

    const app = createApp({ dbPath, sessionDbPath });
    assert.ok(app, 'O helper isolado precisa conseguir montar o app.');

    const db = require(path.join(PROJECT_ROOT, 'src', 'db'));
    const sessionStore = createSessionStore();

    const server = await new Promise((resolve, reject) => {
      let listeningServer = null;

      const onError = (error) => reject(error);
      listeningServer = app.listen(0, HOST, () => {
        listeningServer.off('error', onError);
        resolve(listeningServer);
      });
      listeningServer.once('error', onError);
    });

    const address = server.address();
    assert.ok(address && typeof address === 'object' && Number(address.port) > 0, 'O helper precisa receber uma porta efêmera válida.');

    const baseUrl = `http://${HOST}:${address.port}`;
    const reference = getCurrentReference();

    return {
      app,
      db,
      server,
      sessionStore,
      tempRoot,
      dbPath,
      sessionDbPath,
      baseUrl,
      reference,
      request: (targetPath, options = {}) => request(baseUrl, targetPath, options),
      requestForm: (targetPath, formData = {}, options = {}) => requestForm(baseUrl, targetPath, formData, options),
      getAdminUser(email = DEFAULT_ADMIN_EMAIL) {
        return db.prepare(`
          SELECT id, email, name, role, can_import, status
          FROM users
          WHERE email = ?
          LIMIT 1
        `).get(email);
      },
      async completeInitialSetup(overrides = {}) {
        return requestForm(baseUrl, '/setup', {
          admin_name: DEFAULT_ADMIN_NAME,
          admin_email: DEFAULT_ADMIN_EMAIL,
          GOOGLE_CLIENT_ID: 'organizapay-phase0b.apps.googleusercontent.com',
          GOOGLE_CLIENT_SECRET: 'organizapay-phase0b-secret',
          GOOGLE_CALLBACK_URL: 'http://localhost:3001/auth/google/callback',
          ...overrides
        });
      },
      async createAuthenticatedSession(userOrEmail = DEFAULT_ADMIN_EMAIL) {
        const userRow = typeof userOrEmail === 'string'
          ? this.getAdminUser(userOrEmail)
          : userOrEmail;

        assert.ok(userRow, 'Preciso de um usuário existente para montar a sessão autenticada.');

        const sessionId = crypto.randomBytes(18).toString('hex');
        const expiresAt = new Date(Date.now() + THIRTY_DAYS_MS);
        const sessionPayload = {
          cookie: {
            originalMaxAge: THIRTY_DAYS_MS,
            expires: expiresAt,
            httpOnly: true,
            path: '/',
            secure: false
          },
          passport: {
            user: buildPassportUser(userRow)
          },
          lastActivityAt: Date.now()
        };

        await setStoreSession(sessionStore, sessionId, sessionPayload);

        return {
          sessionId,
          cookie: buildSessionCookie(sessionId, readSessionSecret(db)),
          user: buildPassportUser(userRow)
        };
      }
    };
  })().catch((error) => {
    activeHarnessPromise = null;
    throw error;
  });

  return activeHarnessPromise;
}

async function stopIsolatedApp() {
  if (!activeHarnessPromise) {
    return;
  }

  const harness = await activeHarnessPromise;

  await closeServer(harness.server);
  await closeStore(harness.sessionStore);

  try {
    fs.rmSync(harness.tempRoot, { recursive: true, force: true });
  } catch (error) {
    // limpeza best effort; o importante é não vazar a suíte
  }

  activeHarnessPromise = null;
}

module.exports = {
  DEFAULT_ADMIN_EMAIL,
  DEFAULT_ADMIN_NAME,
  startIsolatedApp,
  stopIsolatedApp
};
