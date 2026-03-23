require('dotenv').config(); // Carrega as variáveis do .env
const path = require("path");
const fs = require("fs");
const fsp = fs.promises;
const os = require("os");
const crypto = require('crypto');
const express = require("express");
const multer = require("multer");
const axios = require('axios');
const dayjs = require("dayjs");
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const BetterSqlite3 = require('better-sqlite3');

let webPush = null;
try {
  webPush = require('web-push');
} catch (err) {
  webPush = null;
}

let QRCode = null;
try {
  QRCode = require('qrcode');
} catch (err) {
  QRCode = null;
}

dayjs.extend(utc);
dayjs.extend(timezone);

// Novas dependências para Auth
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const SQLiteStore = require('connect-sqlite3')(session);
const db = require("./src/db");
const {
  BACKUP_FILE_PREFIX,
  BACKUP_MANIFEST_FILENAME,
  BACKUP_SIGNATURE,
  DEFAULT_PRIMARY_BACKUP_DIR,
  DEFAULT_SECONDARY_BACKUP_DIR,
  backupStatusTone,
  copyFileIfExists,
  createTempWorkspace,
  createZipFromDirectory,
  ensureDir,
  extractZip,
  formatBytes,
  hashFileSha256,
  listZipEntries,
  pruneBackupDirectory,
  resolveConfiguredDirectory,
  toDisplayPath,
  triggerLabel,
  validateZipEntries
} = require("./src/backupEngine");
const {
  SETTING_SECTIONS,
  SETTING_DEFINITIONS,
  getSettingDefinition,
  getSettingDefinitionsBySection,
  getSettingSection,
  getSectionTitle,
  buildSeedValue,
  parseBooleanSetting,
  parseIntegerSetting,
  sanitizeSettingValue
} = require("./src/appConfig");

// --- EXECUTA MIGRAÇÃO AUTOMÁTICA AO INICIAR ---
require('./scripts/migrate.js');

// --- OPCIONAL: EXECUTA SEED AUTOMÁTICO (comentar se não quiser dados de exemplo) ---
// require('./scripts/seed.js');

// Migrações adicionais específicas

try { db.prepare("ALTER TABLE transactions ADD COLUMN due_month INTEGER").run(); } catch (e) { }
try { db.prepare("ALTER TABLE transactions ADD COLUMN due_year INTEGER").run(); } catch (e) { }
try { db.prepare("ALTER TABLE transactions ADD COLUMN parent_txn_id INTEGER").run(); } catch (e) { }
try { db.prepare("ALTER TABLE transactions ADD COLUMN recurring_rule_id INTEGER").run(); } catch (e) { }

// Adiciona a coluna de telefone na tabela people se ela não existir
try { db.prepare("ALTER TABLE people ADD COLUMN phone TEXT").run(); } catch (e) { /* Coluna já existe */ }
try { db.prepare("ALTER TABLE people ADD COLUMN email TEXT").run(); } catch (e) { /* Coluna já existe */ }
try { db.prepare("ALTER TABLE people ADD COLUMN pix_enabled INTEGER NOT NULL DEFAULT 0").run(); } catch (e) { /* Coluna já existe */ }
try { db.prepare("ALTER TABLE people ADD COLUMN pix_key_type TEXT").run(); } catch (e) { /* Coluna já existe */ }
try { db.prepare("ALTER TABLE people ADD COLUMN pix_key_value TEXT").run(); } catch (e) { /* Coluna já existe */ }
try { db.prepare("ALTER TABLE people ADD COLUMN pix_city TEXT").run(); } catch (e) { /* Coluna já existe */ }
try { db.prepare("ALTER TABLE people ADD COLUMN pix_state TEXT").run(); } catch (e) { /* Coluna já existe */ }
try { db.prepare("ALTER TABLE people ADD COLUMN pix_label TEXT").run(); } catch (e) { /* Coluna já existe */ }
try { db.prepare("ALTER TABLE people ADD COLUMN pix_updated_at TEXT").run(); } catch (e) { /* Coluna já existe */ }
try { db.prepare("ALTER TABLE cards ADD COLUMN active INTEGER NOT NULL DEFAULT 1").run(); } catch (e) { /* Coluna já existe */ }
try { db.prepare("ALTER TABLE cards ADD COLUMN close_day INTEGER").run(); } catch (e) { /* Coluna já existe */ }
try { db.prepare("ALTER TABLE users ADD COLUMN can_import INTEGER NOT NULL DEFAULT 1").run(); } catch (e) { /* Coluna já existe */ }
try { db.prepare("ALTER TABLE shared_debt_requests ADD COLUMN source_person_id INTEGER").run(); } catch (e) { /* Coluna já existe */ }
try { db.prepare("ALTER TABLE shared_debt_requests ADD COLUMN source_txn_date_snapshot TEXT").run(); } catch (e) { /* Coluna já existe */ }
try { db.prepare("ALTER TABLE shared_debt_requests ADD COLUMN payment_marked_at TEXT").run(); } catch (e) { /* Coluna já existe */ }
try { db.prepare("ALTER TABLE shared_debt_requests ADD COLUMN payment_note TEXT").run(); } catch (e) { /* Coluna já existe */ }
try { db.prepare("ALTER TABLE shared_debt_requests ADD COLUMN batch_id INTEGER").run(); } catch (e) { /* Coluna já existe */ }
try { db.prepare("ALTER TABLE shared_debt_requests ADD COLUMN request_kind TEXT NOT NULL DEFAULT 'card'").run(); } catch (e) { /* Coluna já existe */ }
try { db.prepare("ALTER TABLE shared_debt_requests ADD COLUMN amount_paid_cents INTEGER NOT NULL DEFAULT 0").run(); } catch (e) { /* Coluna já existe */ }
try { db.prepare("ALTER TABLE shared_debt_requests ADD COLUMN settlement_mode TEXT NOT NULL DEFAULT 'manual'").run(); } catch (e) { /* Coluna já existe */ }
try { db.prepare("ALTER TABLE shared_debt_requests ADD COLUMN last_pix_payload TEXT").run(); } catch (e) { /* Coluna já existe */ }
try { db.prepare("ALTER TABLE shared_debt_requests ADD COLUMN last_pix_txid TEXT").run(); } catch (e) { /* Coluna já existe */ }
try { db.prepare("ALTER TABLE shared_debt_requests ADD COLUMN last_pix_generated_at TEXT").run(); } catch (e) { /* Coluna já existe */ }
try { db.prepare("ALTER TABLE shared_debt_requests ADD COLUMN last_pix_amount_cents INTEGER NOT NULL DEFAULT 0").run(); } catch (e) { /* Coluna já existe */ }
try { db.prepare("ALTER TABLE shared_debt_requests ADD COLUMN pix_version INTEGER NOT NULL DEFAULT 0").run(); } catch (e) { /* Coluna já existe */ }
try { db.prepare("ALTER TABLE shared_debt_batches ADD COLUMN status_summary TEXT NOT NULL DEFAULT 'pending'").run(); } catch (e) { /* Coluna já existe */ }
try { db.prepare("ALTER TABLE shared_debt_batches ADD COLUMN first_responded_at TEXT").run(); } catch (e) { /* Coluna já existe */ }
try { db.prepare("ALTER TABLE shared_debt_batches ADD COLUMN resolved_at TEXT").run(); } catch (e) { /* Coluna já existe */ }
try { db.prepare("ALTER TABLE shared_debt_payment_intents ADD COLUMN creditor_note TEXT").run(); } catch (e) { /* Coluna já existe */ }

// Cria a tabela de meses fechados se não existir
// Em ambiente multi-usuário, o fechamento precisa ser isolado por user_id.
db.prepare(`
  CREATE TABLE IF NOT EXISTS closed_months (
    user_id INTEGER NOT NULL,
    month INTEGER NOT NULL,
    year INTEGER NOT NULL,
    PRIMARY KEY (user_id, month, year)
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS shared_debt_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requester_user_id INTEGER NOT NULL,
    receiver_user_id INTEGER NOT NULL,
    origin_kind TEXT NOT NULL DEFAULT 'single',
    status_summary TEXT NOT NULL DEFAULT 'pending',
    first_responded_at TEXT,
    resolved_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (requester_user_id) REFERENCES users(id),
    FOREIGN KEY (receiver_user_id) REFERENCES users(id)
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS shared_debt_archives (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    is_archived INTEGER NOT NULL DEFAULT 1,
    archived_at TEXT,
    restored_at TEXT,
    archived_from_status TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(request_id, user_id),
    FOREIGN KEY (request_id) REFERENCES shared_debt_requests(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )
`).run();
db.prepare(`
  CREATE TABLE IF NOT EXISTS shared_debt_monthly_settlements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requester_user_id INTEGER NOT NULL,
    receiver_user_id INTEGER NOT NULL,
    month INTEGER NOT NULL,
    year INTEGER NOT NULL,
    request_kind TEXT NOT NULL DEFAULT 'card',
    status TEXT NOT NULL DEFAULT 'open',
    request_count INTEGER NOT NULL DEFAULT 0,
    total_accepted_cents INTEGER NOT NULL DEFAULT 0,
    reserved_cents INTEGER NOT NULL DEFAULT 0,
    confirmed_cents INTEGER NOT NULL DEFAULT 0,
    open_cents INTEGER NOT NULL DEFAULT 0,
    last_reported_at TEXT,
    last_confirmed_at TEXT,
    last_rejected_at TEXT,
    last_activity_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(requester_user_id, receiver_user_id, month, year, request_kind),
    FOREIGN KEY (requester_user_id) REFERENCES users(id),
    FOREIGN KEY (receiver_user_id) REFERENCES users(id)
  )
`).run();
db.prepare(`
  CREATE TABLE IF NOT EXISTS shared_debt_payment_intents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    settlement_id INTEGER NOT NULL,
    requester_user_id INTEGER NOT NULL,
    receiver_user_id INTEGER NOT NULL,
    month INTEGER NOT NULL,
    year INTEGER NOT NULL,
    request_kind TEXT NOT NULL DEFAULT 'card',
    requested_by_user_id INTEGER,
    amount_cents INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'generated',
    pix_payload TEXT,
    pix_txid TEXT,
    payer_note TEXT,
    creditor_note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    generated_at TEXT,
    reported_at TEXT,
    confirmed_at TEXT,
    rejected_at TEXT,
    cancelled_at TEXT,
    FOREIGN KEY (settlement_id) REFERENCES shared_debt_monthly_settlements(id),
    FOREIGN KEY (requester_user_id) REFERENCES users(id),
    FOREIGN KEY (receiver_user_id) REFERENCES users(id),
    FOREIGN KEY (requested_by_user_id) REFERENCES users(id),
    UNIQUE(pix_txid)
  )
`).run();
db.prepare(`
  CREATE TABLE IF NOT EXISTS shared_debt_payment_allocations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    settlement_id INTEGER NOT NULL,
    intent_id INTEGER NOT NULL,
    request_id INTEGER NOT NULL,
    allocated_cents INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(intent_id, request_id),
    FOREIGN KEY (settlement_id) REFERENCES shared_debt_monthly_settlements(id),
    FOREIGN KEY (intent_id) REFERENCES shared_debt_payment_intents(id),
    FOREIGN KEY (request_id) REFERENCES shared_debt_requests(id)
  )
`).run();
db.prepare(`
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    endpoint TEXT NOT NULL UNIQUE,
    subscription_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )
`).run();
db.prepare(`
  CREATE TABLE IF NOT EXISTS scheduled_push_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    date_key TEXT NOT NULL,
    sequence_no INTEGER NOT NULL DEFAULT 1,
    payload_json TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(user_id, event_type, date_key, sequence_no),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )
`).run();
db.prepare(`
  CREATE TABLE IF NOT EXISTS friend_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requester_user_id INTEGER NOT NULL,
    target_user_id INTEGER NOT NULL,
    source_person_id INTEGER,
    requester_name_snapshot TEXT,
    requester_email_snapshot TEXT,
    target_name_snapshot TEXT,
    target_email_snapshot TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    responded_at TEXT,
    resolved_at TEXT,
    response_note TEXT,
    FOREIGN KEY (requester_user_id) REFERENCES users(id),
    FOREIGN KEY (target_user_id) REFERENCES users(id),
    FOREIGN KEY (source_person_id) REFERENCES people(id)
  )
`).run();
db.prepare(`
  CREATE TABLE IF NOT EXISTS friendships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_low_id INTEGER NOT NULL,
    user_high_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    ended_at TEXT,
    ended_by_user_id INTEGER,
    origin_request_id INTEGER,
    source TEXT NOT NULL DEFAULT 'friend_request',
    UNIQUE(user_low_id, user_high_id),
    FOREIGN KEY (user_low_id) REFERENCES users(id),
    FOREIGN KEY (user_high_id) REFERENCES users(id),
    FOREIGN KEY (ended_by_user_id) REFERENCES users(id),
    FOREIGN KEY (origin_request_id) REFERENCES friend_requests(id)
  )
`).run();
db.prepare(`
  CREATE TABLE IF NOT EXISTS person_app_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user_id INTEGER NOT NULL,
    person_id INTEGER NOT NULL,
    linked_user_id INTEGER NOT NULL,
    match_kind TEXT NOT NULL DEFAULT 'friendship',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(owner_user_id, person_id),
    FOREIGN KEY (owner_user_id) REFERENCES users(id),
    FOREIGN KEY (person_id) REFERENCES people(id),
    FOREIGN KEY (linked_user_id) REFERENCES users(id)
  )
`).run();
try { db.prepare("CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON push_subscriptions(user_id)").run(); } catch (e) { /* Índice já existe */ }
try { db.prepare("CREATE INDEX IF NOT EXISTS idx_scheduled_push_logs_event_date ON scheduled_push_logs(event_type, date_key, user_id, sequence_no)").run(); } catch (e) { /* Índice já existe */ }
try { db.prepare("CREATE INDEX IF NOT EXISTS idx_shared_debt_requests_batch_id ON shared_debt_requests(batch_id)").run(); } catch (e) { /* Índice já existe */ }
try { db.prepare("CREATE INDEX IF NOT EXISTS idx_shared_debt_batches_receiver ON shared_debt_batches(receiver_user_id, created_at DESC)").run(); } catch (e) { /* Índice já existe */ }
try { db.prepare("CREATE INDEX IF NOT EXISTS idx_shared_debt_batches_requester ON shared_debt_batches(requester_user_id, created_at DESC)").run(); } catch (e) { /* Índice já existe */ }
try { db.prepare("CREATE INDEX IF NOT EXISTS idx_shared_debt_archives_user_archived ON shared_debt_archives(user_id, is_archived, updated_at DESC)").run(); } catch (e) { /* Índice já existe */ }
try { db.prepare("CREATE INDEX IF NOT EXISTS idx_shared_debt_archives_request_user ON shared_debt_archives(request_id, user_id)").run(); } catch (e) { /* Índice já existe */ }
try { db.prepare("CREATE INDEX IF NOT EXISTS idx_shared_debt_monthly_settlements_pair ON shared_debt_monthly_settlements(requester_user_id, receiver_user_id, year, month, request_kind)").run(); } catch (e) { /* Índice já existe */ }
try { db.prepare("CREATE INDEX IF NOT EXISTS idx_shared_debt_monthly_settlements_receiver ON shared_debt_monthly_settlements(receiver_user_id, year, month, request_kind)").run(); } catch (e) { /* Índice já existe */ }
try { db.prepare("CREATE INDEX IF NOT EXISTS idx_shared_debt_payment_intents_settlement_status ON shared_debt_payment_intents(settlement_id, status, created_at DESC)").run(); } catch (e) { /* Índice já existe */ }
try { db.prepare("CREATE INDEX IF NOT EXISTS idx_shared_debt_payment_intents_pair ON shared_debt_payment_intents(requester_user_id, receiver_user_id, year, month, request_kind, status)").run(); } catch (e) { /* Índice já existe */ }
try { db.prepare("CREATE INDEX IF NOT EXISTS idx_shared_debt_payment_allocations_intent ON shared_debt_payment_allocations(intent_id, request_id)").run(); } catch (e) { /* Índice já existe */ }
try { db.prepare("CREATE INDEX IF NOT EXISTS idx_shared_debt_payment_allocations_request ON shared_debt_payment_allocations(request_id)").run(); } catch (e) { /* Índice já existe */ }
try { db.prepare("CREATE INDEX IF NOT EXISTS idx_friend_requests_requester_status ON friend_requests(requester_user_id, status, created_at DESC)").run(); } catch (e) { /* Índice já existe */ }
try { db.prepare("CREATE INDEX IF NOT EXISTS idx_friend_requests_target_status ON friend_requests(target_user_id, status, created_at DESC)").run(); } catch (e) { /* Índice já existe */ }
try { db.prepare("CREATE INDEX IF NOT EXISTS idx_friend_requests_pair_status ON friend_requests(requester_user_id, target_user_id, status, created_at DESC)").run(); } catch (e) { /* Índice já existe */ }
try { db.prepare("CREATE INDEX IF NOT EXISTS idx_friendships_pair_status ON friendships(user_low_id, user_high_id, status)").run(); } catch (e) { /* Índice já existe */ }
try { db.prepare("CREATE INDEX IF NOT EXISTS idx_person_app_links_owner_person ON person_app_links(owner_user_id, person_id)").run(); } catch (e) { /* Índice já existe */ }
try { db.prepare("CREATE INDEX IF NOT EXISTS idx_person_app_links_owner_linked ON person_app_links(owner_user_id, linked_user_id)").run(); } catch (e) { /* Índice já existe */ }
try { db.prepare("ALTER TABLE closed_months ADD COLUMN user_id INTEGER").run(); } catch (e) { /* Coluna já existe ou tabela ainda não precisava de ajuste */ }
try { db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_closed_months_user_month_year ON closed_months(user_id, month, year)").run(); } catch (e) { /* Índice já existe */ }
try { db.prepare("ALTER TABLE monthly_finances ADD COLUMN amount_mode TEXT NOT NULL DEFAULT 'fixed'").run(); } catch (e) { /* Coluna já existe */ }
db.prepare(`
  CREATE TABLE IF NOT EXISTS monthly_finance_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    finance_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    item_date TEXT,
    item_source TEXT,
    amount_cents INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (finance_id) REFERENCES monthly_finances(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )
`).run();
try { db.prepare("CREATE INDEX IF NOT EXISTS idx_monthly_finance_items_finance_user ON monthly_finance_items(finance_id, user_id)").run(); } catch (e) { /* Índice já existe */ }
try { db.prepare("CREATE INDEX IF NOT EXISTS idx_monthly_finance_items_user_date ON monthly_finance_items(user_id, item_date)").run(); } catch (e) { /* Índice já existe */ }

db.prepare(`
  CREATE TABLE IF NOT EXISTS recurring_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    card_id INTEGER NOT NULL,
    description TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    start_txn_date TEXT NOT NULL,
    start_due_month INTEGER NOT NULL,
    start_due_year INTEGER NOT NULL,
    active_from_month INTEGER NOT NULL,
    active_from_year INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    ended_at TEXT
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS recurring_exceptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    rule_id INTEGER NOT NULL,
    month INTEGER NOT NULL,
    year INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(user_id, rule_id, month, year)
  )
`).run();

try { db.prepare("CREATE INDEX IF NOT EXISTS idx_txn_recurring_rule ON transactions(recurring_rule_id)").run(); } catch (e) { }
try { db.prepare("CREATE INDEX IF NOT EXISTS idx_recurring_rules_user_status ON recurring_rules(user_id, status)").run(); } catch (e) { }
try { db.prepare("CREATE INDEX IF NOT EXISTS idx_recurring_exceptions_user_rule_month ON recurring_exceptions(user_id, rule_id, year, month)").run(); } catch (e) { }

const { parseCsvByCardName } = require("./src/importers");
const { formatBRLFromCents, parseMonthYear, toISOFromBRDate, centsFromPtBrMoney } = require("./src/utils");
const {
  PIX_DEFAULT_STATE,
  PIX_DEFAULT_CITY,
  PIX_STATE_OPTIONS,
  PIX_CITY_SUGGESTIONS_BY_STATE,
  PIX_ALL_CITY_SUGGESTIONS,
  normalizePixState,
  guessPixStateByCity
} = require("./src/brazil-locations");
const {
  PIX_KEY_TYPE_LABELS,
  normalizePixKeyType,
  normalizePixKeyValue,
  formatPixKeyValueForInput,
  validatePixProfile,
  sanitizePixText,
  sanitizeTxid,
  buildPixPayload,
  buildSharedDebtPixTxid,
  buildSharedDebtCardMonthlyPixTxid
} = require("./src/pix");
const formatDateBR = (dateStr) => { if (!dateStr) return "-"; return dayjs(dateStr).format("DD/MM/YYYY"); };
const { computeDueDate } = require("./src/dueDate");

const EFFECTIVE_DUE_MONTH_SQL = "COALESCE(t.due_month, i.month)";
const EFFECTIVE_DUE_YEAR_SQL = "COALESCE(t.due_year, i.year)";

function normalizeAllocationPersonIds(rawPersonIds, validPeople) {
  let personIds = rawPersonIds || [];
  if (!Array.isArray(personIds)) personIds = [personIds];
  return Array.from(new Set(personIds.map(Number).filter(pid => validPeople.has(pid))));
}

function buildEqualShareMap(totalCents, personIds) {
  const normalizedIds = Array.from(new Set((personIds || []).map(Number).filter(Boolean)));
  const shareMap = {};
  if (!normalizedIds.length) return shareMap;

  const numericTotal = Number(totalCents || 0);
  const share = Math.floor(numericTotal / normalizedIds.length);
  const remainder = numericTotal - (share * normalizedIds.length);

  normalizedIds.forEach((pid, idx) => {
    const extra = idx < Math.abs(remainder) ? Math.sign(remainder) : 0;
    shareMap[pid] = share + extra;
  });

  return shareMap;
}

function inferAllocationMode(totalCents, allocationRows) {
  const rows = Array.isArray(allocationRows) ? allocationRows : [];
  const personIds = rows.map(row => Number(row.person_id || row.id || 0)).filter(Boolean);
  if (personIds.length <= 1) return 'equal';

  const actualValues = rows
    .map(row => Number(row.share_cents || 0))
    .sort((a, b) => a - b);
  const expectedValues = personIds
    .map(pid => Number(buildEqualShareMap(totalCents, personIds)[pid] || 0))
    .sort((a, b) => a - b);

  if (actualValues.length !== expectedValues.length) return 'exact';
  return actualValues.every((value, index) => value === expectedValues[index]) ? 'equal' : 'exact';
}

function normalizeShareAmountInput(rawValue) {
  if (rawValue === null || rawValue === undefined) return null;
  if (typeof rawValue === 'number' && Number.isFinite(rawValue)) return Math.round(rawValue);

  const stringValue = String(rawValue).trim();
  if (!stringValue) return null;
  if (/^-?\d+$/.test(stringValue)) return Number(stringValue);

  const digits = stringValue.replace(/\D/g, '');
  if (!digits) return null;
  return Number(digits);
}

function parseAllocationPlan({
  rawPersonIds,
  validPeople,
  rawSplitMode,
  rawShareAmounts,
  targetRows,
  requireSplitModeSelection = false
}) {
  const personIds = normalizeAllocationPersonIds(rawPersonIds, validPeople);
  if (!personIds.length) {
    return { personIds: [], splitMode: 'equal', shareMapsByTxnId: new Map() };
  }

  const rows = Array.isArray(targetRows) ? targetRows : [];
  const requestedMode = String(rawSplitMode || '').trim().toLowerCase();
  const mustChooseSplitMode = !!requireSplitModeSelection && personIds.length > 1;

  if (mustChooseSplitMode && requestedMode !== 'equal' && requestedMode !== 'exact') {
    throw new Error('Escolha como a compra será dividida antes de salvar.');
  }

  const splitMode = personIds.length > 1 && requestedMode === 'exact' ? 'exact' : 'equal';

  if (splitMode !== 'exact') {
    const shareMapsByTxnId = new Map();
    rows.forEach((targetTxn) => {
      shareMapsByTxnId.set(Number(targetTxn.id), buildEqualShareMap(Number(targetTxn.amount_cents || 0), personIds));
    });
    return { personIds, splitMode: 'equal', shareMapsByTxnId };
  }

  const baseAmount = Number(rows[0]?.amount_cents || 0);
  if (baseAmount < 0) {
    throw new Error('Valor definido ainda não está disponível para lançamentos negativos. Aqui, siga em partes iguais.');
  }
  const differentAmountRow = rows.find(row => Number(row.amount_cents || 0) !== baseAmount);
  if (differentAmountRow) {
    throw new Error('O valor definido só funciona quando todas as compras escolhidas têm o mesmo valor. Use partes iguais ou aplique em uma compra por vez.');
  }

  const shareSource = rawShareAmounts && typeof rawShareAmounts === 'object' ? rawShareAmounts : {};
  const shareMap = {};

  for (const personId of personIds) {
    const rawValue = Object.prototype.hasOwnProperty.call(shareSource, personId)
      ? shareSource[personId]
      : shareSource[String(personId)];
    const cents = normalizeShareAmountInput(rawValue);
    if (cents === null || !Number.isFinite(cents) || cents < 0) {
      throw new Error('Revise os valores definidos. Cada pessoa marcada precisa ter um valor válido.');
    }
    shareMap[personId] = cents;
  }

  const totalDefined = personIds.reduce((sum, personId) => sum + Number(shareMap[personId] || 0), 0);
  if (totalDefined !== baseAmount) {
    const diff = Math.abs(baseAmount - totalDefined);
    const diffLabel = formatBRLFromCents(diff);
    if (totalDefined < baseAmount) {
      throw new Error(`Ainda falta ${diffLabel} para fechar o total da compra.`);
    }
    throw new Error(`Passou ${diffLabel} do total da compra. Dá uma aparada e tenta de novo.`);
  }

  const shareMapsByTxnId = new Map();
  rows.forEach((targetTxn) => {
    shareMapsByTxnId.set(Number(targetTxn.id), { ...shareMap });
  });

  return { personIds, splitMode: 'exact', shareMapsByTxnId };
}

function replaceAllocationsForTransactions(userId, targetRows, allocationPlan) {
  const del = db.prepare("DELETE FROM allocations WHERE transaction_id = ? AND user_id = ?");
  const ins = db.prepare("INSERT INTO allocations(user_id, transaction_id, person_id, share_cents, created_at) VALUES (?, ?, ?, ?, ?)");

  db.transaction(() => {
    (targetRows || []).forEach((targetTxn) => {
      clearSharedDebtAllocationLinksForTransaction(userId, targetTxn.id);
      del.run(targetTxn.id, userId);

      const shareMap = allocationPlan.shareMapsByTxnId.get(Number(targetTxn.id)) || {};
      (allocationPlan.personIds || []).forEach((personId) => {
        ins.run(userId, targetTxn.id, personId, Number(shareMap[personId] || 0), nowIso());
      });
    });
  })();
}


db.prepare(`
  CREATE TABLE IF NOT EXISTS backup_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    backup_name TEXT NOT NULL,
    trigger_kind TEXT NOT NULL DEFAULT 'manual',
    status TEXT NOT NULL DEFAULT 'success',
    size_bytes INTEGER NOT NULL DEFAULT 0,
    local_primary_path TEXT,
    local_secondary_path TEXT,
    google_file_id TEXT,
    google_view_link TEXT,
    google_folder_id TEXT,
    manifest_json TEXT,
    message TEXT,
    created_by_user_id INTEGER,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    FOREIGN KEY (created_by_user_id) REFERENCES users(id)
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS backup_restores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    backup_name TEXT,
    uploaded_filename TEXT,
    status TEXT NOT NULL DEFAULT 'success',
    message TEXT,
    safety_backup_run_id INTEGER,
    restored_by_user_id INTEGER,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    FOREIGN KEY (safety_backup_run_id) REFERENCES backup_runs(id),
    FOREIGN KEY (restored_by_user_id) REFERENCES users(id)
  )
`).run();

try { db.prepare("CREATE INDEX IF NOT EXISTS idx_backup_runs_started_at ON backup_runs(started_at DESC)").run(); } catch (e) { /* Índice já existe */ }
try { db.prepare("CREATE INDEX IF NOT EXISTS idx_backup_restores_started_at ON backup_restores(started_at DESC)").run(); } catch (e) { /* Índice já existe */ }

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const backupRestoreUpload = multer({
  dest: path.join(os.tmpdir(), 'organizapay-restore-uploads'),
  limits: { fileSize: 250 * 1024 * 1024 }
});

const currentConfigTimestamp = () => dayjs().toISOString();
const appSettingsInsertIfMissing = db.prepare(`
  INSERT OR IGNORE INTO app_settings (key, value, updated_at, updated_by_user_id)
  VALUES (?, ?, ?, NULL)
`);
const appSettingsUpsert = db.prepare(`
  INSERT INTO app_settings (key, value, updated_at, updated_by_user_id)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET
    value = excluded.value,
    updated_at = excluded.updated_at,
    updated_by_user_id = excluded.updated_by_user_id
`);
const appSettingsSelectAll = db.prepare(`SELECT key, value, updated_at, updated_by_user_id FROM app_settings ORDER BY key ASC`);
const appSettingsSelectValueByKey = db.prepare(`SELECT value FROM app_settings WHERE key = ? LIMIT 1`);
const appSettingsDeleteByKey = db.prepare(`DELETE FROM app_settings WHERE key = ?`);
const APP_SETUP_COMPLETED_KEY = 'APP_SETUP_COMPLETED';
const GOOGLE_SETUP_KEYS = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_CALLBACK_URL'];
const BACKUP_GOOGLE_REFRESH_TOKEN_KEY = 'BACKUP_GOOGLE_REFRESH_TOKEN';
const BACKUP_GOOGLE_CONNECTED_EMAIL_KEY = 'BACKUP_GOOGLE_CONNECTED_EMAIL';
const BACKUP_GOOGLE_CONNECTED_AT_KEY = 'BACKUP_GOOGLE_CONNECTED_AT';
const BACKUP_GOOGLE_FOLDER_ID_KEY = 'BACKUP_GOOGLE_FOLDER_ID';
const BACKUP_GOOGLE_SCOPE_KEY = 'BACKUP_GOOGLE_SCOPE';
const BACKUP_GOOGLE_FOLDER_NAME_META_KEY = 'BACKUP_GOOGLE_FOLDER_NAME_META';

const backupRunsInsert = db.prepare(`
  INSERT INTO backup_runs (
    backup_name, trigger_kind, status, size_bytes, local_primary_path, local_secondary_path,
    google_file_id, google_view_link, google_folder_id, manifest_json, message, created_by_user_id, started_at, finished_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const backupRunsSelectRecent = db.prepare(`SELECT * FROM backup_runs ORDER BY started_at DESC LIMIT ?`);
const backupRunsSelectById = db.prepare(`SELECT * FROM backup_runs WHERE id = ? LIMIT 1`);
const backupRestoresInsert = db.prepare(`
  INSERT INTO backup_restores (backup_name, uploaded_filename, status, message, safety_backup_run_id, restored_by_user_id, started_at, finished_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const backupRestoresSelectRecent = db.prepare(`SELECT * FROM backup_restores ORDER BY started_at DESC LIMIT ?`);

let runtimeSettingsCache = {};
let appSetupCompleted = false;
let pushRuntimeEnabled = false;
let googleAuthConfigured = false;
let scheduledDuePushSweepRunning = false;
let duePushSchedulerInitialHandle = null;
let duePushSchedulerIntervalHandle = null;
let backupSchedulerHandle = null;
let backupSchedulerNextRunAt = null;
let backupJobRunning = false;
let backupRestoreRunning = false;

function seedAppSettingsFromBootstrap() {
  const now = currentConfigTimestamp();
  SETTING_DEFINITIONS.forEach((definition) => {
    appSettingsInsertIfMissing.run(definition.key, buildSeedValue(definition), now);
  });
}

function readRuntimeSettingsFromDb() {
  const rows = appSettingsSelectAll.all();
  const stored = new Map(rows.map((row) => [row.key, row.value == null ? '' : String(row.value)]));
  const next = {};
  SETTING_DEFINITIONS.forEach((definition) => {
    next[definition.key] = stored.has(definition.key)
      ? stored.get(definition.key)
      : buildSeedValue(definition);
  });
  return next;
}

function readSetupCompletedFlagFromDb() {
  const row = appSettingsSelectValueByKey.get(APP_SETUP_COMPLETED_KEY);
  return parseBooleanSetting(row?.value, false);
}

function isAppSetupCompleted() {
  return appSetupCompleted;
}

function getUsersCount() {
  return Number(db.prepare('SELECT COUNT(*) AS total FROM users').get()?.total || 0);
}

function isInitialSetupRequired() {
  return !isAppSetupCompleted() && getUsersCount() === 0;
}

function getSettingValue(key) {
  const definition = getSettingDefinition(key);
  const hasRuntimeValue = Object.prototype.hasOwnProperty.call(runtimeSettingsCache, key);
  const storedValue = hasRuntimeValue
    ? (runtimeSettingsCache[key] == null ? '' : String(runtimeSettingsCache[key]))
    : '';

  if (!isAppSetupCompleted() && definition && !String(storedValue || '').trim()) {
    return buildSeedValue(definition);
  }

  if (hasRuntimeValue) {
    return storedValue;
  }

  return definition ? buildSeedValue(definition) : '';
}

function getSettingText(key, fallback = '') {
  const value = String(getSettingValue(key) || '').trim();
  return value || fallback;
}

function getSettingBoolean(key, fallback = false) {
  const definition = getSettingDefinition(key);
  return parseBooleanSetting(
    getSettingValue(key),
    definition ? parseBooleanSetting(definition.defaultValue, fallback) : fallback
  );
}

function getSettingInt(key, fallback = 0) {
  const definition = getSettingDefinition(key);
  return parseIntegerSetting(
    getSettingValue(key),
    definition ? parseIntegerSetting(definition.defaultValue, fallback, {
      min: definition.min ?? null,
      max: definition.max ?? null
    }) : fallback,
    {
      min: definition?.min ?? null,
      max: definition?.max ?? null
    }
  );
}

function getInternalSettingValue(key, fallback = '') {
  const row = appSettingsSelectValueByKey.get(key);
  const value = row?.value == null ? '' : String(row.value);
  return value || fallback;
}

function setInternalSettings(entries, updatedByUserId = null) {
  const now = currentConfigTimestamp();
  db.transaction(() => {
    Object.entries(entries || {}).forEach(([key, value]) => {
      appSettingsUpsert.run(key, String(value ?? ''), now, updatedByUserId || null);
    });
  })();
}

function clearInternalSettings(keys, updatedByUserId = null) {
  const now = currentConfigTimestamp();
  db.transaction(() => {
    (keys || []).forEach((key) => {
      appSettingsDeleteByKey.run(key);
    });
    if (updatedByUserId) {
      appSettingsUpsert.run(APP_SETUP_COMPLETED_KEY, '1', now, updatedByUserId);
    }
  })();
}

function getPushRuntimeConfig() {
  return {
    publicKey: getSettingText('VAPID_PUBLIC_KEY'),
    privateKey: getSettingText('VAPID_PRIVATE_KEY'),
    subject: getSettingText('VAPID_SUBJECT', 'mailto:no-reply@organizapay.local'),
    duePushEnabled: getSettingBoolean('CARD_DUE_PUSH_ENABLED', true),
    timezone: getSettingText('CARD_DUE_PUSH_TIMEZONE', 'America/Sao_Paulo') || 'America/Sao_Paulo',
    hour: getSettingInt('CARD_DUE_PUSH_HOUR', 10),
    minute: getSettingInt('CARD_DUE_PUSH_MINUTE', 0),
    maxSendsPerDay: getSettingInt('CARD_DUE_PUSH_MAX_SENDS_PER_DAY', 1),
    repeatIntervalMinutes: getSettingInt('CARD_DUE_PUSH_REPEAT_INTERVAL_MINUTES', 0),
    checkIntervalMinutes: getSettingInt('CARD_DUE_PUSH_CHECK_INTERVAL_MINUTES', 10)
  };
}

function getInactivityTimeoutMs() {
  const minutes = getSettingInt('INACTIVITY_TIMEOUT_MINUTES', 0);
  return minutes > 0 ? Math.round(minutes * 60 * 1000) : 0;
}

function isFriendshipGateEnabled() {
  return getSettingBoolean('FRIENDSHIP_GATE_SHARED_DEBT_ENABLED', true);
}

function isPushConfigured() {
  return pushRuntimeEnabled;
}

function getPushPublicKey() {
  return isPushConfigured() ? getSettingText('VAPID_PUBLIC_KEY') : '';
}

function applyPushRuntimeConfig() {
  const config = getPushRuntimeConfig();
  pushRuntimeEnabled = false;

  if (!webPush) {
    return false;
  }

  if (config.publicKey && config.privateKey) {
    try {
      webPush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
      pushRuntimeEnabled = true;
    } catch (err) {
      pushRuntimeEnabled = false;
      console.warn('⚠️  Push Web configurado de forma inválida. Verifique VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY e VAPID_SUBJECT.');
    }
  } else if (config.publicKey || config.privateKey) {
    console.warn('⚠️  Push Web desativado: faltam dependência web-push ou variáveis VAPID completas.');
  }

  return pushRuntimeEnabled;
}

function configureGoogleStrategy() {
  if (typeof passport.unuse === 'function') {
    try { passport.unuse('google'); } catch (err) { }
  }

  googleAuthConfigured = false;

  const clientID = getSettingText('GOOGLE_CLIENT_ID');
  const clientSecret = getSettingText('GOOGLE_CLIENT_SECRET');
  const callbackURL = getSettingText('GOOGLE_CALLBACK_URL', 'http://localhost:3001/auth/google/callback');

  if (!clientID || !clientSecret) {
    console.warn('⚠️  Google OAuth não configurado. Ajuste a seção Login com Google na área Admin.');
    return false;
  }

  passport.use(new GoogleStrategy({
    clientID,
    clientSecret,
    callbackURL
  }, (accessToken, refreshToken, profile, done) => {
    const email = profile.emails?.[0]?.value;
    const name = profile.displayName;

    if (!email) {
      return done(null, false, { message: 'Email não encontrado no perfil Google.' });
    }

    const authorizedUser = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

    if (!authorizedUser) {
      return done(null, false, { message: 'Email não autorizado. Entre em contato com o administrador.' });
    }

    const isFirstGoogleLogin = !authorizedUser.last_login;

    db.prepare('UPDATE users SET last_login = ? WHERE email = ?').run(dayjs().toISOString(), email);

    if (isFirstGoogleLogin) {
      ensureDefaultOwnerPerson(authorizedUser.id, name || authorizedUser.name || email.split('@')[0], email);
    }

    return done(null, {
      id: authorizedUser.id,
      email,
      name: authorizedUser.name || name || email.split('@')[0],
      role: authorizedUser.role,
      can_import: Number(authorizedUser.can_import ?? 1)
    });
  }));

  googleAuthConfigured = true;
  return true;
}

function isGoogleAuthConfigured() {
  return googleAuthConfigured;
}

function getBackupRuntimeConfig() {
  const fallbackTimeZone = 'America/Sao_Paulo';
  const configuredTimeZone = getSettingText('BACKUP_TIMEZONE', fallbackTimeZone) || fallbackTimeZone;
  const safeTimeZone = (() => {
    try {
      Intl.DateTimeFormat('pt-BR', { timeZone: configuredTimeZone }).format(new Date());
      return configuredTimeZone;
    } catch (error) {
      return fallbackTimeZone;
    }
  })();

  return {
    enabled: getSettingBoolean('BACKUP_ENABLED', true),
    frequency: getSettingText('BACKUP_FREQUENCY', 'daily') || 'daily',
    timeZone: safeTimeZone,
    hour: getSettingInt('BACKUP_HOUR', 3),
    minute: getSettingInt('BACKUP_MINUTE', 30),
    weekday: getSettingInt('BACKUP_WEEKDAY', 0),
    keepCount: getSettingInt('BACKUP_KEEP_COUNT', 15),
    localPrimaryDir: resolveConfiguredDirectory(__dirname, getSettingText('BACKUP_LOCAL_PRIMARY_DIR', DEFAULT_PRIMARY_BACKUP_DIR), DEFAULT_PRIMARY_BACKUP_DIR),
    localSecondaryDir: resolveConfiguredDirectory(__dirname, getSettingText('BACKUP_LOCAL_SECONDARY_DIR', DEFAULT_SECONDARY_BACKUP_DIR), DEFAULT_SECONDARY_BACKUP_DIR),
    googleEnabled: getSettingBoolean('BACKUP_GOOGLE_ENABLED', false),
    googleFolderName: getSettingText('BACKUP_GOOGLE_FOLDER_NAME', 'OrganizaPay Backups') || 'OrganizaPay Backups',
    googleRefreshToken: getInternalSettingValue(BACKUP_GOOGLE_REFRESH_TOKEN_KEY),
    googleConnectedEmail: getInternalSettingValue(BACKUP_GOOGLE_CONNECTED_EMAIL_KEY),
    googleConnectedAt: getInternalSettingValue(BACKUP_GOOGLE_CONNECTED_AT_KEY),
    googleFolderId: getInternalSettingValue(BACKUP_GOOGLE_FOLDER_ID_KEY),
    googleScope: getInternalSettingValue(BACKUP_GOOGLE_SCOPE_KEY),
    googleFolderNameMeta: getInternalSettingValue(BACKUP_GOOGLE_FOLDER_NAME_META_KEY)
  };
}

function formatAdminDateTime(dateValue, timeZone = 'America/Sao_Paulo') {
  if (!dateValue) return '-';
  try {
    return dayjs(dateValue).tz(timeZone).format('DD/MM/YYYY HH:mm');
  } catch (error) {
    return dayjs(dateValue).format('DD/MM/YYYY HH:mm');
  }
}

function getBackupFrequencyLabel(frequency) {
  const labels = {
    manual: 'Só manual',
    hourly: 'A cada hora',
    daily: 'Todo dia',
    weekly: 'Toda semana'
  };
  return labels[String(frequency || '').trim()] || 'Manual';
}

function assertBackupDirectories(config) {
  if (!config.localPrimaryDir || !config.localSecondaryDir) {
    throw new Error('As duas pastas locais do backup precisam estar definidas.');
  }

  if (path.resolve(config.localPrimaryDir) === path.resolve(config.localSecondaryDir)) {
    throw new Error('As duas pastas locais do backup precisam ser diferentes para o espelho ter graça de verdade.');
  }
}

function getGoogleBackupRedirectUri() {
  const callbackUrl = getSettingText('GOOGLE_CALLBACK_URL');
  if (!callbackUrl) return '';

  try {
    const url = new URL(callbackUrl);
    url.pathname = '/admin/backup/google/callback';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch (error) {
    return '';
  }
}

function buildGoogleBackupAuthUrl(req) {
  const clientId = getSettingText('GOOGLE_CLIENT_ID');
  const clientSecret = getSettingText('GOOGLE_CLIENT_SECRET');
  const redirectUri = getGoogleBackupRedirectUri();

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Antes de conectar o Google Drive, preencha Client ID, Client secret e a URL de retorno do login com Google.');
  }

  const state = crypto.randomBytes(24).toString('hex');
  if (req.session) {
    req.session.backupGoogleAuthState = state;
    req.session.backupGoogleAuthCreatedAt = Date.now();
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    scope: ['openid', 'email', 'https://www.googleapis.com/auth/drive.file'].join(' '),
    state
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function exchangeGoogleBackupCodeForTokens(code) {
  const clientId = getSettingText('GOOGLE_CLIENT_ID');
  const clientSecret = getSettingText('GOOGLE_CLIENT_SECRET');
  const redirectUri = getGoogleBackupRedirectUri();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri
  });

  const response = await axios.post('https://oauth2.googleapis.com/token', body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 20000
  });

  return response.data || {};
}

async function refreshGoogleBackupAccessToken(refreshToken) {
  const token = String(refreshToken || '').trim();
  if (!token) {
    throw new Error('Conecte uma conta Google antes de tentar enviar backup para o Drive.');
  }

  const body = new URLSearchParams({
    client_id: getSettingText('GOOGLE_CLIENT_ID'),
    client_secret: getSettingText('GOOGLE_CLIENT_SECRET'),
    refresh_token: token,
    grant_type: 'refresh_token'
  });

  const response = await axios.post('https://oauth2.googleapis.com/token', body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 20000
  });

  const accessToken = String(response.data?.access_token || '').trim();
  if (!accessToken) {
    throw new Error('O Google não devolveu um access token para o backup agora.');
  }

  return accessToken;
}

async function fetchGoogleBackupProfile(accessToken) {
  const response = await axios.get('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 20000
  });
  return response.data || {};
}

async function googleDriveRequest({ method = 'GET', url, accessToken, params, data, headers = {} }) {
  const response = await axios({
    method,
    url,
    params,
    data,
    timeout: 45000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...headers
    }
  });

  return response.data || {};
}

function escapeDriveQueryValue(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'");
}

async function ensureGoogleBackupFolder(accessToken, config, updatedByUserId = null) {
  const configuredFolderId = String(config.googleFolderId || '').trim();
  if (configuredFolderId) {
    try {
      const folder = await googleDriveRequest({
        url: `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(configuredFolderId)}`,
        accessToken,
        params: { fields: 'id,name,mimeType,webViewLink' }
      });
      if (folder && folder.id && folder.mimeType === 'application/vnd.google-apps.folder') {
        if (folder.name && folder.name !== getInternalSettingValue(BACKUP_GOOGLE_FOLDER_NAME_META_KEY)) {
          setInternalSettings({ [BACKUP_GOOGLE_FOLDER_NAME_META_KEY]: folder.name }, updatedByUserId);
        }
        return folder;
      }
    } catch (error) {
      // Segue para busca/criação por nome.
    }
  }

  const folderName = String(config.googleFolderName || 'OrganizaPay Backups').trim() || 'OrganizaPay Backups';
  const found = await googleDriveRequest({
    url: 'https://www.googleapis.com/drive/v3/files',
    accessToken,
    params: {
      q: `mimeType='application/vnd.google-apps.folder' and trashed=false and name='${escapeDriveQueryValue(folderName)}'`,
      pageSize: 1,
      fields: 'files(id,name,mimeType,webViewLink)',
      spaces: 'drive'
    }
  });

  let folder = Array.isArray(found.files) ? found.files[0] : null;

  if (!folder) {
    folder = await googleDriveRequest({
      method: 'POST',
      url: 'https://www.googleapis.com/drive/v3/files',
      accessToken,
      params: { fields: 'id,name,mimeType,webViewLink' },
      data: {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder'
      },
      headers: { 'Content-Type': 'application/json; charset=UTF-8' }
    });
  }

  if (!folder?.id) {
    throw new Error('Não consegui preparar a pasta do Google Drive para os backups.');
  }

  setInternalSettings({
    [BACKUP_GOOGLE_FOLDER_ID_KEY]: folder.id,
    [BACKUP_GOOGLE_FOLDER_NAME_META_KEY]: folder.name || folderName
  }, updatedByUserId);

  return folder;
}

async function uploadBackupZipToGoogle({ filePath, fileName, config, updatedByUserId = null }) {
  const accessToken = await refreshGoogleBackupAccessToken(config.googleRefreshToken);
  const folder = await ensureGoogleBackupFolder(accessToken, config, updatedByUserId);
  const fileBuffer = await fsp.readFile(filePath);
  const boundary = `organizapay-${crypto.randomBytes(12).toString('hex')}`;
  const metadata = {
    name: fileName,
    parents: [folder.id]
  };

  const prefix = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: application/zip\r\n\r\n`
  );
  const suffix = Buffer.from(`\r\n--${boundary}--`);
  const payload = Buffer.concat([prefix, fileBuffer, suffix]);

  const uploaded = await googleDriveRequest({
    method: 'POST',
    url: 'https://www.googleapis.com/upload/drive/v3/files',
    accessToken,
    params: {
      uploadType: 'multipart',
      fields: 'id,name,webViewLink,webContentLink,createdTime,size,parents'
    },
    data: payload,
    headers: {
      'Content-Type': `multipart/related; boundary=${boundary}`
    }
  });

  return {
    fileId: uploaded.id || '',
    viewLink: uploaded.webViewLink || (uploaded.id ? `https://drive.google.com/file/d/${uploaded.id}/view` : ''),
    folderId: folder.id,
    folderName: folder.name || config.googleFolderName,
    accessToken
  };
}

async function pruneGoogleBackupFiles({ accessToken, folderId, keepCount }) {
  if (!accessToken || !folderId) return;
  const keep = Math.max(1, Number(keepCount || 1));
  const listed = await googleDriveRequest({
    url: 'https://www.googleapis.com/drive/v3/files',
    accessToken,
    params: {
      q: `'${escapeDriveQueryValue(folderId)}' in parents and trashed=false and name contains '${BACKUP_FILE_PREFIX}'`,
      orderBy: 'createdTime desc',
      pageSize: Math.max(keep + 10, 50),
      fields: 'files(id,name,createdTime)'
    }
  });

  const extras = (Array.isArray(listed.files) ? listed.files : []).slice(keep);
  for (const file of extras) {
    if (!file?.id) continue;
    try {
      await googleDriveRequest({
        method: 'DELETE',
        url: `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}`,
        accessToken
      });
    } catch (error) {
      console.warn('Falha ao limpar backup antigo do Google Drive:', error?.response?.data?.error?.message || error?.message || error);
    }
  }
}

function buildBackupFileName({ triggerKind = 'manual', timeZone = 'America/Sao_Paulo' } = {}) {
  const stamp = dayjs().tz(timeZone).format('YYYYMMDD-HHmmss');
  const normalizedTrigger = String(triggerKind || 'manual').replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
  return `${BACKUP_FILE_PREFIX}-${stamp}-${normalizedTrigger}.zip`;
}

async function collectBackupManifestEntries(filesRoot, backupName) {
  const manifestFiles = [];

  async function walk(relativeDir = '') {
    const absoluteDir = path.join(filesRoot, relativeDir);
    const entries = await fsp.readdir(absoluteDir, { withFileTypes: true });
    for (const entry of entries) {
      const nextRelative = relativeDir ? path.join(relativeDir, entry.name) : entry.name;
      const absolutePath = path.join(filesRoot, nextRelative);
      if (entry.isDirectory()) {
        await walk(nextRelative);
        continue;
      }
      const stat = await fsp.stat(absolutePath);
      manifestFiles.push({
        logicalPath: nextRelative.replace(/\\/g, '/'),
        sizeBytes: stat.size,
        sha256: await hashFileSha256(absolutePath)
      });
    }
  }

  await walk();
  manifestFiles.sort((a, b) => a.logicalPath.localeCompare(b.logicalPath));

  return {
    signature: BACKUP_SIGNATURE,
    app: 'OrganizaPay',
    backupName,
    createdAt: currentConfigTimestamp(),
    files: manifestFiles
  };
}

async function runBackupRetention(config) {
  await pruneBackupDirectory(config.localPrimaryDir, BACKUP_FILE_PREFIX, config.keepCount);
  await pruneBackupDirectory(config.localSecondaryDir, BACKUP_FILE_PREFIX, config.keepCount);
}

async function createServerBackup({ triggerKind = 'manual', createdByUserId = null, messagePrefix = '' } = {}) {
  if (backupJobRunning || backupRestoreRunning) {
    throw new Error('Já tem uma operação de backup ou restauração rodando. Deixa essa terminar antes de chamar outra.');
  }

  backupJobRunning = true;
  const startedAt = currentConfigTimestamp();
  const config = getBackupRuntimeConfig();
  let workspace = null;
  let backupName = buildBackupFileName({ triggerKind, timeZone: config.timeZone });
  let localPrimaryPath = '';
  let localSecondaryPath = '';
  let googleFileId = '';
  let googleViewLink = '';
  let googleFolderId = config.googleFolderId || '';
  let sizeBytes = 0;
  let manifestJson = '';
  let finalStatus = 'success';
  let finalMessage = messagePrefix ? String(messagePrefix).trim() : 'Backup criado com sucesso.';

  try {
    assertBackupDirectories(config);
    workspace = await createTempWorkspace('organizapay-backup-');
    const payloadRoot = path.join(workspace, 'payload');
    const filesRoot = path.join(payloadRoot, 'files');
    const dbSnapshotPath = path.join(filesRoot, 'data', 'app.db');
    await ensureDir(path.dirname(dbSnapshotPath));
    await db.backup(dbSnapshotPath);

    await copyFileIfExists(path.join(__dirname, '.env'), path.join(filesRoot, '.env'));

    const sessionFiles = ['sessions.sqlite', 'sessions.sqlite-shm', 'sessions.sqlite-wal'];
    for (const fileName of sessionFiles) {
      await copyFileIfExists(path.join(__dirname, fileName), path.join(filesRoot, fileName));
    }

    const manifest = await collectBackupManifestEntries(filesRoot, backupName);
    manifest.triggerKind = triggerKind;
    manifest.createdByUserId = createdByUserId || null;
    manifestJson = JSON.stringify(manifest);
    await fsp.writeFile(path.join(payloadRoot, BACKUP_MANIFEST_FILENAME), JSON.stringify(manifest, null, 2), 'utf8');

    const zipPath = path.join(workspace, backupName);
    await createZipFromDirectory(payloadRoot, zipPath);
    const zipStat = await fsp.stat(zipPath);
    sizeBytes = zipStat.size;

    await ensureDir(config.localPrimaryDir);
    await ensureDir(config.localSecondaryDir);

    localPrimaryPath = path.join(config.localPrimaryDir, backupName);
    localSecondaryPath = path.join(config.localSecondaryDir, backupName);

    await fsp.copyFile(zipPath, localPrimaryPath);
    await fsp.copyFile(zipPath, localSecondaryPath);
    await runBackupRetention(config);

    if (config.googleEnabled) {
      if (!config.googleRefreshToken) {
        finalStatus = 'warning';
        finalMessage = `${finalMessage} As cópias locais foram salvas, mas o Google Drive ainda não está conectado.`.trim();
      } else {
        try {
          const googleResult = await uploadBackupZipToGoogle({
            filePath: zipPath,
            fileName: backupName,
            config,
            updatedByUserId: createdByUserId
          });
          googleFileId = googleResult.fileId || '';
          googleViewLink = googleResult.viewLink || '';
          googleFolderId = googleResult.folderId || googleFolderId;
          await pruneGoogleBackupFiles({
            accessToken: googleResult.accessToken,
            folderId: googleResult.folderId,
            keepCount: config.keepCount
          });
        } catch (error) {
          finalStatus = 'warning';
          finalMessage = `${finalMessage} As cópias locais ficaram salvas, mas o envio ao Google Drive tropeçou: ${error?.response?.data?.error?.message || error?.message || error}`;
        }
      }
    }

    const finishedAt = currentConfigTimestamp();
    const result = backupRunsInsert.run(
      backupName,
      triggerKind,
      finalStatus,
      sizeBytes,
      localPrimaryPath || null,
      localSecondaryPath || null,
      googleFileId || null,
      googleViewLink || null,
      googleFolderId || null,
      manifestJson || null,
      finalMessage || null,
      createdByUserId || null,
      startedAt,
      finishedAt
    );

    return {
      id: Number(result.lastInsertRowid),
      backupName,
      status: finalStatus,
      message: finalMessage,
      sizeBytes,
      localPrimaryPath,
      localSecondaryPath,
      googleFileId,
      googleViewLink,
      googleFolderId,
      startedAt,
      finishedAt
    };
  } catch (error) {
    const finishedAt = currentConfigTimestamp();
    const message = error?.response?.data?.error?.message || error?.message || 'Não consegui criar o backup agora.';
    const result = backupRunsInsert.run(
      backupName,
      triggerKind,
      'error',
      sizeBytes || 0,
      localPrimaryPath || null,
      localSecondaryPath || null,
      googleFileId || null,
      googleViewLink || null,
      googleFolderId || null,
      manifestJson || null,
      message,
      createdByUserId || null,
      startedAt,
      finishedAt
    );
    const enrichedError = new Error(message);
    enrichedError.backupRunId = Number(result.lastInsertRowid);
    throw enrichedError;
  } finally {
    backupJobRunning = false;
    if (workspace) {
      await fsp.rm(workspace, { recursive: true, force: true }).catch(() => {});
    }
  }
}

async function restoreServerBackupFromZip({ zipPath, uploadedFilename, restoredByUserId = null }) {
  if (backupJobRunning || backupRestoreRunning) {
    throw new Error('Tem outra operação de backup ou restauração em andamento. Vamos por partes para não tropeçar na própria extensão.');
  }

  backupRestoreRunning = true;
  const startedAt = currentConfigTimestamp();
  let workspace = null;
  let backupName = null;
  let safetyBackupRunId = null;

  try {
    workspace = await createTempWorkspace('organizapay-restore-');
    const entries = await listZipEntries(zipPath);
    validateZipEntries(entries);
    await extractZip(zipPath, workspace);

    const manifestPath = path.join(workspace, BACKUP_MANIFEST_FILENAME);
    const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
    if (!manifest || manifest.signature !== BACKUP_SIGNATURE) {
      throw new Error('O arquivo enviado não tem a assinatura oficial de backup do OrganizaPay.');
    }

    backupName = String(manifest.backupName || '').trim() || path.basename(zipPath);
    const sourceDbPath = path.join(workspace, 'files', 'data', 'app.db');
    const sourceDbStat = await fsp.stat(sourceDbPath).catch(() => null);
    if (!sourceDbStat || !sourceDbStat.isFile()) {
      throw new Error('Esse backup não trouxe a cópia do banco principal. A restauração foi cancelada.');
    }

    const safetyBackup = await createServerBackup({
      triggerKind: 'before_restore',
      createdByUserId: restoredByUserId,
      messagePrefix: 'Backup de segurança criado antes da restauração.'
    });
    safetyBackupRunId = safetyBackup.id;

    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
    } catch (error) {
      // Segue o baile se o checkpoint não rolar.
    }

    const sourceDb = new BetterSqlite3(sourceDbPath, { fileMustExist: true });
    try {
      await sourceDb.backup(path.join(__dirname, 'data', 'app.db'));
    } finally {
      sourceDb.close();
    }

    const restorableFiles = ['sessions.sqlite', 'sessions.sqlite-shm', 'sessions.sqlite-wal', '.env'];
    for (const fileName of restorableFiles) {
      const sourcePath = path.join(workspace, 'files', fileName);
      const targetPath = path.join(__dirname, fileName);
      const exists = await copyFileIfExists(sourcePath, targetPath);
      if (exists && fileName.startsWith('sessions.sqlite')) {
        // Nada além de copiar. Sessões antigas podem precisar de restart para valerem de vez.
      }
    }

    refreshRuntimeSettings();

    const finishedAt = currentConfigTimestamp();
    backupRestoresInsert.run(
      backupName,
      uploadedFilename || path.basename(zipPath),
      'success',
      'Backup restaurado com sucesso. O banco voltou para a foto salva no zip.',
      safetyBackupRunId || null,
      restoredByUserId || null,
      startedAt,
      finishedAt
    );

    return {
      backupName,
      safetyBackupRunId,
      message: 'Backup restaurado com sucesso. O banco voltou para a foto salva no zip.'
    };
  } catch (error) {
    const finishedAt = currentConfigTimestamp();
    const message = error?.response?.data?.error?.message || error?.message || 'Não consegui restaurar o backup agora.';
    backupRestoresInsert.run(
      backupName || null,
      uploadedFilename || path.basename(zipPath),
      'error',
      message,
      safetyBackupRunId || null,
      restoredByUserId || null,
      startedAt,
      finishedAt
    );
    throw new Error(message);
  } finally {
    backupRestoreRunning = false;
    if (workspace) {
      await fsp.rm(workspace, { recursive: true, force: true }).catch(() => {});
    }
  }
}

function getNextBackupRunAt(config = getBackupRuntimeConfig(), fromDate = dayjs()) {
  if (!config.enabled || !config.frequency || config.frequency === 'manual') return null;

  const now = fromDate.tz(config.timeZone);
  if (config.frequency === 'hourly') {
    let next = now.startOf('hour').minute(config.minute).second(0).millisecond(0);
    if (!next.isAfter(now)) next = next.add(1, 'hour');
    return next;
  }

  if (config.frequency === 'daily') {
    let next = now.hour(config.hour).minute(config.minute).second(0).millisecond(0);
    if (!next.isAfter(now)) next = next.add(1, 'day');
    return next;
  }

  if (config.frequency === 'weekly') {
    let next = now.hour(config.hour).minute(config.minute).second(0).millisecond(0);
    const today = next.day();
    let daysAhead = (Number(config.weekday) - today + 7) % 7;
    if (daysAhead === 0 && !next.isAfter(now)) daysAhead = 7;
    next = next.add(daysAhead, 'day');
    return next;
  }

  return null;
}

function clearBackupScheduler() {
  if (backupSchedulerHandle) {
    clearTimeout(backupSchedulerHandle);
    backupSchedulerHandle = null;
  }
  backupSchedulerNextRunAt = null;
}

function restartBackupScheduler() {
  clearBackupScheduler();

  const config = getBackupRuntimeConfig();
  if (!config.enabled || config.frequency === 'manual') {
    return;
  }

  let nextRun = null;
  try {
    assertBackupDirectories(config);
    nextRun = getNextBackupRunAt(config);
  } catch (error) {
    console.warn('Backup automático não foi agendado:', error?.message || error);
    return;
  }

  if (!nextRun) return;

  backupSchedulerNextRunAt = nextRun.toISOString();
  const delayMs = Math.max(1000, Math.min(nextRun.diff(dayjs()), 2147483647));

  backupSchedulerHandle = setTimeout(async () => {
    try {
      const result = await createServerBackup({ triggerKind: 'scheduled' });
      if (result.status !== 'success') {
        console.warn('Backup automático finalizado com aviso:', result.message);
      }
    } catch (error) {
      console.error('Falha no backup automático:', error?.message || error);
    } finally {
      restartBackupScheduler();
    }
  }, delayMs);
}

function mapBackupRunForAdmin(row, timeZone) {
  if (!row) return null;
  return {
    ...row,
    triggerLabel: triggerLabel(row.trigger_kind),
    statusTone: backupStatusTone(row.status),
    startedAtLabel: formatAdminDateTime(row.started_at, timeZone),
    finishedAtLabel: formatAdminDateTime(row.finished_at, timeZone),
    sizeLabel: formatBytes(row.size_bytes),
    localPrimaryAvailable: !!(row.local_primary_path && fs.existsSync(row.local_primary_path)),
    localSecondaryAvailable: !!(row.local_secondary_path && fs.existsSync(row.local_secondary_path)),
    googleAvailable: !!row.google_file_id,
    googleViewLink: row.google_view_link || (row.google_file_id ? `https://drive.google.com/file/d/${row.google_file_id}/view` : ''),
    message: row.message || ''
  };
}

function buildBackupAdminState() {
  const config = getBackupRuntimeConfig();
  const recentRuns = backupRunsSelectRecent.all(8).map((row) => mapBackupRunForAdmin(row, config.timeZone));
  const recentRestores = backupRestoresSelectRecent.all(6).map((row) => ({
    ...row,
    statusTone: backupStatusTone(row.status),
    startedAtLabel: formatAdminDateTime(row.started_at, config.timeZone),
    finishedAtLabel: formatAdminDateTime(row.finished_at, config.timeZone)
  }));
  const nextRunAt = backupSchedulerNextRunAt ? dayjs(backupSchedulerNextRunAt).tz(config.timeZone) : null;

  return {
    config,
    googleConnected: !!config.googleRefreshToken,
    googleReadyForAuth: !!(getSettingText('GOOGLE_CLIENT_ID') && getSettingText('GOOGLE_CLIENT_SECRET') && getGoogleBackupRedirectUri()),
    googleRedirectUri: getGoogleBackupRedirectUri(),
    googleEmail: config.googleConnectedEmail || '',
    googleFolderId: config.googleFolderId || '',
    googleFolderName: config.googleFolderNameMeta || config.googleFolderName,
    nextRunAtIso: nextRunAt ? nextRunAt.toISOString() : '',
    nextRunAtLabel: nextRunAt ? formatAdminDateTime(nextRunAt.toISOString(), config.timeZone) : 'Automação em folga',
    frequencyLabel: getBackupFrequencyLabel(config.frequency),
    localPrimaryDisplay: toDisplayPath(__dirname, config.localPrimaryDir),
    localSecondaryDisplay: toDisplayPath(__dirname, config.localSecondaryDir),
    keepCountLabel: `${config.keepCount} pacote(s)`,
    recentRuns,
    recentRestores,
    running: backupJobRunning,
    restoring: backupRestoreRunning,
    guideUrl: '/admin/backup/guide'
  };
}


function clearCardDueTodayPushScheduler() {
  if (duePushSchedulerInitialHandle) {
    clearTimeout(duePushSchedulerInitialHandle);
    duePushSchedulerInitialHandle = null;
  }
  if (duePushSchedulerIntervalHandle) {
    clearInterval(duePushSchedulerIntervalHandle);
    duePushSchedulerIntervalHandle = null;
  }
}

function restartCardDueTodayPushScheduler() {
  clearCardDueTodayPushScheduler();

  const config = getPushRuntimeConfig();
  if (!isPushConfigured() || !config.duePushEnabled || config.maxSendsPerDay <= 0) {
    return;
  }

  const intervalMs = Math.max(1, config.checkIntervalMinutes) * 60 * 1000;
  duePushSchedulerInitialHandle = setTimeout(() => {
    runCardDueTodayPushSweep().catch(err => console.error('Falha no agendamento inicial de push de vencimento:', err?.message || err));
  }, 15000);

  duePushSchedulerIntervalHandle = setInterval(() => {
    runCardDueTodayPushSweep().catch(err => console.error('Falha no agendamento recorrente de push de vencimento:', err?.message || err));
  }, intervalMs);
}

function refreshRuntimeSettings({ restartScheduler = true } = {}) {
  runtimeSettingsCache = readRuntimeSettingsFromDb();
  appSetupCompleted = readSetupCompletedFlagFromDb();
  applyPushRuntimeConfig();
  configureGoogleStrategy();
  if (restartScheduler) {
    restartCardDueTodayPushScheduler();
    restartBackupScheduler();
  }
  return runtimeSettingsCache;
}

function markAppSetupCompleted(value, updatedByUserId = null) {
  appSettingsUpsert.run(APP_SETUP_COMPLETED_KEY, value ? '1' : '0', currentConfigTimestamp(), updatedByUserId || null);
}

function updateAppSettings(entries, updatedByUserId = null) {
  const now = currentConfigTimestamp();
  const rows = Object.entries(entries || {});
  db.transaction(() => {
    rows.forEach(([key, value]) => {
      appSettingsUpsert.run(key, String(value ?? ''), now, updatedByUserId || null);
    });
    if (updatedByUserId) {
      appSettingsUpsert.run(APP_SETUP_COMPLETED_KEY, '1', now, updatedByUserId);
    }
  })();
  return refreshRuntimeSettings();
}

function buildAdminStatusCards() {
  const googleReady = isGoogleAuthConfigured();
  const whatsappReady = !!(getSettingText('EVOLUTION_API_URL') && getSettingText('EVOLUTION_API_KEY') && getSettingText('EVOLUTION_INSTANCE_NAME'));
  const pushReady = isPushConfigured();
  const timeoutMinutes = getSettingInt('INACTIVITY_TIMEOUT_MINUTES', 0);
  const duePushEnabled = getSettingBoolean('CARD_DUE_PUSH_ENABLED', true);
  const backupConfig = getBackupRuntimeConfig();
  const lastBackup = backupRunsSelectRecent.all(1).map((row) => mapBackupRunForAdmin(row, backupConfig.timeZone))[0] || null;
  const backupConnectedToGoogle = !!backupConfig.googleRefreshToken;
  const backupTone = !backupConfig.enabled
    ? 'muted'
    : lastBackup?.status === 'error'
      ? 'warning'
      : 'success';
  const backupStatus = !backupConfig.enabled
    ? 'Manual'
    : backupConfig.googleEnabled && !backupConnectedToGoogle
      ? 'Local ok, Google pendente'
      : lastBackup
        ? (lastBackup.status === 'success' ? 'Protegido' : 'Com aviso')
        : 'Agendado';
  const backupText = !backupConfig.enabled
    ? 'O cofre automático está pausado, mas o botão manual continua pronto para entrar em campo.'
    : lastBackup
      ? `${lastBackup.triggerLabel} em ${lastBackup.startedAtLabel}. ${lastBackup.message}`
      : 'A rotina automática está armada e esperando a próxima janela para salvar a memória do app.';

  return [
    {
      key: 'google',
      title: 'Login Google',
      tone: googleReady ? 'success' : 'muted',
      status: googleReady ? 'Prontinho' : 'Falta tempero',
      text: googleReady
        ? 'As chaves do Google estão no lugar e a porta de entrada está liberada.'
        : 'Ainda faltam dados do OAuth para esse login trabalhar bonito.'
    },
    {
      key: 'whatsapp',
      title: 'WhatsApp automático',
      tone: whatsappReady ? 'success' : 'muted',
      status: whatsappReady ? 'No jogo' : 'Descansando',
      text: whatsappReady
        ? 'A ponte com a Evolution está montada e pronta para mandar resumos.'
        : 'Sem URL, key ou instância completas o WhatsApp continua no banco de reservas.'
    },
    {
      key: 'push',
      title: 'Alertas push',
      tone: pushReady ? 'success' : 'warning',
      status: pushReady ? (duePushEnabled ? 'Tinindo' : 'Push ok, lembrete pausado') : 'Ainda em silêncio',
      text: pushReady
        ? 'As chaves VAPID estão válidas e o sininho pode tocar neste navegador.'
        : 'Faltam as chaves VAPID completas para o push acordar.'
    },
    {
      key: 'backup',
      title: 'Backup do servidor',
      tone: backupTone,
      status: backupStatus,
      text: backupText
    },
    {
      key: 'session',
      title: 'Sessão do app',
      tone: timeoutMinutes > 0 ? 'success' : 'muted',
      status: timeoutMinutes > 0 ? `${timeoutMinutes} min` : 'Sem timeout',
      text: timeoutMinutes > 0
        ? 'Quem cochila demais precisa entrar de novo depois do tempo configurado.'
        : 'Sem tempo de inatividade: a sessão segue até o logout manual ou expiração padrão do cookie.'
    }
  ];
}

function buildAdminSettingsSections() {
  return SETTING_SECTIONS.map((section) => ({
    ...section,
    fields: getSettingDefinitionsBySection(section.key).map((definition) => ({
      ...definition,
      value: getSettingValue(definition.key),
      boolValue: getSettingBoolean(definition.key),
      appliesLabel: definition.restartRequired ? 'Pede restart' : 'Entra na hora'
    }))
  }));
}

seedAppSettingsFromBootstrap();
refreshRuntimeSettings({ restartScheduler: false });

const BOOTSTRAP_SESSION_SECRET = getSettingText('SESSION_SECRET', 'chave-secreta-padrao');
const BOOTSTRAP_PORT = getSettingInt('PORT', 3001);
const DEFAULT_FINANCE_CATEGORIES = ['Prestação Apartamento', 'Luz', 'Internet', 'Condomínio', 'Tim'];

function getUserRecord(userId) {
  return db.prepare("SELECT id, email, name, role, can_import, created_at, last_login FROM users WHERE id = ?").get(userId);
}

function getAllUsers() {
  return db.prepare("SELECT id, email, name, role, can_import, created_at, last_login FROM users ORDER BY created_at DESC").all();
}

function isAdminUser(userId) {
  return getUserRecord(userId)?.role === 'admin';
}

function canUserImport(userId) {
  return Number(getUserRecord(userId)?.can_import ?? 1) !== 0;
}

function ensureDefaultOwnerPerson(userId, preferredName, preferredEmail = null) {
  const safeName = String(preferredName || "").trim();
  const safeEmail = normalizeEmail(preferredEmail);
  if (!safeName) return;

  db.transaction(() => {
    const existingOwner = db.prepare("SELECT id FROM people WHERE user_id = ? AND is_owner = 1 LIMIT 1").get(userId);
    if (existingOwner) return;

    const existingPerson = db.prepare("SELECT id, email FROM people WHERE user_id = ? AND lower(name) = lower(?) LIMIT 1").get(userId, safeName);

    if (existingPerson) {
      db.prepare("UPDATE people SET active = 1 WHERE id = ? AND user_id = ?").run(existingPerson.id, userId);
      if (safeEmail && !normalizeEmail(existingPerson.email)) {
        db.prepare("UPDATE people SET email = ? WHERE id = ? AND user_id = ?").run(safeEmail, existingPerson.id, userId);
      }
      db.prepare("UPDATE people SET is_owner = 0 WHERE user_id = ?").run(userId);
      db.prepare("UPDATE people SET is_owner = 1 WHERE id = ? AND user_id = ?").run(existingPerson.id, userId);
      return;
    }

    db.prepare(`
      INSERT INTO people (user_id, name, phone, email, active, is_owner, created_at)
      VALUES (?, ?, NULL, ?, 1, 1, ?)
    `).run(userId, safeName, safeEmail, dayjs().toISOString());
  })();
}

function renderAdmin(res, { error = null, success = null, activeSection = 'access' } = {}) {
  return res.render('admin', {
    title: 'OrganizaPay | Administração',
    users: getAllUsers(),
    error,
    success,
    activeSection,
    settingsSections: buildAdminSettingsSections(),
    statusCards: buildAdminStatusCards(),
    backupPanel: buildBackupAdminState(),
    totalConfigItems: SETTING_DEFINITIONS.length,
    autoReloadCount: SETTING_DEFINITIONS.filter((item) => !item.restartRequired).length,
    restartRequiredCount: SETTING_DEFINITIONS.filter((item) => item.restartRequired).length,
    googleConfigured: isGoogleAuthConfigured(),
    pushConfigured: isPushConfigured()
  });
}

function buildSetupFormSeed(overrides = {}) {
  return {
    admin_name: String(overrides.admin_name || '').trim(),
    admin_email: String(overrides.admin_email || '').trim(),
    GOOGLE_CLIENT_ID: String(overrides.GOOGLE_CLIENT_ID ?? getSettingValue('GOOGLE_CLIENT_ID') ?? '').trim(),
    GOOGLE_CLIENT_SECRET: String(overrides.GOOGLE_CLIENT_SECRET ?? getSettingValue('GOOGLE_CLIENT_SECRET') ?? '').trim(),
    GOOGLE_CALLBACK_URL: String(overrides.GOOGLE_CALLBACK_URL ?? getSettingValue('GOOGLE_CALLBACK_URL') ?? '').trim()
  };
}

function renderSetup(res, { error = null, success = null, form = {} } = {}) {
  return res.render('setup', {
    title: 'OrganizaPay | Primeira configuração',
    error,
    success,
    form: buildSetupFormSeed(form),
    googleReady: isGoogleAuthConfigured(),
    setupRequired: isInitialSetupRequired()
  });
}

function setFlash(req, type, message) {
  if (!req.session) return;
  req.session.flash = { type, message };
}

function setImportReport(req, report) {
  if (!req.session) return;
  req.session.importReport = report || null;
}

function setImportFormSeed(req, seed) {
  if (!req.session) return;
  req.session.importFormSeed = seed || null;
}

function normalizeErrorStatus(error, fallback = 500) {
  const candidate = Number(error?.status || error?.statusCode || fallback);
  return Number.isInteger(candidate) && candidate >= 400 && candidate <= 599 ? candidate : fallback;
}

function getSqliteConstraintSignature(error) {
  const raw = String(error?.message || '').trim();
  const match = raw.match(/constraint failed:\s*(.+)$/i);
  return match ? match[1].trim() : null;
}

const SQLITE_UNIQUE_MESSAGE_MAP = {
  'people.user_id, people.name': 'Já existe alguém com esse nome na sua lista. Se forem xará, vale colocar um apelido para não virar bagunça.',
  'cards.user_id, cards.name': 'Esse cartão já está na carteira. Se quiser diferenciar, dá para usar um apelido.',
  'users.email': 'Esse e-mail já está autorizado por aqui. Dá uma conferida antes de salvar de novo.',
  'users.google_id': 'Essa conta do Google já está ligada a outro acesso por aqui.',
  'allocations.transaction_id, allocations.person_id': 'Essa pessoa já entrou nessa divisão. Não precisa chamar duas vezes para a mesma compra.',
  'card_statements.card_id, card_statements.month, card_statements.year': 'Esse resumo do cartão já estava guardado por aqui.',
  'person_payments.person_id, person_payments.month, person_payments.year': 'Esse pagamento dessa pessoa já foi lançado neste mês.',
  'closed_months.user_id, closed_months.month, closed_months.year': 'Esse mês já estava fechado por aqui.',
  'person_app_links.owner_user_id, person_app_links.person_id': 'Esse vínculo com o app já estava amarrado por aqui.',
  'shared_debt_archives.request_id, shared_debt_archives.user_id': 'Esse lembrete já estava arquivado para essa pessoa.'
};

function wantsJsonErrorResponse(req) {
  if (!req) return false;
  if (isAjaxLikeRequest(req)) return true;

  const accept = String(req.get('accept') || '').toLowerCase();
  const contentType = String(req.get('content-type') || '').toLowerCase();

  return contentType.includes('application/json')
    || (accept.includes('application/json') && !accept.includes('text/html'));
}

function getFriendlyErrorDetails(error, { defaultMessage = null } = {}) {
  const rawMessage = String(error?.userMessage || error?.message || '').trim();
  const constraintSignature = getSqliteConstraintSignature(error);
  const details = {
    status: normalizeErrorStatus(error, 500),
    message: '',
    rawMessage,
    code: String(error?.code || '').trim() || null,
    constraintSignature
  };

  if (String(error?.name || '') === 'MulterError') {
    details.status = 400;
    details.message = error?.code === 'LIMIT_FILE_SIZE'
      ? 'Esse arquivo veio grandão demais para subir de uma vez. Dá uma enxugada e tenta de novo.'
      : 'Não consegui ler o arquivo enviado agora. Confere o arquivo e tenta mais uma vez.';
    return details;
  }

  if (details.code === 'SQLITE_BUSY' || details.code === 'SQLITE_LOCKED' || /database is locked/i.test(rawMessage)) {
    details.status = 503;
    details.message = 'Tem outra gravação correndo por aqui agora. Dá só um segundinho e tenta de novo.';
    return details;
  }

  if (constraintSignature && SQLITE_UNIQUE_MESSAGE_MAP[constraintSignature]) {
    details.status = 409;
    details.message = SQLITE_UNIQUE_MESSAGE_MAP[constraintSignature];
    return details;
  }

  if (/UNIQUE constraint failed/i.test(rawMessage)) {
    details.status = 409;
    details.message = 'Isso já existe por aqui. Dá uma conferida no que foi digitado e tenta de novo.';
    return details;
  }

  if (/FOREIGN KEY constraint failed/i.test(rawMessage)) {
    details.status = 409;
    details.message = 'Esse item ainda está ligado a outras partes do app. Se a ideia for só tirar de cena, tenta desativar em vez de excluir.';
    return details;
  }

  if (/NOT NULL constraint failed/i.test(rawMessage)) {
    details.status = 422;
    details.message = 'Faltou preencher um pedacinho obrigatório antes de salvar.';
    return details;
  }

  if (/CHECK constraint failed/i.test(rawMessage)) {
    details.status = 422;
    details.message = 'Tem um detalhe fora do formato esperado. Dá uma revisada e tenta de novo.';
    return details;
  }

  if (/too many SQL variables/i.test(rawMessage)) {
    details.status = 422;
    details.message = 'Essa seleção ficou grande demais para processar de uma vez. Tenta dividir em partes.';
    return details;
  }

  if (details.status == 401) {
    details.message = rawMessage || 'Sua sessão saiu para respirar. Faz login de novo e seguimos.';
    return details;
  }

  if (details.status == 403) {
    details.message = rawMessage || 'Essa ação não está liberada para o seu perfil agora.';
    return details;
  }

  if (details.status == 404) {
    details.message = rawMessage || 'Não encontrei esse pedaço por aqui.';
    return details;
  }

  if (details.status == 409) {
    details.message = rawMessage || 'Isso entrou em conflito com o que já existe por aqui.';
    return details;
  }

  if (details.status == 423) {
    details.message = rawMessage || 'Esse pedaço está bloqueado no momento.';
    return details;
  }

  if (details.status >= 400 && details.status < 500) {
    details.message = rawMessage || defaultMessage || 'Tem um ajuste pedindo atenção antes de continuar.';
    return details;
  }

  details.message = defaultMessage || 'Algo tropeçou por aqui. Tenta de novo que eu seguro as pontas deste lado.';
  return details;
}

function getFriendlyErrorMessage(error, options = {}) {
  return getFriendlyErrorDetails(error, options).message;
}

function logFriendlyRouteError(req, error, details) {
  const requestId = req?.requestId || 'sem-id';
  const payload = {
    requestId,
    method: req?.method,
    path: req?.originalUrl || req?.path,
    userId: req?.user?.id || null,
    status: details?.status,
    code: details?.code || null,
    constraint: details?.constraintSignature || null,
    message: error?.message || details?.message
  };

  if ((details?.status || 500) >= 500) {
    console.error('[app-error]', payload, error?.stack || error);
  } else {
    console.warn('[app-error]', payload);
  }
}

function renderFriendlyErrorPage(res, { status = 500, message, actionHref = '/', actionLabel = 'Voltar para o app' } = {}) {
  return res.status(status).render('error', {
    title: 'OrganizaPay | Opa',
    errorTitle: status >= 500 ? 'Deu uma tropeçada por aqui' : 'Tem um ajuste pedindo atenção',
    errorMessage: message,
    actionHref,
    actionLabel
  });
}

function handleFriendlyErrorResponse(req, res, error, { defaultMessage = null, fallbackRedirect = null } = {}) {
  const details = getFriendlyErrorDetails(error, { defaultMessage });
  logFriendlyRouteError(req, error, details);

  if (res.headersSent) {
    return;
  }

  if (wantsJsonErrorResponse(req)) {
    return res.status(details.status).json({ ok: false, error: details.message, message: details.message });
  }

  if (String(req.method || 'GET').toUpperCase() !== 'GET') {
    setFlash(req, 'error', details.message);
    return res.redirect(redirectBackOr(req, fallbackRedirect || '/'));
  }

  return renderFriendlyErrorPage(res, {
    status: details.status,
    message: details.message,
    actionHref: fallbackRedirect || res.locals.dashboardHref || '/'
  });
}

// --- MIDDLEWARES DE BODY PARSER (DEVE VIR ANTES DAS ROTAS) ---
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// --- MIDDLEWARE DE LOGGING GLOBAL ---
app.use((req, res, next) => {
  req.requestId = crypto.randomBytes(6).toString('hex');
  res.set('X-Request-Id', req.requestId);
  if (req.method === 'POST' && req.path === '/txn/manual') {
  }
  next();
});

// --- CONFIGURAÇÃO DE SESSÃO E AUTH ---
app.use(session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: './' }),
  secret: BOOTSTRAP_SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 } // 30 dias
}));

app.use(passport.initialize());
app.use(passport.session());

function isAjaxLikeRequest(req) {
  return String(req.get('X-Requested-With') || '').toLowerCase() === 'xmlhttprequest';
}

function finishExpiredSessionResponse(req, res, redirectUrl) {
  if (isAjaxLikeRequest(req)) {
    res.set('X-Session-Expired', '1');
    res.set('X-Session-Expired-Redirect', redirectUrl);
    return res.status(401).json({
      sessionExpired: true,
      redirect: redirectUrl,
      message: 'Sua sessão expirou por inatividade. Faça login novamente.'
    });
  }

  return res.redirect(redirectUrl);
}

function expireSessionForInactivity(req, res) {
  const redirectUrl = '/login?reason=idle';

  const respond = () => finishExpiredSessionResponse(req, res, redirectUrl);

  const destroySession = () => {
    if (!req.session) return respond();
    req.session.destroy(() => respond());
  };

  if (typeof req.logout === 'function' && req.user) {
    return req.logout(() => destroySession());
  }

  return destroySession();
}

app.use((req, res, next) => {
  const inactivityTimeoutMs = getInactivityTimeoutMs();
  if (!inactivityTimeoutMs || !req.isAuthenticated || !req.isAuthenticated()) {
    return next();
  }

  if (req.path === '/logout') {
    return next();
  }

  const now = Date.now();
  const lastActivityAt = Number(req.session?.lastActivityAt || 0);

  if (lastActivityAt && now - lastActivityAt > inactivityTimeoutMs) {
    return expireSessionForInactivity(req, res);
  }

  if (req.session) {
    req.session.lastActivityAt = now;
  }

  return next();
});

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

// ===== MIDDLEWARE DE AUTENTICAÇÃO =====
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  return res.redirect(isInitialSetupRequired() ? '/setup' : '/login');
}

function ensureCanImport(req, res, next) {
  if (!req.isAuthenticated()) {
    return res.redirect(isInitialSetupRequired() ? '/setup' : '/login');
  }

  if (Number(req.user?.can_import ?? 1) !== 0) {
    return next();
  }

  setFlash(req, 'error', 'Seu usuário não tem permissão para importar faturas.');
  return res.redirect(redirectBackOr(req, '/'));
}

// ===== ROTAS DE AUTH E BOOTSTRAP =====
app.get('/setup', (req, res) => {
  if (!isInitialSetupRequired()) {
    return res.redirect(req.isAuthenticated?.() ? '/' : '/login');
  }

  return renderSetup(res);
});

app.post('/setup', (req, res) => {
  if (!isInitialSetupRequired()) {
    return res.redirect('/login');
  }

  const rawForm = {
    admin_name: String(req.body.admin_name || '').trim(),
    admin_email: String(req.body.admin_email || '').trim(),
    GOOGLE_CLIENT_ID: req.body.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: req.body.GOOGLE_CLIENT_SECRET,
    GOOGLE_CALLBACK_URL: req.body.GOOGLE_CALLBACK_URL
  };

  const safeAdminEmail = normalizeEmail(rawForm.admin_email);
  const safeAdminName = String(rawForm.admin_name || '').trim();

  if (!safeAdminEmail || !safeAdminEmail.includes('@')) {
    return renderSetup(res, {
      error: 'Me passa um e-mail válido para o admin inaugural. É ele que vai ganhar a chave mestra do app.',
      form: rawForm
    });
  }

  try {
    const nextSettings = {};

    GOOGLE_SETUP_KEYS.forEach((key) => {
      const definition = getSettingDefinition(key);
      const sanitized = sanitizeSettingValue(definition, rawForm[key]);
      nextSettings[key] = key === 'GOOGLE_CALLBACK_URL' && !String(sanitized || '').trim()
        ? buildSeedValue(definition)
        : sanitized;
    });

    if (!String(nextSettings.GOOGLE_CLIENT_ID || '').trim() || !String(nextSettings.GOOGLE_CLIENT_SECRET || '').trim()) {
      throw new Error('Para o Google acordar bonito, preciso de Client ID e Client secret completos.');
    }

    const now = currentConfigTimestamp();

    db.transaction(() => {
      Object.entries(nextSettings).forEach(([key, value]) => {
        appSettingsUpsert.run(key, String(value ?? ''), now, null);
      });

      const existingUser = db.prepare('SELECT id, email, name, role, can_import FROM users WHERE email = ?').get(safeAdminEmail);
      let adminId = null;

      if (existingUser) {
        db.prepare(`
          UPDATE users
             SET name = ?,
                 role = 'admin',
                 can_import = 1
           WHERE id = ?
        `).run(safeAdminName || existingUser.name || safeAdminEmail.split('@')[0], existingUser.id);
        adminId = existingUser.id;
      } else {
        const result = db.prepare(`
          INSERT INTO users (email, name, role, can_import, created_at, last_login)
          VALUES (?, ?, 'admin', 1, ?, NULL)
        `).run(safeAdminEmail, safeAdminName || safeAdminEmail.split('@')[0], now);
        adminId = Number(result.lastInsertRowid);
      }

      if (!adminId) {
        throw new Error('Não consegui preparar o admin inicial agora.');
      }

      const insertCat = db.prepare('INSERT OR IGNORE INTO finance_categories (user_id, name) VALUES (?, ?)');
      DEFAULT_FINANCE_CATEGORIES.forEach((category) => insertCat.run(adminId, category));

      markAppSetupCompleted(true, adminId);
    })();

    refreshRuntimeSettings();
    return res.redirect('/login?setup=done');
  } catch (err) {
    return renderSetup(res, {
      error: getFriendlyErrorMessage(err, { defaultMessage: 'A primeira configuração tropeçou aqui. Tenta de novo que eu arrumo a passarela.' }),
      form: rawForm
    });
  }
});

app.get('/login', (req, res) => {
  if (isInitialSetupRequired()) {
    return res.redirect('/setup');
  }

  let error = null;
  let notice = null;

  if (String(req.query.reason || '').trim().toLowerCase() === 'idle') {
    error = 'Sua sessão expirou por inatividade. Faça login novamente.';
  } else if (String(req.query.error || '').trim().toLowerCase() === 'auth_failed') {
    error = 'Não foi possível concluir a autenticação. Tente novamente.';
  } else if (String(req.query.error || '').trim().toLowerCase() === 'google_not_configured') {
    error = 'O login com Google ainda não está configurado. Ajuste isso na área Admin antes de sair distribuindo logins.';
  }

  if (String(req.query.setup || '').trim().toLowerCase() === 'done') {
    notice = 'Casa arrumada. Agora é só entrar com o Google do admin inaugural e seguir o baile.';
  }

  res.render('login_oauth', { error, notice });
});

app.get(['/privacy-policy', '/politica-de-privacidade'], (req, res) => {
  res.render('privacy-policy', {
    updatedAt: '14/03/2026'
  });
});

app.get('/auth/google', (req, res, next) => {
  if (isInitialSetupRequired()) {
    return res.redirect('/setup');
  }

  if (!isGoogleAuthConfigured()) {
    return res.redirect('/login?error=google_not_configured');
  }

  return passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

const handleGoogleCallback = (req, res, next) => {
  if (isInitialSetupRequired()) {
    return res.redirect('/setup');
  }

  if (!isGoogleAuthConfigured()) {
    return res.redirect('/login?error=google_not_configured');
  }

  return passport.authenticate('google', {
    successRedirect: '/',
    failureRedirect: '/login?error=auth_failed'
  })(req, res, next);
};

app.get('/auth/google/callback', handleGoogleCallback);

// Compatibilidade com a rota antiga de callback.
app.get('/auth/callback', handleGoogleCallback);

// Compatibilidade com a rota antiga de login por POST.
app.post('/login', (req, res) => {
  if (isInitialSetupRequired()) {
    return res.redirect('/setup');
  }

  return res.redirect('/auth/google');
});

app.get('/logout', (req, res) => {
  req.logout((err) => {
    if (err) return res.status(500).send('Erro ao fazer logout');
    req.session.destroy(() => {
      res.redirect(isInitialSetupRequired() ? '/setup' : '/login');
    });
  });
});

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// NOTA: Middlewares de body-parser já foram configurados no início do arquivo

app.use(express.static(path.join(__dirname, "public")));
app.use("/vendor/html2canvas", express.static(path.join(__dirname, "node_modules", "html2canvas", "dist")));

// ===== MIDDLEWARE GLOBAL =====
app.use((req, res, next) => {
  res.locals.user = null;
  res.locals.userId = null;
  res.locals.isAdmin = false;
  res.locals.canImport = false;
  res.locals.nomeTitular = "Detalhamento Contas";
  res.locals.formatDateBR = formatDateBR;
  res.locals.flash = req.session?.flash || null;
  res.locals.importReport = req.session?.importReport || null;
  res.locals.importFormSeed = req.session?.importFormSeed || null;
  res.locals.unreadNotificationCount = 0;
  res.locals.readNotificationCount = 0;
  res.locals.recentNotifications = [];
  res.locals.pushNotificationsEnabled = isPushConfigured();
  res.locals.pushPublicKey = getPushPublicKey();
  const now = dayjs();
  res.locals.dashboardHref = `/detalhamento/${now.year()}/${now.month() + 1}`;

  if (req.session?.flash) {
    delete req.session.flash;
  }
  if (req.session?.importReport) {
    delete req.session.importReport;
  }
  if (req.session?.importFormSeed) {
    delete req.session.importFormSeed;
  }

  if (req.isAuthenticated() && req.user?.id) {
    res.locals.unreadNotificationCount = Number(getUnreadNotificationCount(req.user.id) || 0);
    res.locals.readNotificationCount = Number(getReadNotificationCount(req.user.id) || 0);
    res.locals.recentNotifications = getNotificationsForUser(req.user.id);
    const currentUser = getUserRecord(req.user.id);

    if (currentUser) {
      req.user.email = currentUser.email || req.user.email;
      req.user.name = currentUser.name || req.user.name || currentUser.email;
      req.user.role = currentUser.role;
      req.user.can_import = Number(currentUser.can_import ?? 1);
    }

    res.locals.user = req.user;
    res.locals.userId = req.user.id;
    res.locals.isAdmin = req.user.role === 'admin';
    res.locals.canImport = Number(req.user.can_import ?? 1) !== 0;

    try {
      const owner = db.prepare("SELECT name FROM people WHERE user_id = ? AND is_owner = 1 LIMIT 1").get(req.user.id);
      res.locals.nomeTitular = owner ? `Detalhamento ${owner.name}` : "Detalhamento Contas";
    } catch (e) {
      res.locals.nomeTitular = "Detalhamento Contas";
    }

    const dashboardTarget = getPreferredDashboardMonth(req.user.id);
    res.locals.dashboardHref = `/detalhamento/${dashboardTarget.year}/${dashboardTarget.month}`;
  }

  next();
});

function nowIso() { return dayjs().toISOString(); }

function normalizeDayNumber(value) {
  const num = Number(value);
  if (!Number.isInteger(num) || num < 1 || num > 31) return null;
  return num;
}

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return email || null;
}

function pluralizePt(count, singular, plural) {
  return Number(count) === 1 ? singular : plural;
}

function formatCountLabel(count, singular, plural) {
  const safeCount = Math.max(0, Number(count || 0));
  return `${safeCount} ${pluralizePt(safeCount, singular, plural)}`;
}

function buildNoteSuffix(note, label = 'Recado') {
  const safeNote = String(note || '').trim();
  return safeNote ? ` ${label}: ${safeNote}` : '';
}

function normalizePixToggle(value) {
  return value === true || value === 1 || value === '1' || value === 'true' || value === 'on';
}

function getUserPixProfilesByUserIds(userIds = []) {
  const cleanIds = Array.from(new Set((userIds || []).map(Number).filter(Boolean)));
  if (!cleanIds.length) return new Map();

  const placeholders = cleanIds.map(() => '?').join(', ');
  const rows = db.prepare(`
    SELECT
      user_id,
      id AS person_id,
      name,
      email,
      pix_enabled,
      pix_key_type,
      pix_key_value,
      pix_city,
      pix_state,
      pix_label,
      pix_updated_at
    FROM people
    WHERE COALESCE(is_owner, 0) = 1
      AND user_id IN (${placeholders})
    ORDER BY id ASC
  `).all(...cleanIds);

  const map = new Map();
  rows.forEach((row) => {
    const validation = validatePixProfile({
      enabled: row.pix_enabled,
      keyType: row.pix_key_type,
      keyValue: row.pix_key_value,
      city: row.pix_city,
      state: row.pix_state,
      label: row.pix_label,
      name: row.name || row.email || 'ORGANIZAPAY'
    });

    map.set(Number(row.user_id || 0), {
      userId: Number(row.user_id || 0),
      personId: Number(row.person_id || 0) || null,
      ownerName: row.name || null,
      ownerEmail: normalizeEmail(row.email),
      pixEnabled: !!validation.enabled,
      pixValid: !!validation.valid,
      pixReason: validation.reason || null,
      pixErrors: Array.isArray(validation.errors) ? validation.errors : [],
      pixKeyType: validation.keyType,
      pixKeyTypeLabel: validation.keyTypeLabel,
      pixKeyValue: validation.keyValue,
      pixMaskedKey: validation.keyMasked,
      pixCity: validation.city,
      pixState: validation.state || guessPixStateByCity(validation.city) || null,
      pixMerchantName: validation.merchantName,
      pixLabel: validation.label,
      pixUpdatedAt: row.pix_updated_at || null
    });
  });

  return map;
}

function getUserPixProfile(userId) {
  return getUserPixProfilesByUserIds([userId]).get(Number(userId || 0)) || null;
}

function buildManualSharedDebtPixShareText({ creditorName, amountCents, description, payload } = {}) {
  const safeCreditorName = String(creditorName || 'quem vai receber').trim() || 'quem vai receber';
  const safeDescription = String(description || 'o combinado').trim() || 'o combinado';
  return [
    `Oi! Ficou pendente ${formatBRLFromCents(amountCents)} referente a ${safeDescription}.`,
    `Para facilitar, já deixei o Pix copia e cola de ${safeCreditorName} aqui embaixo:`,
    String(payload || '').trim(),
    'Depois me avisa por aqui quando pagar 💸'
  ].filter(Boolean).join('\n\n');
}


function buildSharedDebtCardMonthlyPixShareText({ creditorName, amountCents, month, year, payload } = {}) {
  const safeCreditorName = String(creditorName || 'quem vai receber').trim() || 'quem vai receber';
  const periodLabel = month && year ? monthLabel(month, year) : 'este mês';
  return [
    `Oi! Separei ${formatBRLFromCents(amountCents)} para acertar ${periodLabel} por aqui.`,
    `Para facilitar, já deixei o Pix copia e cola de ${safeCreditorName} logo abaixo:`,
    String(payload || '').trim(),
    'Depois me avisa no app quando fizer o Pix 💸'
  ].filter(Boolean).join('\n\n');
}

function coerceMoneyValueToCents(rawValue, fallback = 0) {
  if (rawValue === null || rawValue === undefined || rawValue === '') {
    return Math.max(0, Number(fallback || 0));
  }

  if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
    return Math.max(0, Math.round(rawValue));
  }

  const raw = String(rawValue || '').trim();
  if (!raw) return Math.max(0, Number(fallback || 0));

  if (/^-?\d+$/.test(raw)) {
    return Math.max(0, Number(raw));
  }

  const cents = centsFromPtBrMoney(raw);
  if (Number.isFinite(cents)) return Math.max(0, cents);

  return Math.max(0, Number(fallback || 0));
}

function getSharedDebtCardMonthlySettlementRowById(settlementId) {
  const safeSettlementId = Number(settlementId || 0);
  if (!safeSettlementId) return null;
  return db.prepare(`
    SELECT *
    FROM shared_debt_monthly_settlements
    WHERE id = ?
      AND request_kind = 'card'
    LIMIT 1
  `).get(safeSettlementId);
}

function getSharedDebtCardMonthlySettlementSnapshotById(settlementId) {
  const settlementRow = getSharedDebtCardMonthlySettlementRowById(settlementId);
  if (!settlementRow) return null;
  return getSharedDebtCardMonthlySettlementSnapshot({
    requesterUserId: settlementRow.requester_user_id,
    receiverUserId: settlementRow.receiver_user_id,
    month: settlementRow.month,
    year: settlementRow.year
  });
}

function buildSharedDebtCardMonthlyIntentPreview(snapshot, rawAmountCents, options = {}) {
  const safeSnapshot = snapshot || null;
  const openCents = Math.max(0, Number(safeSnapshot?.openCents || 0));
  const maxAmountCents = options && Number.isFinite(Number(options.maxAmountCents))
    ? Math.max(0, Number(options.maxAmountCents || 0))
    : openCents;
  const requestedAmount = Math.max(0, Math.min(maxAmountCents, Number(rawAmountCents || 0)));
  const rows = (Array.isArray(safeSnapshot?.requestRows) ? safeSnapshot.requestRows : []).map((row) => {
    const totalCents = Math.max(0, Number(row?.amount_cents || 0));
    const paidCents = Math.min(totalCents, Math.max(0, Number(row?.amount_paid_cents || (row?.status === 'settled' ? totalCents : 0))));
    return {
      id: Number(row?.id || 0),
      description: String(row?.description_snapshot || 'Cobrança do mês').trim() || 'Cobrança do mês',
      pendingCents: Math.max(0, totalCents - paidCents),
      totalCents,
      paidCents,
      txnDate: row?.source_txn_date_snapshot || row?.created_at || null
    };
  }).filter((row) => row.pendingCents > 0);

  let remainingToAllocate = requestedAmount;
  let fullySettledCount = 0;
  let touchedCount = 0;
  let partialRow = null;
  let allocatedCents = 0;
  const allocationRows = [];

  for (const row of rows) {
    if (remainingToAllocate <= 0) break;
    const appliedCents = Math.min(row.pendingCents, remainingToAllocate);
    if (appliedCents <= 0) continue;

    touchedCount += 1;
    allocatedCents += appliedCents;
    remainingToAllocate -= appliedCents;

    const resultingPendingCents = Math.max(0, row.pendingCents - appliedCents);
    const resultingPaidCents = Math.min(row.totalCents, row.paidCents + appliedCents);

    allocationRows.push({
      id: row.id,
      description: row.description,
      txnDate: row.txnDate,
      totalCents: row.totalCents,
      beforePaidCents: row.paidCents,
      beforePendingCents: row.pendingCents,
      appliedCents,
      afterPaidCents: resultingPaidCents,
      afterPendingCents: resultingPendingCents,
      settlesRequest: resultingPendingCents <= 0
    });

    if (appliedCents >= row.pendingCents) {
      fullySettledCount += 1;
      continue;
    }

    partialRow = {
      id: row.id,
      description: row.description,
      beforeCents: row.pendingCents,
      appliedCents,
      remainingCents: resultingPendingCents,
      txnDate: row.txnDate
    };
    break;
  }

  let summary = 'Escolha um valor para eu te mostrar como isso vai se espalhar nas compras do mês.';
  if (requestedAmount > 0 && rows.length === 0) {
    summary = 'Não encontrei compras aceitas em aberto para esse mês.';
  } else if (requestedAmount > 0 && fullySettledCount > 0 && !partialRow && requestedAmount >= maxAmountCents) {
    summary = `Esse valor fecha ${formatCountLabel(fullySettledCount, 'cobrança', 'cobranças')} e deixa o mês redondinho.`;
  } else if (requestedAmount > 0 && fullySettledCount > 0 && !partialRow) {
    summary = `Esse valor fecha ${formatCountLabel(fullySettledCount, 'cobrança', 'cobranças')} e o restante do mês continua em aberto.`;
  } else if (requestedAmount > 0 && fullySettledCount > 0 && partialRow) {
    summary = `Esse valor fecha ${formatCountLabel(fullySettledCount, 'cobrança', 'cobranças')} e deixa 1 com ${formatBRLFromCents(partialRow.remainingCents)} em aberto.`;
  } else if (requestedAmount > 0 && partialRow) {
    summary = `Esse valor entra em 1 cobrança e deixa ${formatBRLFromCents(partialRow.remainingCents)} em aberto.`;
  } else if (requestedAmount > 0) {
    summary = 'Esse valor começa a andar nas compras mais antigas do mês.';
  }

  return {
    amountCents: requestedAmount,
    openCents,
    maxAmountCents,
    allocatedCents,
    remainingToAllocateCents: Math.max(0, remainingToAllocate),
    fullySettledCount,
    touchedCount,
    partialRow,
    summary,
    rows: rows.map((row) => ({
      id: row.id,
      description: row.description,
      pendingCents: row.pendingCents,
      totalCents: row.totalCents,
      paidCents: row.paidCents,
      txnDate: row.txnDate
    })),
    allocationRows
  };
}

function buildSharedDebtCardMonthlyIntentDisplayRows(snapshot) {
  const safeSnapshot = snapshot || null;
  const rows = Array.isArray(safeSnapshot?.intentRows) ? safeSnapshot.intentRows : [];
  const maxConfirmableCents = Math.max(0, Number(safeSnapshot?.totalAcceptedCents || 0) - Number(safeSnapshot?.confirmedCents || 0));
  const periodLabel = monthLabel(safeSnapshot?.month, safeSnapshot?.year);

  return rows
    .map((row) => {
      const normalizedStatus = normalizeSharedDebtPaymentIntentStatus(row?.status);
      const amountCents = Math.max(0, Number(row?.amount_cents || 0));
      const preview = normalizedStatus === 'reported'
        ? buildSharedDebtCardMonthlyIntentPreview(safeSnapshot, amountCents, { maxAmountCents: maxConfirmableCents })
        : null;
      const payerNote = String(row?.payer_note || '').trim() || null;
      const creditorNote = String(row?.creditor_note || '').trim() || null;
      const activityAt = normalizedStatus === 'confirmed'
        ? (row?.confirmed_at || row?.updated_at || row?.reported_at || row?.created_at || null)
        : normalizedStatus === 'rejected'
          ? (row?.rejected_at || row?.updated_at || row?.reported_at || row?.created_at || null)
          : normalizedStatus === 'reported'
            ? (row?.reported_at || row?.updated_at || row?.created_at || null)
            : normalizedStatus === 'cancelled'
              ? (row?.cancelled_at || row?.updated_at || row?.generated_at || row?.created_at || null)
              : (row?.generated_at || row?.updated_at || row?.created_at || null);
      const historyLabel = normalizedStatus === 'reported'
        ? 'Pix avisado'
        : normalizedStatus === 'confirmed'
          ? 'Recebimento confirmado'
          : normalizedStatus === 'rejected'
            ? 'Pix voltou para revisão'
            : normalizedStatus === 'cancelled'
              ? 'Tentativa substituída'
              : 'Pix gerado';
      const historySummary = normalizedStatus === 'reported'
        ? (preview?.summary || 'Esse valor foi avisado e agora está aguardando confirmação nessa carteira.')
        : normalizedStatus === 'confirmed'
          ? `Esse valor já entrou como confirmado na carteira de ${periodLabel}.`
          : normalizedStatus === 'rejected'
            ? 'Esse aviso voltou para o saldo aberto dessa carteira.'
            : normalizedStatus === 'cancelled'
              ? 'Essa tentativa ficou para trás quando um novo código entrou em cena.'
              : 'Essa tentativa de Pix ficou registrada nessa carteira.';

      return {
        ...row,
        status: normalizedStatus,
        payer_note: payerNote,
        creditor_note: creditorNote,
        amountCents,
        amountFormatted: formatBRLFromCents(amountCents),
        reportedAtLabel: row?.reported_at ? formatDateBR(row.reported_at) : null,
        reportedAtTimeLabel: row?.reported_at ? dayjs(row.reported_at).format('HH:mm') : null,
        confirmedAtLabel: row?.confirmed_at ? formatDateBR(row.confirmed_at) : null,
        confirmedAtTimeLabel: row?.confirmed_at ? dayjs(row.confirmed_at).format('HH:mm') : null,
        rejectedAtLabel: row?.rejected_at ? formatDateBR(row.rejected_at) : null,
        rejectedAtTimeLabel: row?.rejected_at ? dayjs(row.rejected_at).format('HH:mm') : null,
        activityAt,
        activityAtLabel: activityAt ? formatDateBR(activityAt) : null,
        activityAtTimeLabel: activityAt ? dayjs(activityAt).format('HH:mm') : null,
        historyLabel,
        historySummary,
        historyNote: normalizedStatus === 'reported' ? payerNote : creditorNote,
        preview,
        canConfirm: normalizedStatus === 'reported' && !!preview && Number(preview.allocatedCents || 0) > 0,
        isStale: normalizedStatus === 'reported' && !!preview && Number(preview.allocatedCents || 0) !== amountCents
      };
    })
    .sort((a, b) => String(b?.activityAt || b?.updated_at || b?.created_at || '').localeCompare(String(a?.activityAt || a?.updated_at || a?.created_at || '')));
}

function buildSharedDebtCardMonthlyIntentResultSummary(preview) {
  const safePreview = preview || null;
  const allocatedCents = Math.max(0, Number(safePreview?.allocatedCents || 0));
  if (!allocatedCents) {
    return 'Esse Pix não encontrou saldo em aberto para distribuir agora.';
  }
  return safePreview?.summary || `Esse Pix entra com ${formatBRLFromCents(allocatedCents)} nessa carteira do mês.`;
}

function cancelSharedDebtGeneratedMonthlyIntents(settlementId, receiverUserId, keepIntentId = null) {
  const safeSettlementId = Number(settlementId || 0);
  const safeReceiverId = Number(receiverUserId || 0);
  const safeKeepIntentId = Number(keepIntentId || 0) || null;
  if (!safeSettlementId || !safeReceiverId) return 0;

  const now = nowIso();
  const params = [now, now, safeSettlementId, safeReceiverId];
  let sql = `
    UPDATE shared_debt_payment_intents
    SET status = 'cancelled',
        cancelled_at = COALESCE(cancelled_at, ?),
        updated_at = ?
    WHERE settlement_id = ?
      AND receiver_user_id = ?
      AND status = 'generated'
  `;

  if (safeKeepIntentId) {
    sql += ` AND id <> ?`;
    params.push(safeKeepIntentId);
  }

  return db.prepare(sql).run(...params).changes || 0;
}

function attachSharedDebtPixMeta(items = [], currentUserId = null) {
  const rows = Array.isArray(items) ? items : [];
  const requesterIds = rows.map((item) => Number(item?.requester_user_id || 0)).filter(Boolean);
  const pixProfiles = getUserPixProfilesByUserIds(requesterIds);

  return rows.map((item) => {
    const requestKind = normalizeSharedDebtRequestKind(item?.request_kind);
    const status = String(item?.status || 'pending').trim().toLowerCase();
    const totalCents = Math.max(0, Number(item?.amount_cents || 0));
    let paidCents = Math.max(0, Number(item?.amount_paid_cents || 0));
    if (status === 'settled' && paidCents < totalCents) paidCents = totalCents;
    if (paidCents > totalCents) paidCents = totalCents;
    const pendingCents = Math.max(0, totalCents - paidCents);
    const creditorProfile = pixProfiles.get(Number(item?.requester_user_id || 0)) || null;
    const currentUserIsCreditor = Number(item?.requester_user_id || 0) === Number(currentUserId || 0);
    const paymentWaitingConfirmation = status === 'accepted' && !!item?.payment_marked_at;

    let pixAvailable = false;
    let pixUnavailableReason = null;

    if (requestKind !== 'manual') {
      pixUnavailableReason = 'Nesta fase, o Pix mora só nos lembretes avulsos.';
    } else if (!['pending', 'accepted'].includes(status)) {
      pixUnavailableReason = 'Esse lembrete já saiu da fase de pagamento.';
    } else if (paymentWaitingConfirmation) {
      pixUnavailableReason = 'O pagamento já foi marcado como feito e agora só falta a confirmação final.';
    } else if (!pendingCents) {
      pixUnavailableReason = 'Esse lembrete já está com o valor fechado por aqui.';
    } else if (!creditorProfile || !creditorProfile.pixEnabled) {
      pixUnavailableReason = currentUserIsCreditor
        ? 'Configure seu Pix em Amigos para liberar o copia e cola deste lembrete.'
        : 'Quem enviou ainda não deixou um Pix prontinho por aqui.';
    } else if (!creditorProfile.pixValid) {
      pixUnavailableReason = currentUserIsCreditor
        ? (creditorProfile.pixReason || 'Seu Pix ainda precisa de um ajuste em Amigos.')
        : 'Quem enviou começou a configurar o Pix, mas ainda falta acertar um detalhe.';
    } else {
      pixAvailable = true;
    }

    return {
      ...item,
      amount_paid_cents: paidCents,
      amount_pending_cents: pendingCents,
      pix_available: pixAvailable,
      pix_unavailable_reason: pixUnavailableReason,
      pix_masked_key: creditorProfile?.pixMaskedKey || null,
      pix_key_type_label: creditorProfile?.pixKeyTypeLabel || null,
      pix_creditor_name: creditorProfile?.ownerName || item?.requester_name || item?.requester_email || 'Quem vai receber',
      pix_creditor_city: creditorProfile?.pixCity || null,
      pix_creditor_profile_ready: !!creditorProfile?.pixValid,
      pix_creditor_has_profile: !!creditorProfile?.pixEnabled,
      pix_is_current_user_creditor: currentUserIsCreditor,
      pix_qr_supported: !!QRCode
    };
  });
}

function normalizeSharedDebtRequestKind(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['card', 'manual'].includes(normalized)) return normalized;
  return 'card';
}

function normalizeSharedDebtOriginKind(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['single', 'multiple', 'installment', 'mixed', 'manual'].includes(normalized)) return normalized;
  return 'single';
}

function detectSharedDebtOriginKindFromRows(rows) {
  const cleanRows = Array.from(new Map(
    (rows || [])
      .map(row => (row && typeof row === 'object') ? row : null)
      .filter(Boolean)
      .map(row => [Number(row.id || 0), row])
  ).values()).filter(row => Number(row.id || 0) > 0);

  if (cleanRows.length <= 1) return 'single';

  const rootKeys = new Set();
  let installmentLikeCount = 0;

  cleanRows.forEach(row => {
    const rootId = Number(row.parent_txn_id || row.id || 0);
    if (rootId) rootKeys.add(rootId);

    const description = String(row.description || row.description_snapshot || '').trim();
    const looksLikeInstallment = Number(row.parent_txn_id || 0) > 0 || /\(\d{2}\/\d{2}\)\s*$/.test(description);
    if (looksLikeInstallment) installmentLikeCount += 1;
  });

  if (installmentLikeCount > 0 && rootKeys.size <= 1) return 'installment';
  if (installmentLikeCount > 0) return 'mixed';
  return 'multiple';
}

const SHARED_DEBT_ARCHIVABLE_STATUSES = new Set(['settled', 'cancelled', 'rejection_accepted_by_sender', 'rejection_contested_by_sender']);

function normalizeSharedDebtBatchStatus(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['pending', 'partial', 'accepted', 'rejected', 'settled'].includes(normalized)) return normalized;
  return 'pending';
}

function canArchiveSharedDebtStatus(value) {
  return SHARED_DEBT_ARCHIVABLE_STATUSES.has(String(value || '').trim().toLowerCase());
}

const SHARED_DEBT_MONTHLY_SETTLEMENT_STATUSES = new Set(['open', 'awaiting_confirmation', 'partial', 'settled']);
const SHARED_DEBT_PAYMENT_INTENT_STATUSES = new Set(['generated', 'reported', 'confirmed', 'rejected', 'cancelled']);

function normalizeSharedDebtMonthlySettlementStatus(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return SHARED_DEBT_MONTHLY_SETTLEMENT_STATUSES.has(normalized) ? normalized : 'open';
}

function normalizeSharedDebtPaymentIntentStatus(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return SHARED_DEBT_PAYMENT_INTENT_STATUSES.has(normalized) ? normalized : 'generated';
}

function buildSharedDebtCardMonthlySettlementKey({ requesterUserId, receiverUserId, month, year, requestKind = 'card' } = {}) {
  const requesterId = Number(requesterUserId || 0);
  const receiverId = Number(receiverUserId || 0);
  const safeMonth = Number(month || 0);
  const safeYear = Number(year || 0);
  const kind = normalizeSharedDebtRequestKind(requestKind);
  if (!requesterId || !receiverId || !safeMonth || !safeYear || kind !== 'card') return null;
  return `${requesterId}:${receiverId}:${safeYear}:${String(safeMonth).padStart(2, '0')}:${kind}`;
}

function isCardSharedDebtRequestKind(value) {
  return normalizeSharedDebtRequestKind(value) === 'card';
}

function getSharedDebtCardMonthlySettlementRow(requesterUserId, receiverUserId, month, year) {
  return db.prepare(`
    SELECT *
    FROM shared_debt_monthly_settlements
    WHERE requester_user_id = ?
      AND receiver_user_id = ?
      AND month = ?
      AND year = ?
      AND request_kind = 'card'
    LIMIT 1
  `).get(requesterUserId, receiverUserId, month, year);
}

function ensureSharedDebtCardMonthlySettlementRow(requesterUserId, receiverUserId, month, year) {
  let row = getSharedDebtCardMonthlySettlementRow(requesterUserId, receiverUserId, month, year);
  if (row) return row;

  const now = nowIso();
  db.prepare(`
    INSERT OR IGNORE INTO shared_debt_monthly_settlements (
      requester_user_id, receiver_user_id, month, year, request_kind, status,
      request_count, total_accepted_cents, reserved_cents, confirmed_cents, open_cents,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'card', 'open', 0, 0, 0, 0, 0, ?, ?)
  `).run(requesterUserId, receiverUserId, month, year, now, now);

  return getSharedDebtCardMonthlySettlementRow(requesterUserId, receiverUserId, month, year);
}

function upsertSharedDebtCardMonthlySettlementCache(snapshot) {
  if (!snapshot) return null;

  const requesterUserId = Number(snapshot.requesterUserId || 0);
  const receiverUserId = Number(snapshot.receiverUserId || 0);
  const month = Number(snapshot.month || 0);
  const year = Number(snapshot.year || 0);
  if (!requesterUserId || !receiverUserId || !month || !year) return null;

  const createdAt = snapshot.createdAt || nowIso();
  const updatedAt = snapshot.updatedAt || nowIso();

  db.prepare(`
    INSERT INTO shared_debt_monthly_settlements (
      requester_user_id, receiver_user_id, month, year, request_kind, status,
      request_count, total_accepted_cents, reserved_cents, confirmed_cents, open_cents,
      last_reported_at, last_confirmed_at, last_rejected_at, last_activity_at,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'card', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(requester_user_id, receiver_user_id, month, year, request_kind)
    DO UPDATE SET
      status = excluded.status,
      request_count = excluded.request_count,
      total_accepted_cents = excluded.total_accepted_cents,
      reserved_cents = excluded.reserved_cents,
      confirmed_cents = excluded.confirmed_cents,
      open_cents = excluded.open_cents,
      last_reported_at = excluded.last_reported_at,
      last_confirmed_at = excluded.last_confirmed_at,
      last_rejected_at = excluded.last_rejected_at,
      last_activity_at = excluded.last_activity_at,
      updated_at = excluded.updated_at
  `).run(
    requesterUserId,
    receiverUserId,
    month,
    year,
    normalizeSharedDebtMonthlySettlementStatus(snapshot.status),
    Math.max(0, Number(snapshot.requestCount || 0)),
    Math.max(0, Number(snapshot.totalAcceptedCents || 0)),
    Math.max(0, Number(snapshot.reservedCents || 0)),
    Math.max(0, Number(snapshot.confirmedCents || 0)),
    Math.max(0, Number(snapshot.openCents || 0)),
    snapshot.lastReportedAt || null,
    snapshot.lastConfirmedAt || null,
    snapshot.lastRejectedAt || null,
    snapshot.lastActivityAt || null,
    createdAt,
    updatedAt
  );

  return getSharedDebtCardMonthlySettlementRow(requesterUserId, receiverUserId, month, year);
}

function getSharedDebtCardMonthlySettlementSnapshot({ requesterUserId, receiverUserId, month, year } = {}) {
  const safeRequester = Number(requesterUserId || 0);
  const safeReceiver = Number(receiverUserId || 0);
  const safeMonth = Number(month || 0);
  const safeYear = Number(year || 0);

  if (!safeRequester || !safeReceiver || !safeMonth || !safeYear) return null;

  const requestRows = db.prepare(`
    SELECT
      r.id,
      r.status,
      r.amount_cents,
      r.amount_paid_cents,
      r.payment_marked_at,
      r.created_at,
      r.updated_at,
      r.responded_at,
      r.resolved_at,
      r.description_snapshot,
      COALESCE(r.source_due_month, i.month, t.due_month) AS source_due_month,
      COALESCE(r.source_due_year, i.year, t.due_year) AS source_due_year
    FROM shared_debt_requests r
    LEFT JOIN transactions t ON t.id = r.source_transaction_id AND t.user_id = r.requester_user_id
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    WHERE r.requester_user_id = ?
      AND r.receiver_user_id = ?
      AND COALESCE(r.request_kind, 'card') = 'card'
      AND COALESCE(r.source_due_month, i.month, t.due_month) = ?
      AND COALESCE(r.source_due_year, i.year, t.due_year) = ?
      AND r.status IN ('accepted', 'settled')
    ORDER BY COALESCE(r.source_txn_date_snapshot, t.txn_date, r.created_at) ASC, r.created_at ASC, r.id ASC
  `).all(safeRequester, safeReceiver, safeMonth, safeYear);

  const existingSettlement = getSharedDebtCardMonthlySettlementRow(safeRequester, safeReceiver, safeMonth, safeYear);
  if (!requestRows.length && !existingSettlement) return null;

  const settlementRow = existingSettlement || ensureSharedDebtCardMonthlySettlementRow(safeRequester, safeReceiver, safeMonth, safeYear);
  const intentRows = settlementRow
    ? db.prepare(`
        SELECT *
        FROM shared_debt_payment_intents
        WHERE settlement_id = ?
        ORDER BY COALESCE(reported_at, generated_at, created_at) DESC, id DESC
      `).all(settlementRow.id)
    : [];

  let totalAcceptedCents = 0;
  let confirmedCents = 0;
  let legacyReservedCents = 0;
  let lastLegacyReportedAt = null;
  let lastLegacyConfirmedAt = null;
  let lastRequestActivityAt = settlementRow?.updated_at || settlementRow?.created_at || null;

  requestRows.forEach((row) => {
    const total = Math.max(0, Number(row.amount_cents || 0));
    const confirmed = Math.min(total, Math.max(0, Number(row.amount_paid_cents || (row.status === 'settled' ? total : 0))));
    totalAcceptedCents += total;
    confirmedCents += confirmed;

    if (row.status === 'accepted' && row.payment_marked_at && confirmed < total) {
      legacyReservedCents += (total - confirmed);
      if (!lastLegacyReportedAt || String(row.payment_marked_at) > String(lastLegacyReportedAt)) {
        lastLegacyReportedAt = row.payment_marked_at;
      }
    }

    const resolvedAt = row.resolved_at || row.updated_at || row.responded_at || null;
    if (confirmed > 0 && resolvedAt && (!lastLegacyConfirmedAt || String(resolvedAt) > String(lastLegacyConfirmedAt))) {
      lastLegacyConfirmedAt = resolvedAt;
    }

    const activityAt = row.updated_at || row.resolved_at || row.responded_at || row.created_at || null;
    if (activityAt && (!lastRequestActivityAt || String(activityAt) > String(lastRequestActivityAt))) {
      lastRequestActivityAt = activityAt;
    }
  });

  let intentReservedCents = 0;
  let generatedIntentCount = 0;
  let reportedIntentCount = 0;
  let confirmedIntentCount = 0;
  let rejectedIntentCount = 0;
  let lastIntentReportedAt = null;
  let lastIntentConfirmedAt = null;
  let lastIntentRejectedAt = null;
  let lastIntentActivityAt = null;

  intentRows.forEach((row) => {
    const status = normalizeSharedDebtPaymentIntentStatus(row.status);
    const amount = Math.max(0, Number(row.amount_cents || 0));
    const activityAt = row.updated_at || row.reported_at || row.generated_at || row.created_at || null;
    if (activityAt && (!lastIntentActivityAt || String(activityAt) > String(lastIntentActivityAt))) {
      lastIntentActivityAt = activityAt;
    }

    if (status === 'generated') {
      generatedIntentCount += 1;
      return;
    }

    if (status === 'reported') {
      reportedIntentCount += 1;
      intentReservedCents += amount;
      const reportedAt = row.reported_at || row.updated_at || row.created_at || null;
      if (reportedAt && (!lastIntentReportedAt || String(reportedAt) > String(lastIntentReportedAt))) {
        lastIntentReportedAt = reportedAt;
      }
      return;
    }

    if (status === 'confirmed') {
      confirmedIntentCount += 1;
      const confirmedAt = row.confirmed_at || row.updated_at || row.created_at || null;
      if (confirmedAt && (!lastIntentConfirmedAt || String(confirmedAt) > String(lastIntentConfirmedAt))) {
        lastIntentConfirmedAt = confirmedAt;
      }
      return;
    }

    if (status === 'rejected') {
      rejectedIntentCount += 1;
      const rejectedAt = row.rejected_at || row.updated_at || row.created_at || null;
      if (rejectedAt && (!lastIntentRejectedAt || String(rejectedAt) > String(lastIntentRejectedAt))) {
        lastIntentRejectedAt = rejectedAt;
      }
    }
  });

  const reservedCents = Math.max(0, legacyReservedCents + intentReservedCents);
  const openCents = Math.max(0, totalAcceptedCents - confirmedCents - reservedCents);

  let status = 'open';
  if (totalAcceptedCents > 0 && openCents === 0 && reservedCents === 0) {
    status = 'settled';
  } else if (confirmedCents > 0) {
    status = 'partial';
  } else if (reservedCents > 0) {
    status = 'awaiting_confirmation';
  }

  const requestCount = requestRows.length;
  const lastReportedAt = [lastIntentReportedAt, lastLegacyReportedAt].filter(Boolean).sort().slice(-1)[0] || null;
  const lastConfirmedAt = [lastIntentConfirmedAt, lastLegacyConfirmedAt].filter(Boolean).sort().slice(-1)[0] || null;
  const lastRejectedAt = lastIntentRejectedAt || settlementRow?.last_rejected_at || null;
  const lastActivityAt = [
    lastReportedAt,
    lastConfirmedAt,
    lastRejectedAt,
    lastIntentActivityAt,
    lastRequestActivityAt,
    settlementRow?.updated_at || null
  ].filter(Boolean).sort().slice(-1)[0] || null;

  const snapshot = {
    id: settlementRow?.id || null,
    settlementKey: buildSharedDebtCardMonthlySettlementKey({ requesterUserId: safeRequester, receiverUserId: safeReceiver, month: safeMonth, year: safeYear }),
    requesterUserId: safeRequester,
    receiverUserId: safeReceiver,
    month: safeMonth,
    year: safeYear,
    requestKind: 'card',
    status,
    requestCount,
    totalAcceptedCents,
    reservedCents,
    confirmedCents,
    openCents,
    legacyReservedCents,
    intentReservedCents,
    generatedIntentCount,
    reportedIntentCount,
    confirmedIntentCount,
    rejectedIntentCount,
    lastReportedAt,
    lastConfirmedAt,
    lastRejectedAt,
    lastActivityAt,
    hasProtectedActivity: reservedCents > 0 || confirmedCents > 0,
    requestRows,
    intentRows,
    createdAt: settlementRow?.created_at || nowIso(),
    updatedAt: nowIso()
  };

  snapshot.intentRowsDetailed = buildSharedDebtCardMonthlyIntentDisplayRows(snapshot);
  snapshot.reportedIntentRows = snapshot.intentRowsDetailed.filter((row) => row.status === 'reported');

  const persisted = upsertSharedDebtCardMonthlySettlementCache(snapshot);
  return { ...snapshot, id: persisted?.id || snapshot.id || null };
}

function attachSharedDebtCardMonthlyMeta(items = []) {
  const rows = Array.isArray(items) ? items : [];
  const snapshotsByKey = new Map();

  rows.forEach((item) => {
    if (!isCardSharedDebtRequestKind(item?.request_kind)) return;
    const month = Number(item?.source_due_month || 0);
    const year = Number(item?.source_due_year || 0);
    const requesterUserId = Number(item?.requester_user_id || 0);
    const receiverUserId = Number(item?.receiver_user_id || 0);
    const key = buildSharedDebtCardMonthlySettlementKey({ requesterUserId, receiverUserId, month, year });
    if (!key || snapshotsByKey.has(key)) return;
    snapshotsByKey.set(key, getSharedDebtCardMonthlySettlementSnapshot({ requesterUserId, receiverUserId, month, year }));
  });

  const enhancedItems = rows.map((item) => {
    const month = Number(item?.source_due_month || 0);
    const year = Number(item?.source_due_year || 0);
    const requesterUserId = Number(item?.requester_user_id || 0);
    const receiverUserId = Number(item?.receiver_user_id || 0);
    const key = buildSharedDebtCardMonthlySettlementKey({ requesterUserId, receiverUserId, month, year });
    const snapshot = key ? snapshotsByKey.get(key) : null;
    const totalCents = Math.max(0, Number(item?.amount_cents || 0));
    let paidCents = Math.max(0, Number(item?.amount_paid_cents || (item?.status === 'settled' ? totalCents : 0)));
    if (paidCents > totalCents) paidCents = totalCents;

    return {
      ...item,
      amount_paid_cents: paidCents,
      amount_pending_cents: Math.max(0, totalCents - paidCents),
      card_monthly_settlement_key: key,
      card_monthly_settlement_id: snapshot?.id || null,
      card_monthly_status: snapshot?.status || null,
      card_monthly_total_cents: snapshot?.totalAcceptedCents || 0,
      card_monthly_reserved_cents: snapshot?.reservedCents || 0,
      card_monthly_confirmed_cents: snapshot?.confirmedCents || 0,
      card_monthly_open_cents: snapshot?.openCents || 0,
      card_monthly_request_count: snapshot?.requestCount || 0,
      card_monthly_generated_intent_count: snapshot?.generatedIntentCount || 0,
      card_monthly_reported_intent_count: snapshot?.reportedIntentCount || 0,
      card_monthly_has_protected_activity: !!snapshot?.hasProtectedActivity,
      card_monthly_last_activity_at: snapshot?.lastActivityAt || null
    };
  });

  return {
    items: enhancedItems,
    snapshots: Array.from(snapshotsByKey.values()).filter(Boolean)
  };
}

function getSharedDebtCardMutationBlockersForTransactions(userId, transactionRowsOrIds = []) {
  const transactionIds = Array.from(new Set((Array.isArray(transactionRowsOrIds) ? transactionRowsOrIds : [transactionRowsOrIds]).map((entry) => {
    if (entry && typeof entry === 'object') return Number(entry.id || 0);
    return Number(entry || 0);
  }).filter(Boolean)));

  if (!transactionIds.length) return [];

  const placeholders = transactionIds.map(() => '?').join(', ');
  const rows = db.prepare(`
    SELECT DISTINCT
      r.requester_user_id,
      r.receiver_user_id,
      COALESCE(r.source_due_month, i.month, t.due_month) AS source_due_month,
      COALESCE(r.source_due_year, i.year, t.due_year) AS source_due_year,
      u.name AS receiver_name,
      u.email AS receiver_email
    FROM shared_debt_requests r
    LEFT JOIN transactions t ON t.id = r.source_transaction_id AND t.user_id = r.requester_user_id
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    LEFT JOIN users u ON u.id = r.receiver_user_id
    WHERE r.requester_user_id = ?
      AND COALESCE(r.request_kind, 'card') = 'card'
      AND r.source_transaction_id IN (${placeholders})
      AND r.status IN ('accepted', 'settled')
  `).all(userId, ...transactionIds);

  const blockersByKey = new Map();
  rows.forEach((row) => {
    const month = Number(row.source_due_month || 0);
    const year = Number(row.source_due_year || 0);
    const key = buildSharedDebtCardMonthlySettlementKey({
      requesterUserId: row.requester_user_id,
      receiverUserId: row.receiver_user_id,
      month,
      year
    });
    if (!key || blockersByKey.has(key)) return;

    const snapshot = getSharedDebtCardMonthlySettlementSnapshot({
      requesterUserId: row.requester_user_id,
      receiverUserId: row.receiver_user_id,
      month,
      year
    });
    if (!snapshot || !snapshot.hasProtectedActivity) return;

    blockersByKey.set(key, {
      ...snapshot,
      counterpartName: row.receiver_name || row.receiver_email || 'essa pessoa'
    });
  });

  return Array.from(blockersByKey.values()).sort((a, b) => {
    const rankDiff = ((b.year || 0) * 100 + (b.month || 0)) - ((a.year || 0) * 100 + (a.month || 0));
    if (rankDiff !== 0) return rankDiff;
    return String(a.counterpartName || '').localeCompare(String(b.counterpartName || ''), 'pt-BR', { sensitivity: 'base' });
  });
}

function buildSharedDebtCardMutationBlockerMessage(blockers = []) {
  const items = Array.isArray(blockers) ? blockers.filter(Boolean) : [];
  if (!items.length) return null;

  const first = items[0];
  const pieces = [];
  if (Number(first.reservedCents || 0) > 0) pieces.push(`${formatBRLFromCents(first.reservedCents)} aguardando confirmação`);
  if (Number(first.confirmedCents || 0) > 0) pieces.push(`${formatBRLFromCents(first.confirmedCents)} já confirmado`);
  const stateText = pieces.length ? pieces.join(' e ') : 'movimentação em andamento';

  if (items.length === 1) {
    return `Essa compra já conversa com a liquidação de ${monthLabel(first.month, first.year)} para ${first.counterpartName}. Como já tem ${stateText}, vou segurar essa edição por enquanto para não embaralhar o saldo.`;
  }

  return `Tem ${formatCountLabel(items.length, 'mês com liquidação em andamento', 'meses com liquidação em andamento')} ligados a esse ajuste. Para não embaralhar o saldo do Pix, essa edição fica bloqueada enquanto houver valor aguardando confirmação ou já confirmado.`;
}

function resolveSharedDebtViewPath(rawPath, fallback = '/shared-debts') {
  const normalized = String(rawPath || '').trim();
  if (normalized === '/shared-debts' || normalized === '/shared-debts/archive') return normalized;
  return fallback;
}

function getSharedDebtArchivedRequestIdSet(userId) {
  const rows = db.prepare(`
    SELECT request_id
    FROM shared_debt_archives
    WHERE user_id = ? AND is_archived = 1
  `).all(userId);
  return new Set(rows.map((row) => Number(row.request_id)).filter(Boolean));
}

function filterSharedDebtItemsByArchiveMode(items = [], archivedRequestIds = new Set(), archiveMode = false) {
  return (Array.isArray(items) ? items : []).filter((item) => {
    const requestId = Number(item?.id || 0);
    if (!requestId) return false;
    const isArchived = archivedRequestIds.has(requestId);
    return archiveMode ? isArchived : !isArchived;
  });
}

function upsertSharedDebtArchiveState({ requestId, userId, isArchived, archivedFromStatus = null, timestamp = null }) {
  const cleanRequestId = Number(requestId || 0);
  const cleanUserId = Number(userId || 0);
  if (!cleanRequestId || !cleanUserId) return false;

  const now = timestamp || nowIso();
  const existing = db.prepare(`
    SELECT id, archived_at, created_at
    FROM shared_debt_archives
    WHERE request_id = ? AND user_id = ?
    LIMIT 1
  `).get(cleanRequestId, cleanUserId);

  if (existing) {
    db.prepare(`
      UPDATE shared_debt_archives
      SET is_archived = ?,
          archived_at = ?,
          restored_at = ?,
          archived_from_status = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      isArchived ? 1 : 0,
      isArchived ? now : existing.archived_at,
      isArchived ? null : now,
      archivedFromStatus,
      now,
      existing.id
    );
    return true;
  }

  db.prepare(`
    INSERT INTO shared_debt_archives (
      request_id, user_id, is_archived, archived_at, restored_at,
      archived_from_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    cleanRequestId,
    cleanUserId,
    isArchived ? 1 : 0,
    isArchived ? now : null,
    isArchived ? null : now,
    archivedFromStatus,
    now,
    now
  );
  return true;
}

function buildSharedDebtsPagePayload(userId, query = {}, archiveMode = false) {
  const requestIdToHighlight = Number(query?.request) || null;
  const batchIdToHighlight = Number(query?.batch) || null;
  const settlementIdToHighlight = Number(query?.settlement) || null;
  const archivedRequestIds = getSharedDebtArchivedRequestIdSet(userId);
  const receivedWithPixMeta = attachSharedDebtPixMeta(getSharedDebtRequestsReceived(userId), userId);
  const sentWithPixMeta = attachSharedDebtPixMeta(getSharedDebtRequestsSent(userId), userId);
  const receivedSettlementMeta = attachSharedDebtCardMonthlyMeta(receivedWithPixMeta);
  const sentSettlementMeta = attachSharedDebtCardMonthlyMeta(sentWithPixMeta);
  const rawReceived = receivedSettlementMeta.items;
  const rawSent = sentSettlementMeta.items;
  const received = filterSharedDebtItemsByArchiveMode(rawReceived, archivedRequestIds, archiveMode);
  const sent = filterSharedDebtItemsByArchiveMode(rawSent, archivedRequestIds, archiveMode);
  const archivedReceivedCount = filterSharedDebtItemsByArchiveMode(rawReceived, archivedRequestIds, true).length;
  const archivedSentCount = filterSharedDebtItemsByArchiveMode(rawSent, archivedRequestIds, true).length;
  const sharedDebtFilters = normalizeSharedDebtTrackingFilters(query);
  const sharedDebtFiltersActive = hasActiveSharedDebtTrackingFilters(sharedDebtFilters);
  const receivedTracking = filterSharedDebtTrackingItems(received, sharedDebtFilters);
  const sentTracking = filterSharedDebtTrackingItems(sent, sharedDebtFilters);
  const receivedPendingBatches = archiveMode ? [] : buildSharedDebtBatchCards(received, 'received').filter(batch => batch.pendingCount > 0);
  const sentPendingBatches = archiveMode ? [] : buildSharedDebtBatchCards(sent, 'sent').filter(batch => batch.pendingCount > 0);
  const eventsByRequest = getSharedDebtEventsByRequestIds([
    ...received.map(item => item.id),
    ...sent.map(item => item.id)
  ]);

  return {
    requestIdToHighlight,
    batchIdToHighlight,
    settlementIdToHighlight,
    received,
    sent,
    receivedPendingBatches,
    sentPendingBatches,
    receivedTracking,
    sentTracking,
    sharedDebtFilters,
    sharedDebtFiltersActive,
    manualDebtEligiblePeople: archiveMode ? [] : getManualSharedDebtEligiblePeople(userId),
    eventsByRequest,
    archiveMode,
    cardMonthlySettlements: Array.from(new Map([
      ...receivedSettlementMeta.snapshots.map((snapshot) => [snapshot.settlementKey || buildSharedDebtCardMonthlySettlementKey({ requesterUserId: snapshot.requesterUserId, receiverUserId: snapshot.receiverUserId, month: snapshot.month, year: snapshot.year }), snapshot]),
      ...sentSettlementMeta.snapshots.map((snapshot) => [snapshot.settlementKey || buildSharedDebtCardMonthlySettlementKey({ requesterUserId: snapshot.requesterUserId, receiverUserId: snapshot.receiverUserId, month: snapshot.month, year: snapshot.year }), snapshot])
    ]).values()).filter(Boolean),
    pagePath: archiveMode ? '/shared-debts/archive' : '/shared-debts',
    counterpartPath: archiveMode ? '/shared-debts' : '/shared-debts/archive',
    archiveTotalCount: archivedReceivedCount + archivedSentCount,
    archivedReceivedCount,
    archivedSentCount,
    archiveEligibleStatuses: Array.from(SHARED_DEBT_ARCHIVABLE_STATUSES)
  };
}

function renderSharedDebtsPage(req, res, { archiveMode = false } = {}) {
  const userId = req.user.id;

  if (!archiveMode) {
    db.prepare(`
      UPDATE notifications
      SET is_read = 1, read_at = COALESCE(read_at, ?)
      WHERE user_id = ?
        AND (
          related_type IN ('shared_debt_request', 'shared_debt_batch') OR
          type IN ('shared_debt_request', 'shared_debt_batch')
        )
        AND is_read = 0
    `).run(nowIso(), userId);
  }

  const payload = buildSharedDebtsPagePayload(userId, req.query, archiveMode);
  return res.render('shared-debts', {
    title: archiveMode ? 'OrganizaPay | Arquivo de cobranças' : 'OrganizaPay | Cobranças',
    ...payload,
    formatBRLFromCents,
    monthLabel,
    formatDateBR
  });
}

function computeSharedDebtBatchSummary(rows = []) {
  const items = Array.isArray(rows) ? rows : [];
  const counts = {
    pending: 0,
    accepted: 0,
    rejected: 0,
    rejectionAccepted: 0,
    contested: 0,
    cancelled: 0,
    settled: 0,
    paymentMarked: 0
  };

  items.forEach((row) => {
    const status = String(row?.status || 'pending');
    if (status === 'pending') counts.pending += 1;
    else if (status === 'accepted') {
      counts.accepted += 1;
      if (row?.payment_marked_at) counts.paymentMarked += 1;
    } else if (status === 'rejected_by_receiver') counts.rejected += 1;
    else if (status === 'rejection_accepted_by_sender') counts.rejectionAccepted += 1;
    else if (status === 'rejection_contested_by_sender') counts.contested += 1;
    else if (status === 'cancelled') counts.cancelled += 1;
    else if (status === 'settled') counts.settled += 1;
  });

  const total = items.length;
  let statusSummary = 'partial';
  if (!total || counts.pending === total) {
    statusSummary = 'pending';
  } else if (counts.settled === total) {
    statusSummary = 'settled';
  } else if ((counts.rejected + counts.rejectionAccepted + counts.cancelled) === total) {
    statusSummary = 'rejected';
  } else if (counts.accepted === total) {
    statusSummary = 'accepted';
  }

  const respondedCandidates = items
    .map(row => row?.responded_at || (String(row?.status || 'pending') !== 'pending' ? (row?.updated_at || row?.created_at || null) : null))
    .filter(Boolean)
    .sort();

  const firstRespondedAt = respondedCandidates.length ? respondedCandidates[0] : null;
  let resolvedAt = null;
  if (statusSummary === 'settled' || statusSummary === 'rejected') {
    const resolvedCandidates = items
      .map(row => row?.resolved_at || row?.responded_at || row?.updated_at || row?.created_at || null)
      .filter(Boolean)
      .sort();
    resolvedAt = resolvedCandidates.length ? resolvedCandidates[resolvedCandidates.length - 1] : null;
  }

  return { statusSummary, firstRespondedAt, resolvedAt, counts };
}

function createSharedDebtBatch({ requesterUserId, receiverUserId, originKind = 'single', createdAt = null }) {
  const now = createdAt || nowIso();
  const info = db.prepare(`
    INSERT INTO shared_debt_batches (requester_user_id, receiver_user_id, origin_kind, status_summary, created_at, updated_at)
    VALUES (?, ?, ?, 'pending', ?, ?)
  `).run(requesterUserId, receiverUserId, normalizeSharedDebtOriginKind(originKind), now, now);

  return Number(info.lastInsertRowid);
}

function refreshSharedDebtBatch(batchId, timestamp = null) {
  const cleanId = Number(batchId || 0);
  if (!cleanId) return null;

  const rows = db.prepare(`
    SELECT id, status, payment_marked_at, responded_at, resolved_at, updated_at, created_at
    FROM shared_debt_requests
    WHERE batch_id = ?
    ORDER BY id ASC
  `).all(cleanId);

  if (!rows.length) {
    db.prepare(`DELETE FROM shared_debt_batches WHERE id = ?`).run(cleanId);
    return null;
  }

  const summary = computeSharedDebtBatchSummary(rows);
  const latestRowTimestamp = rows
    .map(row => row?.updated_at || row?.created_at || null)
    .filter(Boolean)
    .sort()
    .pop() || null;
  const updatedAt = [timestamp || null, latestRowTimestamp].filter(Boolean).sort().pop() || nowIso();

  db.prepare(`
    UPDATE shared_debt_batches
    SET status_summary = ?,
        first_responded_at = ?,
        resolved_at = ?,
        updated_at = ?
    WHERE id = ?
  `).run(summary.statusSummary, summary.firstRespondedAt, summary.resolvedAt, updatedAt, cleanId);

  return { ...summary, updatedAt };
}

function touchSharedDebtBatch(batchId, timestamp = null) {
  return refreshSharedDebtBatch(batchId, timestamp);
}

function batchHasStartedResponse(batchId) {
  const cleanId = Number(batchId || 0);
  if (!cleanId) return false;
  const row = db.prepare(`
    SELECT first_responded_at, status_summary
    FROM shared_debt_batches
    WHERE id = ?
    LIMIT 1
  `).get(cleanId);
  if (!row) return false;
  return !!row.first_responded_at || normalizeSharedDebtBatchStatus(row.status_summary) !== 'pending';
}

function ensureSharedDebtRequestBatchesBackfilled() {
  const rows = db.prepare(`
    SELECT id, requester_user_id, receiver_user_id, created_at
    FROM shared_debt_requests
    WHERE batch_id IS NULL
    ORDER BY created_at ASC, id ASC
  `).all();

  if (!rows.length) return;

  const assignBatch = db.prepare(`UPDATE shared_debt_requests SET batch_id = ? WHERE id = ?`);

  db.transaction(() => {
    rows.forEach(row => {
      const batchId = createSharedDebtBatch({
        requesterUserId: row.requester_user_id,
        receiverUserId: row.receiver_user_id,
        originKind: 'single',
        createdAt: row.created_at || nowIso()
      });
      assignBatch.run(batchId, row.id);
      refreshSharedDebtBatch(batchId, row.created_at || nowIso());
    });
  })();
}

function refreshAllSharedDebtBatches() {
  const ids = db.prepare(`SELECT id FROM shared_debt_batches ORDER BY id ASC`).all().map(row => Number(row.id)).filter(Boolean);
  ids.forEach((batchId) => refreshSharedDebtBatch(batchId));
}

function createSharedDebtSyncContext(userId, options = {}) {
  const actor = getUserRecord(userId);
  return {
    userId,
    requesterDisplayName: actor?.name || actor?.email || 'Um usuário',
    originKind: normalizeSharedDebtOriginKind(options.originKind),
    batchIdsByReceiver: new Map(),
    changesByBatch: new Map()
  };
}

function getOrCreateSharedDebtBatchId(context, receiverUserId) {
  const cleanReceiverId = Number(receiverUserId || 0);
  if (!context || !cleanReceiverId) return null;
  if (context.batchIdsByReceiver.has(cleanReceiverId)) return context.batchIdsByReceiver.get(cleanReceiverId);

  const batchId = createSharedDebtBatch({
    requesterUserId: context.userId,
    receiverUserId: cleanReceiverId,
    originKind: context.originKind
  });

  context.batchIdsByReceiver.set(cleanReceiverId, batchId);
  return batchId;
}

function recordSharedDebtBatchChange(context, payload) {
  if (!context) return;

  const batchId = Number(payload?.batchId || 0);
  const receiverUserId = Number(payload?.receiverUserId || 0);
  const requestId = Number(payload?.requestId || 0);
  if (!batchId || !receiverUserId || !requestId) return;

  if (!context.changesByBatch.has(batchId)) {
    context.changesByBatch.set(batchId, {
      batchId,
      receiverUserId,
      requestIds: new Set(),
      receiverName: payload?.receiverName || null,
      descriptions: [],
      totalCents: 0,
      createdCount: 0,
      updatedCount: 0
    });
  }

  const entry = context.changesByBatch.get(batchId);
  if (entry.requestIds.has(requestId)) return;

  entry.requestIds.add(requestId);
  entry.totalCents += Number(payload?.amountCents || 0);
  if (payload?.description && entry.descriptions.length < 3 && !entry.descriptions.includes(payload.description)) {
    entry.descriptions.push(payload.description);
  }
  if (payload?.kind === 'updated') entry.updatedCount += 1;
  else entry.createdCount += 1;
}

function buildSharedDebtBatchNotificationBody({ requesterDisplayName, actionLabel, itemCount, totalCents, descriptions }) {
  const safeCount = Math.max(0, Number(itemCount || 0));
  const formattedTotal = formatBRLFromCents(Number(totalCents || 0));
  const preview = (descriptions || []).filter(Boolean).slice(0, 2).join(' · ');
  const countLabel = formatCountLabel(safeCount, 'cobrança', 'cobranças');
  const previewSuffix = preview ? ` Nessa leva entraram: ${preview}.` : '';
  return `${requesterDisplayName} ${actionLabel} ${countLabel} para você, somando ${formattedTotal}.${previewSuffix}`;
}

function flushSharedDebtBatchNotifications(context) {
  if (!context || !context.changesByBatch.size) return;

  context.changesByBatch.forEach(entry => {
    const itemCount = entry.requestIds.size;
    if (!itemCount) return;

    const batchSummary = refreshSharedDebtBatch(entry.batchId);
    if (!batchSummary) return;

    const onlyCreated = entry.createdCount > 0 && entry.updatedCount === 0;
    const onlyUpdated = entry.updatedCount > 0 && entry.createdCount === 0;
    const title = onlyCreated
      ? 'Chegou um novo envio compartilhado'
      : onlyUpdated
        ? 'Um envio compartilhado foi atualizado'
        : 'Tem novidade em um envio compartilhado';

    const actionLabel = onlyCreated
      ? 'enviou'
      : onlyUpdated
        ? 'atualizou'
        : 'enviou e atualizou';

    createNotification({
      userId: entry.receiverUserId,
      type: 'shared_debt_batch',
      title,
      body: buildSharedDebtBatchNotificationBody({
        requesterDisplayName: context.requesterDisplayName,
        actionLabel,
        itemCount,
        totalCents: entry.totalCents,
        descriptions: entry.descriptions
      }),
      href: `/shared-debts?batch=${entry.batchId}`,
      relatedType: 'shared_debt_batch',
      relatedId: entry.batchId
    });
  });
}

function buildSharedDebtBatchCards(items, scope) {
  const groups = new Map();

  (items || []).forEach(item => {
    const batchId = Number(item?.batch_id || 0);
    if (!batchId) return;

    if (!groups.has(batchId)) {
      groups.set(batchId, {
        id: batchId,
        scope,
        originKind: normalizeSharedDebtOriginKind(item?.batch_origin_kind),
        counterpartName: scope === 'received'
          ? (item?.requester_name || item?.requester_email || 'Usuário')
          : (item?.receiver_name || item?.receiver_email || 'Usuário'),
        counterpartEmail: scope === 'received'
          ? (item?.requester_email || null)
          : (item?.receiver_email || null),
        firstRequestId: Number(item?.id || 0),
        firstPendingRequestId: item?.status === 'pending' ? Number(item?.id || 0) : null,
        createdAt: item?.batch_created_at || item?.created_at || null,
        updatedAt: item?.batch_updated_at || item?.updated_at || item?.created_at || null,
        statusSummary: normalizeSharedDebtBatchStatus(item?.batch_status_summary),
        firstRespondedAt: item?.batch_first_responded_at || null,
        resolvedAt: item?.batch_resolved_at || null,
        minMonthRank: null,
        maxMonthRank: null,
        minMonth: null,
        minYear: null,
        maxMonth: null,
        maxYear: null,
        totalCount: 0,
        pendingCount: 0,
        totalCents: 0,
        pendingCents: 0,
        previewDescriptions: [],
        items: []
      });
    }

    const batch = groups.get(batchId);
    batch.items.push(item);
    batch.totalCount += 1;
    batch.totalCents += Number(item?.amount_cents || 0);

    if (item?.status === 'pending') {
      batch.pendingCount += 1;
      batch.pendingCents += Number(item?.amount_cents || 0);
      if (!batch.firstPendingRequestId) batch.firstPendingRequestId = Number(item?.id || 0);
    }

    const currentUpdatedAt = String(item?.updated_at || item?.created_at || '');
    if (currentUpdatedAt && currentUpdatedAt > String(batch.updatedAt || '')) batch.updatedAt = currentUpdatedAt;

    const description = String(item?.description_snapshot || '').trim();
    if (description && batch.previewDescriptions.length < 3 && !batch.previewDescriptions.includes(description)) {
      batch.previewDescriptions.push(description);
    }

    const month = Number(item?.source_due_month || 0);
    const year = Number(item?.source_due_year || 0);
    if (month && year) {
      const rank = (year * 100) + month;
      if (batch.minMonthRank == null || rank < batch.minMonthRank) {
        batch.minMonthRank = rank;
        batch.minMonth = month;
        batch.minYear = year;
      }
      if (batch.maxMonthRank == null || rank > batch.maxMonthRank) {
        batch.maxMonthRank = rank;
        batch.maxMonth = month;
        batch.maxYear = year;
      }
    }
  });

  return Array.from(groups.values())
    .map(batch => {
      const summary = computeSharedDebtBatchSummary(batch.items || []);
      return {
        ...batch,
        statusSummary: normalizeSharedDebtBatchStatus(batch.statusSummary || summary.statusSummary),
        firstRespondedAt: batch.firstRespondedAt || summary.firstRespondedAt || null,
        resolvedAt: batch.resolvedAt || summary.resolvedAt || null,
        reviewRequestId: batch.firstPendingRequestId || batch.firstRequestId || null,
        hasUpdates: String(batch.updatedAt || '') > String(batch.createdAt || ''),
        summaryCounts: summary.counts
      };
    })
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

ensureSharedDebtRequestBatchesBackfilled();
refreshAllSharedDebtBatches();

function firstTwoNames(value) {
  const parts = String(value || "").trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).join(" ") || "Titular";
}

const FINANCE_TYPES = ["income", "expense"];
const FINANCE_TYPE_SET = new Set(FINANCE_TYPES);
const FINANCE_AMOUNT_MODES = ["fixed", "variable"];
const FINANCE_AMOUNT_MODE_SET = new Set(FINANCE_AMOUNT_MODES);

function normalizeFinanceType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return FINANCE_TYPE_SET.has(normalized) ? normalized : null;
}

function normalizeFinanceAmountMode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return FINANCE_AMOUNT_MODE_SET.has(normalized) ? normalized : "fixed";
}

function sanitizeFinanceDescription(value) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    throw new Error("Dá um nome para esse item antes de salvar.");
  }
  return normalized.slice(0, 120);
}

function normalizeFinanceItemDate(value) {
  const normalized = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : "";
}

function sanitizeVariableFinanceItems(items) {
  if (!Array.isArray(items)) return [];

  const normalizedItems = [];
  for (const rawItem of items.slice(0, 120)) {
    const itemDate = normalizeFinanceItemDate(rawItem?.item_date ?? rawItem?.date);
    const itemSource = String(rawItem?.item_source ?? rawItem?.source ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
    const rawAmount = Number(rawItem?.amount_cents ?? rawItem?.amountCents ?? rawItem?.amount ?? 0);
    const amountCents = Number.isFinite(rawAmount) ? Math.max(0, Math.round(rawAmount)) : 0;

    if (!itemDate && !itemSource && amountCents === 0) continue;

    if (!itemDate || !itemSource || amountCents <= 0) {
      throw new Error("Em vários lançamentos, preencha data, origem e valor certinhos.");
    }

    normalizedItems.push({
      item_date: itemDate,
      item_source: itemSource,
      amount_cents: amountCents
    });
  }

  return normalizedItems;
}

function sumFinanceItemCents(items) {
  return (Array.isArray(items) ? items : []).reduce((sum, item) => sum + Number(item?.amount_cents || 0), 0);
}

function ensureMonthlyFinanceScaffold(userId, month, year) {
  const alreadyInitialized = !!db.prepare(`
    SELECT 1
    FROM scratchpad
    WHERE user_id = ? AND month = ? AND year = ?
    LIMIT 1
  `).get(userId, month, year);

  if (alreadyInitialized) return;

  let prevMonth = month - 1;
  let prevYear = year;
  if (prevMonth < 1) {
    prevMonth = 12;
    prevYear -= 1;
  }

  const currentCounts = new Map(
    db.prepare(`
      SELECT type, COUNT(*) AS total
      FROM monthly_finances
      WHERE user_id = ? AND month = ? AND year = ?
      GROUP BY type
    `).all(userId, month, year).map((row) => [row.type, Number(row.total || 0)])
  );

  const selectPrevious = db.prepare(`
    SELECT type, category_id, description, amount_mode
    FROM monthly_finances
    WHERE user_id = ? AND month = ? AND year = ? AND type = ?
    ORDER BY id ASC
  `);

  const insertClone = db.prepare(`
    INSERT INTO monthly_finances (user_id, month, year, type, category_id, description, formula, amount_cents, amount_mode, created_at)
    VALUES (?, ?, ?, ?, ?, ?, '', 0, ?, ?)
  `);

  const nowIso = new Date().toISOString();

  db.transaction(() => {
    for (const type of FINANCE_TYPES) {
      if ((currentCounts.get(type) || 0) > 0) continue;

      const previousRows = selectPrevious.all(userId, prevMonth, prevYear, type);
      for (const row of previousRows) {
        insertClone.run(
          userId,
          month,
          year,
          type,
          row.category_id ?? null,
          row.description ?? "",
          normalizeFinanceAmountMode(row.amount_mode),
          nowIso
        );
      }
    }
  })();
}

function getFinanceItemsByFinanceId(userId, financeId) {
  return db.prepare(`
    SELECT id, finance_id, item_date, item_source, amount_cents
    FROM monthly_finance_items
    WHERE finance_id = ? AND user_id = ?
    ORDER BY CASE WHEN item_date IS NULL OR item_date = '' THEN 1 ELSE 0 END, item_date ASC, id ASC
  `).all(financeId, userId);
}

function getFinanceItemsMap(userId, financeIds) {
  if (!Array.isArray(financeIds) || financeIds.length === 0) {
    return new Map();
  }

  const placeholders = financeIds.map(() => '?').join(', ');
  const rows = db.prepare(`
    SELECT id, finance_id, item_date, item_source, amount_cents
    FROM monthly_finance_items
    WHERE user_id = ? AND finance_id IN (${placeholders})
    ORDER BY CASE WHEN item_date IS NULL OR item_date = '' THEN 1 ELSE 0 END, item_date ASC, id ASC
  `).all(userId, ...financeIds);

  const byFinance = new Map();
  for (const row of rows) {
    if (!byFinance.has(row.finance_id)) {
      byFinance.set(row.finance_id, []);
    }
    byFinance.get(row.finance_id).push(row);
  }

  return byFinance;
}

function syncVariableFinanceAggregate(userId, financeId) {
  const totalCents = Number(db.prepare(`
    SELECT COALESCE(SUM(amount_cents), 0) AS total
    FROM monthly_finance_items
    WHERE finance_id = ? AND user_id = ?
  `).get(financeId, userId)?.total || 0);

  db.prepare(`
    UPDATE monthly_finances
    SET formula = '', amount_cents = ?
    WHERE id = ? AND user_id = ?
  `).run(totalCents, financeId, userId);

  return totalCents;
}

function hydrateMonthlyFinances(userId, finances) {
  const normalizedFinances = Array.isArray(finances)
    ? finances.map((finance) => ({ ...finance, amount_mode: normalizeFinanceAmountMode(finance.amount_mode) }))
    : [];

  const itemsByFinance = getFinanceItemsMap(userId, normalizedFinances.map((finance) => finance.id));
  const dirtyVariableRows = [];

  for (const finance of normalizedFinances) {
    const items = itemsByFinance.get(finance.id) || [];
    finance.items = items;
    finance.item_count = items.length;

    if (finance.amount_mode === 'variable') {
      const totalCents = sumFinanceItemCents(items);
      if (Number(finance.amount_cents || 0) !== totalCents || String(finance.formula || '').trim()) {
        dirtyVariableRows.push({ id: finance.id, totalCents });
      }
      finance.amount_cents = totalCents;
      finance.formula = '';
    }
  }

  if (dirtyVariableRows.length) {
    const updateTotal = db.prepare(`
      UPDATE monthly_finances
      SET formula = '', amount_cents = ?
      WHERE id = ? AND user_id = ?
    `);

    db.transaction((rows) => {
      for (const row of rows) {
        updateTotal.run(row.totalCents, row.id, userId);
      }
    })(dirtyVariableRows);
  }

  return normalizedFinances;
}

function getFinanceByIdForUser(userId, financeId) {
  const finance = db.prepare(`
    SELECT *
    FROM monthly_finances
    WHERE id = ? AND user_id = ?
  `).get(financeId, userId);

  if (!finance) return null;
  finance.amount_mode = normalizeFinanceAmountMode(finance.amount_mode);
  return finance;
}

function serializeFinanceForApi(userId, financeId) {
  const finance = getFinanceByIdForUser(userId, financeId);
  if (!finance) return null;

  if (finance.amount_mode === 'variable') {
    finance.items = getFinanceItemsByFinanceId(userId, financeId);
    finance.item_count = finance.items.length;
    finance.amount_cents = syncVariableFinanceAggregate(userId, financeId);
    finance.formula = '';
  } else {
    finance.items = [];
    finance.item_count = 0;
  }

  return finance;
}

function monthLabel(month, year) {
  return `${String(month).padStart(2, "0")}/${year}`;
}

function monthKey(month, year) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function isMonthClosed(userId, month, year) {
  return !!db.prepare("SELECT 1 FROM closed_months WHERE user_id = ? AND month = ? AND year = ?").get(userId, month, year);
}

function getClosedMonthsSet(userId) {
  const rows = db.prepare("SELECT month, year FROM closed_months WHERE user_id = ?").all(userId);
  return new Set(rows.map(row => monthKey(row.month, row.year)));
}

function getMonthLockMessage(month, year) {
  return `O mês ${monthLabel(month, year)} está fechado para edição.`;
}

function redirectBackOr(req, fallback) {
  return req.get("referer") || fallback;
}

function getInstallmentMonths(startYear, startMonth, installments) {
  const months = [];
  let currentYear = Number(startYear);
  let currentMonth = Number(startMonth);

  for (let i = 0; i < installments; i++) {
    months.push({ year: currentYear, month: currentMonth, index: i + 1 });
    currentMonth += 1;
    if (currentMonth > 12) {
      currentMonth = 1;
      currentYear += 1;
    }
  }

  return months;
}

function suggestFirstDueMonth(purchaseDate, closeDay, dueDay) {
  const purchase = dayjs(purchaseDate);
  if (!purchase.isValid()) return null;

  const normalizedCloseDay = normalizeDayNumber(closeDay);
  const normalizedDueDay = normalizeDayNumber(dueDay);
  let target = purchase.startOf("month");

  if (normalizedCloseDay && normalizedDueDay && normalizedCloseDay > normalizedDueDay) {
    target = target.add(1, "month");
  }

  if (normalizedCloseDay) {
    const effectiveCloseDay = Math.min(normalizedCloseDay, purchase.daysInMonth());
    if (purchase.date() >= effectiveCloseDay) {
      target = target.add(1, "month");
    }
  }

  return target.format("YYYY-MM");
}

function resolveFirstDueMonth({ firstDue, purchaseDate, closeDay, dueDay }) {
  const provided = String(firstDue || "").trim();
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(provided)) return provided;
  return suggestFirstDueMonth(purchaseDate, closeDay, dueDay);
}

function shiftMonth(year, month, amount = 0) {
  let y = Number(year);
  let m = Number(month) + Number(amount || 0);

  while (m > 12) {
    m -= 12;
    y += 1;
  }

  while (m < 1) {
    m += 12;
    y -= 1;
  }

  return { year: y, month: m };
}

function compareMonthYear(aYear, aMonth, bYear, bMonth) {
  if (Number(aYear) !== Number(bYear)) return Number(aYear) - Number(bYear);
  return Number(aMonth) - Number(bMonth);
}
function getPreferredDashboardMonth(userId, startYear = dayjs().year(), startMonth = dayjs().month() + 1, maxLookahead = 24) {
  let current = { year: Number(startYear), month: Number(startMonth) };

  for (let i = 0; i <= maxLookahead; i += 1) {
    if (!isMonthClosed(userId, current.month, current.year)) {
      return current;
    }
    current = shiftMonth(current.year, current.month, 1);
  }

  return { year: Number(startYear), month: Number(startMonth) };
}


function occurrenceDateFromStart(startTxnDate, offset) {
  const base = dayjs(startTxnDate);
  if (!base.isValid()) return null;

  const shifted = shiftMonth(base.year(), base.month() + 1, offset);
  const firstDay = dayjs(`${shifted.year}-${String(shifted.month).padStart(2, '0')}-01`);
  const day = Math.min(base.date(), firstDay.daysInMonth());
  return `${shifted.year}-${String(shifted.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function csvEscape(value) {
  const str = String(value == null ? '' : value);
  if (/[";\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function getRecurringRules(userId, { includeEnded = false } = {}) {
  const whereEnded = includeEnded ? '' : "AND r.status != 'ended'";
  return db.prepare(`
    SELECT r.*, c.name AS card_name, c.close_day, c.due_day
    FROM recurring_rules r
    JOIN cards c ON c.id = r.card_id AND c.user_id = r.user_id
    WHERE r.user_id = ? ${whereEnded}
    ORDER BY CASE r.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, lower(r.description), r.id DESC
  `).all(userId);
}

function syncRecurringTransactions(userId, targetYear, targetMonth) {
  const year = Number(targetYear);
  const month = Number(targetMonth);
  if (!year || !month) return;

  const rules = db.prepare(`
    SELECT r.*, c.name AS card_name, COALESCE(c.active, 1) AS card_active
    FROM recurring_rules r
    JOIN cards c ON c.id = r.card_id AND c.user_id = r.user_id
    WHERE r.user_id = ? AND r.status = 'active' AND COALESCE(c.active, 1) = 1
    ORDER BY r.id
  `).all(userId);

  if (!rules.length) return;

  const activePeople = db.prepare("SELECT id FROM people WHERE user_id = ? AND active = 1 ORDER BY id").all(userId);
  const findTxn = db.prepare(`
    SELECT id
    FROM transactions
    WHERE user_id = ? AND recurring_rule_id = ? AND due_month = ? AND due_year = ?
    LIMIT 1
  `);
  const hasException = db.prepare(`
    SELECT 1
    FROM recurring_exceptions
    WHERE user_id = ? AND rule_id = ? AND month = ? AND year = ?
    LIMIT 1
  `);
  const insTxn = db.prepare(`
    INSERT INTO transactions (user_id, card_id, txn_date, description, amount_cents, due_month, due_year, recurring_rule_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insAlloc = db.prepare(`
    INSERT INTO allocations (user_id, transaction_id, person_id, share_cents, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  db.transaction(() => {
    rules.forEach(rule => {
      if (compareMonthYear(rule.start_due_year, rule.start_due_month, year, month) > 0) return;

      let offset = 0;
      while (true) {
        const due = shiftMonth(rule.start_due_year, rule.start_due_month, offset);
        if (compareMonthYear(due.year, due.month, year, month) > 0) break;

        if (compareMonthYear(due.year, due.month, rule.active_from_year, rule.active_from_month) < 0) {
          offset += 1;
          continue;
        }

        if (hasException.get(userId, rule.id, due.month, due.year) || findTxn.get(userId, rule.id, due.month, due.year)) {
          offset += 1;
          continue;
        }

        if (isMonthClosed(userId, due.month, due.year)) {
          offset += 1;
          continue;
        }

        const txnDate = occurrenceDateFromStart(rule.start_txn_date, offset) || rule.start_txn_date;
        const info = insTxn.run(userId, rule.card_id, txnDate, rule.description, rule.amount_cents, due.month, due.year, rule.id, nowIso());

        if (activePeople.length === 1) {
          insAlloc.run(userId, info.lastInsertRowid, activePeople[0].id, rule.amount_cents, nowIso());
        }

        offset += 1;
      }
    });
  })();
}

function getRecurringPreview(rule) {
  const today = dayjs();
  const currentYear = today.year();
  const currentMonth = today.month() + 1;

  let offset = 0;
  while (offset < 240) {
    const due = shiftMonth(rule.start_due_year, rule.start_due_month, offset);
    if (compareMonthYear(due.year, due.month, rule.active_from_year, rule.active_from_month) < 0) {
      offset += 1;
      continue;
    }
    if (compareMonthYear(due.year, due.month, currentYear, currentMonth) >= 0) {
      return due;
    }
    offset += 1;
  }

  return null;
}

function getRecurringOccurrenceDateForMonth(rule, targetYear, targetMonth) {
  if (!rule) return null;

  const startYear = Number(rule.start_due_year || 0);
  const startMonth = Number(rule.start_due_month || 0);
  const year = Number(targetYear || 0);
  const month = Number(targetMonth || 0);
  if (!startYear || !startMonth || !year || !month) return null;

  const offset = ((year - startYear) * 12) + (month - startMonth);
  if (offset < 0) return null;

  return occurrenceDateFromStart(rule.start_txn_date, offset);
}

function shouldKeepCurrentRecurringMonth(rule, referenceDate = dayjs()) {
  const currentDate = dayjs(referenceDate);
  const occurrenceDate = getRecurringOccurrenceDateForMonth(rule, currentDate.year(), currentDate.month() + 1);
  if (!occurrenceDate) return false;

  const occurrence = dayjs(occurrenceDate);
  if (!occurrence.isValid()) return false;

  return !currentDate.isBefore(occurrence, 'day');
}

function removeFutureRecurringTransactions(userId, ruleId, fromYear, fromMonth, { includeCurrentMonth = false } = {}) {
  const rows = db.prepare(`
    SELECT t.id, t.import_id, t.due_month, t.due_year
    FROM transactions t
    WHERE t.user_id = ?
      AND t.recurring_rule_id = ?
      AND (
        t.due_year > ? OR
        (t.due_year = ? AND t.due_month > ?) OR
        (${includeCurrentMonth ? '1' : '0'} = 1 AND t.due_year = ? AND t.due_month = ?)
      )
  `).all(userId, ruleId, fromYear, fromYear, fromMonth, fromYear, fromMonth);

  const removable = rows.filter(row => row && row.due_month && row.due_year && !isMonthClosed(userId, row.due_month, row.due_year));

  if (removable.length) {
    deleteTransactionsAndAllocations(userId, removable);
  }
}

function getCards(userId) {
  return db.prepare(`
    SELECT id, name, due_day, close_day, holiday_scope, COALESCE(active, 1) AS active
    FROM cards
    WHERE user_id = ?
    ORDER BY COALESCE(active, 1) DESC, name
  `).all(userId);
}

function getActiveCards(userId) {
  return db.prepare(`
    SELECT id, name, due_day, close_day, holiday_scope, COALESCE(active, 1) AS active
    FROM cards
    WHERE user_id = ? AND COALESCE(active, 1) = 1
    ORDER BY name
  `).all(userId);
}

function getCardsByIds(userId, ids) {
  const uniqueIds = Array.from(new Set((ids || []).map(Number).filter(Boolean)));
  if (!uniqueIds.length) return [];

  const placeholders = uniqueIds.map(() => "?").join(", ");
  return db.prepare(`
    SELECT id, name, due_day, close_day, holiday_scope, COALESCE(active, 1) AS active
    FROM cards
    WHERE user_id = ? AND id IN (${placeholders})
    ORDER BY COALESCE(active, 1) DESC, name
  `).all(userId, ...uniqueIds);
}

function getPeopleActive(userId) {
  return db.prepare("SELECT id, name, active, email FROM people WHERE user_id = ? AND active = 1 ORDER BY name").all(userId);
}

function findPersonByNameForUser(userId, name, excludePersonId = null) {
  const safeName = String(name || '').trim();
  if (!safeName) return null;

  if (excludePersonId) {
    return db.prepare(`
      SELECT id, name
      FROM people
      WHERE user_id = ? AND lower(name) = lower(?) AND id <> ?
      LIMIT 1
    `).get(userId, safeName, Number(excludePersonId));
  }

  return db.prepare(`
    SELECT id, name
    FROM people
    WHERE user_id = ? AND lower(name) = lower(?)
    LIMIT 1
  `).get(userId, safeName);
}

function findCardByNameForUser(userId, name, excludeCardId = null) {
  const safeName = String(name || '').trim();
  if (!safeName) return null;

  if (excludeCardId) {
    return db.prepare(`
      SELECT id, name
      FROM cards
      WHERE user_id = ? AND lower(name) = lower(?) AND id <> ?
      LIMIT 1
    `).get(userId, safeName, Number(excludeCardId));
  }

  return db.prepare(`
    SELECT id, name
    FROM cards
    WHERE user_id = ? AND lower(name) = lower(?)
    LIMIT 1
  `).get(userId, safeName);
}

function getPeopleByIds(userId, ids) {
  const uniqueIds = Array.from(new Set((ids || []).map(Number).filter(Boolean)));
  if (!uniqueIds.length) return [];

  const placeholders = uniqueIds.map(() => "?").join(", ");
  return db.prepare(`
    SELECT id, name, active, is_owner, phone, email
    FROM people
    WHERE user_id = ? AND id IN (${placeholders})
    ORDER BY active DESC, name
  `).all(userId, ...uniqueIds);
}

function getVisiblePeopleForMonth(userId, month, year, { includePayments = false } = {}) {
  const visibleIds = new Set(getPeopleActive(userId).map(person => person.id));

  const allocatedRows = db.prepare(`
    SELECT DISTINCT a.person_id
    FROM allocations a
    JOIN transactions t ON t.id = a.transaction_id AND t.user_id = a.user_id
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    WHERE a.user_id = ?
      AND (
        (${EFFECTIVE_DUE_MONTH_SQL} = ? AND ${EFFECTIVE_DUE_YEAR_SQL} = ?) OR
        (${EFFECTIVE_DUE_MONTH_SQL} = ? AND ${EFFECTIVE_DUE_YEAR_SQL} = ?)
      )
  `).all(userId, month, year, month, year);

  allocatedRows.forEach(row => visibleIds.add(row.person_id));

  if (includePayments) {
    const paymentRows = db.prepare(`
      SELECT DISTINCT person_id
      FROM person_payments
      WHERE user_id = ? AND month = ? AND year = ?
    `).all(userId, month, year);

    paymentRows.forEach(row => visibleIds.add(row.person_id));

    const autoPaymentRows = db.prepare(`
      SELECT DISTINCT r.source_person_id AS person_id
      FROM shared_debt_payment_allocations a
      JOIN shared_debt_payment_intents pi ON pi.id = a.intent_id
      JOIN shared_debt_monthly_settlements s ON s.id = a.settlement_id
      JOIN shared_debt_requests r ON r.id = a.request_id
      WHERE s.requester_user_id = ?
        AND s.request_kind = 'card'
        AND s.month = ?
        AND s.year = ?
        AND pi.status = 'confirmed'
        AND COALESCE(r.request_kind, 'card') = 'card'
        AND r.source_person_id IS NOT NULL
    `).all(userId, month, year);

    autoPaymentRows.forEach(row => visibleIds.add(row.person_id));
  }

  return getPeopleByIds(userId, Array.from(visibleIds));
}

function getManualPersonPaymentsByMonth(userId, month, year) {
  const rows = db.prepare(`
    SELECT person_id, paid_cents
    FROM person_payments
    WHERE user_id = ? AND month = ? AND year = ?
  `).all(userId, month, year);

  return new Map(rows.map((row) => [Number(row.person_id || 0), Math.max(0, Number(row.paid_cents || 0))]));
}

function getConfirmedSharedDebtCardPaymentsByPersonForMonth(userId, month, year) {
  const rows = db.prepare(`
    SELECT r.source_person_id AS person_id, COALESCE(SUM(a.allocated_cents), 0) AS total_cents
    FROM shared_debt_payment_allocations a
    JOIN shared_debt_payment_intents pi ON pi.id = a.intent_id
    JOIN shared_debt_monthly_settlements s ON s.id = a.settlement_id
    JOIN shared_debt_requests r ON r.id = a.request_id
    WHERE s.requester_user_id = ?
      AND s.request_kind = 'card'
      AND s.month = ?
      AND s.year = ?
      AND pi.status = 'confirmed'
      AND COALESCE(r.request_kind, 'card') = 'card'
      AND r.source_person_id IS NOT NULL
    GROUP BY r.source_person_id
  `).all(userId, month, year);

  const map = new Map();
  rows.forEach((row) => {
    const personId = Number(row.person_id || 0);
    if (!personId) return;
    map.set(personId, Math.max(0, Number(row.total_cents || 0)));
  });
  return map;
}

function getCombinedPersonPaymentBreakdownMap(userId, month, year) {
  const manualMap = getManualPersonPaymentsByMonth(userId, month, year);
  const autoMap = getConfirmedSharedDebtCardPaymentsByPersonForMonth(userId, month, year);
  const ids = new Set([...manualMap.keys(), ...autoMap.keys()]);
  const breakdownMap = new Map();

  ids.forEach((personId) => {
    const manualCents = Math.max(0, Number(manualMap.get(personId) || 0));
    const autoCents = Math.max(0, Number(autoMap.get(personId) || 0));
    breakdownMap.set(personId, {
      personId,
      manualCents,
      autoCents,
      totalPaidCents: manualCents + autoCents
    });
  });

  return breakdownMap;
}

function getPersonPaymentBreakdownForMonth(userId, month, year, personId) {
  const safePersonId = Number(personId || 0);
  if (!safePersonId) {
    return { manualCents: 0, autoCents: 0, totalPaidCents: 0 };
  }

  const breakdown = getCombinedPersonPaymentBreakdownMap(userId, month, year).get(safePersonId);
  return breakdown || { manualCents: 0, autoCents: 0, totalPaidCents: 0 };
}

function getVisiblePeopleForTransaction(userId, txnId) {
  const visibleIds = new Set(getPeopleActive(userId).map(person => person.id));
  const selectedRows = db.prepare(`
    SELECT DISTINCT person_id
    FROM allocations
    WHERE user_id = ? AND transaction_id = ?
  `).all(userId, txnId);

  selectedRows.forEach(row => visibleIds.add(row.person_id));

  return getPeopleByIds(userId, Array.from(visibleIds));
}

function getVisibleCardsForMonth(userId, month, year) {
  const visibleIds = new Set(getActiveCards(userId).map(card => card.id));

  const txnRows = db.prepare(`
    SELECT DISTINCT t.card_id
    FROM transactions t
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    WHERE t.user_id = ?
      AND (
        (${EFFECTIVE_DUE_MONTH_SQL} = ? AND ${EFFECTIVE_DUE_YEAR_SQL} = ?) OR
        (${EFFECTIVE_DUE_MONTH_SQL} = ? AND ${EFFECTIVE_DUE_YEAR_SQL} = ?)
      )
  `).all(userId, month, year, month, year);

  txnRows.forEach(row => visibleIds.add(row.card_id));

  const statementRows = db.prepare(`
    SELECT DISTINCT card_id
    FROM card_statements
    WHERE user_id = ? AND month = ? AND year = ?
  `).all(userId, month, year);

  statementRows.forEach(row => visibleIds.add(row.card_id));

  return getCardsByIds(userId, Array.from(visibleIds));
}

function getOwnerPerson(userId) {
  return db.prepare("SELECT id, name, email, pix_enabled, pix_key_type, pix_key_value, pix_city, pix_label, pix_updated_at FROM people WHERE user_id = ? AND is_owner = 1 LIMIT 1").get(userId);
}

function normalizeFriendRequestStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  return status || 'pending';
}

function getFriendPair(userAId, userBId) {
  const safeA = Number(userAId || 0);
  const safeB = Number(userBId || 0);
  if (!safeA || !safeB) return null;
  return safeA < safeB
    ? { low: safeA, high: safeB }
    : { low: safeB, high: safeA };
}

function getFriendshipBetweenUsers(userAId, userBId) {
  const pair = getFriendPair(userAId, userBId);
  if (!pair) return null;

  return db.prepare(`
    SELECT *
    FROM friendships
    WHERE user_low_id = ? AND user_high_id = ?
    LIMIT 1
  `).get(pair.low, pair.high);
}

function getActiveFriendshipBetweenUsers(userAId, userBId) {
  const row = getFriendshipBetweenUsers(userAId, userBId);
  return row && String(row.status || '') === 'active' ? row : null;
}

function getFriendshipMapForUser(userId, remoteIds) {
  const uniqueIds = Array.from(new Set((remoteIds || []).map(Number).filter(id => id > 0 && id !== Number(userId || 0))));
  const map = new Map();
  if (!uniqueIds.length) return map;

  const placeholders = uniqueIds.map(() => '?').join(', ');
  const rows = db.prepare(`
    SELECT *,
      CASE WHEN user_low_id = ? THEN user_high_id ELSE user_low_id END AS remote_user_id
    FROM friendships
    WHERE status = 'active'
      AND (
        (user_low_id = ? AND user_high_id IN (${placeholders})) OR
        (user_high_id = ? AND user_low_id IN (${placeholders}))
      )
  `).all(userId, userId, ...uniqueIds, userId, ...uniqueIds);

  rows.forEach(row => {
    map.set(Number(row.remote_user_id || 0), row);
  });

  return map;
}

function getPendingOutgoingFriendRequestByPersonMap(userId, personIds) {
  const uniqueIds = Array.from(new Set((personIds || []).map(Number).filter(Boolean)));
  const map = new Map();
  if (!uniqueIds.length) return map;

  const placeholders = uniqueIds.map(() => '?').join(', ');
  const rows = db.prepare(`
    SELECT *
    FROM friend_requests
    WHERE requester_user_id = ?
      AND status = 'pending'
      AND source_person_id IN (${placeholders})
    ORDER BY created_at DESC, id DESC
  `).all(userId, ...uniqueIds);

  rows.forEach(row => {
    const personId = Number(row.source_person_id || 0);
    if (personId && !map.has(personId)) {
      map.set(personId, row);
    }
  });

  return map;
}

function getPendingIncomingFriendRequestMap(userId, remoteIds) {
  const uniqueIds = Array.from(new Set((remoteIds || []).map(Number).filter(id => id > 0 && id !== Number(userId || 0))));
  const map = new Map();
  if (!uniqueIds.length) return map;

  const placeholders = uniqueIds.map(() => '?').join(', ');
  const rows = db.prepare(`
    SELECT fr.*, u.name AS requester_name, u.email AS requester_email
    FROM friend_requests fr
    JOIN users u ON u.id = fr.requester_user_id
    WHERE fr.target_user_id = ?
      AND fr.status = 'pending'
      AND fr.requester_user_id IN (${placeholders})
    ORDER BY fr.created_at DESC, fr.id DESC
  `).all(userId, ...uniqueIds);

  rows.forEach(row => {
    const remoteUserId = Number(row.requester_user_id || 0);
    if (remoteUserId && !map.has(remoteUserId)) {
      map.set(remoteUserId, row);
    }
  });

  return map;
}

function getResolvedAppUserForPerson(userId, personId) {
  const row = db.prepare(`
    SELECT
      p.id,
      p.name,
      p.email,
      pal.linked_user_id AS stable_linked_user_id,
      stable_u.name AS stable_linked_user_name,
      stable_u.email AS stable_linked_user_email,
      matched_u.id AS email_matched_user_id,
      matched_u.name AS email_matched_user_name,
      matched_u.email AS email_matched_user_email
    FROM people p
    LEFT JOIN person_app_links pal
      ON pal.owner_user_id = p.user_id AND pal.person_id = p.id
    LEFT JOIN users stable_u ON stable_u.id = pal.linked_user_id
    LEFT JOIN users matched_u
      ON pal.linked_user_id IS NULL
     AND p.email IS NOT NULL
     AND trim(p.email) <> ''
     AND lower(matched_u.email) = lower(p.email)
    WHERE p.user_id = ? AND p.id = ?
    LIMIT 1
  `).get(userId, personId);

  if (!row) return null;

  const linkedUserId = Number(row.stable_linked_user_id || row.email_matched_user_id || 0);
  if (!linkedUserId || linkedUserId === Number(userId || 0)) return null;

  const via = row.stable_linked_user_id ? 'person_link' : 'email_match';
  return {
    linked_user_id: linkedUserId,
    linked_user_name: row.stable_linked_user_name || row.email_matched_user_name || null,
    linked_user_email: normalizeEmail(row.stable_linked_user_email || row.email_matched_user_email || null),
    via,
    person: row
  };
}

function upsertPersonAppLink({ ownerUserId, personId, linkedUserId, matchKind = 'friendship' }) {
  const safeOwnerUserId = Number(ownerUserId || 0);
  const safePersonId = Number(personId || 0);
  const safeLinkedUserId = Number(linkedUserId || 0);
  if (!safeOwnerUserId || !safePersonId || !safeLinkedUserId) return false;

  const now = nowIso();
  db.prepare(`
    INSERT INTO person_app_links (owner_user_id, person_id, linked_user_id, match_kind, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(owner_user_id, person_id) DO UPDATE SET
      linked_user_id = excluded.linked_user_id,
      match_kind = excluded.match_kind,
      updated_at = excluded.updated_at
  `).run(safeOwnerUserId, safePersonId, safeLinkedUserId, String(matchKind || 'friendship'), now, now);

  return true;
}

function findLinkedPersonForRemoteUser(ownerUserId, remoteUserId) {
  return db.prepare(`
    SELECT p.*
    FROM person_app_links pal
    JOIN people p ON p.id = pal.person_id AND p.user_id = pal.owner_user_id
    WHERE pal.owner_user_id = ? AND pal.linked_user_id = ?
    ORDER BY COALESCE(p.active, 1) DESC, p.id ASC
    LIMIT 1
  `).get(ownerUserId, remoteUserId);
}

function ensureFriendPersonForUser({ ownerUserId, remoteUserId, preferredName = null, preferredEmail = null }) {
  const safeOwnerUserId = Number(ownerUserId || 0);
  const safeRemoteUserId = Number(remoteUserId || 0);
  if (!safeOwnerUserId || !safeRemoteUserId) return null;

  const existingLinked = findLinkedPersonForRemoteUser(safeOwnerUserId, safeRemoteUserId);
  if (existingLinked) {
    upsertPersonAppLink({ ownerUserId: safeOwnerUserId, personId: existingLinked.id, linkedUserId: safeRemoteUserId, matchKind: 'friendship' });
    return existingLinked;
  }

  const normalizedEmail = normalizeEmail(preferredEmail);
  let person = null;

  if (normalizedEmail) {
    person = db.prepare(`
      SELECT *
      FROM people
      WHERE user_id = ? AND email IS NOT NULL AND lower(email) = lower(?)
      ORDER BY COALESCE(active, 1) DESC, id ASC
      LIMIT 1
    `).get(safeOwnerUserId, normalizedEmail);
  }

  if (!person) {
    const baseName = String(preferredName || '').trim() || 'Contato OrganizaPay';
    const now = nowIso();
    const candidateNames = [baseName, `${baseName} (app)`, `${baseName} OrganizaPay`];

    for (const candidateName of candidateNames) {
      const inserted = db.prepare(`
        INSERT OR IGNORE INTO people (user_id, name, phone, email, active, is_owner, created_at)
        VALUES (?, ?, '', ?, 1, 0, ?)
      `).run(safeOwnerUserId, candidateName, normalizedEmail, now);

      const insertedId = Number(inserted.lastInsertRowid || 0);
      if (insertedId) {
        person = db.prepare(`SELECT * FROM people WHERE id = ? AND user_id = ?`).get(insertedId, safeOwnerUserId);
        if (person) break;
      }
    }
  }

  if (!person) return null;

  upsertPersonAppLink({ ownerUserId: safeOwnerUserId, personId: person.id, linkedUserId: safeRemoteUserId, matchKind: 'friendship' });
  return person;
}

function upsertFriendship({ userAId, userBId, status = 'active', originRequestId = null, source = 'friend_request', endedByUserId = null }) {
  const pair = getFriendPair(userAId, userBId);
  if (!pair) return null;

  const now = nowIso();
  const normalizedStatus = String(status || 'active');
  const endedAt = normalizedStatus === 'active' ? null : now;

  db.prepare(`
    INSERT INTO friendships (
      user_low_id, user_high_id, status, created_at, updated_at, ended_at, ended_by_user_id, origin_request_id, source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_low_id, user_high_id) DO UPDATE SET
      status = excluded.status,
      updated_at = excluded.updated_at,
      ended_at = excluded.ended_at,
      ended_by_user_id = excluded.ended_by_user_id,
      origin_request_id = COALESCE(excluded.origin_request_id, friendships.origin_request_id),
      source = excluded.source
  `).run(
    pair.low,
    pair.high,
    normalizedStatus,
    now,
    now,
    endedAt,
    normalizedStatus === 'active' ? null : Number(endedByUserId || 0) || null,
    Number(originRequestId || 0) || null,
    String(source || 'friend_request')
  );

  return getFriendshipBetweenUsers(pair.low, pair.high);
}

function getPendingFriendRequestById(requestId) {
  return db.prepare(`
    SELECT
      fr.*,
      requester_u.name AS requester_name,
      requester_u.email AS requester_email,
      target_u.name AS target_name,
      target_u.email AS target_email
    FROM friend_requests fr
    JOIN users requester_u ON requester_u.id = fr.requester_user_id
    JOIN users target_u ON target_u.id = fr.target_user_id
    WHERE fr.id = ?
    LIMIT 1
  `).get(requestId);
}

function getPendingFriendRequestBetweenUsers(requesterUserId, targetUserId) {
  return db.prepare(`
    SELECT *
    FROM friend_requests
    WHERE requester_user_id = ? AND target_user_id = ? AND status = 'pending'
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `).get(requesterUserId, targetUserId);
}

function getPendingReceivedFriendRequests(userId) {
  return db.prepare(`
    SELECT
      fr.*,
      requester_u.name AS requester_name,
      requester_u.email AS requester_email,
      linked_person.id AS linked_person_id,
      linked_person.name AS linked_person_name
    FROM friend_requests fr
    JOIN users requester_u ON requester_u.id = fr.requester_user_id
    LEFT JOIN person_app_links pal
      ON pal.owner_user_id = ? AND pal.linked_user_id = fr.requester_user_id
    LEFT JOIN people linked_person
      ON linked_person.id = pal.person_id AND linked_person.user_id = pal.owner_user_id
    WHERE fr.target_user_id = ? AND fr.status = 'pending'
    ORDER BY fr.created_at DESC, fr.id DESC
  `).all(userId, userId);
}

function closeOtherPendingFriendRequestsBetweenUsers(userAId, userBId, excludeRequestId = null, status = 'merged') {
  const pair = getFriendPair(userAId, userBId);
  if (!pair) return;

  const safeExcludeId = Number(excludeRequestId || 0) || null;
  const now = nowIso();
  const rows = db.prepare(`
    SELECT id
    FROM friend_requests
    WHERE status = 'pending'
      AND (
        (requester_user_id = ? AND target_user_id = ?) OR
        (requester_user_id = ? AND target_user_id = ?)
      )
      ${safeExcludeId ? 'AND id <> ?' : ''}
  `).all(
    pair.low,
    pair.high,
    pair.high,
    pair.low,
    ...(safeExcludeId ? [safeExcludeId] : [])
  );

  rows.forEach(row => {
    db.prepare(`
      UPDATE friend_requests
      SET status = ?, updated_at = ?, responded_at = COALESCE(responded_at, ?), resolved_at = COALESCE(resolved_at, ?)
      WHERE id = ? AND status = 'pending'
    `).run(String(status || 'merged'), now, now, now, row.id);
  });
}

function getPeopleAll(userId) {
  const rows = db.prepare(`
    SELECT
      p.id,
      p.name,
      COALESCE(p.active, 1) AS active,
      COALESCE(p.is_owner, 0) AS is_owner,
      p.phone,
      p.email,
      COALESCE(p.pix_enabled, 0) AS pix_enabled,
      p.pix_key_type,
      p.pix_key_value,
      p.pix_city,
      p.pix_state,
      p.pix_label,
      p.pix_updated_at,
      pal.linked_user_id AS stable_linked_user_id,
      stable_u.name AS stable_linked_user_name,
      stable_u.email AS stable_linked_user_email,
      matched_u.id AS email_matched_user_id,
      matched_u.name AS email_matched_user_name,
      matched_u.email AS email_matched_user_email
    FROM people p
    LEFT JOIN person_app_links pal
      ON pal.owner_user_id = p.user_id AND pal.person_id = p.id
    LEFT JOIN users stable_u ON stable_u.id = pal.linked_user_id
    LEFT JOIN users matched_u
      ON pal.linked_user_id IS NULL
     AND p.email IS NOT NULL
     AND trim(p.email) <> ''
     AND lower(matched_u.email) = lower(p.email)
    WHERE p.user_id = ?
    ORDER BY COALESCE(p.is_owner, 0) DESC, COALESCE(p.active, 1) DESC, p.name
  `).all(userId);

  const remoteIds = rows
    .map(row => Number(row.stable_linked_user_id || row.email_matched_user_id || 0))
    .filter(id => id > 0 && id !== Number(userId || 0));
  const personIds = rows.map(row => Number(row.id || 0)).filter(Boolean);
  const friendshipMap = getFriendshipMapForUser(userId, remoteIds);
  const outgoingMap = getPendingOutgoingFriendRequestByPersonMap(userId, personIds);
  const incomingMap = getPendingIncomingFriendRequestMap(userId, remoteIds);

  return rows.map((person) => {
    const linkedUserId = Number(person.stable_linked_user_id || person.email_matched_user_id || 0) || null;
    const hasAppUser = !!linkedUserId && linkedUserId !== Number(userId || 0);
    const isActive = Number(person.active || 0) !== 0;
    const isOwner = Number(person.is_owner || 0) !== 0;
    const friendship = hasAppUser ? friendshipMap.get(linkedUserId) : null;
    const outgoingRequest = outgoingMap.get(Number(person.id || 0)) || null;
    const incomingRequest = !outgoingRequest && hasAppUser ? (incomingMap.get(linkedUserId) || null) : null;
    const friendshipActive = !!friendship;
    const canShareCharge = isFriendshipGateEnabled()
      ? friendshipActive && isActive && !isOwner
      : hasAppUser && !!normalizeEmail(person.email) && isActive && !isOwner;
    const storedPixProfile = {
      keyType: normalizePixKeyType(person.pix_key_type),
      keyValue: normalizePixKeyValue(person.pix_key_type, person.pix_key_value),
      city: sanitizePixText(person.pix_city, { max: 15 }) || null,
      state: normalizePixState(person.pix_state) || guessPixStateByCity(person.pix_city) || null,
      label: sanitizePixText(person.pix_label, { max: 25 }) || null
    };
    const pixProfile = validatePixProfile({
      enabled: person.pix_enabled,
      keyType: storedPixProfile.keyType,
      keyValue: storedPixProfile.keyValue,
      city: storedPixProfile.city,
      state: storedPixProfile.state,
      label: storedPixProfile.label,
      name: person.name || person.email || 'ORGANIZAPAY'
    });

    let friendshipState = 'none';
    if (friendshipActive) friendshipState = 'active';
    else if (outgoingRequest) friendshipState = 'pending_sent';
    else if (incomingRequest) friendshipState = 'pending_received';
    else if (hasAppUser) friendshipState = 'discoverable';

    return {
      ...person,
      linked_user_id: linkedUserId,
      linked_user_name: person.stable_linked_user_name || person.email_matched_user_name || null,
      linked_user_email: normalizeEmail(person.stable_linked_user_email || person.email_matched_user_email || null),
      discovery_via: person.stable_linked_user_id ? 'person_link' : (hasAppUser ? 'email_match' : null),
      has_app_user: hasAppUser,
      can_share_charge: canShareCharge,
      friendship_state: friendshipState,
      friendship_active: friendshipActive,
      outgoing_friend_request_id: outgoingRequest ? Number(outgoingRequest.id || 0) : null,
      incoming_friend_request_id: incomingRequest ? Number(incomingRequest.id || 0) : null,
      friendship_id: friendship ? Number(friendship.id || 0) : null,
      friendship: friendship || null,
      outgoing_friend_request: outgoingRequest,
      incoming_friend_request: incomingRequest,
      pix_enabled: !!pixProfile.enabled,
      pix_valid: !!pixProfile.valid,
      pix_reason: pixProfile.reason || null,
      pix_key_type: storedPixProfile.keyType,
      pix_key_type_label: pixProfile.keyTypeLabel,
      pix_key_value: pixProfile.keyValue,
      pix_masked_key: pixProfile.keyMasked,
      pix_city: pixProfile.city,
      pix_state: storedPixProfile.state || guessPixStateByCity(storedPixProfile.city) || null,
      pix_label: pixProfile.label,
      pix_key_value_input: formatPixKeyValueForInput(storedPixProfile.keyType, pixProfile.keyValue),
      pix_updated_at: person.pix_updated_at || null
    };
  });
}

function getManualSharedDebtEligiblePeople(userId) {
  return getPeopleAll(userId)
    .filter(person => person && person.can_share_charge && person.friendship_active && Number(person.active || 0) !== 0 && Number(person.is_owner || 0) === 0)
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR', { sensitivity: 'base' }));
}

function upsertPushSubscription(userId, subscription) {
  const endpoint = String(subscription?.endpoint || '').trim();
  if (!endpoint) return false;

  const serialized = JSON.stringify(subscription);
  const now = nowIso();

  db.prepare(`
    INSERT INTO push_subscriptions (user_id, endpoint, subscription_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET
      user_id = excluded.user_id,
      subscription_json = excluded.subscription_json,
      updated_at = excluded.updated_at
  `).run(userId, endpoint, serialized, now, now);

  return true;
}

function removePushSubscriptionByEndpoint(endpoint) {
  const safeEndpoint = String(endpoint || '').trim();
  if (!safeEndpoint) return;

  db.prepare(`
    DELETE FROM push_subscriptions
    WHERE endpoint = ?
  `).run(safeEndpoint);
}

function removePushSubscriptionForUser(userId, endpoint) {
  const safeEndpoint = String(endpoint || '').trim();
  if (!safeEndpoint) return;

  db.prepare(`
    DELETE FROM push_subscriptions
    WHERE endpoint = ? AND user_id = ?
  `).run(safeEndpoint, userId);
}

function getPushSubscriptionsForUser(userId) {
  return db.prepare(`
    SELECT endpoint, subscription_json
    FROM push_subscriptions
    WHERE user_id = ?
    ORDER BY id DESC
  `).all(userId);
}

function getUsersWithPushSubscriptions() {
  return db.prepare(`
    SELECT DISTINCT user_id
    FROM push_subscriptions
    ORDER BY user_id ASC
  `).all().map(row => Number(row.user_id)).filter(Boolean);
}

function getScheduledPushLogs(userId, eventType, dateKey) {
  return db.prepare(`
    SELECT sequence_no, created_at
    FROM scheduled_push_logs
    WHERE user_id = ? AND event_type = ? AND date_key = ?
    ORDER BY sequence_no ASC, created_at ASC
  `).all(userId, eventType, dateKey);
}

function recordScheduledPushLog({ userId, eventType, dateKey, sequenceNo, payload = null }) {
  return db.prepare(`
    INSERT OR IGNORE INTO scheduled_push_logs (user_id, event_type, date_key, sequence_no, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    eventType,
    dateKey,
    sequenceNo,
    payload ? JSON.stringify(payload) : null,
    nowIso()
  );
}

function getZonedDateParts(timeZone, date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

  const mapped = formatter.formatToParts(date).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {});

  const year = Number(mapped.year || 0);
  const month = Number(mapped.month || 0);
  const day = Number(mapped.day || 0);
  const hour = Number(mapped.hour || 0);
  const minute = Number(mapped.minute || 0);
  const second = Number(mapped.second || 0);

  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    dateKey: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    minutesOfDay: (hour * 60) + minute
  };
}

function getCardStatementStatusForMonth(userId, month, year) {
  const cards = getVisibleCardsForMonth(userId, month, year);
  if (!cards.length) return [];

  const cardTotalsRows = db.prepare(`
    SELECT t.card_id, SUM(t.amount_cents) AS total_cents
    FROM transactions t
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    WHERE t.user_id = ?
      AND (
        (${EFFECTIVE_DUE_MONTH_SQL} = ? AND ${EFFECTIVE_DUE_YEAR_SQL} = ?) OR
        (${EFFECTIVE_DUE_MONTH_SQL} = ? AND ${EFFECTIVE_DUE_YEAR_SQL} = ?)
      )
    GROUP BY t.card_id
  `).all(userId, month, year, month, year);
  const cardTotalsMap = new Map(cardTotalsRows.map(row => [row.card_id, Number(row.total_cents || 0)]));

  const statementRows = db.prepare(`
    SELECT card_id, computed_due_date, override_due_date, paid_cents
    FROM card_statements
    WHERE user_id = ? AND month = ? AND year = ?
  `).all(userId, month, year);
  const statementByCard = new Map(statementRows.map(row => [row.card_id, row]));

  return cards.map(card => {
    const stmt = statementByCard.get(card.id);
    const computedDueDate = computeDueDate({ year, month, dueDay: card.due_day, holidayScope: card.holiday_scope || 'BR' });
    const dueDate = stmt?.override_due_date || stmt?.computed_due_date || computedDueDate;
    const totalCents = Number(cardTotalsMap.get(card.id) || 0);
    const paidCents = Number(stmt?.paid_cents || 0);
    const remainingCents = Math.max(0, totalCents - paidCents);

    return {
      card_id: card.id,
      card_name: card.name,
      due_date: dueDate,
      total_cents: totalCents,
      paid_cents: paidCents,
      remaining_cents: remainingCents,
      month,
      year
    };
  });
}

function getPendingDueTodayCardsForUser(userId, zonedToday) {
  const candidateMonths = [
    shiftMonth(zonedToday.year, zonedToday.month, -1),
    { year: zonedToday.year, month: zonedToday.month }
  ];

  const seen = new Set();
  const results = [];

  candidateMonths.forEach(ref => {
    getCardStatementStatusForMonth(userId, ref.month, ref.year).forEach(item => {
      if (!item.due_date || item.due_date !== zonedToday.dateKey) return;
      if (item.total_cents <= 0 || item.remaining_cents <= 0) return;

      const key = `${item.year}-${item.month}-${item.card_id}`;
      if (seen.has(key)) return;
      seen.add(key);
      results.push(item);
    });
  });

  return results.sort((a, b) => {
    if (a.year !== b.year) return a.year - b.year;
    if (a.month !== b.month) return a.month - b.month;
    return a.card_name.localeCompare(b.card_name, 'pt-BR', { sensitivity: 'base' });
  });
}

function buildDueTodayPushPayload(cards, zonedToday, sequenceNo = 1) {
  const totalRemaining = cards.reduce((sum, item) => sum + Number(item.remaining_cents || 0), 0);
  const uniqueRefs = Array.from(new Set(cards.map(item => `${item.year}-${item.month}`)));
  const href = uniqueRefs.length === 1
    ? `/summary/${cards[0].year}/${cards[0].month}`
    : '/geral';

  if (cards.length === 1) {
    const card = cards[0];
    const title = sequenceNo > 1 ? 'Lembrete: sua fatura vence hoje' : 'Hoje vence sua fatura';
    const body = card.paid_cents > 0
      ? `${card.card_name} vence hoje. Ainda faltam ${formatBRLFromCents(card.remaining_cents)} para fechar essa conta.`
      : `${card.card_name} vence hoje. O valor previsto é ${formatBRLFromCents(card.total_cents)}.`;

    return {
      title,
      body,
      href,
      tag: `card-due-today:${zonedToday.dateKey}`
    };
  }

  const previewNames = cards.slice(0, 2).map(item => item.card_name).join(', ');
  const extraCount = cards.length > 2 ? ` e mais ${cards.length - 2}` : '';

  return {
    title: sequenceNo > 1 ? 'Lembrete: tem fatura vencendo hoje' : 'Hoje tem fatura vencendo',
    body: `${formatCountLabel(cards.length, 'fatura', 'faturas')} vencem hoje. Entre elas: ${previewNames}${extraCount}. Ainda faltam ${formatBRLFromCents(totalRemaining)} para quitar tudo no resumo.`,
    href,
    tag: `card-due-today:${zonedToday.dateKey}`
  };
}

async function sendPushNotificationToUser(userId, payload) {
  if (!isPushConfigured()) return { attempted: 0, sent: 0, failed: 0 };

  const subscriptions = getPushSubscriptionsForUser(userId);
  if (!subscriptions.length) return { attempted: 0, sent: 0, failed: 0 };

  const message = JSON.stringify({
    title: String(payload?.title || 'OrganizaPay'),
    body: payload?.body ? String(payload.body) : '',
    href: payload?.href ? String(payload.href) : '/shared-debts',
    tag: payload?.tag ? String(payload.tag) : undefined
  });

  let attempted = 0;
  let sent = 0;
  let failed = 0;

  await Promise.allSettled(subscriptions.map(async (row) => {
    attempted += 1;
    try {
      const parsedSubscription = JSON.parse(row.subscription_json);
      await webPush.sendNotification(parsedSubscription, message);
      sent += 1;
    } catch (err) {
      failed += 1;
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        removePushSubscriptionByEndpoint(row.endpoint);
        return;
      }

      console.error('Erro ao enviar push notification:', err?.message || err);
    }
  }));

  return { attempted, sent, failed };
}

async function runCardDueTodayPushSweep() {
  if (scheduledDuePushSweepRunning) return;

  const pushConfig = getPushRuntimeConfig();
  if (!isPushConfigured() || !pushConfig.duePushEnabled || pushConfig.maxSendsPerDay <= 0) return;

  scheduledDuePushSweepRunning = true;

  try {
    const zonedNow = getZonedDateParts(pushConfig.timezone);
    const firstSendMinute = (pushConfig.hour * 60) + pushConfig.minute;
    if (zonedNow.minutesOfDay < firstSendMinute) {
      return;
    }

    const users = getUsersWithPushSubscriptions();
    for (const userId of users) {
      const cardsDueToday = getPendingDueTodayCardsForUser(userId, zonedNow);
      if (!cardsDueToday.length) continue;

      const logs = getScheduledPushLogs(userId, 'card_due_today', zonedNow.dateKey);
      const nextSequenceNo = logs.length + 1;
      if (nextSequenceNo > pushConfig.maxSendsPerDay) continue;

      if (logs.length) {
        if (pushConfig.repeatIntervalMinutes <= 0) continue;

        const lastSentAt = dayjs(logs[logs.length - 1].created_at);
        if (!lastSentAt.isValid()) continue;
        if (dayjs().diff(lastSentAt, 'minute') < pushConfig.repeatIntervalMinutes) continue;
      }

      const payload = buildDueTodayPushPayload(cardsDueToday, zonedNow, nextSequenceNo);
      const result = await sendPushNotificationToUser(userId, payload);
      if (result.sent > 0) {
        recordScheduledPushLog({
          userId,
          eventType: 'card_due_today',
          dateKey: zonedNow.dateKey,
          sequenceNo: nextSequenceNo,
          payload
        });
      }
    }
  } catch (err) {
    console.error('Falha ao executar varredura de push de vencimento:', err?.message || err);
  } finally {
    scheduledDuePushSweepRunning = false;
  }
}

function startCardDueTodayPushScheduler() {
  restartCardDueTodayPushScheduler();
}

function queuePushNotification(userId, payload) {
  if (!isPushConfigured()) return;

  Promise.resolve()
    .then(() => sendPushNotificationToUser(userId, payload))
    .catch(err => console.error('Falha ao disparar push notification:', err?.message || err));
}

function createNotification({ userId, type, title, body = null, href = null, relatedType = null, relatedId = null }) {
  const result = db.prepare(`
    INSERT INTO notifications (user_id, type, title, body, href, is_read, related_type, related_id, created_at)
    VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
  `).run(userId, type, title, body, href, relatedType, relatedId, nowIso());

  const pushTag = relatedType && relatedId ? `${relatedType}:${relatedId}` : `${type}:${result.lastInsertRowid || nowIso()}`;
  queuePushNotification(userId, { title, body, href, tag: pushTag });

  return result;
}

function getUnreadNotificationCount(userId) {
  return db.prepare(`
    SELECT COUNT(*) AS total
    FROM notifications
    WHERE user_id = ? AND is_read = 0
  `).get(userId)?.total || 0;
}

function getReadNotificationCount(userId) {
  return db.prepare(`
    SELECT COUNT(*) AS total
    FROM notifications
    WHERE user_id = ? AND is_read = 1
  `).get(userId)?.total || 0;
}

function getNotificationsForUser(userId) {
  return db.prepare(`
    SELECT *
    FROM notifications
    WHERE user_id = ?
    ORDER BY created_at DESC, id DESC
  `).all(userId);
}

function getRecentNotificationsPreview(userId, limit = 6) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 6, 10));
  return db.prepare(`
    SELECT *
    FROM notifications
    WHERE user_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).all(userId, safeLimit);
}

function getNotificationForUser(notificationId, userId) {
  return db.prepare(`
    SELECT *
    FROM notifications
    WHERE id = ? AND user_id = ?
    LIMIT 1
  `).get(notificationId, userId);
}

function markNotificationAsRead(notificationId, userId) {
  return db.prepare(`
    UPDATE notifications
    SET is_read = 1, read_at = COALESCE(read_at, ?)
    WHERE id = ? AND user_id = ? AND is_read = 0
  `).run(nowIso(), notificationId, userId);
}

function markAllNotificationsAsRead(userId) {
  return db.prepare(`
    UPDATE notifications
    SET is_read = 1, read_at = COALESCE(read_at, ?)
    WHERE user_id = ? AND is_read = 0
  `).run(nowIso(), userId);
}

function clearReadNotifications(userId) {
  return db.prepare(`
    DELETE FROM notifications
    WHERE user_id = ? AND is_read = 1
  `).run(userId);
}

function addSharedDebtEvent({ requestId, actorUserId, eventType, note = null }) {
  db.prepare(`
    INSERT INTO shared_debt_events (request_id, actor_user_id, event_type, note, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(requestId, actorUserId, eventType, note, nowIso());
}

function clearSharedDebtAllocationLinksForTransaction(userId, txnId) {
  db.prepare(`
    UPDATE shared_debt_requests
    SET source_allocation_id = NULL,
        updated_at = ?
    WHERE requester_user_id = ?
      AND source_transaction_id = ?
      AND source_allocation_id IS NOT NULL
  `).run(nowIso(), userId, txnId);
}

function detachSharedDebtRequestsFromDeletedTransaction(userId, txnId) {
  const now = nowIso();
  const pendingRows = db.prepare(`
    SELECT id
    FROM shared_debt_requests
    WHERE requester_user_id = ?
      AND source_transaction_id = ?
      AND status = 'pending'
  `).all(userId, txnId);

  pendingRows.forEach(row => {
    db.prepare(`
      UPDATE shared_debt_requests
      SET status = 'cancelled',
          updated_at = ?,
          resolved_at = COALESCE(resolved_at, ?)
      WHERE id = ? AND status = 'pending'
    `).run(now, now, row.id);

    addSharedDebtEvent({
      requestId: row.id,
      actorUserId: userId,
      eventType: 'cancelled',
      note: 'Solicitação cancelada automaticamente porque o lançamento original foi excluído.'
    });
  });

  db.prepare(`
    UPDATE shared_debt_requests
    SET source_transaction_id = NULL,
        source_allocation_id = NULL,
        card_id = NULL,
        updated_at = ?
    WHERE requester_user_id = ?
      AND source_transaction_id = ?
  `).run(now, userId, txnId);
}

function cancelPendingSharedDebtRequestsForTransaction(userId, txnId, note = 'Lançamento removido ou deixou de ser elegível para compartilhamento.') {
  const pendingRows = db.prepare(`
    SELECT id
    FROM shared_debt_requests
    WHERE requester_user_id = ?
      AND source_transaction_id = ?
      AND status = 'pending'
  `).all(userId, txnId);

  if (!pendingRows.length) return;

  const now = nowIso();
  const updateStmt = db.prepare(`
    UPDATE shared_debt_requests
    SET status = 'cancelled', updated_at = ?, resolved_at = ?
    WHERE id = ? AND status = 'pending'
  `);

  pendingRows.forEach(row => {
    updateStmt.run(now, now, row.id);
    addSharedDebtEvent({ requestId: row.id, actorUserId: userId, eventType: 'cancelled', note });
  });
}

function syncSharedDebtRequestForTransactionWithContext(userId, txnId, context) {
  const txn = db.prepare(`
    SELECT
      t.id,
      t.parent_txn_id,
      t.txn_date,
      t.description,
      t.amount_cents,
      t.card_id,
      c.name AS card_name,
      COALESCE(t.due_month, i.month) AS due_month,
      COALESCE(t.due_year, i.year) AS due_year
    FROM transactions t
    LEFT JOIN cards c ON c.id = t.card_id AND c.user_id = t.user_id
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    WHERE t.id = ? AND t.user_id = ?
  `).get(txnId, userId);

  if (!txn) {
    cancelPendingSharedDebtRequestsForTransaction(userId, txnId);
    return;
  }

  const requesterPerson = getOwnerPerson(userId);
  const requesterDisplayName = requesterPerson?.name || context?.requesterDisplayName || getUserRecord(userId)?.name || 'Um usuário';

  const eligibleRows = (isFriendshipGateEnabled()
    ? db.prepare(`
      SELECT
        a.id AS allocation_id,
        a.person_id,
        a.share_cents,
        p.name AS person_name,
        COALESCE(p.email, remote_u.email) AS person_email,
        remote_u.id AS receiver_user_id,
        remote_u.name AS receiver_user_name,
        remote_u.email AS receiver_user_email
      FROM allocations a
      JOIN people p ON p.id = a.person_id AND p.user_id = a.user_id
      JOIN person_app_links pal ON pal.owner_user_id = p.user_id AND pal.person_id = p.id
      JOIN users remote_u ON remote_u.id = pal.linked_user_id
      JOIN friendships f
        ON f.status = 'active'
       AND f.user_low_id = CASE WHEN p.user_id < pal.linked_user_id THEN p.user_id ELSE pal.linked_user_id END
       AND f.user_high_id = CASE WHEN p.user_id < pal.linked_user_id THEN pal.linked_user_id ELSE p.user_id END
      WHERE a.user_id = ?
        AND a.transaction_id = ?
        AND COALESCE(p.active, 1) = 1
        AND COALESCE(p.is_owner, 0) = 0
        AND remote_u.id <> ?
        AND a.share_cents > 0
      ORDER BY a.id
    `).all(userId, txnId, userId)
    : db.prepare(`
      SELECT
        a.id AS allocation_id,
        a.person_id,
        a.share_cents,
        p.name AS person_name,
        p.email AS person_email,
        u.id AS receiver_user_id,
        u.name AS receiver_user_name,
        u.email AS receiver_user_email
      FROM allocations a
      JOIN people p ON p.id = a.person_id AND p.user_id = a.user_id
      JOIN users u ON lower(u.email) = lower(p.email)
      WHERE a.user_id = ?
        AND a.transaction_id = ?
        AND p.email IS NOT NULL
        AND trim(p.email) <> ''
        AND u.id <> ?
        AND a.share_cents > 0
      ORDER BY a.id
    `).all(userId, txnId, userId));

  const existingRequests = db.prepare(`
    SELECT *
    FROM shared_debt_requests
    WHERE requester_user_id = ?
      AND source_transaction_id = ?
    ORDER BY id DESC
  `).all(userId, txnId);

  const existingPending = existingRequests.filter(row => row.status === 'pending');

  const existingByPerson = new Map();
  const latestByPerson = new Map();

  existingRequests.forEach(row => {
    const personId = Number(row.source_person_id || 0);
    if (!personId) return;
    if (!latestByPerson.has(personId)) latestByPerson.set(personId, row);
    if (row.status === 'pending' && !existingByPerson.has(personId)) {
      existingByPerson.set(personId, row);
    }
  });

  const activePersonIds = new Set();
  const now = nowIso();

  db.transaction(() => {
    eligibleRows.forEach(row => {
      const personId = Number(row.person_id);
      activePersonIds.add(personId);

      const receiverEmailSnapshot = normalizeEmail(row.person_email || row.receiver_user_email);
      const receiverNameSnapshot = row.person_name || row.receiver_user_name || null;
      const existing = existingByPerson.get(personId);
      const getContextBatchId = () => context ? getOrCreateSharedDebtBatchId(context, row.receiver_user_id) : null;

      if (existing) {
        const receiverChanged = Number(existing.receiver_user_id || 0) !== Number(row.receiver_user_id || 0);
        const changed = [
          receiverChanged,
          Number(existing.amount_cents || 0) !== Number(row.share_cents || 0),
          Number(existing.card_id || 0) !== Number(txn.card_id || 0),
          String(existing.card_name_snapshot || '') !== String(txn.card_name || ''),
          String(existing.description_snapshot || '') !== String(txn.description || ''),
          Number(existing.source_due_month || 0) !== Number(txn.due_month || 0),
          Number(existing.source_due_year || 0) !== Number(txn.due_year || 0),
          String(existing.source_txn_date_snapshot || '') !== String(txn.txn_date || ''),
          String(existing.receiver_email_snapshot || '') !== String(receiverEmailSnapshot || ''),
          String(existing.receiver_name_snapshot || '') !== String(receiverNameSnapshot || '')
        ].some(Boolean);

        const existingBatchId = Number(existing.batch_id || 0);
        const shouldForkBatch = changed && (receiverChanged || batchHasStartedResponse(existingBatchId));
        let nextBatchId = existingBatchId;
        if (!nextBatchId || shouldForkBatch) {
          nextBatchId = Number(getContextBatchId() || createSharedDebtBatch({
            requesterUserId: userId,
            receiverUserId: row.receiver_user_id,
            originKind: context?.originKind || 'single',
            createdAt: now
          }));
        }

        db.prepare(`
          UPDATE shared_debt_requests
          SET requester_person_id = ?,
              receiver_user_id = ?,
              source_person_id = ?,
              source_allocation_id = ?,
              source_due_month = ?,
              source_due_year = ?,
              source_txn_date_snapshot = ?,
              card_id = ?,
              card_name_snapshot = ?,
              description_snapshot = ?,
              amount_cents = ?,
              receiver_email_snapshot = ?,
              receiver_name_snapshot = ?,
              batch_id = ?,
              updated_at = ?
          WHERE id = ?
        `).run(
          requesterPerson?.id || null,
          row.receiver_user_id,
          personId,
          row.allocation_id,
          txn.due_month || null,
          txn.due_year || null,
          txn.txn_date || null,
          txn.card_id || null,
          txn.card_name || null,
          txn.description,
          row.share_cents,
          receiverEmailSnapshot,
          receiverNameSnapshot,
          nextBatchId,
          now,
          existing.id
        );

        if (changed) {
          addSharedDebtEvent({
            requestId: existing.id,
            actorUserId: userId,
            eventType: 'updated',
            note: shouldForkBatch
              ? 'Solicitação atualizada em um novo envio porque o destinatário já havia começado a responder o envio anterior.'
              : 'Solicitação atualizada automaticamente após alteração na distribuição.'
          });

          if (context) {
            recordSharedDebtBatchChange(context, {
              batchId: nextBatchId,
              receiverUserId: row.receiver_user_id,
              receiverName: receiverNameSnapshot,
              requestId: existing.id,
              kind: 'updated',
              amountCents: row.share_cents,
              description: txn.description
            });
          } else {
            createNotification({
              userId: row.receiver_user_id,
              type: 'shared_debt_request',
              title: 'Uma cobrança compartilhada foi atualizada',
              body: `${requesterDisplayName} ajustou a cobrança de ${formatBRLFromCents(row.share_cents)} (${txn.description}).`,
              href: `/shared-debts?request=${existing.id}`,
              relatedType: 'shared_debt_request',
              relatedId: existing.id
            });
          }
        }

        if (existingBatchId && existingBatchId !== nextBatchId) {
          refreshSharedDebtBatch(existingBatchId, now);
        }

        refreshSharedDebtBatch(nextBatchId, now);
      } else {
        const latestRequest = latestByPerson.get(personId);
        const hasActiveHistory = latestRequest && latestRequest.status && latestRequest.status !== 'cancelled';

        if (!hasActiveHistory) {
          const nextBatchId = Number(getContextBatchId() || createSharedDebtBatch({
            requesterUserId: userId,
            receiverUserId: row.receiver_user_id,
            originKind: context?.originKind || 'single',
            createdAt: now
          }));

          const info = db.prepare(`
            INSERT INTO shared_debt_requests (
              requester_user_id, requester_person_id, receiver_user_id, source_person_id,
              source_transaction_id, source_allocation_id, source_due_month, source_due_year, source_txn_date_snapshot,
              card_id, card_name_snapshot, description_snapshot, amount_cents,
              receiver_email_snapshot, receiver_name_snapshot, request_note, response_note,
              status, batch_id, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'pending', ?, ?, ?)
          `).run(
            userId,
            requesterPerson?.id || null,
            row.receiver_user_id,
            personId,
            txnId,
            row.allocation_id,
            txn.due_month || null,
            txn.due_year || null,
            txn.txn_date || null,
            txn.card_id || null,
            txn.card_name || null,
            txn.description,
            row.share_cents,
            receiverEmailSnapshot,
            receiverNameSnapshot,
            nextBatchId,
            now,
            now
          );

          const requestId = Number(info.lastInsertRowid);
          addSharedDebtEvent({ requestId, actorUserId: userId, eventType: 'created' });

          refreshSharedDebtBatch(nextBatchId, now);

          if (context) {
            recordSharedDebtBatchChange(context, {
              batchId: nextBatchId,
              receiverUserId: row.receiver_user_id,
              receiverName: receiverNameSnapshot,
              requestId,
              kind: 'created',
              amountCents: row.share_cents,
              description: txn.description
            });
          } else {
            createNotification({
              userId: row.receiver_user_id,
              type: 'shared_debt_request',
              title: 'Chegou uma cobrança compartilhada',
              body: `${requesterDisplayName} te enviou uma cobrança de ${formatBRLFromCents(row.share_cents)} (${txn.description}).`,
              href: `/shared-debts?request=${requestId}`,
              relatedType: 'shared_debt_request',
              relatedId: requestId
            });
          }
        }
      }
    });

    existingPending.forEach(row => {
      const personId = Number(row.source_person_id || 0);
      if (personId && !activePersonIds.has(personId)) {
        db.prepare(`
          UPDATE shared_debt_requests
          SET status = 'cancelled', updated_at = ?, resolved_at = ?
          WHERE id = ? AND status = 'pending'
        `).run(now, now, row.id);

        addSharedDebtEvent({
          requestId: row.id,
          actorUserId: userId,
          eventType: 'cancelled',
          note: 'Solicitação cancelada automaticamente porque a pessoa deixou de participar da divisão.'
        });

        touchSharedDebtBatch(row.batch_id, now);
      }
    });
  })();
}

function syncSharedDebtRequestsForTransactions(userId, txnIds, options = {}) {
  const cleanIds = Array.from(new Set((txnIds || []).map(Number).filter(Boolean)));
  if (!cleanIds.length) return null;

  const originRows = getTransactionScopeRowsByIds(userId, cleanIds);
  const context = createSharedDebtSyncContext(userId, {
    originKind: options.originKind || detectSharedDebtOriginKindFromRows(originRows)
  });

  cleanIds.forEach(txnId => syncSharedDebtRequestForTransactionWithContext(userId, txnId, context));
  flushSharedDebtBatchNotifications(context);
  return context;
}

function syncSharedDebtRequestsForTransaction(userId, txnId) {
  return syncSharedDebtRequestsForTransactions(userId, [txnId]);
}

function deleteTransactionsAndAllocations(userId, rows) {
  const uniqueRows = Array.from(new Map(
    (rows || [])
      .map(row => ({ id: Number(row.id), import_id: row.import_id ? Number(row.import_id) : null }))
      .filter(row => row.id)
      .map(row => [row.id, row])
  ).values());

  if (!uniqueRows.length) return 0;

  const deleteAllocation = db.prepare("DELETE FROM allocations WHERE transaction_id = ? AND user_id = ?");
  const deleteTransaction = db.prepare("DELETE FROM transactions WHERE id = ? AND user_id = ?");
  const deleteImportIfEmpty = db.prepare(`
    DELETE FROM imports
    WHERE id = ? AND user_id = ?
      AND NOT EXISTS (
        SELECT 1 FROM transactions t
        WHERE t.import_id = imports.id AND t.user_id = imports.user_id
      )
  `);

  db.transaction((items) => {
    const importIds = new Set();

    items.forEach(item => {
      detachSharedDebtRequestsFromDeletedTransaction(userId, item.id);
      deleteAllocation.run(item.id, userId);
      deleteTransaction.run(item.id, userId);
      if (item.import_id) importIds.add(item.import_id);
    });

    importIds.forEach(importId => deleteImportIfEmpty.run(importId, userId));
  })(uniqueRows);

  return uniqueRows.length;
}

function getTransactionScopeRow(userId, txnId) {
  return db.prepare(`
    SELECT t.id, t.import_id, t.description, t.amount_cents, t.card_id, t.recurring_rule_id, t.parent_txn_id,
           COALESCE(t.due_month, i.month) AS month,
           COALESCE(t.due_year, i.year) AS year
    FROM transactions t
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    WHERE t.id = ? AND t.user_id = ?
  `).get(txnId, userId);
}

function hasFutureInstallments(userId, txnRow) {
  if (!txnRow) return false;
  const currentMonth = Number(txnRow.month || 0);
  const currentYear = Number(txnRow.year || 0);
  const rootId = Number(txnRow.parent_txn_id || txnRow.id || 0);
  if (!rootId || !currentMonth || !currentYear) return false;

  return !!db.prepare(`
    SELECT 1
    FROM transactions t
    WHERE t.user_id = ?
      AND (t.id = ? OR t.parent_txn_id = ?)
      AND t.due_year IS NOT NULL
      AND t.due_month IS NOT NULL
      AND (
        t.due_year > ? OR
        (t.due_year = ? AND t.due_month > ?)
      )
    LIMIT 1
  `).get(userId, rootId, rootId, currentYear, currentYear, currentMonth);
}

function getInstallmentScopeRows(userId, txnRow, scope = 'single') {
  if (!txnRow) return [];

  const normalizedScope = String(scope || 'single').trim().toLowerCase();
  if (normalizedScope !== 'future') {
    return [txnRow];
  }

  const currentMonth = Number(txnRow.month || 0);
  const currentYear = Number(txnRow.year || 0);
  const rootId = Number(txnRow.parent_txn_id || txnRow.id || 0);
  if (!rootId || !currentMonth || !currentYear) {
    return [txnRow];
  }

  const rows = db.prepare(`
    SELECT t.id, t.import_id, t.description, t.amount_cents, t.card_id, t.recurring_rule_id, t.parent_txn_id,
           COALESCE(t.due_month, i.month) AS month,
           COALESCE(t.due_year, i.year) AS year
    FROM transactions t
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    WHERE t.user_id = ?
      AND (t.id = ? OR t.parent_txn_id = ?)
      AND (
        COALESCE(t.due_year, i.year) > ? OR
        (COALESCE(t.due_year, i.year) = ? AND COALESCE(t.due_month, i.month) >= ?)
      )
    ORDER BY COALESCE(t.due_year, i.year) ASC, COALESCE(t.due_month, i.month) ASC, t.id ASC
  `).all(userId, rootId, rootId, currentYear, currentYear, currentMonth);

  return rows.length ? rows : [txnRow];
}

function normalizeTxnIds(value) {
  const raw = Array.isArray(value) ? value : [value];
  return Array.from(new Set(raw.map(item => Number(item)).filter(Number.isInteger).filter(item => item > 0)));
}

function getTransactionScopeRowsByIds(userId, txnIds) {
  return normalizeTxnIds(txnIds)
    .map(txnId => getTransactionScopeRow(userId, txnId))
    .filter(Boolean);
}

function dedupeTxnRows(rows) {
  const byId = new Map();
  (rows || []).forEach(row => {
    if (!row || !row.id) return;
    if (!byId.has(row.id)) byId.set(row.id, row);
  });
  return Array.from(byId.values()).sort((a, b) => {
    const yearDiff = Number(a.year || 0) - Number(b.year || 0);
    if (yearDiff !== 0) return yearDiff;
    const monthDiff = Number(a.month || 0) - Number(b.month || 0);
    if (monthDiff !== 0) return monthDiff;
    return Number(a.id || 0) - Number(b.id || 0);
  });
}

function collectScopedTxnRows(userId, sourceRows, scope = 'single') {
  const scopedRows = [];
  (sourceRows || []).forEach(row => {
    getInstallmentScopeRows(userId, row, scope).forEach(target => scopedRows.push(target));
  });
  return dedupeTxnRows(scopedRows);
}

function getMonthDelta(fromYear, fromMonth, toYear, toMonth) {
  return ((Number(toYear) - Number(fromYear)) * 12) + (Number(toMonth) - Number(fromMonth));
}

function buildMoveTargets(userId, sourceRows, targetMonth, targetYear, scope = 'single') {
  const normalizedScope = String(scope || 'single').trim().toLowerCase();
  const targetMap = new Map();

  (sourceRows || []).forEach(sourceRow => {
    const delta = getMonthDelta(sourceRow.year, sourceRow.month, targetYear, targetMonth);
    const rowsToMove = normalizedScope === 'future'
      ? getInstallmentScopeRows(userId, sourceRow, 'future')
      : [sourceRow];

    rowsToMove.forEach(targetRow => {
      const shifted = normalizedScope === 'future'
        ? shiftMonth(targetRow.year, targetRow.month, delta)
        : { month: Number(targetMonth), year: Number(targetYear) };

      const existing = targetMap.get(targetRow.id);
      if (existing) {
        const conflict = Number(existing.target_month) !== Number(shifted.month) || Number(existing.target_year) !== Number(shifted.year);
        if (conflict) {
          throw new Error('Existem lançamentos selecionados com conflito de destino. Revise a seleção e tente novamente.');
        }
        return;
      }

      targetMap.set(targetRow.id, {
        ...targetRow,
        target_month: Number(shifted.month),
        target_year: Number(shifted.year)
      });
    });
  });

  return Array.from(targetMap.values()).sort((a, b) => {
    const yearDiff = Number(a.target_year || 0) - Number(b.target_year || 0);
    if (yearDiff !== 0) return yearDiff;
    const monthDiff = Number(a.target_month || 0) - Number(b.target_month || 0);
    if (monthDiff !== 0) return monthDiff;
    return Number(a.id || 0) - Number(b.id || 0);
  });
}

function likeParam(s) { return `%${String(s).trim()}%`; }

app.get("/", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;

  // Verifica se existe um titular cadastrado para o usuário logado
  const owner = db.prepare("SELECT id FROM people WHERE user_id = ? AND is_owner = 1 LIMIT 1").get(userId);

  // Se não houver titular, redireciona para a página de Pessoas para criar um
  if (!owner) {
    return res.redirect('/people');
  }

  const target = getPreferredDashboardMonth(userId);
  res.redirect(`/detalhamento/${target.year}/${target.month}`);
});

app.get("/geral", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const now = dayjs();
  const nextReference = shiftMonth(now.year(), now.month() + 1, 1);
  syncRecurringTransactions(userId, nextReference.year, nextReference.month);

  // 1. Puxamos todas as importações e transações manuais do usuário logado
  const recent = db.prepare(`
    SELECT i.id, i.month, i.year, i.created_at, i.original_filename, c.name AS card_name, c.id AS card_id,
           (SELECT COUNT(*) FROM transactions t WHERE t.import_id = i.id AND t.user_id = i.user_id) AS txn_count,
           (SELECT COALESCE(SUM(amount_cents), 0) FROM transactions t WHERE t.import_id = i.id AND t.user_id = i.user_id) AS import_total
    FROM imports i
    JOIN cards c ON c.id = i.card_id AND c.user_id = i.user_id
    WHERE i.user_id = ?

    UNION ALL

    SELECT NULL as id, t.due_month as month, t.due_year as year, t.created_at, 'Manual' as original_filename,
           c.name AS card_name, c.id AS card_id,
           1 AS txn_count,
           t.amount_cents AS import_total
    FROM transactions t
    JOIN cards c ON c.id = t.card_id AND c.user_id = t.user_id
    WHERE t.user_id = ? AND t.import_id IS NULL

    ORDER BY year DESC, month DESC, id DESC
  `).all(userId, userId);

  // 2. Puxamos o que já foi marcado como pago na tela de Resumo
  const statementsRows = db.prepare("SELECT card_id, month, year, paid_cents FROM card_statements WHERE user_id = ?").all(userId);
  const statements = {};
  const closedMonths = getClosedMonthsSet(userId);
  statementsRows.forEach(s => {
    statements[`${s.year}-${s.month}-${s.card_id}`] = s.paid_cents || 0;
  });

  // 3. Agrupamos por mês/ano e consolidamos os cartões dentro de cada mês
  const groupedMap = new Map();

  recent.forEach(r => {
    const monthKey = `${r.year}-${r.month}`;

    if (!groupedMap.has(monthKey)) {
      groupedMap.set(monthKey, {
        year: r.year,
        month: r.month,
        label: `${String(r.month).padStart(2, '0')}/${r.year}`,
        cards: [],
        total_cents: 0,
        paid_cents: 0,
        remaining_cents: 0,
        cardsMap: new Map()
      });
    }

    const group = groupedMap.get(monthKey);
    group.total_cents += r.import_total;

    if (!group.cardsMap.has(r.card_id)) {
      group.cardsMap.set(r.card_id, {
        card_id: r.card_id,
        card_name: r.card_name,
        month: r.month,
        year: r.year,
        txn_count: 0,
        import_total: 0,
        original_filename: r.original_filename,
        filenames: new Set()
      });
    }

    const cardGroup = group.cardsMap.get(r.card_id);
    cardGroup.txn_count += r.txn_count;
    cardGroup.import_total += r.import_total;

    if (r.original_filename) {
      cardGroup.filenames.add(r.original_filename);
    }
  });

  const groupedRecent = Array.from(groupedMap.values()).map(group => {
    const cards = Array.from(group.cardsMap.values())
      .map(card => {
        const filenames = Array.from(card.filenames.values());
        return {
          card_id: card.card_id,
          card_name: card.card_name,
          month: card.month,
          year: card.year,
          txn_count: card.txn_count,
          import_total: card.import_total,
          original_filename: filenames.length > 1 ? filenames.join(' + ') : (filenames[0] || 'N/A')
        };
      })
      .sort((a, b) => a.card_name.localeCompare(b.card_name, 'pt-BR', { sensitivity: 'base' }));

    const paid_cents = cards.reduce((totalPaid, card) => {
      return totalPaid + (statements[`${group.year}-${group.month}-${card.card_id}`] || 0);
    }, 0);

    return {
      year: group.year,
      month: group.month,
      label: group.label,
      cards,
      total_cents: group.total_cents,
      paid_cents,
      remaining_cents: Math.max(0, group.total_cents - paid_cents),
      isClosed: closedMonths.has(monthKey(group.month, group.year))
    };
  });

  const sortDesc = (a, b) => (b.year !== a.year) ? b.year - a.year : b.month - a.month;
  const sortAsc = (a, b) => (a.year !== b.year) ? a.year - b.year : a.month - b.month;

  const nowDate = new Date();
  const currentYear = nowDate.getFullYear();
  const currentMonth = nowDate.getMonth() + 1;
  const preferredOpenMonth = getPreferredDashboardMonth(userId, currentYear, currentMonth);

  const openGroups = groupedRecent
    .filter(group => !group.isClosed)
    .sort(sortAsc);
  const closedGroups = groupedRecent
    .filter(group => group.isClosed)
    .sort(sortDesc);

  const featuredOpenGroup = openGroups.find(group => group.year === preferredOpenMonth.year && group.month === preferredOpenMonth.month)
    || openGroups[0]
    || null;

  const remainingOpenGroups = featuredOpenGroup
    ? openGroups.filter(group => !(group.year === featuredOpenGroup.year && group.month === featuredOpenGroup.month))
      .sort((a, b) => {
        const aIsFuture = compareMonthYear(a.year, a.month, featuredOpenGroup.year, featuredOpenGroup.month) >= 0;
        const bIsFuture = compareMonthYear(b.year, b.month, featuredOpenGroup.year, featuredOpenGroup.month) >= 0;
        if (aIsFuture !== bIsFuture) return aIsFuture ? -1 : 1;
        return aIsFuture ? sortAsc(a, b) : sortDesc(a, b);
      })
    : [];

  const groupedRecentDisplay = [];
  if (featuredOpenGroup) {
    groupedRecentDisplay.push(featuredOpenGroup);
  }
  if (remainingOpenGroups.length) {
    groupedRecentDisplay.push({ __section: true, kind: 'open', label: 'Próximos meses em aberto', description: 'Competências abertas em ordem crescente.' });
    groupedRecentDisplay.push(...remainingOpenGroups);
  }
  if (closedGroups.length) {
    groupedRecentDisplay.push({ __section: true, kind: 'closed', label: 'Meses fechados', description: 'Competências encerradas, listadas em ordem decrescente.' });
    groupedRecentDisplay.push(...closedGroups);
  }

  const cards = getActiveCards(userId).map(({ id, name, close_day, due_day }) => ({ id, name, close_day, due_day }));

  res.render("home", {
    groupedRecent: groupedRecentDisplay,
    featuredOpenGroup,
    formatBRLFromCents,
    cards,
    closedMonths: Array.from(closedMonths.values()),
    user: req.user || req.session.user
  });
});

app.post("/geral/:year/:month/card/:cardId/delete", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const year = Number(req.params.year);
  const month = Number(req.params.month);
  const cardId = Number(req.params.cardId);

  if (!cardId || !month || month < 1 || month > 12 || !year) {
    setFlash(req, "error", "Parâmetros inválidos para excluir os lançamentos do cartão.");
    return res.redirect("/geral");
  }

  const card = db.prepare("SELECT id, name FROM cards WHERE id = ? AND user_id = ?").get(cardId, userId);
  if (isMonthClosed(userId, month, year)) {
    setFlash(req, "error", getMonthLockMessage(month, year));
    return res.redirect("/geral");
  }
  if (!card) {
    setFlash(req, "error", "Cartão não encontrado.");
    return res.redirect("/geral");
  }

  const txns = db.prepare(`
    SELECT t.id, t.import_id, t.recurring_rule_id, t.due_month, t.due_year
    FROM transactions t
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    WHERE t.user_id = ?
      AND t.card_id = ?
      AND (
        (${EFFECTIVE_DUE_MONTH_SQL} = ? AND ${EFFECTIVE_DUE_YEAR_SQL} = ?) OR
        (${EFFECTIVE_DUE_MONTH_SQL} = ? AND ${EFFECTIVE_DUE_YEAR_SQL} = ?)
      )
  `).all(userId, cardId, month, year, month, year);

  if (!txns.length) {
    setFlash(req, "info", `Nenhum lançamento foi encontrado para ${card.name} em ${String(month).padStart(2, "0")}/${year}.`);
    return res.redirect("/geral");
  }

  const settlementBlockMessage = buildSharedDebtCardMutationBlockerMessage(getSharedDebtCardMutationBlockersForTransactions(userId, txns));
  if (settlementBlockMessage) {
    setFlash(req, 'error', settlementBlockMessage);
    return res.redirect('/geral');
  }

  const addException = db.prepare(`
    INSERT OR IGNORE INTO recurring_exceptions (user_id, rule_id, month, year, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  let deletedCount = 0;
  db.transaction(() => {
    txns.forEach(txn => {
      if (txn.recurring_rule_id && txn.due_month && txn.due_year) {
        addException.run(userId, txn.recurring_rule_id, txn.due_month, txn.due_year, nowIso());
      }
    });
    deletedCount = deleteTransactionsAndAllocations(userId, txns);
  })();

  setFlash(req, "success", `${deletedCount} lançamento(s) de ${card.name} em ${String(month).padStart(2, "0")}/${year} foram excluídos.`);
  return res.redirect("/geral");
});

app.get("/geral/:year/:month/export.csv", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const parsed = parseMonthYear(req.params.month, req.params.year);
  if (!parsed) return res.status(400).send("Mês/ano inválidos.");
  const { month, year } = parsed;

  syncRecurringTransactions(userId, year, month);

  const rows = db.prepare(`
    SELECT
      COALESCE(t.txn_date, '') AS txn_date,
      t.description,
      c.name AS card_name,
      COALESCE(t.card_number, '') AS card_number,
      t.amount_cents,
      CASE WHEN EXISTS (
        SELECT 1 FROM allocations a WHERE a.transaction_id = t.id AND a.user_id = t.user_id
      ) THEN 'Sim' ELSE 'Não' END AS allocated,
      COALESCE((
        SELECT GROUP_CONCAT(name, ', ') FROM (
          SELECT p.name AS name
          FROM allocations a2
          JOIN people p ON p.id = a2.person_id AND p.user_id = a2.user_id
          WHERE a2.transaction_id = t.id AND a2.user_id = t.user_id
          ORDER BY p.name
        )
      ), '') AS people_names,
      CASE WHEN t.import_id IS NULL THEN 'Manual' ELSE COALESCE(i.original_filename, 'Importado') END AS origem
    FROM transactions t
    JOIN cards c ON c.id = t.card_id AND c.user_id = t.user_id
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    WHERE t.user_id = ?
      AND (
        (${EFFECTIVE_DUE_MONTH_SQL} = ? AND ${EFFECTIVE_DUE_YEAR_SQL} = ?) OR
        (${EFFECTIVE_DUE_MONTH_SQL} = ? AND ${EFFECTIVE_DUE_YEAR_SQL} = ?)
      )
    ORDER BY c.name, COALESCE(t.txn_date, ''), t.description
  `).all(userId, month, year, month, year);

  const header = ['Data da compra', 'Descrição', 'Cartão', 'Número', 'Valor (R$)', 'Distribuído', 'Pessoas', 'Origem', 'Competência'];
  const lines = [header.map(csvEscape).join(';')];

  rows.forEach(row => {
    lines.push([
      formatDateBR(row.txn_date),
      row.description,
      row.card_name,
      row.card_number,
      formatBRLFromCents(row.amount_cents),
      row.allocated,
      row.people_names,
      row.origem,
      monthLabel(month, year)
    ].map(csvEscape).join(';'));
  });

  const filename = `organizapay-cartoes-${year}-${String(month).padStart(2, '0')}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('\uFEFF' + lines.join('\r\n'));
});

function getSharedDebtRequestsReceived(userId) {
  return db.prepare(`
    SELECT
      r.*,
      COALESCE(r.batch_id, b.id) AS batch_id,
      COALESCE(b.origin_kind, 'single') AS batch_origin_kind,
      COALESCE(b.created_at, r.created_at) AS batch_created_at,
      COALESCE(b.updated_at, r.updated_at) AS batch_updated_at,
      COALESCE(b.status_summary, 'pending') AS batch_status_summary,
      b.first_responded_at AS batch_first_responded_at,
      b.resolved_at AS batch_resolved_at,
      u.name AS requester_name,
      u.email AS requester_email,
      COALESCE(r.source_txn_date_snapshot, t.txn_date) AS source_txn_date,
      COALESCE((
        SELECT COUNT(*)
        FROM shared_debt_requests rb
        WHERE rb.batch_id = r.batch_id
      ), 1) AS batch_total_count,
      CASE
        WHEN t.id IS NOT NULL AND (
          COALESCE(t.parent_txn_id, 0) > 0 OR
          EXISTS (
            SELECT 1
            FROM transactions tx_child
            WHERE tx_child.user_id = t.user_id
              AND tx_child.parent_txn_id = t.id
            LIMIT 1
          )
        ) THEN 1
        ELSE 0
      END AS is_installment_request
    FROM shared_debt_requests r
    JOIN users u ON u.id = r.requester_user_id
    LEFT JOIN shared_debt_batches b ON b.id = r.batch_id
    LEFT JOIN transactions t ON t.id = r.source_transaction_id AND t.user_id = r.requester_user_id
    WHERE r.receiver_user_id = ?
    ORDER BY
      COALESCE(r.source_due_year, 0) DESC,
      COALESCE(r.source_due_month, 0) DESC,
      CASE r.status
        WHEN 'pending' THEN 0
        WHEN 'accepted' THEN 1
        WHEN 'rejected_by_receiver' THEN 2
        WHEN 'rejection_contested_by_sender' THEN 3
        WHEN 'rejection_accepted_by_sender' THEN 4
        WHEN 'cancelled' THEN 5
        WHEN 'settled' THEN 6
        ELSE 7
      END,
      COALESCE(r.source_txn_date_snapshot, t.txn_date, r.created_at) DESC,
      r.created_at DESC
  `).all(userId);
}

function getSharedDebtRequestsSent(userId) {
  return db.prepare(`
    SELECT
      r.*,
      COALESCE(r.batch_id, b.id) AS batch_id,
      COALESCE(b.origin_kind, 'single') AS batch_origin_kind,
      COALESCE(b.created_at, r.created_at) AS batch_created_at,
      COALESCE(b.updated_at, r.updated_at) AS batch_updated_at,
      COALESCE(b.status_summary, 'pending') AS batch_status_summary,
      b.first_responded_at AS batch_first_responded_at,
      b.resolved_at AS batch_resolved_at,
      u.name AS receiver_name,
      u.email AS receiver_email,
      COALESCE(r.source_txn_date_snapshot, t.txn_date) AS source_txn_date,
      COALESCE((
        SELECT COUNT(*)
        FROM shared_debt_requests rb
        WHERE rb.batch_id = r.batch_id
      ), 1) AS batch_total_count,
      CASE
        WHEN t.id IS NOT NULL AND (
          COALESCE(t.parent_txn_id, 0) > 0 OR
          EXISTS (
            SELECT 1
            FROM transactions tx_child
            WHERE tx_child.user_id = t.user_id
              AND tx_child.parent_txn_id = t.id
            LIMIT 1
          )
        ) THEN 1
        ELSE 0
      END AS is_installment_request
    FROM shared_debt_requests r
    JOIN users u ON u.id = r.receiver_user_id
    LEFT JOIN shared_debt_batches b ON b.id = r.batch_id
    LEFT JOIN transactions t ON t.id = r.source_transaction_id AND t.user_id = r.requester_user_id
    WHERE r.requester_user_id = ?
    ORDER BY
      COALESCE(r.source_due_year, 0) DESC,
      COALESCE(r.source_due_month, 0) DESC,
      CASE r.status
        WHEN 'pending' THEN 0
        WHEN 'accepted' THEN 1
        WHEN 'rejected_by_receiver' THEN 2
        WHEN 'rejection_contested_by_sender' THEN 3
        WHEN 'rejection_accepted_by_sender' THEN 4
        WHEN 'cancelled' THEN 5
        WHEN 'settled' THEN 6
        ELSE 7
      END,
      COALESCE(r.source_txn_date_snapshot, t.txn_date, r.created_at) DESC,
      r.created_at DESC
  `).all(userId);
}

function getSharedDebtEventsByRequestIds(requestIds) {
  const cleanIds = Array.from(new Set((requestIds || []).map(Number).filter(Boolean)));
  if (!cleanIds.length) return new Map();

  const placeholders = cleanIds.map(() => '?').join(', ');
  const rows = db.prepare(`
    SELECT e.*, u.name AS actor_name, u.email AS actor_email
    FROM shared_debt_events e
    JOIN users u ON u.id = e.actor_user_id
    WHERE e.request_id IN (${placeholders})
    ORDER BY e.created_at ASC, e.id ASC
  `).all(...cleanIds);

  const map = new Map();
  rows.forEach(row => {
    if (!map.has(row.request_id)) map.set(row.request_id, []);
    map.get(row.request_id).push(row);
  });
  return map;
}

function getAcceptedSharedDebtSummaryForMonth(userId, month, year) {
  const params = [userId, month, year];

  const manualOwed = db.prepare(`
    SELECT
      COUNT(*) AS total_requests,
      COALESCE(SUM(CASE
        WHEN (r.amount_cents - COALESCE(r.amount_paid_cents, 0)) > 0 THEN (r.amount_cents - COALESCE(r.amount_paid_cents, 0))
        ELSE 0
      END), 0) AS total_cents
    FROM shared_debt_requests r
    WHERE r.receiver_user_id = ?
      AND COALESCE(r.request_kind, 'card') = 'manual'
      AND r.status = 'accepted'
  `).get(userId) || { total_requests: 0, total_cents: 0 };

  const manualReceivable = db.prepare(`
    SELECT
      COUNT(*) AS total_requests,
      COALESCE(SUM(CASE
        WHEN (r.amount_cents - COALESCE(r.amount_paid_cents, 0)) > 0 THEN (r.amount_cents - COALESCE(r.amount_paid_cents, 0))
        ELSE 0
      END), 0) AS total_cents
    FROM shared_debt_requests r
    WHERE r.requester_user_id = ?
      AND COALESCE(r.request_kind, 'card') = 'manual'
      AND r.status = 'accepted'
  `).get(userId) || { total_requests: 0, total_cents: 0 };

  const buildCardSideSummary = (scope) => {
    const roleColumn = scope === 'owed' ? 'receiver_user_id' : 'requester_user_id';
    const pairRows = db.prepare(`
      SELECT DISTINCT r.requester_user_id, r.receiver_user_id
      FROM shared_debt_requests r
      LEFT JOIN transactions t ON t.id = r.source_transaction_id AND t.user_id = r.requester_user_id
      LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
      WHERE r.${roleColumn} = ?
        AND COALESCE(r.request_kind, 'card') = 'card'
        AND COALESCE(r.source_due_month, i.month, t.due_month) = ?
        AND COALESCE(r.source_due_year, i.year, t.due_year) = ?
        AND r.status IN ('accepted', 'settled')
    `).all(...params);

    return pairRows.reduce((acc, row) => {
      const snapshot = getSharedDebtCardMonthlySettlementSnapshot({
        requesterUserId: row.requester_user_id,
        receiverUserId: row.receiver_user_id,
        month,
        year
      });
      if (!snapshot || Number(snapshot.openCents || 0) <= 0) return acc;

      const preview = buildSharedDebtCardMonthlyIntentPreview(snapshot, snapshot.openCents, {
        maxAmountCents: snapshot.openCents
      });

      acc.totalCents += Math.max(0, Number(snapshot.openCents || 0));
      acc.totalCount += Math.max(1, Number(preview?.touchedCount || 0));
      return acc;
    }, { totalCents: 0, totalCount: 0 });
  };

  const cardOwed = buildCardSideSummary('owed');
  const cardReceivable = buildCardSideSummary('receivable');

  return {
    owedCents: Number(manualOwed.total_cents || 0) + cardOwed.totalCents,
    owedCount: Number(manualOwed.total_requests || 0) + cardOwed.totalCount,
    receivableCents: Number(manualReceivable.total_cents || 0) + cardReceivable.totalCents,
    receivableCount: Number(manualReceivable.total_requests || 0) + cardReceivable.totalCount
  };
}


function normalizeSharedDebtSearchTerm(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

function normalizeSharedDebtTrackingFilters(query = {}) {
  const envio = String(query?.envio || 'all').trim().toLowerCase();
  const origin = String(query?.origin || 'all').trim().toLowerCase();
  const installment = String(query?.installment || 'all').trim().toLowerCase();
  const q = String(query?.q || '').trim().slice(0, 120);

  return {
    envio: ['all', 'single', 'grouped'].includes(envio) ? envio : 'all',
    origin: ['all', 'single', 'multiple', 'installment', 'mixed', 'manual'].includes(origin) ? origin : 'all',
    installment: ['all', 'yes', 'no'].includes(installment) ? installment : 'all',
    q
  };
}

function hasActiveSharedDebtTrackingFilters(filters = {}) {
  const normalized = normalizeSharedDebtTrackingFilters(filters);
  return normalized.envio !== 'all' || normalized.origin !== 'all' || normalized.installment !== 'all' || !!normalized.q;
}

function isGroupedSharedDebtItem(item) {
  const batchCount = Number(item?.batch_total_count || 0);
  const originKind = normalizeSharedDebtOriginKind(item?.batch_origin_kind);
  return batchCount > 1 || !['single', 'manual'].includes(originKind);
}

function buildSharedDebtTrackingSearchText(item = {}) {
  const monthText = item?.source_due_month && item?.source_due_year
    ? monthLabel(item.source_due_month, item.source_due_year)
    : '';
  const txnDateText = item?.source_txn_date ? formatDateBR(item.source_txn_date) : '';

  return normalizeSharedDebtSearchTerm([
    item?.description_snapshot,
    item?.card_name_snapshot,
    item?.request_note,
    item?.response_note,
    item?.payment_note,
    item?.requester_name,
    item?.requester_email,
    item?.receiver_name,
    item?.receiver_email,
    item?.receiver_email_snapshot,
    item?.batch_origin_kind,
    item?.status,
    monthText,
    txnDateText
  ].filter(Boolean).join(' '));
}

function filterSharedDebtTrackingItems(items = [], filters = {}) {
  const normalized = normalizeSharedDebtTrackingFilters(filters);
  const searchTerm = normalizeSharedDebtSearchTerm(normalized.q || '');

  return (Array.isArray(items) ? items : []).filter((item) => {
    const originKind = normalizeSharedDebtOriginKind(item?.batch_origin_kind);
    const isGrouped = isGroupedSharedDebtItem(item);
    const isInstallment = Number(item?.is_installment_request || 0) > 0;

    if (normalized.envio === 'single' && isGrouped) return false;
    if (normalized.envio === 'grouped' && !isGrouped) return false;
    if (normalized.origin !== 'all' && originKind !== normalized.origin) return false;
    if (normalized.installment === 'yes' && !isInstallment) return false;
    if (normalized.installment === 'no' && isInstallment) return false;
    if (searchTerm && !buildSharedDebtTrackingSearchText(item).includes(searchTerm)) return false;
    return true;
  });
}

function parseSharedDebtRequestIds(rawValue) {
  const source = Array.isArray(rawValue)
    ? rawValue
    : String(rawValue || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);

  return Array.from(new Set(source.map((value) => Number(value)).filter(Boolean)));
}

function buildSharedDebtBulkPeriodLabel(rows = []) {
  const entries = Array.from(new Set(
    (Array.isArray(rows) ? rows : [])
      .map((row) => {
        const month = Number(row?.source_due_month || 0);
        const year = Number(row?.source_due_year || 0);
        if (!month || !year) return null;
        return { month, year, rank: (year * 100) + month };
      })
      .filter(Boolean)
      .map((entry) => JSON.stringify(entry))
  )).map((value) => JSON.parse(value)).sort((a, b) => a.rank - b.rank);

  if (!entries.length) return null;
  if (entries.length === 1) return monthLabel(entries[0].month, entries[0].year);
  const first = entries[0];
  const last = entries[entries.length - 1];
  return `${monthLabel(first.month, first.year)} até ${monthLabel(last.month, last.year)}`;
}

function groupSharedDebtRowsByBatch(rows = []) {
  const groups = new Map();

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const batchId = Number(row?.batch_id || 0);
    const requestId = Number(row?.id || 0);
    const key = batchId ? `batch:${batchId}` : `request:${requestId}`;

    if (!groups.has(key)) {
      groups.set(key, {
        batchId: batchId || null,
        requestId: requestId || null,
        rows: [],
        totalCents: 0
      });
    }

    const entry = groups.get(key);
    entry.rows.push(row);
    entry.totalCents += Number(row?.amount_cents || 0);
  });

  return Array.from(groups.values());
}

app.get('/shared-debts', ensureAuthenticated, (req, res) => {
  return renderSharedDebtsPage(req, res, { archiveMode: false });
});

app.get('/shared-debts/archive', ensureAuthenticated, (req, res) => {
  return renderSharedDebtsPage(req, res, { archiveMode: true });
});

app.post('/shared-debts/:id/archive', ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const requestId = Number(req.params.id);
  const fallbackRedirect = resolveSharedDebtViewPath(req.body.return_to, redirectBackOr(req, '/shared-debts'));

  if (!requestId) {
    setFlash(req, 'error', 'Ops, essa cobrança não parece válida.');
    return res.redirect(fallbackRedirect);
  }

  const requestRow = db.prepare(`
    SELECT id, status
    FROM shared_debt_requests
    WHERE id = ? AND (requester_user_id = ? OR receiver_user_id = ?)
    LIMIT 1
  `).get(requestId, userId, userId);

  if (!requestRow) {
    setFlash(req, 'error', 'Cobrança não encontrada.');
    return res.redirect(fallbackRedirect);
  }

  if (!canArchiveSharedDebtStatus(requestRow.status)) {
    setFlash(req, 'info', 'Essa cobrança ainda tem história para acontecer por aqui, então ela fica nas ativas por enquanto.');
    return res.redirect(fallbackRedirect);
  }

  upsertSharedDebtArchiveState({
    requestId,
    userId,
    isArchived: true,
    archivedFromStatus: requestRow.status,
    timestamp: nowIso()
  });

  setFlash(req, 'success', 'Cobrança arquivada. A fila principal agradeceu o respiro.');
  return res.redirect(fallbackRedirect);
});

app.post('/shared-debts/:id/unarchive', ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const requestId = Number(req.params.id);
  const fallbackRedirect = resolveSharedDebtViewPath(req.body.return_to, redirectBackOr(req, '/shared-debts/archive'));

  if (!requestId) {
    setFlash(req, 'error', 'Ops, essa cobrança não parece válida.');
    return res.redirect(fallbackRedirect);
  }

  const requestRow = db.prepare(`
    SELECT id, status
    FROM shared_debt_requests
    WHERE id = ? AND (requester_user_id = ? OR receiver_user_id = ?)
    LIMIT 1
  `).get(requestId, userId, userId);

  if (!requestRow) {
    setFlash(req, 'error', 'Cobrança não encontrada.');
    return res.redirect(fallbackRedirect);
  }

  upsertSharedDebtArchiveState({
    requestId,
    userId,
    isArchived: false,
    archivedFromStatus: requestRow.status,
    timestamp: nowIso()
  });

  setFlash(req, 'success', 'Cobrança restaurada. Ela voltou para as ativas sem perder nadinha do histórico.');
  return res.redirect(fallbackRedirect);
});

app.post('/shared-debts/bulk/archive', ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const requestIds = parseSharedDebtRequestIds(req.body.request_ids || req.body.requestIds || req.body.request_id);
  const fallbackRedirect = resolveSharedDebtViewPath(req.body.return_to, redirectBackOr(req, '/shared-debts'));

  if (!requestIds.length) {
    setFlash(req, 'error', 'Nenhuma cobrança válida foi escolhida para ir ao arquivo.');
    return res.redirect(fallbackRedirect);
  }

  const placeholders = requestIds.map(() => '?').join(', ');
  const rows = db.prepare(`
    SELECT id, status
    FROM shared_debt_requests
    WHERE id IN (${placeholders})
      AND (requester_user_id = ? OR receiver_user_id = ?)
  `).all(...requestIds, userId, userId).filter((row) => canArchiveSharedDebtStatus(row.status));

  if (!rows.length) {
    setFlash(req, 'info', 'Essas cobranças ainda não estão naquele ponto zen de irem para o arquivo.');
    return res.redirect(fallbackRedirect);
  }

  const now = nowIso();
  db.transaction(() => {
    rows.forEach((row) => {
      upsertSharedDebtArchiveState({
        requestId: row.id,
        userId,
        isArchived: true,
        archivedFromStatus: row.status,
        timestamp: now
      });
    });
  })();

  setFlash(req, 'success', `Pronto! ${formatCountLabel(rows.length, 'cobrança foi arquivada', 'cobranças foram arquivadas')} sem apagar o histórico.`);
  return res.redirect(fallbackRedirect);
});

app.post('/shared-debts/bulk/unarchive', ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const requestIds = parseSharedDebtRequestIds(req.body.request_ids || req.body.requestIds || req.body.request_id);
  const fallbackRedirect = resolveSharedDebtViewPath(req.body.return_to, redirectBackOr(req, '/shared-debts/archive'));

  if (!requestIds.length) {
    setFlash(req, 'error', 'Nenhuma cobrança válida foi escolhida para sair do arquivo.');
    return res.redirect(fallbackRedirect);
  }

  const placeholders = requestIds.map(() => '?').join(', ');
  const rows = db.prepare(`
    SELECT r.id, r.status
    FROM shared_debt_requests r
    JOIN shared_debt_archives a ON a.request_id = r.id AND a.user_id = ? AND a.is_archived = 1
    WHERE r.id IN (${placeholders})
      AND (r.requester_user_id = ? OR r.receiver_user_id = ?)
  `).all(userId, ...requestIds, userId, userId)

  if (!rows.length) {
    setFlash(req, 'info', 'Não achei cobranças arquivadas válidas nessa seleção.');
    return res.redirect(fallbackRedirect);
  }

  const now = nowIso();
  db.transaction(() => {
    rows.forEach((row) => {
      upsertSharedDebtArchiveState({
        requestId: row.id,
        userId,
        isArchived: false,
        archivedFromStatus: row.status,
        timestamp: now
      });
    });
  })();

  setFlash(req, 'success', `Pronto! ${formatCountLabel(rows.length, 'cobrança voltou para as ativas', 'cobranças voltaram para as ativas')}.`);
  return res.redirect(fallbackRedirect);
});

app.post('/shared-debts/manual', ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const personId = Number(req.body.person_id || 0);
  const description = String(req.body.description || '').trim();
  const note = String(req.body.note || '').trim() || null;
  const amountCents = centsFromPtBrMoney(req.body.amount);

  if (!personId) {
    setFlash(req, 'error', 'Escolha uma amizade para enviar esse lembrete avulso.');
    return res.redirect('/shared-debts');
  }

  if (!description) {
    setFlash(req, 'error', 'Dê um nome curto para essa cobrança avulsa antes de enviar.');
    return res.redirect('/shared-debts');
  }

  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    setFlash(req, 'error', 'Coloque um valor válido para esse lembrete seguir viagem.');
    return res.redirect('/shared-debts');
  }

  const person = getManualSharedDebtEligiblePeople(userId).find(entry => Number(entry.id || 0) === personId);
  if (!person) {
    setFlash(req, 'error', 'Essa amizade não está pronta para receber cobrança avulsa agora.');
    return res.redirect('/shared-debts');
  }

  const linkedUserId = Number(person.linked_user_id || 0);
  if (!linkedUserId || linkedUserId === userId) {
    setFlash(req, 'error', 'Não consegui descobrir quem está do outro lado desse lembrete.');
    return res.redirect('/shared-debts');
  }

  const requesterPerson = getOwnerPerson(userId);
  const actor = getUserRecord(userId);
  const actorName = requesterPerson?.name || actor?.name || actor?.email || 'Um usuário';
  const receiverName = person.name || person.linked_user_name || person.linked_user_email || 'essa amizade';
  const receiverEmail = normalizeEmail(person.email || person.linked_user_email || null);
  const now = nowIso();
  const batchId = createSharedDebtBatch({
    requesterUserId: userId,
    receiverUserId: linkedUserId,
    originKind: 'manual',
    createdAt: now
  });

  const info = db.prepare(`
    INSERT INTO shared_debt_requests (
      requester_user_id, requester_person_id, receiver_user_id, source_person_id,
      source_transaction_id, source_allocation_id, source_due_month, source_due_year, source_txn_date_snapshot,
      card_id, card_name_snapshot, description_snapshot, amount_cents,
      receiver_email_snapshot, receiver_name_snapshot, request_note, response_note,
      status, batch_id, request_kind, created_at, updated_at
    ) VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, NULL, NULL, ?, ?, ?, ?, ?, NULL, 'pending', ?, 'manual', ?, ?)
  `).run(
    userId,
    requesterPerson?.id || null,
    linkedUserId,
    personId,
    now,
    description,
    amountCents,
    receiverEmail,
    receiverName,
    note,
    batchId,
    now,
    now
  );

  const requestId = Number(info.lastInsertRowid || 0);
  addSharedDebtEvent({ requestId, actorUserId: userId, eventType: 'created', note: note || 'Lembrete avulso enviado.' });
  refreshSharedDebtBatch(batchId, now);

  createNotification({
    userId: linkedUserId,
    type: 'shared_debt_request',
    title: 'Chegou um lembrete avulso',
    body: `${actorName} te enviou um lembrete de ${formatBRLFromCents(amountCents)} (${description}).${buildNoteSuffix(note, 'Recado')}`,
    href: `/shared-debts?request=${requestId}`,
    relatedType: 'shared_debt_request',
    relatedId: requestId
  });

  setFlash(req, 'success', `Pronto! O lembrete avulso para ${receiverName} já foi enviado com a data de hoje.`);
  return res.redirect(`/shared-debts?request=${requestId}`);
});

app.post('/shared-debts/batches/:id/respond', ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const batchId = Number(req.params.id);
  const action = String(req.body.action || '').trim().toLowerCase();
  const note = String(req.body.note || '').trim() || null;

  if (!batchId) {
    setFlash(req, 'error', 'Ops, esse envio não é válido.');
    return res.redirect('/shared-debts');
  }

  if (!['accept', 'reject'].includes(action)) {
    setFlash(req, 'error', 'Essa ação não combina com esse envio.');
    return res.redirect(`/shared-debts?batch=${batchId}`);
  }

  const batchRow = db.prepare(`
    SELECT b.*, u.name AS requester_name, u.email AS requester_email
    FROM shared_debt_batches b
    JOIN users u ON u.id = b.requester_user_id
    WHERE b.id = ? AND b.receiver_user_id = ?
    LIMIT 1
  `).get(batchId, userId);

  if (!batchRow) {
    setFlash(req, 'error', 'Envio não encontrado.');
    return res.redirect('/shared-debts');
  }

  const pendingItems = db.prepare(`
    SELECT id, amount_cents, description_snapshot
    FROM shared_debt_requests
    WHERE batch_id = ?
      AND receiver_user_id = ?
      AND status = 'pending'
    ORDER BY created_at ASC, id ASC
  `).all(batchId, userId);

  if (!pendingItems.length) {
    setFlash(req, 'info', 'Este envio não possui mais cobranças pendentes para você.');
    return res.redirect(`/shared-debts?batch=${batchId}`);
  }

  const actor = getUserRecord(userId);
  const actorName = actor?.name || actor?.email || 'O destinatário';
  const now = nowIso();
  const accepted = action === 'accept';
  const nextStatus = accepted ? 'accepted' : 'rejected_by_receiver';
  const eventType = nextStatus;
  const totalCents = pendingItems.reduce((sum, item) => sum + Number(item.amount_cents || 0), 0);
  const firstRequestId = Number(pendingItems[0]?.id || 0) || null;
  const chargeCountLabel = formatCountLabel(pendingItems.length, 'cobrança', 'cobranças');
  const isManualBatch = normalizeSharedDebtOriginKind(batchRow.origin_kind) === 'manual';
  const itemCountLabel = isManualBatch
    ? formatCountLabel(pendingItems.length, 'lembrete avulso', 'lembretes avulsos')
    : chargeCountLabel;
  const title = accepted
    ? (isManualBatch ? 'Seu lembrete avulso foi aceito' : 'Seu envio foi aceito')
    : (isManualBatch ? 'Seu lembrete avulso foi recusado' : 'Seu envio foi recusado');
  const baseBody = accepted
    ? `${actorName} aceitou ${itemCountLabel} do seu envio, somando ${formatBRLFromCents(totalCents)}.`
    : `${actorName} recusou ${itemCountLabel} do seu envio, somando ${formatBRLFromCents(totalCents)}.`;
  const body = `${baseBody}${buildNoteSuffix(note)}`;

  const updateStmt = db.prepare(`
    UPDATE shared_debt_requests
    SET status = ?, response_note = ?, updated_at = ?, responded_at = ?
    WHERE id = ? AND receiver_user_id = ? AND status = 'pending'
  `);

  db.transaction(() => {
    pendingItems.forEach(item => {
      updateStmt.run(nextStatus, note, now, now, item.id, userId);
      addSharedDebtEvent({ requestId: item.id, actorUserId: userId, eventType, note });
    });

    touchSharedDebtBatch(batchId, now);

    createNotification({
      userId: batchRow.requester_user_id,
      type: 'shared_debt_batch',
      title,
      body,
      href: firstRequestId ? `/shared-debts?request=${firstRequestId}` : '/shared-debts',
      relatedType: 'shared_debt_batch',
      relatedId: batchId
    });
  })();

  setFlash(req, 'success', accepted
    ? `Pronto! Você aceitou ${chargeCountLabel} deste envio.`
    : `Pronto! Você recusou ${chargeCountLabel} deste envio.`);
  return res.redirect(`/shared-debts?batch=${batchId}`);
});

app.post("/shared-debts/:id/respond", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const requestId = Number(req.params.id);
  const action = String(req.body.action || '').trim().toLowerCase();
  const note = String(req.body.note || '').trim() || null;

  if (!requestId) {
    setFlash(req, 'error', 'Ops, essa solicitação não é válida.');
    return res.redirect('/shared-debts');
  }

  if (!['accept', 'reject'].includes(action)) {
    setFlash(req, 'error', 'Essa ação não combina com essa solicitação.');
    return res.redirect(`/shared-debts?request=${requestId}`);
  }

  const requestRow = db.prepare(`
    SELECT r.*, u.name AS requester_name, u.email AS requester_email
    FROM shared_debt_requests r
    JOIN users u ON u.id = r.requester_user_id
    WHERE r.id = ? AND r.receiver_user_id = ?
    LIMIT 1
  `).get(requestId, userId);

  if (!requestRow) {
    setFlash(req, 'error', 'Ops, não encontrei essa solicitação.');
    return res.redirect('/shared-debts');
  }

  if (requestRow.status !== 'pending') {
    setFlash(req, 'info', 'Essa solicitação já tinha sido resolvida antes.');
    return res.redirect(`/shared-debts?request=${requestId}`);
  }

  const actor = getUserRecord(userId);
  const actorName = actor?.name || requestRow.receiver_name_snapshot || actor?.email || 'O destinatário';
  const now = nowIso();
  const accepted = action === 'accept';
  const nextStatus = accepted ? 'accepted' : 'rejected_by_receiver';
  const eventType = nextStatus;
  const requestKind = normalizeSharedDebtRequestKind(requestRow.request_kind);
  const isManualRequest = requestKind === 'manual';
  const title = accepted
    ? (isManualRequest ? 'Aceitaram seu lembrete avulso' : 'Aceitaram sua cobrança compartilhada')
    : (isManualRequest ? 'Recusaram seu lembrete avulso' : 'Recusaram sua cobrança compartilhada');
  const baseBody = accepted
    ? `${actorName} aceitou ${isManualRequest ? 'o lembrete avulso' : 'a cobrança'} de ${formatBRLFromCents(requestRow.amount_cents)} (${requestRow.description_snapshot}).`
    : `${actorName} recusou ${isManualRequest ? 'o lembrete avulso' : 'a cobrança'} de ${formatBRLFromCents(requestRow.amount_cents)} (${requestRow.description_snapshot}).`;
  const body = `${baseBody}${buildNoteSuffix(note)}`;

  db.transaction(() => {
    db.prepare(`
      UPDATE shared_debt_requests
      SET status = ?, response_note = ?, updated_at = ?, responded_at = ?
      WHERE id = ? AND receiver_user_id = ? AND status = 'pending'
    `).run(nextStatus, note, now, now, requestId, userId);

    addSharedDebtEvent({ requestId, actorUserId: userId, eventType, note });
    touchSharedDebtBatch(requestRow.batch_id, now);

    createNotification({
      userId: requestRow.requester_user_id,
      type: 'shared_debt_request',
      title,
      body,
      href: `/shared-debts?request=${requestId}`,
      relatedType: 'shared_debt_request',
      relatedId: requestId
    });
  })();

  setFlash(req, 'success', accepted ? 'Pronto! Você aceitou essa solicitação.' : 'Pronto! Você recusou essa solicitação.');
  return res.redirect(`/shared-debts?request=${requestId}`);
});

app.post("/shared-debts/:id/sender-action", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const requestId = Number(req.params.id);
  const action = String(req.body.action || '').trim().toLowerCase();
  const note = String(req.body.note || '').trim() || null;

  if (!requestId) {
    setFlash(req, 'error', 'Ops, essa solicitação não é válida.');
    return res.redirect('/shared-debts');
  }

  if (!['accept_rejection', 'contest_rejection'].includes(action)) {
    setFlash(req, 'error', 'Essa ação não combina com essa solicitação.');
    return res.redirect(`/shared-debts?request=${requestId}`);
  }

  const requestRow = db.prepare(`
    SELECT r.*, u.name AS receiver_name, u.email AS receiver_email
    FROM shared_debt_requests r
    JOIN users u ON u.id = r.receiver_user_id
    WHERE r.id = ? AND r.requester_user_id = ?
    LIMIT 1
  `).get(requestId, userId);

  if (!requestRow) {
    setFlash(req, 'error', 'Ops, não encontrei essa solicitação.');
    return res.redirect('/shared-debts');
  }

  if (requestRow.status !== 'rejected_by_receiver') {
    setFlash(req, 'info', 'Essa solicitação não está esperando uma decisão de quem enviou.');
    return res.redirect(`/shared-debts?request=${requestId}`);
  }

  const actor = getUserRecord(userId);
  const actorName = actor?.name || actor?.email || 'O remetente';
  const now = nowIso();
  const acceptingRejection = action === 'accept_rejection';
  const nextStatus = acceptingRejection ? 'rejection_accepted_by_sender' : 'rejection_contested_by_sender';
  const eventType = nextStatus;
  const requestKind = normalizeSharedDebtRequestKind(requestRow.request_kind);
  const isManualRequest = requestKind === 'manual';
  const title = acceptingRejection
    ? (isManualRequest ? 'A recusa do lembrete foi aceita' : 'Sua recusa foi aceita')
    : (isManualRequest ? 'A recusa do lembrete foi contestada' : 'Sua recusa foi contestada');
  const baseBody = acceptingRejection
    ? `${actorName} aceitou a sua recusa ${isManualRequest ? 'do lembrete avulso' : 'da cobrança'} de ${formatBRLFromCents(requestRow.amount_cents)} (${requestRow.description_snapshot}).`
    : `${actorName} contestou a sua recusa ${isManualRequest ? 'do lembrete avulso' : 'da cobrança'} de ${formatBRLFromCents(requestRow.amount_cents)} (${requestRow.description_snapshot}).`;
  const body = `${baseBody}${buildNoteSuffix(note)}`;

  db.transaction(() => {
    if (acceptingRejection) {
      db.prepare(`
        UPDATE shared_debt_requests
        SET status = ?, updated_at = ?, resolved_at = ?
        WHERE id = ? AND requester_user_id = ? AND status = 'rejected_by_receiver'
      `).run(nextStatus, now, now, requestId, userId);
    } else {
      db.prepare(`
        UPDATE shared_debt_requests
        SET status = ?, updated_at = ?, resolved_at = NULL
        WHERE id = ? AND requester_user_id = ? AND status = 'rejected_by_receiver'
      `).run(nextStatus, now, requestId, userId);
    }

    addSharedDebtEvent({ requestId, actorUserId: userId, eventType, note });
    touchSharedDebtBatch(requestRow.batch_id, now);

    createNotification({
      userId: requestRow.receiver_user_id,
      type: 'shared_debt_request',
      title,
      body,
      href: `/shared-debts?request=${requestId}`,
      relatedType: 'shared_debt_request',
      relatedId: requestId
    });
  })();

  setFlash(req, 'success', acceptingRejection ? 'Pronto! Você aceitou a recusa e encerrou essa cobrança.' : 'Pronto! Você contestou a recusa dessa cobrança.');
  return res.redirect(`/shared-debts?request=${requestId}`);
});

app.get('/shared-debts/monthly-settlements/:id/prepare', ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const settlementId = Number(req.params.id);

  if (!settlementId) {
    return res.status(400).json({ ok: false, message: 'Não consegui descobrir qual mês você quer acertar por Pix.' });
  }

  const settlementRow = getSharedDebtCardMonthlySettlementRowById(settlementId);
  if (!settlementRow || (Number(settlementRow.requester_user_id || 0) !== Number(userId || 0) && Number(settlementRow.receiver_user_id || 0) !== Number(userId || 0))) {
    return res.status(404).json({ ok: false, message: 'Essa carteira mensal não apareceu por aqui.' });
  }

  if (Number(settlementRow.receiver_user_id || 0) !== Number(userId || 0)) {
    return res.status(403).json({ ok: false, message: 'Esse Pix mensal fica do lado de quem vai pagar.' });
  }

  const snapshot = getSharedDebtCardMonthlySettlementSnapshotById(settlementId);
  if (!snapshot || !Number(snapshot.requestCount || 0)) {
    return res.status(404).json({ ok: false, message: 'Ainda não encontrei cobranças aceitas para montar esse mês por aqui.' });
  }

  const creditorProfile = getUserPixProfile(settlementRow.requester_user_id);
  const creditorRecord = getUserRecord(settlementRow.requester_user_id);
  const preview = buildSharedDebtCardMonthlyIntentPreview(snapshot, snapshot.openCents);

  let pixAvailable = false;
  let pixUnavailableReason = null;

  if (!creditorProfile || !creditorProfile.pixEnabled) {
    pixUnavailableReason = 'Quem vai receber ainda não deixou um Pix prontinho por aqui.';
  } else if (!creditorProfile.pixValid) {
    pixUnavailableReason = creditorProfile.pixReason || 'O Pix de quem vai receber ainda precisa de um acerto.';
  } else if (!Number(snapshot.openCents || 0)) {
    pixUnavailableReason = 'Esse mês já está sem saldo aberto para um novo Pix agora.';
  } else {
    pixAvailable = true;
  }

  return res.json({
    ok: true,
    settlementId,
    month: Number(snapshot.month || settlementRow.month || 0),
    year: Number(snapshot.year || settlementRow.year || 0),
    monthLabel: monthLabel(snapshot.month || settlementRow.month, snapshot.year || settlementRow.year),
    counterpartName: creditorRecord?.name || creditorRecord?.email || 'quem vai receber',
    totalAcceptedCents: Number(snapshot.totalAcceptedCents || 0),
    totalAcceptedFormatted: formatBRLFromCents(snapshot.totalAcceptedCents || 0),
    confirmedCents: Number(snapshot.confirmedCents || 0),
    confirmedFormatted: formatBRLFromCents(snapshot.confirmedCents || 0),
    reservedCents: Number(snapshot.reservedCents || 0),
    reservedFormatted: formatBRLFromCents(snapshot.reservedCents || 0),
    openCents: Number(snapshot.openCents || 0),
    openFormatted: formatBRLFromCents(snapshot.openCents || 0),
    requestCount: Number(snapshot.requestCount || 0),
    status: snapshot.status || 'open',
    preview,
    pixAvailable,
    pixUnavailableReason,
    maskedKey: creditorProfile?.pixMaskedKey || null,
    keyTypeLabel: creditorProfile?.pixKeyTypeLabel || null,
    city: creditorProfile?.pixCity || null,
    creditorName: creditorProfile?.ownerName || creditorRecord?.name || creditorRecord?.email || 'quem vai receber',
    qrSupported: !!QRCode
  });
});

app.post('/shared-debts/monthly-settlements/:id/pix', ensureAuthenticated, async (req, res) => {
  const userId = req.user.id;
  const settlementId = Number(req.params.id);

  if (!settlementId) {
    return res.status(400).json({ ok: false, message: 'Não consegui descobrir qual mês você quer acertar por Pix.' });
  }

  const settlementRow = getSharedDebtCardMonthlySettlementRowById(settlementId);
  if (!settlementRow || Number(settlementRow.receiver_user_id || 0) !== Number(userId || 0)) {
    return res.status(404).json({ ok: false, message: 'Essa carteira mensal não apareceu do seu lado por aqui.' });
  }

  const snapshot = getSharedDebtCardMonthlySettlementSnapshotById(settlementId);
  if (!snapshot || !Number(snapshot.requestCount || 0)) {
    return res.status(404).json({ ok: false, message: 'Ainda não encontrei cobranças aceitas para montar esse mês por aqui.' });
  }

  const openCents = Math.max(0, Number(snapshot.openCents || 0));
  if (!openCents) {
    return res.status(409).json({ ok: false, message: 'Esse mês já está sem saldo aberto para um novo Pix agora.' });
  }

  const requestedAmountCents = coerceMoneyValueToCents(req.body.amount_cents ?? req.body.amount ?? req.body.amountCents, openCents);
  if (!requestedAmountCents) {
    return res.status(400).json({ ok: false, message: 'Me conta quanto vai entrar nesse Pix para eu montar o código certinho.' });
  }

  if (requestedAmountCents > openCents) {
    return res.status(409).json({ ok: false, message: `Por aqui, o máximo disponível agora é ${formatBRLFromCents(openCents)}.` });
  }

  const creditorProfile = getUserPixProfile(settlementRow.requester_user_id);
  const creditorRecord = getUserRecord(settlementRow.requester_user_id);
  if (!creditorProfile || !creditorProfile.pixEnabled) {
    return res.status(409).json({ ok: false, message: 'Quem vai receber ainda não deixou um Pix prontinho por aqui.' });
  }

  if (!creditorProfile.pixValid) {
    return res.status(409).json({ ok: false, message: creditorProfile.pixReason || 'Ainda falta um ajuste no Pix de quem vai receber.' });
  }

  try {
    const now = nowIso();
    let intentId = null;
    let txid = null;
    let payload = null;

    db.transaction(() => {
      cancelSharedDebtGeneratedMonthlyIntents(settlementId, userId);

      const insert = db.prepare(`
        INSERT INTO shared_debt_payment_intents (
          settlement_id, requester_user_id, receiver_user_id, month, year, request_kind,
          requested_by_user_id, amount_cents, status, created_at, updated_at, generated_at
        ) VALUES (?, ?, ?, ?, ?, 'card', ?, ?, 'generated', ?, ?, ?)
      `).run(
        settlementId,
        settlementRow.requester_user_id,
        settlementRow.receiver_user_id,
        settlementRow.month,
        settlementRow.year,
        userId,
        requestedAmountCents,
        now,
        now,
        now
      );

      intentId = Number(insert.lastInsertRowid || 0);
      txid = buildSharedDebtCardMonthlyPixTxid(settlementId, intentId);
      payload = buildPixPayload({
        keyType: creditorProfile.pixKeyType,
        keyValue: creditorProfile.pixKeyValue,
        merchantName: creditorProfile.pixMerchantName || creditorProfile.ownerName || creditorRecord?.name,
        merchantCity: creditorProfile.pixCity,
        amountCents: requestedAmountCents,
        txid,
        description: sanitizePixText(`CARTAO ${String(settlementRow.month).padStart(2, '0')}/${settlementRow.year}`, { max: 72 })
      });

      db.prepare(`
        UPDATE shared_debt_payment_intents
        SET pix_payload = ?,
            pix_txid = ?,
            updated_at = ?,
            generated_at = COALESCE(generated_at, ?)
        WHERE id = ?
      `).run(payload, txid, now, now, intentId);
    })();

    const preview = buildSharedDebtCardMonthlyIntentPreview(snapshot, requestedAmountCents);
    const qrDataUrl = QRCode
      ? await QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', margin: 1, width: 320 })
      : null;
    const shareText = buildSharedDebtCardMonthlyPixShareText({
      creditorName: creditorProfile.ownerName || creditorRecord?.name || creditorRecord?.email || 'quem vai receber',
      amountCents: requestedAmountCents,
      month: settlementRow.month,
      year: settlementRow.year,
      payload
    });

    return res.json({
      ok: true,
      settlementId,
      intentId,
      payload,
      txid,
      qrDataUrl,
      qrSupported: !!QRCode,
      amountCents: requestedAmountCents,
      amountFormatted: formatBRLFromCents(requestedAmountCents),
      creditorName: creditorProfile.ownerName || creditorRecord?.name || creditorRecord?.email || 'Quem vai receber',
      maskedKey: creditorProfile.pixMaskedKey,
      keyType: creditorProfile.pixKeyType,
      keyTypeLabel: creditorProfile.pixKeyTypeLabel,
      city: creditorProfile.pixCity,
      shareText,
      keyValue: creditorProfile.pixKeyValue,
      monthLabel: monthLabel(settlementRow.month, settlementRow.year),
      preview,
      settlement: {
        totalAcceptedCents: Number(snapshot.totalAcceptedCents || 0),
        confirmedCents: Number(snapshot.confirmedCents || 0),
        reservedCents: Number(snapshot.reservedCents || 0),
        openCents,
        requestCount: Number(snapshot.requestCount || 0)
      }
    });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error?.message || 'O Pix do mês quase saiu, mas ainda tropeçou num detalhe aqui.' });
  }
});

app.post('/shared-debts/monthly-settlements/:id/report-payment', ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const settlementId = Number(req.params.id);
  const intentId = Number(req.body.intent_id || req.body.intentId || 0);
  const note = String(req.body.note || '').trim() || null;

  if (!settlementId || !intentId) {
    return res.status(400).json({ ok: false, message: 'Ainda falta me dizer qual Pix do mês você acabou de informar.' });
  }

  const settlementRow = getSharedDebtCardMonthlySettlementRowById(settlementId);
  if (!settlementRow || Number(settlementRow.receiver_user_id || 0) !== Number(userId || 0)) {
    return res.status(404).json({ ok: false, message: 'Essa carteira mensal não apareceu do seu lado por aqui.' });
  }

  const intentRow = db.prepare(`
    SELECT *
    FROM shared_debt_payment_intents
    WHERE id = ?
      AND settlement_id = ?
      AND receiver_user_id = ?
      AND request_kind = 'card'
    LIMIT 1
  `).get(intentId, settlementId, userId);

  if (!intentRow) {
    return res.status(404).json({ ok: false, message: 'Não encontrei esse Pix do mês para confirmar o envio agora.' });
  }

  const intentStatus = normalizeSharedDebtPaymentIntentStatus(intentRow.status);
  if (intentStatus === 'reported') {
    return res.status(409).json({ ok: false, message: 'Esse Pix do mês já foi informado e agora só está esperando a confirmação final.' });
  }

  if (intentStatus !== 'generated') {
    return res.status(409).json({ ok: false, message: 'Esse Pix do mês já saiu da fase de aviso por aqui.' });
  }

  const snapshotBefore = getSharedDebtCardMonthlySettlementSnapshotById(settlementId);
  const openCents = Math.max(0, Number(snapshotBefore?.openCents || 0));
  const intentAmountCents = Math.max(0, Number(intentRow.amount_cents || 0));

  if (!openCents) {
    return res.status(409).json({ ok: false, message: 'Esse mês já não tem saldo aberto para receber esse Pix agora.' });
  }

  if (intentAmountCents > openCents) {
    return res.status(409).json({ ok: false, message: `Enquanto você estava por aqui, o saldo do mês mudou. Agora o máximo disponível é ${formatBRLFromCents(openCents)}.` });
  }

  const actor = getUserRecord(userId);
  const actorName = actor?.name || actor?.email || 'Quem vai pagar';
  const now = nowIso();

  db.transaction(() => {
    const result = db.prepare(`
      UPDATE shared_debt_payment_intents
      SET status = 'reported',
          payer_note = ?,
          reported_at = ?,
          updated_at = ?
      WHERE id = ?
        AND settlement_id = ?
        AND receiver_user_id = ?
        AND status = 'generated'
    `).run(note, now, now, intentId, settlementId, userId);

    if (!result.changes) {
      throw new Error('Esse Pix do mês já mudou de estado enquanto você estava por aqui.');
    }

    cancelSharedDebtGeneratedMonthlyIntents(settlementId, userId);

    createNotification({
      userId: settlementRow.requester_user_id,
      type: 'shared_debt_request',
      title: 'Pix do mês informado',
      body: `${actorName} avisou um Pix de ${formatBRLFromCents(intentAmountCents)} para ${monthLabel(settlementRow.month, settlementRow.year)}.${buildNoteSuffix(note)}`,
      href: `/shared-debts?settlement=${settlementId}`,
      relatedType: 'shared_debt_payment_intent',
      relatedId: intentId
    });
  })();

  const snapshotAfter = getSharedDebtCardMonthlySettlementSnapshotById(settlementId);

  return res.json({
    ok: true,
    settlementId,
    message: 'Pronto! Agora é só aguardar a confirmação de quem vai receber.',
    redirectTo: `/shared-debts?settlement=${settlementId}`,
    snapshot: snapshotAfter ? {
      status: snapshotAfter.status,
      totalAcceptedCents: Number(snapshotAfter.totalAcceptedCents || 0),
      confirmedCents: Number(snapshotAfter.confirmedCents || 0),
      reservedCents: Number(snapshotAfter.reservedCents || 0),
      openCents: Number(snapshotAfter.openCents || 0)
    } : null
  });
});

app.post('/shared-debts/monthly-settlements/:id/confirm-payment', ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const settlementId = Number(req.params.id);
  const intentId = Number(req.body.intent_id || req.body.intentId || 0);
  const note = String(req.body.note || '').trim() || null;
  const fallbackRedirect = settlementId ? `/shared-debts?settlement=${settlementId}` : '/shared-debts';

  if (!settlementId || !intentId) {
    setFlash(req, 'error', 'Ainda falta me dizer qual Pix do mês você quer conferir por aqui.');
    return res.redirect(fallbackRedirect);
  }

  const settlementRow = getSharedDebtCardMonthlySettlementRowById(settlementId);
  if (!settlementRow || Number(settlementRow.requester_user_id || 0) !== Number(userId || 0)) {
    setFlash(req, 'error', 'Essa carteira mensal não apareceu do seu lado para confirmar.');
    return res.redirect('/shared-debts');
  }

  const intentRow = db.prepare(`
    SELECT *
    FROM shared_debt_payment_intents
    WHERE id = ?
      AND settlement_id = ?
      AND requester_user_id = ?
      AND request_kind = 'card'
    LIMIT 1
  `).get(intentId, settlementId, userId);

  if (!intentRow) {
    setFlash(req, 'error', 'Não encontrei esse Pix do mês para conferir agora.');
    return res.redirect(fallbackRedirect);
  }

  const intentStatus = normalizeSharedDebtPaymentIntentStatus(intentRow.status);
  if (intentStatus === 'confirmed') {
    setFlash(req, 'info', 'Esse Pix do mês já foi confirmado antes.');
    return res.redirect(fallbackRedirect);
  }

  if (intentStatus === 'rejected') {
    setFlash(req, 'info', 'Esse Pix do mês já foi devolvido para o saldo aberto antes.');
    return res.redirect(fallbackRedirect);
  }

  if (intentStatus !== 'reported') {
    setFlash(req, 'info', 'Esse Pix do mês ainda não foi marcado como pago do outro lado.');
    return res.redirect(fallbackRedirect);
  }

  const snapshotBefore = getSharedDebtCardMonthlySettlementSnapshotById(settlementId);
  if (!snapshotBefore) {
    setFlash(req, 'error', 'Não consegui abrir a carteira desse mês para confirmar o recebimento agora.');
    return res.redirect(fallbackRedirect);
  }

  const preview = buildSharedDebtCardMonthlyIntentPreview(snapshotBefore, intentRow.amount_cents, {
    maxAmountCents: Math.max(0, Number(snapshotBefore.totalAcceptedCents || 0) - Number(snapshotBefore.confirmedCents || 0))
  });

  if (!Number(preview.allocatedCents || 0)) {
    setFlash(req, 'info', 'Enquanto você estava por aqui, esse mês mudou e não sobrou saldo em aberto para esse Pix. Abre a carteira de novo para conferir a foto atual.');
    return res.redirect(fallbackRedirect);
  }

  if (Number(preview.allocatedCents || 0) !== Math.max(0, Number(intentRow.amount_cents || 0))) {
    setFlash(req, 'info', `Enquanto você estava por aqui, o saldo desse mês mudou. Agora esse Pix não encaixa inteiro (${formatBRLFromCents(preview.allocatedCents || 0)} ainda cabem). Melhor gerar um novo retrato antes de confirmar.`);
    return res.redirect(fallbackRedirect);
  }

  const actor = getUserRecord(userId);
  const actorName = actor?.name || actor?.email || 'Quem vai receber';
  const monthText = monthLabel(settlementRow.month, settlementRow.year);
  const now = nowIso();
  const allocationRows = Array.isArray(preview.allocationRows) ? preview.allocationRows.filter((row) => Number(row?.id || 0) && Number(row?.appliedCents || 0) > 0) : [];
  const requestRowById = new Map((Array.isArray(snapshotBefore.requestRows) ? snapshotBefore.requestRows : []).map((row) => [Number(row?.id || 0), row]));
  const insertAllocation = db.prepare(`
    INSERT OR REPLACE INTO shared_debt_payment_allocations (settlement_id, intent_id, request_id, allocated_cents, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const updateRequest = db.prepare(`
    UPDATE shared_debt_requests
    SET amount_paid_cents = ?,
        status = ?,
        payment_marked_at = NULL,
        payment_note = NULL,
        updated_at = ?,
        resolved_at = ?
    WHERE id = ?
      AND requester_user_id = ?
      AND receiver_user_id = ?
      AND COALESCE(request_kind, 'card') = 'card'
  `);
  const updateIntent = db.prepare(`
    UPDATE shared_debt_payment_intents
    SET status = 'confirmed',
        creditor_note = ?,
        confirmed_at = ?,
        updated_at = ?
    WHERE id = ?
      AND settlement_id = ?
      AND requester_user_id = ?
      AND status = 'reported'
  `);

  db.transaction(() => {
    const result = updateIntent.run(note, now, now, intentId, settlementId, userId);
    if (!result.changes) {
      throw new Error('Esse Pix do mês já mudou de estado enquanto você estava por aqui.');
    }

    allocationRows.forEach((allocation) => {
      const requestRow = requestRowById.get(Number(allocation.id || 0)) || null;
      const totalCents = Math.max(0, Number(requestRow?.amount_cents || allocation.totalCents || 0));
      const nextPaidCents = Math.min(totalCents, Math.max(0, Number(allocation.afterPaidCents || 0)));
      const nextPendingCents = Math.max(0, totalCents - nextPaidCents);
      const nextStatus = nextPendingCents <= 0 ? 'settled' : 'accepted';
      const resolvedAt = nextStatus === 'settled'
        ? (requestRow?.resolved_at || now)
        : null;

      insertAllocation.run(settlementId, intentId, allocation.id, Math.max(0, Number(allocation.appliedCents || 0)), now);
      updateRequest.run(
        nextPaidCents,
        nextStatus,
        now,
        resolvedAt,
        allocation.id,
        settlementRow.requester_user_id,
        settlementRow.receiver_user_id
      );

      addSharedDebtEvent({
        requestId: allocation.id,
        actorUserId: userId,
        eventType: nextStatus === 'settled' ? 'settled_via_monthly_pix' : 'partial_payment_confirmed_via_monthly_pix',
        note
      });
    });

    Array.from(new Set(
      allocationRows
        .map((allocation) => requestRowById.get(Number(allocation.id || 0))?.batch_id)
        .map((value) => Number(value || 0))
        .filter(Boolean)
    )).forEach((batchId) => {
      touchSharedDebtBatch(batchId, now);
    });

    createNotification({
      userId: settlementRow.receiver_user_id,
      type: 'shared_debt_request',
      title: 'Pix do mês confirmado',
      body: `${actorName} confirmou o Pix de ${formatBRLFromCents(intentRow.amount_cents)} em ${monthText}. ${buildSharedDebtCardMonthlyIntentResultSummary(preview)}${buildNoteSuffix(note)}`,
      href: `/shared-debts?settlement=${settlementId}`,
      relatedType: 'shared_debt_payment_intent',
      relatedId: intentId
    });
  })();

  const snapshotAfter = getSharedDebtCardMonthlySettlementSnapshotById(settlementId);
  const successPieces = [
    `Recebimento confirmado de ${formatBRLFromCents(intentRow.amount_cents)}.`,
    buildSharedDebtCardMonthlyIntentResultSummary(preview)
  ];
  if (snapshotAfter) {
    successPieces.push(`Agora ainda ficam ${formatBRLFromCents(snapshotAfter.openCents || 0)} em aberto nessa carteira.`);
  }
  setFlash(req, 'success', successPieces.join(' '));
  return res.redirect(fallbackRedirect);
});

app.post('/shared-debts/monthly-settlements/:id/reject-payment', ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const settlementId = Number(req.params.id);
  const intentId = Number(req.body.intent_id || req.body.intentId || 0);
  const note = String(req.body.note || '').trim() || null;
  const fallbackRedirect = settlementId ? `/shared-debts?settlement=${settlementId}` : '/shared-debts';

  if (!settlementId || !intentId) {
    setFlash(req, 'error', 'Ainda falta me dizer qual Pix do mês não encaixou por aqui.');
    return res.redirect(fallbackRedirect);
  }

  const settlementRow = getSharedDebtCardMonthlySettlementRowById(settlementId);
  if (!settlementRow || Number(settlementRow.requester_user_id || 0) !== Number(userId || 0)) {
    setFlash(req, 'error', 'Essa carteira mensal não apareceu do seu lado para revisar.');
    return res.redirect('/shared-debts');
  }

  const intentRow = db.prepare(`
    SELECT *
    FROM shared_debt_payment_intents
    WHERE id = ?
      AND settlement_id = ?
      AND requester_user_id = ?
      AND request_kind = 'card'
    LIMIT 1
  `).get(intentId, settlementId, userId);

  if (!intentRow) {
    setFlash(req, 'error', 'Não encontrei esse Pix do mês para revisar agora.');
    return res.redirect(fallbackRedirect);
  }

  const intentStatus = normalizeSharedDebtPaymentIntentStatus(intentRow.status);
  if (intentStatus === 'rejected') {
    setFlash(req, 'info', 'Esse Pix do mês já tinha voltado para o saldo aberto antes.');
    return res.redirect(fallbackRedirect);
  }

  if (intentStatus === 'confirmed') {
    setFlash(req, 'info', 'Esse Pix do mês já foi confirmado antes, então não dá para voltar atrás por aqui.');
    return res.redirect(fallbackRedirect);
  }

  if (intentStatus !== 'reported') {
    setFlash(req, 'info', 'Esse Pix do mês ainda não foi marcado como pago do outro lado.');
    return res.redirect(fallbackRedirect);
  }

  const actor = getUserRecord(userId);
  const actorName = actor?.name || actor?.email || 'Quem vai receber';
  const monthText = monthLabel(settlementRow.month, settlementRow.year);
  const now = nowIso();

  db.transaction(() => {
    const result = db.prepare(`
      UPDATE shared_debt_payment_intents
      SET status = 'rejected',
          creditor_note = ?,
          rejected_at = ?,
          updated_at = ?
      WHERE id = ?
        AND settlement_id = ?
        AND requester_user_id = ?
        AND status = 'reported'
    `).run(note, now, now, intentId, settlementId, userId);

    if (!result.changes) {
      throw new Error('Esse Pix do mês já mudou de estado enquanto você estava por aqui.');
    }

    createNotification({
      userId: settlementRow.receiver_user_id,
      type: 'shared_debt_request',
      title: 'Pix do mês voltou para revisão',
      body: `${actorName} não confirmou o Pix de ${formatBRLFromCents(intentRow.amount_cents)} em ${monthText}. O valor voltou para o saldo aberto dessa carteira.${buildNoteSuffix(note)}`,
      href: `/shared-debts?settlement=${settlementId}`,
      relatedType: 'shared_debt_payment_intent',
      relatedId: intentId
    });
  })();

  const snapshotAfter = getSharedDebtCardMonthlySettlementSnapshotById(settlementId);
  const infoPieces = [
    `Pronto. ${formatBRLFromCents(intentRow.amount_cents)} voltou para o saldo aberto desse mês.`
  ];
  if (snapshotAfter) {
    infoPieces.push(`Agora a carteira mostra ${formatBRLFromCents(snapshotAfter.openCents || 0)} em aberto.`);
  }
  setFlash(req, 'success', infoPieces.join(' '));
  return res.redirect(fallbackRedirect);
});

app.get('/shared-debts/:id/pix', ensureAuthenticated, async (req, res) => {
  const userId = req.user.id;
  const requestId = Number(req.params.id);

  if (!requestId) {
    return res.status(400).json({ ok: false, message: 'Não consegui descobrir qual cobrança avulsa você quer abrir no Pix.' });
  }

  const requestRow = db.prepare(`
    SELECT
      r.*,
      ru.name AS requester_name,
      ru.email AS requester_email,
      uu.name AS receiver_name,
      uu.email AS receiver_email
    FROM shared_debt_requests r
    JOIN users ru ON ru.id = r.requester_user_id
    JOIN users uu ON uu.id = r.receiver_user_id
    WHERE r.id = ?
      AND (r.requester_user_id = ? OR r.receiver_user_id = ?)
    LIMIT 1
  `).get(requestId, userId, userId);

  if (!requestRow) {
    return res.status(404).json({ ok: false, message: 'Essa cobrança avulsa não apareceu por aqui.' });
  }

  if (normalizeSharedDebtRequestKind(requestRow.request_kind) !== 'manual') {
    return res.status(400).json({ ok: false, message: 'Nesta fase, o Pix vive só nas cobranças avulsas.' });
  }

  const status = String(requestRow.status || 'pending').trim().toLowerCase();
  const totalCents = Math.max(0, Number(requestRow.amount_cents || 0));
  const alreadyPaidCents = Math.min(totalCents, Math.max(0, Number(requestRow.amount_paid_cents || (status === 'settled' ? totalCents : 0))));
  const pendingCents = Math.max(0, totalCents - alreadyPaidCents);

  if (!['pending', 'accepted'].includes(status)) {
    return res.status(409).json({ ok: false, message: 'Esse lembrete já saiu da fase de pagamento.' });
  }

  if (requestRow.payment_marked_at) {
    return res.status(409).json({ ok: false, message: 'Esse pagamento já foi marcado como feito e agora só está esperando a confirmação final.' });
  }

  if (!pendingCents) {
    return res.status(409).json({ ok: false, message: 'Esse lembrete já está com o valor fechado por aqui.' });
  }

  const creditorProfile = getUserPixProfile(requestRow.requester_user_id);
  if (!creditorProfile || !creditorProfile.pixEnabled) {
    return res.status(409).json({ ok: false, message: 'Quem vai receber ainda não deixou um Pix prontinho aqui.' });
  }

  if (!creditorProfile.pixValid) {
    return res.status(409).json({ ok: false, message: creditorProfile.pixReason || 'Ainda falta um ajuste no Pix de quem vai receber.' });
  }

  try {
    const txid = buildSharedDebtPixTxid(requestRow.id, Number(requestRow.pix_version || 0));
    const payload = buildPixPayload({
      keyType: creditorProfile.pixKeyType,
      keyValue: creditorProfile.pixKeyValue,
      merchantName: creditorProfile.pixMerchantName || creditorProfile.ownerName || requestRow.requester_name,
      merchantCity: creditorProfile.pixCity,
      amountCents: pendingCents,
      txid,
      description: sanitizePixText(requestRow.description_snapshot, { max: 72 })
    });
    const qrDataUrl = QRCode
      ? await QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', margin: 1, width: 320 })
      : null;
    const shareText = buildManualSharedDebtPixShareText({
      creditorName: creditorProfile.ownerName || requestRow.requester_name || requestRow.requester_email || 'quem vai receber',
      amountCents: pendingCents,
      description: requestRow.description_snapshot,
      payload
    });

    db.prepare(`
      UPDATE shared_debt_requests
      SET last_pix_payload = ?,
          last_pix_txid = ?,
          last_pix_generated_at = ?,
          last_pix_amount_cents = ?
      WHERE id = ?
    `).run(payload, txid, nowIso(), pendingCents, requestId);

    return res.json({
      ok: true,
      requestId,
      payload,
      txid,
      qrDataUrl,
      qrSupported: !!QRCode,
      amountCents: pendingCents,
      amountFormatted: formatBRLFromCents(pendingCents),
      creditorName: creditorProfile.ownerName || requestRow.requester_name || requestRow.requester_email || 'Quem vai receber',
      maskedKey: creditorProfile.pixMaskedKey,
      keyType: creditorProfile.pixKeyType,
      keyTypeLabel: creditorProfile.pixKeyTypeLabel,
      city: creditorProfile.pixCity,
      shareText,
      keyValue: creditorProfile.pixKeyValue,
      description: requestRow.description_snapshot,
      isCreditor: Number(requestRow.requester_user_id || 0) === Number(userId || 0)
    });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error?.message || 'O Pix quase saiu, mas ainda tropeçou num detalhe aqui.' });
  }
});

app.post("/shared-debts/:id/mark-paid", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const requestId = Number(req.params.id);
  const note = String(req.body.note || '').trim() || null;

  if (!requestId) {
    setFlash(req, 'error', 'Ops, essa solicitação não é válida.');
    return res.redirect('/shared-debts');
  }

  const requestRow = db.prepare(`
    SELECT r.*, u.name AS requester_name, u.email AS requester_email
    FROM shared_debt_requests r
    JOIN users u ON u.id = r.requester_user_id
    WHERE r.id = ? AND r.receiver_user_id = ?
    LIMIT 1
  `).get(requestId, userId);

  if (!requestRow) {
    setFlash(req, 'error', 'Ops, não encontrei essa solicitação.');
    return res.redirect('/shared-debts');
  }

  const requestKind = normalizeSharedDebtRequestKind(requestRow.request_kind);
  if (requestKind === 'card') {
    const snapshot = getSharedDebtCardMonthlySettlementSnapshot({
      requesterUserId: requestRow.requester_user_id,
      receiverUserId: requestRow.receiver_user_id,
      month: requestRow.source_due_month,
      year: requestRow.source_due_year
    });
    const redirectHref = snapshot?.id ? `/shared-debts?settlement=${snapshot.id}` : `/shared-debts?request=${requestId}`;
    setFlash(req, 'info', 'Agora o pagamento do cartão anda pela carteira do mês. Abre a competência e usa “Pagar este mês”.');
    return res.redirect(redirectHref);
  }

  if (requestRow.status === 'settled') {
    setFlash(req, 'info', 'Essa cobrança já foi encerrada antes.');
    return res.redirect(`/shared-debts?request=${requestId}`);
  }

  if (requestRow.status !== 'accepted') {
    setFlash(req, 'info', 'Só dá para marcar pagamento em solicitações já aceitas.');
    return res.redirect(`/shared-debts?request=${requestId}`);
  }

  if (requestRow.payment_marked_at) {
    setFlash(req, 'info', 'O pagamento dessa solicitação já foi avisado e agora está esperando confirmação.');
    return res.redirect(`/shared-debts?request=${requestId}`);
  }

  const actor = getUserRecord(userId);
  const actorName = actor?.name || requestRow.receiver_name_snapshot || actor?.email || 'O destinatário';
  const now = nowIso();
  const isManualRequest = requestKind === 'manual';
  const baseBody = `${actorName} avisou que já pagou ${isManualRequest ? 'o lembrete avulso' : 'a cobrança'} de ${formatBRLFromCents(requestRow.amount_cents)} (${requestRow.description_snapshot}).`;
  const body = `${baseBody}${buildNoteSuffix(note)}`;

  db.transaction(() => {
    db.prepare(`
      UPDATE shared_debt_requests
      SET payment_marked_at = ?, payment_note = ?, updated_at = ?
      WHERE id = ? AND receiver_user_id = ? AND status = 'accepted' AND payment_marked_at IS NULL
    `).run(now, note, now, requestId, userId);

    addSharedDebtEvent({ requestId, actorUserId: userId, eventType: 'payment_marked_by_receiver', note });
    touchSharedDebtBatch(requestRow.batch_id, now);

    createNotification({
      userId: requestRow.requester_user_id,
      type: 'shared_debt_request',
      title: isManualRequest ? 'Pagamento do lembrete marcado como feito' : 'Pagamento marcado como feito',
      body,
      href: `/shared-debts?request=${requestId}`,
      relatedType: 'shared_debt_request',
      relatedId: requestId
    });
  })();

  setFlash(req, 'success', 'Pronto! Agora quem enviou a cobrança já pode confirmar o recebimento.');
  return res.redirect(`/shared-debts?request=${requestId}`);
});

app.post("/shared-debts/:id/confirm-receipt", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const requestId = Number(req.params.id);
  const note = String(req.body.note || '').trim() || null;

  if (!requestId) {
    setFlash(req, 'error', 'Ops, essa solicitação não é válida.');
    return res.redirect('/shared-debts');
  }

  const requestRow = db.prepare(`
    SELECT r.*, u.name AS receiver_name, u.email AS receiver_email
    FROM shared_debt_requests r
    JOIN users u ON u.id = r.receiver_user_id
    WHERE r.id = ? AND r.requester_user_id = ?
    LIMIT 1
  `).get(requestId, userId);

  if (!requestRow) {
    setFlash(req, 'error', 'Ops, não encontrei essa solicitação.');
    return res.redirect('/shared-debts');
  }

  if (requestRow.status === 'settled') {
    setFlash(req, 'info', 'Essa cobrança já foi encerrada antes.');
    return res.redirect(`/shared-debts?request=${requestId}`);
  }

  if (requestRow.status !== 'accepted') {
    setFlash(req, 'info', 'Só dá para encerrar solicitações já aceitas.');
    return res.redirect(`/shared-debts?request=${requestId}`);
  }

  if (!requestRow.payment_marked_at) {
    setFlash(req, 'info', 'Essa cobrança ainda não foi marcada como paga por quem recebeu.');
    return res.redirect(`/shared-debts?request=${requestId}`);
  }

  const actor = getUserRecord(userId);
  const actorName = actor?.name || actor?.email || 'O remetente';
  const now = nowIso();
  const requestKind = normalizeSharedDebtRequestKind(requestRow.request_kind);
  const isManualRequest = requestKind === 'manual';
  const baseBody = `${actorName} confirmou o recebimento ${isManualRequest ? 'do lembrete avulso' : 'da cobrança'} de ${formatBRLFromCents(requestRow.amount_cents)} (${requestRow.description_snapshot}).`;
  const body = `${baseBody}${buildNoteSuffix(note)}`;

  db.transaction(() => {
    db.prepare(`
      UPDATE shared_debt_requests
      SET status = 'settled',
          amount_paid_cents = amount_cents,
          updated_at = ?,
          resolved_at = ?
      WHERE id = ? AND requester_user_id = ? AND status = 'accepted' AND payment_marked_at IS NOT NULL
    `).run(now, now, requestId, userId);

    addSharedDebtEvent({ requestId, actorUserId: userId, eventType: 'settled', note });
    touchSharedDebtBatch(requestRow.batch_id, now);

    createNotification({
      userId: requestRow.receiver_user_id,
      type: 'shared_debt_request',
      title: isManualRequest ? 'Pagamento do lembrete confirmado' : 'Pagamento confirmado',
      body,
      href: `/shared-debts?request=${requestId}`,
      relatedType: 'shared_debt_request',
      relatedId: requestId
    });
  })();

  setFlash(req, 'success', 'Pronto! Recebimento confirmado e cobrança encerrada.');
  return res.redirect(`/shared-debts?request=${requestId}`);
});


app.post('/shared-debts/bulk/mark-paid', ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const note = String(req.body.note || '').trim() || null;
  const requestIds = parseSharedDebtRequestIds(req.body.request_ids || req.body.requestIds || req.body.request_id);
  const fallbackRedirect = redirectBackOr(req, '/shared-debts');

  if (!requestIds.length) {
    setFlash(req, 'error', 'Nenhuma cobrança válida foi escolhida para marcar como paga.');
    return res.redirect(fallbackRedirect);
  }

  const placeholders = requestIds.map(() => '?').join(', ');
  const rows = db.prepare(`
    SELECT r.*, u.name AS requester_name, u.email AS requester_email
    FROM shared_debt_requests r
    JOIN users u ON u.id = r.requester_user_id
    WHERE r.id IN (${placeholders})
      AND r.receiver_user_id = ?
      AND r.status = 'accepted'
      AND r.payment_marked_at IS NULL
    ORDER BY COALESCE(r.source_due_year, 0) DESC, COALESCE(r.source_due_month, 0) DESC, r.id ASC
  `).all(...requestIds, userId);

  if (!rows.length) {
    setFlash(req, 'info', 'Não achei cobranças desse grupo esperando marcação de pagamento.');
    return res.redirect(fallbackRedirect);
  }

  const actor = getUserRecord(userId);
  const actorName = actor?.name || actor?.email || 'O destinatário';
  const now = nowIso();
  const updateStmt = db.prepare(`
    UPDATE shared_debt_requests
    SET payment_marked_at = ?, payment_note = ?, updated_at = ?
    WHERE id = ? AND receiver_user_id = ? AND status = 'accepted' AND payment_marked_at IS NULL
  `);

  db.transaction(() => {
    rows.forEach((row) => {
      updateStmt.run(now, note, now, row.id, userId);
      addSharedDebtEvent({ requestId: row.id, actorUserId: userId, eventType: 'payment_marked_by_receiver', note });
    });

    groupSharedDebtRowsByBatch(rows).forEach((group) => {
      const periodLabel = buildSharedDebtBulkPeriodLabel(group.rows);
      if (group.batchId) touchSharedDebtBatch(group.batchId, now);

      const chargeCountLabel = formatCountLabel(group.rows.length, 'cobrança', 'cobranças');
      const bodyBase = `${actorName} avisou o pagamento de ${chargeCountLabel}` +
        `${periodLabel ? ` no período ${periodLabel}` : ''}, somando ${formatBRLFromCents(group.totalCents)}.`;
      const body = `${bodyBase}${buildNoteSuffix(note)}`;
      const firstRow = group.rows[0];

      createNotification({
        userId: firstRow.requester_user_id,
        type: group.batchId ? 'shared_debt_batch' : 'shared_debt_request',
        title: group.rows.length > 1 ? 'Pagamentos marcados como feitos' : 'Pagamento marcado como feito',
        body,
        href: group.batchId ? `/shared-debts?batch=${group.batchId}` : `/shared-debts?request=${firstRow.id}`,
        relatedType: group.batchId ? 'shared_debt_batch' : 'shared_debt_request',
        relatedId: group.batchId || firstRow.id
      });
    });
  })();

  setFlash(req, 'success', `Pronto! ${formatCountLabel(rows.length, 'cobrança foi marcada como paga', 'cobranças foram marcadas como pagas')} de uma vez.`);
  return res.redirect(fallbackRedirect);
});

app.post('/shared-debts/bulk/confirm-receipt', ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const note = String(req.body.note || '').trim() || null;
  const requestIds = parseSharedDebtRequestIds(req.body.request_ids || req.body.requestIds || req.body.request_id);
  const fallbackRedirect = redirectBackOr(req, '/shared-debts');

  if (!requestIds.length) {
    setFlash(req, 'error', 'Nenhuma cobrança válida foi escolhida para confirmar o recebimento.');
    return res.redirect(fallbackRedirect);
  }

  const placeholders = requestIds.map(() => '?').join(', ');
  const rows = db.prepare(`
    SELECT r.*, u.name AS receiver_name, u.email AS receiver_email
    FROM shared_debt_requests r
    JOIN users u ON u.id = r.receiver_user_id
    WHERE r.id IN (${placeholders})
      AND r.requester_user_id = ?
      AND r.status = 'accepted'
      AND r.payment_marked_at IS NOT NULL
    ORDER BY COALESCE(r.source_due_year, 0) DESC, COALESCE(r.source_due_month, 0) DESC, r.id ASC
  `).all(...requestIds, userId);

  if (!rows.length) {
    setFlash(req, 'info', 'Não achei cobranças desse grupo esperando confirmação de recebimento.');
    return res.redirect(fallbackRedirect);
  }

  const actor = getUserRecord(userId);
  const actorName = actor?.name || actor?.email || 'O remetente';
  const now = nowIso();
  const updateStmt = db.prepare(`
    UPDATE shared_debt_requests
    SET status = 'settled', updated_at = ?, resolved_at = ?
    WHERE id = ? AND requester_user_id = ? AND status = 'accepted' AND payment_marked_at IS NOT NULL
  `);

  db.transaction(() => {
    rows.forEach((row) => {
      updateStmt.run(now, now, row.id, userId);
      addSharedDebtEvent({ requestId: row.id, actorUserId: userId, eventType: 'settled', note });
    });

    groupSharedDebtRowsByBatch(rows).forEach((group) => {
      const periodLabel = buildSharedDebtBulkPeriodLabel(group.rows);
      if (group.batchId) touchSharedDebtBatch(group.batchId, now);

      const chargeCountLabel = formatCountLabel(group.rows.length, 'cobrança', 'cobranças');
      const bodyBase = `${actorName} confirmou o recebimento de ${chargeCountLabel}` +
        `${periodLabel ? ` no período ${periodLabel}` : ''}, somando ${formatBRLFromCents(group.totalCents)}.`;
      const body = `${bodyBase}${buildNoteSuffix(note)}`;
      const firstRow = group.rows[0];

      createNotification({
        userId: firstRow.receiver_user_id,
        type: group.batchId ? 'shared_debt_batch' : 'shared_debt_request',
        title: group.rows.length > 1 ? 'Pagamentos confirmados' : 'Pagamento confirmado',
        body,
        href: group.batchId ? `/shared-debts?batch=${group.batchId}` : `/shared-debts?request=${firstRow.id}`,
        relatedType: group.batchId ? 'shared_debt_batch' : 'shared_debt_request',
        relatedId: group.batchId || firstRow.id
      });
    });
  })();

  setFlash(req, 'success', `Pronto! ${formatCountLabel(rows.length, 'cobrança foi encerrada', 'cobranças foram encerradas')} de uma vez.`);
  return res.redirect(fallbackRedirect);
});


app.post('/push/subscribe', ensureAuthenticated, (req, res) => {
  if (!isPushConfigured()) {
    return res.status(503).json({ ok: false, error: 'push_unavailable' });
  }

  const subscription = req.body?.subscription;
  const endpoint = String(subscription?.endpoint || '').trim();

  if (!endpoint) {
    return res.status(400).json({ ok: false, error: 'invalid_subscription' });
  }

  try {
    upsertPushSubscription(req.user.id, subscription);
    return res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao salvar subscription de push:', err);
    return res.status(500).json({ ok: false, error: 'subscription_save_failed' });
  }
});

app.post('/push/unsubscribe', ensureAuthenticated, (req, res) => {
  const endpoint = String(req.body?.endpoint || '').trim();

  if (!endpoint) {
    return res.status(400).json({ ok: false, error: 'invalid_endpoint' });
  }

  try {
    removePushSubscriptionForUser(req.user.id, endpoint);
    return res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao remover subscription de push:', err);
    return res.status(500).json({ ok: false, error: 'subscription_remove_failed' });
  }
});

app.get("/notifications", ensureAuthenticated, (req, res) => {
  return res.redirect('/geral');
});

app.post("/notifications/read-all", ensureAuthenticated, (req, res) => {
  markAllNotificationsAsRead(req.user.id);
  setFlash(req, 'success', 'Pronto! Seus avisos já foram marcados como lidos.');
  return res.redirect(redirectBackOr(req, '/geral'));
});

app.post('/notifications/clear-read', ensureAuthenticated, (req, res) => {
  const result = clearReadNotifications(req.user.id);
  const removedCount = Number(result?.changes || 0);

  if (removedCount > 0) {
    setFlash(req, 'success', `Tudo certo! ${formatCountLabel(removedCount, 'aviso antigo saiu da lista', 'avisos antigos saíram da lista')}.`);
  } else {
    setFlash(req, 'info', 'Por enquanto não há aviso antigo para limpar.');
  }

  return res.redirect(redirectBackOr(req, '/geral'));
});

app.post("/notifications/:id/read", ensureAuthenticated, (req, res) => {
  const notificationId = Number(req.params.id);

  if (!notificationId) {
    setFlash(req, 'error', 'Ops, esse aviso não é válido.');
    return res.redirect('/geral');
  }

  const notification = getNotificationForUser(notificationId, req.user.id);
  if (!notification) {
    setFlash(req, 'error', 'Ops, não encontrei esse aviso.');
    return res.redirect('/geral');
  }

  markNotificationAsRead(notificationId, req.user.id);
  return res.redirect(notification.href || '/geral');
});

app.get("/notifications/:id/open", ensureAuthenticated, (req, res) => {
  const notificationId = Number(req.params.id);

  if (!notificationId) {
    setFlash(req, 'error', 'Ops, esse aviso não é válido.');
    return res.redirect('/geral');
  }

  const notification = getNotificationForUser(notificationId, req.user.id);
  if (!notification) {
    setFlash(req, 'error', 'Ops, não encontrei esse aviso.');
    return res.redirect('/geral');
  }

  markNotificationAsRead(notificationId, req.user.id);

  const targetHref = String(notification.href || '').trim();
  if (targetHref && targetHref.startsWith('/')) {
    return res.redirect(targetHref);
  }

  return res.redirect('/geral');
});

// People
app.get("/people", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const people = getPeopleAll(userId);
  const pendingFriendRequests = getPendingReceivedFriendRequests(userId);
  const highlightedFriendRequestId = Number(req.query.friendRequest || req.query.friend_request || 0) || null;

  res.render("people", {
    people,
    pendingFriendRequests,
    highlightedFriendRequestId,
    pixStateOptions: PIX_STATE_OPTIONS,
    pixCitySuggestionsByState: PIX_CITY_SUGGESTIONS_BY_STATE,
    pixAllCitySuggestions: PIX_ALL_CITY_SUGGESTIONS,
    pixDefaultState: PIX_DEFAULT_STATE,
    pixDefaultCity: PIX_DEFAULT_CITY,
    title: "Amigos"
  });
});

app.post("/people", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const name = String(req.body.name || "").trim();
  const phone = String(req.body.phone || "").trim().replace(/\D/g, "");
  const email = normalizeEmail(req.body.email);
  const id = Number(req.body.id) || null;
  const duplicatedPerson = findPersonByNameForUser(userId, name, id);
  const pixEnabled = normalizePixToggle(req.body.pix_enabled);
  const pixKeyType = normalizePixKeyType(req.body.pix_key_type);
  const pixKeyValue = normalizePixKeyValue(pixKeyType, req.body.pix_key_value);
  const pixStateRaw = normalizePixState(req.body.pix_state) || guessPixStateByCity(req.body.pix_city) || null;
  const pixCityRaw = String(req.body.pix_city || '').trim();
  const pixLabelRaw = String(req.body.pix_label || '').trim();
  const pixProfile = validatePixProfile({
    enabled: pixEnabled,
    keyType: pixKeyType,
    keyValue: pixKeyValue,
    city: pixCityRaw,
    state: pixStateRaw,
    label: pixLabelRaw,
    name: name || email || 'ORGANIZAPAY'
  });
  const storedPixProfile = pixEnabled
    ? pixProfile
    : { keyType: null, keyValue: null, city: null, state: null, label: null };

  if (!name) {
    setFlash(req, 'error', 'Me dá pelo menos o nome dessa pessoa para eu conseguir salvar direitinho.');
    return res.redirect('/people');
  }

  if (duplicatedPerson) {
    setFlash(req, 'error', 'Já existe alguém com esse nome na sua lista. Se forem xará, vale colocar um apelido para não virar bagunça.');
    return res.redirect('/people');
  }

  if (pixEnabled && !pixProfile.valid) {
    setFlash(req, 'error', pixProfile.reason || 'Faltou acertar um detalhe do Pix antes de salvar.');
    return res.redirect('/people');
  }

  const pixUpdatedAt = pixEnabled ? nowIso() : null;

  if (id) {
    db.prepare(`
      UPDATE people
      SET name = ?,
          phone = ?,
          email = ?,
          pix_enabled = ?,
          pix_key_type = ?,
          pix_key_value = ?,
          pix_city = ?,
          pix_state = ?,
          pix_label = ?,
          pix_updated_at = ?
      WHERE id = ? AND user_id = ?
    `).run(
      name,
      phone,
      email,
      pixEnabled ? 1 : 0,
      storedPixProfile.keyType,
      storedPixProfile.keyValue || null,
      storedPixProfile.city || null,
      storedPixProfile.state || guessPixStateByCity(storedPixProfile.city) || null,
      storedPixProfile.label || null,
      pixUpdatedAt,
      id,
      userId
    );
  } else {
    db.prepare(`
      INSERT INTO people(
        user_id, name, phone, email, pix_enabled, pix_key_type,
        pix_key_value, pix_city, pix_state, pix_label, pix_updated_at, active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      userId,
      name,
      phone,
      email,
      pixEnabled ? 1 : 0,
      storedPixProfile.keyType,
      storedPixProfile.keyValue || null,
      storedPixProfile.city || null,
      storedPixProfile.state || guessPixStateByCity(storedPixProfile.city) || null,
      storedPixProfile.label || null,
      pixUpdatedAt
    );
  }

  setFlash(req, 'success', pixEnabled
    ? 'Pessoa salva com Pix pronto para entrar em cena quando precisar.'
    : 'Pessoa salva direitinho por aqui.');
  return res.redirect('/people');
});

app.post('/people/:id/send-friend-request', ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const personId = Number(req.params.id);
  const person = db.prepare(`
    SELECT id, name, email, COALESCE(active, 1) AS active, COALESCE(is_owner, 0) AS is_owner
    FROM people
    WHERE id = ? AND user_id = ?
    LIMIT 1
  `).get(personId, userId);

  if (!person) {
    setFlash(req, 'error', 'Não encontrei essa pessoa por aqui.');
    return res.redirect('/people');
  }

  if (Number(person.is_owner || 0) !== 0) {
    setFlash(req, 'info', 'Você já está no seu próprio time. Esse pedido não precisa existir.');
    return res.redirect('/people');
  }

  if (Number(person.active || 0) === 0) {
    setFlash(req, 'info', 'Reative essa pessoa antes de mandar um pedido de amizade.');
    return res.redirect('/people');
  }

  const resolved = getResolvedAppUserForPerson(userId, personId);
  if (!resolved?.linked_user_id) {
    setFlash(req, 'info', 'Essa pessoa ainda não apareceu como usuária do OrganizaPay. Quando isso rolar, o botão vem pra festa.');
    return res.redirect('/people');
  }

  if (Number(resolved.linked_user_id || 0) === Number(userId || 0)) {
    setFlash(req, 'info', 'Pedido para você mesmo não entra na fila.');
    return res.redirect('/people');
  }

  if (getActiveFriendshipBetweenUsers(userId, resolved.linked_user_id)) {
    setFlash(req, 'success', `${person.name} já está com amizade ativa por aqui.`);
    return res.redirect('/people');
  }

  const incomingPending = getPendingFriendRequestBetweenUsers(resolved.linked_user_id, userId);
  if (incomingPending) {
    setFlash(req, 'info', 'Boa! Essa pessoa já te mandou um pedido. É só aceitar para liberar as cobranças automáticas dos dois lados.');
    return res.redirect(`/people?friendRequest=${incomingPending.id}`);
  }

  const outgoingPending = getPendingFriendRequestBetweenUsers(userId, resolved.linked_user_id);
  if (outgoingPending) {
    setFlash(req, 'info', 'Esse pedido já foi enviado e está só esperando o outro lado dar o ok.');
    return res.redirect('/people');
  }

  const requester = getUserRecord(userId);
  const targetUser = getUserRecord(resolved.linked_user_id);
  const now = nowIso();
  const info = db.prepare(`
    INSERT INTO friend_requests (
      requester_user_id, target_user_id, source_person_id,
      requester_name_snapshot, requester_email_snapshot,
      target_name_snapshot, target_email_snapshot,
      status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(
    userId,
    resolved.linked_user_id,
    personId,
    requester?.name || getOwnerPerson(userId)?.name || requester?.email || 'Um usuário',
    normalizeEmail(requester?.email),
    targetUser?.name || resolved.linked_user_name || person.name,
    normalizeEmail(targetUser?.email || resolved.linked_user_email || person.email),
    now,
    now
  );

  const requestId = Number(info.lastInsertRowid || 0);
  createNotification({
    userId: resolved.linked_user_id,
    type: 'friend_request',
    title: 'Chegou um pedido de amizade',
    body: `${requester?.name || person.name || 'Alguém'} quer virar seu contato de confiança no OrganizaPay.`,
    href: `/people?friendRequest=${requestId}`,
    relatedType: 'friend_request',
    relatedId: requestId
  });

  setFlash(req, 'success', `Pedido enviado para ${person.name}. Agora é só esperar o outro lado dar o joinha.`);
  return res.redirect('/people');
});

app.post('/friend-requests/:id/cancel', ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const requestId = Number(req.params.id);
  const requestRow = getPendingFriendRequestById(requestId);

  if (!requestRow || Number(requestRow.requester_user_id || 0) !== userId || normalizeFriendRequestStatus(requestRow.status) !== 'pending') {
    setFlash(req, 'info', 'Esse pedido já andou ou não existe mais.');
    return res.redirect('/people');
  }

  const now = nowIso();
  db.prepare(`
    UPDATE friend_requests
    SET status = 'cancelled_by_requester', updated_at = ?, responded_at = COALESCE(responded_at, ?), resolved_at = COALESCE(resolved_at, ?)
    WHERE id = ? AND requester_user_id = ? AND status = 'pending'
  `).run(now, now, now, requestId, userId);

  setFlash(req, 'success', 'Pedido cancelado. Nada foi criado entre vocês.');
  return res.redirect('/people');
});

app.post('/friend-requests/:id/respond', ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const requestId = Number(req.params.id);
  const action = String(req.body.action || '').trim().toLowerCase();
  const requestRow = getPendingFriendRequestById(requestId);

  if (!requestRow || Number(requestRow.target_user_id || 0) !== userId || normalizeFriendRequestStatus(requestRow.status) !== 'pending') {
    setFlash(req, 'info', 'Esse pedido já mudou de estado ou não existe mais.');
    return res.redirect('/people');
  }

  if (!['accept', 'reject'].includes(action)) {
    setFlash(req, 'error', 'Não entendi a resposta desse pedido.');
    return res.redirect('/people');
  }

  const now = nowIso();
  const requesterUser = getUserRecord(requestRow.requester_user_id);
  const targetUser = getUserRecord(requestRow.target_user_id);

  if (action === 'accept') {
    db.transaction(() => {
      db.prepare(`
        UPDATE friend_requests
        SET status = 'accepted', updated_at = ?, responded_at = COALESCE(responded_at, ?), resolved_at = COALESCE(resolved_at, ?)
        WHERE id = ? AND target_user_id = ? AND status = 'pending'
      `).run(now, now, now, requestId, userId);

      closeOtherPendingFriendRequestsBetweenUsers(requestRow.requester_user_id, requestRow.target_user_id, requestId, 'merged');
      const friendship = upsertFriendship({
        userAId: requestRow.requester_user_id,
        userBId: requestRow.target_user_id,
        status: 'active',
        originRequestId: requestId,
        source: 'friend_request'
      });

      if (Number(requestRow.source_person_id || 0) > 0) {
        upsertPersonAppLink({
          ownerUserId: requestRow.requester_user_id,
          personId: requestRow.source_person_id,
          linkedUserId: requestRow.target_user_id,
          matchKind: 'friendship'
        });
      }

      ensureFriendPersonForUser({
        ownerUserId: requestRow.target_user_id,
        remoteUserId: requestRow.requester_user_id,
        preferredName: requestRow.requester_name_snapshot || requesterUser?.name || requesterUser?.email,
        preferredEmail: requestRow.requester_email_snapshot || requesterUser?.email
      });

      createNotification({
        userId: requestRow.requester_user_id,
        type: 'friendship_update',
        title: 'Amizade ativada',
        body: `${targetUser?.name || 'Essa pessoa'} aceitou seu pedido. Agora vocês já podem trocar cobranças automáticas com mais privacidade.`,
        href: '/people',
        relatedType: 'friend_request',
        relatedId: requestId
      });
    })();

    setFlash(req, 'success', `${requestRow.requester_name || 'Pedido aceito'} entrou para sua rede. Cobranças automáticas entre vocês já estão liberadas.`);
    return res.redirect('/people');
  }

  db.prepare(`
    UPDATE friend_requests
    SET status = 'rejected', updated_at = ?, responded_at = COALESCE(responded_at, ?), resolved_at = COALESCE(resolved_at, ?)
    WHERE id = ? AND target_user_id = ? AND status = 'pending'
  `).run(now, now, now, requestId, userId);

  createNotification({
    userId: requestRow.requester_user_id,
    type: 'friendship_update',
    title: 'Pedido não aceito',
    body: `${targetUser?.name || 'Essa pessoa'} preferiu não ativar a amizade agora.`,
    href: '/people',
    relatedType: 'friend_request',
    relatedId: requestId
  });

  setFlash(req, 'success', 'Pedido recusado. Nada mudou nas cobranças e a vida segue leve.');
  return res.redirect('/people');
});

app.post('/people/:id/unfriend', ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const personId = Number(req.params.id);
  const person = db.prepare(`
    SELECT id, name
    FROM people
    WHERE id = ? AND user_id = ?
    LIMIT 1
  `).get(personId, userId);

  if (!person) {
    setFlash(req, 'error', 'Não encontrei essa pessoa por aqui.');
    return res.redirect('/people');
  }

  const resolved = getResolvedAppUserForPerson(userId, personId);
  if (!resolved?.linked_user_id) {
    setFlash(req, 'info', 'Esse contato não está ligado a um usuário do app.');
    return res.redirect('/people');
  }

  const friendship = getActiveFriendshipBetweenUsers(userId, resolved.linked_user_id);
  if (!friendship) {
    setFlash(req, 'info', 'A amizade já não estava ativa.');
    return res.redirect('/people');
  }

  const now = nowIso();
  db.prepare(`
    UPDATE friendships
    SET status = 'ended', updated_at = ?, ended_at = ?, ended_by_user_id = ?
    WHERE id = ? AND status = 'active'
  `).run(now, now, userId, friendship.id);

  closeOtherPendingFriendRequestsBetweenUsers(userId, resolved.linked_user_id, null, 'merged');

  const actor = getUserRecord(userId);
  createNotification({
    userId: resolved.linked_user_id,
    type: 'friendship_update',
    title: 'Amizade desfeita',
    body: `${actor?.name || 'Um contato'} desfez a amizade no OrganizaPay. O histórico continua, mas novos envios automáticos param por aqui.`,
    href: '/people',
    relatedType: 'friendship',
    relatedId: friendship.id
  });

  setFlash(req, 'success', `Amizade com ${person.name} desfeita. O histórico ficou salvo, mas novos envios automáticos param daqui pra frente.`);
  return res.redirect('/people');
});

app.post("/people/:id/toggle", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  db.prepare("UPDATE people SET active = CASE active WHEN 1 THEN 0 ELSE 1 END WHERE id = ? AND user_id = ?")
    .run(Number(req.params.id), userId);
  res.redirect("/people");
});

app.post("/people/:id/delete", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const personId = Number(req.params.id);
  const person = db.prepare("SELECT id, name FROM people WHERE id = ? AND user_id = ?").get(personId, userId);

  if (!person) {
    setFlash(req, "error", "Pessoa não encontrada.");
    return res.redirect("/people");
  }

  const usage = db.prepare(`
    SELECT
      EXISTS(SELECT 1 FROM allocations WHERE user_id = ? AND person_id = ?) AS has_allocations,
      EXISTS(SELECT 1 FROM person_payments WHERE user_id = ? AND person_id = ?) AS has_payments,
      EXISTS(SELECT 1 FROM person_app_links WHERE owner_user_id = ? AND person_id = ?) AS has_app_link,
      EXISTS(SELECT 1 FROM friend_requests WHERE requester_user_id = ? AND source_person_id = ?) AS has_friend_history
  `).get(userId, personId, userId, personId, userId, personId, userId, personId);

  if (usage.has_allocations || usage.has_payments || usage.has_app_link || usage.has_friend_history) {
    setFlash(req, "info", `Não foi possível excluir ${person.name} porque já existe histórico ou vínculo ligado a essa pessoa. Use Desativar para tirar de cena sem perder o passado.`);
    return res.redirect("/people");
  }

  db.prepare("DELETE FROM people WHERE id = ? AND user_id = ?").run(personId, userId);
  setFlash(req, "success", `${person.name} foi removido(a) com sucesso.`);
  return res.redirect("/people");
});

// Cards
app.get("/cards", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  res.render("cards", { cards: getCards(userId) });
});

app.post("/cards", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const name = (req.body.name || "").trim();
  const dueDay = normalizeDayNumber(req.body.due_day);
  const closeDay = normalizeDayNumber(req.body.close_day);

  if (!name) {
    setFlash(req, 'error', 'Me conta o nome do cartão antes de salvar.');
    return res.redirect("/cards");
  }

  if (findCardByNameForUser(userId, name)) {
    setFlash(req, 'error', 'Esse cartão já está na carteira. Se quiser diferenciar, dá para usar um apelido.');
    return res.redirect("/cards");
  }

  db.prepare("INSERT INTO cards(user_id, name, due_day, close_day, holiday_scope) VALUES (?, ?, ?, ?, ?)")
    .run(userId, name, dueDay, closeDay, "BR");

  setFlash(req, 'success', `${name} entrou na carteira direitinho.`);
  return res.redirect("/cards");
});

app.post("/cards/:id/update", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  db.prepare("UPDATE cards SET due_day = ?, close_day = ? WHERE id = ? AND user_id = ?")
    .run(normalizeDayNumber(req.body.due_day), normalizeDayNumber(req.body.close_day), Number(req.params.id), userId);
  res.redirect("/cards");
});

app.post("/cards/:id/toggle", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const cardId = Number(req.params.id);
  const card = db.prepare("SELECT id, name, COALESCE(active, 1) AS active FROM cards WHERE id = ? AND user_id = ?").get(cardId, userId);

  if (!card) {
    setFlash(req, "error", "Cartão não encontrado.");
    return res.redirect("/cards");
  }

  db.prepare(`
    UPDATE cards
    SET active = CASE COALESCE(active, 1) WHEN 1 THEN 0 ELSE 1 END
    WHERE id = ? AND user_id = ?
  `).run(cardId, userId);

  const becameActive = card.active !== 1;
  setFlash(
    req,
    "success",
    becameActive
      ? `${card.name} foi reativado e voltou a aparecer nos novos lançamentos.`
      : `${card.name} foi desativado e ficará oculto em novos lançamentos/importações, sem afetar o histórico.`
  );
  return res.redirect("/cards");
});

app.post("/cards/:id/delete", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const cardId = Number(req.params.id);
  const card = db.prepare("SELECT id, name FROM cards WHERE id = ? AND user_id = ?").get(cardId, userId);

  if (!card) {
    setFlash(req, "error", "Cartão não encontrado.");
    return res.redirect("/cards");
  }

  const usage = db.prepare(`
    SELECT
      EXISTS(SELECT 1 FROM transactions WHERE user_id = ? AND card_id = ?) AS has_transactions,
      EXISTS(SELECT 1 FROM card_statements WHERE user_id = ? AND card_id = ?) AS has_statements
  `).get(userId, cardId, userId, cardId);

  if (usage.has_transactions || usage.has_statements) {
    setFlash(req, "info", `Não foi possível excluir ${card.name} porque já existe histórico vinculado. Use Desativar para ocultar o cartão sem perder dados passados.`);
    return res.redirect("/cards");
  }

  db.transaction(() => {
    db.prepare("DELETE FROM imports WHERE user_id = ? AND card_id = ?").run(userId, cardId);
    db.prepare("DELETE FROM cards WHERE id = ? AND user_id = ?").run(cardId, userId);
  })();

  setFlash(req, "success", `${card.name} foi excluído com sucesso.`);
  return res.redirect("/cards");
});

function normalizeImportDuplicateText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeImportCardNumber(value) {
  return String(value || "")
    .replace(/\s+/g, "")
    .trim();
}

function buildImportDuplicateFingerprint({ cardId, month, year, txnDate, description, amountCents, cardNumber }) {
  return [
    Number(cardId) || 0,
    Number(year) || 0,
    Number(month) || 0,
    String(txnDate || "").trim(),
    normalizeImportDuplicateText(description),
    Number(amountCents) || 0,
    normalizeImportCardNumber(cardNumber)
  ].join("::");
}

function buildImportDuplicateGroupItem({ txnDate, description, amountCents, cardNumber, count = 0, existingCount = 0, csvCount = 0 }) {
  return {
    txnDate: String(txnDate || '').trim() || null,
    description: String(description || '').trim() || '(sem descrição)',
    amountCents: Number(amountCents) || 0,
    cardNumber: normalizeImportCardNumber(cardNumber) || null,
    count: Math.max(0, Number(count || 0)),
    existingCount: Math.max(0, Number(existingCount || 0)),
    csvCount: Math.max(0, Number(csvCount || 0))
  };
}

function compareImportDuplicateGroupItems(a, b) {
  const dateA = String(a?.txnDate || '');
  const dateB = String(b?.txnDate || '');
  if (dateA !== dateB) return dateA.localeCompare(dateB);

  const descA = normalizeImportDuplicateText(a?.description);
  const descB = normalizeImportDuplicateText(b?.description);
  if (descA !== descB) return descA.localeCompare(descB, 'pt-BR');

  const amountA = Number(a?.amountCents || 0);
  const amountB = Number(b?.amountCents || 0);
  if (amountA !== amountB) return amountB - amountA;

  return normalizeImportCardNumber(a?.cardNumber).localeCompare(normalizeImportCardNumber(b?.cardNumber));
}

function getExistingImportFingerprintCounts(userId, cardId, month, year) {
  const rows = db.prepare(`
    SELECT t.txn_date, t.description, t.amount_cents, t.card_number
    FROM transactions t
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    WHERE t.user_id = ?
      AND t.card_id = ?
      AND ${EFFECTIVE_DUE_MONTH_SQL} = ?
      AND ${EFFECTIVE_DUE_YEAR_SQL} = ?
  `).all(userId, cardId, month, year);

  const counts = new Map();
  for (const row of rows) {
    const fingerprint = buildImportDuplicateFingerprint({
      cardId,
      month,
      year,
      txnDate: row.txn_date || '',
      description: row.description,
      amountCents: row.amount_cents,
      cardNumber: row.card_number
    });
    counts.set(fingerprint, (counts.get(fingerprint) || 0) + 1);
  }

  return counts;
}

function buildImportFeedbackMessage(month, year, importedCount, skippedExistingCount, repeatedCsvGroupCount) {
  const period = monthLabel(month, year);
  const skippedCount = Math.max(0, Number(skippedExistingCount || 0));
  const repeatedCount = Math.max(0, Number(repeatedCsvGroupCount || 0));

  if (importedCount > 0 && skippedCount === 0 && repeatedCount === 0) {
    return {
      type: "success",
      message: importedCount === 1
        ? `1 compra pousou em ${period}. Tudo certinho por aqui.`
        : `${importedCount} compras pousaram em ${period}. Tudo certinho por aqui.`
    };
  }

  const parts = [];
  if (importedCount > 0) {
    parts.push(importedCount === 1 ? '1 compra entrou' : `${importedCount} compras entraram`);
  }
  if (skippedCount > 0) {
    parts.push(skippedCount === 1
      ? '1 linha ficou de fora por prudência, porque já havia uma igualzinha por aqui'
      : `${skippedCount} linhas ficaram de fora por prudência, porque já havia iguais por aqui`);
  }
  if (repeatedCount > 0) {
    parts.push(repeatedCount === 1
      ? 'o CSV trouxe 1 grupinho de linhas idênticas e eu deixei passar, porque isso também pode ser compra legítima'
      : `o CSV trouxe ${repeatedCount} grupinhos de linhas idênticas e eu deixei passar, porque isso também pode ser compra legítima`);
  }

  if (importedCount > 0) {
    return {
      type: skippedCount > 0 ? 'info' : 'success',
      message: `Importação concluída em ${period}: ${parts.join('; ')}.`
    };
  }

  return {
    type: 'info',
    message: `Nenhuma compra nova entrou em ${period}. ${parts.join('; ')}.`
  };
}

function buildImportReport(month, year, importedCount, skippedExistingGroups, repeatedCsvGroups) {
  const skippedGroups = Array.isArray(skippedExistingGroups)
    ? skippedExistingGroups.slice().sort(compareImportDuplicateGroupItems)
    : [];
  const repeatedGroups = Array.isArray(repeatedCsvGroups)
    ? repeatedCsvGroups.slice().sort(compareImportDuplicateGroupItems)
    : [];

  return {
    periodLabel: monthLabel(month, year),
    month: Number(month),
    year: Number(year),
    targetHref: `/month/${year}/${month}`,
    importedCount: Math.max(0, Number(importedCount || 0)),
    skippedExistingCount: skippedGroups.reduce((sum, item) => sum + Math.max(0, Number(item.count || 0)), 0),
    repeatedCsvGroupCount: repeatedGroups.length,
    skippedExistingGroups: skippedGroups,
    repeatedCsvGroups: repeatedGroups
  };
}

// Import
app.get("/import", ensureAuthenticated, ensureCanImport, (req, res) => {
  const userId = req.user.id;
  res.render("import", {
    cards: getActiveCards(userId),
    error: null,
    formSeed: res.locals.importFormSeed || null,
    importReport: res.locals.importReport || null
  });
});

app.post("/import", ensureAuthenticated, ensureCanImport, upload.single("csvfile"), (req, res) => {
  const userId = req.user.id;
  const cards = getActiveCards(userId);

  try {
    const cardId = Number(req.body.card_id);
    const month = Number(req.body.month);
    const year = Number(req.body.year);
    const formSeed = { cardId, month, year };

    if (!req.file) throw new Error("Envie um arquivo CSV.");
    if (!cardId) throw new Error("Selecione o cartão.");
    if (!month || month < 1 || month > 12) throw new Error("Mês inválido.");
    if (!year || year < 2000 || year > 2100) throw new Error("Ano inválido.");

    const card = db.prepare("SELECT id, name FROM cards WHERE id = ? AND user_id = ? AND COALESCE(active, 1) = 1").get(cardId, userId);
    if (!card) throw new Error("Cartão inválido ou desativado.");

    const txns = parseCsvByCardName(card.name, req.file.buffer);
    const existingCounts = getExistingImportFingerprintCounts(userId, cardId, month, year);
    const csvCounts = new Map();
    const repeatedCsvGroups = new Map();
    const skippedExistingGroups = new Map();
    const itemsToInsert = [];

    for (const txn of txns) {
      const isoDate = toISOFromBRDate(txn.txn_date) || String(txn.txn_date || "").trim() || null;
      const fingerprint = buildImportDuplicateFingerprint({
        cardId,
        month,
        year,
        txnDate: isoDate,
        description: txn.description,
        amountCents: txn.amount_cents,
        cardNumber: txn.card_number
      });

      const nextCsvCount = (csvCounts.get(fingerprint) || 0) + 1;
      csvCounts.set(fingerprint, nextCsvCount);

      if (nextCsvCount > 1) {
        const repeatedGroup = repeatedCsvGroups.get(fingerprint) || buildImportDuplicateGroupItem({
          txnDate: isoDate,
          description: txn.description,
          amountCents: txn.amount_cents,
          cardNumber: txn.card_number,
          csvCount: nextCsvCount
        });
        repeatedGroup.csvCount = nextCsvCount;
        repeatedCsvGroups.set(fingerprint, repeatedGroup);
      }

      const existingCount = existingCounts.get(fingerprint) || 0;
      if (nextCsvCount <= existingCount) {
        const skippedGroup = skippedExistingGroups.get(fingerprint) || buildImportDuplicateGroupItem({
          txnDate: isoDate,
          description: txn.description,
          amountCents: txn.amount_cents,
          cardNumber: txn.card_number,
          existingCount,
          csvCount: nextCsvCount,
          count: 0
        });
        skippedGroup.count += 1;
        skippedGroup.existingCount = existingCount;
        skippedGroup.csvCount = nextCsvCount;
        skippedExistingGroups.set(fingerprint, skippedGroup);
        continue;
      }

      itemsToInsert.push({
        ...txn,
        isoDate
      });
    }

    const createImportWithTransactions = db.transaction((items) => {
      const info = db.prepare(`
        INSERT INTO imports(user_id, card_id, month, year, created_at, original_filename)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(userId, cardId, month, year, nowIso(), req.file.originalname);

      const insTxn = db.prepare(`
        INSERT INTO transactions(user_id, import_id, card_id, txn_date, description, amount_cents, card_number, raw_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const item of items) {
        insTxn.run(
          userId,
          info.lastInsertRowid,
          cardId,
          item.isoDate || null,
          item.description,
          item.amount_cents,
          item.card_number || null,
          JSON.stringify(item.raw || {}),
          nowIso()
        );
      }
    });

    if (itemsToInsert.length) {
      createImportWithTransactions(itemsToInsert);
    }

    const skippedExistingList = Array.from(skippedExistingGroups.values()).map((group) => ({
      ...group,
      csvCount: csvCounts.get(buildImportDuplicateFingerprint({
        cardId,
        month,
        year,
        txnDate: group.txnDate,
        description: group.description,
        amountCents: group.amountCents,
        cardNumber: group.cardNumber
      })) || group.csvCount || group.count,
      existingCount: group.existingCount || 0
    }));
    const repeatedCsvList = Array.from(repeatedCsvGroups.values());
    const skippedExistingCount = skippedExistingList.reduce((sum, item) => sum + Number(item.count || 0), 0);
    const feedback = buildImportFeedbackMessage(month, year, itemsToInsert.length, skippedExistingCount, repeatedCsvList.length);

    setFlash(req, feedback.type, feedback.message);
    setImportFormSeed(req, formSeed);

    if (skippedExistingCount > 0) {
      setImportReport(req, buildImportReport(month, year, itemsToInsert.length, skippedExistingList, repeatedCsvList));
      return res.redirect("/import");
    }

    setImportReport(req, null);
    if (itemsToInsert.length > 0) {
      return res.redirect(`/month/${year}/${month}`);
    }

    return res.redirect("/import");
  } catch (e) {
    res.status(400).render("import", {
      cards,
      error: e.message || String(e),
      formSeed: {
        cardId: Number(req.body.card_id) || null,
        month: Number(req.body.month) || null,
        year: Number(req.body.year) || null
      },
      importReport: null
    });
  }
});

function buildOrder(sort, dir) {
  const d = (dir || "asc").toLowerCase() === "desc" ? "DESC" : "ASC";
  const sortMap = {
    date: "t.txn_date",
    amount: "t.amount_cents",
    card: "c.name",
    desc: "t.description",
    allocated: "alloc_count",
    number: "t.card_number"
  };
  const col = sortMap[sort] || "t.txn_date";
  if (sort === "date") return `t.txn_date IS NULL ASC, ${col} ${d}, t.id ${d}`;
  return `${col} ${d}, t.id ${d}`;
}

function parseChronologicalOrder(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (["recent", "recent_first", "latest", "desc", "newest"].includes(normalized)) return "recent";
  if (["oldest", "oldest_first", "asc", "old", "earliest"].includes(normalized)) return "oldest";
  return null;
}

function resolveChronologicalDirection(order, fallback = "recent") {
  const normalized = parseChronologicalOrder(order) || fallback;
  return normalized === "oldest" ? "asc" : "desc";
}

// Rota para definir o Titular
app.post("/people/:id/set-owner", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const id = Number(req.params.id);

  db.transaction(() => {
    db.prepare("UPDATE people SET is_owner = 0 WHERE user_id = ?").run(userId);
    db.prepare("UPDATE people SET is_owner = 1 WHERE id = ? AND user_id = ?").run(id, userId);
  })();

  res.redirect("/people");
});

// Rota Principal do detalhamento
function buildOverduePaymentAlertDescription(items) {
  const preview = items.slice(0, 3).map(item => {
    const dueLabel = item.due_date ? dayjs(item.due_date).format('DD/MM') : '--/--';
    if (Number(item.paid_cents || 0) > 0) {
      return `${item.card_name} (${dueLabel}) ainda tem ${formatBRLFromCents(item.remaining_cents)} pendente.`;
    }
    return `${item.card_name} (${dueLabel}) ainda não tem pagamento informado.`;
  });

  const extraCount = items.length - preview.length;
  return extraCount > 0
    ? `${preview.join(' ')} E ainda tem mais ${formatCountLabel(extraCount, 'fatura vencida com pendência', 'faturas vencidas com pendência')}.`
    : preview.join(' ');
}

app.get("/detalhamento/:year/:month", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const { year, month } = req.params;
  const currentMonth = parseInt(month);
  const currentYear = parseInt(year);

  syncRecurringTransactions(userId, currentYear, currentMonth);
  ensureMonthlyFinanceScaffold(userId, currentMonth, currentYear);

  const owner = db.prepare("SELECT * FROM people WHERE user_id = ? AND is_owner = 1 LIMIT 1").get(userId);
  if (!owner) return res.status(400).send("Defina um titular na aba Amigos primeiro.");

  const cardTotal = db.prepare(`
    SELECT COALESCE(SUM(a.share_cents), 0) as total
    FROM allocations a
    JOIN transactions t ON t.id = a.transaction_id AND t.user_id = a.user_id
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    WHERE a.user_id = ?
      AND a.person_id = ?
      AND (
        (${EFFECTIVE_DUE_MONTH_SQL} = ? AND ${EFFECTIVE_DUE_YEAR_SQL} = ?) OR
        (${EFFECTIVE_DUE_MONTH_SQL} = ? AND ${EFFECTIVE_DUE_YEAR_SQL} = ?)
      )
  `).get(userId, owner.id, currentMonth, currentYear, currentMonth, currentYear);

  const finances = hydrateMonthlyFinances(userId, db.prepare(`
    SELECT *
    FROM monthly_finances
    WHERE user_id = ? AND month = ? AND year = ?
    ORDER BY CASE type WHEN 'income' THEN 0 ELSE 1 END, id ASC
  `).all(userId, currentMonth, currentYear));

  const categories = db.prepare("SELECT * FROM finance_categories WHERE user_id = ? AND is_active = 1").all(userId);

  let notes = db.prepare("SELECT * FROM scratchpad WHERE user_id = ? AND month = ? AND year = ?").get(userId, currentMonth, currentYear);
  if (!notes) {
    db.prepare("INSERT INTO scratchpad (user_id, month, year, content_text, content_math) VALUES (?, ?, ?, '', '')")
      .run(userId, currentMonth, currentYear);
    notes = { content_text: '', content_math: '' };
  }

  const isClosed = isMonthClosed(userId, currentMonth, currentYear);
  const visibleCards = getVisibleCardsForMonth(userId, currentMonth, currentYear);
  const cards = getActiveCards(userId).map(({ id, name, close_day, due_day }) => ({ id, name, close_day, due_day }));

  const cardTotalsRows = db.prepare(`
    SELECT t.card_id, SUM(t.amount_cents) AS total_cents
    FROM transactions t
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    WHERE t.user_id = ?
      AND (
        (${EFFECTIVE_DUE_MONTH_SQL} = ? AND ${EFFECTIVE_DUE_YEAR_SQL} = ?) OR
        (${EFFECTIVE_DUE_MONTH_SQL} = ? AND ${EFFECTIVE_DUE_YEAR_SQL} = ?)
      )
    GROUP BY t.card_id
  `).all(userId, currentMonth, currentYear, currentMonth, currentYear);
  const cardTotalsMap = new Map(cardTotalsRows.map(row => [row.card_id, row.total_cents || 0]));

  const statementRows = db.prepare(`
    SELECT card_id, computed_due_date, override_due_date, paid_cents
    FROM card_statements
    WHERE user_id = ? AND month = ? AND year = ?
  `).all(userId, currentMonth, currentYear);
  const statementByCard = new Map(statementRows.map(row => [row.card_id, row]));

  const sharedDebtSummary = getAcceptedSharedDebtSummaryForMonth(userId, currentMonth, currentYear);

  const alerts = [];
  const pendingFriendRequests = db.prepare(`
    SELECT fr.id, fr.created_at, requester_u.name AS requester_name
    FROM friend_requests fr
    JOIN users requester_u ON requester_u.id = fr.requester_user_id
    WHERE fr.target_user_id = ? AND fr.status = 'pending'
    ORDER BY fr.created_at DESC, fr.id DESC
    LIMIT 5
  `).all(userId);

  const unreadFriendNotifications = db.prepare(`
    SELECT title, body, href, created_at
    FROM notifications
    WHERE user_id = ? AND is_read = 0 AND (
      related_type IN ('friend_request', 'friendship') OR
      type IN ('friend_request', 'friendship_update')
    )
    ORDER BY created_at DESC, id DESC
    LIMIT 5
  `).all(userId);

  if (pendingFriendRequests.length) {
    const newestFriendRequest = pendingFriendRequests[0];
    alerts.push({
      type: 'info',
      icon: '💚',
      title: pendingFriendRequests.length === 1
        ? `${newestFriendRequest.requester_name || 'Alguém'} quer entrar na sua rede`
        : 'Pedidos de amizade esperando resposta',
      description: pendingFriendRequests.length === 1
        ? 'Aceitando, vocês liberam cobranças automáticas dos dois lados com um ok de verdade.'
        : `${formatCountLabel(pendingFriendRequests.length, 'pedido de amizade está', 'pedidos de amizade estão')} te esperando lá em Amigos.`,
      href: `/people?friendRequest=${newestFriendRequest.id}`
    });
  } else if (unreadFriendNotifications.length) {
    const newestFriendNotification = unreadFriendNotifications[0];
    alerts.push({
      type: 'info',
      icon: '💌',
      title: newestFriendNotification.title || 'Tem novidade na sua rede',
      description: newestFriendNotification.body || 'Seu espaço de amizades ganhou novidade no OrganizaPay.',
      href: newestFriendNotification.href || '/people'
    });
  }

  const unreadSharedDebtNotifications = db.prepare(`
    SELECT title, body, href, created_at
    FROM notifications
    WHERE user_id = ? AND is_read = 0 AND (
      related_type IN ('shared_debt_request', 'shared_debt_batch') OR
      type IN ('shared_debt_request', 'shared_debt_batch')
    )
    ORDER BY created_at DESC
    LIMIT 5
  `).all(userId);

  if (unreadSharedDebtNotifications.length) {
    const newest = unreadSharedDebtNotifications[0];
    alerts.push({
      type: 'info',
      icon: '🤝',
      title: unreadSharedDebtNotifications.length === 1 ? newest.title : 'Cobranças pendentes',
      description: unreadSharedDebtNotifications.length === 1
        ? (newest.body || 'Você recebeu uma nova cobrança para analisar.')
        : `Você tem ${formatCountLabel(unreadSharedDebtNotifications.length, 'novidade', 'novidades')} em Cobranças esperando sua olhada.`,
      href: newest.href || '/shared-debts'
    });
  } else {
    const pendingSharedDebtCount = db.prepare(`
      SELECT COUNT(DISTINCT batch_id) AS total
      FROM shared_debt_requests
      WHERE receiver_user_id = ? AND status = 'pending'
    `).get(userId)?.total || 0;

    if (pendingSharedDebtCount > 0) {
      alerts.push({
        type: 'warning',
        icon: '📨',
        title: 'Envios aguardando sua análise',
        description: `${formatCountLabel(pendingSharedDebtCount, 'cobrança', 'cobranças')} ${pendingSharedDebtCount === 1 ? 'está' : 'estão'} te esperando.`,
        href: '/shared-debts#received'
      });
    }
  }

  const today = dayjs();
  const isCurrentReferenceMonth = currentYear === today.year() && currentMonth === (today.month() + 1);

  if (isCurrentReferenceMonth) {
    const closingTodayCards = getActiveCards(userId).filter(card => {
      const closeDay = normalizeDayNumber(card.close_day);
      return closeDay && Math.min(closeDay, today.daysInMonth()) === today.date();
    });

    if (closingTodayCards.length) {
      alerts.push({
        type: 'info',
        icon: '⏰',
        title: 'Cartão fecha hoje',
        description: `${closingTodayCards.map(card => card.name).join(', ')} ${closingTodayCards.length === 1 ? 'fecha' : 'fecham'} hoje.`
      });
    }

    const dueSoonCards = visibleCards
      .map(card => {
        const stmt = statementByCard.get(card.id);
        const computedDueDate = computeDueDate({ year: currentYear, month: currentMonth, dueDay: card.due_day, holidayScope: card.holiday_scope || 'BR' });
        const dueDate = stmt?.override_due_date || stmt?.computed_due_date || computedDueDate;
        const totalCents = cardTotalsMap.get(card.id) || 0;
        const diffDays = dueDate ? dayjs(dueDate).startOf('day').diff(today.startOf('day'), 'day') : null;
        return { card_name: card.name, due_date: dueDate, total_cents: totalCents, diff_days: diffDays };
      })
      .filter(item => item.total_cents > 0 && item.due_date && item.diff_days >= 0 && item.diff_days <= 2);

    if (dueSoonCards.length) {
      alerts.push({
        type: 'warning',
        icon: '📅',
        title: 'Vencimento em até 2 dias',
        description: dueSoonCards.map(item => `${item.card_name} (${dayjs(item.due_date).format('DD/MM')})`).join(', ')
      });
    }
  }

  const senderDecisionCount = db.prepare(`
    SELECT COUNT(*) AS total
    FROM shared_debt_requests
    WHERE requester_user_id = ? AND status = 'rejected_by_receiver'
  `).get(userId)?.total || 0;

  if (senderDecisionCount > 0) {
    alerts.push({
      type: 'warning',
      icon: '⚖️',
      title: 'Rejeições aguardando sua decisão',
      description: `${formatCountLabel(senderDecisionCount, 'recusa', 'recusas')} ${senderDecisionCount === 1 ? 'ainda aguarda' : 'ainda aguardam'} sua decisão para encerrar ou contestar.`,
      href: '/shared-debts#sent'
    });
  }

  const pendingReceiptConfirmationCount = (db.prepare(`
    SELECT COUNT(*) AS total
    FROM shared_debt_requests
    WHERE requester_user_id = ?
      AND status = 'accepted'
      AND payment_marked_at IS NOT NULL
  `).get(userId)?.total || 0) + (db.prepare(`
    SELECT COUNT(*) AS total
    FROM shared_debt_payment_intents
    WHERE requester_user_id = ?
      AND request_kind = 'card'
      AND status = 'reported'
  `).get(userId)?.total || 0);

  if (pendingReceiptConfirmationCount > 0) {
    alerts.push({
      type: 'warning',
      icon: '✅',
      title: 'Pagamentos aguardando sua confirmação',
      description: `${formatCountLabel(pendingReceiptConfirmationCount, 'pagamento', 'pagamentos')} já ${pendingReceiptConfirmationCount === 1 ? 'foi marcado como feito e está' : 'foram marcados como feitos e estão'} esperando seu ok final.`,
      href: '/shared-debts#sent'
    });
  }

  if (!isClosed) {
    const unassignedCount = db.prepare(`
      SELECT COUNT(*) AS total
      FROM transactions t
      LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
      WHERE t.user_id = ?
        AND (
          (${EFFECTIVE_DUE_MONTH_SQL} = ? AND ${EFFECTIVE_DUE_YEAR_SQL} = ?) OR
          (${EFFECTIVE_DUE_MONTH_SQL} = ? AND ${EFFECTIVE_DUE_YEAR_SQL} = ?)
        )
        AND NOT EXISTS (
          SELECT 1 FROM allocations a WHERE a.transaction_id = t.id AND a.user_id = t.user_id
        )
    `).get(userId, currentMonth, currentYear, currentMonth, currentYear)?.total || 0;

    if (unassignedCount > 0) {
      alerts.push({
        type: 'warning',
        icon: '👥',
        title: 'Itens sem distribuição',
        description: `${formatCountLabel(unassignedCount, 'item', 'itens')} deste mês ainda ${unassignedCount === 1 ? 'não foi dividido' : 'não foram divididos'} entre as pessoas.`,
        href: `/month/${currentYear}/${currentMonth}?f_allocated=nao`
      });
    }

    const overduePendingCards = visibleCards
      .map(card => {
        const stmt = statementByCard.get(card.id);
        const computedDueDate = computeDueDate({ year: currentYear, month: currentMonth, dueDay: card.due_day, holidayScope: card.holiday_scope || 'BR' });
        const dueDate = stmt?.override_due_date || stmt?.computed_due_date || computedDueDate;
        const totalCents = Number(cardTotalsMap.get(card.id) || 0);
        const paidCents = Number(stmt?.paid_cents || 0);
        const remainingCents = Math.max(0, totalCents - paidCents);
        const duePassed = dueDate ? dayjs(dueDate).startOf('day').isBefore(today.startOf('day')) : false;
        return {
          card_name: card.name,
          total_cents: totalCents,
          paid_cents: paidCents,
          remaining_cents: remainingCents,
          due_date: dueDate,
          due_passed: duePassed
        };
      })
      .filter(item => item.total_cents > 0 && item.due_passed && item.remaining_cents > 0);

    if (overduePendingCards.length) {
      alerts.push({
        type: 'warning',
        icon: '🚨',
        title: overduePendingCards.length === 1 ? 'Fatura vencida com pendência' : 'Faturas vencidas com pendência',
        description: buildOverduePaymentAlertDescription(overduePendingCards),
        href: `/summary/${currentYear}/${currentMonth}`
      });
    }
  }

  res.render("detalhamento", {
    title: "Meu Detalhamento",
    year: currentYear,
    month: currentMonth,
    owner,
    cardTotalCents: cardTotal ? cardTotal.total : 0,
    finances,
    categories,
    notes,
    formatBRLFromCents,
    isClosed,
    alerts,
    cards,
    sharedDebtSummary
  });
});

app.get("/month/:year/:month", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const parsed = parseMonthYear(req.params.month, req.params.year);
  if (!parsed) return res.status(400).send("Mês/ano inválidos.");
  const { month, year } = parsed;

  syncRecurringTransactions(userId, year, month);

  const requestedChronologicalOrder = parseChronologicalOrder(req.query.order);
  let sort = (req.query.sort || "date").toString();
  let dir = (req.query.dir || (sort === "date" ? "desc" : "asc")).toString();
  if (requestedChronologicalOrder) {
    sort = "date";
    dir = resolveChronologicalDirection(requestedChronologicalOrder);
  }
  const listOrder = sort === "date"
    ? (dir.toLowerCase() === "asc" ? "oldest" : "recent")
    : (requestedChronologicalOrder || "recent");
  const orderBy = buildOrder(sort, dir);

  const filters = {
    f_date: (req.query.f_date || "").toString().trim(),
    f_desc: (req.query.f_desc || "").toString().trim(),
    f_card: (req.query.f_card || "").toString().trim(),
    f_number: (req.query.f_number || "").toString().trim(),
    f_amount: (req.query.f_amount || "").toString().trim(),
    f_allocated: (req.query.f_allocated || "").toString().trim(),
    f_person: (req.query.f_person || "").toString().trim()
  };

  const allocCountExpr = "(SELECT COUNT(*) FROM allocations a WHERE a.transaction_id = t.id AND a.user_id = t.user_id)";
  const selectedCsvExpr = "(SELECT GROUP_CONCAT(a.person_id) FROM allocations a WHERE a.transaction_id = t.id AND a.user_id = t.user_id)";
  const selectedSharesCsvExpr = "(SELECT GROUP_CONCAT(a.person_id || ':' || a.share_cents) FROM allocations a WHERE a.transaction_id = t.id AND a.user_id = t.user_id)";

  const where = [`((${EFFECTIVE_DUE_MONTH_SQL} = ? AND ${EFFECTIVE_DUE_YEAR_SQL} = ?) OR (${EFFECTIVE_DUE_MONTH_SQL} = ? AND ${EFFECTIVE_DUE_YEAR_SQL} = ?))`];
  const params = [month, year, month, year];

  if (filters.f_desc) {
    where.push("t.description LIKE ?");
    params.push(`%${filters.f_desc}%`);
  }

  if (filters.f_card) {
    where.push("c.name LIKE ?");
    params.push(`%${filters.f_card}%`);
  }

  if (filters.f_number) {
    where.push("COALESCE(t.card_number, '') LIKE ?");
    params.push(`%${filters.f_number}%`);
  }

  if (filters.f_date) {
    where.push("COALESCE(t.txn_date, '') LIKE ?");
    params.push(`%${filters.f_date}%`);
  }

  if (filters.f_amount) {
    const digits = filters.f_amount.replace(/\D/g, "");
    if (digits) {
      where.push("CAST(ABS(t.amount_cents) AS TEXT) LIKE ?");
      params.push(likeParam(digits));
    }
  }

  if (filters.f_allocated) {
    const f = filters.f_allocated.toLowerCase();
    if (f.startsWith("s")) where.push(`${allocCountExpr} > 0`);
    else if (f.startsWith("n")) where.push(`${allocCountExpr} = 0`);
  }

  if (filters.f_person) {
    const personId = Number(filters.f_person);
    if (personId > 0) {
      where.push(`EXISTS (SELECT 1 FROM allocations a_filter WHERE a_filter.transaction_id = t.id AND a_filter.user_id = t.user_id AND a_filter.person_id = ?)`);
      params.push(personId);
    } else {
      filters.f_person = "";
    }
  }

  const txns = db.prepare(`
    SELECT t.id, t.txn_date, t.description, t.amount_cents, t.card_number, c.name AS card_name,
           t.parent_txn_id, t.recurring_rule_id, t.due_month, t.due_year,
           COALESCE(t.due_month, i.month) AS month,
           COALESCE(t.due_year, i.year) AS year,
           ${allocCountExpr} AS alloc_count,
           ${selectedCsvExpr} AS selected_csv,
           ${selectedSharesCsvExpr} AS selected_shares_csv
    FROM transactions t
    LEFT JOIN cards c ON c.id = t.card_id AND c.user_id = t.user_id
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    WHERE t.user_id = ? AND ${where.join(" AND ")}
    ORDER BY ${orderBy}
  `).all(userId, ...params);

  txns.forEach(t => {
    t.selected_ids = (t.selected_csv ? t.selected_csv.split(",").map(x => Number(x)) : []).filter(Boolean);
    t.selected_shares = {};
    if (t.selected_shares_csv) {
      String(t.selected_shares_csv).split(',').forEach((entry) => {
        const [personIdRaw, shareRaw] = String(entry || '').split(':');
        const personId = Number(personIdRaw || 0);
        if (personId) t.selected_shares[personId] = Number(shareRaw || 0);
      });
    }
    t.has_future_installments = hasFutureInstallments(userId, t);
  });

  const people = getVisiblePeopleForMonth(userId, month, year);
  const cards = getActiveCards(userId);
  const recurringRules = getRecurringRules(userId).map(rule => {
    const preview = getRecurringPreview(rule);
    const startDate = dayjs(rule.start_txn_date);
    return {
      ...rule,
      purchase_day: startDate.isValid() ? startDate.date() : null,
      start_due_label: monthLabel(rule.start_due_month, rule.start_due_year),
      active_from_label: monthLabel(rule.active_from_month, rule.active_from_year),
      preview_label: preview ? monthLabel(preview.month, preview.year) : null
    };
  });
  const isClosed = isMonthClosed(userId, month, year);
  const baseParams = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => { if (v) baseParams.set(k, v); });

  const sortLink = (key) => {
    const p = new URLSearchParams(baseParams);
    const nextDir = (sort === key && dir === "asc") ? "desc" : "asc";
    p.set("sort", key);
    p.set("dir", nextDir);
    const qs = p.toString();
    return `/month/${year}/${month}${qs ? `?${qs}` : ""}`;
  };

  res.render("month", { month, year, txns, people, cards, recurringRules, formatBRLFromCents, sort, dir, sortLink, filters, isClosed, listOrder });
});

app.post("/txn/manual", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const { date, description, amount, card_id, first_due, installments } = req.body;
  const isRecurring = ["1", "true", "on", "sim"].includes(String(req.body.is_recurring || "").toLowerCase());
  const assignToOwner = ["1", "true", "on", "sim"].includes(String(req.body.assign_to_owner || "").toLowerCase());

  try {
    const cardIdNum = Number(card_id);
    if (!cardIdNum || isNaN(cardIdNum)) {
      return res.status(400).send("Cartao invalido. Selecione um cartao valido.");
    }

    const cardExists = db.prepare("SELECT id, close_day, due_day FROM cards WHERE id = ? AND user_id = ? AND COALESCE(active, 1) = 1").get(cardIdNum, userId);
    if (!cardExists) {
      return res.status(400).send("Cartao nao encontrado no sistema ou esta desativado.");
    }

    const totalCents = centsFromPtBrMoney(amount);
    const numInstallments = parseInt(installments) || 1;
    if (isRecurring && numInstallments !== 1) {
      setFlash(req, "error", "Lançamentos recorrentes mensais funcionam apenas com 1 parcela.");
      return res.redirect(redirectBackOr(req, "/geral"));
    }

    const ownerPerson = assignToOwner ? getOwnerPerson(userId) : null;
    if (assignToOwner && !ownerPerson) {
      setFlash(req, "error", "Defina um titular na aba Amigos antes de usar 'Atribuir esse item a mim'.");
      return res.redirect(redirectBackOr(req, "/geral"));
    }

    const installmentValue = Math.floor(totalCents / numInstallments);
    const remainder = totalCents % numInstallments;

    const resolvedFirstDue = resolveFirstDueMonth({
      firstDue: first_due,
      purchaseDate: date,
      closeDay: cardExists.close_day,
      dueDay: cardExists.due_day
    });

    if (!resolvedFirstDue) {
      throw new Error("Nao foi possivel determinar o primeiro vencimento. Verifique a data da compra informada.");
    }

    let [startYear, startMonth] = resolvedFirstDue.split('-').map(Number);
    const installmentMonths = getInstallmentMonths(startYear, startMonth, numInstallments);
    const lockedInstallment = installmentMonths.find(item => isMonthClosed(userId, item.month, item.year));

    if (lockedInstallment) {
      setFlash(req, "error", `Não é possível criar este lançamento porque ${monthLabel(lockedInstallment.month, lockedInstallment.year)} está fechado.`);
      return res.redirect(redirectBackOr(req, `/month/${lockedInstallment.year}/${lockedInstallment.month}`));
    }

    let recurringRuleId = null;
    const createdTxnIds = [];

    db.transaction(() => {
      const activePeople = db.prepare("SELECT id FROM people WHERE user_id = ? AND active = 1").all(userId);
      const autoAssignPersonId = assignToOwner
        ? Number(ownerPerson.id)
        : (activePeople.length === 1 ? Number(activePeople[0].id) : null);
      const insTxn = db.prepare(`
        INSERT INTO transactions (user_id, card_id, txn_date, description, amount_cents, due_month, due_year, parent_txn_id, recurring_rule_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insAlloc = db.prepare(`
        INSERT INTO allocations (user_id, transaction_id, person_id, share_cents, created_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      const insRecurring = db.prepare(`
        INSERT INTO recurring_rules (user_id, card_id, description, amount_cents, start_txn_date, start_due_month, start_due_year, active_from_month, active_from_year, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
      `);

      if (isRecurring) {
        const info = insRecurring.run(userId, cardIdNum, description, totalCents, date, startMonth, startYear, startMonth, startYear, nowIso(), nowIso());
        recurringRuleId = Number(info.lastInsertRowid);
      }

      let installmentRootTxnId = null;

      for (let i = 0; i < numInstallments; i++) {
        let currentMonth = startMonth + i;
        let currentYear = startYear;
        while (currentMonth > 12) { currentMonth -= 12; currentYear += 1; }

        const finalDesc = numInstallments > 1
          ? `${description} (${String(i + 1).padStart(2, '0')}/${String(numInstallments).padStart(2, '0')})`
          : description;

        const currentAmount = (i === numInstallments - 1) ? installmentValue + remainder : installmentValue;
        const currentRecurringRuleId = isRecurring ? recurringRuleId : null;
        const currentParentTxnId = (numInstallments > 1 && installmentRootTxnId) ? installmentRootTxnId : null;

        const info = insTxn.run(userId, cardIdNum, date, finalDesc, currentAmount, currentMonth, currentYear, currentParentTxnId, currentRecurringRuleId, nowIso());
        const txnIdCreated = Number(info.lastInsertRowid);
        if (!installmentRootTxnId) installmentRootTxnId = txnIdCreated;

        if (autoAssignPersonId) {
          insAlloc.run(userId, txnIdCreated, autoAssignPersonId, currentAmount, nowIso());
          createdTxnIds.push(txnIdCreated);
        }
      }
    })();

    syncSharedDebtRequestsForTransactions(userId, createdTxnIds, {
      originKind: createdTxnIds.length > 1 ? 'installment' : 'single'
    });

    if (isRecurring) {
      setFlash(req, "success", "Lançamento recorrente mensal criado com sucesso.");
    }

    res.redirect(`/month/${startYear}/${startMonth}`);
  } catch (err) {
    return handleFriendlyErrorResponse(req, res, err, {
      defaultMessage: 'Não consegui salvar esse lançamento manual agora.',
      fallbackRedirect: '/geral'
    });
  }
});

app.post("/recurring/:id/state", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const ruleId = Number(req.params.id);
  const action = String(req.body.action || '').trim().toLowerCase();
  const rule = db.prepare("SELECT * FROM recurring_rules WHERE id = ? AND user_id = ?").get(ruleId, userId);

  if (!rule) {
    setFlash(req, "error", "Lançamento recorrente não encontrado.");
    return res.redirect(redirectBackOr(req, "/month"));
  }

  const today = dayjs();
  const currentYear = today.year();
  const currentMonth = today.month() + 1;

  const keepCurrentMonth = shouldKeepCurrentRecurringMonth(rule, today);

  if (action === 'pause') {
    db.prepare("UPDATE recurring_rules SET status = 'paused', updated_at = ? WHERE id = ? AND user_id = ?").run(nowIso(), ruleId, userId);
    removeFutureRecurringTransactions(userId, ruleId, currentYear, currentMonth, { includeCurrentMonth: !keepCurrentMonth });
    setFlash(req, "success", keepCurrentMonth
      ? `${rule.description} foi pausado. O mês atual ficou no histórico e o restante da frente saiu de cena.`
      : `${rule.description} foi pausado. Como a compra deste mês ainda não tinha acontecido, ela também saiu junto com o futuro.`);
  } else if (action === 'resume') {
    db.prepare(`
      UPDATE recurring_rules
      SET status = 'active', active_from_month = ?, active_from_year = ?, ended_at = NULL, updated_at = ?
      WHERE id = ? AND user_id = ?
    `).run(currentMonth, currentYear, nowIso(), ruleId, userId);
    syncRecurringTransactions(userId, currentYear, currentMonth);
    setFlash(req, "success", `${rule.description} foi reativado.`);
  } else if (action === 'end') {
    db.prepare("UPDATE recurring_rules SET status = 'ended', ended_at = ?, updated_at = ? WHERE id = ? AND user_id = ?").run(nowIso(), nowIso(), ruleId, userId);
    removeFutureRecurringTransactions(userId, ruleId, currentYear, currentMonth, { includeCurrentMonth: !keepCurrentMonth });
    setFlash(req, "success", keepCurrentMonth
      ? `${rule.description} foi encerrado. O que já caiu neste mês ficou guardado, e o restante da frente saiu de cena.`
      : `${rule.description} foi encerrado. Como a compra deste mês ainda não tinha acontecido, ela também foi retirada junto com as próximas.`);
  } else {
    setFlash(req, "error", "Ação inválida para lançamento recorrente.");
  }

  return res.redirect(redirectBackOr(req, "/month"));
});

app.post("/txn/:id/alloc", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const id = Number(req.params.id);

  const txn = getTransactionScopeRow(userId, id);

  if (!txn) return res.status(404).send("Transação não encontrada.");
  if (isMonthClosed(userId, txn.month, txn.year)) {
    return res.status(423).send(getMonthLockMessage(txn.month, txn.year));
  }

  const applyScope = String(req.body.apply_scope || 'single').trim().toLowerCase();
  const targetRows = getInstallmentScopeRows(userId, txn, applyScope);
  const settlementBlockMessage = buildSharedDebtCardMutationBlockerMessage(getSharedDebtCardMutationBlockersForTransactions(userId, targetRows));
  if (settlementBlockMessage) {
    return res.status(409).send(settlementBlockMessage);
  }
  const lockedTarget = targetRows.find(row => isMonthClosed(userId, row.month, row.year));
  if (lockedTarget) {
    return res.status(423).send(getMonthLockMessage(lockedTarget.month, lockedTarget.year));
  }

  const validPeople = new Set(getPeopleAll(userId).map(p => p.id));

  try {
    const allocationPlan = parseAllocationPlan({
      rawPersonIds: req.body.person_ids,
      validPeople,
      rawSplitMode: req.body.split_mode,
      rawShareAmounts: req.body.share_amounts,
      targetRows,
      requireSplitModeSelection: Number(txn.amount_cents || 0) >= 0
    });

    replaceAllocationsForTransactions(userId, targetRows, allocationPlan);

    syncSharedDebtRequestsForTransactions(userId, targetRows.map(targetTxn => targetTxn.id), {
      originKind: detectSharedDebtOriginKindFromRows(targetRows)
    });

    res.redirect(`/month/${txn.year}/${txn.month}`);
  } catch (error) {
    res.status(400).send(error.message || 'Não foi possível salvar a divisão dessa compra.');
  }
});

// Detail page
app.get("/txn/:id", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const id = Number(req.params.id);
  const txn = db.prepare(`
    SELECT t.id, t.txn_date, t.description, t.amount_cents, t.card_number, t.parent_txn_id, c.name AS card_name,
           COALESCE(t.due_month, i.month) as month,
           COALESCE(t.due_year, i.year) as year
    FROM transactions t
    LEFT JOIN cards c ON c.id = t.card_id AND c.user_id = t.user_id
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    WHERE t.id = ? AND t.user_id = ?
  `).get(id, userId);

  if (!txn) return res.status(404).send("Transação não encontrada.");

  const people = getVisiblePeopleForTransaction(userId, id);
  const allocationRows = db.prepare("SELECT person_id, share_cents FROM allocations WHERE transaction_id = ? AND user_id = ? ORDER BY id ASC")
    .all(id, userId);
  const selected = allocationRows.map(r => Number(r.person_id)).filter(Boolean);
  const selectedShares = {};
  allocationRows.forEach((row) => {
    const personId = Number(row.person_id || 0);
    if (personId) selectedShares[personId] = Number(row.share_cents || 0);
  });
  const isClosed = isMonthClosed(userId, txn.month, txn.year);
  const hasFutureInstallmentsForTxn = hasFutureInstallments(userId, txn);
  const initialSplitMode = inferAllocationMode(Number(txn.amount_cents || 0), allocationRows);

  res.render("txn", { txn, people, selected, selectedShares, initialSplitMode, formatBRLFromCents, isClosed, hasFutureInstallments: hasFutureInstallmentsForTxn });
});

app.post("/txn/:id", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const id = Number(req.params.id);

  const txn = getTransactionScopeRow(userId, id);

  if (!txn) return res.status(404).send("Transação não encontrada.");
  if (isMonthClosed(userId, txn.month, txn.year)) {
    setFlash(req, "error", getMonthLockMessage(txn.month, txn.year));
    return res.redirect(`/month/${txn.year}/${txn.month}`);
  }

  const applyScope = String(req.body.apply_scope || 'single').trim().toLowerCase();
  const targetRows = getInstallmentScopeRows(userId, txn, applyScope);
  const settlementBlockMessage = buildSharedDebtCardMutationBlockerMessage(getSharedDebtCardMutationBlockersForTransactions(userId, targetRows));
  if (settlementBlockMessage) {
    setFlash(req, 'error', settlementBlockMessage);
    return res.redirect(`/txn/${txn.id}`);
  }
  const lockedTarget = targetRows.find(row => isMonthClosed(userId, row.month, row.year));
  if (lockedTarget) {
    setFlash(req, "error", getMonthLockMessage(lockedTarget.month, lockedTarget.year));
    return res.redirect(`/month/${txn.year}/${txn.month}`);
  }

  const validPeople = new Set(getPeopleAll(userId).map(p => p.id));

  try {
    const allocationPlan = parseAllocationPlan({
      rawPersonIds: req.body.person_ids,
      validPeople,
      rawSplitMode: req.body.split_mode,
      rawShareAmounts: req.body.share_amounts,
      targetRows,
      requireSplitModeSelection: Number(txn.amount_cents || 0) >= 0
    });

    replaceAllocationsForTransactions(userId, targetRows, allocationPlan);

    syncSharedDebtRequestsForTransactions(userId, targetRows.map(targetTxn => targetTxn.id), {
      originKind: detectSharedDebtOriginKindFromRows(targetRows)
    });

    res.redirect(`/month/${txn.year}/${txn.month}`);
  } catch (error) {
    setFlash(req, 'error', error.message || 'Não foi possível salvar a divisão dessa compra.');
    res.redirect(`/txn/${txn.id}`);
  }
});

app.post("/txn/:id/delete", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const id = Number(req.params.id);

  const txn = getTransactionScopeRow(userId, id);

  if (!txn) {
    setFlash(req, "error", "Lançamento não encontrado.");
    return res.redirect("/geral");
  }
  if (isMonthClosed(userId, txn.month, txn.year)) {
    setFlash(req, "error", getMonthLockMessage(txn.month, txn.year));
    return res.redirect(`/month/${txn.year}/${txn.month}`);
  }

  const applyScope = String(req.body.apply_scope || 'single').trim().toLowerCase();
  const targetRows = getInstallmentScopeRows(userId, txn, applyScope);
  const settlementBlockMessage = buildSharedDebtCardMutationBlockerMessage(getSharedDebtCardMutationBlockersForTransactions(userId, targetRows));
  if (settlementBlockMessage) {
    setFlash(req, 'error', settlementBlockMessage);
    return res.redirect(`/month/${txn.year}/${txn.month}`);
  }
  const lockedTarget = targetRows.find(row => isMonthClosed(userId, row.month, row.year));
  if (lockedTarget) {
    setFlash(req, "error", getMonthLockMessage(lockedTarget.month, lockedTarget.year));
    return res.redirect(`/month/${txn.year}/${txn.month}`);
  }

  db.transaction(() => {
    targetRows.forEach(targetTxn => {
      if (targetTxn.recurring_rule_id && targetTxn.month && targetTxn.year) {
        db.prepare(`
          INSERT OR IGNORE INTO recurring_exceptions (user_id, rule_id, month, year, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(userId, targetTxn.recurring_rule_id, targetTxn.month, targetTxn.year, nowIso());
      }
    });
    deleteTransactionsAndAllocations(userId, targetRows);
  })();

  const deletedCount = targetRows.length;
  setFlash(req, "success", deletedCount > 1 ? `${deletedCount} lançamento(s) excluídos com sucesso.` : "Lançamento excluído com sucesso.");
  return res.redirect(`/month/${txn.year}/${txn.month}`);
});

app.post("/month/:year/:month/bulk/alloc", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const parsed = parseMonthYear(req.params.month, req.params.year);
  if (!parsed) return res.status(400).json({ ok: false, error: "Mês/ano inválidos." });

  const sourceRows = getTransactionScopeRowsByIds(userId, req.body.txn_ids);
  if (!sourceRows.length) {
    return res.status(400).json({ ok: false, error: "Selecione pelo menos um lançamento." });
  }

  const lockedSource = sourceRows.find(row => isMonthClosed(userId, row.month, row.year));
  if (lockedSource) {
    return res.status(423).json({ ok: false, error: getMonthLockMessage(lockedSource.month, lockedSource.year) });
  }

  const applyScope = String(req.body.apply_scope || 'single').trim().toLowerCase();
  const targetRows = collectScopedTxnRows(userId, sourceRows, applyScope);
  const settlementBlockMessage = buildSharedDebtCardMutationBlockerMessage(getSharedDebtCardMutationBlockersForTransactions(userId, targetRows));
  if (settlementBlockMessage) {
    return res.status(409).json({ ok: false, error: settlementBlockMessage });
  }
  const lockedTarget = targetRows.find(row => isMonthClosed(userId, row.month, row.year));
  if (lockedTarget) {
    return res.status(423).json({ ok: false, error: getMonthLockMessage(lockedTarget.month, lockedTarget.year) });
  }

  const validPeople = new Set(getPeopleAll(userId).map(p => p.id));

  try {
    const allocationPlan = parseAllocationPlan({
      rawPersonIds: req.body.person_ids,
      validPeople,
      rawSplitMode: req.body.split_mode,
      rawShareAmounts: req.body.share_amounts,
      targetRows,
      requireSplitModeSelection: sourceRows.length === 1 && Number(sourceRows[0].amount_cents || 0) >= 0
    });

    replaceAllocationsForTransactions(userId, targetRows, allocationPlan);

    syncSharedDebtRequestsForTransactions(userId, targetRows.map(targetTxn => targetTxn.id), {
      originKind: detectSharedDebtOriginKindFromRows(targetRows)
    });

    return res.json({
      ok: true,
      affected_count: targetRows.length,
      source_count: sourceRows.length,
      message: targetRows.length > 1
        ? `${targetRows.length} lançamento(s) tiveram a distribuição atualizada.`
        : 'Distribuição atualizada com sucesso.'
    });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error.message || 'Não foi possível atualizar a distribuição agora.' });
  }
});

app.post("/month/:year/:month/bulk/delete", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const parsed = parseMonthYear(req.params.month, req.params.year);
  if (!parsed) return res.status(400).json({ ok: false, error: "Mês/ano inválidos." });

  const sourceRows = getTransactionScopeRowsByIds(userId, req.body.txn_ids);
  if (!sourceRows.length) {
    return res.status(400).json({ ok: false, error: "Selecione pelo menos um lançamento." });
  }

  const lockedSource = sourceRows.find(row => isMonthClosed(userId, row.month, row.year));
  if (lockedSource) {
    return res.status(423).json({ ok: false, error: getMonthLockMessage(lockedSource.month, lockedSource.year) });
  }

  const applyScope = String(req.body.apply_scope || 'single').trim().toLowerCase();
  const targetRows = collectScopedTxnRows(userId, sourceRows, applyScope);
  const settlementBlockMessage = buildSharedDebtCardMutationBlockerMessage(getSharedDebtCardMutationBlockersForTransactions(userId, targetRows));
  if (settlementBlockMessage) {
    return res.status(409).json({ ok: false, error: settlementBlockMessage });
  }
  const lockedTarget = targetRows.find(row => isMonthClosed(userId, row.month, row.year));
  if (lockedTarget) {
    return res.status(423).json({ ok: false, error: getMonthLockMessage(lockedTarget.month, lockedTarget.year) });
  }

  const addException = db.prepare(`
    INSERT OR IGNORE INTO recurring_exceptions (user_id, rule_id, month, year, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  let deletedCount = 0;
  db.transaction(() => {
    targetRows.forEach(targetTxn => {
      if (targetTxn.recurring_rule_id && targetTxn.month && targetTxn.year) {
        addException.run(userId, targetTxn.recurring_rule_id, targetTxn.month, targetTxn.year, nowIso());
      }
    });
    deletedCount = deleteTransactionsAndAllocations(userId, targetRows);
  })();

  return res.json({
    ok: true,
    affected_count: deletedCount,
    source_count: sourceRows.length,
    message: deletedCount > 1 ? `${deletedCount} lançamento(s) excluídos com sucesso.` : 'Lançamento excluído com sucesso.'
  });
});

app.post("/month/:year/:month/bulk/move", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const parsed = parseMonthYear(req.params.month, req.params.year);
  if (!parsed) return res.status(400).json({ ok: false, error: "Mês/ano inválidos." });

  const targetMonth = Number(req.body.target_month);
  const targetYear = Number(req.body.target_year);
  const targetParsed = parseMonthYear(targetMonth, targetYear);
  if (!targetParsed) {
    return res.status(400).json({ ok: false, error: "Destino inválido para a fatura." });
  }

  const sourceRows = getTransactionScopeRowsByIds(userId, req.body.txn_ids);
  if (!sourceRows.length) {
    return res.status(400).json({ ok: false, error: "Selecione pelo menos um lançamento." });
  }

  const settlementBlockMessage = buildSharedDebtCardMutationBlockerMessage(getSharedDebtCardMutationBlockersForTransactions(userId, sourceRows));
  if (settlementBlockMessage) {
    return res.status(409).json({ ok: false, error: settlementBlockMessage });
  }

  const lockedSource = sourceRows.find(row => isMonthClosed(userId, row.month, row.year));
  if (lockedSource) {
    return res.status(423).json({ ok: false, error: getMonthLockMessage(lockedSource.month, lockedSource.year) });
  }

  const recurringSelected = sourceRows.find(row => Number(row.recurring_rule_id || 0) > 0);
  if (recurringSelected) {
    return res.status(409).json({ ok: false, error: 'Lançamentos recorrentes ainda não entram no fluxo de mover para outra fatura. Remova-os da seleção e tente novamente.' });
  }

  const applyScope = String(req.body.apply_scope || 'single').trim().toLowerCase();

  let moveTargets = [];
  try {
    moveTargets = buildMoveTargets(userId, sourceRows, targetParsed.month, targetParsed.year, applyScope);
  } catch (error) {
    return res.status(400).json({ ok: false, error: error.message || 'Não foi possível preparar a movimentação.' });
  }

  if (!moveTargets.length) {
    return res.status(400).json({ ok: false, error: 'Nenhum lançamento elegível para movimentação.' });
  }

  const lockedDestination = moveTargets.find(row => isMonthClosed(userId, row.target_month, row.target_year));
  if (lockedDestination) {
    return res.status(423).json({ ok: false, error: getMonthLockMessage(lockedDestination.target_month, lockedDestination.target_year) });
  }

  const updateTxn = db.prepare(`
    UPDATE transactions
    SET due_month = ?, due_year = ?
    WHERE id = ? AND user_id = ?
  `);

  db.transaction(() => {
    moveTargets.forEach(targetTxn => {
      updateTxn.run(targetTxn.target_month, targetTxn.target_year, targetTxn.id, userId);
    });
  })();

  syncSharedDebtRequestsForTransactions(userId, moveTargets.map(targetTxn => targetTxn.id), {
    originKind: detectSharedDebtOriginKindFromRows(moveTargets)
  });

  return res.json({
    ok: true,
    affected_count: moveTargets.length,
    source_count: sourceRows.length,
    target_month: targetParsed.month,
    target_year: targetParsed.year,
    message: moveTargets.length > 1
      ? `${moveTargets.length} lançamento(s) foram movidos para ${monthLabel(targetParsed.month, targetParsed.year)}.`
      : `Lançamento movido para ${monthLabel(targetParsed.month, targetParsed.year)}.`
  });
});

// Summary (minimal)
function upsertCardStatementsForMonth(userId, month, year, entries) {
  const cardsById = new Map(getCards(userId).map(card => [card.id, card]));
  const findStatement = db.prepare("SELECT 1 FROM card_statements WHERE user_id = ? AND card_id = ? AND month = ? AND year = ?");
  const insertStatement = db.prepare(`
    INSERT INTO card_statements (user_id, card_id, month, year, computed_due_date, override_due_date, paid_cents, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateStatement = db.prepare(`
    UPDATE card_statements
    SET computed_due_date = ?, override_due_date = ?, paid_cents = ?, updated_at = ?
    WHERE user_id = ? AND card_id = ? AND month = ? AND year = ?
  `);

  db.transaction((rows) => {
    rows.forEach((entry) => {
      const card_id = Number(entry.card_id);
      if (!card_id || !cardsById.has(card_id)) return;

      const paid_cents = centsFromPtBrMoney(entry.paid);
      const override_due_date = (entry.override_due || "").toString().trim() || null;
      const card = cardsById.get(card_id);
      const computed_due_date = computeDueDate({ year, month, dueDay: card?.due_day, holidayScope: card?.holiday_scope || "BR" });
      const now = nowIso();
      const existing = findStatement.get(userId, card_id, month, year);

      if (existing) {
        updateStatement.run(computed_due_date, override_due_date, paid_cents, now, userId, card_id, month, year);
      } else {
        insertStatement.run(userId, card_id, month, year, computed_due_date, override_due_date, paid_cents, now, now);
      }
    });
  })(entries);
}

function upsertPersonPaymentsForMonth(userId, month, year, entries) {
  const validPeople = new Set(getPeopleAll(userId).map(person => person.id));
  const findPayment = db.prepare("SELECT 1 FROM person_payments WHERE user_id = ? AND person_id = ? AND month = ? AND year = ?");
  const insertPayment = db.prepare(`
    INSERT INTO person_payments (user_id, person_id, month, year, paid_cents, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const updatePayment = db.prepare(`
    UPDATE person_payments
    SET paid_cents = ?, updated_at = ?
    WHERE user_id = ? AND person_id = ? AND month = ? AND year = ?
  `);

  db.transaction((rows) => {
    rows.forEach((entry) => {
      const person_id = Number(entry.person_id);
      if (!person_id || !validPeople.has(person_id)) return;

      const paid_cents = centsFromPtBrMoney(entry.paid);
      const now = nowIso();
      const existing = findPayment.get(userId, person_id, month, year);

      if (existing) {
        updatePayment.run(paid_cents, now, userId, person_id, month, year);
      } else {
        insertPayment.run(userId, person_id, month, year, paid_cents, now, now);
      }
    });
  })(entries);
}

app.get("/summary/:year/:month", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const parsed = parseMonthYear(req.params.month, req.params.year);
  if (!parsed) return res.status(400).send("Mês/ano inválidos.");
  const { month, year } = parsed;
  syncRecurringTransactions(userId, year, month);
  const isClosed = isMonthClosed(userId, month, year);

  const people = getVisiblePeopleForMonth(userId, month, year, { includePayments: true });
  const cards = getVisibleCardsForMonth(userId, month, year);

  const allocRows = db.prepare(`
    SELECT a.person_id, t.card_id, SUM(a.share_cents) AS total_cents
    FROM allocations a
    JOIN transactions t ON t.id = a.transaction_id AND t.user_id = a.user_id
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    WHERE a.user_id = ?
      AND (
        (${EFFECTIVE_DUE_MONTH_SQL} = ? AND ${EFFECTIVE_DUE_YEAR_SQL} = ?) OR
        (${EFFECTIVE_DUE_MONTH_SQL} = ? AND ${EFFECTIVE_DUE_YEAR_SQL} = ?)
      )
    GROUP BY a.person_id, t.card_id
  `).all(userId, month, year, month, year);

  const allocByPersonCard = new Map();
  const personTotalsMap = new Map();

  allocRows.forEach(row => {
    const total = row.total_cents || 0;
    allocByPersonCard.set(`${row.person_id}-${row.card_id}`, total);
    personTotalsMap.set(row.person_id, (personTotalsMap.get(row.person_id) || 0) + total);
  });

  const rows = [];
  people.forEach(person => {
    cards.forEach(card => {
      rows.push({
        person_id: person.id,
        person_name: person.name,
        card_id: card.id,
        card_name: card.name,
        total_cents: allocByPersonCard.get(`${person.id}-${card.id}`) || 0
      });
    });
  });

  const unassigned = db.prepare(`
    SELECT c.name AS card_name, COALESCE(SUM(t.amount_cents), 0) AS total_cents
    FROM transactions t
    JOIN cards c ON c.id = t.card_id AND c.user_id = t.user_id
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    WHERE t.user_id = ?
      AND (
        (${EFFECTIVE_DUE_MONTH_SQL} = ? AND ${EFFECTIVE_DUE_YEAR_SQL} = ?) OR
        (${EFFECTIVE_DUE_MONTH_SQL} = ? AND ${EFFECTIVE_DUE_YEAR_SQL} = ?)
      )
      AND NOT EXISTS (
        SELECT 1 FROM allocations a WHERE a.transaction_id = t.id AND a.user_id = t.user_id
      )
    GROUP BY c.id
    ORDER BY c.name
  `).all(userId, month, year, month, year);

  const cardTotalsRows = db.prepare(`
    SELECT t.card_id, SUM(t.amount_cents) AS total_cents
    FROM transactions t
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    WHERE t.user_id = ?
      AND (
        (${EFFECTIVE_DUE_MONTH_SQL} = ? AND ${EFFECTIVE_DUE_YEAR_SQL} = ?) OR
        (${EFFECTIVE_DUE_MONTH_SQL} = ? AND ${EFFECTIVE_DUE_YEAR_SQL} = ?)
      )
    GROUP BY t.card_id
  `).all(userId, month, year, month, year);
  const cardTotalsMap = new Map(cardTotalsRows.map(row => [row.card_id, row.total_cents || 0]));

  const stmtRows = db.prepare(`
    SELECT card_id, computed_due_date, override_due_date, paid_cents
    FROM card_statements
    WHERE user_id = ? AND month = ? AND year = ?
  `).all(userId, month, year);
  const stmtByCard = new Map(stmtRows.map(row => [row.card_id, row]));

  const cardsPanel = cards
    .map(card => {
      const stmt = stmtByCard.get(card.id);
      const computed = computeDueDate({ year, month, dueDay: card.due_day, holidayScope: card.holiday_scope || "BR" });
      const due_date = stmt?.override_due_date || stmt?.computed_due_date || computed;
      return {
        card_id: card.id,
        card_name: card.name,
        computed_due_date: computed,
        due_date,
        paid_cents: stmt ? stmt.paid_cents : 0,
        total_cents: cardTotalsMap.get(card.id) || 0
      };
    })
    .sort((a, b) => {
      const aTime = a.due_date ? dayjs(a.due_date).valueOf() : Number.MAX_SAFE_INTEGER;
      const bTime = b.due_date ? dayjs(b.due_date).valueOf() : Number.MAX_SAFE_INTEGER;
      if (aTime !== bTime) return aTime - bTime;
      return a.card_name.localeCompare(b.card_name, "pt-BR", { sensitivity: "base" });
    });

  const personPaymentBreakdown = getCombinedPersonPaymentBreakdownMap(userId, month, year);

  const personPanel = people.map(person => {
    const breakdown = personPaymentBreakdown.get(person.id) || { manualCents: 0, autoCents: 0, totalPaidCents: 0 };
    return {
      person_id: person.id,
      person_name: person.name,
      total_cents: personTotalsMap.get(person.id) || 0,
      paid_cents: breakdown.totalPaidCents,
      manual_paid_cents: breakdown.manualCents,
      auto_paid_cents: breakdown.autoCents,
      active: person.active
    };
  });

  res.render("summary", { month, year, people, cards, rows, unassigned, cardsPanel, personPanel, formatBRLFromCents, isClosed });
});

app.post("/summary/:year/:month/cards", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const parsed = parseMonthYear(req.params.month, req.params.year);
  if (!parsed) return res.status(400).send("Mês/ano inválidos.");
  const { month, year } = parsed;
  if (isMonthClosed(userId, month, year)) {
    setFlash(req, "error", getMonthLockMessage(month, year));
    return res.redirect(`/summary/${year}/${month}`);
  }

  const cardIds = Array.isArray(req.body.card_id) ? req.body.card_id : [req.body.card_id];
  const paid = Array.isArray(req.body.paid) ? req.body.paid : [req.body.paid];
  const overrideDue = Array.isArray(req.body.override_due) ? req.body.override_due : [req.body.override_due];
  const entries = cardIds.map((card_id, index) => ({
    card_id,
    paid: paid[index],
    override_due: overrideDue[index]
  }));

  upsertCardStatementsForMonth(userId, month, year, entries);
  res.redirect(`/summary/${year}/${month}`);
});

app.post("/summary/:year/:month/cards/async", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const parsed = parseMonthYear(req.params.month, req.params.year);
  if (!parsed) return res.status(400).json({ ok: false, error: "Mês/ano inválidos." });
  const { month, year } = parsed;
  if (isMonthClosed(userId, month, year)) {
    return res.status(423).json({ ok: false, error: getMonthLockMessage(month, year) });
  }

  upsertCardStatementsForMonth(userId, month, year, [{
    card_id: req.body.card_id,
    paid: req.body.paid,
    override_due: req.body.override_due
  }]);

  return res.json({ ok: true });
});

app.post("/summary/:year/:month/people", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const parsed = parseMonthYear(req.params.month, req.params.year);
  if (!parsed) return res.status(400).send("Mês/ano inválidos.");
  const { month, year } = parsed;
  if (isMonthClosed(userId, month, year)) {
    setFlash(req, "error", getMonthLockMessage(month, year));
    return res.redirect(`/summary/${year}/${month}`);
  }

  const personIds = Array.isArray(req.body.person_id) ? req.body.person_id : [req.body.person_id];
  const paid = Array.isArray(req.body.paid) ? req.body.paid : [req.body.paid];
  const entries = personIds.map((person_id, index) => ({ person_id, paid: paid[index] }));

  upsertPersonPaymentsForMonth(userId, month, year, entries);
  res.redirect(`/summary/${year}/${month}`);
});

app.post("/summary/:year/:month/people/async", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const parsed = parseMonthYear(req.params.month, req.params.year);
  if (!parsed) return res.status(400).json({ ok: false, error: "Mês/ano inválidos." });
  const { month, year } = parsed;
  if (isMonthClosed(userId, month, year)) {
    return res.status(423).json({ ok: false, error: getMonthLockMessage(month, year) });
  }

  upsertPersonPaymentsForMonth(userId, month, year, [{ person_id: req.body.person_id, paid: req.body.paid }]);
  return res.json({ ok: true });
});

function getPersonStatementExportData(userId, month, year, personId, itemOrder = "oldest") {
  syncRecurringTransactions(userId, year, month);

  const person = db.prepare("SELECT * FROM people WHERE id = ? AND user_id = ?").get(personId, userId);
  if (!person) return null;

  const chronologicalDirection = resolveChronologicalDirection(itemOrder, "oldest").toUpperCase();

  const items = db.prepare(`
    SELECT t.txn_date, t.description, c.name AS card_name, a.share_cents
    FROM allocations a
    JOIN transactions t ON t.id = a.transaction_id AND t.user_id = a.user_id
    JOIN cards c ON c.id = t.card_id AND c.user_id = t.user_id
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    WHERE a.user_id = ?
      AND a.person_id = ?
      AND (
        (${EFFECTIVE_DUE_MONTH_SQL} = ? AND ${EFFECTIVE_DUE_YEAR_SQL} = ?) OR
        (${EFFECTIVE_DUE_MONTH_SQL} = ? AND ${EFFECTIVE_DUE_YEAR_SQL} = ?)
      )
    ORDER BY t.txn_date IS NULL ASC, t.txn_date ${chronologicalDirection}, c.name ASC, t.id ${chronologicalDirection}
  `).all(userId, personId, month, year, month, year);

  const totalsByCard = db.prepare(`
    SELECT c.name AS card_name, COALESCE(SUM(a.share_cents), 0) AS total_cents
    FROM allocations a
    JOIN transactions t ON t.id = a.transaction_id AND t.user_id = a.user_id
    JOIN cards c ON c.id = t.card_id AND c.user_id = t.user_id
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    WHERE a.user_id = ?
      AND a.person_id = ?
      AND (
        (${EFFECTIVE_DUE_MONTH_SQL} = ? AND ${EFFECTIVE_DUE_YEAR_SQL} = ?) OR
        (${EFFECTIVE_DUE_MONTH_SQL} = ? AND ${EFFECTIVE_DUE_YEAR_SQL} = ?)
      )
    GROUP BY c.id
    ORDER BY c.name
  `).all(userId, personId, month, year, month, year);

  const total = totalsByCard.reduce((acc, r) => acc + r.total_cents, 0);

  const paymentBreakdown = getPersonPaymentBreakdownForMonth(userId, month, year, personId);
  const paid_cents = paymentBreakdown.totalPaidCents;
  const remaining_cents = Math.max(0, total - paid_cents);

  return {
    person,
    items,
    totalsByCard,
    total,
    paid_cents,
    manual_paid_cents: paymentBreakdown.manualCents,
    auto_paid_cents: paymentBreakdown.autoCents,
    remaining_cents
  };
}

function resolveStatementShareState({ paidCents = 0, remainingCents = 0 } = {}) {
  const safePaid = Math.max(0, Number(paidCents || 0));
  const safeRemaining = Math.max(0, Number(remainingCents || 0));

  if (safeRemaining <= 0) return 'settled';
  if (safePaid > 0) return 'partial_due';
  return 'full_due';
}

function buildStatementSharePixTxid(userId, personId, month, year, remainingCents = 0) {
  const safeUserId = Math.max(0, Number(userId || 0)).toString(36).toUpperCase();
  const safePersonId = Math.max(0, Number(personId || 0)).toString(36).toUpperCase();
  const safeYear = Math.max(0, Number(year || 0)).toString(36).toUpperCase();
  const safeMonth = Math.max(0, Number(month || 0)).toString(36).toUpperCase();
  const safeAmount = Math.max(0, Math.round(Number(remainingCents || 0) / 100)).toString(36).toUpperCase();
  return sanitizeTxid(`OPSH${safeUserId}${safePersonId}${safeYear}${safeMonth}${safeAmount}`);
}

function buildStatementShareMessageContext({ state, personName, periodLabel, totalCents, paidCents, remainingCents, pixPayload } = {}) {
  const safeState = String(state || 'full_due').trim().toLowerCase();
  const safePersonName = String(personName || 'por aí').trim() || 'por aí';
  const totalLabel = formatBRLFromCents(totalCents);
  const paidLabel = formatBRLFromCents(paidCents);
  const remainingLabel = formatBRLFromCents(remainingCents);
  const hasPix = !!String(pixPayload || '').trim();

  let nativeShareText = '';
  let whatsappCaption = '';
  let whatsappFollowUpMessage = '';

  if (safeState === 'settled') {
    nativeShareText = [
      `Separei o resumo de ${periodLabel} só para registro.`,
      'Já ficou tudo certinho por aqui. Obrigado por fechar essa com a gente.',
      '',
      `Total do período: ${totalLabel}.`,
      `Valor pago: ${paidLabel}.`
    ].join('\n');

    whatsappCaption = [
      `*Oi, ${safePersonName}!* ✨`,
      '',
      `Separei o resumo de *${periodLabel}* só para registro.`,
      'Já ficou tudo certinho por aqui.',
      '',
      'A imagem com os detalhes foi logo abaixo 👇'
    ].join('\n');
  } else if (safeState === 'partial_due') {
    nativeShareText = [
      `Separei o resumo de ${periodLabel}. Já entrou ${paidLabel} e ainda falta ${remainingLabel} para fechar tudo.`,
      'A imagem vai junto com os detalhes.'
    ].join('\n\n');

    whatsappCaption = [
      `*Oi, ${safePersonName}!* 💳`,
      '',
      `Separei o resumo de *${periodLabel}*. Já entrou *${paidLabel}* e ainda falta *${remainingLabel}* para fechar tudo.`,
      '',
      'A imagem com os detalhes foi logo abaixo 👇'
    ].join('\n');

    if (hasPix) {
      nativeShareText = [
        nativeShareText,
        'Pix copia e cola do saldo restante:',
        String(pixPayload || '').trim()
      ].join('\n\n');

      whatsappFollowUpMessage = [
        `Pix copia e cola do saldo restante (${remainingLabel}):`,
        '',
        String(pixPayload || '').trim(),
        '',
        'Quando pagar, me manda o comprovante por aqui 💸'
      ].join('\n');
    }
  } else {
    nativeShareText = [
      `Separei o resumo de ${periodLabel}. O total em aberto ficou em ${remainingLabel}.`,
      'A imagem vai junto com os detalhes.'
    ].join('\n\n');

    whatsappCaption = [
      `*Oi, ${safePersonName}!* 💳`,
      '',
      `Separei o resumo de *${periodLabel}*. O total em aberto ficou em *${remainingLabel}*.`,
      '',
      'A imagem com os detalhes foi logo abaixo 👇'
    ].join('\n');

    if (hasPix) {
      nativeShareText = [
        nativeShareText,
        'Pix copia e cola para facilitar o acerto:',
        String(pixPayload || '').trim()
      ].join('\n\n');

      whatsappFollowUpMessage = [
        `Pix copia e cola para fechar esse resumo (${remainingLabel}):`,
        '',
        String(pixPayload || '').trim(),
        '',
        'Quando pagar, me manda o comprovante por aqui 💸'
      ].join('\n');
    }
  }

  return {
    nativeShareText,
    whatsappCaption,
    whatsappFollowUpMessage
  };
}

async function buildSharePixContext({ userId, month, year, person, totalCents, paidCents, remainingCents } = {}) {
  const safeRemainingCents = Math.max(0, Number(remainingCents || 0));
  const safePaidCents = Math.max(0, Number(paidCents || 0));
  const safeTotalCents = Math.max(0, Number(totalCents || 0));
  const periodLabel = `${String(month).padStart(2, '0')}/${year}`;
  const state = resolveStatementShareState({ paidCents: safePaidCents, remainingCents: safeRemainingCents });
  const ownerPixProfile = getUserPixProfile(userId);

  const pix = {
    available: false,
    qrSupported: !!QRCode,
    reason: null,
    amountCents: safeRemainingCents,
    payload: '',
    qrDataUrl: null,
    keyTypeLabel: ownerPixProfile?.pixKeyTypeLabel || null,
    maskedKey: ownerPixProfile?.pixMaskedKey || null,
    ownerName: ownerPixProfile?.ownerName || 'quem vai receber',
    city: ownerPixProfile?.pixCity || null,
    helperText: safePaidCents > 0
      ? 'O QR já vai no saldo restante, e o código completo segue no texto para copiar sem aperto.'
      : 'No banco, é só escanear ou usar o código que segue no texto.'
  };

  if (safeRemainingCents > 0) {
    if (!ownerPixProfile || !ownerPixProfile.pixEnabled) {
      pix.reason = 'Salve o Pix do titular em Amigos para este resumo já sair com copia e cola.';
    } else if (!ownerPixProfile.pixValid) {
      pix.reason = ownerPixProfile.pixReason || 'Seu Pix ainda precisa de um ajuste em Amigos.';
    } else {
      try {
        const txid = buildStatementSharePixTxid(userId, person?.id, month, year, safeRemainingCents);
        const description = sanitizePixText(`RESUMO ${periodLabel} ${person?.name || ''}`, { max: 72 })
          || sanitizePixText(`RESUMO ${periodLabel}`, { max: 72 });
        const payload = buildPixPayload({
          keyType: ownerPixProfile.pixKeyType,
          keyValue: ownerPixProfile.pixKeyValue,
          merchantName: ownerPixProfile.pixMerchantName || ownerPixProfile.ownerName || 'ORGANIZAPAY',
          merchantCity: ownerPixProfile.pixCity || PIX_DEFAULT_CITY,
          amountCents: safeRemainingCents,
          txid,
          description
        });

        let qrDataUrl = null;
        if (QRCode) {
          try {
            qrDataUrl = await QRCode.toDataURL(payload, {
              errorCorrectionLevel: 'M',
              margin: 1,
              width: 220,
              color: { dark: '#0f172a', light: '#FFFFFF' }
            });
          } catch (_) {
            qrDataUrl = null;
          }
        }

        pix.available = true;
        pix.payload = payload;
        pix.qrDataUrl = qrDataUrl;
        pix.keyTypeLabel = ownerPixProfile.pixKeyTypeLabel || null;
        pix.maskedKey = ownerPixProfile.pixMaskedKey || null;
        pix.ownerName = ownerPixProfile.ownerName || pix.ownerName;
        pix.city = ownerPixProfile.pixCity || pix.city;
        pix.reason = null;
      } catch (error) {
        pix.reason = error.message || 'Não consegui montar o Pix deste resumo agora.';
      }
    }
  }

  const messages = buildStatementShareMessageContext({
    state,
    personName: person?.name,
    periodLabel,
    totalCents: safeTotalCents,
    paidCents: safePaidCents,
    remainingCents: safeRemainingCents,
    pixPayload: pix.available ? pix.payload : ''
  });

  return {
    state,
    periodLabel,
    shareTitle: `Resumo ${periodLabel} — ${person?.name || 'OrganizaPay'}`,
    nativeShareText: messages.nativeShareText,
    whatsappCaption: messages.whatsappCaption,
    whatsappFollowUpMessage: messages.whatsappFollowUpMessage,
    pix
  };
}

// WhatsApp e compartilhamento
app.get("/share/:year/:month/:personId", ensureAuthenticated, async (req, res) => {
  const userId = req.user.id;
  const parsed = parseMonthYear(req.params.month, req.params.year);
  const personId = Number(req.params.personId);
  if (!parsed) return res.status(400).send("Parâmetros inválidos.");

  const { month, year } = parsed;
  const itemOrder = parseChronologicalOrder(req.query.order) || "oldest";
  const exportData = getPersonStatementExportData(userId, month, year, personId, itemOrder);
  if (!exportData) return res.status(400).send("Pessoa inválida.");

  const shareContext = await buildSharePixContext({
    userId,
    month,
    year,
    person: exportData.person,
    totalCents: exportData.total,
    paidCents: exportData.paid_cents,
    remainingCents: exportData.remaining_cents
  });

  res.render("share", { month, year, itemOrder, shareContext, ...exportData, formatBRLFromCents });
});

app.get("/whatsapp/:year/:month/:personId", ensureAuthenticated, async (req, res) => {
  const userId = req.user.id;
  const parsed = parseMonthYear(req.params.month, req.params.year);
  const personId = Number(req.params.personId);
  if (!parsed) return res.status(400).send("Parâmetros inválidos.");

  if (!isAdminUser(userId)) {
    setFlash(req, "error", "O envio via WhatsApp está disponível apenas para administradores.");
    const fallbackOrder = parseChronologicalOrder(req.query.order);
    const fallbackSuffix = fallbackOrder ? `?order=${fallbackOrder}` : '';
    return res.redirect(`/share/${req.params.year}/${req.params.month}/${personId}${fallbackSuffix}`);
  }

  const { month, year } = parsed;
  const itemOrder = parseChronologicalOrder(req.query.order) || "oldest";
  const exportData = getPersonStatementExportData(userId, month, year, personId, itemOrder);
  if (!exportData) return res.status(400).send("Pessoa inválida.");

  const shareContext = await buildSharePixContext({
    userId,
    month,
    year,
    person: exportData.person,
    totalCents: exportData.total,
    paidCents: exportData.paid_cents,
    remainingCents: exportData.remaining_cents
  });

  res.render("whatsapp", { month, year, itemOrder, shareContext, ...exportData, formatBRLFromCents });
});

function maskPhoneForLog(rawPhone) {
  const digits = String(rawPhone || '').replace(/\D/g, '');
  if (!digits) return 'sem-telefone';
  if (digits.length <= 4) return digits;
  return `${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

function summarizeAxiosError(error) {
  if (!error) return 'Erro desconhecido.';

  const status = error.response && error.response.status;
  const payload = error.response && error.response.data;
  if (typeof payload === 'string' && payload.trim()) {
    return status ? `HTTP ${status}: ${payload.trim().slice(0, 400)}` : payload.trim().slice(0, 400);
  }
  if (payload && typeof payload === 'object') {
    try {
      const compact = JSON.stringify(payload).slice(0, 400);
      return status ? `HTTP ${status}: ${compact}` : compact;
    } catch (_) {
      // segue para a próxima alternativa
    }
  }

  if (error.message) {
    return status ? `HTTP ${status}: ${error.message}` : error.message;
  }
  return status ? `HTTP ${status}` : 'Erro desconhecido.';
}

async function sendEvolutionMediaWithFallback(apiUrl, apiKey, instance, cleanNumber, message, base64Data) {
  const endpoint = `${apiUrl.replace(/\/$/, '')}/message/sendMedia/${instance}`;
  const headers = { apikey: apiKey };
  const fileName = `OrganizaPay_${new Date().toISOString().slice(0, 10)}.png`;

  const v2Payload = {
    number: cleanNumber,
    mediatype: 'image',
    mimetype: 'image/png',
    media: base64Data,
    fileName,
    caption: message,
    delay: 1200
  };

  try {
    return await axios.post(endpoint, v2Payload, { headers, timeout: 30000 });
  } catch (v2Error) {
    const status = v2Error.response && v2Error.response.status;
    const canRetryAsV1 = Boolean(v2Error.response) && [400, 404, 415, 422].includes(status);
    if (!canRetryAsV1) {
      throw v2Error;
    }

    const v1Payload = {
      number: cleanNumber,
      mediaMessage: {
        mediaType: 'image',
        fileName,
        caption: message,
        media: base64Data
      },
      options: {
        delay: 1200,
        presence: 'composing'
      }
    };

    return axios.post(endpoint, v1Payload, { headers, timeout: 30000 });
  }
}

async function sendEvolutionTextWithFallback(apiUrl, apiKey, instance, cleanNumber, message) {
  const safeMessage = String(message || '').trim();
  if (!safeMessage) return null;

  const endpoint = `${apiUrl.replace(/\/$/, '')}/message/sendText/${instance}`;
  const headers = { apikey: apiKey };

  const v2Payload = {
    number: cleanNumber,
    text: safeMessage,
    delay: 2200,
    linkPreview: false
  };

  try {
    return await axios.post(endpoint, v2Payload, { headers, timeout: 30000 });
  } catch (v2Error) {
    const status = v2Error.response && v2Error.response.status;
    const canRetryAsV1 = Boolean(v2Error.response) && [400, 404, 415, 422].includes(status);
    if (!canRetryAsV1) {
      throw v2Error;
    }

    const v1Payload = {
      number: cleanNumber,
      textMessage: {
        text: safeMessage
      },
      options: {
        delay: 2200,
        presence: 'composing',
        linkPreview: false
      }
    };

    return axios.post(endpoint, v1Payload, { headers, timeout: 30000 });
  }
}

app.post("/whatsapp/send-automation", ensureAuthenticated, express.json({ limit: '25mb' }), async (req, res) => {
  if (!isAdminUser(req.user.id)) {
    return res.status(403).json({ error: "Esse atalho de envio no WhatsApp é só para administradores." });
  }

  try {
    const { personPhone, message, followUpMessage, imageBase64 } = req.body;

    const apiUrl = getSettingText('EVOLUTION_API_URL');
    const apiKey = getSettingText('EVOLUTION_API_KEY');
    const instance = getSettingText('EVOLUTION_INSTANCE_NAME');

    if (!apiUrl || !apiKey || !instance) {
      return res.status(400).json({ error: "O envio automático no WhatsApp ainda não foi configurado." });
    }

    const cleanNumber = String(personPhone || '').replace(/\D/g, '');
    if (!cleanNumber) {
      return res.status(400).json({ error: "Essa pessoa ainda não tem um telefone válido para envio." });
    }

    const base64Data = String(imageBase64 || '').split(',')[1];
    if (!base64Data) {
      return res.status(400).json({ error: "Não consegui montar a imagem do resumo para enviar." });
    }

    await sendEvolutionMediaWithFallback(apiUrl, apiKey, instance, cleanNumber, message, base64Data);

    if (String(followUpMessage || '').trim()) {
      await sendEvolutionTextWithFallback(apiUrl, apiKey, instance, cleanNumber, followUpMessage);
    }

    res.json({ success: true });
  } catch (e) {
    const summarized = summarizeAxiosError(e);
    console.error('[whatsapp/send-automation] Falha no envio', {
      userId: req.user && req.user.id,
      phone: maskPhoneForLog(req.body && req.body.personPhone),
      messageLength: req.body && req.body.message ? String(req.body.message).length : 0,
      hasImage: Boolean(req.body && req.body.imageBase64),
      details: summarized
    });

    const status = e && e.response && e.response.status ? 502 : 500;
    res.status(status).json({ error: `Não consegui enviar esse resumo no WhatsApp agora. ${summarized}`.trim() });
  }
});
// --- ROTAS DO detalhamento ---

app.get("/finances/details/:id", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const finance = serializeFinanceForApi(userId, req.params.id);

  if (!finance) {
    return res.status(404).json({ error: "Item não encontrado." });
  }

  return res.json({
    success: true,
    finance,
    isClosed: isMonthClosed(userId, Number(finance.month), Number(finance.year))
  });
});

// 1. Adiciona nova linha (Tanto para Entradas quanto para Saídas)
app.post("/finances/add-row", ensureAuthenticated, express.json(), (req, res) => {
  const userId = req.user.id;

  try {
    const month = Number(req.body.month);
    const year = Number(req.body.year);
    const type = normalizeFinanceType(req.body.type);
    const amountMode = normalizeFinanceAmountMode(req.body.amount_mode);
    const description = sanitizeFinanceDescription(req.body.description);
    const items = amountMode === 'variable' ? sanitizeVariableFinanceItems(req.body.items) : [];

    if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2000) {
      return res.status(400).json({ error: "Mês ou ano inválido." });
    }

    if (!type) {
      return res.status(400).json({ error: "Tipo de lançamento inválido." });
    }

    if (isMonthClosed(userId, month, year)) {
      return res.status(423).json({ error: getMonthLockMessage(month, year) });
    }

    const nowIso = new Date().toISOString();
    const totalCents = amountMode === 'variable' ? sumFinanceItemCents(items) : 0;

    const insertFinance = db.prepare(`
      INSERT INTO monthly_finances (user_id, month, year, type, description, formula, amount_cents, amount_mode, created_at)
      VALUES (?, ?, ?, ?, ?, '', ?, ?, ?)
    `);

    const insertItem = db.prepare(`
      INSERT INTO monthly_finance_items (finance_id, user_id, item_date, item_source, amount_cents, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const financeId = db.transaction(() => {
      const result = insertFinance.run(userId, month, year, type, description, totalCents, amountMode, nowIso);
      const createdFinanceId = Number(result.lastInsertRowid);

      if (amountMode === 'variable') {
        for (const item of items) {
          insertItem.run(createdFinanceId, userId, item.item_date, item.item_source, item.amount_cents, nowIso, nowIso);
        }
      }

      return createdFinanceId;
    })();

    return res.json({ success: true, finance: serializeFinanceForApi(userId, financeId) });
  } catch (e) {
    const status = /certinhos|nome para esse item/i.test(String(e.message || '')) ? 400 : 500;
    return res.status(status).json({ error: getFriendlyErrorMessage(e, { defaultMessage: 'Não consegui salvar esse item agora.' }) });
  }
});

app.post("/finances/variable/:id", ensureAuthenticated, express.json(), (req, res) => {
  const userId = req.user.id;

  try {
    const id = Number(req.params.id);
    const finance = getFinanceByIdForUser(userId, id);
    if (!finance) {
      return res.status(404).json({ error: "Item não encontrado." });
    }

    if (finance.amount_mode !== 'variable') {
      return res.status(400).json({ error: "Esse item não usa vários lançamentos." });
    }

    if (isMonthClosed(userId, Number(finance.month), Number(finance.year))) {
      return res.status(423).json({ error: getMonthLockMessage(Number(finance.month), Number(finance.year)) });
    }

    const description = sanitizeFinanceDescription(req.body.description);
    const items = sanitizeVariableFinanceItems(req.body.items);
    const totalCents = sumFinanceItemCents(items);
    const nowIso = new Date().toISOString();

    const updateFinance = db.prepare(`
      UPDATE monthly_finances
      SET description = ?, formula = '', amount_cents = ?, amount_mode = 'variable'
      WHERE id = ? AND user_id = ?
    `);
    const deleteItems = db.prepare(`
      DELETE FROM monthly_finance_items
      WHERE finance_id = ? AND user_id = ?
    `);
    const insertItem = db.prepare(`
      INSERT INTO monthly_finance_items (finance_id, user_id, item_date, item_source, amount_cents, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    db.transaction(() => {
      updateFinance.run(description, totalCents, id, userId);
      deleteItems.run(id, userId);
      for (const item of items) {
        insertItem.run(id, userId, item.item_date, item.item_source, item.amount_cents, nowIso, nowIso);
      }
    })();

    return res.json({ success: true, finance: serializeFinanceForApi(userId, id) });
  } catch (e) {
    const status = /certinhos|nome para esse item/i.test(String(e.message || '')) ? 400 : 500;
    return res.status(status).json({ error: getFriendlyErrorMessage(e, { defaultMessage: 'Não consegui salvar esses lançamentos agora.' }) });
  }
});

// 2. Atualiza texto ou valor/fórmula de uma linha
app.post("/finances/update/:id", ensureAuthenticated, express.json(), (req, res) => {
  const userId = req.user.id;

  try {
    const id = Number(req.params.id);
    const { field, value, formula, amount_cents } = req.body;
    const row = getFinanceByIdForUser(userId, id);

    if (!row) {
      return res.status(404).json({ error: "Linha não encontrada." });
    }

    if (isMonthClosed(userId, Number(row.month), Number(row.year))) {
      return res.status(423).json({ error: getMonthLockMessage(Number(row.month), Number(row.year)) });
    }

    if (field === 'description') {
      db.prepare("UPDATE monthly_finances SET description = ? WHERE id = ? AND user_id = ?")
        .run(sanitizeFinanceDescription(value), id, userId);
    } else if (field === 'formula_and_value') {
      if (row.amount_mode !== 'fixed') {
        return res.status(400).json({ error: "Esse item usa vários lançamentos. Abra a lista dele para editar os lançamentos." });
      }

      const parsedAmountCents = Number.isFinite(Number(amount_cents)) ? Math.max(0, Math.round(Number(amount_cents))) : 0;
      db.prepare("UPDATE monthly_finances SET formula = ?, amount_cents = ? WHERE id = ? AND user_id = ?")
        .run(String(formula || '').trim(), parsedAmountCents, id, userId);
    } else {
      return res.status(400).json({ error: "Campo de atualização inválido." });
    }

    return res.json({ success: true, finance: serializeFinanceForApi(userId, id) });
  } catch (e) {
    const status = /nome para esse item/i.test(String(e.message || '')) ? 400 : 500;
    return res.status(status).json({ error: getFriendlyErrorMessage(e, { defaultMessage: 'Não consegui atualizar esse item agora.' }) });
  }
});

// 3. Deleta uma linha (Entrada ou Saída)
app.post("/finances/delete/:id", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const row = getFinanceByIdForUser(userId, req.params.id);

  if (!row) {
    return res.status(404).json({ error: "Linha não encontrada." });
  }

  if (isMonthClosed(userId, Number(row.month), Number(row.year))) {
    return res.status(423).json({ error: getMonthLockMessage(Number(row.month), Number(row.year)) });
  }

  db.transaction(() => {
    db.prepare("DELETE FROM monthly_finance_items WHERE finance_id = ? AND user_id = ?").run(req.params.id, userId);
    db.prepare("DELETE FROM monthly_finances WHERE id = ? AND user_id = ?").run(req.params.id, userId);
  })();

  return res.json({ success: true });
});

// 4. Salva Lembretes e Calculadora
app.post("/finances/notes/:year/:month", ensureAuthenticated, express.json(), (req, res) => {
  const userId = req.user.id;

  try {
    const { year, month } = req.params;
    const { type, content } = req.body;
    if (isMonthClosed(userId, Number(month), Number(year))) {
      return res.status(423).json({ error: getMonthLockMessage(Number(month), Number(year)) });
    }
    const column = type === 'math' ? 'content_math' : 'content_text';

    const existing = db.prepare("SELECT 1 FROM scratchpad WHERE user_id = ? AND month = ? AND year = ?").get(userId, month, year);
    if (existing) {
      db.prepare(`UPDATE scratchpad SET ${column} = ? WHERE user_id = ? AND month = ? AND year = ?`).run(content, userId, month, year);
    } else {
      const mathVal = type === 'math' ? content : '';
      const textVal = type === 'text' ? content : '';
      db.prepare(`INSERT INTO scratchpad (user_id, month, year, content_math, content_text) VALUES (?, ?, ?, ?, ?)`).run(userId, month, year, mathVal, textVal);
    }

    res.json({ success: true });
  } catch (e) {
    const details = getFriendlyErrorDetails(e, { defaultMessage: 'Não consegui salvar esse rascunho agora.' });
    res.status(details.status).json({ error: details.message });
  }
});

// Tranca ou Destranca um mês
app.post("/finances/toggle-close", ensureAuthenticated, express.json(), (req, res) => {
  const userId = req.user.id;

  try {
    const { month, year, status } = req.body;
    if (status === 'close') {
      db.prepare("INSERT OR IGNORE INTO closed_months (user_id, month, year) VALUES (?, ?, ?)").run(userId, month, year);
    } else {
      db.prepare("DELETE FROM closed_months WHERE user_id = ? AND month = ? AND year = ?").run(userId, month, year);
    }
    res.json({ success: true });
  } catch (e) {
    const details = getFriendlyErrorDetails(e, { defaultMessage: 'Não consegui mexer no cadeado desse mês agora.' });
    res.status(details.status).json({ error: details.message });
  }
});

// ===== PÁGINA DE ADMIN (GERENCIAR USUÁRIOS) =====
app.get("/admin", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;

  if (!isAdminUser(userId)) {
    return res.status(403).send('Acesso negado. Apenas administradores podem acessar esta página.');
  }

  return renderAdmin(res);
});

app.post("/admin/settings/:section", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const sectionKey = String(req.params.section || '').trim();
  const section = getSettingSection(sectionKey);

  if (!isAdminUser(userId)) {
    return res.status(403).send('Acesso negado.');
  }

  if (!section) {
    return renderAdmin(res, { error: 'Seção de configuração não encontrada.', activeSection: 'access' });
  }

  const definitions = getSettingDefinitionsBySection(sectionKey);
  const previousValues = Object.fromEntries(definitions.map((definition) => [definition.key, getSettingValue(definition.key)]));

  try {
    const nextValues = {};

    definitions.forEach((definition) => {
      const rawValue = definition.input === 'switch'
        ? (req.body[definition.key] ? '1' : '0')
        : req.body[definition.key];
      nextValues[definition.key] = sanitizeSettingValue(definition, rawValue);
    });

    if (sectionKey === 'backup') {
      const primaryDir = resolveConfiguredDirectory(__dirname, nextValues.BACKUP_LOCAL_PRIMARY_DIR, DEFAULT_PRIMARY_BACKUP_DIR);
      const secondaryDir = resolveConfiguredDirectory(__dirname, nextValues.BACKUP_LOCAL_SECONDARY_DIR, DEFAULT_SECONDARY_BACKUP_DIR);
      if (path.resolve(primaryDir) === path.resolve(secondaryDir)) {
        throw new Error('As duas pastas locais do backup precisam ser diferentes. Espelho no mesmo lugar vira só déjà vu.');
      }
    }

    updateAppSettings(nextValues, userId);

    const changedDefinitions = definitions.filter((definition) => String(previousValues[definition.key] ?? '') !== String(nextValues[definition.key] ?? ''));
    const liveChanges = changedDefinitions.filter((definition) => !definition.restartRequired);
    const restartChanges = changedDefinitions.filter((definition) => definition.restartRequired);

    let success = changedDefinitions.length
      ? `${section.title} salva com sucesso.`
      : `${section.title} conferida. Não achei nada novo para salvar.`;

    if (liveChanges.length) {
      success += ' O que dava para recarregar na hora já entrou em campo.';
    }

    if (restartChanges.length) {
      success += ` Para ${restartChanges.map((definition) => definition.label).join(', ')} valerem, reinicie o servidor.`;
    }

    if (sectionKey === 'google' && !isGoogleAuthConfigured()) {
      success += ' Enquanto Client ID e secret não estiverem completos, o login com Google segue de folga.';
    }

    if (sectionKey === 'push' && !isPushConfigured()) {
      success += ' Sem o trio VAPID completo, o sininho ainda não acorda.';
    }

    if (sectionKey === 'backup') {
      const backupConfig = getBackupRuntimeConfig();
      if (backupConfig.googleEnabled && !backupConfig.googleRefreshToken) {
        success += ' O Google Drive ficou habilitado, mas ainda falta conectar uma conta ali no bloco da seção.';
      }
    }

    return renderAdmin(res, { success, activeSection: sectionKey });
  } catch (err) {
    return renderAdmin(res, { error: getFriendlyErrorMessage(err, { defaultMessage: 'Não consegui salvar essa seção agora.' }), activeSection: sectionKey });
  }
});

app.get('/admin/backup/guide', ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  if (!isAdminUser(userId)) {
    return res.status(403).send('Acesso negado.');
  }

  const guidePath = path.join(__dirname, 'public', 'docs', 'guia-backup-organizapay.pdf');
  if (!fs.existsSync(guidePath)) {
    return renderAdmin(res, { error: 'O guia em PDF ainda não está disponível neste servidor.', activeSection: 'backup' });
  }

  return res.download(guidePath, 'guia-backup-organizapay.pdf');
});

app.get('/admin/backup/google/connect', ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  if (!isAdminUser(userId)) {
    return res.status(403).send('Acesso negado.');
  }

  try {
    const authUrl = buildGoogleBackupAuthUrl(req);
    return res.redirect(authUrl);
  } catch (error) {
    return renderAdmin(res, { error: getFriendlyErrorMessage(error, { defaultMessage: 'Não consegui preparar a conexão com o Google Drive agora.' }), activeSection: 'backup' });
  }
});

app.get('/admin/backup/google/callback', ensureAuthenticated, async (req, res) => {
  const userId = req.user.id;
  if (!isAdminUser(userId)) {
    return res.status(403).send('Acesso negado.');
  }

  const returnedState = String(req.query.state || '').trim();
  const expectedState = String(req.session?.backupGoogleAuthState || '').trim();
  delete req.session.backupGoogleAuthState;
  delete req.session.backupGoogleAuthCreatedAt;

  if (req.query.error) {
    return renderAdmin(res, {
      error: `O Google devolveu um não agora: ${String(req.query.error_description || req.query.error)}`,
      activeSection: 'backup'
    });
  }

  if (!returnedState || !expectedState || returnedState !== expectedState) {
    return renderAdmin(res, { error: 'A validação da conexão com o Google Drive não bateu. Tenta conectar de novo.', activeSection: 'backup' });
  }

  const code = String(req.query.code || '').trim();
  if (!code) {
    return renderAdmin(res, { error: 'O Google não devolveu o código de autorização do backup.', activeSection: 'backup' });
  }

  try {
    const tokens = await exchangeGoogleBackupCodeForTokens(code);
    const refreshToken = String(tokens.refresh_token || '').trim() || getInternalSettingValue(BACKUP_GOOGLE_REFRESH_TOKEN_KEY);
    if (!refreshToken) {
      throw new Error('O Google não devolveu refresh token. Revogue o acesso anterior e conecte novamente para liberar o modo automático.');
    }

    const accessToken = String(tokens.access_token || '').trim();
    const profile = accessToken ? await fetchGoogleBackupProfile(accessToken).catch(() => ({})) : {};
    const config = getBackupRuntimeConfig();
    const folder = accessToken ? await ensureGoogleBackupFolder(accessToken, { ...config, googleRefreshToken: refreshToken }, userId).catch(() => null) : null;

    setInternalSettings({
      [BACKUP_GOOGLE_REFRESH_TOKEN_KEY]: refreshToken,
      [BACKUP_GOOGLE_CONNECTED_EMAIL_KEY]: String(profile.email || config.googleConnectedEmail || '').trim(),
      [BACKUP_GOOGLE_CONNECTED_AT_KEY]: currentConfigTimestamp(),
      [BACKUP_GOOGLE_SCOPE_KEY]: String(tokens.scope || '').trim(),
      [BACKUP_GOOGLE_FOLDER_ID_KEY]: folder?.id || config.googleFolderId || '',
      [BACKUP_GOOGLE_FOLDER_NAME_META_KEY]: folder?.name || config.googleFolderName
    }, userId);

    return renderAdmin(res, {
      success: `Google Drive conectado com sucesso${profile.email ? ` na conta ${profile.email}` : ''}. Agora o backup pode subir pra nuvem também.`,
      activeSection: 'backup'
    });
  } catch (error) {
    return renderAdmin(res, {
      error: error?.response?.data?.error?.message || error.message || 'Não consegui concluir a conexão com o Google Drive agora.',
      activeSection: 'backup'
    });
  }
});

app.post('/admin/backup/google/disconnect', ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  if (!isAdminUser(userId)) {
    return res.status(403).send('Acesso negado.');
  }

  clearInternalSettings([
    BACKUP_GOOGLE_REFRESH_TOKEN_KEY,
    BACKUP_GOOGLE_CONNECTED_EMAIL_KEY,
    BACKUP_GOOGLE_CONNECTED_AT_KEY,
    BACKUP_GOOGLE_FOLDER_ID_KEY,
    BACKUP_GOOGLE_SCOPE_KEY,
    BACKUP_GOOGLE_FOLDER_NAME_META_KEY
  ], userId);

  return renderAdmin(res, {
    success: 'Conta do Google Drive desconectada. As cópias locais continuam valendo e a nuvem ficou de folga.',
    activeSection: 'backup'
  });
});

app.post('/admin/backup/run', ensureAuthenticated, async (req, res) => {
  const userId = req.user.id;
  if (!isAdminUser(userId)) {
    return res.status(403).send('Acesso negado.');
  }

  try {
    const result = await createServerBackup({ triggerKind: 'manual', createdByUserId: userId });
    return renderAdmin(res, {
      success: `${result.message} Pacote ${result.backupName} salvo com ${result.sizeBytes ? formatBytes(result.sizeBytes) : 'tamanho ainda tímido'} de puro carinho preventivo.`,
      activeSection: 'backup'
    });
  } catch (error) {
    return renderAdmin(res, {
      error: getFriendlyErrorMessage(error, { defaultMessage: 'Não consegui criar o backup manual agora.' }),
      activeSection: 'backup'
    });
  }
});

app.post('/admin/backup/restore', ensureAuthenticated, backupRestoreUpload.single('backup_zip'), async (req, res) => {
  const userId = req.user.id;
  if (!isAdminUser(userId)) {
    return res.status(403).send('Acesso negado.');
  }

  const uploadedPath = req.file?.path;
  const uploadedName = req.file?.originalname || 'backup.zip';
  if (!uploadedPath) {
    return renderAdmin(res, { error: 'Escolha um .zip de backup antes de mandar restaurar.', activeSection: 'backup' });
  }

  try {
    const result = await restoreServerBackupFromZip({
      zipPath: uploadedPath,
      uploadedFilename: uploadedName,
      restoredByUserId: userId
    });

    const extra = result.safetyBackupRunId
      ? ` Antes da restauração eu ainda gerei um backup de segurança (ID ${result.safetyBackupRunId}) para ninguém passar aperto.`
      : '';

    return renderAdmin(res, {
      success: `${result.message}${extra}`,
      activeSection: 'backup'
    });
  } catch (error) {
    return renderAdmin(res, {
      error: getFriendlyErrorMessage(error, { defaultMessage: 'Não consegui restaurar o backup agora.' }),
      activeSection: 'backup'
    });
  } finally {
    if (uploadedPath) {
      await fsp.rm(uploadedPath, { force: true }).catch(() => {});
    }
  }
});

app.get('/admin/backup/download/:backupId/:slot', ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  if (!isAdminUser(userId)) {
    return res.status(403).send('Acesso negado.');
  }

  const backupId = Number(req.params.backupId);
  const slot = String(req.params.slot || '').trim().toLowerCase();
  const row = Number.isInteger(backupId) && backupId > 0 ? backupRunsSelectById.get(backupId) : null;
  if (!row) {
    return renderAdmin(res, { error: 'Backup não encontrado para download.', activeSection: 'backup' });
  }

  const targetPath = slot === 'secondary' ? row.local_secondary_path : row.local_primary_path;
  if (!targetPath || !fs.existsSync(targetPath)) {
    return renderAdmin(res, { error: 'Esse arquivo local não está mais disponível neste servidor.', activeSection: 'backup' });
  }

  return res.download(targetPath, path.basename(targetPath));
});


app.post("/admin/add-user", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const safeEmail = normalizeEmail(req.body.email);
  const safeName = String(req.body.name || '').trim();
  const safeRole = String(req.body.role || 'user') === 'admin' ? 'admin' : 'user';
  const canImport = req.body.can_import ? 1 : 0;

  if (!isAdminUser(userId)) {
    return res.status(403).send('Acesso negado.');
  }

  if (!safeEmail || !safeEmail.includes('@')) {
    return renderAdmin(res, { error: 'Email inválido' });
  }

  const duplicatedUser = db.prepare('SELECT id FROM users WHERE email = ?').get(safeEmail);
  if (duplicatedUser) {
    return renderAdmin(res, { error: 'Esse e-mail já está autorizado por aqui. Dá uma conferida antes de convidar de novo.' });
  }

  try {
    db.prepare("INSERT INTO users (email, name, role, can_import, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(safeEmail, safeName || safeEmail.split('@')[0], safeRole, canImport, dayjs().toISOString());

    const newUser = db.prepare("SELECT id FROM users WHERE email = ?").get(safeEmail);
    const insertCat = db.prepare("INSERT OR IGNORE INTO finance_categories (user_id, name) VALUES (?, ?)");
    DEFAULT_FINANCE_CATEGORIES.forEach(cat => insertCat.run(newUser.id, cat));

    return renderAdmin(res, { success: `Usuário ${safeEmail} adicionado com sucesso!` });
  } catch (err) {
    return renderAdmin(res, { error: getFriendlyErrorMessage(err, { defaultMessage: 'Não consegui adicionar esse usuário agora.' }) });
  }
});

app.post("/admin/update-user/:id", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const targetUserId = Number(req.params.id);
  const safeEmail = normalizeEmail(req.body.email);
  const safeName = String(req.body.name || '').trim();
  const safeRole = String(req.body.role || 'user') === 'admin' ? 'admin' : 'user';
  const canImport = req.body.can_import ? 1 : 0;

  if (!isAdminUser(userId)) {
    return res.status(403).send('Acesso negado.');
  }

  if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
    return renderAdmin(res, { error: 'Usuário inválido.' });
  }

  if (!safeEmail || !safeEmail.includes('@')) {
    return renderAdmin(res, { error: 'Email inválido' });
  }

  const targetUser = getUserRecord(targetUserId);
  if (!targetUser) {
    return renderAdmin(res, { error: 'Usuário não encontrado.' });
  }

  const duplicatedEmail = db.prepare('SELECT id FROM users WHERE email = ? AND id <> ?').get(safeEmail, targetUserId);
  if (duplicatedEmail) {
    return renderAdmin(res, { error: 'Já existe outro usuário autorizado com esse email.' });
  }

  try {
    db.prepare(`
      UPDATE users
         SET email = ?,
             name = ?,
             role = ?,
             can_import = ?
       WHERE id = ?
    `).run(
      safeEmail,
      safeName || safeEmail.split('@')[0],
      safeRole,
      canImport,
      targetUserId
    );

    if (String(req.user.id) === String(targetUserId)) {
      req.user.email = safeEmail;
      req.user.name = safeName || safeEmail.split('@')[0];
      req.user.role = safeRole;
      req.user.can_import = canImport;
    }

    return renderAdmin(res, { success: 'Usuário atualizado com sucesso!' });
  } catch (err) {
    return renderAdmin(res, { error: getFriendlyErrorMessage(err, { defaultMessage: 'Não consegui atualizar esse usuário agora.' }) });
  }
});

app.post("/admin/remove-user/:id", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const targetUserId = req.params.id;

  if (!isAdminUser(userId)) {
    return res.status(403).send('Acesso negado.');
  }

  if (String(userId) === String(targetUserId)) {
    return renderAdmin(res, { error: 'Você não pode remover sua própria conta' });
  }

  try {
    const tables = ['shared_debt_payment_allocations', 'shared_debt_payment_intents', 'shared_debt_monthly_settlements', 'shared_debt_events', 'shared_debt_archives', 'shared_debt_requests', 'shared_debt_batches', 'notifications', 'allocations', 'transactions', 'imports', 'person_payments', 'card_statements', 'people', 'cards', 'monthly_finance_items', 'monthly_finances', 'scratchpad', 'finance_categories', 'closed_months', 'person_app_links', 'friendships', 'friend_requests', 'push_subscriptions', 'scheduled_push_logs'];

    for (const table of tables) {
      db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(targetUserId);
    }

    db.prepare("DELETE FROM users WHERE id = ?").run(targetUserId);

    return renderAdmin(res, { success: 'Usuário removido com sucesso!' });
  } catch (err) {
    return renderAdmin(res, { error: getFriendlyErrorMessage(err, { defaultMessage: 'Não consegui remover esse usuário agora.' }) });
  }
});

app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  return handleFriendlyErrorResponse(req, res, err, {
    defaultMessage: 'Algo tropeçou por aqui. Tenta de novo que eu seguro as pontas deste lado.',
    fallbackRedirect: req?.isAuthenticated?.() ? (res.locals.dashboardHref || '/') : '/login'
  });
});

const PORT = BOOTSTRAP_PORT || 3001;

app.listen(PORT, () => {
  console.log(`✅ Rodando em http://localhost:${PORT}`);
  startCardDueTodayPushScheduler();
});
