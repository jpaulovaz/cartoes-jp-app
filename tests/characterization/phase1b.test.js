const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const BetterSqlite3 = require('better-sqlite3');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

function createTempRuntime(prefix = 'organizapay-phase1b-') {
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

function openDb(dbPath) {
  return new BetterSqlite3(dbPath, { fileMustExist: true });
}

function tableExists(db, tableName) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1").get(tableName);
  return !!row;
}

function columnNames(db, tableName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all().map((row) => row.name);
}

function indexNames(db, tableName) {
  return db.prepare(`PRAGMA index_list(${tableName})`).all().map((row) => row.name);
}

test('Fase 1B - schema permanente sai do runtime e fica consolidado na trilha oficial', async (t) => {
  await t.test('server.runtime.js deixa de carregar DDL permanente no boot', async () => {
    const runtimeSource = fs.readFileSync(path.join(PROJECT_ROOT, 'server.runtime.js'), 'utf8');

    assert.doesNotMatch(runtimeSource, /\bALTER TABLE\b/);
    assert.doesNotMatch(runtimeSource, /\bCREATE TABLE IF NOT EXISTS\b/);
    assert.doesNotMatch(runtimeSource, /\bCREATE INDEX IF NOT EXISTS\b/);
    assert.doesNotMatch(runtimeSource, /\bCREATE UNIQUE INDEX IF NOT EXISTS\b/);
    assert.doesNotMatch(runtimeSource, /ensureMessageTemplateTables\(db\)/);
    assert.doesNotMatch(runtimeSource, /syncMessageCatalogWithDatabase\(db\)/);
  });

  await t.test('scripts/migrate.js cobre o DDL removido do runtime', async () => {
    const migrateSource = fs.readFileSync(path.join(PROJECT_ROOT, 'scripts', 'migrate.js'), 'utf8');
    const requiredSnippets = [
      'ALTER TABLE users ADD COLUMN profile_signature_text TEXT;',
      'ALTER TABLE users ADD COLUMN profile_signature_vibe TEXT;',
      'ALTER TABLE users ADD COLUMN profile_signature_updated_at TEXT;',
      'ALTER TABLE people ADD COLUMN phone TEXT;',
      'ALTER TABLE transactions ADD COLUMN due_month INTEGER;',
      'ALTER TABLE transactions ADD COLUMN due_year INTEGER;',
      'ALTER TABLE transactions ADD COLUMN parent_txn_id INTEGER;',
      'ALTER TABLE closed_months ADD COLUMN user_id INTEGER;',
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_closed_months_user_month_year ON closed_months(user_id, month, year);',
      'CREATE TABLE IF NOT EXISTS backup_runs',
      'CREATE TABLE IF NOT EXISTS backup_restores',
      'CREATE TABLE IF NOT EXISTS merchant_learning_feedback',
      'CREATE INDEX IF NOT EXISTS idx_backup_runs_started_at ON backup_runs(started_at DESC);',
      'CREATE INDEX IF NOT EXISTS idx_backup_restores_started_at ON backup_restores(started_at DESC);',
      'CREATE INDEX IF NOT EXISTS idx_merchant_learning_feedback_user_status ON merchant_learning_feedback(user_id, status, updated_at DESC);'
    ];

    requiredSnippets.forEach((snippet) => {
      assert.equal(migrateSource.includes(snippet), true, `faltou cobrir na trilha oficial: ${snippet}`);
    });

    assert.match(migrateSource, /ensureIndexWithAliases\(/);
    assert.match(migrateSource, /idx_shared_debts_batch_id/);
    assert.match(migrateSource, /idx_shared_debt_requests_batch_id/);
    assert.match(migrateSource, /idx_recurring_exceptions_rule_month/);
    assert.match(migrateSource, /idx_recurring_exceptions_user_rule_month/);
  });

  await t.test('a trilha oficial cria o schema complementar em banco novo', async () => {
    const runtime = createTempRuntime();

    try {
      const migrate = runNode(['scripts/migrate.js'], runtime.env);
      assert.equal(migrate.status, 0, migrate.stderr);
      assert.ok(fs.existsSync(runtime.dbPath), 'o banco precisa existir depois da migração oficial');

      const db = openDb(runtime.dbPath);
      try {
        ['backup_runs', 'backup_restores', 'merchant_learning_feedback', 'closed_months'].forEach((tableName) => {
          assert.equal(tableExists(db, tableName), true, `tabela esperada ausente: ${tableName}`);
        });

        const userColumns = columnNames(db, 'users');
        assert.equal(userColumns.includes('profile_signature_text'), true);
        assert.equal(userColumns.includes('profile_signature_vibe'), true);
        assert.equal(userColumns.includes('profile_signature_updated_at'), true);

        const peopleColumns = columnNames(db, 'people');
        assert.equal(peopleColumns.includes('phone'), true);

        const transactionColumns = columnNames(db, 'transactions');
        assert.equal(transactionColumns.includes('due_month'), true);
        assert.equal(transactionColumns.includes('due_year'), true);
        assert.equal(transactionColumns.includes('parent_txn_id'), true);

        const closedMonthColumns = columnNames(db, 'closed_months');
        assert.equal(closedMonthColumns.includes('user_id'), true);

        const backupRunIndexes = indexNames(db, 'backup_runs');
        assert.equal(backupRunIndexes.includes('idx_backup_runs_started_at'), true);

        const backupRestoreIndexes = indexNames(db, 'backup_restores');
        assert.equal(backupRestoreIndexes.includes('idx_backup_restores_started_at'), true);

        const merchantIndexes = indexNames(db, 'merchant_learning_feedback');
        assert.equal(merchantIndexes.includes('idx_merchant_learning_feedback_user_status'), true);

        const closedMonthIndexes = indexNames(db, 'closed_months');
        assert.equal(closedMonthIndexes.includes('idx_closed_months_user_month_year'), true);

        const recurringExceptionIndexes = indexNames(db, 'recurring_exceptions');
        assert.equal(recurringExceptionIndexes.includes('idx_recurring_exceptions_rule_month'), true);

        const sharedDebtIndexes = indexNames(db, 'shared_debt_requests');
        assert.equal(sharedDebtIndexes.includes('idx_shared_debts_batch_id'), true);
      } finally {
        db.close();
      }
    } finally {
      cleanupTempRuntime(runtime.tempRoot);
    }
  });

  await t.test('a trilha oficial respeita aliases legados de índice em banco existente com dados', async () => {
    const runtime = createTempRuntime();

    try {
      const firstRun = runNode(['scripts/migrate.js'], runtime.env);
      assert.equal(firstRun.status, 0, firstRun.stderr);

      let db = openDb(runtime.dbPath);
      const now = new Date().toISOString();
      const insertedUser = db.prepare('INSERT INTO users (email, name, created_at) VALUES (?, ?, ?)').run('phase1b.user@organizapay.test', 'Usuário Fase 1B', now);
      const userId = Number(insertedUser.lastInsertRowid);
      db.prepare('INSERT INTO closed_months (user_id, month, year) VALUES (?, ?, ?)').run(userId, 4, 2026);

      if (indexNames(db, 'shared_debt_requests').includes('idx_shared_debts_batch_id')) {
        db.exec('DROP INDEX idx_shared_debts_batch_id');
      }
      db.exec('CREATE INDEX IF NOT EXISTS idx_shared_debt_requests_batch_id ON shared_debt_requests(batch_id);');

      if (indexNames(db, 'recurring_exceptions').includes('idx_recurring_exceptions_rule_month')) {
        db.exec('DROP INDEX idx_recurring_exceptions_rule_month');
      }
      db.exec('CREATE INDEX IF NOT EXISTS idx_recurring_exceptions_user_rule_month ON recurring_exceptions(user_id, rule_id, year, month);');
      db.close();

      const secondRun = runNode(['scripts/migrate.js'], runtime.env);
      assert.equal(secondRun.status, 0, secondRun.stderr);

      db = openDb(runtime.dbPath);
      try {
        const userCount = db.prepare('SELECT COUNT(*) AS total FROM users').get().total;
        assert.equal(userCount, 1, 'os dados existentes precisam sobreviver à rerun da migração');

        const closedMonthCount = db.prepare('SELECT COUNT(*) AS total FROM closed_months WHERE user_id = ? AND month = ? AND year = ?').get(userId, 4, 2026).total;
        assert.equal(closedMonthCount, 1, 'o banco existente precisa continuar íntegro depois da migração');

        const sharedDebtBatchIndexes = indexNames(db, 'shared_debt_requests').filter((name) => [
          'idx_shared_debts_batch_id',
          'idx_shared_debt_requests_batch_id'
        ].includes(name));
        assert.deepEqual(sharedDebtBatchIndexes, ['idx_shared_debt_requests_batch_id']);

        const recurringExceptionIndexes = indexNames(db, 'recurring_exceptions').filter((name) => [
          'idx_recurring_exceptions_rule_month',
          'idx_recurring_exceptions_user_rule_month'
        ].includes(name));
        assert.deepEqual(recurringExceptionIndexes, ['idx_recurring_exceptions_user_rule_month']);
      } finally {
        db.close();
      }
    } finally {
      cleanupTempRuntime(runtime.tempRoot);
    }
  });
});
