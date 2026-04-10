const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

function createTempRuntime(prefix = 'organizapay-phase1a-') {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const dbPath = path.join(tempRoot, 'data', 'app.test.db');
  const sessionDbPath = path.join(tempRoot, 'sessions', 'sessions.test.sqlite');

  return {
    tempRoot,
    dbPath,
    sessionDbPath,
    env: {
      ...process.env,
      ORGANIZAPAY_DB_PATH: dbPath,
      ORGANIZAPAY_SESSION_DB_PATH: sessionDbPath
    }
  };
}

function cleanupTempRuntime(tempRoot) {
  try {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  } catch (error) {
    // limpeza best effort; o importante é não deixar lixo de teste para trás
  }
}

function runNode(args, env) {
  return spawnSync(process.execPath, args, {
    cwd: PROJECT_ROOT,
    env,
    encoding: 'utf8'
  });
}

test('Fase 1A - bootstrap explícito remove side effect da trilha oficial e mantém boot idempotente', async (t) => {
  await t.test('importar scripts/migrate.js não executa migração por acidente', async () => {
    const runtime = createTempRuntime();

    try {
      const result = runNode(['-e', "require('./scripts/migrate');"], runtime.env);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(fs.existsSync(runtime.dbPath), false, 'o arquivo do banco não deveria nascer ao apenas importar a trilha oficial');
      assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /Migração Multi-Usuário concluída/i);
    } finally {
      cleanupTempRuntime(runtime.tempRoot);
    }
  });

  await t.test('importar server.js não executa bootstrap nem migração por acidente', async () => {
    const runtime = createTempRuntime();

    try {
      const result = runNode(['-e', "require('./server');"], runtime.env);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(fs.existsSync(runtime.dbPath), false, 'o banco não deveria ser criado no simples import do server');
      assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /Migração Multi-Usuário concluída/i);
    } finally {
      cleanupTempRuntime(runtime.tempRoot);
    }
  });

  await t.test('a migração oficial roda duas vezes em banco vazio sem quebrar a trilha', async () => {
    const runtime = createTempRuntime();

    try {
      const firstRun = runNode(['scripts/migrate.js'], runtime.env);
      assert.equal(firstRun.status, 0, firstRun.stderr);
      assert.ok(fs.existsSync(runtime.dbPath), 'a primeira execução precisa materializar o banco');

      const secondRun = runNode(['scripts/migrate.js'], runtime.env);
      assert.equal(secondRun.status, 0, secondRun.stderr);
      assert.match(`${secondRun.stdout}\n${secondRun.stderr}`, /Migração Multi-Usuário concluída/i);
    } finally {
      cleanupTempRuntime(runtime.tempRoot);
    }
  });

  await t.test('createApp usa a trilha oficial conscientemente antes de montar o runtime', async () => {
    const runtime = createTempRuntime();

    try {
      const result = runNode([
        '-e',
        [
          "const server = require('./server');",
          'const app = server.createApp();',
          "console.log(app && typeof app.use === 'function' ? 'APP_OK' : 'APP_FAIL');"
        ].join(' ')
      ], runtime.env);

      assert.equal(result.status, 0, result.stderr);
      assert.ok(fs.existsSync(runtime.dbPath), 'createApp precisa materializar o banco via bootstrap oficial');
      assert.match(`${result.stdout}\n${result.stderr}`, /APP_OK/);
    } finally {
      cleanupTempRuntime(runtime.tempRoot);
    }
  });
});
