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
const { createSessionStore } = require('./src/app/sessionStore');
const db = require("./src/db");
const { version: APP_VERSION } = require('./package.json');
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
const {
  DEFAULT_PHONE_COUNTRY,
  buildPhoneCountryOptions,
  normalizePhoneForStorage,
  normalizePhoneForWhatsapp,
  decoratePersonPhoneForView
} = require('./src/phone');
const {
  APP_PIN_MIN_LENGTH,
  APP_PIN_MAX_LENGTH,
  APP_PIN_DEFAULT_IDLE_SECONDS,
  APP_PIN_REAUTH_WINDOW_SECONDS,
  APP_PIN_MAX_ATTEMPTS_BEFORE_REAUTH,
  APP_PIN_IDLE_OPTIONS,
  validatePinInput,
  validateNewPinInput,
  normalizePinIdleSeconds,
  getPinIdleOptionLabel,
  buildStoredPinPayload,
  verifyStoredPin,
  getPinFailurePolicy,
  formatPinCooldownLabel
} = require('./src/pinSecurity');
const {
  PASSKEY_MAX_CREDENTIALS_PER_USER,
  PASSKEY_CHALLENGE_MAX_AGE_MS,
  PASSKEY_RUNTIME_AVAILABLE,
  buildPasskeyContext,
  buildPasskeyUserHandle,
  normalizePasskeyLabel,
  generatePasskeyRegistrationOptions,
  verifyPasskeyRegistrationResponse,
  generatePasskeyAuthenticationOptions,
  verifyPasskeyAuthenticationResponse
} = require('./src/passkeySecurity');
const {
  getEmailRuntimeStatus,
  logEmailRuntimeIssue,
  verifyEmailTransport,
  sendEmail
} = require('./src/emailService');
const {
  buildWelcomeEmailTemplate,
  buildTestEmailTemplate
} = require('./src/emailTemplates');
const {
  PRIVATE_DEBT_STATUS_OPEN,
  PRIVATE_DEBT_STATUS_SETTLED,
  PRIVATE_DEBT_STATUS_CANCELLED,
  PRIVATE_DEBT_ARCHIVABLE_STATUSES,
  buildPrivateDebtPersonSnapshots,
  mapPrivateDebtReminderRow,
  sanitizePrivateDebtDescription,
  sanitizePrivateDebtNote,
  normalizePrivateDebtPaymentDate,
  normalizePrivateDebtPromisedPaymentDate,
  canArchivePrivateDebtStatus
} = require('./src/privateDebtReminders');
const { getMessageCatalog } = require('./src/messageCatalog');
const { resolveMessage } = require('./src/messageResolver');
const {
  listMessageTemplatesForAdmin,
  normalizeAdminMessageFilters,
  saveMessageTemplateCustomization,
  resetMessageTemplateCustomization
} = require('./src/messageAdminService');
const { buildMessagePreview, buildPushTestPayload } = require('./src/messagePreviewService');
const {
  buildMessageCsvExport,
  buildImportPreviewFromBuffer,
  applyImportPreview
} = require('./src/messageCsvService');
const { registerAuthRoutes, registerSecurityRoutes, registerNotificationsRoutes, registerAdminCoreRoutes, registerAdminMessagesRoutes, registerAutomationApiRoutes, registerCardsRoutes, registerFinancesRoutes, registerImportRoutes, registerSummaryRoutes, registerSharedDebtsRoutes, registerPeopleRoutes, registerSocialShareRoutes, registerMonthlyEmailSummaryRoutes } = require('./src/routes');

// Migração oficial executada explicitamente pelo bootstrap do runtime.
// Seed opcional permanece fora do bootstrap automático.

const EMAIL_RUNTIME_STATUS = getEmailRuntimeStatus();
if (!EMAIL_RUNTIME_STATUS.available) {
  console.warn('[email-runtime]', {
    available: EMAIL_RUNTIME_STATUS.available,
    module: EMAIL_RUNTIME_STATUS.module,
    message: EMAIL_RUNTIME_STATUS.loadErrorMessage || 'nodemailer não carregou neste boot.',
    code: EMAIL_RUNTIME_STATUS.loadErrorCode || null,
    requireStack: EMAIL_RUNTIME_STATUS.requireStack
  });
}

function logEmailFlowError(action, error, extra = {}) {
  console.error('[email-error]', {
    action,
    message: error?.message || 'Erro de e-mail sem mensagem.',
    code: error?.code || null,
    ...extra
  }, error?.stack || error);
}

const CARD_BRAND_OPTIONS = [
  { value: 'visa', label: 'Visa', asset: '/card-brands/visa.svg' },
  { value: 'mastercard', label: 'Mastercard', asset: '/card-brands/mastercard.svg' },
  { value: 'elo', label: 'Elo', asset: '/card-brands/elo.svg' },
  { value: 'amex', label: 'American Express', asset: '/card-brands/amex.svg' },
  { value: 'hipercard', label: 'Hipercard', asset: '/card-brands/hipercard.svg' },
  { value: 'diners', label: 'Diners Club', asset: '/card-brands/diners.svg' },
  { value: 'discover', label: 'Discover', asset: '/card-brands/discover.svg' },
  { value: 'aura', label: 'Aura', asset: '/card-brands/aura.svg' }
];

const CARD_BRAND_ALIASES = new Map([
  ['', ''],
  ['visa', 'visa'],
  ['mastercard', 'mastercard'],
  ['master', 'mastercard'],
  ['master card', 'mastercard'],
  ['elo', 'elo'],
  ['amex', 'amex'],
  ['american express', 'amex'],
  ['americanexpress', 'amex'],
  ['hipercard', 'hipercard'],
  ['diners', 'diners'],
  ['diners club', 'diners'],
  ['dinersclub', 'diners'],
  ['discover', 'discover'],
  ['aura', 'aura']
]);

function normalizeCardBrand(value) {
  const cleaned = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return CARD_BRAND_ALIASES.get(cleaned) || '';
}

function getCardBrandMeta(value) {
  const normalized = normalizeCardBrand(value);
  if (!normalized) return null;
  return CARD_BRAND_OPTIONS.find((option) => option.value === normalized) || null;
}

// Schema permanente fica exclusivamente na trilha oficial de migração (Fase 1B).
const { parseCsvByCardName } = require("./src/importers");
const { formatBRLFromCents, parseMonthYear, toISOFromBRDate, centsFromPtBrMoney } = require("./src/utils");
const { buildMonthTransactionsCsv } = require("./src/monthTransactionsCsv");
const { createSharedPurchaseProjectionService } = require("./src/services/sharedPurchaseProjection.service");
const { createAutomationApiService } = require("./src/services/automationApi.service");
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

const PROFILE_SIGNATURE_MAX_LENGTH = 60;
const PROFILE_SIGNATURE_VIBE_OPTIONS = Object.freeze([
  { code: 'paga_direitinho', label: 'Paga direitinho' },
  { code: 'cobra_com_jeitinho', label: 'Cobra com jeitinho' },
  { code: 'topa_dividir', label: 'Topa dividir' },
  { code: 'pix_sempre_pronto', label: 'Pix sempre pronto' },
  { code: 'acerta_rapidinho', label: 'Acerta rapidinho' },
  { code: 'divide_na_boa', label: 'Divide na boa' },
  { code: 'ta_em_dia', label: 'Tá em dia' },
  { code: 'bom_de_acerto', label: 'Bom de acerto' }
]);
const PROFILE_SIGNATURE_VIBE_MAP = new Map(PROFILE_SIGNATURE_VIBE_OPTIONS.map((option) => [option.code, option]));

function normalizeProfileSignatureText(value, { max = PROFILE_SIGNATURE_MAX_LENGTH } = {}) {
  return String(value || '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, Math.max(0, Number(max || 0)))
    .trim();
}

function normalizeProfileSignatureVibe(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return PROFILE_SIGNATURE_VIBE_MAP.has(normalized) ? normalized : '';
}

function getProfileSignatureVibeMeta(value) {
  const normalized = normalizeProfileSignatureVibe(value);
  return normalized ? (PROFILE_SIGNATURE_VIBE_MAP.get(normalized) || null) : null;
}

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
  const differentAmountRow = rows.find(row => Number(row.amount_cents || 0) !== baseAmount);
  if (differentAmountRow) {
    throw new Error('O valor definido só funciona quando todas as compras escolhidas têm o mesmo valor. Use partes iguais ou aplique em uma compra por vez.');
  }

  const shareSource = rawShareAmounts && typeof rawShareAmounts === 'object' ? rawShareAmounts : {};
  const shareMap = {};
  const targetSign = baseAmount < 0 ? -1 : 1;

  for (const personId of personIds) {
    const rawValue = Object.prototype.hasOwnProperty.call(shareSource, personId)
      ? shareSource[personId]
      : shareSource[String(personId)];
    const cents = normalizeShareAmountInput(rawValue);
    if (cents === null || !Number.isFinite(cents)) {
      throw new Error('Revise os valores definidos. Cada pessoa marcada precisa ter um valor válido.');
    }

    const absoluteCents = Math.abs(Math.round(cents));
    shareMap[personId] = targetSign < 0 ? -absoluteCents : absoluteCents;
  }

  const targetAbs = Math.abs(baseAmount);
  const totalDefinedAbs = personIds.reduce((sum, personId) => sum + Math.abs(Number(shareMap[personId] || 0)), 0);
  if (totalDefinedAbs !== targetAbs) {
    const diff = Math.abs(targetAbs - totalDefinedAbs);
    const diffLabel = formatBRLFromCents(diff);
    if (totalDefinedAbs < targetAbs) {
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


const app = express();
const sharedPurchaseProjectionService = createSharedPurchaseProjectionService({ db });
const automationApiService = createAutomationApiService({ db });

function getAcceptedSharedPurchaseProjections(userId, month, year, options = {}) {
  return sharedPurchaseProjectionService.getAcceptedSharedPurchaseProjections(userId, month, year, options);
}

function getAcceptedSharedPurchaseProjectionSummary(userId, month, year, options = {}) {
  return sharedPurchaseProjectionService.getAcceptedSharedPurchaseProjectionSummary(userId, month, year, options);
}

function getAcceptedSharedPurchaseProjectionPeriods(userId, options = {}) {
  if (!sharedPurchaseProjectionService || typeof sharedPurchaseProjectionService.getAcceptedSharedPurchaseProjectionPeriods !== 'function') return [];
  return sharedPurchaseProjectionService.getAcceptedSharedPurchaseProjectionPeriods(userId, options);
}

function buildEmptySharedPurchaseProjectionSummary(month, year, extra = {}) {
  return {
    enabled: sharedPurchaseProjectionService.isEnabled(),
    month: Number(month || 0),
    year: Number(year || 0),
    count: 0,
    totalCents: 0,
    confirmedPaidCents: 0,
    pendingReportedCents: 0,
    openCents: 0,
    remainingCents: 0,
    hasItems: false,
    byRequester: [],
    byCategory: [],
    rows: [],
    ...extra
  };
}

function getAcceptedSharedPurchaseProjectionSummarySafe(userId, month, year, options = {}) {
  try {
    return getAcceptedSharedPurchaseProjectionSummary(userId, month, year, options);
  } catch (error) {
    console.warn('[shared-purchase-projections] Falha ao carregar projecoes aceitas:', error?.message || error);
    return buildEmptySharedPurchaseProjectionSummary(month, year, { error: true });
  }
}

function getAcceptedSharedPurchaseProjectionPeriodsSafe(userId, options = {}) {
  try {
    return getAcceptedSharedPurchaseProjectionPeriods(userId, options);
  } catch (error) {
    console.warn('[shared-purchase-projections] Falha ao carregar competencias com projecoes:', error?.message || error);
    return [];
  }
}

const upload = multer({ storage: multer.memoryStorage() });
const backupRestoreUpload = multer({
  dest: path.join(os.tmpdir(), 'acerttapay-restore-uploads'),
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
const emailDeliveryEventsInsert = db.prepare(`
  INSERT INTO email_delivery_events (
    kind, target_user_id, recipient_email, subject, status, provider_message_id, error_message,
    attempt_no, payload_json, created_by_user_id, created_at, sent_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const emailDeliveryEventsUpdateResult = db.prepare(`
  UPDATE email_delivery_events
     SET status = ?,
         provider_message_id = ?,
         error_message = ?,
         sent_at = ?,
         updated_at = ?,
         payload_json = COALESCE(?, payload_json)
   WHERE id = ?
`);
const emailDeliveryEventsSelectRecent = db.prepare(`
  SELECT e.*, creator.name AS created_by_name, creator.email AS created_by_email, target.name AS target_user_name
    FROM email_delivery_events e
    LEFT JOIN users creator ON creator.id = e.created_by_user_id
    LEFT JOIN users target ON target.id = e.target_user_id
   ORDER BY e.created_at DESC, e.id DESC
   LIMIT ?
`);
const emailDeliveryEventsCountAttemptsForUserKind = db.prepare(`
  SELECT COUNT(*) AS total
    FROM email_delivery_events
   WHERE kind = ?
     AND COALESCE(target_user_id, 0) = ?
`);
const emailDeliveryEventsSelectLatestWelcomeByUser = db.prepare(`
  SELECT e.*
    FROM email_delivery_events e
   WHERE e.kind = 'welcome'
     AND e.target_user_id = ?
   ORDER BY e.created_at DESC, e.id DESC
   LIMIT 1
`);
const emailDeliveryEventsSelectLatestWelcomeForUsers = db.prepare(`
  SELECT e.*
    FROM email_delivery_events e
    INNER JOIN (
      SELECT target_user_id, MAX(id) AS last_id
        FROM email_delivery_events
       WHERE kind = 'welcome'
         AND target_user_id IS NOT NULL
       GROUP BY target_user_id
    ) latest ON latest.last_id = e.id
`);

let runtimeSettingsCache = {};
let appSetupCompleted = false;
let pushRuntimeEnabled = false;
let googleAuthConfigured = false;
let scheduledDuePushSweepRunning = false;
let duePushSchedulerInitialHandle = null;
let duePushSchedulerIntervalHandle = null;
let scheduledManualDebtDueSweepRunning = false;
let scheduledMonthlyFinanceAlertSweepRunning = false;
let manualDebtDueSchedulerInitialHandle = null;
let manualDebtDueSchedulerIntervalHandle = null;
let recurringSweepRunning = false;
let recurringSchedulerInitialHandle = null;
let recurringSchedulerIntervalHandle = null;
let backupSchedulerHandle = null;
let backupSchedulerNextRunAt = null;
let backupJobRunning = false;
let backupRestoreRunning = false;
const RECURRING_SYNC_INITIAL_DELAY_MS = Math.max(1000, Number(process.env.RECURRING_SYNC_INITIAL_DELAY_MS || 10000) || 10000);
const RECURRING_SYNC_INTERVAL_MINUTES = Math.max(1, Number(process.env.RECURRING_SYNC_INTERVAL_MINUTES || 5) || 5);

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

function getPushInfrastructureRuntimeConfig() {
  return {
    publicKey: getSettingText('VAPID_PUBLIC_KEY'),
    privateKey: getSettingText('VAPID_PRIVATE_KEY'),
    subject: getSettingText('VAPID_SUBJECT', 'mailto:no-reply@acerttapay.local')
  };
}

function getAutomaticAlertScheduleRuntimeConfig() {
  return {
    timezone: getSettingText('CARD_DUE_PUSH_TIMEZONE', 'America/Sao_Paulo') || 'America/Sao_Paulo',
    hour: Math.max(0, Math.min(23, Number(getSettingInt('CARD_DUE_PUSH_HOUR', 10) || 10))),
    minute: Math.max(0, Math.min(59, Number(getSettingInt('CARD_DUE_PUSH_MINUTE', 0) || 0))),
    checkIntervalMinutes: Math.max(1, Number(getSettingInt('CARD_DUE_PUSH_CHECK_INTERVAL_MINUTES', 10) || 10))
  };
}

function getCardDueTodayPushRuntimeConfig() {
  return {
    ...getPushInfrastructureRuntimeConfig(),
    ...getAutomaticAlertScheduleRuntimeConfig(),
    duePushEnabled: getSettingBoolean('CARD_DUE_PUSH_ENABLED', true),
    maxSendsPerDay: Math.max(0, Number(getSettingInt('CARD_DUE_PUSH_MAX_SENDS_PER_DAY', 1) || 0)),
    repeatIntervalMinutes: Math.max(0, Number(getSettingInt('CARD_DUE_PUSH_REPEAT_INTERVAL_MINUTES', 0) || 0))
  };
}

function getMonthlyFinanceDateAlertRuntimeConfig() {
  return {
    enabled: getSettingBoolean('MONTHLY_FINANCE_DATE_ALERT_ENABLED', true),
    ...getAutomaticAlertScheduleRuntimeConfig()
  };
}

function getDateDrivenAlertRuntimeConfig() {
  return {
    enabled: getSettingBoolean('DATE_DRIVEN_ALERTS_ENABLED', true),
    ...getAutomaticAlertScheduleRuntimeConfig()
  };
}

function getPushRuntimeConfig() {
  return getCardDueTodayPushRuntimeConfig();
}

function getEmailRuntimeConfig() {
  return {
    enabled: getSettingBoolean('WELCOME_EMAIL_ENABLED', true),
    host: getSettingText('MAIL_SMTP_HOST'),
    port: getSettingInt('MAIL_SMTP_PORT', 587),
    secure: getSettingBoolean('MAIL_SMTP_SECURE', false),
    requireTLS: getSettingBoolean('MAIL_SMTP_REQUIRE_TLS', true),
    trustSystemCA: getSettingBoolean('MAIL_SMTP_TRUST_SYSTEM_CA', false),
    allowSelfSigned: getSettingBoolean('MAIL_SMTP_ALLOW_SELF_SIGNED', false),
    servername: getSettingText('MAIL_SMTP_SERVERNAME'),
    caCert: String(getSettingValue('MAIL_SMTP_CA_CERT') || ''),
    user: getSettingText('MAIL_SMTP_USER'),
    pass: getSettingText('MAIL_SMTP_PASS'),
    fromEmail: getSettingText('MAIL_FROM_EMAIL'),
    fromName: getSettingText('MAIL_FROM_NAME', 'AcerttaPay') || 'AcerttaPay',
    replyTo: getSettingText('MAIL_REPLY_TO'),
    welcomeSubject: getSettingText('WELCOME_EMAIL_SUBJECT', 'Seu acesso ao AcerttaPay foi liberado') || 'Seu acesso ao AcerttaPay foi liberado',
    loginUrl: getSettingText('WELCOME_EMAIL_LOGIN_URL')
  };
}

function isEmailConfigured(config = getEmailRuntimeConfig()) {
  return !!(config.host && Number(config.port || 0) > 0 && config.user && config.pass && config.fromEmail);
}

function getEmailConnectionModeLabel(config = getEmailRuntimeConfig()) {
  return config.secure ? 'SMTPS' : (config.requireTLS ? 'STARTTLS' : 'SMTP');
}

function buildEmailTransportLogContext(config = getEmailRuntimeConfig()) {
  const safeConfig = config && typeof config === 'object' ? config : {};
  return {
    host: safeConfig.host || null,
    port: safeConfig.port || null,
    secure: !!safeConfig.secure,
    requireTLS: !!safeConfig.requireTLS,
    trustSystemCA: !!safeConfig.trustSystemCA,
    allowSelfSigned: !!safeConfig.allowSelfSigned,
    servername: safeConfig.servername || null,
    customCAConfigured: !!String(safeConfig.caCert || '').trim()
  };
}

function buildAppOriginFromRequest(req) {
  const forwardedProto = String(req?.get?.('x-forwarded-proto') || '').split(',')[0].trim().toLowerCase();
  const forwardedHost = String(req?.get?.('x-forwarded-host') || '').split(',')[0].trim();
  const protocol = forwardedProto || (req?.secure ? 'https' : (req?.protocol ? String(req.protocol).trim().toLowerCase() : 'http'));
  const host = forwardedHost || String(req?.get?.('host') || '').trim();
  if (!host) return '';
  return `${protocol}://${host}`;
}

function buildLoginUrl(req) {
  const explicit = getSettingText('WELCOME_EMAIL_LOGIN_URL');
  if (explicit) return explicit;
  const origin = buildAppOriginFromRequest(req);
  return origin ? `${origin}/login` : '/login';
}

function buildAppUrl(req, targetPath = '/') {
  const rawPath = String(targetPath || '/').trim();
  const safePath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
  const origin = buildAppOriginFromRequest(req);
  return origin ? `${origin}${safePath}` : safePath;
}

function sanitizeAdminEmailMessage(value) {
  return String(value || '').trim().slice(0, 280);
}

function summarizeEmailPayload(payload = {}) {
  const safe = payload && typeof payload === 'object' ? payload : {};
  const period = safe.period && typeof safe.period === 'object'
    ? { month: Number(safe.period.month || 0) || null, year: Number(safe.period.year || 0) || null }
    : null;
  const sections = safe.sections && typeof safe.sections === 'object'
    ? Object.fromEntries(Object.entries(safe.sections).map(([key, value]) => [key, !!value]))
    : null;
  const attachments = safe.attachments && typeof safe.attachments === 'object'
    ? {
        transactionsCsv: !!safe.attachments.transactionsCsv,
        csvFilename: String(safe.attachments.csvFilename || '').trim(),
        csvRowCount: Number(safe.attachments.csvRowCount || 0) || 0,
        csvByteLength: Number(safe.attachments.csvByteLength || 0) || 0
      }
    : null;
  const urls = safe.urls && typeof safe.urls === 'object'
    ? {
        appUrl: String(safe.urls.appUrl || '').trim(),
        analyticsUrl: String(safe.urls.analyticsUrl || '').trim()
      }
    : null;

  return JSON.stringify({
    loginUrl: String(safe.loginUrl || '').trim(),
    subject: String(safe.subject || '').trim(),
    preview: String(safe.preview || '').trim(),
    customMessage: sanitizeAdminEmailMessage(safe.customMessage || ''),
    period,
    sections,
    attachments,
    urls,
    accepted: Array.isArray(safe.accepted) ? safe.accepted.slice(0, 5) : [],
    rejected: Array.isArray(safe.rejected) ? safe.rejected.slice(0, 5) : [],
    response: String(safe.response || '').trim()
  });
}

function createEmailDeliveryEvent({ kind, targetUserId = null, recipientEmail, subject, attemptNo = 1, status = 'pending', payload = null, createdByUserId = null }) {
  const now = currentConfigTimestamp();
  const result = emailDeliveryEventsInsert.run(
    String(kind || 'welcome').trim() || 'welcome',
    targetUserId ? Number(targetUserId) : null,
    String(recipientEmail || '').trim(),
    String(subject || '').trim(),
    String(status || 'pending').trim() || 'pending',
    null,
    null,
    Math.max(1, Number(attemptNo || 1) || 1),
    payload ? summarizeEmailPayload(payload) : null,
    createdByUserId ? Number(createdByUserId) : null,
    now,
    null,
    now
  );
  return Number(result.lastInsertRowid || 0);
}

function finalizeEmailDeliveryEvent(eventId, { status, providerMessageId = '', errorMessage = '', payload = null } = {}) {
  const now = currentConfigTimestamp();
  const normalizedStatus = String(status || 'error').trim() || 'error';
  const sentAt = normalizedStatus === 'sent' ? now : null;
  emailDeliveryEventsUpdateResult.run(
    normalizedStatus,
    String(providerMessageId || '').trim() || null,
    String(errorMessage || '').trim() || null,
    sentAt,
    now,
    payload ? summarizeEmailPayload(payload) : null,
    Number(eventId || 0)
  );
}

function getNextEmailAttemptNo(kind, targetUserId) {
  const safeKind = String(kind || '').trim() || 'welcome';
  const safeUserId = Number(targetUserId || 0);
  if (!safeUserId) return 1;
  const row = emailDeliveryEventsCountAttemptsForUserKind.get(safeKind, safeUserId);
  return Math.max(1, Number(row?.total || 0) + 1);
}

function getNextWelcomeEmailAttemptNo(targetUserId) {
  return getNextEmailAttemptNo('welcome', targetUserId);
}

function getLatestWelcomeEmailStatusMap() {
  const rows = emailDeliveryEventsSelectLatestWelcomeForUsers.all();
  const map = new Map();
  rows.forEach((row) => {
    map.set(Number(row.target_user_id || 0), row);
  });
  return map;
}

function mapEmailDeliveryStatus(row, { timeZone = 'America/Sao_Paulo' } = {}) {
  if (!row) {
    return {
      key: 'never',
      label: 'Nunca enviado',
      tone: 'muted',
      detail: 'Ainda não saiu nenhum boas-vindas daqui.',
      sentAtLabel: '',
      errorMessage: ''
    };
  }

  const status = String(row.status || '').trim().toLowerCase();
  if (status === 'sent') {
    return {
      key: row.attempt_no > 1 ? 'resent' : 'sent',
      label: row.attempt_no > 1 ? 'Reenviado' : 'Enviado',
      tone: 'success',
      detail: row.sent_at ? `Última saída em ${formatAdminDateTime(row.sent_at, timeZone)}.` : 'Mensagem enviada com sucesso.',
      sentAtLabel: row.sent_at ? formatAdminDateTime(row.sent_at, timeZone) : '',
      errorMessage: ''
    };
  }

  if (status === 'pending') {
    return {
      key: 'pending',
      label: 'Na fila',
      tone: 'warning',
      detail: 'O disparo foi armado, mas ainda não confirmou a saída.',
      sentAtLabel: '',
      errorMessage: ''
    };
  }

  return {
    key: 'failed',
    label: 'Falhou',
    tone: 'warning',
    detail: row.error_message || 'Não consegui mandar esse e-mail agora.',
    sentAtLabel: '',
    errorMessage: row.error_message || ''
  };
}

function mapEmailDeliveryEventForAdmin(row, { timeZone = 'America/Sao_Paulo' } = {}) {
  const status = mapEmailDeliveryStatus(row, { timeZone });
  return {
    ...row,
    statusTone: status.tone,
    statusLabel: status.label,
    targetName: row.target_user_name || row.recipient_email || 'Destino',
    createdByLabel: row.created_by_name || row.created_by_email || 'Admin',
    createdAtLabel: formatAdminDateTime(row.created_at, timeZone),
    sentAtLabel: row.sent_at ? formatAdminDateTime(row.sent_at, timeZone) : '',
    errorMessage: row.error_message || ''
  };
}

async function sendWelcomeEmailToUser({ targetUser, createdByUser, customMessage = '', req }) {
  const emailConfig = getEmailRuntimeConfig();
  if (!isEmailConfigured(emailConfig)) {
    throw new Error('O SMTP ainda não está redondo. Preencha host, porta, usuário, senha e remetente antes de mandar o boas-vindas.');
  }

  const safeTarget = targetUser && typeof targetUser === 'object' ? targetUser : {};
  const safeRecipientEmail = normalizeEmail(safeTarget.email);
  if (!safeRecipientEmail) {
    throw new Error('Esse acesso ainda está sem e-mail válido para receber o boas-vindas.');
  }

  const template = buildWelcomeEmailTemplate({
    appName: 'AcerttaPay',
    recipientName: safeTarget.name || safeRecipientEmail.split('@')[0],
    adminName: createdByUser?.name || createdByUser?.email || '',
    loginUrl: buildLoginUrl(req),
    role: safeTarget.role || 'user',
    customMessage: sanitizeAdminEmailMessage(customMessage),
    subject: emailConfig.welcomeSubject
  });
  const attemptNo = getNextWelcomeEmailAttemptNo(safeTarget.id);
  const eventId = createEmailDeliveryEvent({
    kind: 'welcome',
    targetUserId: safeTarget.id,
    recipientEmail: safeRecipientEmail,
    subject: template.subject,
    attemptNo,
    payload: {
      loginUrl: buildLoginUrl(req),
      preview: template.preview,
      customMessage: sanitizeAdminEmailMessage(customMessage),
      subject: template.subject
    },
    createdByUserId: createdByUser?.id || null
  });

  try {
    const sendResult = await sendEmail(emailConfig, {
      to: safeRecipientEmail,
      subject: template.subject,
      html: template.html,
      text: template.text
    });

    finalizeEmailDeliveryEvent(eventId, {
      status: 'sent',
      providerMessageId: sendResult.messageId,
      payload: {
        loginUrl: buildLoginUrl(req),
        preview: template.preview,
        customMessage: sanitizeAdminEmailMessage(customMessage),
        subject: template.subject,
        accepted: sendResult.accepted,
        rejected: sendResult.rejected,
        response: sendResult.response
      }
    });

    return {
      eventId,
      attemptNo,
      sent: true,
      messageId: sendResult.messageId,
      subject: template.subject
    };
  } catch (error) {
    logEmailFlowError('welcome-send', error, {
      targetUserId: safeTarget.id || null,
      recipientEmail: safeRecipientEmail,
      subject: template.subject,
      ...buildEmailTransportLogContext(emailConfig)
    });
    finalizeEmailDeliveryEvent(eventId, {
      status: 'error',
      errorMessage: error?.message || 'Não consegui mandar esse e-mail agora.',
      payload: {
        loginUrl: buildLoginUrl(req),
        preview: template.preview,
        customMessage: sanitizeAdminEmailMessage(customMessage),
        subject: template.subject
      }
    });
    throw error;
  }
}

async function sendAdminTestEmail({ recipientEmail, createdByUser, req }) {
  const emailConfig = getEmailRuntimeConfig();
  if (!isEmailConfigured(emailConfig)) {
    throw new Error('Complete host, porta, usuário, senha e remetente antes de testar o e-mail.');
  }

  const safeRecipientEmail = normalizeEmail(recipientEmail);
  if (!safeRecipientEmail) {
    throw new Error('Me passa um e-mail de teste válido para eu acertar o alvo.');
  }

  const template = buildTestEmailTemplate({
    appName: 'AcerttaPay',
    recipientName: createdByUser?.name || safeRecipientEmail.split('@')[0],
    adminName: createdByUser?.name || createdByUser?.email || '',
    loginUrl: buildLoginUrl(req)
  });
  const eventId = createEmailDeliveryEvent({
    kind: 'test',
    recipientEmail: safeRecipientEmail,
    subject: template.subject,
    attemptNo: 1,
    payload: {
      loginUrl: buildLoginUrl(req),
      preview: template.preview,
      subject: template.subject
    },
    createdByUserId: createdByUser?.id || null
  });

  try {
    const sendResult = await sendEmail(emailConfig, {
      to: safeRecipientEmail,
      subject: template.subject,
      html: template.html,
      text: template.text
    });

    finalizeEmailDeliveryEvent(eventId, {
      status: 'sent',
      providerMessageId: sendResult.messageId,
      payload: {
        loginUrl: buildLoginUrl(req),
        preview: template.preview,
        subject: template.subject,
        accepted: sendResult.accepted,
        rejected: sendResult.rejected,
        response: sendResult.response
      }
    });

    return {
      eventId,
      messageId: sendResult.messageId,
      subject: template.subject
    };
  } catch (error) {
    finalizeEmailDeliveryEvent(eventId, {
      status: 'error',
      errorMessage: error?.message || 'Não consegui mandar esse e-mail de teste agora.',
      payload: {
        loginUrl: buildLoginUrl(req),
        preview: template.preview,
        subject: template.subject
      }
    });
    throw error;
  }
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
  const config = getPushInfrastructureRuntimeConfig();
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
    const email = normalizeEmail(profile.emails?.[0]?.value);
    const googleId = String(profile.id || profile?._json?.sub || '').trim();
    const profileName = String(profile.displayName || '').trim();
    const googlePhotoUrl = extractGoogleProfilePhotoUrl(profile);

    if (!email) {
      return done(null, false, { message: 'Email não encontrado no perfil Google.' });
    }

    if (!googleId) {
      return done(null, false, { message: 'Não consegui validar a identidade estável dessa conta Google.' });
    }

    try {
      let authorizedUser = db.prepare(`SELECT * FROM users WHERE google_id = ? AND COALESCE(status, 'active') <> 'deleted' LIMIT 1`).get(googleId);
      const emailMatchedUser = db.prepare(`SELECT * FROM users WHERE email = ? AND COALESCE(status, 'active') <> 'deleted' LIMIT 1`).get(email);

      if (!authorizedUser) {
        if (!emailMatchedUser) {
          return done(null, false, { message: 'Email não autorizado. Entre em contato com o administrador.' });
        }

        if (emailMatchedUser.google_id && String(emailMatchedUser.google_id).trim() !== googleId) {
          return done(null, false, { message: 'Essa conta do Google não combina com o acesso autorizado por aqui.' });
        }

        const loginAt = nowIso();
        db.prepare(`
          UPDATE users
          SET google_id = ?,
              last_login = ?,
              last_seen_at = ?,
              name = COALESCE(NULLIF(name, ''), ?),
              email = ?,
              google_photo_url = CASE WHEN ? IS NOT NULL AND trim(?) <> '' THEN ? ELSE google_photo_url END
          WHERE id = ?
        `).run(googleId, loginAt, loginAt, profileName || emailMatchedUser.name || email.split('@')[0], email, googlePhotoUrl, googlePhotoUrl, googlePhotoUrl, emailMatchedUser.id);

        authorizedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(emailMatchedUser.id);
      } else {
        if (emailMatchedUser && Number(emailMatchedUser.id || 0) !== Number(authorizedUser.id || 0)) {
          return done(null, false, { message: 'Esse e-mail do Google está ligado a outro acesso por aqui. Bora ajustar isso antes de continuar.' });
        }

        const loginAt = nowIso();
        db.prepare(`
          UPDATE users
          SET last_login = ?,
              last_seen_at = ?,
              name = COALESCE(NULLIF(name, ''), ?),
              email = CASE WHEN ? IS NOT NULL AND trim(?) <> '' THEN ? ELSE email END,
              google_photo_url = CASE WHEN ? IS NOT NULL AND trim(?) <> '' THEN ? ELSE google_photo_url END
          WHERE id = ?
        `).run(loginAt, loginAt, profileName || authorizedUser.name || email.split('@')[0], email, email, email, googlePhotoUrl, googlePhotoUrl, googlePhotoUrl, authorizedUser.id);

        authorizedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(authorizedUser.id);
      }

      ensureSelfPerson(authorizedUser.id, profileName || authorizedUser.name || email.split('@')[0], authorizedUser.email || email);
      ensurePurchaseCategoriesForUser(authorizedUser.id);

      return done(null, {
        id: authorizedUser.id,
        email: authorizedUser.email || email,
        name: authorizedUser.name || profileName || email.split('@')[0],
        role: authorizedUser.role,
        can_import: Number(authorizedUser.can_import ?? 1),
        google_photo_url: authorizedUser.google_photo_url || googlePhotoUrl || '',
        profile_photo_url: authorizedUser.profile_photo_url || '',
        profile_photo_mode: authorizedUser.profile_photo_mode || 'default'
      });
    } catch (error) {
      return done(error);
    }
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
    googleFolderName: getSettingText('BACKUP_GOOGLE_FOLDER_NAME', 'AcerttaPay Backups') || 'AcerttaPay Backups',
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

  const folderName = String(config.googleFolderName || 'AcerttaPay Backups').trim() || 'AcerttaPay Backups';
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
  const boundary = `acerttapay-${crypto.randomBytes(12).toString('hex')}`;
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
    app: 'AcerttaPay',
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
  let finalMessage = messagePrefix ? String(messagePrefix).trim() : 'Backup criado direitinho.';

  try {
    assertBackupDirectories(config);
    workspace = await createTempWorkspace('acerttapay-backup-');
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
      await fsp.rm(workspace, { recursive: true, force: true }).catch(() => { });
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
    workspace = await createTempWorkspace('acerttapay-restore-');
    const entries = await listZipEntries(zipPath);
    validateZipEntries(entries);
    await extractZip(zipPath, workspace);

    const manifestPath = path.join(workspace, BACKUP_MANIFEST_FILENAME);
    const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
    const backupSignature = String(manifest?.signature || '').trim();
    const looksLikeLegacyBackup = backupSignature.endsWith('-backup-v1');
    if (!manifest || (!looksLikeLegacyBackup && backupSignature !== BACKUP_SIGNATURE)) {
      throw new Error('O arquivo enviado não tem a assinatura oficial de backup do AcerttaPay.');
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
      'Backup restaurado direitinho. O banco voltou para a foto salva no zip.',
      safetyBackupRunId || null,
      restoredByUserId || null,
      startedAt,
      finishedAt
    );

    return {
      backupName,
      safetyBackupRunId,
      message: 'Backup restaurado direitinho. O banco voltou para a foto salva no zip.'
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
      await fsp.rm(workspace, { recursive: true, force: true }).catch(() => { });
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

function buildEmailAdminState(req, { timeZone = 'America/Sao_Paulo' } = {}) {
  const config = getEmailRuntimeConfig();
  const configured = isEmailConfigured(config);
  const recentEvents = emailDeliveryEventsSelectRecent.all(8).map((row) => mapEmailDeliveryEventForAdmin(row, { timeZone }));
  const latestEvent = recentEvents[0] || null;
  const testRecipient = normalizeEmail(req?.user?.email) || config.fromEmail || '';

  const tlsHints = [];
  if (config.trustSystemCA) tlsHints.push('CA do sistema');
  if (String(config.caCert || '').trim()) tlsHints.push('CA extra');
  if (config.allowSelfSigned) tlsHints.push('self-signed liberado');
  if (config.servername) tlsHints.push(`SNI ${config.servername}`);

  return {
    config,
    configured,
    enabled: !!config.enabled,
    active: !!config.enabled && configured,
    hostLabel: config.host || 'Host não definido',
    connectionLabel: `${getEmailConnectionModeLabel(config)} · porta ${config.port || (config.secure ? 465 : 587)}${tlsHints.length ? ` · ${tlsHints.join(' · ')}` : ''}`,
    fromLabel: config.fromEmail ? `${config.fromName || 'AcerttaPay'} <${config.fromEmail}>` : 'Remetente não definido',
    loginUrl: buildLoginUrl(req),
    testRecipient,
    recentEvents,
    latestEvent,
    helperStatus: !config.enabled
      ? 'O SMTP pode até estar pronto, mas o envio automático de boas-vindas está em folga.'
      : configured
        ? 'Tudo pronto para o admin mandar boas-vindas, testar a conexão e reenviar quando precisar.'
        : 'Faltam os ingredientes do SMTP para o e-mail entrar em campo.'
  };
}

function buildAdminUsers() {
  const users = getAllUsers();
  const statusMap = getLatestWelcomeEmailStatusMap();
  return users.map((row) => {
    const latestWelcome = statusMap.get(Number(row.id || 0)) || null;
    return {
      ...row,
      welcomeEmailStatus: mapEmailDeliveryStatus(latestWelcome),
      welcomeEmailEvent: latestWelcome
    };
  });
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

function clearManualDebtDueScheduler() {
  if (manualDebtDueSchedulerInitialHandle) {
    clearTimeout(manualDebtDueSchedulerInitialHandle);
    manualDebtDueSchedulerInitialHandle = null;
  }
  if (manualDebtDueSchedulerIntervalHandle) {
    clearInterval(manualDebtDueSchedulerIntervalHandle);
    manualDebtDueSchedulerIntervalHandle = null;
  }
}

function clearRecurringScheduler() {
  if (recurringSchedulerInitialHandle) {
    clearTimeout(recurringSchedulerInitialHandle);
    recurringSchedulerInitialHandle = null;
  }
  if (recurringSchedulerIntervalHandle) {
    clearInterval(recurringSchedulerIntervalHandle);
    recurringSchedulerIntervalHandle = null;
  }
}

async function runRecurringTransactionSweep(referenceDate = dayjs()) {
  if (recurringSweepRunning) return;
  recurringSweepRunning = true;

  try {
    const currentDate = dayjs(referenceDate);
    if (!currentDate.isValid()) return;

    const users = db.prepare(`
      SELECT DISTINCT r.user_id
      FROM recurring_rules r
      JOIN cards c ON c.id = r.card_id AND c.user_id = r.user_id
      WHERE r.status = 'active' AND COALESCE(c.active, 1) = 1
      ORDER BY r.user_id
    `).all();

    users.forEach((row) => {
      const targetUserId = Number(row?.user_id || 0);
      if (!targetUserId) return;
      try {
        syncRecurringTransactionsForUserOpenPeriod(targetUserId, currentDate);
      } catch (error) {
        console.error(`[recurring-scheduler] Falha ao sincronizar o usuario ${targetUserId}:`, error?.message || error);
      }
    });
  } finally {
    recurringSweepRunning = false;
  }
}

function restartRecurringScheduler() {
  clearRecurringScheduler();

  const intervalMs = RECURRING_SYNC_INTERVAL_MINUTES * 60 * 1000;

  recurringSchedulerInitialHandle = setTimeout(() => {
    runRecurringTransactionSweep().catch((err) => console.error('Falha no aquecimento das recorrentes do mês:', err?.message || err));
  }, RECURRING_SYNC_INITIAL_DELAY_MS);

  recurringSchedulerIntervalHandle = setInterval(() => {
    runRecurringTransactionSweep().catch((err) => console.error('Falha no job automático das recorrentes do mês:', err?.message || err));
  }, intervalMs);
}

function restartManualDebtDueScheduler() {
  clearManualDebtDueScheduler();

  const scheduleConfig = getAutomaticAlertScheduleRuntimeConfig();
  const dateDrivenConfig = getDateDrivenAlertRuntimeConfig();
  const monthlyFinanceConfig = getMonthlyFinanceDateAlertRuntimeConfig();
  if (!dateDrivenConfig.enabled && !monthlyFinanceConfig.enabled) {
    return;
  }

  const intervalMs = Math.max(1, scheduleConfig.checkIntervalMinutes) * 60 * 1000;

  manualDebtDueSchedulerInitialHandle = setTimeout(() => {
    runDateDrivenAlertSweep().catch(err => console.error('Falha no agendamento inicial dos alertas do dia:', err?.message || err));
  }, 15000);

  manualDebtDueSchedulerIntervalHandle = setInterval(() => {
    runDateDrivenAlertSweep().catch(err => console.error('Falha no agendamento recorrente dos alertas do dia:', err?.message || err));
  }, intervalMs);
}

function restartCardDueTodayPushScheduler() {
  clearCardDueTodayPushScheduler();

  const config = getCardDueTodayPushRuntimeConfig();
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
    restartManualDebtDueScheduler();
    restartRecurringScheduler();
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

function formatAdminHourMinuteLabel(hour, minute) {
  return `${String(Math.max(0, Number(hour || 0))).padStart(2, '0')}:${String(Math.max(0, Number(minute || 0))).padStart(2, '0')}`;
}

function buildPushAdminState() {
  const infrastructureConfig = getPushInfrastructureRuntimeConfig();
  const scheduleConfig = getAutomaticAlertScheduleRuntimeConfig();
  const cardDueConfig = getCardDueTodayPushRuntimeConfig();
  const monthlyFinanceConfig = getMonthlyFinanceDateAlertRuntimeConfig();
  const dateDrivenConfig = getDateDrivenAlertRuntimeConfig();
  const pushReady = isPushConfigured();

  const buildRoutineMeta = ({ key, title, description, scopeLabel, enabled, usesInternalNotification, channelLabel, helperText, fieldKeys }) => {
    let status = 'Pausada';
    let tone = 'muted';

    if (enabled) {
      if (pushReady) {
        status = 'Ligada';
        tone = 'success';
      } else if (usesInternalNotification) {
        status = 'Ligada no app';
        tone = 'success';
      } else {
        status = 'Sem canal';
        tone = 'warning';
      }
    }

    return {
      key,
      title,
      description,
      scopeLabel,
      enabled,
      usesInternalNotification,
      channelLabel: pushReady ? channelLabel : (usesInternalNotification ? 'Aviso interno' : 'Push web'),
      helperText,
      fieldKeys,
      status,
      tone
    };
  };

  const cardDueEnabled = !!cardDueConfig.duePushEnabled && Number(cardDueConfig.maxSendsPerDay || 0) > 0;
  const cardDueHelper = !cardDueConfig.duePushEnabled
    ? 'A rotina da fatura está pausada pelo interruptor principal.'
    : Number(cardDueConfig.maxSendsPerDay || 0) <= 0
      ? 'O máximo diário ficou zerado, então a rotina não dispara nenhum lembrete.'
      : Number(cardDueConfig.maxSendsPerDay || 0) > 1
        ? `Até ${cardDueConfig.maxSendsPerDay} envios por dia, com repetição a cada ${cardDueConfig.repeatIntervalMinutes} minuto(s).`
        : 'Até 1 envio por dia no horário base configurado.';

  const routines = [
    buildRoutineMeta({
      key: 'card_due_today',
      title: 'Vencimento da fatura',
      description: 'Avisa quando existe fatura vencendo hoje.',
      scopeLabel: 'Faturas vencendo hoje',
      enabled: cardDueEnabled,
      usesInternalNotification: false,
      channelLabel: 'Push web',
      helperText: cardDueHelper,
      fieldKeys: ['CARD_DUE_PUSH_ENABLED', 'CARD_DUE_PUSH_MAX_SENDS_PER_DAY', 'CARD_DUE_PUSH_REPEAT_INTERVAL_MINUTES']
    }),
    buildRoutineMeta({
      key: 'monthly_finance_date',
      title: 'Datas do mês',
      description: 'Lembra o dia marcado da grana que entra e da grana que sai.',
      scopeLabel: 'Entradas e saídas do mês',
      enabled: !!monthlyFinanceConfig.enabled,
      usesInternalNotification: true,
      channelLabel: 'Aviso interno + push web',
      helperText: pushReady
        ? 'Usa a agenda automática e também tenta tocar o sininho quando o navegador estiver pronto.'
        : 'Sem VAPID, continua deixando aviso dentro do app para não sumir no mapa.',
      fieldKeys: ['MONTHLY_FINANCE_DATE_ALERT_ENABLED']
    }),
    buildRoutineMeta({
      key: 'date_driven_alerts',
      title: 'Datas combinadas',
      description: 'Cobre cobranças avulsas com data e lembretes privados com data combinada.',
      scopeLabel: 'Cobranças avulsas e lembretes privados',
      enabled: !!dateDrivenConfig.enabled,
      usesInternalNotification: true,
      channelLabel: 'Aviso interno + push web',
      helperText: pushReady
        ? 'Usa a mesma agenda automática e deixa o histórico salvo na central do app.'
        : 'Mesmo sem push web, segue avisando na central do app quando o dia combinado chega.',
      fieldKeys: ['DATE_DRIVEN_ALERTS_ENABLED']
    })
  ];

  const activeCount = routines.filter((routine) => routine.enabled).length;
  const inAppFallbackCount = routines.filter((routine) => routine.enabled && routine.usesInternalNotification && !pushReady).length;

  return {
    infrastructure: {
      configured: pushReady,
      status: pushReady ? 'Configurado' : 'Pendente',
      tone: pushReady ? 'success' : 'warning',
      subject: infrastructureConfig.subject || 'mailto:no-reply@acerttapay.local',
      helperText: pushReady
        ? 'Com as chaves VAPID válidas, o navegador pode receber push web sem mistério.'
        : 'Sem o trio VAPID completo, nenhum push web toca neste navegador.'
    },
    schedule: {
      timezone: scheduleConfig.timezone,
      hour: scheduleConfig.hour,
      minute: scheduleConfig.minute,
      checkIntervalMinutes: scheduleConfig.checkIntervalMinutes,
      label: `${formatAdminHourMinuteLabel(scheduleConfig.hour, scheduleConfig.minute)} em ${scheduleConfig.timezone}`,
      helperText: 'Esse relógio move as rotinas automáticas de fatura, datas do mês e datas combinadas.'
    },
    routines,
    activeCount,
    totalCount: routines.length,
    inAppFallbackCount,
    hasInAppFallback: inAppFallbackCount > 0,
    pushTestHref: '/admin/messages'
  };
}

function buildAdminStatusCards(pushPanelState = null) {
  const googleReady = isGoogleAuthConfigured();
  const whatsappReady = !!(getSettingText('EVOLUTION_API_URL') && getSettingText('EVOLUTION_API_KEY') && getSettingText('EVOLUTION_INSTANCE_NAME'));
  const emailConfig = getEmailRuntimeConfig();
  const emailConfigured = isEmailConfigured(emailConfig);
  const pushPanel = pushPanelState || buildPushAdminState();
  const timeoutMinutes = getSettingInt('INACTIVITY_TIMEOUT_MINUTES', 0);
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

  const pushTone = pushPanel.infrastructure.configured
    ? (pushPanel.activeCount > 0 ? 'success' : 'muted')
    : 'warning';
  const pushStatus = pushPanel.infrastructure.configured
    ? `${pushPanel.activeCount}/${pushPanel.totalCount} ativas`
    : (pushPanel.hasInAppFallback ? 'Push parcial' : 'Push pendente');
  const pushText = pushPanel.infrastructure.configured
    ? (pushPanel.activeCount > 0
      ? `Push web pronto. Agenda automática em ${pushPanel.schedule.label} e ${pushPanel.activeCount} de ${pushPanel.totalCount} rotinas ligadas.`
      : `Push web pronto, mas nenhuma das ${pushPanel.totalCount} rotinas automáticas está ligada agora.`)
    : (pushPanel.hasInAppFallback
      ? `O push web ainda está sem VAPID completo, mas a agenda ${pushPanel.schedule.label} continua valendo para ${pushPanel.inAppFallbackCount} rotina(s) que também viram aviso interno.`
      : 'Faltam as chaves VAPID completas para o push acordar.');

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
      key: 'email',
      title: 'E-mail de boas-vindas',
      tone: emailConfigured ? (emailConfig.enabled ? 'success' : 'muted') : 'warning',
      status: !emailConfigured ? 'Falta tempero' : (emailConfig.enabled ? 'Prontinho' : 'Configurado, mas pausado'),
      text: !emailConfigured
        ? 'Ainda faltam host, porta, usuário, senha ou remetente para o convite sair por e-mail.'
        : emailConfig.enabled
          ? 'O SMTP está preparado para mandar boas-vindas e testes sem depender de gambiarras.'
          : 'O SMTP está configurado, mas o disparo automático do boas-vindas está desligado nesta rodada.'
    },
    {
      key: 'push',
      title: 'Alertas automáticos',
      tone: pushTone,
      status: pushStatus,
      text: pushText
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
const BOOTSTRAP_PORT = getSettingInt('PORT', 3000);
const DEFAULT_FINANCE_CATEGORIES = ['Prestação Apartamento', 'Luz', 'Internet', 'Condomínio', 'Tim'];
const DEFAULT_PURCHASE_CATEGORIES = [
  'Mercado',
  'Açougue',
  'Padaria',
  'Restaurante',
  'Lanche / Café',
  'Farmácia',
  'Saúde',
  'Transporte',
  'Combustível',
  'Casa',
  'Assinaturas',
  'Educação',
  'Vestuário',
  'Trabalho',
  'Lazer',
  'Pets',
  'Presentes',
  'Serviços',
  'Viagem',
  'Outros'
];

function normalizeLifecycleStatus(value, fallback = 'active') {
  const normalized = String(value || fallback || 'active').trim().toLowerCase();
  if (['active', 'inactive', 'deleted'].includes(normalized)) return normalized;
  return fallback || 'active';
}

function personLifecycleStatus(row) {
  const fallback = Number(row?.active ?? 1) === 0 ? 'inactive' : 'active';
  return normalizeLifecycleStatus(row?.status, fallback);
}

function isDeletedPersonRow(row) {
  return personLifecycleStatus(row) === 'deleted';
}

function isDeletedUserRow(row) {
  return normalizeLifecycleStatus(row?.status, 'active') === 'deleted';
}

function userNotDeletedSql(alias = 'u') {
  return `COALESCE(${alias}.status, 'active') <> 'deleted'`;
}

function personNotDeletedSql(alias = 'p') {
  return `COALESCE(${alias}.status, CASE WHEN COALESCE(${alias}.active, 1) = 0 THEN 'inactive' ELSE 'active' END) <> 'deleted'`;
}

function buildDeletedPersonLabel(personId) {
  const safeId = Number(personId || 0) || 'x';
  return `Contato removido ${safeId}`;
}

function buildDeletedPersonTechnicalName(userId, personId) {
  return `__deleted_person_${Number(userId || 0)}_${Number(personId || 0)}__`;
}

function buildDeletedUserLabel(userId) {
  const safeId = Number(userId || 0) || 'x';
  return `Acesso removido ${safeId}`;
}

function buildDeletedUserEmail(userId) {
  return `deleted-user-${Number(userId || 0)}-${Date.now()}@acerttapay.local`;
}

function getUserRecord(userId, { includeDeleted = true } = {}) {
  const safeUserId = Number(userId || 0);
  if (!safeUserId) return null;
  return db.prepare(`
    SELECT id, email, name, role, can_import, created_at, last_login, last_seen_at,
           google_id, google_photo_url, profile_photo_url, profile_photo_mode,
           profile_signature_text, profile_signature_vibe, profile_signature_updated_at,
           COALESCE(status, 'active') AS status, deleted_at, deleted_label
    FROM users
    WHERE id = ? ${includeDeleted ? '' : "AND COALESCE(status, 'active') <> 'deleted'"}
    LIMIT 1
  `).get(safeUserId);
}

function getAllUsers({ includeDeleted = false } = {}) {
  return db.prepare(`
    SELECT id, email, name, role, can_import, created_at, last_login, last_seen_at, COALESCE(status, 'active') AS status, deleted_at, deleted_label
    FROM users
    ${includeDeleted ? '' : "WHERE COALESCE(status, 'active') <> 'deleted'"}
    ORDER BY created_at DESC, id DESC
  `).all();
}

function isAdminUser(userId) {
  return getUserRecord(userId, { includeDeleted: false })?.role === 'admin';
}

function canUserImport(userId) {
  return Number(getUserRecord(userId, { includeDeleted: false })?.can_import ?? 1) !== 0;
}

function normalizeNameForIdentity(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizePurchaseCategoryName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function sanitizePurchaseCategoryLabel(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 60);
}

function ensurePurchaseCategoriesForUser(userId) {
  const safeUserId = Number(userId || 0);
  if (!safeUserId) return [];

  const existingRows = db.prepare(`
    SELECT id, normalized_name, active, sort_order
    FROM purchase_categories
    WHERE user_id = ?
  `).all(safeUserId);

  const existingByNormalized = new Map(existingRows.map((row) => [normalizePurchaseCategoryName(row.normalized_name || ''), row]));
  const insertCategory = db.prepare(`
    INSERT OR IGNORE INTO purchase_categories (user_id, name, normalized_name, kind, active, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, 'default', 1, ?, ?, ?)
  `);

  const now = nowIso();
  DEFAULT_PURCHASE_CATEGORIES.forEach((categoryName, index) => {
    const normalized = normalizePurchaseCategoryName(categoryName);
    if (!normalized || existingByNormalized.has(normalized)) return;
    insertCategory.run(safeUserId, categoryName, normalized, index + 1, now, now);
  });

  return db.prepare(`
    SELECT id, user_id, name, normalized_name, kind, active, sort_order, created_at, updated_at
    FROM purchase_categories
    WHERE user_id = ?
    ORDER BY CASE WHEN active = 1 THEN 0 ELSE 1 END,
             CASE kind WHEN 'default' THEN 0 ELSE 1 END,
             sort_order ASC,
             lower(name) ASC,
             id ASC
  `).all(safeUserId);
}

function getPurchaseCategories(userId, { includeInactive = false, includeIds = [] } = {}) {
  ensurePurchaseCategoriesForUser(userId);

  const safeUserId = Number(userId || 0);
  if (!safeUserId) return [];

  const extraIds = Array.from(new Set((includeIds || []).map(Number).filter((value) => Number.isInteger(value) && value > 0)));
  const params = [safeUserId];
  let where = 'user_id = ?';

  if (!includeInactive) {
    if (extraIds.length) {
      where += ` AND (active = 1 OR id IN (${extraIds.map(() => '?').join(', ')}))`;
      params.push(...extraIds);
    } else {
      where += ' AND active = 1';
    }
  }

  return db.prepare(`
    SELECT id, user_id, name, normalized_name, kind, active, sort_order, created_at, updated_at
    FROM purchase_categories
    WHERE ${where}
    ORDER BY CASE WHEN active = 1 THEN 0 ELSE 1 END,
             CASE kind WHEN 'default' THEN 0 ELSE 1 END,
             sort_order ASC,
             lower(name) ASC,
             id ASC
  `).all(...params);
}

function getPurchaseCategoryById(userId, categoryId, { includeInactive = false } = {}) {
  const safeCategoryId = Number(categoryId || 0);
  if (!safeCategoryId) return null;
  return db.prepare(`
    SELECT id, user_id, name, normalized_name, kind, active, sort_order, created_at, updated_at
    FROM purchase_categories
    WHERE id = ? AND user_id = ? ${includeInactive ? '' : 'AND active = 1'}
    LIMIT 1
  `).get(safeCategoryId, Number(userId || 0));
}

function createOrReusePurchaseCategory(userId, rawName) {
  const safeUserId = Number(userId || 0);
  if (!safeUserId) throw new Error('Não encontrei essa pessoa para criar a categoria.');

  ensurePurchaseCategoriesForUser(safeUserId);

  const label = sanitizePurchaseCategoryLabel(rawName);
  if (!label) {
    throw new Error('Escreva o nome da categoria antes de salvar.');
  }

  const normalized = normalizePurchaseCategoryName(label);
  if (!normalized) {
    throw new Error('Não consegui entender o nome dessa categoria.');
  }

  const existing = db.prepare(`
    SELECT id, name, active
    FROM purchase_categories
    WHERE user_id = ? AND normalized_name = ?
    LIMIT 1
  `).get(safeUserId, normalized);

  if (existing) {
    if (Number(existing.active || 0) === 0) {
      db.prepare(`
        UPDATE purchase_categories
        SET active = 1, updated_at = ?
        WHERE id = ? AND user_id = ?
      `).run(nowIso(), existing.id, safeUserId);
    }
    return getPurchaseCategoryById(safeUserId, existing.id, { includeInactive: true });
  }

  const nextSortOrder = Number(db.prepare(`
    SELECT COALESCE(MAX(sort_order), 0) AS total
    FROM purchase_categories
    WHERE user_id = ?
  `).get(safeUserId)?.total || 0) + 1;

  const info = db.prepare(`
    INSERT INTO purchase_categories (user_id, name, normalized_name, kind, active, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, 'custom', 1, ?, ?, ?)
  `).run(safeUserId, label, normalized, nextSortOrder, nowIso(), nowIso());

  return getPurchaseCategoryById(safeUserId, info.lastInsertRowid, { includeInactive: true });
}

function resolvePurchaseCategorySelection(userId, rawCategoryId, rawCustomName, { allowInactiveIds = [] } = {}) {
  const selectedValue = String(rawCategoryId || '').trim();
  const safeAllowInactiveIds = new Set((allowInactiveIds || []).map(Number).filter((value) => Number.isInteger(value) && value > 0));

  if (!selectedValue) return null;

  if (selectedValue === '__new__') {
    return Number(createOrReusePurchaseCategory(userId, rawCustomName)?.id || 0) || null;
  }

  const categoryId = Number(selectedValue);
  if (!Number.isInteger(categoryId) || categoryId <= 0) {
    throw new Error('Categoria inválida. Escolha uma opção válida.');
  }

  const category = getPurchaseCategoryById(userId, categoryId, { includeInactive: true });
  if (!category) {
    throw new Error('Não achei essa categoria por aqui.');
  }

  if (Number(category.active || 0) === 0 && !safeAllowInactiveIds.has(categoryId)) {
    throw new Error('Essa categoria está arquivada. Reative ou escolha outra.');
  }

  return categoryId;
}

function setPurchaseCategoryActiveState(userId, categoryId, active) {
  const category = getPurchaseCategoryById(userId, categoryId, { includeInactive: true });
  if (!category) throw new Error('Não achei essa categoria por aqui.');

  db.prepare(`
    UPDATE purchase_categories
    SET active = ?, updated_at = ?
    WHERE id = ? AND user_id = ?
  `).run(active ? 1 : 0, nowIso(), category.id, Number(userId || 0));

  return getPurchaseCategoryById(userId, category.id, { includeInactive: true });
}

function normalizeProfileKind(value, isOwner = false) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'self') return 'self';
  if (normalized === 'contact') return 'contact';
  return isOwner ? 'self' : 'contact';
}

function isSelfPersonRow(person) {
  return normalizeProfileKind(person?.profile_kind, Number(person?.is_owner || 0) !== 0) === 'self';
}

function buildUniqueSelfPersonName(userId, preferredName) {
  const base = String(preferredName || '').trim() || 'Meu perfil';
  const candidates = [base, `${base} (perfil)`, `${base} AcerttaPay`, `${base} Minha conta`];

  for (const candidate of candidates) {
    const exists = db.prepare(`
      SELECT id
      FROM people
      WHERE user_id = ? AND lower(name) = lower(?)
      LIMIT 1
    `).get(userId, candidate);
    if (!exists) return candidate;
  }

  let suffix = 2;
  while (suffix < 1000) {
    const candidate = `${base} (${suffix})`;
    const exists = db.prepare(`
      SELECT id
      FROM people
      WHERE user_id = ? AND lower(name) = lower(?)
      LIMIT 1
    `).get(userId, candidate);
    if (!exists) return candidate;
    suffix += 1;
  }

  return `${base} (${Date.now()})`;
}

function personHasStrongContactSignalsForUser(userId, personId) {
  const usage = db.prepare(`
    SELECT
      EXISTS(SELECT 1 FROM person_app_links WHERE owner_user_id = ? AND person_id = ?) AS has_app_link,
      EXISTS(SELECT 1 FROM friend_requests WHERE requester_user_id = ? AND source_person_id = ?) AS has_friend_history
  `).get(userId, personId, userId, personId);

  return Number(usage?.has_app_link || 0) !== 0 || Number(usage?.has_friend_history || 0) !== 0;
}

function findExistingSelfPersonCandidate(userId, preferredName, preferredEmail = null) {
  const safeEmail = normalizeEmail(preferredEmail);
  const safeNameKey = normalizeNameForIdentity(preferredName || '');
  const rows = db.prepare(`
    SELECT id, name, email, COALESCE(active, 1) AS active, COALESCE(is_owner, 0) AS is_owner, profile_kind
    FROM people
    WHERE user_id = ?
    ORDER BY COALESCE(is_owner, 0) DESC, COALESCE(active, 1) DESC, id ASC
  `).all(userId);

  const existingSelf = rows.find((row) => isSelfPersonRow(row));
  if (existingSelf) return existingSelf;

  const ownerByEmail = rows.find((row) => Number(row.is_owner || 0) !== 0 && safeEmail && normalizeEmail(row.email) === safeEmail);
  if (ownerByEmail) return ownerByEmail;

  const safeOwnerByName = rows.find((row) => {
    if (Number(row.is_owner || 0) === 0) return false;
    if (personHasStrongContactSignalsForUser(userId, row.id)) return false;
    return safeNameKey && normalizeNameForIdentity(row.name) === safeNameKey;
  });
  if (safeOwnerByName) return safeOwnerByName;

  const ownerRows = rows.filter((row) => Number(row.is_owner || 0) !== 0);
  if (ownerRows.length === 1 && !personHasStrongContactSignalsForUser(userId, ownerRows[0].id)) {
    return ownerRows[0];
  }

  return null;
}

function ensureSelfPerson(userId, preferredName, preferredEmail = null) {
  const safeUserId = Number(userId || 0);
  if (!safeUserId) return null;

  const safeEmail = normalizeEmail(preferredEmail);
  const safeName = String(preferredName || '').trim() || (safeEmail ? safeEmail.split('@')[0] : 'Meu perfil');

  db.transaction(() => {
    let target = findExistingSelfPersonCandidate(safeUserId, safeName, safeEmail);

    if (!target) {
      const createdAt = nowIso();
      const targetName = buildUniqueSelfPersonName(safeUserId, safeName);
      const inserted = db.prepare(`
        INSERT INTO people (user_id, name, phone, email, pix_enabled, pix_key_type, pix_key_value, pix_city, pix_state, pix_label, pix_updated_at, active, is_owner, profile_kind, created_at)
        VALUES (?, ?, NULL, ?, 0, NULL, NULL, NULL, NULL, NULL, NULL, 1, 1, 'self', ?)
      `).run(safeUserId, targetName, safeEmail, createdAt);

      target = {
        id: Number(inserted.lastInsertRowid || 0),
        name: targetName,
        email: safeEmail,
        profile_kind: 'self',
        is_owner: 1
      };
    }

    db.prepare(`
      UPDATE people
      SET is_owner = 0,
          profile_kind = 'contact'
      WHERE user_id = ? AND id <> ?
    `).run(safeUserId, target.id);

    db.prepare(`
      UPDATE people
      SET active = 1,
          is_owner = 1,
          profile_kind = 'self',
          email = CASE WHEN trim(COALESCE(email, '')) = '' AND ? IS NOT NULL THEN ? ELSE email END,
          name = CASE WHEN trim(COALESCE(name, '')) = '' THEN ? ELSE name END
      WHERE id = ? AND user_id = ?
    `).run(safeEmail, safeEmail, safeName, target.id, safeUserId);
  })();

  return getSelfPerson(safeUserId);
}

function ensureDefaultOwnerPerson(userId, preferredName, preferredEmail = null) {
  return ensureSelfPerson(userId, preferredName, preferredEmail);
}

function renderAdmin(res, { error = null, success = null, activeSection = 'access' } = {}) {
  const pushPanel = buildPushAdminState();

  return safeRenderView(res, 'admin', {
    title: 'AcerttaPay | Administração',
    users: buildAdminUsers(),
    error,
    success,
    activeSection,
    settingsSections: buildAdminSettingsSections(),
    statusCards: buildAdminStatusCards(pushPanel),
    backupPanel: buildBackupAdminState(),
    emailPanel: buildEmailAdminState(res?.req, { timeZone: getBackupRuntimeConfig().timeZone }),
    pushPanel,
    totalConfigItems: SETTING_DEFINITIONS.length,
    autoReloadCount: SETTING_DEFINITIONS.filter((item) => !item.restartRequired).length,
    restartRequiredCount: SETTING_DEFINITIONS.filter((item) => item.restartRequired).length,
    googleConfigured: isGoogleAuthConfigured(),
    pushConfigured: isPushConfigured(),
    emailConfigured: isEmailConfigured(getEmailRuntimeConfig())
  });
}


const ADMIN_MESSAGE_PUSH_TEST_RATE_LIMIT_MS = 12000;
const adminMessagePushTestRateLimit = new Map();

function normalizeAdminMessageActionFilters(source = {}) {
  return normalizeAdminMessageFilters({
    q: source.q,
    channel: source.channel,
    category: source.category,
    status: source.status
  });
}

function buildAdminMessagesQueryString(filters = {}, extra = {}) {
  const params = new URLSearchParams();
  const merged = { ...normalizeAdminMessageActionFilters(filters), ...extra };

  if (merged.q) params.set('q', merged.q);
  if (merged.channel && merged.channel !== 'all') params.set('channel', merged.channel);
  if (merged.category && merged.category !== 'all') params.set('category', merged.category);
  if (merged.status && merged.status !== 'all') params.set('status', merged.status);
  if (merged.open) params.set('open', merged.open);

  return params.toString();
}

function buildAdminMessagesPath(filters = {}, extra = {}) {
  const query = buildAdminMessagesQueryString(filters, extra);
  return query ? `/admin/messages?${query}` : '/admin/messages';
}

function formatAdminMessageUpdatedAt(value) {
  const parsed = dayjs(value);
  if (!value || !parsed.isValid()) return 'Ainda sem edição manual';
  return parsed.format('DD/MM/YYYY [às] HH:mm');
}

function renderAdminMessages(res, { error = null, success = null, filters = {}, openMessageKey = '', draftByMessageKey = {}, importPreview = null } = {}) {
  const pageData = listMessageTemplatesForAdmin(filters, { draftByMessageKey });

  return safeRenderView(res, 'admin-messages', {
    title: 'AcerttaPay | Mensagens do app',
    error,
    success,
    filters: pageData.filters,
    messageItems: pageData.items,
    messageFilterOptions: pageData.filterOptions,
    messageStats: pageData.stats,
    migratedMessageCount: getMessageCatalog().length,
    openMessageKey: String(openMessageKey || '').trim(),
    importPreview,
    buildAdminMessagesPath,
    formatAdminMessageUpdatedAt,
    pushConfigured: isPushConfigured(),
    pushTestRateLimitSeconds: Math.round(ADMIN_MESSAGE_PUSH_TEST_RATE_LIMIT_MS / 1000)
  });
}

function getAdminMessageImportPreview(req) {
  return req?.session?.adminMessageImportPreview || null;
}

function setAdminMessageImportPreview(req, preview) {
  if (!req?.session) return;
  req.session.adminMessageImportPreview = preview || null;
}

function clearAdminMessageImportPreview(req) {
  if (!req?.session || !Object.prototype.hasOwnProperty.call(req.session, 'adminMessageImportPreview')) return;
  delete req.session.adminMessageImportPreview;
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
  return safeRenderView(res, 'setup', {
    title: 'AcerttaPay | Primeira configuração',
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

function setImportPreview(req, preview) {
  if (!req.session) return;
  req.session.importPreview = preview || null;
}

function clearImportPreview(req) {
  if (!req.session) return;
  delete req.session.importPreview;
}

function setNoStoreHeaders(res) {
  if (!res || typeof res.set !== 'function') return;
  if (res.headersSent || res.writableEnded) return;
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
}

function safeRenderView(res, view, locals = {}) {
  if (!res || typeof res.render !== 'function') return null;
  if (res.headersSent || res.writableEnded) return null;
  return res.render(view, locals);
}

const USER_NOTIFICATION_PREFERENCE_GROUPS = Object.freeze([
  {
    key: 'friendship_activity',
    title: 'Amizades',
    description: 'Pedidos, aceitações, recusas e quando uma amizade muda de fase por aqui.'
  },
  {
    key: 'shared_debt_new',
    title: 'Novas cobranças e lembretes',
    description: 'Quando chega cobrança compartilhada, envio em lote ou lembrete avulso novo.'
  },
  {
    key: 'shared_debt_updates',
    title: 'Atualizações e respostas de cobranças',
    description: 'Quando alguém atualiza, aceita, recusa ou pede uma segunda olhada.'
  },
  {
    key: 'shared_debt_payments',
    title: 'Pagamentos',
    description: 'Quando alguém marca como pago ou confirma que o valor já caiu certinho.'
  },
  {
    key: 'monthly_pix_updates',
    title: 'Pix do mês',
    description: 'Avisos sobre Pix informado, confirmado ou devolvido para revisão.'
  },
  {
    key: 'card_due_today',
    title: 'Vencimento da fatura',
    description: 'Lembretes do dia em que uma fatura vence neste aparelho.'
  },
  {
    key: 'finance_date_alerts',
    title: 'Datas do mês',
    description: 'Avisos quando chega o dia marcado nas suas entradas e saídas.'
  },
  {
    key: 'due_date_alerts',
    title: 'Datas combinadas',
    description: 'Lembretes automáticos de cobranças avulsas e lembretes privados quando o dia combinado chega.'
  }
]);

const USER_NOTIFICATION_PREFERENCE_KEYS = USER_NOTIFICATION_PREFERENCE_GROUPS.map((group) => group.key);
const USER_NOTIFICATION_PREFERENCE_DEFAULTS = Object.freeze(USER_NOTIFICATION_PREFERENCE_KEYS.reduce((acc, key) => {
  acc[key] = 1;
  return acc;
}, {}));

function getDefaultUserNotificationPreferences(userId = null) {
  return {
    user_id: Number(userId || 0) || null,
    ...USER_NOTIFICATION_PREFERENCE_DEFAULTS,
    updated_at: null
  };
}

function normalizeNotificationPreferenceToggle(value) {
  if (value === true || value === 1) return 1;
  const normalized = String(value ?? '').trim().toLowerCase();
  return ['1', 'true', 'on', 'yes', 'sim'].includes(normalized) ? 1 : 0;
}

function getUserNotificationPreferences(userId) {
  const safeUserId = Number(userId || 0);
  if (!safeUserId) return getDefaultUserNotificationPreferences(null);

  const row = db.prepare(`
    SELECT user_id, friendship_activity, shared_debt_new, shared_debt_updates,
           shared_debt_payments, monthly_pix_updates, card_due_today, finance_date_alerts, due_date_alerts, updated_at
    FROM user_notification_preferences
    WHERE user_id = ?
    LIMIT 1
  `).get(safeUserId);

  if (!row) return getDefaultUserNotificationPreferences(safeUserId);

  const merged = {
    ...getDefaultUserNotificationPreferences(safeUserId),
    ...row
  };

  USER_NOTIFICATION_PREFERENCE_KEYS.forEach((key) => {
    merged[key] = normalizeNotificationPreferenceToggle(merged[key]);
  });

  return merged;
}

function upsertUserNotificationPreferences(userId, overrides = {}) {
  const safeUserId = Number(userId || 0);
  if (!safeUserId) throw new Error('Não encontrei essa pessoa para salvar as preferências de alerta.');

  const current = getUserNotificationPreferences(safeUserId);
  const next = {
    ...current,
    ...overrides,
    user_id: safeUserId,
    updated_at: nowIso()
  };

  USER_NOTIFICATION_PREFERENCE_KEYS.forEach((key) => {
    next[key] = normalizeNotificationPreferenceToggle(next[key]);
  });

  db.prepare(`
    INSERT INTO user_notification_preferences (
      user_id, friendship_activity, shared_debt_new, shared_debt_updates,
      shared_debt_payments, monthly_pix_updates, card_due_today, finance_date_alerts, due_date_alerts, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      friendship_activity = excluded.friendship_activity,
      shared_debt_new = excluded.shared_debt_new,
      shared_debt_updates = excluded.shared_debt_updates,
      shared_debt_payments = excluded.shared_debt_payments,
      monthly_pix_updates = excluded.monthly_pix_updates,
      card_due_today = excluded.card_due_today,
      finance_date_alerts = excluded.finance_date_alerts,
      due_date_alerts = excluded.due_date_alerts,
      updated_at = excluded.updated_at
  `).run(
    next.user_id,
    next.friendship_activity,
    next.shared_debt_new,
    next.shared_debt_updates,
    next.shared_debt_payments,
    next.monthly_pix_updates,
    next.card_due_today,
    next.finance_date_alerts,
    next.due_date_alerts,
    next.updated_at
  );

  return next;
}

function buildUserNotificationPreferenceViewModel(userId) {
  const preferences = getUserNotificationPreferences(userId);
  const groups = USER_NOTIFICATION_PREFERENCE_GROUPS.map((group) => ({
    ...group,
    enabled: Number(preferences[group.key] || 0) !== 0
  }));

  return {
    updatedAt: preferences.updated_at || null,
    enabledCount: groups.filter((group) => group.enabled).length,
    totalCount: groups.length,
    groups
  };
}

function resolveNotificationPreferenceGroupKey({ groupKey = null, type = null, title = null, relatedType = null } = {}) {
  const explicitKey = String(groupKey || '').trim();
  if (USER_NOTIFICATION_PREFERENCE_KEYS.includes(explicitKey)) return explicitKey;

  const safeType = String(type || '').trim();
  const safeRelatedType = String(relatedType || '').trim();
  const safeTitle = String(title || '').trim().toLowerCase();

  if (safeType === 'friend_request' || safeType === 'friendship_update') return 'friendship_activity';
  if (safeType === 'monthly_finance_date' || safeRelatedType === 'monthly_finance') return 'finance_date_alerts';
  if (safeRelatedType === 'shared_debt_payment_intent' || safeTitle.includes('pix do mes') || safeTitle.includes('pix do mês')) return 'monthly_pix_updates';
  if (safeTitle.includes('pagamento')) return 'shared_debt_payments';
  if (safeTitle.includes('atualiz') || safeTitle.includes('aceit') || safeTitle.includes('recus') || safeTitle.includes('contest') || safeTitle.includes('revis')) return 'shared_debt_updates';
  if (safeType === 'shared_debt_batch' || safeType === 'shared_debt_request') return 'shared_debt_new';

  return null;
}

function isUserNotificationGroupEnabled(userId, groupKey) {
  const resolvedKey = resolveNotificationPreferenceGroupKey({ groupKey });
  if (!resolvedKey) return true;
  const preferences = getUserNotificationPreferences(userId);
  return Number(preferences[resolvedKey] || 0) !== 0;
}

function getPinPepper() {
  return String(BOOTSTRAP_SESSION_SECRET || 'acerttapay-app-lock').trim() || 'acerttapay-app-lock';
}

function getDefaultUserSecuritySettings(userId = null) {
  return {
    user_id: Number(userId || 0) || null,
    pin_enabled: 0,
    pin_hash: '',
    pin_salt: '',
    pin_kdf: 'scrypt-v1',
    pin_idle_seconds: APP_PIN_DEFAULT_IDLE_SECONDS,
    failed_attempts: 0,
    locked_until: null,
    last_changed_at: null,
    updated_at: null
  };
}

function getUserSecuritySettings(userId) {
  const safeUserId = Number(userId || 0);
  if (!safeUserId) return getDefaultUserSecuritySettings(null);

  const row = db.prepare(`
    SELECT user_id,
           COALESCE(pin_enabled, 0) AS pin_enabled,
           pin_hash,
           pin_salt,
           COALESCE(pin_kdf, 'scrypt-v1') AS pin_kdf,
           COALESCE(pin_idle_seconds, ${APP_PIN_DEFAULT_IDLE_SECONDS}) AS pin_idle_seconds,
           COALESCE(failed_attempts, 0) AS failed_attempts,
           locked_until,
           last_changed_at,
           updated_at
    FROM user_security_settings
    WHERE user_id = ?
    LIMIT 1
  `).get(safeUserId);

  if (!row) {
    return getDefaultUserSecuritySettings(safeUserId);
  }

  return {
    user_id: safeUserId,
    pin_enabled: Number(row.pin_enabled || 0) !== 0 ? 1 : 0,
    pin_hash: String(row.pin_hash || '').trim(),
    pin_salt: String(row.pin_salt || '').trim(),
    pin_kdf: String(row.pin_kdf || 'scrypt-v1').trim() || 'scrypt-v1',
    pin_idle_seconds: normalizePinIdleSeconds(row.pin_idle_seconds),
    failed_attempts: Number(row.failed_attempts || 0) || 0,
    locked_until: row.locked_until || null,
    last_changed_at: row.last_changed_at || null,
    updated_at: row.updated_at || null
  };
}

function upsertUserSecuritySettings(userId, overrides = {}) {
  const safeUserId = Number(userId || 0);
  if (!safeUserId) throw new Error('Não encontrei essa pessoa para salvar a segurança do app.');

  const current = getUserSecuritySettings(safeUserId);
  const next = {
    ...current,
    ...overrides
  };

  next.user_id = safeUserId;
  next.pin_enabled = Number(next.pin_enabled || 0) !== 0 ? 1 : 0;
  next.pin_hash = next.pin_hash ? String(next.pin_hash).trim() : null;
  next.pin_salt = next.pin_salt ? String(next.pin_salt).trim() : null;
  next.pin_kdf = String(next.pin_kdf || 'scrypt-v1').trim() || 'scrypt-v1';
  next.pin_idle_seconds = normalizePinIdleSeconds(next.pin_idle_seconds);
  next.failed_attempts = Math.max(0, Number(next.failed_attempts || 0) || 0);
  next.locked_until = next.locked_until || null;
  next.last_changed_at = next.last_changed_at || current.last_changed_at || null;
  next.updated_at = next.updated_at || nowIso();

  db.prepare(`
    INSERT INTO user_security_settings (
      user_id, pin_enabled, pin_hash, pin_salt, pin_kdf, pin_idle_seconds,
      failed_attempts, locked_until, last_changed_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      pin_enabled = excluded.pin_enabled,
      pin_hash = excluded.pin_hash,
      pin_salt = excluded.pin_salt,
      pin_kdf = excluded.pin_kdf,
      pin_idle_seconds = excluded.pin_idle_seconds,
      failed_attempts = excluded.failed_attempts,
      locked_until = excluded.locked_until,
      last_changed_at = excluded.last_changed_at,
      updated_at = excluded.updated_at
  `).run(
    next.user_id,
    next.pin_enabled,
    next.pin_hash,
    next.pin_salt,
    next.pin_kdf,
    next.pin_idle_seconds,
    next.failed_attempts,
    next.locked_until,
    next.last_changed_at,
    next.updated_at
  );

  return getUserSecuritySettings(safeUserId);
}

function buildAppPinViewModel(settings = null, { reauthFresh = false } = {}) {
  const source = settings || getDefaultUserSecuritySettings(null);
  const idleSeconds = normalizePinIdleSeconds(source.pin_idle_seconds);
  return {
    enabled: Number(source.pin_enabled || 0) !== 0,
    idleSeconds,
    idleLabel: getPinIdleOptionLabel(idleSeconds),
    idleOptions: APP_PIN_IDLE_OPTIONS.map((option) => ({
      value: Number(option.value),
      label: option.label,
      selected: Number(option.value) === idleSeconds
    })),
    minLength: APP_PIN_MIN_LENGTH,
    maxLength: APP_PIN_MAX_LENGTH,
    reauthFresh: !!reauthFresh
  };
}

function enableUserAppPin(userId, pin, idleSeconds) {
  const preparedPin = validateNewPinInput(pin);
  if (!preparedPin.ok) {
    throw new Error(preparedPin.reason || 'Não consegui preparar esse PIN agora.');
  }

  const now = nowIso();
  const stored = buildStoredPinPayload(preparedPin.value, { pepper: getPinPepper() });
  return upsertUserSecuritySettings(userId, {
    pin_enabled: 1,
    pin_hash: stored.hash,
    pin_salt: stored.salt,
    pin_kdf: stored.kdf,
    pin_idle_seconds: normalizePinIdleSeconds(idleSeconds),
    failed_attempts: 0,
    locked_until: null,
    last_changed_at: now,
    updated_at: now
  });
}

function disableUserAppPin(userId) {
  const now = nowIso();
  const current = getUserSecuritySettings(userId);
  return upsertUserSecuritySettings(userId, {
    pin_enabled: 0,
    pin_hash: null,
    pin_salt: null,
    pin_kdf: 'scrypt-v1',
    pin_idle_seconds: normalizePinIdleSeconds(current.pin_idle_seconds),
    failed_attempts: 0,
    locked_until: null,
    last_changed_at: now,
    updated_at: now
  });
}

function verifyUserAppPin(userId, pin) {
  const settings = getUserSecuritySettings(userId);
  if (!settings.pin_enabled || !settings.pin_hash || !settings.pin_salt) {
    return false;
  }
  return verifyStoredPin(pin, { hash: settings.pin_hash, salt: settings.pin_salt }, { pepper: getPinPepper() });
}

function getUserAppPinGuardState(userId) {
  const settings = getUserSecuritySettings(userId);
  const failedAttempts = Math.max(0, Number(settings.failed_attempts || 0) || 0);
  const policy = getPinFailurePolicy(failedAttempts);
  const lockedUntilMs = settings.locked_until ? Date.parse(settings.locked_until) : 0;
  const safeLockedUntilMs = Number.isFinite(lockedUntilMs) ? lockedUntilMs : 0;
  const cooldownActive = !policy.requiresReauth && safeLockedUntilMs > Date.now();
  const cooldownSeconds = cooldownActive ? Math.max(1, Math.ceil((safeLockedUntilMs - Date.now()) / 1000)) : 0;

  if (!policy.requiresReauth && settings.locked_until && !cooldownActive) {
    upsertUserSecuritySettings(userId, {
      locked_until: null,
      updated_at: nowIso()
    });
    settings.locked_until = null;
  }

  return {
    settings,
    failedAttempts,
    cooldownActive,
    cooldownSeconds,
    cooldownLabel: cooldownSeconds > 0 ? formatPinCooldownLabel(cooldownSeconds) : '',
    requiresReauth: policy.requiresReauth,
    attemptsUntilPause: failedAttempts >= 5 ? 0 : Math.max(0, 5 - failedAttempts),
    policy
  };
}

function buildUserAppPinFailureMessage(guardState) {
  if (guardState?.requiresReauth) {
    return 'Por segurança, esse PIN entrou em pausa depois de muitas tentativas. Confirma sua conta Google para trocar ou desligar a proteção.';
  }
  if (guardState?.cooldownActive) {
    return `PIN não bateu por aqui. Agora vou te dar ${guardState.cooldownLabel} antes da próxima tentativa.`;
  }
  if (Number(guardState?.attemptsUntilPause || 0) === 1) {
    return 'PIN não bateu por aqui. Mais uma tentativa errada e eu dou uma pausa curtinha de 30 segundos.';
  }
  return 'PIN não bateu por aqui. Confere os números e tenta de novo.';
}

function buildAppPinGuardViewModel(userId) {
  const guardState = getUserAppPinGuardState(userId);
  let noticeTone = 'neutral';
  let noticeTitle = '';
  let noticeMessage = '';

  if (guardState.requiresReauth) {
    noticeTone = 'danger';
    noticeTitle = 'Confirmação extra pedida';
    noticeMessage = 'Depois de várias tentativas, eu pedi um reforço de segurança. Confirma sua conta Google para trocar ou desligar o PIN.';
  } else if (guardState.cooldownActive) {
    noticeTone = 'warning';
    noticeTitle = 'Hora de dar uma respirada';
    noticeMessage = `Vou segurar novas tentativas por ${guardState.cooldownLabel}. Assim a proteção continua firme, sem pressa.`;
  } else if (Number(guardState.attemptsUntilPause || 0) === 1) {
    noticeTone = 'caution';
    noticeTitle = 'Só mais uma antes da pausinha';
    noticeMessage = 'Se a próxima tentativa também escapar, eu faço uma pausa curtinha de 30 segundos antes de liberar de novo.';
  }

  return {
    failedAttempts: guardState.failedAttempts,
    cooldownActive: guardState.cooldownActive,
    cooldownRemainingSeconds: guardState.cooldownSeconds,
    cooldownRemainingLabel: guardState.cooldownLabel,
    requiresReauth: guardState.requiresReauth,
    attemptsUntilPause: guardState.attemptsUntilPause,
    maxAttemptsBeforeReauth: APP_PIN_MAX_ATTEMPTS_BEFORE_REAUTH,
    noticeTone,
    noticeTitle,
    noticeMessage
  };
}

function registerUserAppPinFailure(userId) {
  const settings = getUserSecuritySettings(userId);
  const nextFailedAttempts = Math.max(0, Number(settings.failed_attempts || 0) || 0) + 1;
  const policy = getPinFailurePolicy(nextFailedAttempts);
  const nextLockedUntil = policy.requiresReauth || policy.cooldownSeconds <= 0
    ? null
    : new Date(Date.now() + (policy.cooldownSeconds * 1000)).toISOString();

  upsertUserSecuritySettings(userId, {
    failed_attempts: nextFailedAttempts,
    locked_until: nextLockedUntil,
    updated_at: nowIso()
  });

  return getUserAppPinGuardState(userId);
}

function resetUserAppPinFailures(userId) {
  const settings = getUserSecuritySettings(userId);
  if (!Number(settings.failed_attempts || 0) && !settings.locked_until) return;
  upsertUserSecuritySettings(userId, {
    failed_attempts: 0,
    locked_until: null,
    updated_at: nowIso()
  });
}

function sanitizeInternalRedirectTarget(rawValue, fallback = '/') {
  const raw = String(rawValue || '').trim();
  const safeFallback = String(fallback || '/').trim() || '/';

  if (!raw) return safeFallback;
  if (!raw.startsWith('/')) return safeFallback;
  if (raw.startsWith('//')) return safeFallback;
  if (/^\/auth\/google(?:\/callback)?/i.test(raw)) return safeFallback;
  if (/^\/logout/i.test(raw)) return safeFallback;
  if (/^\/lock(?:$|\?)/i.test(raw)) return safeFallback;
  return raw;
}

function ensureAppLockSession(req) {
  if (!req.session) return null;
  if (!req.session.appLock || typeof req.session.appLock !== 'object') {
    req.session.appLock = {
      unlocked: false,
      lastActiveAt: 0,
      unlockedAt: 0,
      lockedAt: 0,
      reason: '',
      returnTo: ''
    };
  }
  return req.session.appLock;
}

function clearAppLockSession(req) {
  if (!req.session) return;
  delete req.session.appLock;
}

function persistSessionState(req) {
  return new Promise((resolve, reject) => {
    if (!req.session || typeof req.session.save !== 'function') {
      resolve();
      return;
    }
    req.session.save((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function lockAppSession(req, { reason = 'manual', returnTo = '' } = {}) {
  const state = ensureAppLockSession(req);
  if (!state) return null;
  state.unlocked = false;
  state.lastActiveAt = 0;
  state.unlockedAt = 0;
  state.lockedAt = Date.now();
  state.reason = String(reason || 'manual').trim() || 'manual';
  state.returnTo = sanitizeInternalRedirectTarget(returnTo, '');
  return state;
}

function unlockAppSession(req, { clearReturnTo = false } = {}) {
  const state = ensureAppLockSession(req);
  if (!state) return null;
  const now = Date.now();
  state.unlocked = true;
  state.lastActiveAt = now;
  state.unlockedAt = now;
  state.lockedAt = 0;
  state.reason = '';
  if (clearReturnTo) {
    state.returnTo = '';
  }
  return state;
}

function touchAppSession(req) {
  const state = ensureAppLockSession(req);
  if (!state || !state.unlocked) return state;
  state.lastActiveAt = Date.now();
  return state;
}

function getAppSessionState(req) {
  const state = ensureAppLockSession(req);
  return state || { unlocked: false, lastActiveAt: 0, unlockedAt: 0, lockedAt: 0, reason: '', returnTo: '' };
}

function clearPinReauthSession(req) {
  if (!req.session) return;
  delete req.session.appPinReauth;
  delete req.session.appPinReauthFlow;
}

function startPinReauthSession(req, { returnTo = '/lock?mode=recover' } = {}) {
  if (!req.session || !req.user?.id) return;
  req.session.appPinReauthFlow = {
    userId: Number(req.user.id || 0),
    returnTo: sanitizeInternalRedirectTarget(returnTo, '/lock?mode=recover'),
    startedAt: Date.now()
  };
}

function grantPinReauthSession(req, userId, { returnTo = '/lock?mode=recover' } = {}) {
  if (!req.session) return;
  req.session.appPinReauth = {
    userId: Number(userId || 0),
    returnTo: sanitizeInternalRedirectTarget(returnTo, '/lock?mode=recover'),
    grantedAt: Date.now(),
    expiresAt: Date.now() + (APP_PIN_REAUTH_WINDOW_SECONDS * 1000)
  };
  delete req.session.appPinReauthFlow;
}

function hasFreshPinReauthSession(req, userId) {
  const payload = req.session?.appPinReauth;
  if (!payload) return false;
  if (Number(payload.userId || 0) !== Number(userId || 0)) return false;
  return Number(payload.expiresAt || 0) > Date.now();
}

function clearExpiredPinReauthSession(req, userId) {
  if (!req.session?.appPinReauth) return;
  if (!hasFreshPinReauthSession(req, userId)) {
    delete req.session.appPinReauth;
  }
}

function buildAppLockRedirectUrl(req, { reason = 'locked', returnTo = null } = {}) {
  const params = new URLSearchParams();
  const target = sanitizeInternalRedirectTarget(returnTo || req.originalUrl || req.path || '/', '');
  if (reason) params.set('reason', String(reason));
  if (target) params.set('next', target);
  const suffix = params.toString();
  return suffix ? `/lock?${suffix}` : '/lock';
}

function buildAppLockRecoveryUrl(req, { reason = 'locked', returnTo = null } = {}) {
  const params = new URLSearchParams();
  const target = sanitizeInternalRedirectTarget(returnTo || req.originalUrl || req.path || '/', '');
  params.set('mode', 'recover');
  if (reason) params.set('reason', String(reason));
  if (target) params.set('next', target);
  return `/lock?${params.toString()}`;
}

function pinLockMessageForReason(reason) {
  const safeReason = String(reason || '').trim().toLowerCase();
  if (safeReason === 'idle' || safeReason === 'background') {
    return 'Travei o app por inatividade. Digite seu PIN para voltar a ver seus dados.';
  }
  if (safeReason === 'reauth-mismatch') {
    return 'Para redefinir o PIN, confirme com a mesma conta Google que está usando aqui no app.';
  }
  if (safeReason === 'manual') {
    return 'App bloqueado como você pediu. Digite seu PIN e seguimos o baile.';
  }
  return 'Seu app está protegido por PIN. Digite os números para destravar.';
}

function respondWithAppLock(req, res, { reason = 'locked', returnTo = null } = {}) {
  lockAppSession(req, { reason, returnTo: returnTo || req.originalUrl || req.path || '' });
  const redirectUrl = buildAppLockRedirectUrl(req, { reason, returnTo });
  const message = pinLockMessageForReason(reason);

  setNoStoreHeaders(res);

  if (isAjaxLikeRequest(req)) {
    res.set('X-App-Locked', '1');
    res.set('X-App-Lock-Redirect', redirectUrl);
    return res.status(423).json({
      ok: false,
      appLocked: true,
      redirect: redirectUrl,
      message
    });
  }

  return res.redirect(redirectUrl);
}

function handleAppPinGate(req, res, settings) {
  if (!settings || !settings.pin_enabled) {
    clearAppLockSession(req);
    clearExpiredPinReauthSession(req, req.user?.id);
    return null;
  }

  clearExpiredPinReauthSession(req, req.user?.id);

  const state = getAppSessionState(req);
  const idleSeconds = normalizePinIdleSeconds(settings.pin_idle_seconds);
  const idleMs = idleSeconds > 0 ? idleSeconds * 1000 : 0;
  const lastActiveAt = Number(state.lastActiveAt || 0);

  if (state.unlocked && idleMs > 0 && lastActiveAt && (Date.now() - lastActiveAt) >= idleMs) {
    return respondWithAppLock(req, res, { reason: 'idle', returnTo: req.originalUrl || req.path || '' });
  }

  if (!state.unlocked) {
    return respondWithAppLock(req, res, { reason: state.reason || 'locked', returnTo: req.originalUrl || req.path || '' });
  }

  touchAppSession(req);
  return null;
}

function normalizePinConfirmationPayload(newPinValue, confirmPinValue) {
  const preparedPin = validatePinInput(newPinValue);
  if (!preparedPin.ok) return preparedPin;

  const preparedConfirm = validatePinInput(confirmPinValue);
  if (!preparedConfirm.ok) {
    return { ok: false, value: '', reason: 'Preciso da confirmação do PIN para garantir que vocês dois estão combinando.' };
  }

  if (preparedPin.value !== preparedConfirm.value) {
    return { ok: false, value: '', reason: 'Os dois PINs não bateram. Digita de novo que eu confiro daqui.' };
  }

  return { ok: true, value: preparedPin.value };
}

function normalizePinMode(value) {
  const safeValue = String(value || '').trim().toLowerCase();
  if (safeValue === 'change') return 'change';
  return 'create';
}

function saveUserAppPinFromRequest(userId, req, { allowReauthOverride = false } = {}) {
  const settings = getUserSecuritySettings(userId);
  const mode = normalizePinMode(req.body.mode || (settings.pin_enabled ? 'change' : 'create'));
  const confirmation = normalizePinConfirmationPayload(req.body.pin, req.body.pin_confirm);
  if (!confirmation.ok) {
    throw new Error(confirmation.reason || 'Não consegui validar esse PIN agora.');
  }

  const idleSeconds = normalizePinIdleSeconds(req.body.pin_idle_seconds);
  const canBypassCurrentPin = allowReauthOverride && hasFreshPinReauthSession(req, userId);

  if (settings.pin_enabled && mode === 'change' && !canBypassCurrentPin) {
    const currentPinCheck = validatePinInput(req.body.current_pin);
    if (!currentPinCheck.ok || !verifyUserAppPin(userId, currentPinCheck.value)) {
      throw new Error('Para trocar o PIN, me confirma o PIN atual primeiro.');
    }
  }

  const saved = enableUserAppPin(userId, confirmation.value, idleSeconds);
  resetUserAppPinFailures(userId);
  unlockAppSession(req);
  if (allowReauthOverride) {
    clearPinReauthSession(req);
  }
  return saved;
}


function updateUserAppPinIdleSecondsFromRequest(userId, req, { allowReauthOverride = false } = {}) {
  const settings = getUserSecuritySettings(userId);
  if (!settings.pin_enabled) {
    throw new Error('Primeiro liga o PIN. Aí eu consigo salvar o tempo de bloqueio.');
  }

  const idleSeconds = normalizePinIdleSeconds(req.body.pin_idle_seconds);
  const canBypassCurrentPin = allowReauthOverride && hasFreshPinReauthSession(req, userId);

  if (!canBypassCurrentPin) {
    const currentPinCheck = validatePinInput(req.body.current_pin);
    if (!currentPinCheck.ok || !verifyUserAppPin(userId, currentPinCheck.value)) {
      throw new Error('Para mudar o tempo de bloqueio, me confirma o PIN atual primeiro.');
    }
  }

  const updated = upsertUserSecuritySettings(userId, {
    pin_idle_seconds: idleSeconds,
    failed_attempts: 0,
    locked_until: null,
    updated_at: nowIso()
  });

  resetUserAppPinFailures(userId);
  touchAppSession(req);
  if (allowReauthOverride) {
    clearPinReauthSession(req);
  }
  return updated;
}

function disableUserAppPinFromRequest(userId, req, { allowReauthOverride = false } = {}) {
  const settings = getUserSecuritySettings(userId);
  if (!settings.pin_enabled) {
    clearAppLockSession(req);
    if (allowReauthOverride) clearPinReauthSession(req);
    return settings;
  }

  const canBypassCurrentPin = allowReauthOverride && hasFreshPinReauthSession(req, userId);
  if (!canBypassCurrentPin) {
    const currentPinCheck = validatePinInput(req.body.current_pin);
    if (!currentPinCheck.ok || !verifyUserAppPin(userId, currentPinCheck.value)) {
      throw new Error('Para desligar o PIN, me confirma o PIN atual antes.');
    }
  }

  const updated = disableUserAppPin(userId);
  clearAppLockSession(req);
  clearPinReauthSession(req);
  return updated;
}

function ensurePasskeySessionState(req) {
  if (!req?.session) return null;
  if (!req.session.appPasskey) {
    req.session.appPasskey = {};
  }
  return req.session.appPasskey;
}

function clearExpiredPasskeySessionFlow(req, key) {
  const state = ensurePasskeySessionState(req);
  if (!state || !state[key]) return null;
  const createdAt = Number(state[key].createdAt || 0) || 0;
  if (createdAt && (Date.now() - createdAt) <= PASSKEY_CHALLENGE_MAX_AGE_MS) {
    return state[key];
  }
  delete state[key];
  return null;
}

function setPasskeySessionFlow(req, key, payload) {
  const state = ensurePasskeySessionState(req);
  if (!state) return null;
  state[key] = {
    ...payload,
    createdAt: Date.now()
  };
  return state[key];
}

function consumePasskeySessionFlow(req, key) {
  const state = ensurePasskeySessionState(req);
  if (!state) return null;
  const entry = clearExpiredPasskeySessionFlow(req, key);
  delete state[key];
  return entry || null;
}

function listUserPasskeys(userId) {
  const safeUserId = Number(userId || 0);
  if (!safeUserId) return [];
  return db.prepare(`
    SELECT id, user_id, label, public_key, counter, device_type, backed_up, transports, aaguid,
           created_at, updated_at, last_used_at, last_used_origin
    FROM user_passkeys
    WHERE user_id = ?
    ORDER BY COALESCE(last_used_at, created_at) DESC, created_at DESC
  `).all(safeUserId).map((row) => ({
    id: String(row.id || '').trim(),
    user_id: safeUserId,
    label: normalizePasskeyLabel(row.label || '', 'Este aparelho'),
    public_key: String(row.public_key || '').trim(),
    counter: Number(row.counter || 0) || 0,
    device_type: String(row.device_type || '').trim(),
    backed_up: Number(row.backed_up || 0) !== 0 ? 1 : 0,
    transports: row.transports ? (() => { try { return JSON.parse(row.transports); } catch (_error) { return []; } })() : [],
    aaguid: String(row.aaguid || '').trim(),
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    last_used_at: row.last_used_at || null,
    last_used_origin: row.last_used_origin || null
  }));
}

function getUserPasskey(userId, credentialId) {
  const safeId = String(credentialId || '').trim();
  if (!safeId) return null;
  return listUserPasskeys(userId).find((entry) => entry.id === safeId) || null;
}

function saveUserPasskey(userId, payload) {
  const safeUserId = Number(userId || 0);
  if (!safeUserId) {
    throw new Error('Não encontrei quem vai receber esse desbloqueio pelo aparelho.');
  }

  const safeId = String(payload?.id || payload?.credential_id || payload?.credentialId || '').trim();
  const safePublicKey = String(payload?.public_key || payload?.publicKey || '').trim();
  if (!safeId || !safePublicKey) {
    throw new Error('Não consegui guardar esse aparelho agora.');
  }

  const safeDeviceType = String(payload?.device_type || payload?.deviceType || '').trim() || null;
  const safeBackedUp = Number(payload?.backed_up ?? payload?.backedUp ?? 0) !== 0 ? 1 : 0;

  const now = nowIso();
  db.prepare(`
    INSERT INTO user_passkeys (
      id, user_id, label, public_key, counter, device_type, backed_up, transports, aaguid,
      created_at, updated_at, last_used_at, last_used_origin
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      user_id = excluded.user_id,
      label = excluded.label,
      public_key = excluded.public_key,
      counter = excluded.counter,
      device_type = excluded.device_type,
      backed_up = excluded.backed_up,
      transports = excluded.transports,
      aaguid = excluded.aaguid,
      updated_at = excluded.updated_at
  `).run(
    safeId,
    safeUserId,
    normalizePasskeyLabel(payload.label || '', 'Este aparelho'),
    safePublicKey,
    Number(payload.counter || 0) || 0,
    safeDeviceType,
    safeBackedUp,
    JSON.stringify(Array.isArray(payload.transports) ? payload.transports.filter(Boolean) : []),
    String(payload.aaguid || '').trim() || null,
    now,
    now,
    null,
    null
  );

  return getUserPasskey(safeUserId, safeId);
}

function deleteUserPasskey(userId, credentialId) {
  const safeUserId = Number(userId || 0);
  const safeId = String(credentialId || '').trim();
  if (!safeUserId || !safeId) return 0;
  return db.prepare(`DELETE FROM user_passkeys WHERE user_id = ? AND id = ?`).run(safeUserId, safeId).changes || 0;
}

function touchUserPasskeyUsage(userId, credentialId, { counter = 0, origin = '' } = {}) {
  const safeUserId = Number(userId || 0);
  const safeId = String(credentialId || '').trim();
  if (!safeUserId || !safeId) return;
  db.prepare(`
    UPDATE user_passkeys
    SET counter = ?, updated_at = ?, last_used_at = ?, last_used_origin = ?
    WHERE user_id = ? AND id = ?
  `).run(
    Number(counter || 0) || 0,
    nowIso(),
    nowIso(),
    String(origin || '').trim() || null,
    safeUserId,
    safeId
  );
}

function summarizePasskeyIdentifier(value) {
  const safeValue = String(value || '').trim();
  if (!safeValue) return null;
  return {
    length: safeValue.length,
    prefix: safeValue.slice(0, 12)
  };
}

function summarizePasskeyContextForLog(context = {}) {
  return {
    available: !!context?.available,
    runtimeAvailable: !!context?.runtimeAvailable,
    origin: String(context?.origin || '').trim() || null,
    rpID: String(context?.rpID || '').trim() || null,
    rpName: String(context?.rpName || '').trim() || null,
    secureContext: !!context?.secureContext,
    disabledReason: String(context?.disabledReason || '').trim() || null
  };
}

function summarizePasskeyFlowForLog(flow = null) {
  if (!flow || typeof flow !== 'object') return null;
  const createdAt = Number(flow.createdAt || 0) || 0;
  return {
    userId: Number(flow.userId || 0) || null,
    origin: String(flow.origin || '').trim() || null,
    rpID: String(flow.rpID || '').trim() || null,
    label: String(flow.label || '').trim() || null,
    challengeLength: String(flow.challenge || '').trim().length || 0,
    ageMs: createdAt ? Math.max(0, Date.now() - createdAt) : null
  };
}

function summarizePasskeyRegistrationPayload(payload = {}) {
  const safePayload = payload && typeof payload === 'object' ? payload : {};
  const safeResponse = safePayload.response && typeof safePayload.response === 'object' ? safePayload.response : {};
  const safeExtensions = safePayload.clientExtensionResults && typeof safePayload.clientExtensionResults === 'object'
    ? Object.keys(safePayload.clientExtensionResults).slice(0, 12)
    : [];

  return {
    credential: summarizePasskeyIdentifier(safePayload.id || safePayload.rawId || ''),
    rawIdLength: String(safePayload.rawId || '').trim().length || 0,
    type: String(safePayload.type || '').trim() || null,
    authenticatorAttachment: String(safePayload.authenticatorAttachment || '').trim() || null,
    clientExtensionKeys: safeExtensions,
    response: {
      clientDataJSONLength: String(safeResponse.clientDataJSON || '').trim().length || 0,
      attestationObjectLength: String(safeResponse.attestationObject || '').trim().length || 0,
      authenticatorDataLength: String(safeResponse.authenticatorData || '').trim().length || 0,
      signatureLength: String(safeResponse.signature || '').trim().length || 0,
      userHandlePresent: Object.prototype.hasOwnProperty.call(safeResponse, 'userHandle'),
      transports: Array.isArray(safeResponse.transports)
        ? safeResponse.transports.map((entry) => String(entry || '').trim()).filter(Boolean).slice(0, 8)
        : []
    }
  };
}

function buildPasskeyRequestLogContext(req, context = null) {
  const safeContext = context || buildPasskeyContext(req);
  return {
    requestId: req?.requestId || null,
    method: req?.method || null,
    path: req?.originalUrl || req?.path || null,
    userId: Number(req?.user?.id || 0) || null,
    ip: req?.ip || null,
    appOrigin: buildAppOriginFromRequest(req) || null,
    headers: {
      host: String(req?.get?.('host') || '').trim() || null,
      origin: String(req?.get?.('origin') || '').trim() || null,
      referer: String(req?.get?.('referer') || '').trim() || null,
      xForwardedHost: String(req?.get?.('x-forwarded-host') || '').split(',')[0].trim() || null,
      xForwardedProto: String(req?.get?.('x-forwarded-proto') || '').split(',')[0].trim().toLowerCase() || null,
      userAgent: String(req?.get?.('user-agent') || '').trim() || null
    },
    passkeyContext: summarizePasskeyContextForLog(safeContext)
  };
}

function summarizePasskeyErrorForLog(error) {
  return {
    name: error?.name || null,
    message: error?.message || null,
    code: error?.code || null,
    status: normalizeErrorStatus(error, 500),
    stack: error?.stack ? String(error.stack).split('\n').slice(0, 8).join('\n') : null
  };
}

function logPasskeyEvent(level, event, payload = {}) {
  const safeLevel = level === 'error' ? 'error' : 'warn';
  const emitter = safeLevel === 'error' ? console.error : console.warn;
  emitter(`[passkey] ${event}`, payload);
}

function formatPasskeyDateTimeLabel(value) {
  if (!value) return '';
  const parsed = dayjs(value);
  if (!parsed.isValid()) return '';
  return parsed.tz('America/Sao_Paulo').format('DD/MM/YYYY [às] HH:mm');
}

function buildPasskeyBadge(passkey) {
  if (Number(passkey?.backed_up || 0) !== 0) {
    return { label: 'Sincronizada', tone: 'emerald' };
  }
  return { label: 'Local', tone: 'slate' };
}

function buildPasskeyManagementViewModel(req, userId, pinSettings = null) {
  const settings = pinSettings || getUserSecuritySettings(userId);
  const context = buildPasskeyContext(req);
  const passkeys = listUserPasskeys(userId);
  const items = passkeys.map((entry) => {
    const badge = buildPasskeyBadge(entry);
    return {
      id: entry.id,
      label: entry.label,
      createdAtLabel: formatPasskeyDateTimeLabel(entry.created_at),
      lastUsedAtLabel: formatPasskeyDateTimeLabel(entry.last_used_at),
      badgeLabel: badge.label,
      badgeTone: badge.tone,
      hasBeenUsed: !!entry.last_used_at
    };
  });

  let helpText = '';
  if (!settings.pin_enabled) {
    helpText = 'Primeiro liga o PIN. Aí sim dá para preparar o desbloqueio pelo aparelho como atalho bonitinho.';
  } else if (!context.available) {
    helpText = context.disabledMessage || 'Esse desbloqueio ainda não ficou disponível neste ambiente.';
  } else if (!items.length) {
    helpText = 'Quando quiser, dá para preparar este aparelho para destravar o app com digital, rosto ou a proteção dele.';
  } else {
    helpText = 'Se o aparelho topar, você pode usar esse atalho junto com o PIN. Um complementa o outro, sem drama.';
  }

  return {
    runtimeAvailable: PASSKEY_RUNTIME_AVAILABLE,
    serverReady: context.available,
    secureContext: context.secureContext,
    disabledReason: context.disabledReason || '',
    disabledMessage: context.disabledMessage || '',
    pinEnabled: Number(settings.pin_enabled || 0) !== 0,
    canRegister: Number(settings.pin_enabled || 0) !== 0 && context.available && items.length < PASSKEY_MAX_CREDENTIALS_PER_USER,
    limitReached: items.length >= PASSKEY_MAX_CREDENTIALS_PER_USER,
    count: items.length,
    maxCount: PASSKEY_MAX_CREDENTIALS_PER_USER,
    items,
    helpText,
    rpLabel: context.rpID || '',
    originLabel: context.origin || ''
  };
}

function buildPasskeyLockViewModel(req, userId, pinSettings = null) {
  const settings = pinSettings || getUserSecuritySettings(userId);
  const context = buildPasskeyContext(req);
  const passkeys = listUserPasskeys(userId);
  const enabled = Number(settings.pin_enabled || 0) !== 0 && context.available && passkeys.length > 0;

  let message = '';
  if (!Number(settings.pin_enabled || 0)) {
    message = 'O desbloqueio pelo aparelho entra em cena junto com o PIN.';
  } else if (!passkeys.length) {
    message = 'Se quiser, depois dá para preparar este aparelho lá em Minha Rede > Segurança do app.';
  } else if (!context.available) {
    message = context.disabledMessage || 'Hoje o desbloqueio pelo aparelho não ficou disponível neste endereço.';
  } else {
    message = 'Se o seu aparelho topar, você pode entrar com digital, rosto ou a proteção dele e deixar o PIN como plano B.';
  }

  return {
    enabled,
    available: context.available,
    runtimeAvailable: PASSKEY_RUNTIME_AVAILABLE,
    secureContext: context.secureContext,
    count: passkeys.length,
    message,
    disabledMessage: context.disabledMessage || ''
  };
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

  if (/self-signed certificate/i.test(rawMessage) || ['DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN'].includes(details.code)) {
    details.status = 422;
    details.message = 'O SMTP respondeu com certificado próprio e o app barrou por segurança. O ideal é usar um certificado confiável no mailcow ou informar a CA na seção de e-mail do admin. Se for ambiente interno, dá para liberar self-signed como último recurso.';
    return details;
  }

  if (/unable to verify the first certificate|unable to get local issuer certificate|UNABLE_TO_VERIFY_LEAF_SIGNATURE/i.test(rawMessage)) {
    details.status = 422;
    details.message = 'O app não conseguiu confiar na cadeia TLS do SMTP. Vale conferir a cadeia do certificado, ligar a confiança nas CAs do sistema ou informar a CA PEM na seção de e-mail.';
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
  res.status(status);
  return safeRenderView(res, 'error', {
    title: 'AcerttaPay | Opa',
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
app.use(express.json({ limit: '30mb' }));
app.use(express.urlencoded({ limit: '30mb', extended: true }));

// --- MIDDLEWARE DE LOGGING GLOBAL ---
app.use((req, res, next) => {
  req.requestId = crypto.randomBytes(6).toString('hex');
  res.set('X-Request-Id', req.requestId);
  if (req.method === 'POST' && req.path === '/txn/manual') {
  }
  if (!res.locals.userAvatar) {
    res.locals.userAvatar = getAvatarPayload(null, 'Você');
  }
  next();
});

// --- CONFIGURAÇÃO DE SESSÃO E AUTH ---
app.use(session({
  store: createSessionStore(),
  secret: BOOTSTRAP_SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 } // 30 dias
}));

app.use(passport.initialize());
app.use(passport.session());

function isAjaxLikeRequest(req) {
  const requestedWith = String(req.get('X-Requested-With') || '').toLowerCase();
  const asyncFlag = String(req.get('X-AcerttaPay-Async') || '').toLowerCase();
  return requestedWith === 'xmlhttprequest' || requestedWith === 'fetch' || asyncFlag === '1';
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

function expireDeletedAccessSession(req, res) {
  const redirectUrl = '/login?reason=access-removed';
  setFlash(req, 'info', 'Esse acesso saiu da área ativa do app. Se precisar voltar, é só pedir um novo convite para o admin.');

  const respond = () => res.redirect(redirectUrl);
  const destroySession = () => {
    if (!req.session) return respond();
    req.session.destroy(() => respond());
  };

  if (typeof req.logout === 'function' && req.user) {
    return req.logout(() => destroySession());
  }

  return destroySession();
}

// ===== MIDDLEWARE DE AUTENTICAÇÃO =====
function buildEnsureAuthenticated({ skipPinLock = false } = {}) {
  return function ensureAuthenticatedMiddleware(req, res, next) {
    if (!req.isAuthenticated()) {
      return res.redirect(isInitialSetupRequired() ? '/setup' : '/login');
    }

    const currentUser = getUserRecord(req.user?.id, { includeDeleted: false });
    if (!currentUser) {
      return expireDeletedAccessSession(req, res);
    }

    const pinSettings = getUserSecuritySettings(currentUser.id);

    req.user = {
      ...req.user,
      id: currentUser.id,
      email: currentUser.email,
      name: currentUser.name,
      role: currentUser.role,
      can_import: Number(currentUser.can_import ?? 1),
      status: currentUser.status,
      google_photo_url: currentUser.google_photo_url || '',
      profile_photo_url: currentUser.profile_photo_url || '',
      pin_enabled: Number(pinSettings.pin_enabled || 0) !== 0 ? 1 : 0,
      pin_idle_seconds: pinSettings.pin_idle_seconds
    };

    req.appPinSettings = pinSettings;

    if (Number(pinSettings.pin_enabled || 0) !== 0) {
      setNoStoreHeaders(res);
    }

    if (!skipPinLock) {
      const lockResponse = handleAppPinGate(req, res, pinSettings);
      if (lockResponse) {
        return lockResponse;
      }
    }

    return next();
  };
}

const ensureAuthenticated = buildEnsureAuthenticated();
const ensureAuthenticatedIgnoringPin = buildEnsureAuthenticated({ skipPinLock: true });

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
registerAuthRoutes(app, {
  db,
  appSettingsUpsert,
  ensurePurchaseCategoriesForUser,
  markAppSetupCompleted,
  renderSetup,
  safeRenderView,
  passport,
  setFlash,
  isInitialSetupRequired,
  normalizeEmail,
  GOOGLE_SETUP_KEYS,
  getSettingDefinition,
  sanitizeSettingValue,
  buildSeedValue,
  currentConfigTimestamp,
  DEFAULT_FINANCE_CATEGORIES,
  refreshRuntimeSettings,
  getFriendlyErrorMessage,
  isGoogleAuthConfigured,
  clearPinReauthSession,
  sanitizeInternalRedirectTarget,
  grantPinReauthSession
});

registerSecurityRoutes(app, {
  ensureAuthenticated,
  ensureAuthenticatedIgnoringPin,
  setFlash,
  setNoStoreHeaders,
  resolvePeopleSettingsRedirectTarget,
  getPinIdleOptionLabel,
  getUserSecuritySettings,
  saveUserAppPinFromRequest,
  updateUserAppPinIdleSecondsFromRequest,
  disableUserAppPinFromRequest,
  buildPasskeyContext,
  buildPasskeyRequestLogContext,
  logPasskeyEvent,
  PASSKEY_MAX_CREDENTIALS_PER_USER,
  normalizePasskeyLabel,
  generatePasskeyRegistrationOptions,
  buildPasskeyUserHandle,
  getPinPepper,
  normalizeErrorStatus,
  summarizePasskeyErrorForLog,
  getFriendlyErrorMessage,
  verifyPasskeyRegistrationResponse,
  summarizePasskeyFlowForLog,
  summarizePasskeyRegistrationPayload,
  listUserPasskeys,
  saveUserPasskey,
  setPasskeySessionFlow,
  consumePasskeySessionFlow,
  getUserPasskey,
  deleteUserPasskey,
  generatePasskeyAuthenticationOptions,
  verifyPasskeyAuthenticationResponse,
  touchUserPasskeyUsage,
  sanitizeInternalRedirectTarget,
  clearAppLockSession,
  clearPinReauthSession,
  clearExpiredPinReauthSession,
  hasFreshPinReauthSession,
  getAppSessionState,
  ensureAppLockSession,
  getUserRecord,
  buildAppPinGuardViewModel,
  pinLockMessageForReason,
  safeRenderView,
  buildAppPinViewModel,
  buildPasskeyLockViewModel,
  getEffectiveProfilePhoto,
  verifyUserAppPin,
  getUserAppPinGuardState,
  registerUserAppPinFailure,
  buildUserAppPinFailureMessage,
  buildAppLockRecoveryUrl,
  buildAppLockRedirectUrl,
  isAjaxLikeRequest,
  resetUserAppPinFailures,
  unlockAppSession,
  lockAppSession,
  touchAppSession,
  persistSessionState,
  respondWithAppLock,
  syncRequestUserPresence,
  normalizePinIdleSeconds,
  isGoogleAuthConfigured,
  passport,
  startPinReauthSession,
  validatePinInput
});

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// NOTA: Middlewares de body-parser já foram configurados no início do arquivo

app.use(express.static(path.join(__dirname, "public")));
app.use("/vendor/html2canvas", express.static(path.join(__dirname, "node_modules", "html2canvas", "dist")));

app.use((req, res, next) => {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return next();
  }

  syncRequestUserPresence(req);
  return next();
});

app.use((req, res, next) => {
  if (!shouldSyncRecurringTransactionsForRequest(req)) {
    return next();
  }

  try {
    syncRecurringTransactionsForRequest(req);
  } catch (error) {
    console.error(`[recurring-request-sync] Falha ao sincronizar recorrentes do usuario ${req.user?.id || 'desconhecido'}:`, error?.message || error);
  }

  return next();
});

// ===== MIDDLEWARE GLOBAL =====
app.use((req, res, next) => {
  res.locals.user = null;
  res.locals.userId = null;
  res.locals.isAdmin = false;
  res.locals.canImport = false;
  res.locals.nomeTitular = "Meu Detalhamento";
  res.locals.formatDateBR = formatDateBR;
  res.locals.flash = req.session?.flash || null;
  res.locals.importReport = req.session?.importReport || null;
  res.locals.importFormSeed = req.session?.importFormSeed || null;
  res.locals.manualPurchaseDraftClearRequested = req.session?.manualPurchaseDraftClearRequested === '1';
  res.locals.unreadNotificationCount = 0;
  res.locals.readNotificationCount = 0;
  res.locals.recentNotifications = [];
  res.locals.pushNotificationsEnabled = isPushConfigured();
  res.locals.pushPublicKey = getPushPublicKey();
  res.locals.appVersion = APP_VERSION;
  res.locals.cardBrandOptions = CARD_BRAND_OPTIONS;
  res.locals.getCardBrandMeta = getCardBrandMeta;
  res.locals.currentPath = req.path || '/';
  res.locals.appPin = buildAppPinViewModel(getDefaultUserSecuritySettings(null));
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
  if (req.session?.manualPurchaseDraftClearRequested) {
    delete req.session.manualPurchaseDraftClearRequested;
  }

  if (req.isAuthenticated() && req.user?.id) {
    res.locals.unreadNotificationCount = Number(getUnreadNotificationCount(req.user.id) || 0);
    res.locals.readNotificationCount = Number(getReadNotificationCount(req.user.id) || 0);
    res.locals.recentNotifications = getNotificationsForUser(req.user.id);
    const currentUser = getUserRecord(req.user.id, { includeDeleted: false });

    if (currentUser) {
      req.user.email = currentUser.email || req.user.email;
      req.user.name = currentUser.name || req.user.name || currentUser.email;
      req.user.role = currentUser.role;
      req.user.can_import = Number(currentUser.can_import ?? 1);
      req.user.google_photo_url = currentUser.google_photo_url || '';
      req.user.profile_photo_url = currentUser.profile_photo_url || '';
      req.user.profile_photo_mode = currentUser.profile_photo_mode || 'default';
      req.user.profile_signature_text = normalizeProfileSignatureText(currentUser.profile_signature_text || '');
      req.user.profile_signature_vibe = normalizeProfileSignatureVibe(currentUser.profile_signature_vibe || '');
    }

    const pinSettings = getUserSecuritySettings(req.user.id);
    res.locals.user = req.user;
    res.locals.userAvatar = getAvatarPayload(req.user, req.user.name || req.user.email);
    res.locals.userId = req.user.id;
    res.locals.isAdmin = req.user.role === 'admin';
    res.locals.canImport = Number(req.user.can_import ?? 1) !== 0;
    res.locals.appPin = buildAppPinViewModel(pinSettings, { reauthFresh: hasFreshPinReauthSession(req, req.user.id) });

    try {
      const selfProfile = ensureSelfPerson(req.user.id, currentUser?.name || req.user.name || req.user.email, currentUser?.email || req.user.email);
      res.locals.nomeTitular = selfProfile ? `Detalhamento ${selfProfile.name}` : "Meu Detalhamento";
    } catch (e) {
      res.locals.nomeTitular = "Meu Detalhamento";
    }

    const dashboardTarget = getPreferredDashboardMonth(req.user.id);
    res.locals.dashboardHref = `/detalhamento/${dashboardTarget.year}/${dashboardTarget.month}`;
  }

  next();
});

function nowIso() { return dayjs().toISOString(); }

const USER_PRESENCE_TOUCH_INTERVAL_MS = 60 * 1000;

function touchUserPresence(userId, timestamp = null) {
  const safeUserId = Number(userId || 0);
  if (!safeUserId) return null;
  const seenAt = timestamp || nowIso();
  db.prepare(`UPDATE users SET last_seen_at = ? WHERE id = ?`).run(seenAt, safeUserId);
  return seenAt;
}

function syncRequestUserPresence(req, { force = false } = {}) {
  const safeUserId = Number(req.user?.id || req.session?.passport?.user?.id || 0);
  if (!safeUserId) return null;

  const nowMs = Date.now();
  const lastSyncedAtMs = Number(req.session?.lastSeenSyncedAt || 0);
  if (!force && lastSyncedAtMs && (nowMs - lastSyncedAtMs) < USER_PRESENCE_TOUCH_INTERVAL_MS) {
    return null;
  }

  const seenAt = touchUserPresence(safeUserId, new Date(nowMs).toISOString());
  if (req.session) {
    req.session.lastSeenSyncedAt = nowMs;
  }
  return seenAt;
}

function normalizeProfilePhotoUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('/uploads/profile-photos/')) return raw;
  if (/^https?:\/\//i.test(raw)) return raw;
  return '';
}

function normalizeProfilePhotoMode(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'manual' || raw === 'none' || raw === 'default') return raw;
  return 'default';
}

function looksLikeGoogleDefaultAvatar(value) {
  const raw = normalizeProfilePhotoUrl(value);
  if (!raw || !/googleusercontent\.com/i.test(raw)) return false;
  return /(?:\/a\/default-user|\/a\/default-user=|\/a\/default-user-|\/a-\/|[?&]default=1\b|\/AAAAAAAAAAI\/)/i.test(raw);
}

function extractGoogleProfilePhotoUrl(profile) {
  const candidates = [
    profile?.photos?.[0]?.value,
    profile?.photos?.[0]?.url,
    profile?._json?.picture,
    profile?._json?.picture?.data?.url,
    profile?._json?.image?.url
  ];

  try {
    const rawProfile = typeof profile?._raw === 'string' ? JSON.parse(profile._raw) : null;
    candidates.push(rawProfile?.picture, rawProfile?.picture?.data?.url, rawProfile?.image?.url);
  } catch (_error) { }

  for (const candidate of candidates) {
    const normalized = normalizeProfilePhotoUrl(candidate);
    if (normalized) return normalized;
  }
  return '';
}

function getEffectiveProfilePhoto(userLike) {
  if (!userLike || typeof userLike !== 'object') return '';
  const mode = normalizeProfilePhotoMode(userLike.profile_photo_mode);
  const manualPhoto = normalizeProfilePhotoUrl(userLike.profile_photo_url);
  const googlePhoto = normalizeProfilePhotoUrl(userLike.google_photo_url);
  const safeGooglePhoto = looksLikeGoogleDefaultAvatar(googlePhoto) ? '' : googlePhoto;
  if (mode === 'none') return '';
  if (manualPhoto) return manualPhoto;
  if (mode === 'manual') return '';
  return safeGooglePhoto || '';
}

function isManagedProfilePhotoPath(value) {
  const normalized = normalizeProfilePhotoUrl(value);
  return normalized.startsWith('/uploads/profile-photos/');
}

async function removeManagedProfilePhoto(value) {
  const normalized = normalizeProfilePhotoUrl(value);
  if (!normalized || !normalized.startsWith('/uploads/profile-photos/')) return;
  const targetPath = path.join(__dirname, 'public', normalized.replace(/^\//, ''));
  try {
    await fsp.rm(targetPath, { force: true });
  } catch (error) { }
}

function buildAvatarInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (!parts.length) return 'OP';
  return parts.map((part) => part.charAt(0).toUpperCase()).join('');
}

function getAvatarPayload(userLike, fallbackName) {
  const name = String((userLike && userLike.name) || fallbackName || '').trim();
  return {
    photo_url: getEffectiveProfilePhoto(userLike),
    initials: buildAvatarInitials(name || 'OP')
  };
}

const profilePhotoUploadDir = path.join(__dirname, 'public', 'uploads', 'profile-photos');
try { fs.mkdirSync(profilePhotoUploadDir, { recursive: true }); } catch (error) { }
const profilePhotoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, profilePhotoUploadDir),
  filename: (req, file, cb) => {
    const userId = Number(req.user?.id || 0) || 'user';
    const ext = (path.extname(String(file.originalname || '')).toLowerCase() || '.jpg').replace(/[^.a-z0-9]/gi, '') || '.jpg';
    cb(null, `user-${userId}-${Date.now()}${ext}`);
  }
});
const profilePhotoUpload = multer({
  storage: profilePhotoStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\//i.test(String(file.mimetype || ''))) return cb(null, true);
    cb(new Error('Me manda uma imagem bonitinha em JPG, PNG ou WebP.'));
  }
});

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


function resolveCatalogText(messageKey, variables = {}, { fallbackTitle = '', fallbackBody = '' } = {}) {
  return resolveMessage(messageKey, variables, { fallbackTitle, fallbackBody });
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
    WHERE COALESCE(profile_kind, CASE WHEN COALESCE(is_owner, 0) = 1 THEN 'self' ELSE 'contact' END) = 'self'
      AND ${personNotDeletedSql('people')}
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
      name: row.name || row.email || 'ACERTTAPAY'
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
  const safePayload = String(payload || '').trim();
  const fallbackTitle = safeCreditorName ? `Acerto com Pix de ${safeCreditorName}` : 'Acerto com Pix';
  const fallbackBody = [
    `Oi! Ficou pendente ${formatBRLFromCents(amountCents)} referente a ${safeDescription}.`,
    `Para facilitar, já deixei o Pix copia e cola de ${safeCreditorName} aqui embaixo:`,
    safePayload,
    'Depois me avisa por aqui quando pagar 💸'
  ].filter(Boolean).join('\n\n');
  const resolved = resolveCatalogText('pix.manual_request.share', {
    credor: safeCreditorName,
    valor: formatBRLFromCents(amountCents),
    descricao: safeDescription,
    pix_payload: safePayload
  }, {
    fallbackTitle,
    fallbackBody
  });

  return {
    title: resolved.title || fallbackTitle,
    text: resolved.body || fallbackBody
  };
}


function buildSharedDebtCardMonthlyPixShareText({ creditorName, amountCents, month, year, payload } = {}) {
  const safeCreditorName = String(creditorName || 'quem vai receber').trim() || 'quem vai receber';
  const periodLabel = month && year ? monthLabel(month, year) : 'este mês';
  const safePayload = String(payload || '').trim();
  const fallbackTitle = safeCreditorName ? `Pix do mês para ${safeCreditorName}` : 'Pix do mês';
  const fallbackBody = [
    `Oi! Separei ${formatBRLFromCents(amountCents)} para acertar ${periodLabel} por aqui.`,
    `Para facilitar, já deixei o Pix copia e cola de ${safeCreditorName} logo abaixo:`,
    safePayload,
    'Depois me avisa no app quando fizer o Pix 💸'
  ].filter(Boolean).join('\n\n');
  const resolved = resolveCatalogText('pix.monthly_settlement.share', {
    credor: safeCreditorName,
    valor: formatBRLFromCents(amountCents),
    periodo: periodLabel,
    pix_payload: safePayload
  }, {
    fallbackTitle,
    fallbackBody
  });

  return {
    title: resolved.title || fallbackTitle,
    text: resolved.body || fallbackBody
  };
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
      description: String(row?.description_snapshot || 'Acerto do mês').trim() || 'Acerto do mês',
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
        ? 'Configure seu Pix em Minha Rede para liberar o copia e cola deste lembrete.'
        : 'Quem enviou ainda não deixou um Pix prontinho por aqui.';
    } else if (!creditorProfile.pixValid) {
      pixUnavailableReason = currentUserIsCreditor
        ? (creditorProfile.pixReason || 'Seu Pix ainda precisa de um ajuste em Minha Rede.')
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

function normalizeSharedDebtDispatchMode(value) {
  return String(value || '').trim().toLowerCase() === 'draft' ? 'draft' : 'send_now';
}

function normalizeSharedDebtSendQueueStatus(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['draft', 'sent', 'cancelled'].includes(normalized)) return normalized;
  return 'draft';
}

function normalizeSharedDebtQueueActionKind(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['create', 'update', 'cancel'].includes(normalized)) return normalized;
  return 'create';
}

function canRecreateSharedDebtDraftFromHistory(row) {
  const status = String(row?.status || '').trim().toLowerCase();
  if (!status) return true;
  return ['cancelled', 'rejection_accepted_by_sender'].includes(status);
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
const PRIVATE_DEBT_ARCHIVABLE_STATUS_SQL = PRIVATE_DEBT_ARCHIVABLE_STATUSES
  .map((status) => `'${String(status).replace(/'/g, "''")}'`)
  .join(', ');

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
  const fallbackPath = String(fallback || '/shared-debts').trim() || '/shared-debts';
  if (!normalized) return fallbackPath;

  try {
    const parsed = new URL(normalized, 'http://acerttapay.local');
    if (parsed.origin !== 'http://acerttapay.local') return fallbackPath;
    if (parsed.pathname !== '/shared-debts' && parsed.pathname !== '/shared-debts/archive') return fallbackPath;
    const search = parsed.search || '';
    const hash = parsed.hash || '';
    return `${parsed.pathname}${search}${hash}`;
  } catch (error) {
    return fallbackPath;
  }
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
  const privateReminderIdToHighlight = Number(query?.private) || null;
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
  const allPrivateDebtReminders = getPrivateDebtReminderRowsForOwner(userId, { includeArchived: true });
  const privateDebtReminders = allPrivateDebtReminders.filter((item) => archiveMode ? Number(item?.is_archived || 0) > 0 : Number(item?.is_archived || 0) === 0);
  const privateDebtReminderTracking = filterPrivateDebtReminderTrackingItems(privateDebtReminders, sharedDebtFilters);
  const archivedPrivateReminderCount = allPrivateDebtReminders.filter((item) => Number(item?.is_archived || 0) > 0).length;
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
    privateReminderIdToHighlight,
    received,
    sent,
    privateDebtReminders,
    privateDebtReminderTracking,
    receivedPendingBatches,
    sentPendingBatches,
    receivedTracking,
    sentTracking,
    sharedDebtFilters,
    sharedDebtFiltersActive,
    draftSendQueues: archiveMode ? [] : getSharedDebtSendQueueDraftsForUser(userId),
    draftSendQueueSummary: archiveMode ? { queueCount: 0, itemCount: 0, totalCents: 0 } : getSharedDebtSendQueueDraftSummary(userId),
    manualDebtEligiblePeople: archiveMode ? [] : getManualSharedDebtEligiblePeople(userId),
    manualDebtPeople: archiveMode ? [] : getPrivateDebtReminderSelectablePeople(userId),
    eventsByRequest,
    archiveMode,
    todayIsoDate: dayjs().tz(getManualDebtDueRuntimeConfig().timezone).format('YYYY-MM-DD'),
    cardMonthlySettlements: Array.from(new Map([
      ...receivedSettlementMeta.snapshots.map((snapshot) => [snapshot.settlementKey || buildSharedDebtCardMonthlySettlementKey({ requesterUserId: snapshot.requesterUserId, receiverUserId: snapshot.receiverUserId, month: snapshot.month, year: snapshot.year }), snapshot]),
      ...sentSettlementMeta.snapshots.map((snapshot) => [snapshot.settlementKey || buildSharedDebtCardMonthlySettlementKey({ requesterUserId: snapshot.requesterUserId, receiverUserId: snapshot.receiverUserId, month: snapshot.month, year: snapshot.year }), snapshot])
    ]).values()).filter(Boolean),
    pagePath: archiveMode ? '/shared-debts/archive' : '/shared-debts',
    counterpartPath: archiveMode ? '/shared-debts' : '/shared-debts/archive',
    archiveTotalCount: archivedReceivedCount + archivedSentCount + archivedPrivateReminderCount,
    archivedReceivedCount,
    archivedSentCount,
    archivedPrivateReminderCount,
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
          related_type IN ('shared_debt_request', 'shared_debt_batch', 'shared_debt_payment_intent') OR
          type IN ('shared_debt_request', 'shared_debt_batch', 'shared_debt_payment_intent')
        )
        AND is_read = 0
    `).run(nowIso(), userId);
  }

  const payload = buildSharedDebtsPagePayload(userId, req.query, archiveMode);
  return safeRenderView(res, 'shared-debts', {
    title: archiveMode ? 'AcerttaPay | Arquivo da Central de Acertos' : 'AcerttaPay | Central de Acertos',
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
      periods: new Map(),
      totalCents: 0,
      createdCount: 0,
      updatedCount: 0,
      cancelledCount: 0
    });
  }

  const entry = context.changesByBatch.get(batchId);
  if (entry.requestIds.has(requestId)) return;

  entry.requestIds.add(requestId);
  entry.totalCents += Number(payload?.amountCents || 0);
  if (payload?.description && entry.descriptions.length < 3 && !entry.descriptions.includes(payload.description)) {
    entry.descriptions.push(payload.description);
  }

  const sourceDueMonth = Number(payload?.sourceDueMonth || 0);
  const sourceDueYear = Number(payload?.sourceDueYear || 0);
  if (sourceDueMonth && sourceDueYear) {
    const periodKey = `${sourceDueYear}-${String(sourceDueMonth).padStart(2, '0')}`;
    if (!entry.periods.has(periodKey)) {
      entry.periods.set(periodKey, { source_due_month: sourceDueMonth, source_due_year: sourceDueYear });
    }
  }

  if (payload?.kind === 'updated') entry.updatedCount += 1;
  else if (payload?.kind === 'cancelled') entry.cancelledCount += 1;
  else entry.createdCount += 1;
}

function buildSharedDebtBatchNotificationPayload({ requesterDisplayName, itemCount, totalCents, descriptions, messageKey }) {
  const safeCount = Math.max(0, Number(itemCount || 0));
  const preview = (descriptions || []).filter(Boolean).slice(0, 2).join(' · ');
  const formattedTotal = formatBRLFromCents(Number(totalCents || 0));
  const countLabel = formatCountLabel(safeCount, 'cobrança', 'cobranças');
  const resolved = resolveCatalogText(messageKey, {
    remetente: requesterDisplayName,
    n_cobrancas: countLabel,
    valor_total: formattedTotal,
    previsao_descricoes: preview
  }, {
    fallbackTitle: 'Tem novidade em um envio compartilhado',
    fallbackBody: `${requesterDisplayName} ajustou ${countLabel} para você, somando ${formattedTotal}${preview ? `. Teve mexida em: ${preview}.` : '.'}`
  });

  return {
    title: resolved.title,
    body: resolved.body
  };
}

function flushSharedDebtBatchNotifications(context) {
  if (!context || !context.changesByBatch.size) return;

  context.changesByBatch.forEach(entry => {
    const itemCount = entry.requestIds.size;
    if (!itemCount) return;

    const batchSummary = refreshSharedDebtBatch(entry.batchId);
    if (!batchSummary) return;

    const onlyCreated = entry.createdCount > 0 && entry.updatedCount === 0 && entry.cancelledCount === 0;
    const onlyUpdated = entry.updatedCount > 0 && entry.createdCount === 0 && entry.cancelledCount === 0;
    const onlyCancelled = entry.cancelledCount > 0 && entry.createdCount === 0 && entry.updatedCount === 0;
    const messageKey = onlyCreated
      ? 'notification.shared_debt.batch.new'
      : onlyUpdated
        ? 'notification.shared_debt.batch.updated'
        : onlyCancelled
          ? 'notification.shared_debt.batch.adjusted'
          : 'notification.shared_debt.batch.mixed';

    const resolvedMessage = buildSharedDebtBatchNotificationPayload({
      requesterDisplayName: context.requesterDisplayName,
      itemCount,
      totalCents: entry.totalCents,
      descriptions: entry.descriptions,
      messageKey
    });

    createNotification({
      userId: entry.receiverUserId,
      type: 'shared_debt_batch',
      title: resolvedMessage.title,
      body: resolvedMessage.body,
      href: `/shared-debts?batch=${entry.batchId}`,
      relatedType: 'shared_debt_batch',
      relatedId: entry.batchId,
      groupKey: onlyCreated ? 'shared_debt_new' : 'shared_debt_updates'
    });
  });
}

function buildSharedDebtBulkSendNotificationPayload({ requesterDisplayName, itemCount, totalCents, descriptions, periods, createdCount, updatedCount, cancelledCount, messageKey }) {
  const safeCount = Math.max(0, Number(itemCount || 0));
  const preview = (descriptions || []).filter(Boolean).slice(0, 3).join(' · ');
  const formattedTotal = formatBRLFromCents(Number(totalCents || 0));
  const countLabel = formatCountLabel(safeCount, 'cobrança', 'cobranças');
  const periodLabel = buildSharedDebtBulkPeriodLabel(periods || []) || '';
  const periodCount = Array.isArray(periods) ? periods.length : 0;
  const periodCountLabel = periodCount ? formatCountLabel(periodCount, 'período', 'períodos') : '';
  const resolved = resolveCatalogText(messageKey, {
    remetente: requesterDisplayName,
    n_cobrancas: countLabel,
    valor_total: formattedTotal,
    n_periodos: periodCountLabel,
    periodos: periodLabel,
    previsao_descricoes: preview,
    n_novas: formatCountLabel(Math.max(0, Number(createdCount || 0)), 'nova', 'novas'),
    n_atualizadas: formatCountLabel(Math.max(0, Number(updatedCount || 0)), 'atualizada', 'atualizadas'),
    n_canceladas: formatCountLabel(Math.max(0, Number(cancelledCount || 0)), 'cancelada', 'canceladas')
  }, {
    fallbackTitle: 'Atualização compartilhada sem chuva de avisos',
    fallbackBody: `${requesterDisplayName} enviou ${countLabel}${periodLabel ? ` de ${periodLabel}` : ''}, somando ${formattedTotal}${preview ? `. Entraram nessa leva: ${preview}.` : '.'}`
  });

  return {
    title: resolved.title,
    body: resolved.body
  };
}

function flushSharedDebtBulkNotifications(context) {
  if (!context || !context.changesByBatch || !context.changesByBatch.size) return { notificationCount: 0 };

  const byReceiver = new Map();
  context.changesByBatch.forEach((entry) => {
    const itemCount = entry.requestIds?.size || 0;
    if (!itemCount) return;
    const receiverUserId = Number(entry.receiverUserId || 0);
    if (!receiverUserId) return;

    if (!byReceiver.has(receiverUserId)) {
      byReceiver.set(receiverUserId, {
        receiverUserId,
        batchIds: new Set(),
        requestIds: new Set(),
        descriptions: [],
        periods: new Map(),
        totalCents: 0,
        createdCount: 0,
        updatedCount: 0,
        cancelledCount: 0
      });
    }

    const receiverEntry = byReceiver.get(receiverUserId);
    if (entry.batchId) receiverEntry.batchIds.add(Number(entry.batchId));
    (entry.requestIds || new Set()).forEach((requestId) => receiverEntry.requestIds.add(Number(requestId)));
    receiverEntry.totalCents += Number(entry.totalCents || 0);
    receiverEntry.createdCount += Number(entry.createdCount || 0);
    receiverEntry.updatedCount += Number(entry.updatedCount || 0);
    receiverEntry.cancelledCount += Number(entry.cancelledCount || 0);
    (entry.descriptions || []).forEach((description) => {
      if (description && receiverEntry.descriptions.length < 3 && !receiverEntry.descriptions.includes(description)) {
        receiverEntry.descriptions.push(description);
      }
    });
    if (entry.periods && typeof entry.periods.forEach === 'function') {
      entry.periods.forEach((period, key) => {
        if (!receiverEntry.periods.has(key)) receiverEntry.periods.set(key, period);
      });
    }
  });

  let notificationCount = 0;
  byReceiver.forEach((entry) => {
    const batchIds = Array.from(entry.batchIds).filter(Boolean);
    batchIds.forEach((batchId) => refreshSharedDebtBatch(batchId));

    const itemCount = entry.requestIds.size;
    const onlyCreated = entry.createdCount > 0 && entry.updatedCount === 0 && entry.cancelledCount === 0;
    const onlyUpdated = entry.updatedCount > 0 && entry.createdCount === 0 && entry.cancelledCount === 0;
    const onlyCancelled = entry.cancelledCount > 0 && entry.createdCount === 0 && entry.updatedCount === 0;
    const messageKey = onlyCreated
      ? 'notification.shared_debt.bulk_send.new'
      : onlyUpdated
        ? 'notification.shared_debt.bulk_send.updated'
        : onlyCancelled
          ? 'notification.shared_debt.bulk_send.adjusted'
          : 'notification.shared_debt.bulk_send.mixed';

    const periods = Array.from(entry.periods.values()).sort((a, b) => {
      const rankA = (Number(a.source_due_year || 0) * 100) + Number(a.source_due_month || 0);
      const rankB = (Number(b.source_due_year || 0) * 100) + Number(b.source_due_month || 0);
      return rankA - rankB;
    });
    const resolvedMessage = buildSharedDebtBulkSendNotificationPayload({
      requesterDisplayName: context.requesterDisplayName || 'Um usuário',
      itemCount,
      totalCents: entry.totalCents,
      descriptions: entry.descriptions,
      periods,
      createdCount: entry.createdCount,
      updatedCount: entry.updatedCount,
      cancelledCount: entry.cancelledCount,
      messageKey
    });

    createNotification({
      userId: entry.receiverUserId,
      type: 'shared_debt_batch',
      title: resolvedMessage.title,
      body: resolvedMessage.body,
      href: batchIds.length === 1 ? `/shared-debts?batch=${batchIds[0]}` : '/shared-debts#received-inbox',
      relatedType: 'shared_debt_batch',
      relatedId: batchIds[0] || null,
      groupKey: onlyCreated ? 'shared_debt_new' : 'shared_debt_updates'
    });
    notificationCount += 1;
  });

  return { notificationCount };
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
  return parts.slice(0, 2).join(" ") || "Você";
}

const FINANCE_TYPES = ["income", "expense"];
const FINANCE_TYPE_SET = new Set(FINANCE_TYPES);
const FINANCE_AMOUNT_MODES = ["fixed", "variable"];
const FINANCE_AMOUNT_MODE_SET = new Set(FINANCE_AMOUNT_MODES);
const FINANCE_SCHEDULE_KINDS = ["receive", "due", "pay"];
const FINANCE_SCHEDULE_KIND_SET = new Set(FINANCE_SCHEDULE_KINDS);

function normalizeFinanceDayOfMonth(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 31 ? parsed : null;
}

function normalizeFinanceScheduleKind(value, financeType = null) {
  const safeType = normalizeFinanceType(financeType);
  const normalized = String(value || "").trim().toLowerCase();

  if (safeType === 'income') {
    return 'receive';
  }

  if (safeType === 'expense') {
    if (normalized === 'pay' || normalized === 'due') return normalized;
    return 'due';
  }

  return FINANCE_SCHEDULE_KIND_SET.has(normalized) ? normalized : null;
}

function resolveFinanceScheduleKind(finance = {}) {
  const dayOfMonth = normalizeFinanceDayOfMonth(finance?.day_of_month);
  if (!dayOfMonth) return null;
  return normalizeFinanceScheduleKind(finance?.schedule_kind, finance?.type);
}

function computeMonthlyFinanceEffectiveDate(year, month, dayOfMonth) {
  const safeYear = Number(year || 0);
  const safeMonth = Number(month || 0);
  const safeDay = normalizeFinanceDayOfMonth(dayOfMonth);
  if (!safeYear || safeMonth < 1 || safeMonth > 12 || !safeDay) return '';

  const base = dayjs(`${safeYear}-${String(safeMonth).padStart(2, '0')}-01`);
  if (!base.isValid()) return '';
  const resolvedDay = Math.min(safeDay, base.daysInMonth());
  return `${safeYear}-${String(safeMonth).padStart(2, '0')}-${String(resolvedDay).padStart(2, '0')}`;
}

function formatMonthDayLabel(value) {
  const safeValue = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(safeValue)) return '';
  const parsed = dayjs(safeValue);
  return parsed.isValid() ? parsed.format('DD/MM') : '';
}

function formatMonthYearLabel(value) {
  const safeValue = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(safeValue)) return '';
  const parsed = dayjs(safeValue);
  return parsed.isValid() ? parsed.format('MM/YY') : '';
}

function buildFixedFinanceScheduleChipLabel(finance = {}, { effectiveDate = '' } = {}) {
  const dayOfMonth = normalizeFinanceDayOfMonth(finance?.day_of_month);
  if (!dayOfMonth) return '';

  const paddedDay = String(dayOfMonth).padStart(2, '0');
  const type = normalizeFinanceType(finance?.type);
  const scheduleKind = resolveFinanceScheduleKind(finance);

  if (type === 'income') return `Entra dia ${paddedDay}`;
  if (scheduleKind === 'pay') return `Pago dia ${paddedDay}`;
  return `Vence dia ${paddedDay}`;
}

function buildVariableFinanceScheduleSummary(finance = {}, { todayDateKey = '', contextYear = null, contextMonth = null } = {}) {
  const type = normalizeFinanceType(finance?.type);
  const items = Array.isArray(finance?.items) ? finance.items : [];
  if (!items.length) return { label: '', tone: 'default' };

  const datedItems = items
    .map((item) => ({
      ...item,
      date_key: normalizeFinanceItemDate(item?.item_date),
      amount_cents: Math.max(0, Number(item?.amount_cents || 0) || 0),
      is_paid: normalizeFinancePaidFlag(item?.is_paid)
    }))
    .filter((item) => item.date_key && item.amount_cents > 0)
    .sort((a, b) => String(a.date_key).localeCompare(String(b.date_key)));

  if (!datedItems.length) return { label: '', tone: 'default' };

  const relevantItems = type === 'expense'
    ? datedItems.filter((item) => item.is_paid !== 1)
    : datedItems;

  if (!relevantItems.length) {
    return type === 'expense'
      ? { label: 'Tudo pago na listinha', tone: 'success' }
      : { label: `Último em ${formatMonthDayLabel(datedItems[datedItems.length - 1].date_key)}`, tone: 'default' };
  }

  const todayItems = todayDateKey ? relevantItems.filter((item) => item.date_key === todayDateKey) : [];
  if (todayItems.length) {
    return {
      label: todayItems.length === 1 ? 'Tem 1 hoje' : `Tem ${todayItems.length} hoje`,
      tone: type === 'expense' ? 'warning' : 'info'
    };
  }

  const referenceDate = (() => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(todayDateKey || ''))) return todayDateKey;
    if (contextYear && contextMonth) return `${contextYear}-${String(contextMonth).padStart(2, '0')}-01`;
    return '';
  })();

  let nextItem = null;
  if (referenceDate) {
    nextItem = relevantItems.find((item) => item.date_key >= referenceDate) || null;
  }
  if (!nextItem) nextItem = relevantItems[0] || null;

  if (nextItem) {
    return {
      label: `Próximo em ${formatMonthDayLabel(nextItem.date_key)}`,
      tone: 'default'
    };
  }

  return { label: '', tone: 'default' };
}

function decorateMonthlyFinancesForView(finances = [], { year = null, month = null, todayDateKey = '' } = {}) {
  const safeYear = Number(year || 0);
  const safeMonth = Number(month || 0);
  return (Array.isArray(finances) ? finances : []).map((finance) => {
    const amountMode = normalizeFinanceAmountMode(finance?.amount_mode);
    const decorated = { ...finance };

    if (amountMode === 'fixed') {
      const dayOfMonth = normalizeFinanceDayOfMonth(finance?.day_of_month);
      const effectiveDate = dayOfMonth ? computeMonthlyFinanceEffectiveDate(safeYear, safeMonth, dayOfMonth) : '';
      decorated.schedule_meta = {
        kind: 'fixed',
        hasSchedule: !!dayOfMonth,
        chipLabel: buildFixedFinanceScheduleChipLabel(finance, { effectiveDate }),
        effectiveDate,
        effectiveDateLabel: formatMonthDayLabel(effectiveDate),
        isToday: !!effectiveDate && effectiveDate === todayDateKey,
        buttonLabel: dayOfMonth ? buildFixedFinanceScheduleChipLabel(finance, { effectiveDate }) : 'Adicionar dia',
        helperLabel: ''
      };
      return decorated;
    }

    decorated.schedule_meta = {
      kind: 'variable',
      ...(buildVariableFinanceScheduleSummary(finance, { todayDateKey, contextYear: safeYear, contextMonth: safeMonth }))
    };
    return decorated;
  });
}

function resolveMonthlyFinanceAlertHref(type, year, month) {
  const safeType = normalizeFinanceType(type) || 'expense';
  return `/detalhamento/${Number(year || 0)}/${Number(month || 0)}${safeType === 'income' ? '#grana-entra' : '#grana-sai'}`;
}

function buildMonthlyFinanceOccurrencePreview(items = []) {
  const names = Array.from(new Set((Array.isArray(items) ? items : [])
    .map((item) => String(item?.description || '').trim())
    .filter(Boolean)));
  if (!names.length) return '';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} e ${names[1]}`;
  return `${names[0]}, ${names[1]} e mais ${names.length - 2}`;
}

function buildMonthlyFinanceDateNotificationPayload(type, items = [], { year = null, month = null, dateKey = null } = {}) {
  const safeType = normalizeFinanceType(type) || 'expense';
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  const totalCents = list.reduce((sum, item) => sum + Math.max(0, Number(item?.amount_cents || 0) || 0), 0);
  const href = resolveMonthlyFinanceAlertHref(safeType, year, month);

  if (list.length === 1) {
    const item = list[0];
    const label = String(item?.description || '').trim() || (safeType === 'income' ? 'essa entrada' : 'essa saída');
    const safeKind = String(item?.schedule_kind || 'due').trim();
    const messageKey = safeType === 'income'
      ? 'notification.monthly_finance.income.single'
      : safeKind === 'pay'
        ? 'notification.monthly_finance.expense.single.pay'
        : 'notification.monthly_finance.expense.single.due';
    const fallbackTitle = safeType === 'income'
      ? `Hoje entra ${label}`
      : safeKind === 'pay'
        ? `Hoje sai ${label}`
        : `Hoje vence ${label}`;
    const fallbackBody = safeType === 'income'
      ? `${label} está no radar de hoje com ${formatBRLFromCents(item.amount_cents)}.`
      : safeKind === 'pay'
        ? `${label} está marcado para hoje com ${formatBRLFromCents(item.amount_cents)}.`
        : `${label} bate hoje com ${formatBRLFromCents(item.amount_cents)} no radar.`;
    const resolved = resolveCatalogText(messageKey, {
      descricao: label,
      valor: formatBRLFromCents(item.amount_cents)
    }, {
      fallbackTitle,
      fallbackBody
    });

    return {
      title: resolved.title,
      body: resolved.body,
      href,
      payloadMeta: { type: safeType, dateKey, totalCents, count: 1, scheduleKind: safeKind }
    };
  }

  const preview = buildMonthlyFinanceOccurrencePreview(list);
  const messageKey = safeType === 'income'
    ? 'notification.monthly_finance.income.multi'
    : 'notification.monthly_finance.expense.multi';
  const fallbackTitle = safeType === 'income' ? 'Hoje tem entradas do mês' : 'Hoje tem saídas do mês';
  const fallbackBody = `${formatCountLabel(list.length, safeType === 'income' ? 'entrada' : 'saída', safeType === 'income' ? 'entradas' : 'saídas')} somam ${formatBRLFromCents(totalCents)}${preview ? ` por conta de ${preview}` : ''}.`;
  const resolved = resolveCatalogText(messageKey, {
    n_entradas: safeType === 'income' ? formatCountLabel(list.length, 'entrada', 'entradas') : '',
    n_saidas: safeType === 'expense' ? formatCountLabel(list.length, 'saida', 'saidas') : '',
    valor_total: formatBRLFromCents(totalCents),
    previsao_descricoes: preview
  }, {
    fallbackTitle,
    fallbackBody
  });

  return {
    title: resolved.title,
    body: resolved.body,
    href,
    payloadMeta: { type: safeType, dateKey, totalCents, count: list.length }
  };
}

function buildMonthlyFinanceDashboardAlert(type, items = [], { year = null, month = null, dateKey = null } = {}) {
  const payload = buildMonthlyFinanceDateNotificationPayload(type, items, { year, month, dateKey });
  const resolved = resolveCatalogText('dashboard.monthly_finance.today', {
    titulo_reaproveitado: payload.title,
    body_reaproveitado: payload.body
  }, {
    fallbackTitle: payload.title,
    fallbackBody: payload.body
  });
  return {
    type: normalizeFinanceType(type) === 'expense' ? 'warning' : 'info',
    icon: normalizeFinanceType(type) === 'expense' ? '🧾' : '✨',
    title: resolved.title,
    description: resolved.body,
    href: payload.href
  };
}


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
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? "" + normalized : "";
}

function normalizeFinancePaidFlag(value) {
  if (value === true || value === 1) return 1;
  const normalized = String(value ?? '').trim().toLowerCase();
  return ['1', 'true', 'sim', 'yes', 'on'].includes(normalized) ? 1 : 0;
}

function normalizePositiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function sanitizeVariableFinanceItems(items) {
  if (!Array.isArray(items)) return [];

  const normalizedItems = [];
  for (const rawItem of items.slice(0, 120)) {
    const itemId = normalizePositiveInteger(rawItem?.id ?? rawItem?.item_id);
    const itemDate = normalizeFinanceItemDate(rawItem?.item_date ?? rawItem?.date);
    const itemSource = String(rawItem?.item_source ?? rawItem?.source ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
    const rawAmount = Number(rawItem?.amount_cents ?? rawItem?.amountCents ?? rawItem?.amount ?? 0);
    const amountCents = Number.isFinite(rawAmount) ? Math.max(0, Math.round(rawAmount)) : 0;
    const isPaid = normalizeFinancePaidFlag(rawItem?.is_paid ?? rawItem?.isPaid);

    if (!itemDate && !itemSource && amountCents === 0) continue;

    if (!itemDate || !itemSource || amountCents <= 0) {
      throw new Error("Em vários lançamentos, preencha data, origem e valor certinhos.");
    }

    normalizedItems.push({
      id: itemId || null,
      item_date: itemDate,
      item_source: itemSource,
      amount_cents: amountCents,
      is_paid: isPaid
    });
  }

  return normalizedItems;
}

function sumFinanceItemCents(items) {
  return (Array.isArray(items) ? items : []).reduce((sum, item) => sum + Number(item?.amount_cents || 0), 0);
}

function normalizeMonthlyFinanceCarryKey(value) {
  const normalized = String(value || '').trim();
  return normalized ? normalized.slice(0, 64) : '';
}

function createMonthlyFinanceCarryKey() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return crypto.randomBytes(16).toString('hex');
}

function getPreviousMonthYear(month, year) {
  let prevMonth = Number(month) - 1;
  let prevYear = Number(year);
  if (prevMonth < 1) {
    prevMonth = 12;
    prevYear -= 1;
  }
  return { month: prevMonth, year: prevYear };
}

function getNextMonthYear(month, year) {
  let nextMonth = Number(month) + 1;
  let nextYear = Number(year);
  if (nextMonth > 12) {
    nextMonth = 1;
    nextYear += 1;
  }
  return { month: nextMonth, year: nextYear };
}

function normalizeMonthlyFinanceScheduleRow(row) {
  const normalizedDay = normalizeFinanceDayOfMonth(row?.day_of_month);
  return {
    ...row,
    amount_mode: normalizeFinanceAmountMode(row?.amount_mode),
    carry_key: normalizeMonthlyFinanceCarryKey(row?.carry_key),
    day_of_month: normalizedDay,
    schedule_kind: normalizedDay ? normalizeFinanceScheduleKind(row?.schedule_kind, row?.type) : null
  };
}

function getFutureFixedFinanceRowsByCarryKey(userId, carryKey, month, year) {
  const resolvedCarryKey = normalizeMonthlyFinanceCarryKey(carryKey);
  if (!resolvedCarryKey) return [];

  return db.prepare(`
    SELECT id, month, year, type, amount_mode, carry_key, day_of_month, schedule_kind
    FROM monthly_finances
    WHERE user_id = ? AND carry_key = ?
      AND (year > ? OR (year = ? AND month > ?))
    ORDER BY year ASC, month ASC, id ASC
  `).all(userId, resolvedCarryKey, Number(year), Number(year), Number(month))
    .map((row) => normalizeMonthlyFinanceScheduleRow(row))
    .filter((row) => row.amount_mode === 'fixed');
}

function getContiguousFutureLegacyFixedFinanceRows(userId, sourceFinance) {
  const sourceType = normalizeFinanceType(sourceFinance?.type);
  const sourceAmountMode = normalizeFinanceAmountMode(sourceFinance?.amount_mode);
  const sourceDescription = String(sourceFinance?.description ?? '').trim();
  const sourceMonth = Number(sourceFinance?.month || 0);
  const sourceYear = Number(sourceFinance?.year || 0);
  const sourceCategoryId = sourceFinance?.category_id == null ? null : Number(sourceFinance.category_id);

  if (sourceAmountMode !== 'fixed' || !sourceType || !sourceMonth || !sourceYear || !sourceDescription) {
    return [];
  }

  const selectLegacyRows = db.prepare(`
    SELECT id, month, year, type, amount_mode, carry_key, day_of_month, schedule_kind
    FROM monthly_finances
    WHERE user_id = ? AND month = ? AND year = ? AND type = ? AND amount_mode = 'fixed'
      AND ((? IS NULL AND category_id IS NULL) OR category_id = ?)
      AND TRIM(COALESCE(description, '')) = ?
      AND (carry_key IS NULL OR TRIM(carry_key) = '')
    ORDER BY id ASC
  `);

  const rows = [];
  let cursor = getNextMonthYear(sourceMonth, sourceYear);

  for (let depth = 0; depth < 120; depth += 1) {
    const candidates = selectLegacyRows.all(
      userId,
      cursor.month,
      cursor.year,
      sourceType,
      sourceCategoryId,
      sourceCategoryId,
      sourceDescription
    );

    if (candidates.length !== 1) {
      break;
    }

    rows.push(normalizeMonthlyFinanceScheduleRow(candidates[0]));
    cursor = getNextMonthYear(cursor.month, cursor.year);
  }

  return rows;
}

function syncFutureLegacyFixedFinanceScheduleFromRow(userId, sourceFinance, {
  nextDayOfMonth = null,
  nextScheduleKind = null,
  nextCarryKey = ''
} = {}) {
  if (normalizeFinanceAmountMode(sourceFinance?.amount_mode) !== 'fixed') {
    return 0;
  }

  const resolvedNextDay = normalizeFinanceDayOfMonth(nextDayOfMonth);
  if (!resolvedNextDay) {
    return 0;
  }

  const resolvedNextKind = normalizeFinanceScheduleKind(nextScheduleKind, sourceFinance?.type);
  const previousDay = normalizeFinanceDayOfMonth(sourceFinance?.day_of_month);
  const previousKind = previousDay ? normalizeFinanceScheduleKind(sourceFinance?.schedule_kind, sourceFinance?.type) : null;
  const sourceCarryKey = normalizeMonthlyFinanceCarryKey(sourceFinance?.carry_key);
  const resolvedNextCarryKey = normalizeMonthlyFinanceCarryKey(nextCarryKey || sourceCarryKey);

  const rowsById = new Map();
  for (const row of getFutureFixedFinanceRowsByCarryKey(userId, sourceCarryKey, sourceFinance?.month, sourceFinance?.year)) {
    rowsById.set(Number(row.id || 0), row);
  }
  for (const row of getContiguousFutureLegacyFixedFinanceRows(userId, sourceFinance)) {
    rowsById.set(Number(row.id || 0), row);
  }

  const targetRows = Array.from(rowsById.values()).sort((a, b) => {
    const yearDiff = Number(a.year || 0) - Number(b.year || 0);
    if (yearDiff !== 0) return yearDiff;
    const monthDiff = Number(a.month || 0) - Number(b.month || 0);
    if (monthDiff !== 0) return monthDiff;
    return Number(a.id || 0) - Number(b.id || 0);
  });

  if (!targetRows.length) {
    return 0;
  }

  const updateRow = db.prepare(`
    UPDATE monthly_finances
    SET day_of_month = ?, schedule_kind = ?, carry_key = COALESCE(NULLIF(TRIM(carry_key), ''), ?)
    WHERE id = ? AND user_id = ?
  `);

  let updatedCount = 0;

  db.transaction(() => {
    for (const row of targetRows) {
      if (row.amount_mode !== 'fixed') {
        continue;
      }

      const rowDay = normalizeFinanceDayOfMonth(row.day_of_month);
      const rowKind = rowDay ? normalizeFinanceScheduleKind(row.schedule_kind, row.type) : null;
      const matchesPreviousSchedule = previousDay
        && rowDay === previousDay
        && (rowKind || null) === (previousKind || null);
      const matchesNextScheduleWithoutCarryKey = !normalizeMonthlyFinanceCarryKey(row.carry_key)
        && rowDay === resolvedNextDay
        && (rowKind || null) === (resolvedNextKind || null);
      const shouldUpdate = !rowDay || matchesPreviousSchedule || matchesNextScheduleWithoutCarryKey;

      if (!shouldUpdate) {
        continue;
      }

      const result = updateRow.run(
        resolvedNextDay,
        resolvedNextKind,
        resolvedNextCarryKey || null,
        row.id,
        userId
      );

      if (Number(result.changes || 0) > 0) {
        updatedCount += 1;
      }
    }
  })();

  return updatedCount;
}

function syncMonthlyFinanceCarryForward(userId, month, year) {
  const { month: prevMonth, year: prevYear } = getPreviousMonthYear(month, year);

  const previousRows = db.prepare(`
    SELECT id, type, category_id, description, amount_mode, carry_key, day_of_month, schedule_kind
    FROM monthly_finances
    WHERE user_id = ? AND month = ? AND year = ?
      AND carry_key IS NOT NULL AND TRIM(carry_key) <> ''
    ORDER BY id ASC
  `).all(userId, prevMonth, prevYear).map((row) => ({
    ...row,
    amount_mode: normalizeFinanceAmountMode(row.amount_mode),
    carry_key: normalizeMonthlyFinanceCarryKey(row.carry_key),
    day_of_month: normalizeFinanceDayOfMonth(row.day_of_month),
    schedule_kind: normalizeFinanceDayOfMonth(row.day_of_month) ? normalizeFinanceScheduleKind(row.schedule_kind, row.type) : null
  })).filter((row) => row.carry_key);

  if (!previousRows.length) {
    return 0;
  }

  const currentRows = db.prepare(`
    SELECT id, type, amount_mode, carry_key, day_of_month, schedule_kind
    FROM monthly_finances
    WHERE user_id = ? AND month = ? AND year = ?
      AND carry_key IS NOT NULL AND TRIM(carry_key) <> ''
  `).all(userId, month, year).map((row) => ({
    ...row,
    amount_mode: normalizeFinanceAmountMode(row.amount_mode),
    carry_key: normalizeMonthlyFinanceCarryKey(row.carry_key),
    day_of_month: normalizeFinanceDayOfMonth(row.day_of_month),
    schedule_kind: normalizeFinanceDayOfMonth(row.day_of_month) ? normalizeFinanceScheduleKind(row.schedule_kind, row.type) : null
  })).filter((row) => row.carry_key);

  const currentRowsByCarryKey = new Map(currentRows.map((row) => [row.carry_key, row]));
  const currentCarryKeys = new Set(currentRowsByCarryKey.keys());

  const blockedCarryKeys = new Set(
    db.prepare(`
      SELECT carry_key
      FROM monthly_finance_carry_exceptions
      WHERE user_id = ? AND month = ? AND year = ?
    `).all(userId, month, year)
      .map((row) => normalizeMonthlyFinanceCarryKey(row.carry_key))
      .filter(Boolean)
  );

  const insertClone = db.prepare(`
    INSERT OR IGNORE INTO monthly_finances (user_id, month, year, type, category_id, description, formula, amount_cents, amount_mode, carry_key, day_of_month, schedule_kind, created_at)
    VALUES (?, ?, ?, ?, ?, ?, '', 0, ?, ?, ?, ?, ?)
  `);
  const updateExistingSchedule = db.prepare(`
    UPDATE monthly_finances
    SET day_of_month = ?, schedule_kind = ?
    WHERE id = ? AND user_id = ?
  `);

  const currentNowIso = nowIso();
  let insertedCount = 0;
  let updatedCount = 0;

  db.transaction(() => {
    for (const row of previousRows) {
      if (blockedCarryKeys.has(row.carry_key)) {
        continue;
      }

      const currentRow = currentRowsByCarryKey.get(row.carry_key) || null;
      if (currentRow) {
        const previousDay = normalizeFinanceDayOfMonth(row.day_of_month);
        const currentDay = normalizeFinanceDayOfMonth(currentRow.day_of_month);
        const previousKind = previousDay ? normalizeFinanceScheduleKind(row.schedule_kind, row.type) : null;
        const currentKind = currentDay ? normalizeFinanceScheduleKind(currentRow.schedule_kind, currentRow.type) : null;

        const shouldBackfillSchedule = currentRow.amount_mode === 'fixed'
          && previousDay
          && ((!currentDay) || (currentDay === previousDay && previousKind && currentKind !== previousKind));

        if (shouldBackfillSchedule) {
          const result = updateExistingSchedule.run(previousDay, previousKind, currentRow.id, userId);
          if (Number(result.changes || 0) > 0) {
            currentRowsByCarryKey.set(row.carry_key, {
              ...currentRow,
              day_of_month: previousDay,
              schedule_kind: previousKind
            });
            updatedCount += 1;
          }
        }
        continue;
      }

      const result = insertClone.run(
        userId,
        month,
        year,
        row.type,
        row.category_id ?? null,
        row.description ?? '',
        row.amount_mode,
        row.carry_key,
        row.day_of_month,
        row.schedule_kind,
        currentNowIso
      );

      if (Number(result.changes || 0) > 0) {
        currentCarryKeys.add(row.carry_key);
        currentRowsByCarryKey.set(row.carry_key, {
          id: Number(result.lastInsertRowid || 0),
          type: row.type,
          amount_mode: row.amount_mode,
          carry_key: row.carry_key,
          day_of_month: row.day_of_month,
          schedule_kind: row.schedule_kind
        });
        insertedCount += 1;
      }
    }
  })();

  return insertedCount + updatedCount;
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
    SELECT type, category_id, description, amount_mode, carry_key, day_of_month, schedule_kind
    FROM monthly_finances
    WHERE user_id = ? AND month = ? AND year = ? AND type = ?
    ORDER BY id ASC
  `);

  const insertClone = db.prepare(`
    INSERT INTO monthly_finances (user_id, month, year, type, category_id, description, formula, amount_cents, amount_mode, carry_key, day_of_month, schedule_kind, created_at)
    VALUES (?, ?, ?, ?, ?, ?, '', 0, ?, ?, ?, ?, ?)
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
          normalizeMonthlyFinanceCarryKey(row.carry_key) || null,
          normalizeFinanceDayOfMonth(row.day_of_month),
          row.day_of_month ? normalizeFinanceScheduleKind(row.schedule_kind, type) : null,
          nowIso
        );
      }
    }
  })();
}

function getFinanceItemsByFinanceId(userId, financeId) {
  return db.prepare(`
    SELECT id, finance_id, item_date, item_source, amount_cents, is_paid, paid_at
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
    SELECT id, finance_id, item_date, item_source, amount_cents, is_paid, paid_at
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
    ? finances.map((finance) => ({
      ...finance,
      amount_mode: normalizeFinanceAmountMode(finance.amount_mode),
      day_of_month: normalizeFinanceDayOfMonth(finance?.day_of_month),
      schedule_kind: normalizeFinanceDayOfMonth(finance?.day_of_month) ? normalizeFinanceScheduleKind(finance?.schedule_kind, finance?.type) : null,
      is_paid: normalizeFinancePaidFlag(finance?.is_paid),
      paid_at: finance?.paid_at || null
    }))
    : [];

  const itemsByFinance = getFinanceItemsMap(userId, normalizedFinances.map((finance) => finance.id));
  const dirtyVariableRows = [];

  for (const finance of normalizedFinances) {
    const items = (itemsByFinance.get(finance.id) || []).map((item) => ({
      ...item,
      is_paid: normalizeFinancePaidFlag(item?.is_paid),
      paid_at: item?.paid_at || null
    }));
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
  finance.day_of_month = normalizeFinanceDayOfMonth(finance?.day_of_month);
  finance.schedule_kind = finance.day_of_month ? normalizeFinanceScheduleKind(finance?.schedule_kind, finance?.type) : null;
  finance.is_paid = normalizeFinancePaidFlag(finance?.is_paid);
  finance.paid_at = finance?.paid_at || null;
  return finance;
}

function serializeFinanceForApi(userId, financeId) {
  const finance = getFinanceByIdForUser(userId, financeId);
  if (!finance) return null;

  if (finance.amount_mode === 'variable') {
    finance.items = getFinanceItemsByFinanceId(userId, financeId).map((item) => ({
      ...item,
      is_paid: normalizeFinancePaidFlag(item?.is_paid),
      paid_at: item?.paid_at || null
    }));
    finance.item_count = finance.items.length;
    finance.amount_cents = syncVariableFinanceAggregate(userId, financeId);
    finance.formula = '';
  } else {
    finance.items = [];
    finance.item_count = 0;
  }

  return finance;
}

function buildFinancePaymentState(finance = {}) {
  const isVariable = normalizeFinanceAmountMode(finance?.amount_mode) === 'variable';
  const totalCents = Math.max(0, Number(finance?.amount_cents || 0));

  if (!isVariable) {
    const isPaid = normalizeFinancePaidFlag(finance?.is_paid) === 1;
    const paidCents = isPaid ? totalCents : 0;
    const totalItemCount = totalCents > 0 ? 1 : 0;
    const paidItemCount = isPaid && totalItemCount ? 1 : 0;
    return {
      mode: 'fixed',
      isPaid,
      totalItemCount,
      paidItemCount,
      totalCents,
      paidCents,
      remainingCents: Math.max(0, totalCents - paidCents),
      progressPct: totalCents > 0 ? Math.max(0, Math.min(100, Math.round((paidCents / totalCents) * 100))) : 0,
      isComplete: totalCents > 0 && paidCents >= totalCents
    };
  }

  const items = Array.isArray(finance?.items) ? finance.items : [];
  const paidItems = items.filter((item) => normalizeFinancePaidFlag(item?.is_paid) === 1);
  const paidCents = paidItems.reduce((sum, item) => sum + Math.max(0, Number(item?.amount_cents || 0)), 0);
  const totalItemCount = items.length;
  const paidItemCount = paidItems.length;
  return {
    mode: 'variable',
    isPaid: totalItemCount > 0 && paidItemCount === totalItemCount,
    totalItemCount,
    paidItemCount,
    totalCents,
    paidCents,
    remainingCents: Math.max(0, totalCents - paidCents),
    progressPct: totalCents > 0 ? Math.max(0, Math.min(100, Math.round((paidCents / totalCents) * 100))) : 0,
    isComplete: totalCents > 0 && paidCents >= totalCents
  };
}

function buildExpensePaymentProgress(userId, month, year, hydratedFinances = null) {
  const safeMonth = Number(month || 0);
  const safeYear = Number(year || 0);
  const finances = Array.isArray(hydratedFinances)
    ? hydratedFinances
    : hydrateMonthlyFinances(userId, db.prepare(`
      SELECT *
      FROM monthly_finances
      WHERE user_id = ? AND month = ? AND year = ? AND type = 'expense'
      ORDER BY id ASC
    `).all(userId, safeMonth, safeYear));

  const expenseFinances = finances.filter((finance) => finance?.type === 'expense');
  const summary = {
    totalCents: 0,
    paidCents: 0,
    remainingCents: 0,
    progressPct: 0,
    totalItemCount: 0,
    paidItemCount: 0,
    fixedCount: 0,
    variableParentCount: 0,
    isComplete: false,
    hasValue: false
  };

  expenseFinances.forEach((finance) => {
    const state = buildFinancePaymentState(finance);
    summary.totalCents += Math.max(0, Number(finance?.amount_cents || 0));
    summary.paidCents += Math.max(0, Number(state.paidCents || 0));
    summary.totalItemCount += Math.max(0, Number(state.totalItemCount || 0));
    summary.paidItemCount += Math.max(0, Number(state.paidItemCount || 0));
    if (state.mode === 'variable') summary.variableParentCount += 1;
    else summary.fixedCount += 1;
  });

  summary.remainingCents = Math.max(0, summary.totalCents - summary.paidCents);
  summary.progressPct = summary.totalCents > 0
    ? Math.max(0, Math.min(100, Math.round((summary.paidCents / summary.totalCents) * 100)))
    : 0;
  summary.isComplete = summary.totalCents > 0 && summary.paidCents >= summary.totalCents;
  summary.hasValue = summary.totalCents > 0;
  summary.label = summary.totalCents > 0
    ? `Pago ${formatBRLFromCents(summary.paidCents)} de ${formatBRLFromCents(summary.totalCents)} · ${summary.progressPct}%`
    : 'Sem saídas no mês.';
  return summary;
}

function buildSelfCardPaymentProgress(userId, month, year, { ownerPersonId = null, totalCents = null } = {}) {
  const selfPerson = ownerPersonId
    ? { id: Number(ownerPersonId) }
    : (getSelfPerson(userId) || null);
  const selfPersonId = Number(selfPerson?.id || 0);

  let resolvedTotalCents = Number.isFinite(Number(totalCents)) ? Math.max(0, Number(totalCents)) : null;
  if (resolvedTotalCents == null) {
    resolvedTotalCents = selfPersonId
      ? Math.max(0, Number(db.prepare(`
          SELECT COALESCE(SUM(a.share_cents), 0) AS total
          FROM allocations a
          JOIN transactions t ON t.id = a.transaction_id AND t.user_id = a.user_id
          LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
          WHERE a.user_id = ?
            AND a.person_id = ?
            AND (
              (${EFFECTIVE_DUE_MONTH_SQL} = ? AND ${EFFECTIVE_DUE_YEAR_SQL} = ?) OR
              (${EFFECTIVE_DUE_MONTH_SQL} = ? AND ${EFFECTIVE_DUE_YEAR_SQL} = ?)
            )
        `).get(userId, selfPersonId, month, year, month, year)?.total || 0))
      : 0;
  }

  const paymentBreakdown = selfPersonId
    ? getPersonPaymentBreakdownForMonth(userId, month, year, selfPersonId)
    : { manualCents: 0, autoCents: 0, totalPaidCents: 0 };
  const paidCents = Math.max(0, Number(paymentBreakdown.totalPaidCents || 0));
  const progressPct = resolvedTotalCents > 0
    ? Math.max(0, Math.min(100, Math.round((paidCents / resolvedTotalCents) * 100)))
    : 0;

  return {
    totalCents: resolvedTotalCents,
    paidCents,
    manualPaidCents: Math.max(0, Number(paymentBreakdown.manualCents || 0)),
    autoPaidCents: Math.max(0, Number(paymentBreakdown.autoCents || 0)),
    remainingCents: Math.max(0, resolvedTotalCents - paidCents),
    progressPct,
    isComplete: resolvedTotalCents > 0 && paidCents >= resolvedTotalCents,
    hasValue: resolvedTotalCents > 0,
    label: resolvedTotalCents > 0
      ? `Já entrou ${formatBRLFromCents(paidCents)} de ${formatBRLFromCents(resolvedTotalCents)} · ${progressPct}%`
      : 'Sem parcela sua no mês.'
  };
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

function getEditDestinationMonthLockMessage(month, year, { isRecurring = false, futureScope = false } = {}) {
  if (futureScope && isRecurring) {
    return `A fatura de destino em ${monthLabel(month, year)} está fechada. Para não bagunçar as próximas recorrências, preciso que você escolha uma fatura aberta.`;
  }
  if (futureScope) {
    return `Uma das faturas de destino em ${monthLabel(month, year)} já está fechada. Para não deixar parcelas com destino torto, escolha uma fatura aberta.`;
  }
  return `A fatura de destino em ${monthLabel(month, year)} está fechada. Escolha uma fatura aberta para salvar a edição.`;
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

function syncRecurringTransactions(userId, targetYear, targetMonth, {
  referenceDate = dayjs(),
  includeCurrentMonthBeforeDate = false,
  allowFutureOpenMonth = false,
  scope = 'up_to_target'
} = {}) {
  const year = Number(targetYear);
  const month = Number(targetMonth);
  if (!year || !month) return;

  const normalizedScope = String(scope || 'up_to_target').trim().toLowerCase() === 'target_only'
    ? 'target_only'
    : 'up_to_target';

  const rules = db.prepare(`
    SELECT r.*, c.name AS card_name, COALESCE(c.active, 1) AS card_active
    FROM recurring_rules r
    JOIN cards c ON c.id = r.card_id AND c.user_id = r.user_id
    WHERE r.user_id = ? AND r.status = 'active' AND COALESCE(c.active, 1) = 1
    ORDER BY r.id
  `).all(userId);

  if (!rules.length) return;

  const activePeople = db.prepare("SELECT id FROM people WHERE user_id = ? AND active = 1 AND COALESCE(status, CASE WHEN COALESCE(active, 1) = 0 THEN 'inactive' ELSE 'active' END) <> 'deleted' AND COALESCE(status, CASE WHEN COALESCE(active, 1) = 0 THEN 'inactive' ELSE 'active' END) <> 'deleted' ORDER BY id").all(userId);
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
    INSERT INTO transactions (user_id, card_id, txn_date, description, amount_cents, due_month, due_year, recurring_rule_id, purchase_category_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insAlloc = db.prepare(`
    INSERT INTO allocations (user_id, transaction_id, person_id, share_cents, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  db.transaction(() => {
    rules.forEach(rule => {
      const syncLimit = getRecurringSyncLimitForRule(rule, year, month, referenceDate, { includeCurrentMonthBeforeDate, allowFutureOpenMonth });
      if (!syncLimit) return;
      if (compareMonthYear(rule.start_due_year, rule.start_due_month, syncLimit.year, syncLimit.month) > 0) return;

      const upsertForOffset = (offset) => {
        const due = shiftMonth(rule.start_due_year, rule.start_due_month, offset);
        if (compareMonthYear(due.year, due.month, syncLimit.year, syncLimit.month) > 0) return;

        if (compareMonthYear(due.year, due.month, rule.active_from_year, rule.active_from_month) < 0) {
          return;
        }

        if (hasException.get(userId, rule.id, due.month, due.year) || findTxn.get(userId, rule.id, due.month, due.year)) {
          return;
        }

        if (isMonthClosed(userId, due.month, due.year)) {
          return;
        }

        const txnDate = occurrenceDateFromStart(rule.start_txn_date, offset) || rule.start_txn_date;
        if (!includeCurrentMonthBeforeDate) {
          const occurrence = dayjs(txnDate);
          const currentReference = dayjs(referenceDate);
          if (occurrence.isValid() && currentReference.isValid() && currentReference.isBefore(occurrence, 'day')) {
            return;
          }
        }

        const info = insTxn.run(userId, rule.card_id, txnDate, rule.description, rule.amount_cents, due.month, due.year, rule.id, rule.purchase_category_id || null, nowIso());

        if (activePeople.length === 1) {
          insAlloc.run(userId, info.lastInsertRowid, activePeople[0].id, rule.amount_cents, nowIso());
        }
      };

      if (normalizedScope === 'target_only') {
        const targetOffset = ((year - Number(rule.start_due_year || 0)) * 12) + (month - Number(rule.start_due_month || 0));
        if (targetOffset < 0) return;
        upsertForOffset(targetOffset);
        return;
      }

      let offset = 0;
      while (true) {
        const due = shiftMonth(rule.start_due_year, rule.start_due_month, offset);
        if (compareMonthYear(due.year, due.month, syncLimit.year, syncLimit.month) > 0) break;
        upsertForOffset(offset);
        offset += 1;
      }
    });
  })();
}

function getLaterMonthYear(left, right) {
  const leftYear = Number(left?.year || 0);
  const leftMonth = Number(left?.month || 0);
  const rightYear = Number(right?.year || 0);
  const rightMonth = Number(right?.month || 0);

  if (!leftYear || !leftMonth) {
    return rightYear && rightMonth ? { year: rightYear, month: rightMonth } : null;
  }
  if (!rightYear || !rightMonth) {
    return { year: leftYear, month: leftMonth };
  }

  return compareMonthYear(rightYear, rightMonth, leftYear, leftMonth) > 0
    ? { year: rightYear, month: rightMonth }
    : { year: leftYear, month: leftMonth };
}

function getLatestReadyRecurringDuePeriodForRule(userId, rule, referenceDate = dayjs()) {
  const safeUserId = Number(userId || 0);
  const startYear = Number(rule?.start_due_year || 0);
  const startMonth = Number(rule?.start_due_month || 0);
  if (!safeUserId || !startYear || !startMonth) return null;

  const currentDate = dayjs(referenceDate);
  const baseDate = currentDate.isValid() ? currentDate : dayjs();
  let latest = null;

  for (let offset = 0; offset < 240; offset += 1) {
    const due = shiftMonth(startYear, startMonth, offset);

    if (compareMonthYear(due.year, due.month, rule.active_from_year, rule.active_from_month) < 0) {
      continue;
    }

    const occurrenceDate = occurrenceDateFromStart(rule.start_txn_date, offset);
    const occurrence = occurrenceDate ? dayjs(occurrenceDate) : null;
    if (occurrence && occurrence.isValid() && baseDate.isBefore(occurrence, 'day')) {
      break;
    }

    if (!isMonthClosed(safeUserId, due.month, due.year)) {
      latest = due;
    }
  }

  return latest;
}

function getLatestReadyRecurringDuePeriodForUser(userId, referenceDate = dayjs()) {
  const safeUserId = Number(userId || 0);
  if (!safeUserId) return null;

  const rules = db.prepare(`
    SELECT r.*
    FROM recurring_rules r
    JOIN cards c ON c.id = r.card_id AND c.user_id = r.user_id
    WHERE r.user_id = ? AND r.status = 'active' AND COALESCE(c.active, 1) = 1
    ORDER BY r.id
  `).all(safeUserId);

  return rules.reduce((latest, rule) => {
    const readyPeriod = getLatestReadyRecurringDuePeriodForRule(safeUserId, rule, referenceDate);
    return getLaterMonthYear(latest, readyPeriod);
  }, null);
}

function resolveRecurringSyncTargetForUser(userId, referenceDate = dayjs()) {
  const currentDate = dayjs(referenceDate);
  const baseDate = currentDate.isValid() ? currentDate : dayjs();
  const currentYear = baseDate.year();
  const currentMonth = baseDate.month() + 1;
  const preferred = getPreferredDashboardMonth(userId, currentYear, currentMonth);
  const fallback = preferred && Number(preferred.year || 0) && Number(preferred.month || 0)
    ? { year: Number(preferred.year), month: Number(preferred.month) }
    : { year: currentYear, month: currentMonth };
  const readyTarget = getLatestReadyRecurringDuePeriodForUser(userId, baseDate);

  return getLaterMonthYear(fallback, readyTarget) || fallback;
}

function syncRecurringTransactionsForUserOpenPeriod(userId, referenceDate = dayjs()) {
  const safeUserId = Number(userId || 0);
  if (!safeUserId) return null;

  const currentDate = dayjs(referenceDate);
  const baseDate = currentDate.isValid() ? currentDate : dayjs();
  const target = resolveRecurringSyncTargetForUser(safeUserId, baseDate);

  syncRecurringTransactions(safeUserId, target.year, target.month, {
    referenceDate: baseDate,
    includeCurrentMonthBeforeDate: false,
    allowFutureOpenMonth: false,
    scope: 'up_to_target'
  });

  return target;
}

function getRecurringRequestPeriod(req) {
  const pathName = String(req?.path || '');
  const match = pathName.match(/^\/(?:detalhamento|month|summary|analytics)\/(\d{4})\/(\d{1,2})(?:\/)?$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!year || !month || month < 1 || month > 12) return null;

  return { year, month };
}

function syncRecurringTransactionsForRequest(req, referenceDate = dayjs()) {
  const safeUserId = Number(req?.user?.id || 0);
  if (!safeUserId) return null;

  const currentDate = dayjs(referenceDate);
  const baseDate = currentDate.isValid() ? currentDate : dayjs();
  const requestedPeriod = getRecurringRequestPeriod(req);
  const automaticTarget = resolveRecurringSyncTargetForUser(safeUserId, baseDate);
  const target = getLaterMonthYear(requestedPeriod, automaticTarget) || requestedPeriod || automaticTarget;

  syncRecurringTransactions(safeUserId, target.year, target.month, {
    referenceDate: baseDate,
    includeCurrentMonthBeforeDate: false,
    allowFutureOpenMonth: false,
    scope: 'up_to_target'
  });

  return target;
}

function shouldSyncRecurringTransactionsForRequest(req) {
  if (!req || !req.isAuthenticated || !req.isAuthenticated() || !req.user?.id) return false;

  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return false;

  if (isAjaxLikeRequest(req)) return false;

  const pathName = String(req.path || '/');
  if (pathName === '/' || pathName === '/geral' || pathName === '/month') return true;

  return /^\/detalhamento\/\d{4}\/\d{1,2}(?:\/)?$/.test(pathName)
    || /^\/month\/\d{4}\/\d{1,2}(?:\/)?$/.test(pathName)
    || /^\/summary\/\d{4}\/\d{1,2}(?:\/)?$/.test(pathName)
    || /^\/analytics\/\d{4}\/\d{1,2}(?:\/)?$/.test(pathName);
}

function getRecurringSyncLimitForRule(rule, targetYear, targetMonth, referenceDate = dayjs(), { includeCurrentMonthBeforeDate = false, allowFutureOpenMonth = false } = {}) {
  const requestedYear = Number(targetYear || 0);
  const requestedMonth = Number(targetMonth || 0);
  if (!requestedYear || !requestedMonth) return null;

  const currentDate = dayjs(referenceDate);
  if (!currentDate.isValid()) return { year: requestedYear, month: requestedMonth };

  const currentYear = currentDate.year();
  const currentMonth = currentDate.month() + 1;

  let limit = { year: requestedYear, month: requestedMonth };
  if (!allowFutureOpenMonth && compareMonthYear(limit.year, limit.month, currentYear, currentMonth) > 0) {
    const targetOccurrenceDate = getRecurringOccurrenceDateForMonth(rule, limit.year, limit.month);
    const targetOccurrence = targetOccurrenceDate ? dayjs(targetOccurrenceDate) : null;
    const targetOccurrenceReady = targetOccurrence && targetOccurrence.isValid() && !currentDate.isBefore(targetOccurrence, 'day');

    if (!targetOccurrenceReady) {
      limit = { year: currentYear, month: currentMonth };
    }
  }

  if (!includeCurrentMonthBeforeDate) {
    const occurrenceDate = getRecurringOccurrenceDateForMonth(rule, limit.year, limit.month);
    if (occurrenceDate) {
      const occurrence = dayjs(occurrenceDate);
      if (occurrence.isValid() && currentDate.isBefore(occurrence, 'day')) {
        limit = shiftMonth(limit.year, limit.month, -1);
      }
    }
  }

  return limit;
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

    const compareToCurrent = compareMonthYear(due.year, due.month, currentYear, currentMonth);
    if (compareToCurrent < 0) {
      offset += 1;
      continue;
    }

    if (compareToCurrent === 0) {
      const occurrenceDate = getRecurringOccurrenceDateForMonth(rule, currentYear, currentMonth);
      const occurrence = occurrenceDate ? dayjs(occurrenceDate) : null;
      if (!occurrence || !occurrence.isValid() || today.isBefore(occurrence, 'day')) {
        return due;
      }
      offset += 1;
      continue;
    }

    return due;
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
    SELECT id, name, due_day, close_day, holiday_scope, brand, COALESCE(active, 1) AS active
    FROM cards
    WHERE user_id = ?
    ORDER BY COALESCE(active, 1) DESC, name
  `).all(userId);
}

function getActiveCards(userId) {
  return db.prepare(`
    SELECT id, name, due_day, close_day, holiday_scope, brand, COALESCE(active, 1) AS active
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
    SELECT id, name, due_day, close_day, holiday_scope, brand, COALESCE(active, 1) AS active
    FROM cards
    WHERE user_id = ? AND id IN (${placeholders})
    ORDER BY COALESCE(active, 1) DESC, name
  `).all(userId, ...uniqueIds);
}

function getPeopleActive(userId) {
  return db.prepare("SELECT id, name, active, email, COALESCE(status, CASE WHEN COALESCE(active, 1) = 0 THEN 'inactive' ELSE 'active' END) AS status FROM people WHERE user_id = ? AND active = 1 AND COALESCE(status, CASE WHEN COALESCE(active, 1) = 0 THEN 'inactive' ELSE 'active' END) <> 'deleted' ORDER BY name").all(userId);
}

function findPersonByNameForUser(userId, name, excludePersonId = null) {
  const safeName = String(name || '').trim();
  if (!safeName) return null;

  if (excludePersonId) {
    return db.prepare(`
      SELECT id, name
      FROM people
      WHERE user_id = ? AND lower(name) = lower(?) AND id <> ?
        AND COALESCE(status, CASE WHEN COALESCE(active, 1) = 0 THEN 'inactive' ELSE 'active' END) <> 'deleted'
      LIMIT 1
    `).get(userId, safeName, Number(excludePersonId));
  }

  return db.prepare(`
    SELECT id, name
    FROM people
    WHERE user_id = ? AND lower(name) = lower(?)
      AND COALESCE(status, CASE WHEN COALESCE(active, 1) = 0 THEN 'inactive' ELSE 'active' END) <> 'deleted'
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
    SELECT id, name, active, is_owner, profile_kind, phone, email,
           COALESCE(status, CASE WHEN COALESCE(active, 1) = 0 THEN 'inactive' ELSE 'active' END) AS status,
           deleted_at,
           deleted_label
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

  const allPeople = getPeopleAll(userId);
  const currentUser = getUserRecord(userId, { includeDeleted: false });
  return allPeople
    .filter((person) => visibleIds.has(Number(person.id || 0)))
    .map((person) => person && person.is_self ? { ...person, photo_url: getEffectiveProfilePhoto(currentUser) } : person);
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

  const allPeople = getPeopleAll(userId);
  const currentUser = getUserRecord(userId, { includeDeleted: false });
  return allPeople
    .filter((person) => visibleIds.has(Number(person.id || 0)))
    .map((person) => person && person.is_self ? { ...person, photo_url: getEffectiveProfilePhoto(currentUser) } : person);
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

function getSelfPerson(userId) {
  return db.prepare(`
    SELECT id, name, email, phone, pix_enabled, pix_key_type, pix_key_value, pix_city, pix_state, pix_label, pix_updated_at, active, is_owner, profile_kind,
           COALESCE(status, CASE WHEN COALESCE(active, 1) = 0 THEN 'inactive' ELSE 'active' END) AS status,
           deleted_at,
           deleted_label
    FROM people
    WHERE user_id = ?
      AND COALESCE(profile_kind, CASE WHEN COALESCE(is_owner, 0) = 1 THEN 'self' ELSE 'contact' END) = 'self'
      AND COALESCE(status, CASE WHEN COALESCE(active, 1) = 0 THEN 'inactive' ELSE 'active' END) <> 'deleted'
    ORDER BY id ASC
    LIMIT 1
  `).get(userId);
}

function getOwnerPerson(userId) {
  return getSelfPerson(userId);
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
    JOIN users u ON u.id = fr.requester_user_id AND COALESCE(u.status, 'active') <> 'deleted'
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
      stable_u.google_photo_url AS stable_linked_user_google_photo_url,
      stable_u.profile_photo_url AS stable_linked_user_profile_photo_url,
      stable_u.profile_photo_mode AS stable_linked_user_profile_photo_mode,
      stable_u.profile_signature_text AS stable_linked_user_profile_signature_text,
      stable_u.profile_signature_vibe AS stable_linked_user_profile_signature_vibe,
      matched_u.id AS email_matched_user_id,
      matched_u.name AS email_matched_user_name,
      matched_u.email AS email_matched_user_email,
      matched_u.google_photo_url AS email_matched_user_google_photo_url,
      matched_u.profile_photo_url AS email_matched_user_profile_photo_url,
      matched_u.profile_photo_mode AS email_matched_user_profile_photo_mode,
      matched_u.profile_signature_text AS email_matched_user_profile_signature_text,
      matched_u.profile_signature_vibe AS email_matched_user_profile_signature_vibe,
      COALESCE(p.status, CASE WHEN COALESCE(p.active, 1) = 0 THEN 'inactive' ELSE 'active' END) AS status
    FROM people p
    LEFT JOIN person_app_links pal
      ON pal.owner_user_id = p.user_id AND pal.person_id = p.id
    LEFT JOIN users stable_u ON stable_u.id = pal.linked_user_id AND COALESCE(stable_u.status, 'active') <> 'deleted'
    LEFT JOIN users matched_u
      ON pal.linked_user_id IS NULL
     AND p.email IS NOT NULL
     AND trim(p.email) <> ''
     AND lower(matched_u.email) = lower(p.email)
     AND COALESCE(matched_u.status, 'active') <> 'deleted'
    WHERE p.user_id = ? AND p.id = ?
      AND COALESCE(p.status, CASE WHEN COALESCE(p.active, 1) = 0 THEN 'inactive' ELSE 'active' END) <> 'deleted'
    LIMIT 1
  `).get(userId, personId);

  if (!row) return null;

  const linkedUserId = Number(row.stable_linked_user_id || row.email_matched_user_id || 0);
  if (!linkedUserId || linkedUserId === Number(userId || 0)) return null;

  const via = row.stable_linked_user_id ? 'person_link' : 'email_match';
  return {
    linked_user_id: linkedUserId,
    linked_user_name: row.stable_linked_user_name || row.email_matched_user_name || null,
    linked_user_photo_url: getEffectiveProfilePhoto({ profile_photo_url: row.stable_linked_user_profile_photo_url || row.email_matched_user_profile_photo_url || '', google_photo_url: row.stable_linked_user_google_photo_url || row.email_matched_user_google_photo_url || '', profile_photo_mode: row.stable_linked_user_profile_photo_mode || row.email_matched_user_profile_photo_mode || 'default' }),
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
      AND COALESCE(p.profile_kind, CASE WHEN COALESCE(p.is_owner, 0) = 1 THEN 'self' ELSE 'contact' END) <> 'self'
      AND COALESCE(p.status, CASE WHEN COALESCE(p.active, 1) = 0 THEN 'inactive' ELSE 'active' END) <> 'deleted'
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
        AND COALESCE(profile_kind, CASE WHEN COALESCE(is_owner, 0) = 1 THEN 'self' ELSE 'contact' END) <> 'self'
        AND COALESCE(status, CASE WHEN COALESCE(active, 1) = 0 THEN 'inactive' ELSE 'active' END) <> 'deleted'
      ORDER BY COALESCE(active, 1) DESC, id ASC
      LIMIT 1
    `).get(safeOwnerUserId, normalizedEmail);
  }

  if (!person) {
    const baseName = String(preferredName || '').trim() || 'Contato AcerttaPay';
    const now = nowIso();
    const candidateNames = [baseName, `${baseName} (app)`, `${baseName} AcerttaPay`];

    for (const candidateName of candidateNames) {
      const inserted = db.prepare(`
        INSERT OR IGNORE INTO people (user_id, name, phone, email, active, is_owner, profile_kind, status, created_at)
        VALUES (?, ?, '', ?, 1, 0, 'contact', 'active', ?)
      `).run(safeOwnerUserId, candidateName, normalizedEmail, now);

      const insertedId = Number(inserted.lastInsertRowid || 0);
      if (insertedId) {
        person = db.prepare(`SELECT * FROM people WHERE id = ? AND user_id = ? AND COALESCE(status, CASE WHEN COALESCE(active, 1) = 0 THEN 'inactive' ELSE 'active' END) <> 'deleted'`).get(insertedId, safeOwnerUserId);
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
      COALESCE(p.profile_kind, CASE WHEN COALESCE(p.is_owner, 0) = 1 THEN 'self' ELSE 'contact' END) AS profile_kind,
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
      stable_u.google_photo_url AS stable_linked_user_google_photo_url,
      stable_u.profile_photo_url AS stable_linked_user_profile_photo_url,
      stable_u.profile_photo_mode AS stable_linked_user_profile_photo_mode,
      matched_u.id AS email_matched_user_id,
      matched_u.name AS email_matched_user_name,
      matched_u.email AS email_matched_user_email,
      matched_u.google_photo_url AS email_matched_user_google_photo_url,
      matched_u.profile_photo_url AS email_matched_user_profile_photo_url,
      matched_u.profile_photo_mode AS email_matched_user_profile_photo_mode,
      COALESCE(p.status, CASE WHEN COALESCE(p.active, 1) = 0 THEN 'inactive' ELSE 'active' END) AS status,
      p.deleted_at,
      p.deleted_label
    FROM people p
    LEFT JOIN person_app_links pal
      ON pal.owner_user_id = p.user_id AND pal.person_id = p.id
    LEFT JOIN users stable_u ON stable_u.id = pal.linked_user_id AND COALESCE(stable_u.status, 'active') <> 'deleted'
    LEFT JOIN users matched_u
      ON pal.linked_user_id IS NULL
     AND p.email IS NOT NULL
     AND trim(p.email) <> ''
     AND lower(matched_u.email) = lower(p.email)
     AND COALESCE(matched_u.status, 'active') <> 'deleted'
    WHERE p.user_id = ?
      AND COALESCE(p.status, CASE WHEN COALESCE(p.active, 1) = 0 THEN 'inactive' ELSE 'active' END) <> 'deleted'
    ORDER BY CASE WHEN COALESCE(p.profile_kind, CASE WHEN COALESCE(p.is_owner, 0) = 1 THEN 'self' ELSE 'contact' END) = 'self' THEN 0 ELSE 1 END, COALESCE(p.active, 1) DESC, p.name
  `).all(userId);

  const remoteIds = rows
    .map(row => Number(row.stable_linked_user_id || row.email_matched_user_id || 0))
    .filter(id => id > 0 && id !== Number(userId || 0));
  const personIds = rows.map(row => Number(row.id || 0)).filter(Boolean);
  const friendshipMap = getFriendshipMapForUser(userId, remoteIds);
  const outgoingMap = getPendingOutgoingFriendRequestByPersonMap(userId, personIds);
  const incomingMap = getPendingIncomingFriendRequestMap(userId, remoteIds);
  const remotePixMap = getUserPixProfilesByUserIds(remoteIds);

  return rows.map((person) => {
    const linkedUserId = Number(person.stable_linked_user_id || person.email_matched_user_id || 0) || null;
    const hasAppUser = !!linkedUserId && linkedUserId !== Number(userId || 0);
    const isActive = Number(person.active || 0) !== 0;
    const isSelf = isSelfPersonRow(person);
    const friendship = hasAppUser ? friendshipMap.get(linkedUserId) : null;
    const outgoingRequest = outgoingMap.get(Number(person.id || 0)) || null;
    const incomingRequest = !outgoingRequest && hasAppUser ? (incomingMap.get(linkedUserId) || null) : null;
    const friendshipActive = !!friendship;
    const canShareCharge = isFriendshipGateEnabled()
      ? friendshipActive && isActive && !isSelf
      : hasAppUser && !!normalizeEmail(person.email) && isActive && !isSelf;
    const rawProfileSignatureText = normalizeProfileSignatureText(person.stable_linked_user_profile_signature_text || person.email_matched_user_profile_signature_text || '');
    const rawProfileSignatureVibe = normalizeProfileSignatureVibe(person.stable_linked_user_profile_signature_vibe || person.email_matched_user_profile_signature_vibe || '');
    const canExposeProfileSignature = isSelf || friendshipActive;
    const visibleProfileSignatureText = canExposeProfileSignature ? rawProfileSignatureText : '';
    const visibleProfileSignatureVibe = canExposeProfileSignature ? rawProfileSignatureVibe : '';
    const visibleProfileSignatureMeta = getProfileSignatureVibeMeta(visibleProfileSignatureVibe);
    const storedPixProfile = {
      keyType: normalizePixKeyType(person.pix_key_type),
      keyValue: normalizePixKeyValue(person.pix_key_type, person.pix_key_value),
      city: sanitizePixText(person.pix_city, { max: 15 }) || null,
      state: normalizePixState(person.pix_state) || guessPixStateByCity(person.pix_city) || null,
      label: sanitizePixText(person.pix_label, { max: 25 }) || null
    };
    const ownPixProfile = validatePixProfile({
      enabled: person.pix_enabled,
      keyType: storedPixProfile.keyType,
      keyValue: storedPixProfile.keyValue,
      city: storedPixProfile.city,
      state: storedPixProfile.state,
      label: storedPixProfile.label,
      name: person.name || person.email || 'ACERTTAPAY'
    });
    const linkedUserPixProfile = !isSelf && hasAppUser
      ? (remotePixMap.get(linkedUserId) || null)
      : null;

    const effectivePixEnabled = isSelf ? !!ownPixProfile.enabled : !!linkedUserPixProfile?.pixEnabled;
    const effectivePixValid = isSelf ? !!ownPixProfile.valid : !!linkedUserPixProfile?.pixValid;
    const effectivePixReason = isSelf ? (ownPixProfile.reason || null) : (linkedUserPixProfile?.pixReason || null);
    const effectivePixKeyType = isSelf ? storedPixProfile.keyType : (linkedUserPixProfile?.pixKeyType || null);
    const effectivePixKeyTypeLabel = isSelf ? ownPixProfile.keyTypeLabel : (linkedUserPixProfile?.pixKeyTypeLabel || null);
    const effectivePixKeyValue = isSelf ? ownPixProfile.keyValue : (linkedUserPixProfile?.pixKeyValue || null);
    const effectivePixMaskedKey = isSelf ? ownPixProfile.keyMasked : (linkedUserPixProfile?.pixMaskedKey || null);
    const effectivePixCity = isSelf ? ownPixProfile.city : (linkedUserPixProfile?.pixCity || null);
    const effectivePixState = isSelf
      ? (storedPixProfile.state || guessPixStateByCity(storedPixProfile.city) || null)
      : (linkedUserPixProfile?.pixState || guessPixStateByCity(linkedUserPixProfile?.pixCity) || null);
    const effectivePixLabel = isSelf ? ownPixProfile.label : (linkedUserPixProfile?.pixLabel || null);
    const effectivePixUpdatedAt = isSelf ? (person.pix_updated_at || null) : (linkedUserPixProfile?.pixUpdatedAt || null);

    let friendshipState = 'none';
    if (friendshipActive) friendshipState = 'active';
    else if (outgoingRequest) friendshipState = 'pending_sent';
    else if (incomingRequest) friendshipState = 'pending_received';
    else if (hasAppUser) friendshipState = 'discoverable';

    return {
      ...person,
      profile_kind: isSelf ? 'self' : 'contact',
      is_self: isSelf,
      is_owner: isSelf ? 1 : 0,
      linked_user_id: linkedUserId,
      linked_user_name: person.stable_linked_user_name || person.email_matched_user_name || null,
      linked_user_email: normalizeEmail(person.stable_linked_user_email || person.email_matched_user_email || null),
      linked_user_photo_url: getEffectiveProfilePhoto({
        profile_photo_url: person.stable_linked_user_profile_photo_url || person.email_matched_user_profile_photo_url || '',
        google_photo_url: person.stable_linked_user_google_photo_url || person.email_matched_user_google_photo_url || '',
        profile_photo_mode: person.stable_linked_user_profile_photo_mode || person.email_matched_user_profile_photo_mode || 'default'
      }),
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
      pix_enabled: effectivePixEnabled,
      pix_valid: effectivePixValid,
      pix_reason: effectivePixReason,
      pix_key_type: effectivePixKeyType,
      pix_key_type_label: effectivePixKeyTypeLabel,
      pix_key_value: effectivePixKeyValue,
      pix_masked_key: effectivePixMaskedKey,
      pix_city: effectivePixCity,
      pix_state: effectivePixState,
      pix_label: effectivePixLabel,
      pix_key_value_input: isSelf ? formatPixKeyValueForInput(storedPixProfile.keyType, ownPixProfile.keyValue) : '',
      pix_updated_at: effectivePixUpdatedAt,
      linked_user_pix_enabled: !isSelf && !!linkedUserPixProfile?.pixEnabled,
      linked_user_pix_ready: !isSelf && !!linkedUserPixProfile?.pixEnabled && !!linkedUserPixProfile?.pixValid,
      linked_user_pix_reason: !isSelf ? (linkedUserPixProfile?.pixReason || null) : null,
      linked_user_pix_city: !isSelf ? (linkedUserPixProfile?.pixCity || null) : null,
      linked_user_pix_state: !isSelf ? (linkedUserPixProfile?.pixState || guessPixStateByCity(linkedUserPixProfile?.pixCity) || null) : null,
      linked_user_pix_updated_at: !isSelf ? (linkedUserPixProfile?.pixUpdatedAt || null) : null,
      profile_signature_text: visibleProfileSignatureText || '',
      profile_signature_vibe: visibleProfileSignatureVibe || '',
      profile_signature_vibe_label: visibleProfileSignatureMeta?.label || null,
      has_profile_signature: !!(visibleProfileSignatureText || visibleProfileSignatureVibe)
    };
  });
}

function getManualSharedDebtEligiblePeople(userId) {
  return getPeopleAll(userId)
    .filter(person => person && person.can_share_charge && person.friendship_active && Number(person.active || 0) !== 0 && !person.is_self)
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR', { sensitivity: 'base' }));
}

function getPrivateDebtReminderSelectablePeople(userId) {
  return getPeopleAll(userId)
    .filter(person => person && Number(person.active || 0) !== 0 && !person.is_self)
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR', { sensitivity: 'base' }));
}

function normalizeManualSharedDebtMode(value) {
  return String(value || '').trim().toLowerCase() === 'private' ? 'private' : 'app';
}

function createPrivateDebtReminder({ ownerUserId, person, description, amountCents, note = null, promisedPaymentDate = null, createdAt = null }) {
  const cleanOwnerUserId = Number(ownerUserId || 0);
  const cleanAmountCents = Math.max(0, Number(amountCents || 0));
  if (!cleanOwnerUserId || !person || !cleanAmountCents) return null;

  const snapshots = buildPrivateDebtPersonSnapshots(person);
  const now = createdAt || nowIso();
  const cleanDescription = sanitizePrivateDebtDescription(description, 120);
  const cleanNote = sanitizePrivateDebtNote(note, 400);
  const cleanPromisedPaymentDate = normalizePrivateDebtPromisedPaymentDate(promisedPaymentDate);
  if (!cleanDescription) return null;

  const info = db.prepare(`
    INSERT INTO private_debt_reminders (
      owner_user_id,
      person_id,
      linked_user_id_snapshot,
      person_name_snapshot,
      person_email_snapshot,
      person_phone_snapshot,
      description_snapshot,
      amount_cents,
      request_note,
      promised_payment_date,
      status,
      is_archived,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', 0, ?, ?)
  `).run(
    cleanOwnerUserId,
    snapshots.personId,
    snapshots.linkedUserIdSnapshot,
    snapshots.personNameSnapshot,
    snapshots.personEmailSnapshot,
    snapshots.personPhoneSnapshot,
    cleanDescription,
    cleanAmountCents,
    cleanNote,
    cleanPromisedPaymentDate,
    now,
    now
  );

  return Number(info.lastInsertRowid || 0) || null;
}

function getPrivateDebtReminderRowForOwner(ownerUserId, reminderId, { includeArchived = true } = {}) {
  const safeOwnerUserId = Number(ownerUserId || 0);
  const safeReminderId = Number(reminderId || 0);
  if (!safeOwnerUserId || !safeReminderId) return null;

  const where = ['r.owner_user_id = ?', 'r.id = ?'];
  const params = [safeOwnerUserId, safeReminderId];
  if (!includeArchived) {
    where.push('COALESCE(r.is_archived, 0) = 0');
  }

  const row = db.prepare(`
    SELECT
      r.*,
      p.name AS current_person_name,
      COALESCE(p.status, CASE WHEN COALESCE(p.active, 1) = 0 THEN 'inactive' ELSE 'active' END) AS current_person_status,
      COALESCE(p.active, 1) AS current_person_active
    FROM private_debt_reminders r
    LEFT JOIN people p ON p.id = r.person_id AND p.user_id = r.owner_user_id
    WHERE ${where.join(' AND ')}
    LIMIT 1
  `).get(...params);

  return row ? mapPrivateDebtReminderRow(row) : null;
}

function buildPrivateDebtReminderTrackingSearchText(item = {}) {
  const createdDateText = item?.created_at ? formatDateBR(item.created_at) : '';
  const promisedDateText = item?.promised_payment_date ? formatDateBR(item.promised_payment_date) : '';
  const paymentDateText = item?.payment_date ? formatDateBR(item.payment_date) : '';

  return normalizeSharedDebtSearchTerm([
    item?.description_snapshot,
    item?.request_note,
    item?.settlement_note,
    item?.display_name,
    item?.person_name_snapshot,
    item?.person_email_snapshot,
    item?.person_phone_snapshot,
    item?.current_person_name,
    item?.status,
    'privado',
    createdDateText,
    promisedDateText,
    paymentDateText,
    'data combinada',
    'pagamento combinado'
  ].filter(Boolean).join(' '));
}

function filterPrivateDebtReminderTrackingItems(items = [], filters = {}) {
  const normalized = normalizeSharedDebtTrackingFilters(filters);
  const searchTerm = normalizeSharedDebtSearchTerm(normalized.q || '');

  return (Array.isArray(items) ? items : []).filter((item) => {
    if (normalized.envio === 'grouped') return false;
    if (normalized.origin !== 'all' && normalized.origin !== 'private') return false;
    if (normalized.installment === 'yes') return false;
    if (searchTerm && !buildPrivateDebtReminderTrackingSearchText(item).includes(searchTerm)) return false;
    return true;
  });
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
    const hasPartialPayment = Number(card.paid_cents || 0) > 0;
    const messageKey = hasPartialPayment
      ? (sequenceNo > 1 ? 'push.card_due_today.single.repeat.partial' : 'push.card_due_today.single.first.partial')
      : (sequenceNo > 1 ? 'push.card_due_today.single.repeat.expected' : 'push.card_due_today.single.first.expected');
    const fallbackTitle = sequenceNo > 1 ? 'Lembrete: sua fatura vence hoje' : 'Hoje vence sua fatura';
    const fallbackBody = hasPartialPayment
      ? `${card.card_name} vence hoje. Ainda faltam ${formatBRLFromCents(card.remaining_cents)} para fechar essa conta.`
      : `${card.card_name} vence hoje. O valor previsto é ${formatBRLFromCents(card.total_cents)}.`;
    const resolved = resolveCatalogText(messageKey, {
      cartao: card.card_name,
      valor_restante: formatBRLFromCents(card.remaining_cents),
      valor_total: formatBRLFromCents(card.total_cents)
    }, {
      fallbackTitle,
      fallbackBody
    });

    return {
      title: resolved.title,
      body: resolved.body,
      href,
      tag: `card-due-today:${zonedToday.dateKey}`
    };
  }

  const previewNames = cards.slice(0, 2).map(item => item.card_name).join(', ');
  const extraCount = cards.length > 2 ? ` e mais ${cards.length - 2}` : '';
  const messageKey = sequenceNo > 1 ? 'push.card_due_today.multi.repeat' : 'push.card_due_today.multi.first';
  const fallbackTitle = sequenceNo > 1 ? 'Lembrete: tem fatura vencendo hoje' : 'Hoje tem fatura vencendo';
  const fallbackBody = `${formatCountLabel(cards.length, 'fatura', 'faturas')} vencem hoje. Entre elas: ${previewNames}${extraCount}. Ainda faltam ${formatBRLFromCents(totalRemaining)} para quitar tudo no resumo.`;
  const resolved = resolveCatalogText(messageKey, {
    n_faturas: formatCountLabel(cards.length, 'fatura', 'faturas'),
    previsao_cartoes: `${previewNames}${extraCount}`,
    valor_total_pendente: formatBRLFromCents(totalRemaining)
  }, {
    fallbackTitle,
    fallbackBody
  });

  return {
    title: resolved.title,
    body: resolved.body,
    href,
    tag: `card-due-today:${zonedToday.dateKey}`
  };
}

async function sendPushNotificationToUser(userId, payload) {
  if (!isPushConfigured()) return { attempted: 0, sent: 0, failed: 0 };

  const subscriptions = getPushSubscriptionsForUser(userId);
  if (!subscriptions.length) return { attempted: 0, sent: 0, failed: 0 };

  const message = JSON.stringify({
    title: String(payload?.title || 'AcerttaPay'),
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

  const pushConfig = getCardDueTodayPushRuntimeConfig();
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
      if (!isUserNotificationGroupEnabled(userId, 'card_due_today')) continue;

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

function startManualDebtDueScheduler() {
  restartManualDebtDueScheduler();
}

function queuePushNotification(userId, payload) {
  if (!isPushConfigured()) return;

  Promise.resolve()
    .then(() => sendPushNotificationToUser(userId, payload))
    .catch(err => console.error('Falha ao disparar push notification:', err?.message || err));
}

function createNotification({ userId, type, title, body = null, href = null, relatedType = null, relatedId = null, groupKey = null, messageKey = null, messageVariables = null }) {
  const targetUser = getUserRecord(userId, { includeDeleted: false });
  if (!targetUser) return null;

  const resolvedMessage = messageKey
    ? resolveCatalogText(messageKey, messageVariables || {}, { fallbackTitle: title, fallbackBody: body })
    : null;
  const finalTitle = resolvedMessage?.title || title;
  const finalBody = resolvedMessage?.body || body;

  const resolvedGroupKey = resolveNotificationPreferenceGroupKey({ groupKey, type, title: finalTitle, relatedType });
  if (resolvedGroupKey && !isUserNotificationGroupEnabled(targetUser.id, resolvedGroupKey)) {
    return null;
  }

  const result = db.prepare(`
    INSERT INTO notifications (user_id, type, title, body, href, is_read, related_type, related_id, created_at)
    VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
  `).run(targetUser.id, type, finalTitle, finalBody, href, relatedType, relatedId, nowIso());

  const pushTag = relatedType && relatedId ? `${relatedType}:${relatedId}` : `${type}:${result.lastInsertRowid || nowIso()}`;
  queuePushNotification(targetUser.id, { title: finalTitle, body: finalBody, href, tag: pushTag });

  return result;
}


function normalizeManualDebtDueScope(value = '') {
  return String(value || '').trim().toLowerCase() === 'pay' ? 'pay' : 'receive';
}

function normalizeManualDebtDueUserIds(userIds = null) {
  const source = Array.isArray(userIds) ? userIds : (userIds == null ? [] : [userIds]);
  const ids = Array.from(new Set(source.map((value) => Number(value || 0)).filter(Boolean)));
  return ids.length ? ids : null;
}

function getManualDebtDueRuntimeConfig() {
  return getDateDrivenAlertRuntimeConfig();
}

function getManualDebtDueScheduleContext(reference = dayjs()) {
  const config = getManualDebtDueRuntimeConfig();
  const now = dayjs(reference).tz(config.timezone);
  const scheduledAt = now.startOf('day').hour(config.hour).minute(config.minute).second(0).millisecond(0);
  return {
    config,
    now,
    scheduledAt,
    dateKey: now.format('YYYY-MM-DD')
  };
}

function getManualDebtDueBucketsForDate(dateKey, { userIds = null } = {}) {
  const safeDateKey = String(dateKey || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(safeDateKey)) return new Map();

  const filteredUserIds = normalizeManualDebtDueUserIds(userIds);
  const payUserFilterSql = filteredUserIds ? ` AND r.receiver_user_id IN (${filteredUserIds.map(() => '?').join(', ')})` : '';
  const receiveUserFilterSql = filteredUserIds ? ` AND r.requester_user_id IN (${filteredUserIds.map(() => '?').join(', ')})` : '';
  const privateUserFilterSql = filteredUserIds ? ` AND r.owner_user_id IN (${filteredUserIds.map(() => '?').join(', ')})` : '';

  const payRows = db.prepare(`
    SELECT
      r.id,
      r.receiver_user_id AS target_user_id,
      'pay' AS scope,
      'shared_request' AS item_kind,
      r.description_snapshot,
      r.amount_cents,
      u.name AS counterpart_name,
      u.email AS counterpart_email
    FROM shared_debt_requests r
    JOIN users u ON u.id = r.requester_user_id
    LEFT JOIN shared_debt_archives a
      ON a.request_id = r.id
     AND a.user_id = r.receiver_user_id
    WHERE r.request_kind = 'manual'
      AND r.promised_payment_date = ?
      AND r.status IN ('pending', 'accepted')
      AND r.payment_marked_at IS NULL
      AND COALESCE(a.is_archived, 0) = 0
      ${payUserFilterSql}
    ORDER BY r.created_at ASC, r.id ASC
  `).all(safeDateKey, ...(filteredUserIds || []));

  const receiveRows = db.prepare(`
    SELECT
      r.id,
      r.requester_user_id AS target_user_id,
      'receive' AS scope,
      'shared_request' AS item_kind,
      r.description_snapshot,
      r.amount_cents,
      u.name AS counterpart_name,
      u.email AS counterpart_email
    FROM shared_debt_requests r
    JOIN users u ON u.id = r.receiver_user_id
    LEFT JOIN shared_debt_archives a
      ON a.request_id = r.id
     AND a.user_id = r.requester_user_id
    WHERE r.request_kind = 'manual'
      AND r.promised_payment_date = ?
      AND r.status IN ('pending', 'accepted')
      AND r.payment_marked_at IS NULL
      AND COALESCE(a.is_archived, 0) = 0
      ${receiveUserFilterSql}
    ORDER BY r.created_at ASC, r.id ASC
  `).all(safeDateKey, ...(filteredUserIds || []));

  const privateRows = db.prepare(`
    SELECT
      r.id,
      r.owner_user_id AS target_user_id,
      'receive' AS scope,
      'private_reminder' AS item_kind,
      r.description_snapshot,
      r.amount_cents,
      COALESCE(r.person_name_snapshot, p.name, 'Contato') AS counterpart_name,
      COALESCE(r.person_email_snapshot, p.email) AS counterpart_email
    FROM private_debt_reminders r
    LEFT JOIN people p ON p.id = r.person_id AND p.user_id = r.owner_user_id
    WHERE r.promised_payment_date = ?
      AND r.status = 'open'
      AND COALESCE(r.is_archived, 0) = 0
      ${privateUserFilterSql}
    ORDER BY r.created_at ASC, r.id ASC
  `).all(safeDateKey, ...(filteredUserIds || []));

  const buckets = new Map();
  const append = (row) => {
    const userId = Number(row?.target_user_id || 0);
    if (!userId) return;
    if (!buckets.has(userId)) {
      buckets.set(userId, { userId, pay: [], receive: [] });
    }
    const entry = buckets.get(userId);
    entry[normalizeManualDebtDueScope(row?.scope)].push({
      id: Number(row?.id || 0) || null,
      item_kind: String(row?.item_kind || 'shared_request').trim() || 'shared_request',
      description_snapshot: String(row?.description_snapshot || '').trim(),
      amount_cents: Math.max(0, Number(row?.amount_cents || 0) || 0),
      counterpart_name: String(row?.counterpart_name || '').trim() || null,
      counterpart_email: String(row?.counterpart_email || '').trim() || null
    });
  };

  [...payRows, ...receiveRows, ...privateRows].forEach(append);
  return buckets;
}

function hasManualDebtDueAlertLog({ userId, scope, dateKey }) {
  const safeUserId = Number(userId || 0);
  const safeScope = normalizeManualDebtDueScope(scope);
  const safeDateKey = String(dateKey || '').trim();
  if (!safeUserId || !/^\d{4}-\d{2}-\d{2}$/.test(safeDateKey)) return false;

  const row = db.prepare(`
    SELECT id
    FROM manual_debt_due_alert_logs
    WHERE user_id = ? AND scope = ? AND date_key = ?
    LIMIT 1
  `).get(safeUserId, safeScope, safeDateKey);

  return !!row;
}

function recordManualDebtDueAlertLog({ userId, scope, dateKey, payload = null }) {
  const safeUserId = Number(userId || 0);
  const safeScope = normalizeManualDebtDueScope(scope);
  const safeDateKey = String(dateKey || '').trim();
  if (!safeUserId || !/^\d{4}-\d{2}-\d{2}$/.test(safeDateKey)) return false;

  const info = db.prepare(`
    INSERT OR IGNORE INTO manual_debt_due_alert_logs (user_id, scope, date_key, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(safeUserId, safeScope, safeDateKey, payload ? JSON.stringify(payload) : null, nowIso());

  return Number(info.changes || 0) > 0;
}

function buildManualDebtDueCounterpartPreview(items = []) {
  const names = Array.from(new Set(
    (Array.isArray(items) ? items : [])
      .map((item) => String(item?.counterpart_name || item?.counterpart_email || '').trim())
      .filter(Boolean)
  ));

  if (!names.length) return '';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} e ${names[1]}`;
  return `${names[0]}, ${names[1]} e mais ${names.length - 2}`;
}

function resolveManualDebtDueHref(scope, items = []) {
  const safeScope = normalizeManualDebtDueScope(scope);
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!list.length) return '/shared-debts';

  if (list.length === 1) {
    const item = list[0];
    if (item.item_kind === 'private_reminder') return `/shared-debts?private=${item.id}`;
    return `/shared-debts?request=${item.id}`;
  }

  if (safeScope === 'pay') return '/shared-debts#received';

  const kinds = Array.from(new Set(list.map((item) => item.item_kind)));
  if (kinds.length === 1 && kinds[0] === 'private_reminder') return '/shared-debts#private-reminders';
  if (kinds.length === 1 && kinds[0] === 'shared_request') return '/shared-debts#sent';
  return '/shared-debts';
}

function buildManualDebtDueNotificationPayload(scope, items = [], dateKey = null) {
  const safeScope = normalizeManualDebtDueScope(scope);
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  const totalCents = list.reduce((sum, item) => sum + Math.max(0, Number(item?.amount_cents || 0) || 0), 0);
  const counterpartPreview = buildManualDebtDueCounterpartPreview(list);
  const href = resolveManualDebtDueHref(safeScope, list);

  if (list.length === 1) {
    const item = list[0];
    const counterpart = item.counterpart_name || item.counterpart_email || 'alguém';
    const description = item.description_snapshot || 'esse combinado';
    const messageKey = safeScope === 'pay'
      ? 'notification.manual_debt_due.pay.single'
      : 'notification.manual_debt_due.receive.single';
    const fallbackTitle = safeScope === 'pay' ? 'Hoje é o dia combinado para pagar' : 'Hoje é o dia combinado para receber';
    const fallbackBody = safeScope === 'pay'
      ? `Tem ${formatBRLFromCents(item.amount_cents)} combinado com ${counterpart} em ${description}.`
      : `Tem ${formatBRLFromCents(item.amount_cents)} combinado com ${counterpart} em ${description} batendo hoje.`;
    const resolved = resolveCatalogText(messageKey, {
      valor: formatBRLFromCents(item.amount_cents),
      contraparte: counterpart,
      descricao: description
    }, {
      fallbackTitle,
      fallbackBody
    });

    return {
      title: resolved.title,
      body: resolved.body,
      href,
      relatedType: item.item_kind === 'private_reminder' ? 'private_debt_reminder' : 'shared_debt_request',
      relatedId: item.id || null,
      payloadMeta: { scope: safeScope, dateKey, totalCents, count: 1, itemKind: item.item_kind }
    };
  }

  const messageKey = safeScope === 'pay'
    ? 'notification.manual_debt_due.pay.multi'
    : 'notification.manual_debt_due.receive.multi';
  const fallbackTitle = safeScope === 'pay' ? 'Hoje tem combinados para pagar' : 'Hoje tem combinados para receber';
  const fallbackBody = `São ${formatCountLabel(list.length, 'combinado', 'combinados')} batendo hoje, somando ${formatBRLFromCents(totalCents)}${counterpartPreview ? ` com ${counterpartPreview}` : ''}.`;
  const resolved = resolveCatalogText(messageKey, {
    n_combinados: formatCountLabel(list.length, 'combinado', 'combinados'),
    valor_total: formatBRLFromCents(totalCents),
    previsao_contrapartes: counterpartPreview
  }, {
    fallbackTitle,
    fallbackBody
  });

  return {
    title: resolved.title,
    body: resolved.body,
    href,
    relatedType: list.every((item) => item.item_kind === 'private_reminder') ? 'private_debt_reminder' : 'shared_debt_request',
    relatedId: list.length === 1 ? list[0].id || null : null,
    payloadMeta: { scope: safeScope, dateKey, totalCents, count: list.length }
  };
}

function buildManualDebtDueDashboardAlert(scope, items = [], dateKey = null) {
  const payload = buildManualDebtDueNotificationPayload(scope, items, dateKey);
  const safeScope = normalizeManualDebtDueScope(scope);
  const messageKey = safeScope === 'pay' ? 'dashboard.manual_debt_due.pay' : 'dashboard.manual_debt_due.receive';
  const fallbackTitle = safeScope === 'pay'
    ? 'Tem combinado batendo hoje para pagar'
    : 'Tem combinado batendo hoje para receber';
  const resolved = resolveCatalogText(messageKey, {
    body_reaproveitado: payload.body
  }, {
    fallbackTitle,
    fallbackBody: payload.body
  });

  return {
    type: safeScope === 'pay' ? 'warning' : 'info',
    icon: safeScope === 'pay' ? '💸' : '📥',
    title: resolved.title,
    description: resolved.body || payload.body,
    href: payload.href
  };
}

async function deliverManualDebtDueAlertsForDate(dateKey, { userIds = null } = {}) {
  const buckets = getManualDebtDueBucketsForDate(dateKey, { userIds });
  let deliveredCount = 0;

  for (const [userId, bucket] of buckets.entries()) {
    for (const scope of ['pay', 'receive']) {
      const items = Array.isArray(bucket?.[scope]) ? bucket[scope] : [];
      if (!items.length) continue;
      if (hasManualDebtDueAlertLog({ userId, scope, dateKey })) continue;

      const payload = buildManualDebtDueNotificationPayload(scope, items, dateKey);
      const result = createNotification({
        userId,
        type: 'shared_debt_request',
        title: payload.title,
        body: payload.body,
        href: payload.href,
        relatedType: payload.relatedType,
        relatedId: payload.relatedId,
        groupKey: 'due_date_alerts'
      });

      if (result) {
        recordManualDebtDueAlertLog({ userId, scope, dateKey, payload: payload.payloadMeta });
        deliveredCount += 1;
      }
    }
  }

  return deliveredCount;
}

async function runManualDebtDueAlertSweep() {
  const config = getDateDrivenAlertRuntimeConfig();
  if (!config.enabled || scheduledManualDebtDueSweepRunning) return;
  scheduledManualDebtDueSweepRunning = true;

  try {
    const { now, scheduledAt, dateKey } = getManualDebtDueScheduleContext();
    if (now.isBefore(scheduledAt)) return;
    await deliverManualDebtDueAlertsForDate(dateKey);
  } catch (error) {
    console.error('Falha no sweep de alertas da data combinada:', error?.message || error);
  } finally {
    scheduledManualDebtDueSweepRunning = false;
  }
}


function getUsersWithMonthlyFinanceAlertCandidates(month, year) {
  const safeMonth = Number(month || 0);
  const safeYear = Number(year || 0);
  if (!safeMonth || !safeYear) return [];

  const previous = getPreviousMonthYear(safeMonth, safeYear);
  const targetPrefix = `${safeYear}-${String(safeMonth).padStart(2, '0')}`;
  const rows = db.prepare(`
    SELECT DISTINCT user_id
    FROM monthly_finances
    WHERE (month = ? AND year = ?) OR (month = ? AND year = ?)
    UNION
    SELECT DISTINCT mf.user_id
    FROM monthly_finance_items fi
    JOIN monthly_finances mf ON mf.id = fi.finance_id AND mf.user_id = fi.user_id
    WHERE substr(COALESCE(fi.item_date, ''), 1, 7) = ?
    ORDER BY user_id ASC
  `).all(safeMonth, safeYear, previous.month, previous.year, targetPrefix);

  return rows.map((row) => Number(row.user_id || 0)).filter(Boolean);
}

function materializeMonthlyFinanceStructureForUsers(userIds, month, year) {
  const normalizedUserIds = normalizeManualDebtDueUserIds(userIds) || [];
  normalizedUserIds.forEach((userId) => {
    ensureMonthlyFinanceScaffold(userId, Number(month), Number(year));
    syncMonthlyFinanceCarryForward(userId, Number(month), Number(year));
  });
}

function getMonthlyFinanceBucketsForDate(dateKey, { userIds = null, month = null, year = null } = {}) {
  const safeDateKey = String(dateKey || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(safeDateKey)) return new Map();

  const safeYear = Number(year || safeDateKey.slice(0, 4));
  const safeMonth = Number(month || safeDateKey.slice(5, 7));
  if (!safeYear || !safeMonth) return new Map();

  const filteredUserIds = normalizeManualDebtDueUserIds(userIds);
  const userFilterSql = filteredUserIds ? ` AND mf.user_id IN (${filteredUserIds.map(() => '?').join(', ')})` : '';

  const fixedRows = db.prepare(`
    SELECT mf.id AS finance_id, mf.user_id, mf.type, mf.description, mf.amount_cents,
           mf.day_of_month, mf.schedule_kind, mf.is_paid
    FROM monthly_finances mf
    WHERE mf.month = ?
      AND mf.year = ?
      AND mf.amount_mode = 'fixed'
      AND COALESCE(mf.amount_cents, 0) > 0
      AND COALESCE(mf.day_of_month, 0) > 0
      ${userFilterSql}
    ORDER BY mf.id ASC
  `).all(safeMonth, safeYear, ...(filteredUserIds || []));

  const itemRows = db.prepare(`
    SELECT fi.id AS item_id, fi.finance_id, fi.user_id, fi.item_date, fi.item_source,
           fi.amount_cents, fi.is_paid, mf.type, mf.description
    FROM monthly_finance_items fi
    JOIN monthly_finances mf ON mf.id = fi.finance_id AND mf.user_id = fi.user_id
    WHERE mf.month = ?
      AND mf.year = ?
      AND mf.amount_mode = 'variable'
      AND fi.item_date = ?
      AND COALESCE(fi.amount_cents, 0) > 0
      ${userFilterSql}
    ORDER BY fi.id ASC
  `).all(safeMonth, safeYear, safeDateKey, ...(filteredUserIds || []));

  const buckets = new Map();
  const append = (userId, type, payload) => {
    const safeUserId = Number(userId || 0);
    const safeType = normalizeFinanceType(type);
    if (!safeUserId || !safeType) return;
    if (!buckets.has(safeUserId)) {
      buckets.set(safeUserId, { userId: safeUserId, income: [], expense: [] });
    }
    buckets.get(safeUserId)[safeType].push(payload);
  };

  fixedRows.forEach((row) => {
    const effectiveDate = computeMonthlyFinanceEffectiveDate(safeYear, safeMonth, row.day_of_month);
    if (effectiveDate !== safeDateKey) return;
    if (normalizeFinanceType(row.type) === 'expense' && normalizeFinancePaidFlag(row.is_paid) === 1) return;

    append(row.user_id, row.type, {
      source_kind: 'fixed_finance',
      source_ref: String(row.finance_id),
      finance_id: Number(row.finance_id || 0) || null,
      finance_item_id: null,
      description: String(row.description || '').trim() || (normalizeFinanceType(row.type) === 'income' ? 'entrada do mês' : 'saída do mês'),
      amount_cents: Math.max(0, Number(row.amount_cents || 0) || 0),
      schedule_kind: resolveFinanceScheduleKind(row)
    });
  });

  itemRows.forEach((row) => {
    if (normalizeFinanceType(row.type) === 'expense' && normalizeFinancePaidFlag(row.is_paid) === 1) return;
    append(row.user_id, row.type, {
      source_kind: 'variable_item',
      source_ref: String(row.item_id),
      finance_id: Number(row.finance_id || 0) || null,
      finance_item_id: Number(row.item_id || 0) || null,
      description: String(row.item_source || row.description || '').trim() || (normalizeFinanceType(row.type) === 'income' ? 'entrada do mês' : 'saída do mês'),
      amount_cents: Math.max(0, Number(row.amount_cents || 0) || 0),
      schedule_kind: normalizeFinanceType(row.type) === 'income' ? 'receive' : 'pay'
    });
  });

  return buckets;
}

function hasMonthlyFinanceAlertLog({ userId, sourceKind, sourceRef, type, dateKey }) {
  const safeUserId = Number(userId || 0);
  const safeType = normalizeFinanceType(type);
  const safeDateKey = String(dateKey || '').trim();
  const safeSourceKind = String(sourceKind || '').trim();
  const safeSourceRef = String(sourceRef || '').trim();
  if (!safeUserId || !safeType || !safeSourceKind || !safeSourceRef || !/^\d{4}-\d{2}-\d{2}$/.test(safeDateKey)) return false;

  const row = db.prepare(`
    SELECT id
    FROM monthly_finance_alert_logs
    WHERE user_id = ? AND source_kind = ? AND source_ref = ? AND type = ? AND date_key = ?
    LIMIT 1
  `).get(safeUserId, safeSourceKind, safeSourceRef, safeType, safeDateKey);

  return !!row;
}

function recordMonthlyFinanceAlertLog({ userId, sourceKind, sourceRef, type, dateKey, payload = null }) {
  const safeUserId = Number(userId || 0);
  const safeType = normalizeFinanceType(type);
  const safeDateKey = String(dateKey || '').trim();
  const safeSourceKind = String(sourceKind || '').trim();
  const safeSourceRef = String(sourceRef || '').trim();
  if (!safeUserId || !safeType || !safeSourceKind || !safeSourceRef || !/^\d{4}-\d{2}-\d{2}$/.test(safeDateKey)) return false;

  const info = db.prepare(`
    INSERT OR IGNORE INTO monthly_finance_alert_logs (user_id, source_kind, source_ref, type, date_key, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(safeUserId, safeSourceKind, safeSourceRef, safeType, safeDateKey, payload ? JSON.stringify(payload) : null, nowIso());

  return Number(info.changes || 0) > 0;
}

async function deliverMonthlyFinanceDateAlertsForDate(dateKey, { userIds = null } = {}) {
  const safeDateKey = String(dateKey || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(safeDateKey)) return 0;

  const safeYear = Number(safeDateKey.slice(0, 4));
  const safeMonth = Number(safeDateKey.slice(5, 7));
  let candidateUserIds = normalizeManualDebtDueUserIds(userIds);
  if (!candidateUserIds) {
    candidateUserIds = getUsersWithMonthlyFinanceAlertCandidates(safeMonth, safeYear);
  }
  if (!candidateUserIds || !candidateUserIds.length) return 0;

  materializeMonthlyFinanceStructureForUsers(candidateUserIds, safeMonth, safeYear);
  const buckets = getMonthlyFinanceBucketsForDate(safeDateKey, { userIds: candidateUserIds, month: safeMonth, year: safeYear });
  let deliveredCount = 0;

  candidateUserIds.forEach((userId) => {
    const bucket = buckets.get(userId) || { income: [], expense: [] };

    ['income', 'expense'].forEach((type) => {
      const freshItems = (Array.isArray(bucket[type]) ? bucket[type] : []).filter((item) => !hasMonthlyFinanceAlertLog({
        userId,
        sourceKind: item.source_kind,
        sourceRef: item.source_ref,
        type,
        dateKey: safeDateKey
      }));

      if (!freshItems.length) return;

      const payload = buildMonthlyFinanceDateNotificationPayload(type, freshItems, {
        year: safeYear,
        month: safeMonth,
        dateKey: safeDateKey
      });

      const result = createNotification({
        userId,
        type: 'monthly_finance_date',
        title: payload.title,
        body: payload.body,
        href: payload.href,
        relatedType: 'monthly_finance',
        relatedId: freshItems.length === 1
          ? Number(freshItems[0].finance_item_id || freshItems[0].finance_id || 0) || null
          : null,
        groupKey: 'finance_date_alerts'
      });

      if (result) {
        freshItems.forEach((item) => {
          recordMonthlyFinanceAlertLog({
            userId,
            sourceKind: item.source_kind,
            sourceRef: item.source_ref,
            type,
            dateKey: safeDateKey,
            payload: {
              amountCents: item.amount_cents,
              description: item.description,
              scheduleKind: item.schedule_kind
            }
          });
        });
        deliveredCount += 1;
      }
    });
  });

  return deliveredCount;
}

async function runMonthlyFinanceDateAlertSweep() {
  const config = getMonthlyFinanceDateAlertRuntimeConfig();
  if (!config.enabled || scheduledMonthlyFinanceAlertSweepRunning) return;
  scheduledMonthlyFinanceAlertSweepRunning = true;

  try {
    const { now, scheduledAt, dateKey } = getManualDebtDueScheduleContext();
    if (now.isBefore(scheduledAt)) return;
    await deliverMonthlyFinanceDateAlertsForDate(dateKey);
  } catch (error) {
    console.error('Falha no sweep das datas do mês:', error?.message || error);
  } finally {
    scheduledMonthlyFinanceAlertSweepRunning = false;
  }
}

async function runDateDrivenAlertSweep() {
  await runManualDebtDueAlertSweep();
  await runMonthlyFinanceDateAlertSweep();
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
  const timestamp = nowIso();

  db.prepare(`
    UPDATE shared_debt_requests
    SET source_allocation_id = NULL,
        updated_at = ?
    WHERE requester_user_id = ?
      AND source_transaction_id = ?
      AND source_allocation_id IS NOT NULL
  `).run(timestamp, userId, txnId);

  db.prepare(`
    UPDATE shared_debt_send_queue_items
    SET source_allocation_id = NULL,
        updated_at = ?
    WHERE requester_user_id = ?
      AND source_transaction_id = ?
      AND source_allocation_id IS NOT NULL
  `).run(timestamp, userId, txnId);
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


function getSharedDebtEligibleAllocationRows(userId, txnId) {
  return (isFriendshipGateEnabled()
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
      JOIN people p ON p.id = a.person_id AND p.user_id = a.user_id AND COALESCE(p.status, CASE WHEN COALESCE(p.active, 1) = 0 THEN 'inactive' ELSE 'active' END) <> 'deleted'
      JOIN person_app_links pal ON pal.owner_user_id = p.user_id AND pal.person_id = p.id
      JOIN users remote_u ON remote_u.id = pal.linked_user_id AND COALESCE(remote_u.status, 'active') <> 'deleted'
      JOIN friendships f
        ON f.status = 'active'
       AND f.user_low_id = CASE WHEN p.user_id < pal.linked_user_id THEN p.user_id ELSE pal.linked_user_id END
       AND f.user_high_id = CASE WHEN p.user_id < pal.linked_user_id THEN pal.linked_user_id ELSE p.user_id END
      WHERE a.user_id = ?
        AND a.transaction_id = ?
        AND COALESCE(p.active, 1) = 1
        AND COALESCE(p.profile_kind, CASE WHEN COALESCE(p.is_owner, 0) = 1 THEN 'self' ELSE 'contact' END) <> 'self'
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
      JOIN people p ON p.id = a.person_id AND p.user_id = a.user_id AND COALESCE(p.status, CASE WHEN COALESCE(p.active, 1) = 0 THEN 'inactive' ELSE 'active' END) <> 'deleted'
      JOIN users u ON lower(u.email) = lower(p.email) AND COALESCE(u.status, 'active') <> 'deleted'
      WHERE a.user_id = ?
        AND a.transaction_id = ?
        AND p.email IS NOT NULL
        AND trim(p.email) <> ''
        AND u.id <> ?
        AND a.share_cents > 0
      ORDER BY a.id
    `).all(userId, txnId, userId));
}

function getSharedDebtDraftQueuedPersonIdSetForTransaction(userId, txnId) {
  const rows = db.prepare(`
    SELECT DISTINCT i.source_person_id
    FROM shared_debt_send_queue_items i
    JOIN shared_debt_send_queues q ON q.id = i.queue_id
    WHERE q.requester_user_id = ?
      AND q.request_kind = 'card'
      AND q.status = 'draft'
      AND i.cancelled_at IS NULL
      AND i.source_transaction_id = ?
  `).all(userId, txnId);
  return new Set(rows.map((row) => Number(row.source_person_id || 0)).filter(Boolean));
}

function getSharedDebtDraftQueuedTxnIdSet(userId, txnIds = []) {
  const cleanIds = Array.from(new Set((txnIds || []).map(Number).filter(Boolean)));
  const params = [userId];
  let where = `
    q.requester_user_id = ?
      AND q.request_kind = 'card'
      AND q.status = 'draft'
      AND i.cancelled_at IS NULL
  `;

  if (cleanIds.length) {
    where += ` AND i.source_transaction_id IN (${cleanIds.map(() => '?').join(', ')})`;
    params.push(...cleanIds);
  }

  const rows = db.prepare(`
    SELECT DISTINCT i.source_transaction_id
    FROM shared_debt_send_queue_items i
    JOIN shared_debt_send_queues q ON q.id = i.queue_id
    WHERE ${where}
  `).all(...params);

  return new Set(rows.map((row) => Number(row.source_transaction_id || 0)).filter(Boolean));
}

function getSharedDebtDraftQueueRow({ requesterUserId, receiverUserId, month, year, requestKind = 'card' }) {
  return db.prepare(`
    SELECT *
    FROM shared_debt_send_queues
    WHERE requester_user_id = ?
      AND receiver_user_id = ?
      AND source_due_month = ?
      AND source_due_year = ?
      AND request_kind = ?
      AND status = 'draft'
    ORDER BY id DESC
    LIMIT 1
  `).get(requesterUserId, receiverUserId, month, year, normalizeSharedDebtRequestKind(requestKind));
}

function createSharedDebtSendQueue({ requesterUserId, receiverUserId, month, year, requestKind = 'card', receiverEmailSnapshot = null, receiverNameSnapshot = null, createdAt = null }) {
  const now = createdAt || nowIso();
  const info = db.prepare(`
    INSERT INTO shared_debt_send_queues (
      requester_user_id, receiver_user_id, source_due_month, source_due_year,
      request_kind, status, receiver_email_snapshot, receiver_name_snapshot,
      total_cents, item_count, last_item_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, 0, 0, ?, ?, ?)
  `).run(
    requesterUserId,
    receiverUserId,
    month,
    year,
    normalizeSharedDebtRequestKind(requestKind),
    receiverEmailSnapshot,
    receiverNameSnapshot,
    now,
    now,
    now
  );
  return Number(info.lastInsertRowid);
}

function refreshSharedDebtSendQueue(queueId, timestamp = null) {
  const cleanId = Number(queueId || 0);
  if (!cleanId) return null;

  const queueRow = db.prepare(`SELECT * FROM shared_debt_send_queues WHERE id = ? LIMIT 1`).get(cleanId);
  if (!queueRow) return null;

  const items = db.prepare(`
    SELECT amount_cents, updated_at, created_at
    FROM shared_debt_send_queue_items
    WHERE queue_id = ?
      AND cancelled_at IS NULL
  `).all(cleanId);

  if (!items.length && normalizeSharedDebtSendQueueStatus(queueRow.status) === 'draft') {
    db.prepare(`DELETE FROM shared_debt_send_queues WHERE id = ?`).run(cleanId);
    return null;
  }

  const totalCents = items.reduce((sum, row) => sum + Math.max(0, Number(row.amount_cents || 0)), 0);
  const latestItemAt = items
    .map((row) => row?.updated_at || row?.created_at || null)
    .filter(Boolean)
    .sort()
    .pop() || null;
  const updatedAt = [timestamp || null, latestItemAt, queueRow.updated_at].filter(Boolean).sort().pop() || nowIso();

  db.prepare(`
    UPDATE shared_debt_send_queues
    SET total_cents = ?,
        item_count = ?,
        last_item_at = ?,
        updated_at = ?
    WHERE id = ?
  `).run(totalCents, items.length, latestItemAt, updatedAt, cleanId);

  return db.prepare(`SELECT * FROM shared_debt_send_queues WHERE id = ? LIMIT 1`).get(cleanId);
}

function clearDraftSharedDebtSendQueueItemsForTransactions(userId, txnIds = []) {
  const cleanIds = Array.from(new Set((txnIds || []).map(Number).filter(Boolean)));
  if (!cleanIds.length) return { removedCount: 0, queueIds: [] };

  const rows = db.prepare(`
    SELECT i.id, i.queue_id
    FROM shared_debt_send_queue_items i
    JOIN shared_debt_send_queues q ON q.id = i.queue_id
    WHERE q.requester_user_id = ?
      AND q.request_kind = 'card'
      AND q.status = 'draft'
      AND i.cancelled_at IS NULL
      AND i.source_transaction_id IN (${cleanIds.map(() => '?').join(', ')})
  `).all(userId, ...cleanIds);

  if (!rows.length) return { removedCount: 0, queueIds: [] };

  const queueIds = Array.from(new Set(rows.map((row) => Number(row.queue_id || 0)).filter(Boolean)));
  const removeItem = db.prepare(`DELETE FROM shared_debt_send_queue_items WHERE id = ?`);

  db.transaction(() => {
    rows.forEach((row) => removeItem.run(row.id));
    queueIds.forEach((queueId) => refreshSharedDebtSendQueue(queueId));
  })();

  return { removedCount: rows.length, queueIds };
}

function getSharedDebtDraftHistoryBlockersForTransactions(userId, txnIds = []) {
  const cleanIds = Array.from(new Set((txnIds || []).map(Number).filter(Boolean)));
  if (!cleanIds.length) return [];

  return db.prepare(`
    SELECT source_transaction_id, MAX(description_snapshot) AS description_snapshot, COUNT(*) AS request_count
    FROM shared_debt_requests
    WHERE requester_user_id = ?
      AND request_kind = 'card'
      AND status <> 'cancelled'
      AND source_transaction_id IN (${cleanIds.map(() => '?').join(', ')})
    GROUP BY source_transaction_id
    ORDER BY source_transaction_id ASC
  `).all(userId, ...cleanIds);
}

function buildSharedDebtDraftHistoryBlockerMessage(rows = []) {
  const items = Array.isArray(rows) ? rows.filter(Boolean) : [];
  if (!items.length) return null;
  if (items.length === 1) {
    const label = String(items[0].description_snapshot || 'essa compra').trim() || 'essa compra';
    return `${label} já chegou a nascer como cobrança compartilhada antes. A boa notícia é que a caixa de saída continua cuidando disso sem mandar nada automaticamente.`;
  }
  return `Parte dessa seleção já virou cobrança em algum momento. A caixa de saída continua segurando essas mudanças por aqui até você revisar e enviar.`;
}

function getSharedDebtCardTransactionSnapshot(userId, txnId) {
  return db.prepare(`
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
}

function buildSharedDebtDraftQueueActionsForTransaction(userId, txnId) {
  const cleanTxnId = Number(txnId || 0);
  if (!cleanTxnId) return [];

  const txn = getSharedDebtCardTransactionSnapshot(userId, cleanTxnId);
  if (!txn) return [];

  const eligibleRows = getSharedDebtEligibleAllocationRows(userId, cleanTxnId);
  const existingRequests = db.prepare(`
    SELECT *
    FROM shared_debt_requests
    WHERE requester_user_id = ?
      AND request_kind = 'card'
      AND source_transaction_id = ?
    ORDER BY id DESC
  `).all(userId, cleanTxnId);

  const pendingByPerson = new Map();
  const latestByPerson = new Map();
  existingRequests.forEach((row) => {
    const personId = Number(row.source_person_id || 0);
    if (!personId) return;
    if (!latestByPerson.has(personId)) latestByPerson.set(personId, row);
    if (String(row.status || '').trim().toLowerCase() === 'pending' && !pendingByPerson.has(personId)) {
      pendingByPerson.set(personId, row);
    }
  });

  const handledPendingRequestIds = new Set();
  const actions = [];

  const pushAction = (payload) => {
    const receiverUserId = Number(payload?.receiverUserId || 0);
    const sourceTransactionId = Number(payload?.sourceTransactionId || 0);
    const sourcePersonId = Number(payload?.sourcePersonId || 0);
    const sourceDueMonth = Number(payload?.sourceDueMonth || 0);
    const sourceDueYear = Number(payload?.sourceDueYear || 0);
    if (!receiverUserId || !sourceTransactionId || !sourcePersonId || !sourceDueMonth || !sourceDueYear) return;

    actions.push({
      requesterUserId: userId,
      receiverUserId,
      sourceTransactionId,
      sourceAllocationId: Number(payload?.sourceAllocationId || 0) || null,
      sourcePersonId,
      sourceDueMonth,
      sourceDueYear,
      sourceTxnDateSnapshot: payload?.sourceTxnDateSnapshot || null,
      cardId: Number(payload?.cardId || 0) || null,
      cardNameSnapshot: payload?.cardNameSnapshot || null,
      descriptionSnapshot: payload?.descriptionSnapshot || txn.description,
      amountCents: Number(payload?.amountCents || 0),
      receiverEmailSnapshot: normalizeEmail(payload?.receiverEmailSnapshot),
      receiverNameSnapshot: payload?.receiverNameSnapshot || null,
      actionKind: normalizeSharedDebtQueueActionKind(payload?.actionKind),
      targetRequestId: Number(payload?.targetRequestId || 0) || null,
      baselineStatusSnapshot: payload?.baselineStatusSnapshot || null
    });
  };

  const enqueueCancelAction = (requestRow) => {
    const requestId = Number(requestRow?.id || 0);
    if (!requestId || handledPendingRequestIds.has(requestId)) return;
    handledPendingRequestIds.add(requestId);

    pushAction({
      receiverUserId: Number(requestRow.receiver_user_id || 0),
      sourceTransactionId: cleanTxnId,
      sourceAllocationId: Number(requestRow.source_allocation_id || 0) || null,
      sourcePersonId: Number(requestRow.source_person_id || 0),
      sourceDueMonth: Number(requestRow.source_due_month || txn.due_month || 0),
      sourceDueYear: Number(requestRow.source_due_year || txn.due_year || 0),
      sourceTxnDateSnapshot: requestRow.source_txn_date_snapshot || txn.txn_date || null,
      cardId: Number(requestRow.card_id || 0) || null,
      cardNameSnapshot: requestRow.card_name_snapshot || txn.card_name || null,
      descriptionSnapshot: requestRow.description_snapshot || txn.description,
      amountCents: Number(requestRow.amount_cents || 0),
      receiverEmailSnapshot: requestRow.receiver_email_snapshot || null,
      receiverNameSnapshot: requestRow.receiver_name_snapshot || null,
      actionKind: 'cancel',
      targetRequestId: requestId,
      baselineStatusSnapshot: requestRow.status || 'pending'
    });
  };

  eligibleRows.forEach((row) => {
    const personId = Number(row.person_id || 0);
    const receiverUserId = Number(row.receiver_user_id || 0);
    if (!personId || !receiverUserId) return;

    const receiverEmailSnapshot = normalizeEmail(row.person_email || row.receiver_user_email);
    const receiverNameSnapshot = row.person_name || row.receiver_user_name || null;
    const existingPending = pendingByPerson.get(personId);
    const latestRequest = latestByPerson.get(personId);

    if (existingPending && Number(existingPending.receiver_user_id || 0) === receiverUserId) {
      handledPendingRequestIds.add(Number(existingPending.id || 0));

      const changed = [
        Number(existingPending.source_allocation_id || 0) !== Number(row.allocation_id || 0),
        Number(existingPending.amount_cents || 0) !== Number(row.share_cents || 0),
        Number(existingPending.card_id || 0) !== Number(txn.card_id || 0),
        String(existingPending.card_name_snapshot || '') !== String(txn.card_name || ''),
        String(existingPending.description_snapshot || '') !== String(txn.description || ''),
        Number(existingPending.source_due_month || 0) !== Number(txn.due_month || 0),
        Number(existingPending.source_due_year || 0) !== Number(txn.due_year || 0),
        String(existingPending.source_txn_date_snapshot || '') !== String(txn.txn_date || ''),
        String(existingPending.receiver_email_snapshot || '') !== String(receiverEmailSnapshot || ''),
        String(existingPending.receiver_name_snapshot || '') !== String(receiverNameSnapshot || '')
      ].some(Boolean);

      if (!changed) return;

      pushAction({
        receiverUserId,
        sourceTransactionId: cleanTxnId,
        sourceAllocationId: Number(row.allocation_id || 0) || null,
        sourcePersonId: personId,
        sourceDueMonth: Number(txn.due_month || 0),
        sourceDueYear: Number(txn.due_year || 0),
        sourceTxnDateSnapshot: txn.txn_date || null,
        cardId: Number(txn.card_id || 0) || null,
        cardNameSnapshot: txn.card_name || null,
        descriptionSnapshot: txn.description,
        amountCents: Number(row.share_cents || 0),
        receiverEmailSnapshot,
        receiverNameSnapshot,
        actionKind: 'update',
        targetRequestId: Number(existingPending.id || 0),
        baselineStatusSnapshot: existingPending.status || 'pending'
      });
      return;
    }

    if (existingPending) {
      enqueueCancelAction(existingPending);
    }

    const canCreate = !latestRequest || canRecreateSharedDebtDraftFromHistory(latestRequest) || Number(latestRequest?.id || 0) === Number(existingPending?.id || 0);
    if (!canCreate) return;

    pushAction({
      receiverUserId,
      sourceTransactionId: cleanTxnId,
      sourceAllocationId: Number(row.allocation_id || 0) || null,
      sourcePersonId: personId,
      sourceDueMonth: Number(txn.due_month || 0),
      sourceDueYear: Number(txn.due_year || 0),
      sourceTxnDateSnapshot: txn.txn_date || null,
      cardId: Number(txn.card_id || 0) || null,
      cardNameSnapshot: txn.card_name || null,
      descriptionSnapshot: txn.description,
      amountCents: Number(row.share_cents || 0),
      receiverEmailSnapshot,
      receiverNameSnapshot,
      actionKind: 'create'
    });
  });

  pendingByPerson.forEach((requestRow) => {
    enqueueCancelAction(requestRow);
  });

  return actions;
}

function queueSharedDebtDraftsForTransactions(userId, targetRows = []) {
  const rows = dedupeTxnRows(targetRows);
  const txnIds = rows.map((row) => Number(row.id || 0)).filter(Boolean);
  if (!txnIds.length) {
    return { queueCount: 0, itemCount: 0, totalCents: 0, shareableCount: 0, createCount: 0, updateCount: 0, cancelCount: 0 };
  }

  clearDraftSharedDebtSendQueueItemsForTransactions(userId, txnIds);

  const actions = [];
  rows.forEach((row) => {
    buildSharedDebtDraftQueueActionsForTransaction(userId, row.id).forEach((action) => actions.push(action));
  });

  if (!actions.length) {
    return { queueCount: 0, itemCount: 0, totalCents: 0, shareableCount: 0, createCount: 0, updateCount: 0, cancelCount: 0 };
  }

  const queueGroups = new Map();
  actions.forEach((action) => {
    const key = `${action.receiverUserId}:${action.sourceDueYear}:${action.sourceDueMonth}`;
    if (!queueGroups.has(key)) {
      queueGroups.set(key, {
        receiverUserId: action.receiverUserId,
        month: action.sourceDueMonth,
        year: action.sourceDueYear,
        receiverEmailSnapshot: action.receiverEmailSnapshot,
        receiverNameSnapshot: action.receiverNameSnapshot,
        items: []
      });
    }

    const group = queueGroups.get(key);
    if (!group.receiverEmailSnapshot && action.receiverEmailSnapshot) group.receiverEmailSnapshot = action.receiverEmailSnapshot;
    if (!group.receiverNameSnapshot && action.receiverNameSnapshot) group.receiverNameSnapshot = action.receiverNameSnapshot;
    group.items.push(action);
  });

  const upsertItem = db.prepare(`
    INSERT INTO shared_debt_send_queue_items (
      queue_id, requester_user_id, receiver_user_id, source_transaction_id,
      source_allocation_id, source_person_id, source_due_month, source_due_year,
      source_txn_date_snapshot, card_id, card_name_snapshot, description_snapshot,
      amount_cents, receiver_email_snapshot, receiver_name_snapshot, action_kind,
      target_request_id, baseline_status_snapshot, sent_request_id, cancelled_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
    ON CONFLICT(queue_id, source_transaction_id, source_person_id) DO UPDATE SET
      requester_user_id = excluded.requester_user_id,
      receiver_user_id = excluded.receiver_user_id,
      source_allocation_id = excluded.source_allocation_id,
      source_due_month = excluded.source_due_month,
      source_due_year = excluded.source_due_year,
      source_txn_date_snapshot = excluded.source_txn_date_snapshot,
      card_id = excluded.card_id,
      card_name_snapshot = excluded.card_name_snapshot,
      description_snapshot = excluded.description_snapshot,
      amount_cents = excluded.amount_cents,
      receiver_email_snapshot = excluded.receiver_email_snapshot,
      receiver_name_snapshot = excluded.receiver_name_snapshot,
      action_kind = excluded.action_kind,
      target_request_id = excluded.target_request_id,
      baseline_status_snapshot = excluded.baseline_status_snapshot,
      sent_request_id = NULL,
      cancelled_at = NULL,
      updated_at = excluded.updated_at
  `);

  const touchedQueueIds = new Set();
  db.transaction(() => {
    queueGroups.forEach((group) => {
      const existingQueue = getSharedDebtDraftQueueRow({
        requesterUserId: userId,
        receiverUserId: group.receiverUserId,
        month: group.month,
        year: group.year,
        requestKind: 'card'
      });

      const queueId = Number(existingQueue?.id || 0) || createSharedDebtSendQueue({
        requesterUserId: userId,
        receiverUserId: group.receiverUserId,
        month: group.month,
        year: group.year,
        requestKind: 'card',
        receiverEmailSnapshot: group.receiverEmailSnapshot,
        receiverNameSnapshot: group.receiverNameSnapshot
      });

      touchedQueueIds.add(queueId);
      group.items.forEach((item) => {
        const now = nowIso();
        upsertItem.run(
          queueId,
          item.requesterUserId,
          item.receiverUserId,
          item.sourceTransactionId,
          item.sourceAllocationId,
          item.sourcePersonId,
          item.sourceDueMonth,
          item.sourceDueYear,
          item.sourceTxnDateSnapshot,
          item.cardId,
          item.cardNameSnapshot,
          item.descriptionSnapshot,
          item.amountCents,
          item.receiverEmailSnapshot,
          item.receiverNameSnapshot,
          item.actionKind,
          item.targetRequestId,
          item.baselineStatusSnapshot,
          now,
          now
        );
      });
      refreshSharedDebtSendQueue(queueId);
    });
  })();

  const summary = actions.reduce((acc, action) => {
    acc.itemCount += 1;
    acc.totalCents += Math.max(0, Number(action.amountCents || 0));
    if (action.actionKind === 'update') acc.updateCount += 1;
    else if (action.actionKind === 'cancel') acc.cancelCount += 1;
    else acc.createCount += 1;
    return acc;
  }, {
    queueCount: touchedQueueIds.size,
    itemCount: 0,
    totalCents: 0,
    shareableCount: touchedQueueIds.size,
    createCount: 0,
    updateCount: 0,
    cancelCount: 0
  });

  return summary;
}



function buildSharedDebtSilentMetadataSnapshot(userId, txn, allocationRow) {
  const sourceTransactionId = Number(txn?.id || 0);
  const sourcePersonId = Number(allocationRow?.person_id || 0);
  const receiverUserId = Number(allocationRow?.receiver_user_id || 0);
  const sourceDueMonth = Number(txn?.due_month || 0);
  const sourceDueYear = Number(txn?.due_year || 0);
  if (!sourceTransactionId || !sourcePersonId || !receiverUserId || !sourceDueMonth || !sourceDueYear) return null;

  return {
    requesterUserId: Number(userId || 0),
    receiverUserId,
    sourceTransactionId,
    sourceAllocationId: Number(allocationRow?.allocation_id || 0) || null,
    sourcePersonId,
    sourceDueMonth,
    sourceDueYear,
    sourceTxnDateSnapshot: txn?.txn_date || null,
    cardId: Number(txn?.card_id || 0) || null,
    cardNameSnapshot: txn?.card_name || null,
    descriptionSnapshot: txn?.description || '(sem descrição)',
    amountCents: Number(allocationRow?.share_cents || 0),
    receiverEmailSnapshot: normalizeEmail(allocationRow?.person_email || allocationRow?.receiver_user_email),
    receiverNameSnapshot: allocationRow?.person_name || allocationRow?.receiver_user_name || null
  };
}

function sharedDebtSilentMetadataDiffers(currentRow, nextSnapshot) {
  if (!currentRow || !nextSnapshot) return false;
  return [
    Number(currentRow.source_allocation_id || 0) !== Number(nextSnapshot.sourceAllocationId || 0),
    String(currentRow.source_txn_date_snapshot || '') !== String(nextSnapshot.sourceTxnDateSnapshot || ''),
    Number(currentRow.card_id || 0) !== Number(nextSnapshot.cardId || 0),
    String(currentRow.card_name_snapshot || '') !== String(nextSnapshot.cardNameSnapshot || ''),
    String(currentRow.description_snapshot || '') !== String(nextSnapshot.descriptionSnapshot || ''),
    String(currentRow.receiver_email_snapshot || '') !== String(nextSnapshot.receiverEmailSnapshot || ''),
    String(currentRow.receiver_name_snapshot || '') !== String(nextSnapshot.receiverNameSnapshot || '')
  ].some(Boolean);
}

function sharedDebtSilentFinancialIdentityMatches(row, nextSnapshot) {
  if (!row || !nextSnapshot) return false;
  return Number(row.receiver_user_id || 0) === Number(nextSnapshot.receiverUserId || 0)
    && Number(row.source_transaction_id || 0) === Number(nextSnapshot.sourceTransactionId || 0)
    && Number(row.source_person_id || 0) === Number(nextSnapshot.sourcePersonId || 0)
    && Number(row.source_due_month || 0) === Number(nextSnapshot.sourceDueMonth || 0)
    && Number(row.source_due_year || 0) === Number(nextSnapshot.sourceDueYear || 0)
    && Number(row.amount_cents || 0) === Number(nextSnapshot.amountCents || 0);
}

function hasProtectedSharedDebtActivityForSilentMetadataSync(requestRow) {
  const status = String(requestRow?.status || '').trim().toLowerCase();
  if (status !== 'accepted') return false;
  if (Number(requestRow?.amount_paid_cents || 0) > 0) return true;
  if (requestRow?.payment_marked_at || requestRow?.resolved_at) return true;

  const month = Number(requestRow?.source_due_month || 0);
  const year = Number(requestRow?.source_due_year || 0);
  const requesterUserId = Number(requestRow?.requester_user_id || 0);
  const receiverUserId = Number(requestRow?.receiver_user_id || 0);
  if (!requesterUserId || !receiverUserId || !month || !year) return true;

  const snapshot = getSharedDebtCardMonthlySettlementSnapshot({ requesterUserId, receiverUserId, month, year });
  return !!snapshot?.hasProtectedActivity;
}

function loadSilentSharedDebtSyncDraftItems(userId, txnId) {
  return db.prepare(`
    SELECT i.*, q.receiver_email_snapshot AS queue_receiver_email_snapshot, q.receiver_name_snapshot AS queue_receiver_name_snapshot
    FROM shared_debt_send_queue_items i
    JOIN shared_debt_send_queues q ON q.id = i.queue_id
    WHERE q.requester_user_id = ?
      AND q.request_kind = 'card'
      AND q.status = 'draft'
      AND i.cancelled_at IS NULL
      AND i.source_transaction_id = ?
    ORDER BY i.id ASC
  `).all(userId, txnId);
}

function loadSilentSharedDebtSyncActiveRequests(userId, txnId) {
  return db.prepare(`
    SELECT *
    FROM shared_debt_requests
    WHERE requester_user_id = ?
      AND COALESCE(request_kind, 'card') = 'card'
      AND source_transaction_id = ?
      AND status IN ('pending', 'accepted')
    ORDER BY id ASC
  `).all(userId, txnId);
}

function evaluateImportOverwriteSilentSharedDebtSyncForTransaction(userId, txnId) {
  const cleanTxnId = Number(txnId || 0);
  if (!cleanTxnId) return { safe: true, reason: 'empty' };

  const txn = getSharedDebtCardTransactionSnapshot(userId, cleanTxnId);
  if (!txn) return { safe: true, reason: 'missing_transaction' };

  const eligibleRows = getSharedDebtEligibleAllocationRows(userId, cleanTxnId);
  const nextByPersonId = new Map();
  eligibleRows.forEach((row) => {
    const personId = Number(row?.person_id || 0);
    const nextSnapshot = buildSharedDebtSilentMetadataSnapshot(userId, txn, row);
    if (personId && nextSnapshot) nextByPersonId.set(personId, nextSnapshot);
  });

  const activeRequests = loadSilentSharedDebtSyncActiveRequests(userId, cleanTxnId);
  const draftItems = loadSilentSharedDebtSyncDraftItems(userId, cleanTxnId);
  const activeByPersonId = new Map();
  activeRequests.forEach((requestRow) => {
    const personId = Number(requestRow?.source_person_id || 0);
    if (!personId) return;
    if (!activeByPersonId.has(personId)) activeByPersonId.set(personId, []);
    activeByPersonId.get(personId).push(requestRow);
  });

  const effectPersonIds = new Set();
  activeRequests.forEach((requestRow) => {
    const personId = Number(requestRow?.source_person_id || 0);
    if (personId) effectPersonIds.add(personId);
  });
  draftItems.forEach((item) => {
    const personId = Number(item?.source_person_id || 0);
    if (personId) effectPersonIds.add(personId);
  });

  if (!effectPersonIds.size) {
    return nextByPersonId.size
      ? { safe: false, reason: 'new_shareable_participant' }
      : { safe: true, txn, nextByPersonId, activeRequests, draftItems };
  }

  if (effectPersonIds.size !== nextByPersonId.size) {
    return { safe: false, reason: 'participant_count_changed' };
  }

  for (const personId of effectPersonIds) {
    if (!nextByPersonId.has(personId)) {
      return { safe: false, reason: 'participant_changed' };
    }
  }

  for (const requestRow of activeRequests) {
    const status = String(requestRow?.status || '').trim().toLowerCase();
    const nextSnapshot = nextByPersonId.get(Number(requestRow?.source_person_id || 0));
    if (!['pending', 'accepted'].includes(status)) {
      return { safe: false, reason: 'unsupported_status' };
    }
    if (!sharedDebtSilentFinancialIdentityMatches(requestRow, nextSnapshot)) {
      return { safe: false, reason: 'request_financial_identity_changed' };
    }
    if (status === 'accepted' && hasProtectedSharedDebtActivityForSilentMetadataSync(requestRow)) {
      return { safe: false, reason: 'accepted_request_protected' };
    }
  }

  for (const item of draftItems) {
    const actionKind = normalizeSharedDebtQueueActionKind(item?.action_kind);
    const personId = Number(item?.source_person_id || 0);
    const nextSnapshot = nextByPersonId.get(personId);
    if (!nextSnapshot) return { safe: false, reason: 'draft_participant_changed' };
    if (!['create', 'update'].includes(actionKind)) return { safe: false, reason: 'draft_cancel_or_unknown' };
    if (!sharedDebtSilentFinancialIdentityMatches(item, nextSnapshot)) {
      return { safe: false, reason: 'draft_financial_identity_changed' };
    }
    const activeRowsForPerson = activeByPersonId.get(personId) || [];
    if (actionKind === 'create' && activeRowsForPerson.length) {
      return { safe: false, reason: 'draft_create_over_active_request' };
    }
    if (actionKind === 'update') {
      const targetRequestId = Number(item?.target_request_id || item?.sent_request_id || 0);
      if (!targetRequestId || !activeRowsForPerson.some((row) => Number(row.id || 0) === targetRequestId)) {
        return { safe: false, reason: 'draft_update_target_changed' };
      }
    }
  }

  return {
    safe: true,
    txn,
    nextByPersonId,
    activeRequests,
    draftItems
  };
}

function applySilentSharedDebtMetadataSyncForTransaction(userId, evaluation) {
  if (!evaluation || !evaluation.safe) {
    return { updatedRequestCount: 0, updatedDraftItemCount: 0, removedDraftItemCount: 0 };
  }

  const now = nowIso();
  const updateRequest = db.prepare(`
    UPDATE shared_debt_requests
    SET source_allocation_id = ?,
        source_txn_date_snapshot = ?,
        card_id = ?,
        card_name_snapshot = ?,
        description_snapshot = ?,
        receiver_email_snapshot = ?,
        receiver_name_snapshot = ?,
        updated_at = ?
    WHERE id = ?
      AND requester_user_id = ?
      AND status IN ('pending', 'accepted')
  `);
  const updateDraftItem = db.prepare(`
    UPDATE shared_debt_send_queue_items
    SET source_allocation_id = ?,
        source_txn_date_snapshot = ?,
        card_id = ?,
        card_name_snapshot = ?,
        description_snapshot = ?,
        receiver_email_snapshot = ?,
        receiver_name_snapshot = ?,
        updated_at = ?
    WHERE id = ?
      AND requester_user_id = ?
      AND cancelled_at IS NULL
  `);
  const removeDraftItem = db.prepare(`DELETE FROM shared_debt_send_queue_items WHERE id = ? AND requester_user_id = ?`);
  const updateDraftQueueReceiver = db.prepare(`
    UPDATE shared_debt_send_queues
    SET receiver_email_snapshot = COALESCE(?, receiver_email_snapshot),
        receiver_name_snapshot = COALESCE(?, receiver_name_snapshot),
        updated_at = ?
    WHERE id = ?
      AND requester_user_id = ?
      AND status = 'draft'
  `);

  let updatedRequestCount = 0;
  let updatedDraftItemCount = 0;
  let removedDraftItemCount = 0;
  const queueIdsToRefresh = new Set();
  const batchIdsToRefresh = new Set();
  const eventNote = 'Sincronização automática após conciliação da fatura; valor e divisão permaneceram iguais.';

  db.transaction(() => {
    (evaluation.activeRequests || []).forEach((requestRow) => {
      const nextSnapshot = evaluation.nextByPersonId.get(Number(requestRow?.source_person_id || 0));
      if (!nextSnapshot || !sharedDebtSilentMetadataDiffers(requestRow, nextSnapshot)) return;
      const info = updateRequest.run(
        nextSnapshot.sourceAllocationId,
        nextSnapshot.sourceTxnDateSnapshot,
        nextSnapshot.cardId,
        nextSnapshot.cardNameSnapshot,
        nextSnapshot.descriptionSnapshot,
        nextSnapshot.receiverEmailSnapshot,
        nextSnapshot.receiverNameSnapshot,
        now,
        requestRow.id,
        userId
      );
      if (Number(info.changes || 0) > 0) {
        updatedRequestCount += 1;
        addSharedDebtEvent({ requestId: requestRow.id, actorUserId: userId, eventType: 'updated', note: eventNote });
        if (requestRow.batch_id) batchIdsToRefresh.add(Number(requestRow.batch_id || 0));
      }
    });

    (evaluation.draftItems || []).forEach((item) => {
      const nextSnapshot = evaluation.nextByPersonId.get(Number(item?.source_person_id || 0));
      if (!nextSnapshot) return;
      const actionKind = normalizeSharedDebtQueueActionKind(item?.action_kind);
      const queueId = Number(item?.queue_id || 0);
      if (queueId) queueIdsToRefresh.add(queueId);

      if (actionKind === 'update') {
        const info = removeDraftItem.run(item.id, userId);
        if (Number(info.changes || 0) > 0) removedDraftItemCount += 1;
        return;
      }

      if (!sharedDebtSilentMetadataDiffers(item, nextSnapshot)) return;
      const info = updateDraftItem.run(
        nextSnapshot.sourceAllocationId,
        nextSnapshot.sourceTxnDateSnapshot,
        nextSnapshot.cardId,
        nextSnapshot.cardNameSnapshot,
        nextSnapshot.descriptionSnapshot,
        nextSnapshot.receiverEmailSnapshot,
        nextSnapshot.receiverNameSnapshot,
        now,
        item.id,
        userId
      );
      if (Number(info.changes || 0) > 0) {
        updatedDraftItemCount += 1;
        if (queueId) {
          updateDraftQueueReceiver.run(nextSnapshot.receiverEmailSnapshot, nextSnapshot.receiverNameSnapshot, now, queueId, userId);
        }
      }
    });
  })();

  queueIdsToRefresh.forEach((queueId) => refreshSharedDebtSendQueue(queueId, now));
  batchIdsToRefresh.forEach((batchId) => refreshSharedDebtBatch(batchId, now));

  return { updatedRequestCount, updatedDraftItemCount, removedDraftItemCount };
}

function applyImportOverwriteSharedDebtPolicy(userId, targetRows = [], overwriteChanges = []) {
  const rows = dedupeTxnRows(targetRows);
  const changeByTxnId = new Map((Array.isArray(overwriteChanges) ? overwriteChanges : [])
    .map((change) => [Number(change?.transactionId || 0), change])
    .filter(([txnId]) => txnId));
  const summary = {
    rowsNeedingDraft: [],
    safeRowIds: [],
    updatedRequestCount: 0,
    updatedDraftItemCount: 0,
    removedDraftItemCount: 0,
    skippedCount: 0,
    details: []
  };

  rows.forEach((row) => {
    const txnId = Number(row?.id || 0);
    if (!txnId) return;
    const evaluation = evaluateImportOverwriteSilentSharedDebtSyncForTransaction(userId, txnId);
    if (!evaluation.safe) {
      summary.rowsNeedingDraft.push(row);
      summary.details.push({ transactionId: txnId, action: 'queue', reason: evaluation.reason || 'unsafe' });
      return;
    }

    const applied = applySilentSharedDebtMetadataSyncForTransaction(userId, evaluation);
    const touchedCount = Number(applied.updatedRequestCount || 0)
      + Number(applied.updatedDraftItemCount || 0)
      + Number(applied.removedDraftItemCount || 0);
    if (touchedCount > 0) {
      summary.safeRowIds.push(txnId);
    } else {
      summary.skippedCount += 1;
    }
    summary.updatedRequestCount += Number(applied.updatedRequestCount || 0);
    summary.updatedDraftItemCount += Number(applied.updatedDraftItemCount || 0);
    summary.removedDraftItemCount += Number(applied.removedDraftItemCount || 0);
    summary.details.push({
      transactionId: txnId,
      action: 'silent_metadata_sync',
      hasOverwriteChange: changeByTxnId.has(txnId),
      ...applied
    });
  });

  return summary;
}

function getSharedDebtSendQueueDraftSummary(userId, options = {}) {
  const where = [`requester_user_id = ?`, `request_kind = 'card'`, `status = 'draft'`];
  const params = [userId];
  const month = Number(options?.month || 0);
  const year = Number(options?.year || 0);
  if (month && year) {
    where.push(`source_due_month = ?`, `source_due_year = ?`);
    params.push(month, year);
  }

  const row = db.prepare(`
    SELECT COUNT(*) AS queue_count,
           COALESCE(SUM(item_count), 0) AS item_count,
           COALESCE(SUM(total_cents), 0) AS total_cents
    FROM shared_debt_send_queues
    WHERE ${where.join(' AND ')}
  `).get(...params) || {};

  return {
    queueCount: Number(row.queue_count || 0),
    itemCount: Number(row.item_count || 0),
    totalCents: Number(row.total_cents || 0)
  };
}

function getSharedDebtSendQueueDraftsForUser(userId) {
  const queues = db.prepare(`
    SELECT q.*, u.name AS receiver_user_name, u.email AS receiver_user_email
    FROM shared_debt_send_queues q
    LEFT JOIN users u ON u.id = q.receiver_user_id
    WHERE q.requester_user_id = ?
      AND q.request_kind = 'card'
      AND q.status = 'draft'
    ORDER BY LOWER(COALESCE(q.receiver_name_snapshot, u.name, u.email, '')) ASC, q.source_due_year ASC, q.source_due_month ASC, q.updated_at ASC, q.id ASC
  `).all(userId);

  if (!queues.length) return [];

  const queueIds = queues.map((queue) => Number(queue.id || 0)).filter(Boolean);
  const itemRows = db.prepare(`
    SELECT *
    FROM shared_debt_send_queue_items
    WHERE queue_id IN (${queueIds.map(() => '?').join(', ')})
      AND cancelled_at IS NULL
    ORDER BY COALESCE(source_txn_date_snapshot, '') ASC, id ASC
  `).all(...queueIds);

  const itemsByQueueId = new Map();
  itemRows.forEach((row) => {
    const queueId = Number(row.queue_id || 0);
    if (!queueId) return;
    if (!itemsByQueueId.has(queueId)) itemsByQueueId.set(queueId, []);
    itemsByQueueId.get(queueId).push({
      ...row,
      actionKind: normalizeSharedDebtQueueActionKind(row.action_kind),
      amountFormatted: formatBRLFromCents(Number(row.amount_cents || 0)),
      txnDateLabel: row.source_txn_date_snapshot ? formatDateBR(row.source_txn_date_snapshot) : null
    });
  });

  return queues.map((queue) => {
    const queueItems = itemsByQueueId.get(Number(queue.id || 0)) || [];
    const previewDescriptions = Array.from(new Set(queueItems.map((item) => String(item.description_snapshot || '').trim()).filter(Boolean))).slice(0, 3);
    return {
      ...queue,
      status: normalizeSharedDebtSendQueueStatus(queue.status),
      receiverDisplayName: queue.receiver_name_snapshot || queue.receiver_user_name || queue.receiver_user_email || 'essa pessoa',
      periodLabel: monthLabel(queue.source_due_month, queue.source_due_year),
      totalCents: Number(queue.total_cents || 0),
      totalFormatted: formatBRLFromCents(Number(queue.total_cents || 0)),
      itemCount: Number(queue.item_count || queueItems.length || 0),
      updatedAtLabel: queue.updated_at ? formatDateBR(queue.updated_at) : null,
      updatedAtTimeLabel: queue.updated_at ? dayjs(queue.updated_at).format('HH:mm') : null,
      previewDescriptions,
      items: queueItems
    };
  });
}

function sendSharedDebtDraftQueue(userId, queueId, options = {}) {
  const cleanQueueId = Number(queueId || 0);
  if (!cleanQueueId) {
    const error = new Error('Esse rascunho não parece válido.');
    error.code = 'INVALID_QUEUE';
    throw error;
  }

  const queueRow = db.prepare(`
    SELECT *
    FROM shared_debt_send_queues
    WHERE id = ? AND requester_user_id = ?
    LIMIT 1
  `).get(cleanQueueId, userId);

  if (!queueRow || normalizeSharedDebtSendQueueStatus(queueRow.status) !== 'draft') {
    const error = new Error('Não encontrei esse rascunho para enviar agora.');
    error.code = 'QUEUE_NOT_FOUND';
    throw error;
  }

  const queueItems = db.prepare(`
    SELECT *
    FROM shared_debt_send_queue_items
    WHERE queue_id = ?
      AND cancelled_at IS NULL
    ORDER BY COALESCE(source_txn_date_snapshot, '') ASC, id ASC
  `).all(cleanQueueId).map((item) => ({
    ...item,
    action_kind: normalizeSharedDebtQueueActionKind(item.action_kind)
  }));

  if (!queueItems.length) {
    refreshSharedDebtSendQueue(cleanQueueId);
    const error = new Error('Esse rascunho ficou vazio no caminho. Dá uma conferida na caixa de saída.');
    error.code = 'QUEUE_EMPTY';
    throw error;
  }

  const requesterPerson = getOwnerPerson(userId);
  const actor = getUserRecord(userId);
  const requesterDisplayName = requesterPerson?.name || actor?.name || actor?.email || 'Um usuário';
  const now = nowIso();
  const notificationContext = options?.notificationContext || createSharedDebtSyncContext(userId, {
    originKind: queueItems.length > 1 ? 'multiple' : 'single'
  });
  if (!notificationContext.requesterDisplayName) notificationContext.requesterDisplayName = requesterDisplayName;

  const loadTargetRequest = db.prepare(`
    SELECT *
    FROM shared_debt_requests
    WHERE id = ? AND requester_user_id = ?
    LIMIT 1
  `);
  const loadCurrentAllocation = db.prepare(`
    SELECT a.id
    FROM allocations a
    JOIN transactions t ON t.id = a.transaction_id AND t.user_id = a.user_id
    WHERE a.user_id = ?
      AND a.transaction_id = ?
      AND a.person_id = ?
    LIMIT 1
  `);
  const insertRequest = db.prepare(`
    INSERT INTO shared_debt_requests (
      requester_user_id, requester_person_id, receiver_user_id, source_person_id,
      source_transaction_id, source_allocation_id, source_due_month, source_due_year, source_txn_date_snapshot,
      card_id, card_name_snapshot, description_snapshot, amount_cents,
      receiver_email_snapshot, receiver_name_snapshot, request_note, response_note,
      status, batch_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'pending', ?, ?, ?)
  `);
  const updateRequest = db.prepare(`
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
    WHERE id = ? AND requester_user_id = ?
  `);
  const cancelRequest = db.prepare(`
    UPDATE shared_debt_requests
    SET status = 'cancelled', updated_at = ?, resolved_at = COALESCE(resolved_at, ?)
    WHERE id = ? AND requester_user_id = ? AND status = 'pending'
  `);
  const updateQueue = db.prepare(`
    UPDATE shared_debt_send_queues
    SET status = 'sent',
        sent_at = ?,
        batch_id = ?,
        updated_at = ?
    WHERE id = ?
  `);
  const updateQueueItem = db.prepare(`
    UPDATE shared_debt_send_queue_items
    SET sent_request_id = ?, updated_at = ?
    WHERE id = ?
  `);

  const requestIds = [];
  const affectedBatchIds = new Set();
  const actionCounts = { create: 0, update: 0, cancel: 0 };

  db.transaction(() => {
    queueItems.forEach((item) => {
      const actionKind = normalizeSharedDebtQueueActionKind(item.action_kind);

      if (actionKind === 'create') {
        const batchId = Number(getOrCreateSharedDebtBatchId(notificationContext, queueRow.receiver_user_id) || createSharedDebtBatch({
          requesterUserId: userId,
          receiverUserId: queueRow.receiver_user_id,
          originKind: queueItems.length > 1 ? 'multiple' : 'single',
          createdAt: now
        }));

        const currentAllocation = loadCurrentAllocation.get(userId, item.source_transaction_id, item.source_person_id);
        const info = insertRequest.run(
          userId,
          requesterPerson?.id || null,
          queueRow.receiver_user_id,
          item.source_person_id,
          item.source_transaction_id,
          Number(currentAllocation?.id || item.source_allocation_id || 0) || null,
          item.source_due_month,
          item.source_due_year,
          item.source_txn_date_snapshot || null,
          Number(item.card_id || 0) || null,
          item.card_name_snapshot || null,
          item.description_snapshot,
          Number(item.amount_cents || 0),
          item.receiver_email_snapshot || queueRow.receiver_email_snapshot || null,
          item.receiver_name_snapshot || queueRow.receiver_name_snapshot || null,
          batchId,
          now,
          now
        );

        const requestId = Number(info.lastInsertRowid);
        requestIds.push(requestId);
        actionCounts.create += 1;
        affectedBatchIds.add(batchId);
        updateQueueItem.run(requestId, now, item.id);
        addSharedDebtEvent({ requestId, actorUserId: userId, eventType: 'created' });
        recordSharedDebtBatchChange(notificationContext, {
          batchId,
          receiverUserId: queueRow.receiver_user_id,
          receiverName: item.receiver_name_snapshot || queueRow.receiver_name_snapshot || null,
          requestId,
          kind: 'created',
          amountCents: Number(item.amount_cents || 0),
          description: item.description_snapshot,
          sourceDueMonth: item.source_due_month,
          sourceDueYear: item.source_due_year
        });
        return;
      }

      const targetRequestId = Number(item.target_request_id || item.sent_request_id || 0);
      const targetRequest = loadTargetRequest.get(targetRequestId, userId);
      if (!targetRequest) {
        const error = new Error('Uma dessas pendências mudou antes do envio manual. Revise a caixa de saída e tenta de novo.');
        error.code = 'QUEUE_TARGET_MISSING';
        throw error;
      }

      const currentStatus = String(targetRequest.status || '').trim().toLowerCase();
      const baselineStatus = String(item.baseline_status_snapshot || 'pending').trim().toLowerCase() || 'pending';
      if (currentStatus !== baselineStatus || currentStatus !== 'pending') {
        const error = new Error('Uma dessas pendências saiu do ponto em que o rascunho foi montado. Revise a caixa de saída antes de enviar.');
        error.code = 'QUEUE_TARGET_STALE';
        throw error;
      }

      if (actionKind === 'update') {
        const currentAllocation = loadCurrentAllocation.get(userId, item.source_transaction_id, item.source_person_id);
        const existingBatchId = Number(targetRequest.batch_id || 0);
        let nextBatchId = existingBatchId;
        if (!nextBatchId || batchHasStartedResponse(existingBatchId)) {
          nextBatchId = Number(getOrCreateSharedDebtBatchId(notificationContext, Number(targetRequest.receiver_user_id || item.receiver_user_id || queueRow.receiver_user_id)) || createSharedDebtBatch({
            requesterUserId: userId,
            receiverUserId: Number(targetRequest.receiver_user_id || item.receiver_user_id || queueRow.receiver_user_id),
            originKind: queueItems.length > 1 ? 'multiple' : 'single',
            createdAt: now
          }));
        }

        updateRequest.run(
          requesterPerson?.id || null,
          Number(targetRequest.receiver_user_id || item.receiver_user_id || queueRow.receiver_user_id),
          item.source_person_id,
          Number(currentAllocation?.id || item.source_allocation_id || 0) || null,
          item.source_due_month,
          item.source_due_year,
          item.source_txn_date_snapshot || null,
          Number(item.card_id || 0) || null,
          item.card_name_snapshot || null,
          item.description_snapshot,
          Number(item.amount_cents || 0),
          item.receiver_email_snapshot || targetRequest.receiver_email_snapshot || null,
          item.receiver_name_snapshot || targetRequest.receiver_name_snapshot || null,
          nextBatchId || null,
          now,
          targetRequestId,
          userId
        );

        requestIds.push(targetRequestId);
        actionCounts.update += 1;
        updateQueueItem.run(targetRequestId, now, item.id);
        addSharedDebtEvent({
          requestId: targetRequestId,
          actorUserId: userId,
          eventType: 'updated',
          note: nextBatchId !== existingBatchId
            ? 'Solicitação atualizada pela caixa de saída em um novo envio.'
            : 'Solicitação atualizada pela caixa de saída.'
        });

        if (existingBatchId) affectedBatchIds.add(existingBatchId);
        if (nextBatchId) affectedBatchIds.add(nextBatchId);
        recordSharedDebtBatchChange(notificationContext, {
          batchId: nextBatchId || existingBatchId,
          receiverUserId: Number(targetRequest.receiver_user_id || item.receiver_user_id || queueRow.receiver_user_id),
          receiverName: item.receiver_name_snapshot || targetRequest.receiver_name_snapshot || queueRow.receiver_name_snapshot || null,
          requestId: targetRequestId,
          kind: 'updated',
          amountCents: Number(item.amount_cents || 0),
          description: item.description_snapshot,
          sourceDueMonth: item.source_due_month,
          sourceDueYear: item.source_due_year
        });
        return;
      }

      const cancelInfo = cancelRequest.run(now, now, targetRequestId, userId);
      if (!Number(cancelInfo.changes || 0)) {
        const error = new Error('Uma dessas pendências saiu do ponto em que o rascunho foi montado. Revise a caixa de saída antes de enviar.');
        error.code = 'QUEUE_TARGET_CANCEL_STALE';
        throw error;
      }

      requestIds.push(targetRequestId);
      actionCounts.cancel += 1;
      updateQueueItem.run(targetRequestId, now, item.id);
      addSharedDebtEvent({
        requestId: targetRequestId,
        actorUserId: userId,
        eventType: 'cancelled',
        note: 'Solicitação cancelada a partir da caixa de saída.'
      });

      const batchId = Number(targetRequest.batch_id || 0);
      if (batchId) affectedBatchIds.add(batchId);
      recordSharedDebtBatchChange(notificationContext, {
        batchId,
        receiverUserId: Number(targetRequest.receiver_user_id || queueRow.receiver_user_id),
        receiverName: targetRequest.receiver_name_snapshot || queueRow.receiver_name_snapshot || null,
        requestId: targetRequestId,
        kind: 'cancelled',
        amountCents: Number(targetRequest.amount_cents || item.amount_cents || 0),
        description: targetRequest.description_snapshot || item.description_snapshot,
        sourceDueMonth: targetRequest.source_due_month || item.source_due_month,
        sourceDueYear: targetRequest.source_due_year || item.source_due_year
      });
    });

    const primaryBatchId = Array.from(affectedBatchIds).find(Boolean) || null;
    updateQueue.run(now, primaryBatchId, now, cleanQueueId);
  })();

  affectedBatchIds.forEach((batchId) => {
    if (batchId) refreshSharedDebtBatch(batchId, now);
  });
  if (!options?.suppressNotifications) {
    flushSharedDebtBatchNotifications(notificationContext);
  }

  return {
    queueRow,
    batchIds: Array.from(affectedBatchIds).filter(Boolean),
    requestIds,
    itemCount: queueItems.length,
    totalCents: Number(queueRow.total_cents || 0),
    actionCounts,
    notificationContext
  };
}


function sendSharedDebtDraftQueuesBulk(userId, queueIds = []) {
  const ids = Array.from(new Set((Array.isArray(queueIds) ? queueIds : [])
    .map((value) => Number(value || 0))
    .filter(Boolean)));
  const result = {
    sentQueueCount: 0,
    sentItemCount: 0,
    totalCents: 0,
    batchIds: [],
    requestIds: [],
    notificationCount: 0,
    errorCount: 0
  };
  if (!ids.length) return result;

  const requesterPerson = getOwnerPerson(userId);
  const actor = getUserRecord(userId);
  const requesterDisplayName = requesterPerson?.name || actor?.name || actor?.email || 'Um usuário';
  const notificationContext = createSharedDebtSyncContext(userId, { originKind: 'multiple' });
  notificationContext.requesterDisplayName = requesterDisplayName;

  ids.forEach((queueId) => {
    try {
      const queueResult = sendSharedDebtDraftQueue(userId, queueId, {
        suppressNotifications: true
      });
      if (queueResult?.notificationContext?.changesByBatch) {
        queueResult.notificationContext.changesByBatch.forEach((entry, batchId) => {
          notificationContext.changesByBatch.set(batchId, entry);
        });
      }
      result.sentQueueCount += 1;
      result.sentItemCount += Number(queueResult?.itemCount || 0);
      result.totalCents += Number(queueResult?.totalCents || 0);
      (queueResult?.batchIds || []).forEach((batchId) => {
        const cleanBatchId = Number(batchId || 0);
        if (cleanBatchId && !result.batchIds.includes(cleanBatchId)) result.batchIds.push(cleanBatchId);
      });
      (queueResult?.requestIds || []).forEach((requestId) => {
        const cleanRequestId = Number(requestId || 0);
        if (cleanRequestId && !result.requestIds.includes(cleanRequestId)) result.requestIds.push(cleanRequestId);
      });
    } catch (error) {
      result.errorCount += 1;
    }
  });

  if (result.sentQueueCount > 0) {
    const notificationResult = flushSharedDebtBulkNotifications(notificationContext);
    result.notificationCount = Number(notificationResult?.notificationCount || 0);
  }

  return result;
}

function discardSharedDebtDraftQueue(userId, queueId) {
  const cleanQueueId = Number(queueId || 0);
  if (!cleanQueueId) return null;

  const queueRow = db.prepare(`
    SELECT *
    FROM shared_debt_send_queues
    WHERE id = ? AND requester_user_id = ?
    LIMIT 1
  `).get(cleanQueueId, userId);

  if (!queueRow || normalizeSharedDebtSendQueueStatus(queueRow.status) !== 'draft') return null;

  const now = nowIso();
  db.transaction(() => {
    db.prepare(`
      UPDATE shared_debt_send_queue_items
      SET cancelled_at = ?, updated_at = ?
      WHERE queue_id = ? AND cancelled_at IS NULL
    `).run(now, now, cleanQueueId);

    db.prepare(`
      UPDATE shared_debt_send_queues
      SET status = 'cancelled', updated_at = ?
      WHERE id = ?
    `).run(now, cleanQueueId);
  })();

  return { ...queueRow, status: 'cancelled' };
}

function applySharedDebtDispatchModeForTransactions(userId, targetRows, options = {}) {
  const rows = dedupeTxnRows(targetRows);
  return {
    deliveryMode: 'draft',
    summary: queueSharedDebtDraftsForTransactions(userId, rows)
  };
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

  const queuedPersonIds = getSharedDebtDraftQueuedPersonIdSetForTransaction(userId, txnId);
  const eligibleRows = getSharedDebtEligibleAllocationRows(userId, txnId)
    .filter((row) => !queuedPersonIds.has(Number(row.person_id || 0)));

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
              description: txn.description,
              sourceDueMonth: txn.due_month,
              sourceDueYear: txn.due_year
            });
          } else {
            const resolvedMessage = resolveCatalogText('notification.shared_debt.single.updated', {
              remetente: requesterDisplayName,
              valor: formatBRLFromCents(row.share_cents),
              descricao: txn.description
            }, {
              fallbackTitle: 'Uma cobrança compartilhada foi atualizada',
              fallbackBody: `${requesterDisplayName} ajustou a cobrança de ${formatBRLFromCents(row.share_cents)} (${txn.description}).`
            });
            createNotification({
              userId: row.receiver_user_id,
              type: 'shared_debt_request',
              title: resolvedMessage.title,
              body: resolvedMessage.body,
              href: `/shared-debts?request=${existing.id}`,
              relatedType: 'shared_debt_request',
              relatedId: existing.id,
              groupKey: 'shared_debt_updates'
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
              description: txn.description,
              sourceDueMonth: txn.due_month,
              sourceDueYear: txn.due_year
            });
          } else {
            const resolvedMessage = resolveCatalogText('notification.shared_debt.single.created', {
              remetente: requesterDisplayName,
              valor: formatBRLFromCents(row.share_cents),
              descricao: txn.description
            }, {
              fallbackTitle: 'Chegou uma cobrança compartilhada',
              fallbackBody: `${requesterDisplayName} te enviou uma cobrança de ${formatBRLFromCents(row.share_cents)} (${txn.description}).`
            });
            createNotification({
              userId: row.receiver_user_id,
              type: 'shared_debt_request',
              title: resolvedMessage.title,
              body: resolvedMessage.body,
              href: `/shared-debts?request=${requestId}`,
              relatedType: 'shared_debt_request',
              relatedId: requestId,
              groupKey: 'shared_debt_new'
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
      clearDraftSharedDebtSendQueueItemsForTransactions(userId, [item.id]);
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
    SELECT t.id, t.import_id, t.description, t.amount_cents, t.card_id, t.recurring_rule_id, t.parent_txn_id, t.purchase_category_id,
           COALESCE(t.due_month, i.month) AS month,
           COALESCE(t.due_year, i.year) AS year
    FROM transactions t
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    WHERE t.id = ? AND t.user_id = ?
  `).get(txnId, userId);
}


function getImportOverwriteTargetRow(userId, txnId) {
  return db.prepare(`
    SELECT t.id, t.user_id, t.import_id, t.card_id, t.txn_date, t.description, t.amount_cents, t.card_number, t.raw_json,
           t.due_month, t.due_year, t.parent_txn_id, t.recurring_rule_id, t.purchase_category_id, t.created_at,
           COALESCE(t.due_month, i.month) AS month,
           COALESCE(t.due_year, i.year) AS year,
           pc.name AS purchase_category_name
    FROM transactions t
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    LEFT JOIN purchase_categories pc ON pc.id = t.purchase_category_id AND pc.user_id = t.user_id
    WHERE t.id = ? AND t.user_id = ?
  `).get(txnId, userId);
}

function buildImportOverwriteAuditSnapshot(userId, txnRow, extra = {}) {
  if (!txnRow || !txnRow.id) return null;
  const allocations = getAllocationRowsByTransactionIds(userId, [txnRow.id]).get(Number(txnRow.id || 0)) || [];
  const sharedDebtRequestCount = Number(db.prepare(`
    SELECT COUNT(*) AS total
    FROM shared_debt_requests
    WHERE requester_user_id = ? AND source_transaction_id = ?
  `).get(userId, txnRow.id)?.total || 0);
  const sharedDebtDraftCount = Number(db.prepare(`
    SELECT COUNT(*) AS total
    FROM shared_debt_send_queue_items
    WHERE requester_user_id = ? AND source_transaction_id = ?
  `).get(userId, txnRow.id)?.total || 0);

  return {
    transaction: {
      id: Number(txnRow.id || 0),
      user_id: Number(txnRow.user_id || userId),
      import_id: Number(txnRow.import_id || 0) || null,
      card_id: Number(txnRow.card_id || 0) || null,
      txn_date: String(txnRow.txn_date || '').trim() || null,
      description: String(txnRow.description || '').trim() || null,
      amount_cents: Number(txnRow.amount_cents || 0),
      card_number: normalizeImportCardNumber(txnRow.card_number) || null,
      raw_json: txnRow.raw_json || null,
      due_month: Number(txnRow.due_month || 0) || null,
      due_year: Number(txnRow.due_year || 0) || null,
      month: Number(txnRow.month || 0) || null,
      year: Number(txnRow.year || 0) || null,
      purchase_category_id: Number(txnRow.purchase_category_id || 0) || null,
      purchase_category_name: String(txnRow.purchase_category_name || '').trim() || null,
      parent_txn_id: Number(txnRow.parent_txn_id || 0) || null,
      recurring_rule_id: Number(txnRow.recurring_rule_id || 0) || null,
      created_at: txnRow.created_at || null
    },
    allocations,
    shared_debt: {
      request_count: sharedDebtRequestCount,
      draft_count: sharedDebtDraftCount
    },
    ...extra
  };
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
    SELECT t.id, t.import_id, t.description, t.amount_cents, t.card_id, t.recurring_rule_id, t.parent_txn_id, t.purchase_category_id,
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

function getRecurringCategoryScopeRows(userId, txnRow, scope = 'single') {
  if (!txnRow) return [];

  const normalizedScope = String(scope || 'single').trim().toLowerCase();
  const recurringRuleId = Number(txnRow.recurring_rule_id || 0);
  const currentMonth = Number(txnRow.month || 0);
  const currentYear = Number(txnRow.year || 0);
  if (normalizedScope !== 'future' || !recurringRuleId || !currentMonth || !currentYear) {
    return [txnRow];
  }

  const rows = db.prepare(`
    SELECT t.id, t.import_id, t.description, t.amount_cents, t.card_id, t.recurring_rule_id, t.parent_txn_id, t.purchase_category_id,
           COALESCE(t.due_month, i.month) AS month,
           COALESCE(t.due_year, i.year) AS year
    FROM transactions t
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    WHERE t.user_id = ?
      AND t.recurring_rule_id = ?
      AND (
        COALESCE(t.due_year, i.year) > ? OR
        (COALESCE(t.due_year, i.year) = ? AND COALESCE(t.due_month, i.month) >= ?)
      )
    ORDER BY COALESCE(t.due_year, i.year) ASC, COALESCE(t.due_month, i.month) ASC, t.id ASC
  `).all(userId, recurringRuleId, currentYear, currentYear, currentMonth);

  return rows.length ? rows : [txnRow];
}

function getPurchaseCategoryScopeRows(userId, txnRow, scope = 'single') {
  if (!txnRow) return [];
  if (Number(txnRow.recurring_rule_id || 0) > 0) {
    return getRecurringCategoryScopeRows(userId, txnRow, scope);
  }
  return getInstallmentScopeRows(userId, txnRow, scope);
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

function collectScopedCategoryTxnRows(userId, sourceRows, scope = 'single') {
  const scopedRows = [];
  (sourceRows || []).forEach((row) => {
    getPurchaseCategoryScopeRows(userId, row, scope).forEach((target) => scopedRows.push(target));
  });
  return dedupeTxnRows(scopedRows);
}

function applyPurchaseCategoryToTransactions(userId, rows, purchaseCategoryId, { includeFutureRecurring = false } = {}) {
  const safeRows = dedupeTxnRows(rows);
  if (!safeRows.length) return 0;

  const updateTxn = db.prepare(`
    UPDATE transactions
    SET purchase_category_id = ?
    WHERE user_id = ? AND id = ?
  `);
  const updateRecurringRule = db.prepare(`
    UPDATE recurring_rules
    SET purchase_category_id = ?, updated_at = ?
    WHERE user_id = ? AND id = ?
  `);

  let affected = 0;
  db.transaction(() => {
    safeRows.forEach((row) => {
      affected += updateTxn.run(purchaseCategoryId, userId, row.id).changes || 0;
    });

    if (includeFutureRecurring) {
      const recurringRuleIds = Array.from(new Set(safeRows.map((row) => Number(row.recurring_rule_id || 0)).filter((value) => Number.isInteger(value) && value > 0)));
      recurringRuleIds.forEach((ruleId) => {
        updateRecurringRule.run(purchaseCategoryId, nowIso(), userId, ruleId);
      });
    }
  })();

  return affected;
}


function getInstallmentChainRows(userId, txnRow) {
  if (!txnRow) return [];
  const rootId = Number(txnRow.parent_txn_id || txnRow.parentTxnId || txnRow.id || 0);
  if (!rootId) return [];

  return db.prepare(`
    SELECT t.id, t.import_id, t.description, t.amount_cents, t.card_id, t.recurring_rule_id, t.parent_txn_id, t.purchase_category_id, t.raw_json,
           COALESCE(t.due_month, i.month) AS month,
           COALESCE(t.due_year, i.year) AS year
    FROM transactions t
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    WHERE t.user_id = ?
      AND (t.id = ? OR t.parent_txn_id = ?)
    ORDER BY COALESCE(t.due_year, i.year) ASC, COALESCE(t.due_month, i.month) ASC, t.id ASC
  `).all(userId, rootId, rootId).map((row) => ({
    ...row,
    installment: resolveImportInstallmentMeta({
      rawJson: row.raw_json,
      description: row.description,
      amountCents: row.amount_cents
    })
  }));
}

function formatInstallmentDescription(baseDescription, position, total) {
  const cleanBase = normalizeImportInstallmentBaseDescription(baseDescription);
  const normalizedTotal = Math.max(1, Number(total || 1));
  const normalizedPosition = Math.min(normalizedTotal, Math.max(1, Number(position || 1)));
  if (normalizedTotal <= 1) return cleanBase;
  return `${cleanBase} (${String(normalizedPosition).padStart(2, '0')}/${String(normalizedTotal).padStart(2, '0')})`;
}

function buildInstallmentMetaByTxnId(userId, txnRow) {
  const installmentChain = getInstallmentChainRows(userId, txnRow);
  const metaMap = new Map();
  installmentChain.forEach((row, index) => {
    const explicitMeta = row.installment || null;
    if (explicitMeta) {
      metaMap.set(Number(row.id || 0), {
        position: Number(explicitMeta.position || 1),
        total: Number(explicitMeta.total || 1),
        baseDescription: stripTrailingInstallmentMarker(row.description)
      });
      return;
    }
    metaMap.set(Number(row.id || 0), {
      position: index + 1,
      total: installmentChain.length || 1,
      baseDescription: stripTrailingInstallmentMarker(row.description)
    });
  });
  return metaMap;
}

function buildImportOverwriteDescription(userId, txnRow, nextBaseDescription, previewItem = null) {
  const previewInstallment = previewItem?.installment || resolveImportInstallmentMeta({
    raw: previewItem?.raw,
    description: previewItem?.description,
    amountCents: previewItem?.amountCents
  });
  const cleanBaseDescription = normalizeImportInstallmentBaseDescription(
    previewInstallment ? previewInstallment.baseDescription : stripTrailingInstallmentMarker(nextBaseDescription)
  ) || '(sem descricao)';
  if (!txnRow || !txnRow.id) return cleanBaseDescription;

  const installmentMeta = buildInstallmentMetaByTxnId(userId, txnRow).get(Number(txnRow.id || 0)) || null;
  if (!installmentMeta || Number(installmentMeta.total || 1) <= 1) return cleanBaseDescription;
  return formatInstallmentDescription(cleanBaseDescription, installmentMeta.position, installmentMeta.total);
}


function isEditableImportedInstallmentTxn(txnRow) {
  if (!txnRow || Number(txnRow.import_id || txnRow.importId || 0) <= 0) return false;
  return !!resolveImportInstallmentMeta({
    rawJson: txnRow.raw_json,
    description: txnRow.description,
    amountCents: txnRow.amount_cents || txnRow.amountCents || 0
  });
}

function getEditableTransactionScopeRows(userId, txnRow, scope = 'single') {
  if (!txnRow) return [];
  if (Number(txnRow.recurring_rule_id || 0) > 0) {
    return getRecurringCategoryScopeRows(userId, txnRow, scope);
  }
  return getInstallmentScopeRows(userId, txnRow, scope);
}

function getAllocationRowsByTransactionIds(userId, txnIds) {
  const ids = normalizeTxnIds(txnIds);
  if (!ids.length) return new Map();

  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT transaction_id, person_id, share_cents
    FROM allocations
    WHERE user_id = ? AND transaction_id IN (${placeholders})
    ORDER BY transaction_id ASC, id ASC
  `).all(userId, ...ids);

  const map = new Map();
  rows.forEach((row) => {
    const txnId = Number(row.transaction_id || 0);
    if (!txnId) return;
    if (!map.has(txnId)) map.set(txnId, []);
    map.get(txnId).push({ person_id: Number(row.person_id || 0), share_cents: Number(row.share_cents || 0) });
  });
  return map;
}

function ensureAmountEditDoesNotBreakAllocations(userId, originalRows, nextAmountCents) {
  const rows = dedupeTxnRows(originalRows);
  if (!rows.length) return;

  const allocationsByTxnId = getAllocationRowsByTransactionIds(userId, rows.map((row) => row.id));
  rows.forEach((row) => {
    const allocationRows = allocationsByTxnId.get(Number(row.id || 0)) || [];
    if (!allocationRows.length) return;
    if (Number(row.amount_cents || 0) === Number(nextAmountCents || 0)) return;

    const participantIds = allocationRows.map((allocation) => Number(allocation.person_id || 0)).filter(Boolean);
    if (!participantIds.length) return;

    const allocationMode = inferAllocationMode(Number(row.amount_cents || 0), allocationRows);
    if (allocationMode === 'exact' && participantIds.length > 1) {
      throw new Error('Essa compra já tem divisão com valores definidos entre pessoas. Para trocar o valor com segurança, ajuste a divisão primeiro.');
    }
  });
}

function syncEqualAllocationsForEditedTransactions(userId, updatedRows) {
  const rows = dedupeTxnRows(updatedRows);
  if (!rows.length) return;

  const allocationsByTxnId = getAllocationRowsByTransactionIds(userId, rows.map((row) => row.id));
  const updateAllocation = db.prepare(`
    UPDATE allocations
    SET share_cents = ?
    WHERE user_id = ? AND transaction_id = ? AND person_id = ?
  `);

  db.transaction(() => {
    rows.forEach((row) => {
      const allocationRows = allocationsByTxnId.get(Number(row.id || 0)) || [];
      if (!allocationRows.length) return;

      const participantIds = allocationRows.map((allocation) => Number(allocation.person_id || 0)).filter(Boolean);
      if (!participantIds.length) return;

      const allocationMode = inferAllocationMode(Number(row.amount_cents || 0), allocationRows);
      if (allocationMode === 'exact' && participantIds.length > 1) return;

      const shareMap = buildEqualShareMap(Number(row.amount_cents || 0), participantIds);
      participantIds.forEach((personId) => {
        updateAllocation.run(Number(shareMap[personId] || 0), userId, row.id, personId);
      });
    });
  })();
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

  const selfProfile = getSelfPerson(userId) || ensureSelfPerson(userId, req.user?.name || req.user?.email, req.user?.email);
  if (!selfProfile) {
    return res.redirect('/people');
  }

  const target = getPreferredDashboardMonth(userId);
  res.redirect(`/detalhamento/${target.year}/${target.month}`);
});

app.get("/geral", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const now = dayjs();
  const nextReference = shiftMonth(now.year(), now.month() + 1, 1);

  // 1. Puxamos todas as importações e transações manuais do usuário logado
  const recent = db.prepare(`
    SELECT
      t.id,
      COALESCE(t.due_month, i.month) AS month,
      COALESCE(t.due_year, i.year) AS year,
      t.created_at,
      CASE WHEN t.import_id IS NULL THEN 'Manual' ELSE COALESCE(i.original_filename, 'N/A') END AS original_filename,
      c.name AS card_name,
      c.id AS card_id,
      c.brand AS card_brand,
      1 AS txn_count,
      t.amount_cents AS import_total
    FROM transactions t
    JOIN cards c ON c.id = t.card_id AND c.user_id = t.user_id
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    WHERE t.user_id = ?
      AND COALESCE(t.due_month, i.month) IS NOT NULL
      AND COALESCE(t.due_year, i.year) IS NOT NULL
    ORDER BY year DESC, month DESC, t.id DESC
  `).all(userId);

  // 2. Puxamos o que já foi marcado como pago na tela de Resumo
  const statementsRows = db.prepare("SELECT card_id, month, year, paid_cents FROM card_statements WHERE user_id = ?").all(userId);
  const statements = {};
  const closedMonths = getClosedMonthsSet(userId);
  statementsRows.forEach(s => {
    statements[`${s.year}-${s.month}-${s.card_id}`] = s.paid_cents || 0;
  });

  // 3. Agrupamos por mês/ano e consolidamos os cartões dentro de cada mês
  const groupedMap = new Map();

  function ensureRadarMonthGroup(year, month) {
    const safeYear = Number(year || 0);
    const safeMonth = Number(month || 0);
    if (!safeYear || !safeMonth) return null;
    const key = `${safeYear}-${safeMonth}`;

    if (!groupedMap.has(key)) {
      groupedMap.set(key, {
        year: safeYear,
        month: safeMonth,
        label: `${String(safeMonth).padStart(2, '0')}/${safeYear}`,
        cards: [],
        total_cents: 0,
        paid_cents: 0,
        remaining_cents: 0,
        cardsMap: new Map(),
        sharedProjectionSummary: buildEmptySharedPurchaseProjectionSummary(safeMonth, safeYear)
      });
    }

    return groupedMap.get(key);
  }

  recent.forEach(r => {
    const group = ensureRadarMonthGroup(r.year, r.month);
    if (!group) return;
    group.total_cents += r.import_total;

    if (!group.cardsMap.has(r.card_id)) {
      group.cardsMap.set(r.card_id, {
        card_id: r.card_id,
        card_name: r.card_name,
        card_brand: r.card_brand || '',
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

  const sharedProjectionPeriods = getAcceptedSharedPurchaseProjectionPeriodsSafe(userId);
  sharedProjectionPeriods.forEach((period) => {
    ensureRadarMonthGroup(period.year, period.month);
  });

  const groupedRecent = Array.from(groupedMap.values()).map(group => {
    const cards = Array.from(group.cardsMap.values())
      .map(card => {
        const filenames = Array.from(card.filenames.values());
        return {
          card_id: card.card_id,
          card_name: card.card_name,
          card_brand: card.card_brand || '',
          month: card.month,
          year: card.year,
          txn_count: card.txn_count,
          import_total: card.import_total,
          original_filename: filenames.length > 1 ? filenames.join(' + ') : (filenames[0] || 'N/A')
        };
      })
      .sort((a, b) => a.card_name.localeCompare(b.card_name, 'pt-BR', { sensitivity: 'base' }));

    const own_total_cents = Number(group.total_cents || 0);
    const own_paid_cents = cards.reduce((totalPaid, card) => {
      return totalPaid + (statements[`${group.year}-${group.month}-${card.card_id}`] || 0);
    }, 0);
    const own_remaining_cents = Math.max(0, own_total_cents - own_paid_cents);
    const sharedProjectionSummary = getAcceptedSharedPurchaseProjectionSummarySafe(userId, group.month, group.year);
    const shared_total_cents = Number(sharedProjectionSummary.totalCents || 0);
    const shared_paid_cents = Number(sharedProjectionSummary.confirmedPaidCents || 0);
    const shared_pending_cents = Number(sharedProjectionSummary.pendingReportedCents || 0);
    const shared_open_cents = Number(sharedProjectionSummary.openCents || 0);
    const shared_remaining_cents = Number(sharedProjectionSummary.remainingCents || Math.max(0, shared_total_cents - shared_paid_cents));
    const total_cents = own_total_cents + shared_total_cents;
    const paid_cents = own_paid_cents + shared_paid_cents;
    const remaining_cents = own_remaining_cents + shared_remaining_cents;

    return {
      year: group.year,
      month: group.month,
      label: group.label,
      cards,
      total_cents,
      paid_cents,
      remaining_cents,
      own_total_cents,
      own_paid_cents,
      own_remaining_cents,
      shared_total_cents,
      shared_paid_cents,
      shared_pending_cents,
      shared_open_cents,
      shared_remaining_cents,
      shared_count: Number(sharedProjectionSummary.count || 0),
      sharedProjectionSummary,
      hasSharedProjections: shared_total_cents > 0,
      isSharedOnly: cards.length === 0 && shared_total_cents > 0,
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

  const cards = getActiveCards(userId).map(({ id, name, close_day, due_day, brand }) => ({ id, name, close_day, due_day, brand }));
  const purchaseCategories = getPurchaseCategories(userId);

  return safeRenderView(res, "home", {
    groupedRecent: groupedRecentDisplay,
    featuredOpenGroup,
    formatBRLFromCents,
    cards,
    purchaseCategories,
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

function getCsvAllocationDetailsByTxnId(userId, txnIds) {
  const safeTxnIds = Array.from(new Set((txnIds || [])
    .map((id) => Number(id || 0))
    .filter((id) => Number.isInteger(id) && id > 0)));
  const detailsByTxnId = new Map();
  if (!safeTxnIds.length) return detailsByTxnId;

  const placeholders = safeTxnIds.map(() => '?').join(', ');
  const rows = db.prepare(`
    SELECT a.transaction_id, p.name, a.share_cents
    FROM allocations a
    JOIN people p ON p.id = a.person_id AND p.user_id = a.user_id
    WHERE a.user_id = ?
      AND a.transaction_id IN (${placeholders})
    ORDER BY a.transaction_id ASC, p.name ASC, p.id ASC
  `).all(userId, ...safeTxnIds);

  rows.forEach((row) => {
    const txnId = Number(row.transaction_id || 0);
    if (!txnId) return;
    const name = String(row.name || '').replace(/\s+/g, ' ').trim() || 'Pessoa';
    const detail = `${name}: ${formatBRLFromCents(Number(row.share_cents || 0))}`;
    if (!detailsByTxnId.has(txnId)) detailsByTxnId.set(txnId, []);
    detailsByTxnId.get(txnId).push(detail);
  });

  return new Map(Array.from(detailsByTxnId.entries()).map(([txnId, details]) => [txnId, details.join(' | ')]));
}

function buildCsvInstallmentMetaForRow(userId, row) {
  const amountForDetection = Math.abs(Number(row?.amount_cents || 0));
  const explicitMeta = resolveImportInstallmentMeta({
    rawJson: row?.raw_json,
    description: row?.description,
    amountCents: amountForDetection
  });

  if (explicitMeta && Number(explicitMeta.total || 1) > 1) {
    return explicitMeta;
  }

  const chainMeta = buildInstallmentMetaByTxnId(userId, row).get(Number(row?.id || 0)) || null;
  if (chainMeta && Number(chainMeta.total || 1) > 1) {
    return chainMeta;
  }

  return explicitMeta || null;
}

function enrichMonthTransactionsCsvRows(userId, rows) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const allocationDetailsByTxnId = getCsvAllocationDetailsByTxnId(userId, safeRows.map((row) => row.id));

  return safeRows.map((row) => {
    const amountCents = Number(row.amount_cents || 0);
    const installmentMeta = buildCsvInstallmentMetaForRow(userId, row);
    const installmentTotal = Math.max(1, Number(installmentMeta?.total || 1));
    const installmentPosition = Math.min(installmentTotal, Math.max(1, Number(installmentMeta?.position || 1)));
    const isInstallment = installmentTotal > 1;
    const isRecurring = Number(row.recurring_rule_id || 0) > 0;
    const purchaseMode = isRecurring ? 'Recorrente' : (isInstallment ? 'Parcelada' : 'À vista');
    const installmentLabel = isRecurring
      ? 'Recorrente'
      : (isInstallment
        ? `${String(installmentPosition).padStart(2, '0')}/${String(installmentTotal).padStart(2, '0')}`
        : 'À vista');
    const baseDescription = isInstallment || isRecurring
      ? (installmentMeta?.baseDescription || stripTrailingInstallmentMarker(row.description) || row.description)
      : '';
    const dueMonth = Number(row.effective_due_month || 0);
    const dueYear = Number(row.effective_due_year || 0);

    return {
      ...row,
      allocation_details: allocationDetailsByTxnId.get(Number(row.id || 0)) || '',
      purchase_category_name: String(row.purchase_category_name || '').trim() || 'Sem categoria',
      entry_type: amountCents < 0 ? 'Crédito' : (amountCents > 0 ? 'Compra' : 'Valor zerado'),
      purchase_mode: purchaseMode,
      installment_label: installmentLabel,
      installment_position: isInstallment ? installmentPosition : '',
      installment_total: isInstallment ? installmentTotal : '',
      base_description: baseDescription,
      due_label: dueMonth && dueYear ? monthLabel(dueMonth, dueYear) : '',
      read_only_label: 'N\u00e3o',
      shared_requester_name: '',
      shared_status_label: '',
      shared_confirmed_paid_cents: '',
      shared_pending_reported_cents: '',
      shared_open_cents: ''
    };
  });
}


function buildSharedPurchaseProjectionCsvRows(userId, month, year) {
  const summary = getAcceptedSharedPurchaseProjectionSummarySafe(userId, month, year);
  const rows = Array.isArray(summary?.rows) ? summary.rows : [];
  if (!rows.length) return [];

  return rows.map((item) => {
    const projectionMonth = Number(item.month || month || 0);
    const projectionYear = Number(item.year || year || 0);
    const requesterName = String(item.requesterName || '').replace(/\s+/g, ' ').trim() || 'Amigo';
    const amountCents = Math.max(0, Number(item.amountCents || item.totalCents || 0));
    const confirmedPaidCents = Math.max(0, Number(item.confirmedPaidCents || item.paidCents || 0));
    const pendingReportedCents = Math.max(0, Number(item.pendingReportedCents || 0));
    const openSource = item.openCents !== undefined && item.openCents !== null ? item.openCents : item.remainingCents;
    const openCents = Math.max(0, Number(openSource || 0));

    return {
      id: item.id || `shared-request:${item.sourceRequestId || ''}`,
      txn_date: item.date || item.sourceTxnDateSnapshot || '',
      description: item.description || 'Compra compartilhada',
      card_name: item.virtualCardName || item.cardName || 'Compra compartilhada',
      card_number: '',
      amount_cents: amountCents,
      raw_json: '',
      parent_txn_id: null,
      recurring_rule_id: null,
      effective_due_month: projectionMonth,
      effective_due_year: projectionYear,
      purchase_category_name: item.categoryName || item.purchaseCategoryName || 'Compartilhadas',
      allocated: 'N\u00e3o',
      people_names: requesterName,
      allocation_details: `${requesterName}: ${formatBRLFromCents(amountCents)}`,
      entry_type: 'Compra compartilhada recebida',
      purchase_mode: 'Compartilhada',
      installment_label: '',
      installment_position: '',
      installment_total: '',
      base_description: item.description || '',
      due_label: projectionMonth && projectionYear ? monthLabel(projectionMonth, projectionYear) : monthLabel(month, year),
      origem: item.originLabel || 'Compra compartilhada recebida',
      read_only_label: 'Sim',
      isReadOnly: true,
      shared_requester_name: requesterName,
      shared_status_label: item.statusLabel || 'Aceita',
      shared_confirmed_paid_cents: confirmedPaidCents,
      shared_pending_reported_cents: pendingReportedCents,
      shared_open_cents: openCents
    };
  });
}

function getMonthTransactionsCsvRows(userId, month, year) {
  const rows = db.prepare(`
    SELECT
      t.id,
      COALESCE(t.txn_date, '') AS txn_date,
      t.description,
      c.name AS card_name,
      COALESCE(t.card_number, '') AS card_number,
      t.amount_cents,
      t.raw_json,
      t.parent_txn_id,
      t.recurring_rule_id,
      COALESCE(t.due_month, i.month) AS effective_due_month,
      COALESCE(t.due_year, i.year) AS effective_due_year,
      COALESCE(pc.name, '') AS purchase_category_name,
      CASE WHEN EXISTS (
        SELECT 1 FROM allocations a WHERE a.transaction_id = t.id AND a.user_id = t.user_id
      ) THEN 'Sim' ELSE 'N\u00e3o' END AS allocated,
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
    LEFT JOIN purchase_categories pc ON pc.id = t.purchase_category_id AND pc.user_id = t.user_id
    WHERE t.user_id = ?
      AND ${EFFECTIVE_DUE_MONTH_SQL} = ?
      AND ${EFFECTIVE_DUE_YEAR_SQL} = ?
    ORDER BY c.name, COALESCE(t.txn_date, ''), t.description
  `).all(userId, month, year);

  const ownRows = enrichMonthTransactionsCsvRows(userId, rows);
  const sharedRows = buildSharedPurchaseProjectionCsvRows(userId, month, year);
  return ownRows.concat(sharedRows);
}

function buildMonthTransactionsCsvExport(userId, month, year) {
  const rows = getMonthTransactionsCsvRows(userId, month, year);
  return buildMonthTransactionsCsv(rows, { month, year });
}

function sendMonthTransactionsCsv(res, userId, month, year) {
  const csv = buildMonthTransactionsCsvExport(userId, month, year);
  res.setHeader('Content-Type', csv.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${csv.filename}"`);
  res.send(csv.content);
}

app.get("/geral/:year/:month/export.csv", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const parsed = parseMonthYear(req.params.month, req.params.year);
  if (!parsed) return res.status(400).send("Esse mês/ano veio estranho por aqui.");
  const { month, year } = parsed;

  return sendMonthTransactionsCsv(res, userId, month, year);
});

app.get("/month/:year/:month/export.csv", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const parsed = parseMonthYear(req.params.month, req.params.year);
  if (!parsed) return res.status(400).send("Esse mês/ano veio estranho por aqui.");
  const { month, year } = parsed;

  return sendMonthTransactionsCsv(res, userId, month, year);
});

function buildPrivateDebtReminderSnapshotsForPerson(ownerUserId, personId) {
  const safeOwnerUserId = Number(ownerUserId || 0);
  const safePersonId = Number(personId || 0);
  if (!safeOwnerUserId || !safePersonId) return null;

  const person = db.prepare(`
    SELECT
      p.id,
      p.name,
      p.email,
      p.phone,
      p.deleted_label,
      pal.linked_user_id
    FROM people p
    LEFT JOIN person_app_links pal ON pal.owner_user_id = p.user_id AND pal.person_id = p.id
    WHERE p.id = ? AND p.user_id = ?
    LIMIT 1
  `).get(safePersonId, safeOwnerUserId);

  if (!person) return null;
  return buildPrivateDebtPersonSnapshots(person);
}

function getPrivateDebtReminderRowsForOwner(ownerUserId, { includeArchived = false, statuses = null } = {}) {
  const safeOwnerUserId = Number(ownerUserId || 0);
  if (!safeOwnerUserId) return [];

  const where = ['r.owner_user_id = ?'];
  const params = [safeOwnerUserId];

  if (!includeArchived) {
    where.push('COALESCE(r.is_archived, 0) = 0');
  }

  const normalizedStatuses = Array.isArray(statuses)
    ? Array.from(new Set(statuses
      .map((value) => String(value || '').trim().toLowerCase())
      .filter(Boolean)
      .filter((value) => [PRIVATE_DEBT_STATUS_OPEN, PRIVATE_DEBT_STATUS_SETTLED, PRIVATE_DEBT_STATUS_CANCELLED].includes(value))))
    : [];

  if (normalizedStatuses.length) {
    where.push(`r.status IN (${normalizedStatuses.map(() => '?').join(', ')})`);
    params.push(...normalizedStatuses);
  }

  const rows = db.prepare(`
    SELECT
      r.*,
      p.name AS current_person_name,
      COALESCE(p.status, CASE WHEN COALESCE(p.active, 1) = 0 THEN 'inactive' ELSE 'active' END) AS current_person_status,
      COALESCE(p.active, 1) AS current_person_active
    FROM private_debt_reminders r
    LEFT JOIN people p ON p.id = r.person_id AND p.user_id = r.owner_user_id
    WHERE ${where.join(' AND ')}
    ORDER BY
      CASE r.status
        WHEN 'open' THEN 0
        WHEN 'settled' THEN 1
        WHEN 'cancelled' THEN 2
        ELSE 3
      END,
      COALESCE(r.updated_at, r.created_at) DESC,
      r.id DESC
  `).all(...params);

  return rows.map((row) => mapPrivateDebtReminderRow(row));
}

function getOpenPrivateDebtReceivableSummary(userId) {
  const safeUserId = Number(userId || 0);
  if (!safeUserId) {
    return { totalCount: 0, totalCents: 0 };
  }

  const row = db.prepare(`
    SELECT
      COUNT(*) AS total_requests,
      COALESCE(SUM(amount_cents), 0) AS total_cents
    FROM private_debt_reminders
    WHERE owner_user_id = ?
      AND status = 'open'
      AND COALESCE(is_archived, 0) = 0
  `).get(safeUserId) || { total_requests: 0, total_cents: 0 };

  return {
    totalCount: Math.max(0, Number(row.total_requests || 0)),
    totalCents: Math.max(0, Number(row.total_cents || 0))
  };
}

function getPrivateDebtReminderDashboardSummary(ownerUserId) {
  const safeOwnerUserId = Number(ownerUserId || 0);
  if (!safeOwnerUserId) {
    return {
      activeCount: 0,
      activeCents: 0,
      readyToArchiveCount: 0,
      readyToArchiveCents: 0,
      archivedCount: 0,
      archivedCents: 0,
      hasActive: false,
      hasReadyToArchive: false,
      hasArchived: false
    };
  }

  const row = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN COALESCE(is_archived, 0) = 0 AND status = 'open' THEN 1 ELSE 0 END), 0) AS active_count,
      COALESCE(SUM(CASE WHEN COALESCE(is_archived, 0) = 0 AND status = 'open' THEN amount_cents ELSE 0 END), 0) AS active_cents,
      COALESCE(SUM(CASE WHEN COALESCE(is_archived, 0) = 0 AND status IN (${PRIVATE_DEBT_ARCHIVABLE_STATUS_SQL}) THEN 1 ELSE 0 END), 0) AS ready_to_archive_count,
      COALESCE(SUM(CASE WHEN COALESCE(is_archived, 0) = 0 AND status IN (${PRIVATE_DEBT_ARCHIVABLE_STATUS_SQL}) THEN amount_cents ELSE 0 END), 0) AS ready_to_archive_cents,
      COALESCE(SUM(CASE WHEN COALESCE(is_archived, 0) = 1 THEN 1 ELSE 0 END), 0) AS archived_count,
      COALESCE(SUM(CASE WHEN COALESCE(is_archived, 0) = 1 THEN amount_cents ELSE 0 END), 0) AS archived_cents
    FROM private_debt_reminders
    WHERE owner_user_id = ?
  `).get(safeOwnerUserId) || {};

  const activeCount = Math.max(0, Number(row.active_count || 0));
  const activeCents = Math.max(0, Number(row.active_cents || 0));
  const readyToArchiveCount = Math.max(0, Number(row.ready_to_archive_count || 0));
  const readyToArchiveCents = Math.max(0, Number(row.ready_to_archive_cents || 0));
  const archivedCount = Math.max(0, Number(row.archived_count || 0));
  const archivedCents = Math.max(0, Number(row.archived_cents || 0));

  return {
    activeCount,
    activeCents,
    readyToArchiveCount,
    readyToArchiveCents,
    archivedCount,
    archivedCents,
    hasActive: activeCount > 0,
    hasReadyToArchive: readyToArchiveCount > 0,
    hasArchived: archivedCount > 0
  };
}

function detachPrivateDebtRemindersFromPerson(ownerUserId, personId) {
  const safeOwnerUserId = Number(ownerUserId || 0);
  const safePersonId = Number(personId || 0);
  if (!safeOwnerUserId || !safePersonId) return;

  db.prepare(`
    UPDATE private_debt_reminders
    SET person_id = NULL,
        updated_at = ?
    WHERE owner_user_id = ?
      AND person_id = ?
  `).run(nowIso(), safeOwnerUserId, safePersonId);
}

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
  const privateReceivable = getOpenPrivateDebtReceivableSummary(userId);

  return {
    owedCents: Number(manualOwed.total_cents || 0) + cardOwed.totalCents,
    owedCount: Number(manualOwed.total_requests || 0) + cardOwed.totalCount,
    receivableCents: Number(manualReceivable.total_cents || 0) + cardReceivable.totalCents + privateReceivable.totalCents,
    receivableCount: Number(manualReceivable.total_requests || 0) + cardReceivable.totalCount + privateReceivable.totalCount,
    privateReceivableCents: privateReceivable.totalCents,
    privateReceivableCount: privateReceivable.totalCount
  };
}



function getSharedDebtCardDetailBreakdownForMonth(userId, month, year, scope = 'owed') {
  const safeUserId = Number(userId || 0);
  const safeMonth = Number(month || 0);
  const safeYear = Number(year || 0);
  if (!safeUserId || !safeMonth || !safeYear) {
    return { totalCents: 0, itemCount: 0, settlementCount: 0 };
  }

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
  `).all(safeUserId, safeMonth, safeYear);

  return pairRows.reduce((acc, row) => {
    const snapshot = getSharedDebtCardMonthlySettlementSnapshot({
      requesterUserId: row.requester_user_id,
      receiverUserId: row.receiver_user_id,
      month: safeMonth,
      year: safeYear
    });

    if (!snapshot || Number(snapshot.openCents || 0) <= 0) {
      return acc;
    }

    const openCents = Math.max(0, Number(snapshot.openCents || 0));
    const preview = buildSharedDebtCardMonthlyIntentPreview(snapshot, openCents, {
      maxAmountCents: openCents
    });

    acc.totalCents += openCents;
    acc.itemCount += Math.max(1, Number(preview?.touchedCount || 0));
    acc.settlementCount += 1;
    return acc;
  }, { totalCents: 0, itemCount: 0, settlementCount: 0 });
}

function buildSharedDebtDetailPayStatus(summary = {}) {
  const pendingReceivedCount = Math.max(0, Number(summary.pendingReceivedCount || 0));
  const manualOwedCount = Math.max(0, Number(summary.manual?.owedCount || 0));
  const cardOwedCount = Math.max(0, Number(summary.card?.owedItemCount || 0));
  const totalOwedCents = Math.max(0, Number(summary.pay?.amountCents || 0));

  if (pendingReceivedCount > 0) {
    return {
      tone: 'warning',
      label: pendingReceivedCount === 1
        ? '1 envio ainda aguarda sua decisão.'
        : `${pendingReceivedCount} envios ainda aguardam sua decisão.`
    };
  }

  if (totalOwedCents > 0) {
    if (manualOwedCount > 0 && cardOwedCount > 0) {
      return {
        tone: 'info',
        label: 'Tem combinado avulso e cartão batendo ponto aqui.'
      };
    }

    if (cardOwedCount > 0) {
      return {
        tone: 'info',
        label: cardOwedCount === 1
          ? '1 item do cartão segue em aberto.'
          : `${cardOwedCount} itens do cartão seguem em aberto.`
      };
    }

    return {
      tone: 'info',
      label: manualOwedCount === 1
        ? '1 combinado ainda segue em aberto.'
        : `${manualOwedCount} combinados ainda seguem em aberto.`
    };
  }

  return {
    tone: 'success',
    label: 'Nada puxando seu mês desse lado.'
  };
}

function buildSharedDebtDetailReceiveStatus(summary = {}) {
  const pendingReceiptConfirmationCount = Math.max(0, Number(summary.pendingReceiptConfirmationCount || 0));
  const senderDecisionCount = Math.max(0, Number(summary.senderDecisionCount || 0));
  const pendingSentCount = Math.max(0, Number(summary.pendingSentCount || 0));
  const manualReceivableCount = Math.max(0, Number(summary.manual?.receivableCount || 0));
  const privateActiveCount = Math.max(0, Number(summary.manual?.privateActiveCount || 0));
  const cardReceivableCount = Math.max(0, Number(summary.card?.receivableItemCount || 0));
  const totalReceivableCents = Math.max(0, Number(summary.receive?.amountCents || 0));

  if (pendingReceiptConfirmationCount > 0) {
    return {
      tone: 'warning',
      label: pendingReceiptConfirmationCount === 1
        ? '1 pagamento já pode receber seu ok.'
        : `${pendingReceiptConfirmationCount} pagamentos já podem receber seu ok.`
    };
  }

  if (senderDecisionCount > 0) {
    return {
      tone: 'warning',
      label: senderDecisionCount === 1
        ? '1 recusa pede sua decisão.'
        : `${senderDecisionCount} recusas pedem sua decisão.`
    };
  }

  if (pendingSentCount > 0) {
    return {
      tone: 'info',
      label: pendingSentCount === 1
        ? '1 envio ainda aguarda aceite.'
        : `${pendingSentCount} envios ainda aguardam aceite.`
    };
  }

  if (totalReceivableCents > 0) {
    if (!manualReceivableCount && !cardReceivableCount && privateActiveCount > 0) {
      return {
        tone: 'info',
        label: privateActiveCount === 1
          ? '1 lembrete privado segue no seu radar.'
          : `${privateActiveCount} lembretes privados seguem no seu radar.`
      };
    }

    if ((manualReceivableCount + privateActiveCount) > 0 && cardReceivableCount > 0) {
      return {
        tone: 'info',
        label: 'Tem avulsas e cartão rodando daqui.'
      };
    }

    if (cardReceivableCount > 0) {
      return {
        tone: 'info',
        label: cardReceivableCount === 1
          ? '1 item do cartão segue esperando acerto.'
          : `${cardReceivableCount} itens do cartão seguem esperando acerto.`
      };
    }

    const manualLikeCount = manualReceivableCount + privateActiveCount;
    return {
      tone: 'info',
      label: manualLikeCount === 1
        ? '1 cobrança segue em aberto daqui.'
        : `${manualLikeCount} cobranças seguem em aberto daqui.`
    };
  }

  return {
    tone: 'success',
    label: 'Nada pendurado do lado de cá.'
  };
}

function getSharedDebtDetailModuleSummary(userId, month, year) {
  const safeUserId = Number(userId || 0);
  const safeMonth = Number(month || 0);
  const safeYear = Number(year || 0);

  if (!safeUserId || !safeMonth || !safeYear) {
    return {
      hasAnySignal: false,
      headerHref: '/shared-debts',
      pay: { amountCents: 0, count: 0, href: '/shared-debts#received', ctaLabel: 'Ver recebidas', status: { tone: 'success', label: 'Nada puxando seu mês desse lado.' } },
      receive: { amountCents: 0, count: 0, href: '/shared-debts#sent', ctaLabel: 'Ver enviadas', status: { tone: 'success', label: 'Nada pendurado do lado de cá.' } },
      manual: { owedCents: 0, receivableCents: 0, owedCount: 0, receivableCount: 0, bilateralCount: 0, privateActiveCents: 0, privateActiveCount: 0, totalCount: 0, href: '/shared-debts' },
      card: { owedCents: 0, receivableCents: 0, owedItemCount: 0, receivableItemCount: 0, itemCount: 0, settlementCount: 0, href: '/shared-debts' },
      chips: []
    };
  }

  const manualOwedRow = db.prepare(`
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
  `).get(safeUserId) || { total_requests: 0, total_cents: 0 };

  const manualReceivableRow = db.prepare(`
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
  `).get(safeUserId) || { total_requests: 0, total_cents: 0 };

  const cardOwed = getSharedDebtCardDetailBreakdownForMonth(safeUserId, safeMonth, safeYear, 'owed');
  const cardReceivable = getSharedDebtCardDetailBreakdownForMonth(safeUserId, safeMonth, safeYear, 'receivable');
  const privateReminderSummary = getPrivateDebtReminderDashboardSummary(safeUserId);

  const pendingReceivedCount = db.prepare(`
    SELECT COUNT(DISTINCT COALESCE(batch_id, id)) AS total
    FROM shared_debt_requests
    WHERE receiver_user_id = ?
      AND status = 'pending'
  `).get(safeUserId)?.total || 0;

  const pendingSentCount = db.prepare(`
    SELECT COUNT(DISTINCT COALESCE(batch_id, id)) AS total
    FROM shared_debt_requests
    WHERE requester_user_id = ?
      AND status = 'pending'
  `).get(safeUserId)?.total || 0;

  const senderDecisionCount = db.prepare(`
    SELECT COUNT(*) AS total
    FROM shared_debt_requests
    WHERE requester_user_id = ?
      AND status = 'rejected_by_receiver'
  `).get(safeUserId)?.total || 0;

  const legacyPendingReceiptConfirmationCount = db.prepare(`
    SELECT COUNT(*) AS total
    FROM shared_debt_requests
    WHERE requester_user_id = ?
      AND status = 'accepted'
      AND payment_marked_at IS NOT NULL
  `).get(safeUserId)?.total || 0;

  const monthlyPendingReceiptConfirmationCount = db.prepare(`
    SELECT COUNT(*) AS total
    FROM shared_debt_payment_intents
    WHERE requester_user_id = ?
      AND request_kind = 'card'
      AND status = 'reported'
  `).get(safeUserId)?.total || 0;

  const pendingReceiptConfirmationCount = legacyPendingReceiptConfirmationCount + monthlyPendingReceiptConfirmationCount;

  const manualOwedCount = Math.max(0, Number(manualOwedRow.total_requests || 0));
  const manualReceivableCount = Math.max(0, Number(manualReceivableRow.total_requests || 0));
  const manualOwedCents = Math.max(0, Number(manualOwedRow.total_cents || 0));
  const manualReceivableCents = Math.max(0, Number(manualReceivableRow.total_cents || 0));
  const privateActiveCount = Math.max(0, Number(privateReminderSummary.activeCount || 0));
  const privateActiveCents = Math.max(0, Number(privateReminderSummary.activeCents || 0));
  const cardOwedCents = Math.max(0, Number(cardOwed.totalCents || 0));
  const cardReceivableCents = Math.max(0, Number(cardReceivable.totalCents || 0));
  const cardOwedCount = Math.max(0, Number(cardOwed.itemCount || 0));
  const cardReceivableCount = Math.max(0, Number(cardReceivable.itemCount || 0));

  const summary = {
    headerHref: '/shared-debts',
    pendingReceivedCount: Math.max(0, Number(pendingReceivedCount || 0)),
    pendingSentCount: Math.max(0, Number(pendingSentCount || 0)),
    senderDecisionCount: Math.max(0, Number(senderDecisionCount || 0)),
    pendingReceiptConfirmationCount: Math.max(0, Number(pendingReceiptConfirmationCount || 0)),
    pay: {
      amountCents: manualOwedCents + cardOwedCents,
      count: manualOwedCount + cardOwedCount,
      href: '/shared-debts#received',
      ctaLabel: 'Ver recebidas'
    },
    receive: {
      amountCents: manualReceivableCents + cardReceivableCents + privateActiveCents,
      count: manualReceivableCount + cardReceivableCount + privateActiveCount,
      href: (manualReceivableCount + cardReceivableCount + pendingSentCount + senderDecisionCount + pendingReceiptConfirmationCount) > 0
        ? '/shared-debts#sent'
        : (privateActiveCount > 0 ? '/shared-debts#private-reminders' : '/shared-debts#sent'),
      ctaLabel: (manualReceivableCount + cardReceivableCount + pendingSentCount + senderDecisionCount + pendingReceiptConfirmationCount) > 0
        ? 'Ver enviadas'
        : (privateActiveCount > 0 ? 'Ver privadas' : 'Ver enviadas')
    },
    manual: {
      owedCents: manualOwedCents,
      receivableCents: manualReceivableCents + privateActiveCents,
      owedCount: manualOwedCount,
      receivableCount: manualReceivableCount,
      bilateralCount: manualOwedCount + manualReceivableCount,
      privateActiveCents,
      privateActiveCount,
      totalCount: manualOwedCount + manualReceivableCount + privateActiveCount,
      href: '/shared-debts'
    },
    card: {
      owedCents: cardOwedCents,
      receivableCents: cardReceivableCents,
      owedItemCount: cardOwedCount,
      receivableItemCount: cardReceivableCount,
      itemCount: cardOwedCount + cardReceivableCount,
      settlementCount: Math.max(0, Number(cardOwed.settlementCount || 0)) + Math.max(0, Number(cardReceivable.settlementCount || 0)),
      href: '/shared-debts'
    },
    chips: []
  };

  summary.pay.status = buildSharedDebtDetailPayStatus(summary);
  summary.receive.status = buildSharedDebtDetailReceiveStatus(summary);

  summary.hasAnySignal = summary.pay.amountCents > 0
    || summary.receive.amountCents > 0
    || summary.pendingReceivedCount > 0
    || summary.pendingSentCount > 0
    || summary.senderDecisionCount > 0
    || summary.pendingReceiptConfirmationCount > 0;

  if (summary.pendingReceivedCount > 0) {
    summary.chips.push({
      tone: 'warning',
      label: summary.pendingReceivedCount === 1 ? '1 aguardando decisão' : `${summary.pendingReceivedCount} aguardando decisão`,
      href: '/shared-debts#received-inbox'
    });
  }

  if (summary.pendingReceiptConfirmationCount > 0) {
    summary.chips.push({
      tone: 'warning',
      label: summary.pendingReceiptConfirmationCount === 1 ? '1 pronto para confirmar' : `${summary.pendingReceiptConfirmationCount} prontos para confirmar`,
      href: '/shared-debts#sent'
    });
  }

  if (summary.senderDecisionCount > 0) {
    summary.chips.push({
      tone: 'info',
      label: summary.senderDecisionCount === 1 ? '1 recusa pedindo decisão' : `${summary.senderDecisionCount} recusas pedindo decisão`,
      href: '/shared-debts#sent'
    });
  }

  if (summary.manual.privateActiveCount > 0) {
    summary.chips.push({
      tone: 'info',
      label: summary.manual.privateActiveCount === 1 ? '1 privado no radar' : `${summary.manual.privateActiveCount} privados no radar`,
      href: '/shared-debts#private-reminders'
    });
  }

  if (!summary.chips.length && summary.pendingSentCount > 0) {
    summary.chips.push({
      tone: 'info',
      label: summary.pendingSentCount === 1 ? '1 aguardando aceite' : `${summary.pendingSentCount} aguardando aceite`,
      href: '/shared-debts#sent'
    });
  }

  return summary;
}


function getPeopleComprasComigoContact(userId, personId) {
  const safeUserId = Number(userId || 0);
  const safePersonId = Number(personId || 0);
  if (!safeUserId || !safePersonId) return null;

  return getPeopleAll(safeUserId).find((person) => Number(person?.id || 0) === safePersonId) || null;
}

function isPeopleComprasComigoOpenStatus(status = 'pending') {
  const normalized = String(status || 'pending').trim().toLowerCase();
  return ['pending', 'accepted', 'rejected_by_receiver', 'rejection_contested_by_sender'].includes(normalized);
}

function getIsoMonthRank(dateValue = null) {
  if (!dateValue) return null;
  const parsed = dayjs(dateValue);
  if (!parsed.isValid()) return null;
  return (parsed.year() * 100) + (parsed.month() + 1);
}

function getPeopleComprasComigoManualStartRank(item = {}) {
  return getIsoMonthRank(item?.created_at || item?.source_txn_date || item?.updated_at || null);
}

function getPeopleComprasComigoManualHistoryRank(item = {}) {
  return getIsoMonthRank(
    item?.resolved_at
      || item?.settled_at
      || item?.cancelled_at
      || item?.responded_at
      || item?.updated_at
      || item?.created_at
      || null
  );
}

function getPeopleComprasComigoCurrentRank() {
  const now = dayjs();
  return (now.year() * 100) + (now.month() + 1);
}

function isSharedDebtRequestVisibleInPeopleComprasComigoMonth(item = {}, month, year, tab = 'open') {
  const safeMonth = Number(month || 0);
  const safeYear = Number(year || 0);
  if (!safeMonth || !safeYear) return false;

  const requestKind = normalizeSharedDebtRequestKind(item?.request_kind);
  const targetRank = (safeYear * 100) + safeMonth;
  const wantsOpen = String(tab || 'open').trim().toLowerCase() !== 'history';
  const isOpen = isPeopleComprasComigoOpenStatus(item?.status);

  if (requestKind === 'card') {
    const dueMonth = Number(item?.source_due_month || 0);
    const dueYear = Number(item?.source_due_year || 0);
    if (!dueMonth || !dueYear) return false;
    const dueRank = (dueYear * 100) + dueMonth;
    if (dueRank != targetRank) return false;
    return wantsOpen ? isOpen : !isOpen;
  }

  const startRank = getPeopleComprasComigoManualStartRank(item);
  if (!startRank) return false;

  if (wantsOpen) {
    if (!isOpen) return false;
    return targetRank >= startRank;
  }

  if (isOpen) return false;
  const historyRank = getPeopleComprasComigoManualHistoryRank(item) || startRank;
  return historyRank === targetRank;
}

function getPeopleComprasComigoRelevantMonthRanks(items = []) {
  const currentRank = getPeopleComprasComigoCurrentRank();
  const ranks = new Set([currentRank]);

  (Array.isArray(items) ? items : []).forEach((item) => {
    const requestKind = normalizeSharedDebtRequestKind(item?.request_kind);
    if (requestKind === 'card') {
      const month = Number(item?.source_due_month || 0);
      const year = Number(item?.source_due_year || 0);
      if (month && year) ranks.add((year * 100) + month);
      return;
    }

    const startRank = getPeopleComprasComigoManualStartRank(item);
    if (startRank) ranks.add(startRank);

    if (isPeopleComprasComigoOpenStatus(item?.status)) {
      ranks.add(currentRank);
      return;
    }

    const historyRank = getPeopleComprasComigoManualHistoryRank(item);
    if (historyRank) ranks.add(historyRank);
  });

  return Array.from(ranks).filter(Boolean).sort((a, b) => b - a);
}

function rankToMonthYear(rank) {
  const safeRank = Number(rank || 0);
  if (!safeRank) return null;
  const year = Math.floor(safeRank / 100);
  const month = safeRank % 100;
  if (!parseMonthYear(month, year)) return null;
  return { year, month };
}

function getPeopleComprasComigoPrimaryActionMeta(item = {}) {
  const requestId = Number(item?.id || 0);
  const settlementId = Number(item?.card_monthly_settlement_id || 0);
  const isCard = normalizeSharedDebtRequestKind(item?.request_kind) === 'card';
  const requestHref = requestId ? `/shared-debts?request=${requestId}` : '/shared-debts';
  const settlementHref = settlementId ? `/shared-debts?settlement=${settlementId}` : requestHref;
  const status = String(item?.status || 'pending').trim().toLowerCase();

  if (status === 'pending') {
    return { label: 'Ver detalhes antes de responder', href: requestHref };
  }

  if (status === 'accepted') {
    if (item?.payment_marked_at) {
      return {
        label: isCard && settlementId ? 'Abrir carteira do mês' : 'Abrir para acompanhar',
        href: isCard && settlementId ? settlementHref : requestHref
      };
    }

    return {
      label: isCard && settlementId ? 'Abrir carteira do mês' : 'Abrir na cobrança',
      href: isCard && settlementId ? settlementHref : requestHref
    };
  }

  if (status === 'rejection_contested_by_sender') {
    return { label: 'Revisar contestação', href: requestHref };
  }

  if (status === 'rejected_by_receiver') {
    return { label: 'Acompanhar decisão', href: requestHref };
  }

  return { label: 'Abrir no histórico', href: requestHref };
}

function getPeopleComprasComigoQuickActions(item = {}) {
  const requestId = Number(item?.id || 0);
  if (!requestId) return [];

  const requestKind = normalizeSharedDebtRequestKind(item?.request_kind);
  const settlementId = Number(item?.card_monthly_settlement_id || 0);
  const statusMeta = getPeopleComprasComigoStatusMeta(item);
  const statusKey = String(statusMeta?.key || '').trim();
  const requestHref = `/shared-debts?request=${requestId}`;
  const settlementHref = settlementId ? `/shared-debts?settlement=${settlementId}` : requestHref;

  if (statusKey === 'pending') {
    return [
      {
        kind: 'form',
        action: `/shared-debts/${requestId}/respond`,
        fields: [{ name: 'action', value: 'accept' }],
        label: 'Aceitar',
        tone: 'success'
      },
      {
        kind: 'form',
        action: `/shared-debts/${requestId}/respond`,
        fields: [{ name: 'action', value: 'reject' }],
        label: 'Recusar',
        tone: 'danger',
        confirmPrompt: 'Recusar essa cobrança agora? Ela continua no radar até quem enviou decidir o próximo passo.'
      }
    ];
  }

  if ((statusKey === 'accepted' || statusKey === 'accepted_partial') && requestKind === 'manual') {
    return [{
      kind: 'form',
      action: `/shared-debts/${requestId}/mark-paid`,
      label: statusKey === 'accepted_partial' ? 'Informar restante pago' : 'Informar pagamento',
      tone: 'primary'
    }];
  }

  if ((statusKey === 'accepted' || statusKey === 'accepted_partial') && requestKind === 'card') {
    return [{
      kind: 'link',
      href: settlementHref,
      label: statusKey === 'accepted_partial' ? 'Pagar restante do mês' : 'Pagar este mês',
      tone: 'primary'
    }];
  }

  return [];
}

function getPeopleComprasComigoStatusMeta(item = {}) {
  const status = String(item?.status || 'pending').trim().toLowerCase();
  const totalCents = Math.max(0, Number(item?.amount_cents || 0));
  const paidCents = Math.min(totalCents, Math.max(0, Number(item?.amount_paid_cents || 0)));

  if (status === 'accepted' && item?.payment_marked_at) {
    return {
      key: 'accepted_paid_marked',
      label: 'Pago aguardando confirmação',
      tone: 'info',
      classes: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-900/20 dark:text-sky-200'
    };
  }

  if (status === 'accepted' && paidCents > 0 && paidCents < totalCents) {
    return {
      key: 'accepted_partial',
      label: 'Parcial',
      tone: 'warning',
      classes: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200'
    };
  }

  switch (status) {
    case 'accepted':
      return {
        key: 'accepted',
        label: 'Pra eu pagar',
        tone: 'success',
        classes: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200'
      };
    case 'rejected_by_receiver':
      return {
        key: 'rejected_by_receiver',
        label: 'Rejeição aguardando decisão',
        tone: 'warning',
        classes: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200'
      };
    case 'rejection_contested_by_sender':
      return {
        key: 'rejection_contested_by_sender',
        label: 'Contestação em andamento',
        tone: 'warning',
        classes: 'border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-800 dark:bg-orange-900/20 dark:text-orange-200'
      };
    case 'rejection_accepted_by_sender':
      return {
        key: 'rejection_accepted_by_sender',
        label: 'Rejeição encerrada',
        tone: 'muted',
        classes: 'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
      };
    case 'cancelled':
      return {
        key: 'cancelled',
        label: 'Cancelada',
        tone: 'muted',
        classes: 'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
      };
    case 'settled':
      return {
        key: 'settled',
        label: 'Concluído',
        tone: 'info',
        classes: 'border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-800 dark:bg-cyan-900/20 dark:text-cyan-200'
      };
    default:
      return {
        key: 'pending',
        label: 'Aguardando meu aceite',
        tone: 'primary',
        classes: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-200'
      };
  }
}

function getPeopleComprasComigoHint(item = {}, contactName = 'essa amizade') {
  const status = String(item?.status || 'pending').trim().toLowerCase();
  const isCard = normalizeSharedDebtRequestKind(item?.request_kind) === 'card';
  const mediumLabel = isCard ? 'compra no cartão' : 'combinado avulso';

  if (status === 'pending') {
    return `${contactName} te envolveu nessa ${mediumLabel} e ainda falta o seu aceite.`;
  }

  if (status === 'accepted' && item?.payment_marked_at) {
    return `Você já avisou o pagamento. Agora falta o ok final de ${contactName}.`;
  }

  if (status === 'accepted') {
    return `Essa cobrança já foi aceita e agora o próximo passo mora no seu pagamento.`;
  }

  if (status === 'rejected_by_receiver') {
    return `Você recusou essa cobrança e agora a bola está com ${contactName}.`;
  }

  if (status === 'rejection_contested_by_sender') {
    return `${contactName} contestou a recusa. Se quiser revisar o contexto, é só abrir a cobrança.`;
  }

  if (status === 'rejection_accepted_by_sender') {
    return `${contactName} aceitou a recusa e esse item saiu de cena.`;
  }

  if (status === 'cancelled') {
    return 'Essa cobrança foi cancelada e ficou só no histórico.';
  }

  return 'Pagamento confirmado. Esse item já encerrou a conversa financeira de vocês.';
}

function decoratePeopleComprasComigoItem(item = {}, { contactName = 'essa amizade', viewedMonth = 0, viewedYear = 0 } = {}) {
  const requestKind = normalizeSharedDebtRequestKind(item?.request_kind);
  const statusMeta = getPeopleComprasComigoStatusMeta(item);
  const actionMeta = getPeopleComprasComigoPrimaryActionMeta(item);
  const quickActions = getPeopleComprasComigoQuickActions(item);
  const totalCents = Math.max(0, Number(item?.amount_cents || 0));
  let paidCents = Math.max(0, Number(item?.amount_paid_cents || 0));
  if (String(item?.status || '').trim().toLowerCase() === 'settled' && paidCents < totalCents) paidCents = totalCents;
  if (paidCents > totalCents) paidCents = totalCents;
  const pendingCents = Math.max(0, totalCents - paidCents);
  const createdRank = getPeopleComprasComigoManualStartRank(item);
  const createdMonthInfo = rankToMonthYear(createdRank);
  const historyRank = getPeopleComprasComigoManualHistoryRank(item);
  const historyMonthInfo = rankToMonthYear(historyRank);
  const createdAtLabel = item?.created_at ? formatDateBR(item.created_at) : null;
  const sourceDateLabel = item?.source_txn_date ? formatDateBR(item.source_txn_date) : createdAtLabel;
  const promisedDateLabel = item?.promised_payment_date ? formatDateBR(item.promised_payment_date) : null;
  const paymentDateLabel = item?.payment_marked_at ? formatDateBR(item.payment_marked_at) : (item?.payment_date ? formatDateBR(item.payment_date) : null);
  const dueLabel = item?.source_due_month && item?.source_due_year ? monthLabel(item.source_due_month, item.source_due_year) : null;
  const viewedRank = Number(viewedYear || 0) && Number(viewedMonth || 0) ? ((Number(viewedYear) * 100) + Number(viewedMonth)) : null;
  const isCarriedManual = requestKind === 'manual' && createdRank && viewedRank && viewedRank > createdRank && isPeopleComprasComigoOpenStatus(item?.status);

  const detailPieces = [];
  if (requestKind === 'card') {
    detailPieces.push(item?.card_name_snapshot ? `Cartão ${item.card_name_snapshot}` : 'Compra no cartão');
    if (dueLabel) detailPieces.push(`Fatura ${dueLabel}`);
  } else {
    detailPieces.push('Cobrança avulsa');
    if (createdAtLabel) detailPieces.push(`Criada em ${createdAtLabel}`);
  }

  if (requestKind === 'manual' && isCarriedManual && createdMonthInfo) {
    detailPieces.push(`Segue viva desde ${monthLabel(createdMonthInfo.month, createdMonthInfo.year)}`);
  }

  const metaRows = [];
  if (sourceDateLabel) {
    metaRows.push({ label: requestKind === 'card' ? 'Compra lançada em' : 'Criada em', value: sourceDateLabel });
  }
  if (promisedDateLabel) {
    metaRows.push({ label: 'Pagamento combinado', value: promisedDateLabel });
  }
  if (paymentDateLabel && String(item?.status || '').trim().toLowerCase() === 'accepted' && item?.payment_marked_at) {
    metaRows.push({ label: 'Pagamento avisado em', value: paymentDateLabel });
  } else if (paymentDateLabel && String(item?.status || '').trim().toLowerCase() === 'settled') {
    metaRows.push({ label: 'Fechado em', value: paymentDateLabel });
  } else if (requestKind === 'manual' && !isPeopleComprasComigoOpenStatus(item?.status) && historyMonthInfo) {
    metaRows.push({ label: 'Entrou no histórico em', value: monthLabel(historyMonthInfo.month, historyMonthInfo.year) });
  }

  const myActionNeeded = statusMeta.key === 'pending' || statusMeta.key === 'accepted' || statusMeta.key === 'accepted_partial';
  const waitingOtherSide = ['accepted_paid_marked', 'rejected_by_receiver', 'rejection_contested_by_sender'].includes(statusMeta.key);

  return {
    ...item,
    request_kind: requestKind,
    total_cents: totalCents,
    amount_paid_cents: paidCents,
    amount_pending_cents: pendingCents,
    statusMeta,
    actionMeta,
    quickActions,
    detailLine: detailPieces.join(' · '),
    hint: getPeopleComprasComigoHint(item, contactName),
    createdMonthLabel: createdMonthInfo ? monthLabel(createdMonthInfo.month, createdMonthInfo.year) : null,
    historyMonthLabel: historyMonthInfo ? monthLabel(historyMonthInfo.month, historyMonthInfo.year) : null,
    metaRows,
    sourceDateLabel,
    promisedDateLabel,
    paymentDateLabel,
    isCard: requestKind === 'card',
    isManual: requestKind === 'manual',
    isCarriedManual,
    myActionNeeded,
    waitingOtherSide
  };
}

function buildPeopleComprasComigoBadgeMap(userId, people = []) {
  const safeUserId = Number(userId || 0);
  if (!safeUserId) return new Map();

  const eligiblePeople = (Array.isArray(people) ? people : [])
    .filter((person) => person && person.friendship_active && Number(person.linked_user_id || 0) > 0 && !person.is_self);

  if (!eligiblePeople.length) return new Map();

  const linkedUserToPersonId = new Map();
  eligiblePeople.forEach((person) => {
    linkedUserToPersonId.set(Number(person.linked_user_id || 0), Number(person.id || 0));
  });

  const archivedRequestIds = getSharedDebtArchivedRequestIdSet(safeUserId);
  const counts = new Map();

  getSharedDebtRequestsReceived(safeUserId).forEach((item) => {
    const requestId = Number(item?.id || 0);
    if (!requestId || archivedRequestIds.has(requestId)) return;

    const personId = linkedUserToPersonId.get(Number(item?.requester_user_id || 0));
    if (!personId) return;

    const statusMeta = getPeopleComprasComigoStatusMeta(item);
    const statusKey = String(statusMeta?.key || '').trim();
    const bucket = counts.get(personId) || {
      needsMyActionCount: 0,
      openCount: 0,
      waitingOtherSideCount: 0
    };

    if (isPeopleComprasComigoOpenStatus(item?.status)) bucket.openCount += 1;
    if (['pending', 'accepted', 'accepted_partial'].includes(statusKey)) bucket.needsMyActionCount += 1;
    else if (['accepted_paid_marked', 'rejected_by_receiver', 'rejection_contested_by_sender'].includes(statusKey)) bucket.waitingOtherSideCount += 1;

    counts.set(personId, bucket);
  });

  eligiblePeople.forEach((person) => {
    const personId = Number(person.id || 0);
    if (!counts.has(personId)) {
      counts.set(personId, {
        needsMyActionCount: 0,
        openCount: 0,
        waitingOtherSideCount: 0
      });
    }
  });

  return counts;
}

function sortPeopleComprasComigoOpenItems(items = []) {
  const priority = (item = {}) => {
    const key = String(item?.statusMeta?.key || '').trim();
    switch (key) {
      case 'pending': return 0;
      case 'accepted': return 1;
      case 'accepted_partial': return 1;
      case 'accepted_paid_marked': return 2;
      case 'rejected_by_receiver': return 3;
      case 'rejection_contested_by_sender': return 4;
      default: return 5;
    }
  };

  const stamp = (item = {}) => {
    const candidates = [
      item?.promised_payment_date,
      item?.source_txn_date,
      item?.created_at,
      item?.updated_at
    ].filter(Boolean);

    for (const candidate of candidates) {
      const parsed = dayjs(candidate);
      if (parsed.isValid()) return parsed.valueOf();
    }

    return 0;
  };

  return (Array.isArray(items) ? items.slice() : []).sort((a, b) => {
    const weightDiff = priority(a) - priority(b);
    if (weightDiff !== 0) return weightDiff;
    return stamp(b) - stamp(a);
  });
}

function sortPeopleComprasComigoHistoryItems(items = []) {
  const historyStamp = (item = {}) => {
    const candidates = [
      item?.resolved_at,
      item?.settled_at,
      item?.cancelled_at,
      item?.responded_at,
      item?.updated_at,
      item?.created_at
    ].filter(Boolean);

    for (const candidate of candidates) {
      const parsed = dayjs(candidate);
      if (parsed.isValid()) return parsed.valueOf();
    }

    return 0;
  };

  return (Array.isArray(items) ? items.slice() : []).sort((a, b) => historyStamp(b) - historyStamp(a));
}


function getPeopleComprasComigoDraftQueueItem(userId, transactionId, personId) {
  const safeUserId = Number(userId || 0);
  const safeTxnId = Number(transactionId || 0);
  const safePersonId = Number(personId || 0);
  if (!safeUserId || !safeTxnId || !safePersonId) return null;

  return db.prepare(`
    SELECT
      i.*,
      q.id AS queue_id,
      q.source_due_month AS queue_month,
      q.source_due_year AS queue_year,
      q.updated_at AS queue_updated_at,
      q.total_cents AS queue_total_cents,
      q.item_count AS queue_item_count
    FROM shared_debt_send_queue_items i
    JOIN shared_debt_send_queues q ON q.id = i.queue_id
    WHERE q.requester_user_id = ?
      AND q.request_kind = 'card'
      AND q.status = 'draft'
      AND i.cancelled_at IS NULL
      AND i.source_transaction_id = ?
      AND i.source_person_id = ?
    ORDER BY q.updated_at DESC, i.updated_at DESC, i.id DESC
    LIMIT 1
  `).get(safeUserId, safeTxnId, safePersonId) || null;
}

function getPeopleComprasComigoLatestRequestForOutgoing(userId, transactionId, personId) {
  const safeUserId = Number(userId || 0);
  const safeTxnId = Number(transactionId || 0);
  const safePersonId = Number(personId || 0);
  if (!safeUserId || !safeTxnId || !safePersonId) return null;

  return db.prepare(`
    SELECT *
    FROM shared_debt_requests
    WHERE requester_user_id = ?
      AND request_kind = 'card'
      AND source_transaction_id = ?
      AND source_person_id = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(safeUserId, safeTxnId, safePersonId) || null;
}

function isPeopleComprasComigoBlockingRequestStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  return ['pending', 'accepted', 'settled', 'rejected_by_receiver', 'rejection_contested_by_sender'].includes(normalized);
}

function getPeopleComprasComigoOutgoingStatusMeta({ draftItem = null, request = null, eligible = true, reason = '' } = {}) {
  if (!eligible) {
    return {
      key: 'not_eligible',
      label: reason || 'Não elegível',
      classes: 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300',
      canCreateCharge: false,
      actionHref: null
    };
  }

  if (draftItem) {
    return {
      key: 'draft',
      label: 'Na caixa de saída',
      classes: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200',
      canCreateCharge: false,
      actionHref: '/shared-debts#draft-queues'
    };
  }

  const status = String(request?.status || '').trim().toLowerCase();
  if (!status) {
    return {
      key: 'none',
      label: 'Sem cobrança',
      classes: 'border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200',
      canCreateCharge: true,
      actionHref: null
    };
  }

  if (status === 'pending') {
    return {
      key: 'pending',
      label: 'Aguardando aceite',
      classes: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-900/20 dark:text-sky-200',
      canCreateCharge: false,
      actionHref: `/shared-debts?request=${Number(request.id || 0)}`
    };
  }

  if (status === 'accepted') {
    return {
      key: request?.payment_marked_at ? 'accepted_paid_marked' : 'accepted',
      label: request?.payment_marked_at ? 'Em confirmação' : 'Aceita',
      classes: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200',
      canCreateCharge: false,
      actionHref: Number(request.card_monthly_settlement_id || 0) ? `/shared-debts?settlement=${Number(request.card_monthly_settlement_id || 0)}` : `/shared-debts?request=${Number(request.id || 0)}`
    };
  }

  if (status === 'settled') {
    return {
      key: 'settled',
      label: 'Concluída',
      classes: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200',
      canCreateCharge: false,
      actionHref: `/shared-debts?request=${Number(request.id || 0)}`
    };
  }

  if (status === 'rejected_by_receiver') {
    return {
      key: 'rejected_by_receiver',
      label: 'Recusada',
      classes: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-900/20 dark:text-rose-200',
      canCreateCharge: false,
      actionHref: `/shared-debts?request=${Number(request.id || 0)}`
    };
  }

  if (status === 'rejection_contested_by_sender') {
    return {
      key: 'rejection_contested_by_sender',
      label: 'Em revisão',
      classes: 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-900/20 dark:text-violet-200',
      canCreateCharge: false,
      actionHref: `/shared-debts?request=${Number(request.id || 0)}`
    };
  }

  if (canRecreateSharedDebtDraftFromHistory(request)) {
    return {
      key: status || 'recreatable',
      label: 'Pode recriar',
      classes: 'border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-800 dark:bg-cyan-900/20 dark:text-cyan-200',
      canCreateCharge: true,
      actionHref: request?.id ? `/shared-debts?request=${Number(request.id || 0)}` : null
    };
  }

  return {
    key: status || 'blocked',
    label: 'Já tratada',
    classes: 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300',
    canCreateCharge: false,
    actionHref: request?.id ? `/shared-debts?request=${Number(request.id || 0)}` : null
  };
}

function getPeopleComprasComigoPersonAllocationForTxn(userId, transactionId, personId) {
  const safeUserId = Number(userId || 0);
  const safeTxnId = Number(transactionId || 0);
  const safePersonId = Number(personId || 0);
  if (!safeUserId || !safeTxnId || !safePersonId) return null;

  return db.prepare(`
    SELECT
      a.id AS allocation_id,
      a.person_id,
      a.share_cents,
      p.name AS person_name,
      p.email AS person_email,
      pal.linked_user_id AS linked_user_id,
      remote_u.name AS receiver_user_name,
      remote_u.email AS receiver_user_email
    FROM allocations a
    JOIN people p ON p.id = a.person_id AND p.user_id = a.user_id
    LEFT JOIN person_app_links pal ON pal.owner_user_id = p.user_id AND pal.person_id = p.id
    LEFT JOIN users remote_u ON remote_u.id = pal.linked_user_id AND COALESCE(remote_u.status, 'active') <> 'deleted'
    WHERE a.user_id = ?
      AND a.transaction_id = ?
      AND a.person_id = ?
      AND COALESCE(p.status, CASE WHEN COALESCE(p.active, 1) = 0 THEN 'inactive' ELSE 'active' END) <> 'deleted'
    LIMIT 1
  `).get(safeUserId, safeTxnId, safePersonId) || null;
}

function hasActiveDraftOrRequestForPersonTransaction(userId, transactionId, personId) {
  if (getPeopleComprasComigoDraftQueueItem(userId, transactionId, personId)) return true;
  const latestRequest = getPeopleComprasComigoLatestRequestForOutgoing(userId, transactionId, personId);
  return !!(latestRequest && isPeopleComprasComigoBlockingRequestStatus(latestRequest.status));
}

function getPeopleComprasComigoFutureChargePreview(userId, txnRow, personId) {
  const safeUserId = Number(userId || 0);
  const safePersonId = Number(personId || 0);
  if (!safeUserId || !safePersonId || !txnRow) {
    return { count: 0, totalCents: 0, txnIds: [] };
  }

  const currentTxnId = Number(txnRow.id || 0);
  const rows = getInstallmentScopeRows(safeUserId, txnRow, 'future')
    .filter((row) => Number(row?.id || 0) && Number(row.id || 0) !== currentTxnId);

  const eligibleRows = [];
  rows.forEach((row) => {
    const allocation = getPeopleComprasComigoPersonAllocationForTxn(safeUserId, row.id, safePersonId);
    if (!allocation || Number(allocation.share_cents || 0) <= 0) return;
    if (hasActiveDraftOrRequestForPersonTransaction(safeUserId, row.id, safePersonId)) return;
    eligibleRows.push({ row, allocation });
  });

  return {
    count: eligibleRows.length,
    totalCents: eligibleRows.reduce((sum, item) => sum + Math.max(0, Number(item.allocation?.share_cents || 0)), 0),
    txnIds: eligibleRows.map((item) => Number(item.row.id || 0)).filter(Boolean)
  };
}

function filterPeopleComprasComigoIncomingItems(items, filters = {}) {
  const normalizedFilters = {
    q: normalizeSharedDebtSearchTerm(filters?.q || ''),
    status: String(filters?.status || 'all').trim().toLowerCase()
  };

  return (Array.isArray(items) ? items : []).filter((item) => {
    if (normalizedFilters.q) {
      const haystack = normalizeSharedDebtSearchTerm([
        item.description_snapshot,
        item.card_name_snapshot,
        item.requester_name,
        item.statusMeta?.label,
        item.displayMonthLabel,
        item.batch_display_label
      ].join(' '));
      if (!haystack.includes(normalizedFilters.q)) return false;
    }

    if (normalizedFilters.status !== 'all') {
      const key = String(item?.statusMeta?.key || item?.status || '').trim().toLowerCase();
      if (normalizedFilters.status === 'chargeable' || normalizedFilters.status === 'draft') return false;
      if (normalizedFilters.status === 'sent' && !['pending', 'accepted', 'accepted_partial', 'accepted_paid_marked', 'rejected_by_receiver', 'rejection_contested_by_sender'].includes(key)) return false;
      else if (normalizedFilters.status === 'done' && key !== 'settled') return false;
      else if (!['sent', 'done'].includes(normalizedFilters.status) && key !== normalizedFilters.status) return false;
    }

    return true;
  });
}

function buildPeopleComprasComigoOutgoingRows(userId, personId, month, year, filters = {}) {
  const safeUserId = Number(userId || 0);
  const safePersonId = Number(personId || 0);
  const safeMonth = Number(month || 0);
  const safeYear = Number(year || 0);
  if (!safeUserId || !safePersonId || !safeMonth || !safeYear) return [];

  const contact = getPeopleComprasComigoContact(safeUserId, safePersonId);
  const hasFriendship = !!(contact?.friendship_active && Number(contact?.linked_user_id || 0));
  const rawRows = db.prepare(`
    SELECT
      a.id AS allocation_id,
      a.share_cents,
      a.person_id,
      t.id,
      t.txn_date,
      t.description,
      t.amount_cents,
      t.card_number,
      t.card_id,
      t.parent_txn_id,
      t.recurring_rule_id,
      COALESCE(t.due_month, i.month) AS month,
      COALESCE(t.due_year, i.year) AS year,
      c.name AS card_name,
      pc.name AS category_name
    FROM allocations a
    JOIN transactions t ON t.id = a.transaction_id AND t.user_id = a.user_id
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    LEFT JOIN cards c ON c.id = t.card_id AND c.user_id = t.user_id
    LEFT JOIN purchase_categories pc ON pc.id = t.purchase_category_id AND pc.user_id = t.user_id
    WHERE a.user_id = ?
      AND a.person_id = ?
      AND COALESCE(t.due_month, i.month) = ?
      AND COALESCE(t.due_year, i.year) = ?
    ORDER BY COALESCE(t.txn_date, t.created_at, '') ASC, t.id ASC
  `).all(safeUserId, safePersonId, safeMonth, safeYear);

  const normalizedFilters = {
    q: normalizeSharedDebtSearchTerm(filters?.q || ''),
    status: String(filters?.status || 'all').trim().toLowerCase()
  };

  return rawRows.map((row) => {
    const draftItem = getPeopleComprasComigoDraftQueueItem(safeUserId, row.id, safePersonId);
    const latestRequest = getPeopleComprasComigoLatestRequestForOutgoing(safeUserId, row.id, safePersonId);
    const shareCents = Number(row.share_cents || 0);
    let eligible = true;
    let reason = '';
    if (shareCents <= 0) {
      eligible = false;
      reason = 'Valor não elegível';
    } else if (!hasFriendship) {
      eligible = false;
      reason = 'Amizade inativa';
    }

    const statusMeta = getPeopleComprasComigoOutgoingStatusMeta({ draftItem, request: latestRequest, eligible, reason });
    const txnScopeRow = {
      id: Number(row.id || 0),
      import_id: null,
      description: row.description,
      amount_cents: Number(row.amount_cents || 0),
      card_id: Number(row.card_id || 0) || null,
      recurring_rule_id: Number(row.recurring_rule_id || 0) || null,
      parent_txn_id: Number(row.parent_txn_id || 0) || null,
      purchase_category_id: null,
      month: Number(row.month || 0),
      year: Number(row.year || 0)
    };
    const futurePreview = getPeopleComprasComigoFutureChargePreview(safeUserId, txnScopeRow, safePersonId);
    const dateLabel = row.txn_date ? formatDateBR(row.txn_date) : monthLabel(row.month, row.year);
    const cardNumberLabel = String(row.card_number || '').trim() || '-';

    return {
      id: `txn-person:${Number(row.id || 0)}:${safePersonId}`,
      transactionId: Number(row.id || 0),
      allocationId: Number(row.allocation_id || 0),
      personId: safePersonId,
      receiverUserId: Number(contact?.linked_user_id || 0) || null,
      date: row.txn_date || null,
      dateLabel,
      month: Number(row.month || 0),
      year: Number(row.year || 0),
      description: row.description || 'Compra sem descrição',
      categoryName: row.category_name || 'Sem categoria',
      cardName: row.card_name || 'Cartão',
      cardNumberLabel,
      shareCents,
      shareFormatted: formatBRLFromCents(shareCents),
      statusMeta,
      canCreateCharge: !!statusMeta.canCreateCharge,
      hasFutureEligibleInstallments: Number(futurePreview.count || 0) > 0,
      futureEligibleCount: Number(futurePreview.count || 0),
      futureEligibleTotalCents: Number(futurePreview.totalCents || 0),
      futureEligibleTotalFormatted: formatBRLFromCents(Number(futurePreview.totalCents || 0)),
      actionHref: statusMeta.actionHref,
      latestRequestId: Number(latestRequest?.id || 0) || null,
      draftQueueId: Number(draftItem?.queue_id || 0) || null,
      sortStamp: row.txn_date ? dayjs(row.txn_date).valueOf() : ((Number(row.year || 0) * 100 + Number(row.month || 0)) || 0)
    };
  }).filter((row) => {
    if (normalizedFilters.q) {
      const haystack = normalizeSharedDebtSearchTerm([
        row.description,
        row.categoryName,
        row.cardName,
        row.statusMeta?.label
      ].join(' '));
      if (!haystack.includes(normalizedFilters.q)) return false;
    }

    if (normalizedFilters.status !== 'all') {
      const key = String(row.statusMeta?.key || '').trim();
      if (normalizedFilters.status === 'chargeable' && !row.canCreateCharge) return false;
      else if (normalizedFilters.status === 'draft' && key !== 'draft') return false;
      else if (normalizedFilters.status === 'sent' && !['pending', 'accepted', 'accepted_paid_marked', 'rejected_by_receiver', 'rejection_contested_by_sender'].includes(key)) return false;
      else if (normalizedFilters.status === 'done' && key !== 'settled') return false;
      else if (!['chargeable', 'draft', 'sent', 'done'].includes(normalizedFilters.status) && key !== normalizedFilters.status) return false;
    }

    return true;
  });
}

function getPeopleComprasComigoOutgoingPeriodRanks(userId, personId) {
  const safeUserId = Number(userId || 0);
  const safePersonId = Number(personId || 0);
  if (!safeUserId || !safePersonId) return [];

  return db.prepare(`
    SELECT DISTINCT COALESCE(t.due_year, i.year) AS year, COALESCE(t.due_month, i.month) AS month
    FROM allocations a
    JOIN transactions t ON t.id = a.transaction_id AND t.user_id = a.user_id
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    WHERE a.user_id = ?
      AND a.person_id = ?
      AND COALESCE(t.due_month, i.month) IS NOT NULL
      AND COALESCE(t.due_year, i.year) IS NOT NULL
  `).all(safeUserId, safePersonId)
    .map((row) => (Number(row.year || 0) * 100) + Number(row.month || 0))
    .filter(Boolean);
}

function buildSharedDebtDraftQueueActionsForPersonTransaction(userId, personId, txnId) {
  const cleanTxnId = Number(txnId || 0);
  const cleanPersonId = Number(personId || 0);
  if (!cleanTxnId || !cleanPersonId) return { actions: [], reason: 'INVALID_INPUT' };

  const txn = getSharedDebtCardTransactionSnapshot(userId, cleanTxnId);
  if (!txn) return { actions: [], reason: 'TXN_NOT_FOUND' };
  if (!Number(txn.due_month || 0) || !Number(txn.due_year || 0)) return { actions: [], reason: 'NO_PERIOD' };

  const allocationRow = getSharedDebtEligibleAllocationRows(userId, cleanTxnId)
    .find((row) => Number(row.person_id || 0) === cleanPersonId && Number(row.share_cents || 0) > 0);
  if (!allocationRow) return { actions: [], reason: 'NOT_ELIGIBLE' };

  if (getPeopleComprasComigoDraftQueueItem(userId, cleanTxnId, cleanPersonId)) {
    return { actions: [], reason: 'DRAFT_EXISTS' };
  }

  const latestRequest = getPeopleComprasComigoLatestRequestForOutgoing(userId, cleanTxnId, cleanPersonId);
  if (latestRequest && !canRecreateSharedDebtDraftFromHistory(latestRequest)) {
    return { actions: [], reason: 'REQUEST_EXISTS' };
  }

  const receiverUserId = Number(allocationRow.receiver_user_id || 0);
  if (!receiverUserId) return { actions: [], reason: 'NO_RECEIVER' };

  return {
    reason: 'OK',
    actions: [{
      requesterUserId: Number(userId || 0),
      receiverUserId,
      sourceTransactionId: cleanTxnId,
      sourceAllocationId: Number(allocationRow.allocation_id || 0) || null,
      sourcePersonId: cleanPersonId,
      sourceDueMonth: Number(txn.due_month || 0),
      sourceDueYear: Number(txn.due_year || 0),
      sourceTxnDateSnapshot: txn.txn_date || null,
      cardId: Number(txn.card_id || 0) || null,
      cardNameSnapshot: txn.card_name || null,
      descriptionSnapshot: txn.description,
      amountCents: Number(allocationRow.share_cents || 0),
      receiverEmailSnapshot: normalizeEmail(allocationRow.person_email || allocationRow.receiver_user_email),
      receiverNameSnapshot: allocationRow.person_name || allocationRow.receiver_user_name || null,
      actionKind: 'create',
      targetRequestId: null,
      baselineStatusSnapshot: null
    }]
  };
}

function persistSharedDebtDraftQueueActions(userId, actions = []) {
  const cleanActions = (Array.isArray(actions) ? actions : [])
    .filter((action) => Number(action?.requesterUserId || 0) === Number(userId || 0))
    .filter((action) => Number(action?.receiverUserId || 0) && Number(action?.sourceTransactionId || 0) && Number(action?.sourcePersonId || 0))
    .filter((action) => Number(action?.sourceDueMonth || 0) && Number(action?.sourceDueYear || 0));

  if (!cleanActions.length) {
    return { queueCount: 0, itemCount: 0, totalCents: 0, createCount: 0, skippedCount: 0 };
  }

  const queueGroups = new Map();
  cleanActions.forEach((action) => {
    const key = `${Number(action.receiverUserId || 0)}:${Number(action.sourceDueYear || 0)}:${Number(action.sourceDueMonth || 0)}`;
    if (!queueGroups.has(key)) {
      queueGroups.set(key, {
        receiverUserId: Number(action.receiverUserId || 0),
        month: Number(action.sourceDueMonth || 0),
        year: Number(action.sourceDueYear || 0),
        receiverEmailSnapshot: action.receiverEmailSnapshot || null,
        receiverNameSnapshot: action.receiverNameSnapshot || null,
        items: []
      });
    }

    const group = queueGroups.get(key);
    if (!group.receiverEmailSnapshot && action.receiverEmailSnapshot) group.receiverEmailSnapshot = action.receiverEmailSnapshot;
    if (!group.receiverNameSnapshot && action.receiverNameSnapshot) group.receiverNameSnapshot = action.receiverNameSnapshot;
    group.items.push(action);
  });

  const upsertItem = db.prepare(`
    INSERT INTO shared_debt_send_queue_items (
      queue_id, requester_user_id, receiver_user_id, source_transaction_id,
      source_allocation_id, source_person_id, source_due_month, source_due_year,
      source_txn_date_snapshot, card_id, card_name_snapshot, description_snapshot,
      amount_cents, receiver_email_snapshot, receiver_name_snapshot, action_kind,
      target_request_id, baseline_status_snapshot, sent_request_id, cancelled_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
    ON CONFLICT(queue_id, source_transaction_id, source_person_id) DO UPDATE SET
      requester_user_id = excluded.requester_user_id,
      receiver_user_id = excluded.receiver_user_id,
      source_allocation_id = excluded.source_allocation_id,
      source_due_month = excluded.source_due_month,
      source_due_year = excluded.source_due_year,
      source_txn_date_snapshot = excluded.source_txn_date_snapshot,
      card_id = excluded.card_id,
      card_name_snapshot = excluded.card_name_snapshot,
      description_snapshot = excluded.description_snapshot,
      amount_cents = excluded.amount_cents,
      receiver_email_snapshot = excluded.receiver_email_snapshot,
      receiver_name_snapshot = excluded.receiver_name_snapshot,
      action_kind = excluded.action_kind,
      target_request_id = excluded.target_request_id,
      baseline_status_snapshot = excluded.baseline_status_snapshot,
      sent_request_id = NULL,
      cancelled_at = NULL,
      updated_at = excluded.updated_at
  `);

  const touchedQueueIds = new Set();
  db.transaction(() => {
    queueGroups.forEach((group) => {
      const existingQueue = getSharedDebtDraftQueueRow({
        requesterUserId: userId,
        receiverUserId: group.receiverUserId,
        month: group.month,
        year: group.year,
        requestKind: 'card'
      });

      const queueId = Number(existingQueue?.id || 0) || createSharedDebtSendQueue({
        requesterUserId: userId,
        receiverUserId: group.receiverUserId,
        month: group.month,
        year: group.year,
        requestKind: 'card',
        receiverEmailSnapshot: group.receiverEmailSnapshot,
        receiverNameSnapshot: group.receiverNameSnapshot
      });

      touchedQueueIds.add(queueId);
      group.items.forEach((item) => {
        const now = nowIso();
        upsertItem.run(
          queueId,
          item.requesterUserId,
          item.receiverUserId,
          item.sourceTransactionId,
          item.sourceAllocationId,
          item.sourcePersonId,
          item.sourceDueMonth,
          item.sourceDueYear,
          item.sourceTxnDateSnapshot,
          item.cardId,
          item.cardNameSnapshot,
          item.descriptionSnapshot,
          Math.max(0, Number(item.amountCents || 0)),
          item.receiverEmailSnapshot,
          item.receiverNameSnapshot,
          normalizeSharedDebtQueueActionKind(item.actionKind),
          item.targetRequestId || null,
          item.baselineStatusSnapshot || null,
          now,
          now
        );
      });
      refreshSharedDebtSendQueue(queueId);
    });
  })();

  return cleanActions.reduce((acc, action) => {
    acc.itemCount += 1;
    acc.totalCents += Math.max(0, Number(action.amountCents || 0));
    acc.createCount += normalizeSharedDebtQueueActionKind(action.actionKind) === 'create' ? 1 : 0;
    return acc;
  }, { queueCount: touchedQueueIds.size, itemCount: 0, totalCents: 0, createCount: 0, skippedCount: 0 });
}

function queueSharedDebtDraftsForPersonAllocations(userId, personId, txnIds = []) {
  const safeUserId = Number(userId || 0);
  const safePersonId = Number(personId || 0);
  const cleanTxnIds = Array.from(new Set((txnIds || []).map(Number).filter(Boolean)));
  if (!safeUserId || !safePersonId || !cleanTxnIds.length) {
    return { queueCount: 0, itemCount: 0, totalCents: 0, createCount: 0, skippedCount: 0, reasons: {} };
  }

  const actions = [];
  const reasons = {};
  cleanTxnIds.forEach((txnId) => {
    const result = buildSharedDebtDraftQueueActionsForPersonTransaction(safeUserId, safePersonId, txnId);
    if (result.actions && result.actions.length) {
      result.actions.forEach((action) => actions.push(action));
      return;
    }
    const reason = result.reason || 'SKIPPED';
    reasons[reason] = Number(reasons[reason] || 0) + 1;
  });

  const summary = persistSharedDebtDraftQueueActions(safeUserId, actions);
  return {
    ...summary,
    skippedCount: cleanTxnIds.length - Number(summary.itemCount || 0),
    reasons
  };
}

function createPeopleComprasComigoChargeDraft(userId, personId, transactionId, options = {}) {
  const safeUserId = Number(userId || 0);
  const safePersonId = Number(personId || 0);
  const safeTxnId = Number(transactionId || 0);
  if (!safeUserId || !safePersonId || !safeTxnId) {
    const error = new Error('Não consegui identificar essa compra para criar a cobrança.');
    error.code = 'INVALID_INPUT';
    throw error;
  }

  const contact = getPeopleComprasComigoContact(safeUserId, safePersonId);
  if (!contact) {
    const error = new Error('Não encontrei esse contato por aqui.');
    error.code = 'PERSON_NOT_FOUND';
    throw error;
  }

  if (!contact.friendship_active || !Number(contact.linked_user_id || 0)) {
    const error = new Error('Essa pessoa precisa estar conectada a você no app antes de receber uma cobrança.');
    error.code = 'FRIENDSHIP_REQUIRED';
    throw error;
  }

  const txnRow = getTransactionScopeRow(safeUserId, safeTxnId);
  if (!txnRow) {
    const error = new Error('Não encontrei esse lançamento na sua conta.');
    error.code = 'TXN_NOT_FOUND';
    throw error;
  }

  const expectedMonth = Number(options?.month || 0);
  const expectedYear = Number(options?.year || 0);
  if (expectedMonth && expectedYear && (Number(txnRow.month || 0) !== expectedMonth || Number(txnRow.year || 0) !== expectedYear)) {
    const error = new Error('Essa compra pertence a outra competência. Abra o mês correto para criar a cobrança.');
    error.code = 'TXN_PERIOD_MISMATCH';
    throw error;
  }

  const scope = String(options?.scope || 'single').trim().toLowerCase() === 'future' ? 'future' : 'single';
  const scopeRows = scope === 'future' ? collectScopedTxnRows(safeUserId, [txnRow], 'future') : [txnRow];
  const txnIds = scopeRows.map((row) => Number(row?.id || 0)).filter(Boolean);
  const summary = queueSharedDebtDraftsForPersonAllocations(safeUserId, safePersonId, txnIds);

  return {
    contact,
    scope,
    requestedCount: txnIds.length,
    ...summary
  };
}

function buildPeopleComprasComigoLedger(userId, personId, month, year, options = {}) {
  const safeUserId = Number(userId || 0);
  const safeMonth = Number(month || 0);
  const safeYear = Number(year || 0);
  if (!safeUserId || !safeMonth || !safeYear) {
    throw new Error('Competência inválida para abrir as compras com essa amizade.');
  }

  const contact = getPeopleComprasComigoContact(safeUserId, personId);
  if (!contact) {
    throw new Error('Não encontrei esse contato por aqui.');
  }

  if (!contact.friendship_active || !Number(contact.linked_user_id || 0)) {
    throw new Error('Essa amizade ainda não está pronta para abrir as compras por aqui.');
  }

  const archivedRequestIds = getSharedDebtArchivedRequestIdSet(safeUserId);
  const received = attachSharedDebtCardMonthlyMeta(
    attachSharedDebtPixMeta(getSharedDebtRequestsReceived(safeUserId), safeUserId)
  ).items.filter((item) => {
    const requestId = Number(item?.id || 0);
    return Number(item?.requester_user_id || 0) === Number(contact.linked_user_id || 0)
      && !archivedRequestIds.has(requestId);
  });

  const incomingOpenItems = filterPeopleComprasComigoIncomingItems(
    sortPeopleComprasComigoOpenItems(
      received
        .filter((item) => isSharedDebtRequestVisibleInPeopleComprasComigoMonth(item, safeMonth, safeYear, 'open'))
        .map((item) => decoratePeopleComprasComigoItem(item, { contactName: contact.name || contact.linked_user_name || 'essa amizade', viewedMonth: safeMonth, viewedYear: safeYear }))
    ),
    options?.filters || {}
  );

  const incomingHistoryItems = filterPeopleComprasComigoIncomingItems(
    sortPeopleComprasComigoHistoryItems(
      received
        .filter((item) => isSharedDebtRequestVisibleInPeopleComprasComigoMonth(item, safeMonth, safeYear, 'history'))
        .map((item) => decoratePeopleComprasComigoItem(item, { contactName: contact.name || contact.linked_user_name || 'essa amizade', viewedMonth: safeMonth, viewedYear: safeYear }))
    ),
    options?.filters || {}
  );

  const outgoingRows = buildPeopleComprasComigoOutgoingRows(safeUserId, Number(contact.id || personId || 0), safeMonth, safeYear, options?.filters || {});
  const outgoingPeriodRanks = getPeopleComprasComigoOutgoingPeriodRanks(safeUserId, Number(contact.id || personId || 0));
  const availableRanks = Array.from(new Set([
    ...getPeopleComprasComigoRelevantMonthRanks(received),
    ...outgoingPeriodRanks
  ])).filter(Boolean).sort((a, b) => b - a);

  const summary = {
    incomingOpenAmountCents: incomingOpenItems.reduce((sum, item) => {
      if (!['pending', 'accepted', 'accepted_partial', 'accepted_paid_marked'].includes(String(item?.statusMeta?.key || ''))) return sum;
      const amount = String(item?.statusMeta?.key || '') === 'accepted_paid_marked'
        ? Math.max(0, Number(item?.total_cents || 0))
        : Math.max(0, Number(item?.amount_pending_cents || item?.total_cents || 0));
      return sum + amount;
    }, 0),
    outgoingMarkedCents: outgoingRows.reduce((sum, item) => sum + Math.max(0, Number(item.shareCents || 0)), 0),
    chargeableCount: outgoingRows.filter((item) => item.canCreateCharge).length,
    outgoingDraftCount: outgoingRows.filter((item) => String(item?.statusMeta?.key || '') === 'draft').length,
    incomingNeedsMyActionCount: incomingOpenItems.filter((item) => item?.myActionNeeded).length,
    incomingWaitingOtherSideCount: incomingOpenItems.filter((item) => item?.waitingOtherSide).length,
    incomingOpenCount: incomingOpenItems.length,
    incomingHistoryCount: incomingHistoryItems.length,
    outgoingCount: outgoingRows.length
  };

  return {
    contact,
    outgoingRows,
    incomingOpenItems,
    incomingHistoryItems,
    openItems: incomingOpenItems,
    historyItems: incomingHistoryItems,
    availableRanks,
    summary
  };
}

function getPreferredPeopleComprasComigoMonth(userId, personId) {
  const contact = getPeopleComprasComigoContact(userId, personId);
  if (!contact || !contact.friendship_active || !Number(contact.linked_user_id || 0)) return null;

  const archivedRequestIds = getSharedDebtArchivedRequestIdSet(userId);
  const received = getSharedDebtRequestsReceived(userId).filter((item) => {
    const requestId = Number(item?.id || 0);
    return Number(item?.requester_user_id || 0) === Number(contact.linked_user_id || 0)
      && !archivedRequestIds.has(requestId);
  });
  const outgoingRanks = getPeopleComprasComigoOutgoingPeriodRanks(userId, personId);

  const today = dayjs();
  const current = { year: today.year(), month: today.month() + 1 };
  const currentRank = (current.year * 100) + current.month;
  const currentHasItems = received.some((item) => isSharedDebtRequestVisibleInPeopleComprasComigoMonth(item, current.month, current.year, 'open') || isSharedDebtRequestVisibleInPeopleComprasComigoMonth(item, current.month, current.year, 'history'))
    || outgoingRanks.includes(currentRank);
  if (currentHasItems || (!received.length && !outgoingRanks.length)) return current;

  const ranks = Array.from(new Set([...getPeopleComprasComigoRelevantMonthRanks(received), ...outgoingRanks])).filter(Boolean).sort((a, b) => b - a);
  const preferred = rankToMonthYear(ranks[0]);
  return preferred || current;
}

function normalizeSharedDebtSearchTerm(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
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
    origin: ['all', 'single', 'multiple', 'installment', 'mixed', 'manual', 'private'].includes(origin) ? origin : 'all',
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
  const promisedDateText = item?.promised_payment_date ? formatDateBR(item.promised_payment_date) : '';

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
    txnDateText,
    promisedDateText,
    'data combinada',
    'pagamento combinado'
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

registerSharedDebtsRoutes(app, {
  ensureAuthenticated,
  renderSharedDebtsPage,
  resolveSharedDebtViewPath,
  redirectBackOr,
  setFlash,
  db,
  canArchiveSharedDebtStatus,
  upsertSharedDebtArchiveState,
  nowIso,
  getPrivateDebtReminderRowForOwner,
  canArchivePrivateDebtStatus,
  parseSharedDebtRequestIds,
  formatCountLabel,
  sendSharedDebtDraftQueue,
  sendSharedDebtDraftQueuesBulk,
  discardSharedDebtDraftQueue,
  normalizeManualSharedDebtMode,
  sanitizePrivateDebtDescription,
  sanitizePrivateDebtNote,
  normalizePrivateDebtPromisedPaymentDate,
  centsFromPtBrMoney,
  getPrivateDebtReminderSelectablePeople,
  createPrivateDebtReminder,
  formatDateBR,
  getManualSharedDebtEligiblePeople,
  getOwnerPerson,
  getUserRecord,
  normalizeEmail,
  createSharedDebtBatch,
  addSharedDebtEvent,
  refreshSharedDebtBatch,
  resolveCatalogText,
  formatBRLFromCents,
  buildNoteSuffix,
  createNotification,
  PRIVATE_DEBT_STATUS_SETTLED,
  PRIVATE_DEBT_STATUS_OPEN,
  normalizePrivateDebtPaymentDate,
  normalizeSharedDebtOriginKind,
  touchSharedDebtBatch,
  normalizeSharedDebtRequestKind,
  getSharedDebtCardMonthlySettlementRowById,
  getSharedDebtCardMonthlySettlementSnapshotById,
  getUserPixProfile,
  buildSharedDebtCardMonthlyIntentPreview,
  monthLabel,
  coerceMoneyValueToCents,
  cancelSharedDebtGeneratedMonthlyIntents,
  buildSharedDebtCardMonthlyPixTxid,
  buildPixPayload,
  sanitizePixText,
  QRCode,
  buildSharedDebtCardMonthlyPixShareText,
  normalizeSharedDebtPaymentIntentStatus,
  buildSharedDebtCardMonthlyIntentResultSummary,
  buildSharedDebtPixTxid,
  buildManualSharedDebtPixShareText,
  getSharedDebtCardMonthlySettlementSnapshot,
  buildSharedDebtBulkPeriodLabel
});

registerNotificationsRoutes(app, {
  ensureAuthenticated,
  isPushConfigured,
  upsertPushSubscription,
  removePushSubscriptionForUser,
  markAllNotificationsAsRead,
  setFlash,
  redirectBackOr,
  clearReadNotifications,
  formatCountLabel,
  getNotificationForUser,
  markNotificationAsRead
});

function getOpenBalanceMonthsForPerson(userId, personId) {
  const totals = db.prepare(`
    SELECT
      COALESCE(${EFFECTIVE_DUE_MONTH_SQL}, 0) AS month,
      COALESCE(${EFFECTIVE_DUE_YEAR_SQL}, 0) AS year,
      COALESCE(SUM(a.share_cents), 0) AS total_cents
    FROM allocations a
    JOIN transactions t ON t.id = a.transaction_id AND t.user_id = a.user_id
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    WHERE a.user_id = ?
      AND a.person_id = ?
    GROUP BY COALESCE(${EFFECTIVE_DUE_YEAR_SQL}, 0), COALESCE(${EFFECTIVE_DUE_MONTH_SQL}, 0)
  `).all(userId, personId).filter((row) => Number(row.month || 0) > 0 && Number(row.year || 0) > 0);

  const manualMap = new Map(db.prepare(`
    SELECT month, year, paid_cents
    FROM person_payments
    WHERE user_id = ? AND person_id = ?
  `).all(userId, personId).map((row) => [`${row.year}-${row.month}`, Math.max(0, Number(row.paid_cents || 0))]));

  const autoMap = new Map(db.prepare(`
    SELECT s.month, s.year, COALESCE(SUM(a.allocated_cents), 0) AS total_cents
    FROM shared_debt_payment_allocations a
    JOIN shared_debt_payment_intents pi ON pi.id = a.intent_id
    JOIN shared_debt_monthly_settlements s ON s.id = a.settlement_id
    JOIN shared_debt_requests r ON r.id = a.request_id
    WHERE s.requester_user_id = ?
      AND r.source_person_id = ?
      AND pi.status = 'confirmed'
    GROUP BY s.year, s.month
  `).all(userId, personId).map((row) => [`${row.year}-${row.month}`, Math.max(0, Number(row.total_cents || 0))]));

  return totals
    .map((row) => {
      const key = `${row.year}-${row.month}`;
      const totalCents = Math.max(0, Number(row.total_cents || 0));
      const manualPaidCents = Math.max(0, Number(manualMap.get(key) || 0));
      const autoPaidCents = Math.max(0, Number(autoMap.get(key) || 0));
      const paidCents = Math.min(totalCents, manualPaidCents + autoPaidCents);
      return {
        month: Number(row.month || 0),
        year: Number(row.year || 0),
        totalCents,
        paidCents,
        openCents: Math.max(0, totalCents - paidCents)
      };
    })
    .filter((row) => row.openCents > 0);
}

function getContactDeletionBlockers(userId, personId) {
  const openBalanceMonths = getOpenBalanceMonthsForPerson(userId, personId);
  const hasDraftQueue = !!db.prepare(`
    SELECT 1
    FROM shared_debt_send_queue_items qi
    JOIN shared_debt_send_queues q ON q.id = qi.queue_id
    WHERE qi.requester_user_id = ?
      AND qi.source_person_id = ?
      AND COALESCE(q.status, 'draft') = 'draft'
      AND qi.cancelled_at IS NULL
    LIMIT 1
  `).get(userId, personId);

  const hasOpenRequests = !!db.prepare(`
    SELECT 1
    FROM shared_debt_requests
    WHERE requester_user_id = ?
      AND source_person_id = ?
      AND status NOT IN ('settled', 'rejected', 'cancelled')
    LIMIT 1
  `).get(userId, personId);

  const hasOpenPixIntent = !!db.prepare(`
    SELECT 1
    FROM shared_debt_payment_intents pi
    JOIN shared_debt_payment_allocations a ON a.intent_id = pi.id
    JOIN shared_debt_requests r ON r.id = a.request_id
    WHERE pi.requester_user_id = ?
      AND r.source_person_id = ?
      AND pi.status IN ('generated', 'reported')
    LIMIT 1
  `).get(userId, personId);

  return {
    openBalanceMonths,
    hasDraftQueue,
    hasOpenRequests,
    hasOpenPixIntent,
    hasBlockingIssue: openBalanceMonths.length > 0 || hasDraftQueue || hasOpenRequests || hasOpenPixIntent
  };
}

function getUserDeletionBlockers(targetUserId) {
  const hasOpenRequests = !!db.prepare(`
    SELECT 1
    FROM shared_debt_requests
    WHERE (requester_user_id = ? OR receiver_user_id = ?)
      AND status NOT IN ('settled', 'rejected', 'cancelled')
    LIMIT 1
  `).get(targetUserId, targetUserId);

  const hasOpenPixIntent = !!db.prepare(`
    SELECT 1
    FROM shared_debt_payment_intents
    WHERE (requester_user_id = ? OR receiver_user_id = ?)
      AND status IN ('generated', 'reported')
    LIMIT 1
  `).get(targetUserId, targetUserId);

  const hasDraftQueue = !!db.prepare(`
    SELECT 1
    FROM shared_debt_send_queues
    WHERE (requester_user_id = ? OR receiver_user_id = ?)
      AND COALESCE(status, 'draft') = 'draft'
    LIMIT 1
  `).get(targetUserId, targetUserId);

  return {
    hasOpenRequests,
    hasOpenPixIntent,
    hasDraftQueue,
    hasBlockingIssue: hasOpenRequests || hasOpenPixIntent || hasDraftQueue
  };
}

function archivePendingFriendRequestsBetweenUsers(userAId, userBId, status = 'archived_by_contact_delete') {
  const pair = getFriendPair(userAId, userBId);
  if (!pair) return;

  const now = nowIso();
  db.prepare(`
    UPDATE friend_requests
    SET status = ?, updated_at = ?, responded_at = COALESCE(responded_at, ?), resolved_at = COALESCE(resolved_at, ?)
    WHERE status = 'pending'
      AND (
        (requester_user_id = ? AND target_user_id = ?) OR
        (requester_user_id = ? AND target_user_id = ?)
      )
  `).run(String(status || 'archived_by_contact_delete'), now, now, now, pair.low, pair.high, pair.high, pair.low);
}

function archivePendingFriendRequestsForSourcePerson(ownerUserId, personId, status = 'archived_by_contact_delete') {
  const now = nowIso();
  db.prepare(`
    UPDATE friend_requests
    SET status = ?, updated_at = ?, responded_at = COALESCE(responded_at, ?), resolved_at = COALESCE(resolved_at, ?)
    WHERE requester_user_id = ?
      AND source_person_id = ?
      AND status = 'pending'
  `).run(String(status || 'archived_by_contact_delete'), now, now, now, ownerUserId, personId);
}

function archivePendingFriendRequestsForUser(targetUserId, status = 'archived_by_user_delete') {
  const now = nowIso();
  db.prepare(`
    UPDATE friend_requests
    SET status = ?, updated_at = ?, responded_at = COALESCE(responded_at, ?), resolved_at = COALESCE(resolved_at, ?)
    WHERE status = 'pending'
      AND (requester_user_id = ? OR target_user_id = ?)
  `).run(String(status || 'archived_by_user_delete'), now, now, now, targetUserId, targetUserId);
}

function endActiveFriendshipBetweenUsers(userAId, userBId, endedByUserId = userAId) {
  const friendship = getActiveFriendshipBetweenUsers(userAId, userBId);
  if (!friendship) return false;
  const now = nowIso();
  db.prepare(`
    UPDATE friendships
    SET status = 'ended', updated_at = ?, ended_at = ?, ended_by_user_id = ?
    WHERE id = ? AND status = 'active'
  `).run(now, now, Number(endedByUserId || 0) || null, friendship.id);
  return true;
}

function tombstonePersonRecord(userId, personId) {
  const deletedLabel = buildDeletedPersonLabel(personId);
  db.prepare(`
    UPDATE people
    SET active = 0,
        status = 'deleted',
        deleted_at = ?,
        deleted_label = ?,
        name = ?,
        phone = NULL,
        email = NULL,
        pix_enabled = 0,
        pix_key_type = NULL,
        pix_key_value = NULL,
        pix_city = NULL,
        pix_state = NULL,
        pix_label = NULL,
        pix_updated_at = NULL
    WHERE id = ? AND user_id = ?
  `).run(nowIso(), deletedLabel, deletedLabel, personId, userId);

  return deletedLabel;
}

function tombstoneUserRecord(targetUserId) {
  const deletedLabel = buildDeletedUserLabel(targetUserId);
  const deletedEmail = buildDeletedUserEmail(targetUserId);
  db.prepare(`
    UPDATE users
    SET status = 'deleted',
        deleted_at = ?,
        deleted_label = ?,
        name = ?,
        email = ?,
        google_id = NULL,
        role = 'user',
        can_import = 0
    WHERE id = ?
  `).run(nowIso(), deletedLabel, deletedLabel, deletedEmail, targetUserId);

  return deletedLabel;
}

function offboardContactFromActiveExperience(ownerUserId, personId) {
  const resolved = getResolvedAppUserForPerson(ownerUserId, personId);
  db.transaction(() => {
    if (resolved?.linked_user_id) {
      endActiveFriendshipBetweenUsers(ownerUserId, resolved.linked_user_id, ownerUserId);
      archivePendingFriendRequestsBetweenUsers(ownerUserId, resolved.linked_user_id, 'archived_by_contact_delete');
    }

    archivePendingFriendRequestsForSourcePerson(ownerUserId, personId, 'archived_by_contact_delete');
    detachPrivateDebtRemindersFromPerson(ownerUserId, personId);
    db.prepare(`DELETE FROM person_app_links WHERE owner_user_id = ? AND person_id = ?`).run(ownerUserId, personId);
    tombstonePersonRecord(ownerUserId, personId);
  })();
}

function offboardUserAccess(actorUserId, targetUserId) {
  db.transaction(() => {
    archivePendingFriendRequestsForUser(targetUserId, 'archived_by_user_delete');
    const now = nowIso();
    db.prepare(`
      UPDATE friendships
      SET status = 'ended', updated_at = ?, ended_at = ?, ended_by_user_id = ?
      WHERE status = 'active'
        AND (user_low_id = ? OR user_high_id = ?)
    `).run(now, now, Number(actorUserId || 0) || null, targetUserId, targetUserId);

    db.prepare(`DELETE FROM person_app_links WHERE owner_user_id = ? OR linked_user_id = ?`).run(targetUserId, targetUserId);
    db.prepare(`DELETE FROM push_subscriptions WHERE user_id = ?`).run(targetUserId);
    db.prepare(`DELETE FROM scheduled_push_logs WHERE user_id = ?`).run(targetUserId);
    db.prepare(`DELETE FROM notifications WHERE user_id = ?`).run(targetUserId);
    db.prepare(`DELETE FROM user_notification_preferences WHERE user_id = ?`).run(targetUserId);
    tombstoneUserRecord(targetUserId);
  })();
}

// People
app.post('/purchase-categories/:id/archive', ensureAuthenticated, (req, res) => {
  try {
    const category = setPurchaseCategoryActiveState(req.user.id, req.params.id, false);
    setFlash(req, 'success', `${category.name} saiu dos seletores, mas continua viva no histórico.`);
  } catch (error) {
    setFlash(req, 'error', error.message || 'Não consegui arquivar essa categoria agora.');
  }
  return res.redirect(redirectBackOr(req, '/month'));
});

app.post('/purchase-categories/:id/restore', ensureAuthenticated, (req, res) => {
  try {
    const category = setPurchaseCategoryActiveState(req.user.id, req.params.id, true);
    setFlash(req, 'success', `${category.name} voltou para os seletores.`);
  } catch (error) {
    setFlash(req, 'error', error.message || 'Não consegui reativar essa categoria agora.');
  }
  return res.redirect(redirectBackOr(req, '/month'));
});

function resolvePeopleSettingsRedirectTarget(req, fallback = '/people') {
  return sanitizeInternalRedirectTarget(req.body?.return_to || req.query?.return_to || '', fallback);
}

function buildPeoplePageViewModel(req) {
  const userId = req.user.id;
  ensureSelfPerson(userId, req.user?.name || req.user?.email, req.user?.email);
  const allPeople = getPeopleAll(userId).map((person) => decoratePersonPhoneForView(person, { fallbackCountry: DEFAULT_PHONE_COUNTRY }));
  const selfPerson = allPeople.find((person) => person && person.is_self) || null;
  if (selfPerson) {
    const currentUser = getUserRecord(userId, { includeDeleted: false }) || req.user || {};
    selfPerson.photo_url = getEffectiveProfilePhoto(currentUser);
    selfPerson.google_photo_url = normalizeProfilePhotoUrl(currentUser?.google_photo_url || '');
    selfPerson.profile_photo_url = normalizeProfilePhotoUrl(currentUser?.profile_photo_url || '');
    selfPerson.profile_photo_mode = normalizeProfilePhotoMode(currentUser?.profile_photo_mode || 'default');
    selfPerson.profile_signature_text = normalizeProfileSignatureText(currentUser?.profile_signature_text || selfPerson.profile_signature_text || '');
    selfPerson.profile_signature_vibe = normalizeProfileSignatureVibe(currentUser?.profile_signature_vibe || selfPerson.profile_signature_vibe || '');
    selfPerson.profile_signature_vibe_label = getProfileSignatureVibeMeta(selfPerson.profile_signature_vibe)?.label || null;
    selfPerson.has_profile_signature = !!(selfPerson.profile_signature_text || selfPerson.profile_signature_vibe);
  }
  const contacts = allPeople.filter((person) => person && !person.is_self);
  const comprasComigoBadgeMap = buildPeopleComprasComigoBadgeMap(userId, contacts);
  const contactsWithComprasComigoBadge = contacts.map((person) => {
    const badge = comprasComigoBadgeMap.get(Number(person.id || 0)) || {};
    return {
      ...person,
      compras_comigo_badge_count: Math.max(0, Number(badge.needsMyActionCount || 0)),
      compras_comigo_open_count: Math.max(0, Number(badge.openCount || 0)),
      compras_comigo_waiting_count: Math.max(0, Number(badge.waitingOtherSideCount || 0))
    };
  });
  const pendingFriendRequests = getPendingReceivedFriendRequests(userId);
  const highlightedFriendRequestId = Number(req.query.friendRequest || req.query.friend_request || 0) || null;

  return {
    selfPerson,
    contacts: contactsWithComprasComigoBadge,
    people: contactsWithComprasComigoBadge,
    pendingFriendRequests,
    highlightedFriendRequestId,
    pixStateOptions: PIX_STATE_OPTIONS,
    pixCitySuggestionsByState: PIX_CITY_SUGGESTIONS_BY_STATE,
    pixAllCitySuggestions: PIX_ALL_CITY_SUGGESTIONS,
    pixDefaultState: PIX_DEFAULT_STATE,
    pixDefaultCity: PIX_DEFAULT_CITY,
    phoneCountryOptions: buildPhoneCountryOptions(),
    phoneDefaultCountry: DEFAULT_PHONE_COUNTRY,
    profileSignatureVibeOptions: PROFILE_SIGNATURE_VIBE_OPTIONS,
    profileSignatureMaxLength: PROFILE_SIGNATURE_MAX_LENGTH,
    appPinSecurity: buildAppPinViewModel(getUserSecuritySettings(userId), { reauthFresh: hasFreshPinReauthSession(req, userId) }),
    appPasskeys: buildPasskeyManagementViewModel(req, userId),
    notificationPreferences: buildUserNotificationPreferenceViewModel(userId),
    automationWhatsapp: automationApiService.getWhatsappActivationViewModel(userId)
  };
}

registerPeopleRoutes(app, {
  ensureAuthenticated,
  profilePhotoUpload,
  safeRenderView,
  setFlash,
  db,
  buildPeoplePageViewModel,
  resolvePeopleSettingsRedirectTarget,
  removeManagedProfilePhoto,
  getUserRecord,
  looksLikeGoogleDefaultAvatar,
  getPreferredPeopleComprasComigoMonth,
  buildPeopleComprasComigoLedger,
  createPeopleComprasComigoChargeDraft,
  parseMonthYear,
  shiftMonth,
  dayjs,
  monthLabel,
  formatBRLFromCents,
  formatDateBR,
  USER_NOTIFICATION_PREFERENCE_KEYS,
  normalizeNotificationPreferenceToggle,
  upsertUserNotificationPreferences,
  DEFAULT_PHONE_COUNTRY,
  normalizePhoneForStorage,
  normalizeEmail,
  normalizePixToggle,
  normalizePixKeyType,
  normalizePixKeyValue,
  normalizePixState,
  guessPixStateByCity,
  findPersonByNameForUser,
  validatePixProfile,
  normalizeProfileSignatureText,
  normalizeProfileSignatureVibe,
  nowIso,
  isSelfPersonRow,
  getResolvedAppUserForPerson,
  getActiveFriendshipBetweenUsers,
  getPendingFriendRequestBetweenUsers,
  getPendingFriendRequestById,
  normalizeFriendRequestStatus,
  closeOtherPendingFriendRequestsBetweenUsers,
  upsertFriendship,
  upsertPersonAppLink,
  ensureFriendPersonForUser,
  getOwnerPerson,
  resolveCatalogText,
  createNotification,
  getContactDeletionBlockers,
  offboardContactFromActiveExperience,
  getFriendlyErrorMessage
});

// Cards
registerCardsRoutes(app, {
  ensureAuthenticated,
  safeRenderView,
  setFlash,
  db,
  getCards,
  normalizeDayNumber,
  normalizeCardBrand,
  findCardByNameForUser
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

function safeParseImportRawJson(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) {
    return { ...value };
  }
  try {
    const parsed = JSON.parse(String(value || '{}'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch (error) {
    return {};
  }
}

function normalizeImportInstallmentBaseDescription(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\s*[\-–—:;/,]+$/g, '')
    .trim();
}

function stripTrailingInstallmentMarker(description) {
  const safe = String(description || '').replace(/\s+/g, ' ').trim();
  if (!safe) return '';

  let base = safe
    .replace(/\s*(?:[\-–—:;/,]\s*)?\(?\d{1,2}\s*\/\s*\d{1,2}\)?\s*$/i, '')
    .replace(/\s*(?:[\-–—:;/,]\s*)?(?:parc(?:ela)?\s*)?\d{1,2}\s*(?:de|\/)\s*\d{1,2}\s*$/i, '')
    .replace(/\s*(?:[\-–—:;/,]\s*)?\d{1,2}\s+de\s+\d{1,2}\s*$/i, '')
    .replace(/\s*[()\-–—:;/,]+$/g, '')
    .trim();

  if (!base) {
    base = safe
      .replace(/\(?\d{1,2}\s*\/\s*\d{1,2}\)?/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  return normalizeImportInstallmentBaseDescription(base || safe) || safe;
}

function buildImportInstallmentMeta(position, total, baseDescription, extra = {}) {
  const normalizedPosition = Number(position || 0);
  const normalizedTotal = Number(total || 0);
  if (!Number.isInteger(normalizedPosition) || !Number.isInteger(normalizedTotal)) return null;
  if (normalizedPosition < 1 || normalizedTotal <= 1 || normalizedPosition > normalizedTotal || normalizedTotal > 240) return null;
  const cleanBaseDescription = normalizeImportInstallmentBaseDescription(baseDescription) || '(sem descricao)';
  return {
    detected: true,
    position: normalizedPosition,
    total: normalizedTotal,
    label: `${normalizedPosition}/${normalizedTotal}`,
    baseDescription: cleanBaseDescription,
    normalizedBaseDescription: normalizeImportDuplicateText(cleanBaseDescription),
    ...extra
  };
}

function getImportInstallmentMetaFromRaw(rawLike) {
  const raw = safeParseImportRawJson(rawLike);
  const rawConflictReason = String(raw?.import_installment_conflict?.reason || '').trim() || null;
  const candidates = [raw.import_installment, raw.installment, raw.importInstallment].filter((candidate) => candidate && typeof candidate === 'object');
  for (const candidate of candidates) {
    const normalizedConfidence = String(candidate.confidence || '').trim().toLowerCase();
    const meta = buildImportInstallmentMeta(
      candidate.position ?? candidate.current_position ?? candidate.installment_position,
      candidate.total ?? candidate.installment_total,
      candidate.base_description ?? candidate.baseDescription ?? candidate.description_base,
      {
        source: candidate.source || 'raw',
        confidence: ['high', 'medium', 'low'].includes(normalizedConfidence) ? normalizedConfidence : null,
        patternKind: String(candidate.pattern_kind || candidate.patternKind || '').trim() || null,
        validator: String(candidate.validator || '').trim() || null,
        conflictReason: String(candidate.conflict_reason || candidate.conflictReason || rawConflictReason || '').trim() || null,
        fromRaw: true
      }
    );
    if (meta) return meta;
  }
  return null;
}

function detectImportInstallmentMetaFromDescription(description, amountCents = 0) {
  if (Number(amountCents || 0) <= 0) return null;
  const safe = String(description || '').replace(/\s+/g, ' ').trim();
  if (!safe) return null;

  const patterns = [
    /(?:^|\s|\()(\d{1,2})\s*\/\s*(\d{1,2})(?:\))?\s*$/i,
    /\bparc(?:ela)?\s*(\d{1,2})\s*(?:de|\/)\s*(\d{1,2})\s*$/i,
    /\b(\d{1,2})\s+de\s+(\d{1,2})\s*$/i
  ];

  for (const pattern of patterns) {
    const match = safe.match(pattern);
    if (!match) continue;
    const meta = buildImportInstallmentMeta(match[1], match[2], stripTrailingInstallmentMarker(safe), {
      source: 'description',
      fromRaw: false
    });
    if (meta) return meta;
  }

  return null;
}

function resolveImportInstallmentMeta({ raw = null, rawJson = null, description = '', amountCents = 0 } = {}) {
  return getImportInstallmentMetaFromRaw(rawJson || raw)
    || detectImportInstallmentMetaFromDescription(description, amountCents)
    || null;
}

function buildImportInstallmentRawPayload(rawLike, installmentMeta, extra = {}) {
  const raw = safeParseImportRawJson(rawLike);
  if (!installmentMeta) return raw;
  const { conflictReason: extraConflictReason = null, ...safeExtra } = extra || {};
  const normalizedConfidence = String(installmentMeta.confidence || '').trim().toLowerCase();
  raw.import_installment = {
    detected: true,
    position: Number(installmentMeta.position || 0) || 1,
    total: Number(installmentMeta.total || 0) || 1,
    label: installmentMeta.label || `${Number(installmentMeta.position || 0) || 1}/${Number(installmentMeta.total || 0) || 1}`,
    base_description: installmentMeta.baseDescription || '(sem descricao)',
    source: installmentMeta.source || 'statement_import',
    ...(normalizedConfidence && ['high', 'medium', 'low'].includes(normalizedConfidence) ? { confidence: normalizedConfidence } : {}),
    ...(String(installmentMeta.patternKind || '').trim() ? { pattern_kind: String(installmentMeta.patternKind).trim() } : {}),
    ...(String(installmentMeta.validator || '').trim() ? { validator: String(installmentMeta.validator).trim() } : {}),
    ...safeExtra
  };
  const conflictReason = String(extraConflictReason || installmentMeta.conflictReason || raw?.import_installment_conflict?.reason || '').trim() || null;
  if (conflictReason) {
    raw.import_installment_conflict = {
      ...(raw.import_installment_conflict && typeof raw.import_installment_conflict === 'object' ? raw.import_installment_conflict : {}),
      reason: conflictReason
    };
  }
  return raw;
}

function buildImportInstallmentDueKey(month, year) {
  return `${String(year || '').trim()}-${String(month || '').trim()}`;
}

function buildImportInstallmentSchedule(month, year, installmentMeta) {
  const meta = installmentMeta && typeof installmentMeta === 'object'
    ? installmentMeta
    : resolveImportInstallmentMeta({ description: '', amountCents: 1, raw: installmentMeta });
  if (!meta) return [];

  const schedule = [];
  const futureCount = Math.max(0, Number(meta.total || 0) - Number(meta.position || 0));
  for (let offset = 0; offset <= futureCount; offset += 1) {
    const due = shiftMonth(year, month, offset);
    schedule.push({
      offset,
      position: Number(meta.position || 1) + offset,
      total: Number(meta.total || 1),
      dueMonth: due.month,
      dueYear: due.year,
      dueKey: buildImportInstallmentDueKey(due.month, due.year)
    });
  }

  return schedule;
}

function matchImportInstallmentExistingRowToItem(row, item) {
  if (!row || !item) return false;
  const itemMeta = item.installment || resolveImportInstallmentMeta({ raw: item.raw, description: item.description, amountCents: item.amountCents });
  if (!itemMeta) return false;
  if (Number(row.amountCents || 0) !== Number(item.amountCents || 0)) return false;

  const rowMeta = row.installment || resolveImportInstallmentMeta({ raw: row.raw, description: row.description, amountCents: row.amountCents });
  const rowBase = normalizeImportDuplicateText((rowMeta && rowMeta.baseDescription) || stripTrailingInstallmentMarker(row.description));
  if (rowBase !== normalizeImportDuplicateText(itemMeta.baseDescription)) return false;

  const itemCard = normalizeImportCardNumber(item.cardNumber);
  const rowCard = normalizeImportCardNumber(row.cardNumber);
  if (itemCard && rowCard && itemCard !== rowCard) return false;

  return true;
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

function formatImportPreviewDateLabel(value) {
  const safeValue = String(value || '').trim();
  if (!safeValue) return 'Sem data';
  if (/^\d{4}-\d{2}-\d{2}$/.test(safeValue)) return formatDateBR(safeValue);
  return safeValue;
}

function buildImportDayAmountKey({ txnDate, amountCents }) {
  return [String(txnDate || '').trim(), Number(amountCents) || 0].join('::');
}

function formatImportPreviewCardNumberLabel(cardNumber) {
  const normalized = normalizeImportCardNumber(cardNumber).replace(/\D/g, '');
  if (!normalized) return 'Final nao informado';
  if (normalized.length <= 4) return `Final ${normalized}`;
  return `Final ${normalized.slice(-4)}`;
}

function compareImportPreviewItems(a, b) {
  const dateA = String(a?.isoDate || '');
  const dateB = String(b?.isoDate || '');
  if (dateA !== dateB) return dateA.localeCompare(dateB);

  const amountA = Number(a?.amountCents || 0);
  const amountB = Number(b?.amountCents || 0);
  if (amountA !== amountB) return amountB - amountA;

  const descA = normalizeImportDuplicateText(a?.description);
  const descB = normalizeImportDuplicateText(b?.description);
  if (descA !== descB) return descA.localeCompare(descB, 'pt-BR');

  return Number(a?.sourceIndex || 0) - Number(b?.sourceIndex || 0);
}

function buildImportPreviewItem(txn, sourceIndex) {
  const isoDate = toISOFromBRDate(txn.txn_date) || String(txn.txn_date || '').trim() || null;
  const description = String(txn.description || '').trim() || '(sem descricao)';
  const amountCents = Number(txn.amount_cents) || 0;
  const cardNumber = normalizeImportCardNumber(txn.card_number) || null;
  const installment = resolveImportInstallmentMeta({
    raw: txn.raw,
    description,
    amountCents
  });
  const raw = buildImportInstallmentRawPayload(txn.raw || {}, installment, {
    source: installment?.source || 'statement_import'
  });

  return {
    id: `item_${sourceIndex + 1}`,
    sourceIndex: Number(sourceIndex) || 0,
    isoDate,
    dateLabel: formatImportPreviewDateLabel(isoDate || txn.txn_date),
    description,
    baseDescription: (installment && installment.baseDescription) || description,
    amountCents,
    amountLabel: formatBRLFromCents(amountCents),
    cardNumber,
    cardNumberLabel: formatImportPreviewCardNumberLabel(cardNumber),
    raw,
    installment,
    installmentLabel: installment ? `${String(installment.position).padStart(2, '0')}/${String(installment.total).padStart(2, '0')}` : null,
    projectedImportAffectedCount: 1,
    projectedImportNewTransactionCount: 1,
    projectedOverwriteAffectedCount: 1,
    projectedOverwriteNewTransactionCount: 0,
    installmentImpact: null
  };
}

function buildImportExistingMatchVersion(row) {
  return JSON.stringify({
    id: Number(row?.id || 0) || null,
    importId: Number(row?.importId || row?.import_id || 0) || null,
    cardId: Number(row?.cardId || row?.card_id || 0) || null,
    month: Number(row?.month || 0) || null,
    year: Number(row?.year || 0) || null,
    txnDate: String(row?.txnDate || row?.txn_date || '').trim() || null,
    description: String(row?.description || '').trim() || null,
    amountCents: Number(row?.amountCents ?? row?.amount_cents ?? 0) || 0,
    cardNumber: normalizeImportCardNumber(row?.cardNumber || row?.card_number) || null,
    parentTxnId: Number(row?.parentTxnId || row?.parent_txn_id || 0) || null,
    recurringRuleId: Number(row?.recurringRuleId || row?.recurring_rule_id || 0) || null
  });
}

function buildImportSharedDebtSummary({ requestCount = 0, draftCount = 0 } = {}) {
  const safeRequestCount = Math.max(0, Number(requestCount || 0));
  const safeDraftCount = Math.max(0, Number(draftCount || 0));
  if (!safeRequestCount && !safeDraftCount) return null;
  const parts = [];
  if (safeRequestCount > 0) {
    parts.push(formatCountLabel(safeRequestCount, 'cobranca vinculada', 'cobrancas vinculadas'));
  }
  if (safeDraftCount > 0) {
    parts.push(formatCountLabel(safeDraftCount, 'rascunho de envio', 'rascunhos de envio'));
  }
  return parts.join(' · ');
}

function compareImportExistingMatches(a, b) {
  const rank = (row) => {
    if (row?.overwriteEligible) return 0;
    if (row?.isManual) return 1;
    return 2;
  };

  const rankDiff = rank(a) - rank(b);
  if (rankDiff !== 0) return rankDiff;

  const exactTextA = normalizeImportDuplicateText(a?.description);
  const exactTextB = normalizeImportDuplicateText(b?.description);
  if (exactTextA !== exactTextB) return exactTextA.localeCompare(exactTextB, 'pt-BR');

  const dateA = String(a?.txnDate || '');
  const dateB = String(b?.txnDate || '');
  if (dateA !== dateB) return dateA.localeCompare(dateB);

  const amountA = Number(a?.amountCents || 0);
  const amountB = Number(b?.amountCents || 0);
  if (amountA !== amountB) return amountB - amountA;

  return Number(a?.id || 0) - Number(b?.id || 0);
}

function mapImportExistingRow(userId, row) {
  const importId = Number(row.import_id || 0) || null;
  const monthNumber = Number(row.month || 0) || null;
  const yearNumber = Number(row.year || 0) || null;
  const isManual = !importId;
  const isClosedMonth = Boolean(monthNumber && yearNumber && isMonthClosed(userId, monthNumber, yearNumber));
  const allocationCount = Math.max(0, Number(row.allocation_count || 0));
  const sharedDebtRequestCount = Math.max(0, Number(row.shared_debt_request_count || 0));
  const sharedDebtQueueCount = Math.max(0, Number(row.shared_debt_queue_count || 0));
  const raw = safeParseImportRawJson(row.raw_json);
  const installment = resolveImportInstallmentMeta({
    raw,
    description: row.description,
    amountCents: row.amount_cents
  });
  const hasInstallmentChain = Number(row.parent_txn_id || 0) > 0 || Number(row.has_child_installments || 0) > 0;

  const mapped = {
    id: Number(row.id),
    importId,
    cardId: Number(row.card_id || 0) || null,
    month: monthNumber,
    year: yearNumber,
    txnDate: String(row.txn_date || '').trim() || null,
    dateLabel: formatImportPreviewDateLabel(row.txn_date),
    description: String(row.description || '').trim() || '(sem descricao)',
    amountCents: Number(row.amount_cents) || 0,
    amountLabel: formatBRLFromCents(Number(row.amount_cents) || 0),
    cardNumber: normalizeImportCardNumber(row.card_number) || null,
    cardNumberLabel: formatImportPreviewCardNumberLabel(row.card_number),
    originLabel: importId ? 'Ja importada' : 'Lancada manualmente',
    isManual,
    isImported: !!importId,
    overwriteEligible: Boolean(isManual && !isClosedMonth),
    isClosedMonth,
    overwriteUnavailableReason: importId
      ? 'Essa coincidencia ja veio de importacao e fica so como referencia.'
      : (isClosedMonth ? getMonthLockMessage(monthNumber, yearNumber) : null),
    purchaseCategoryId: Number(row.purchase_category_id || 0) || null,
    purchaseCategoryName: String(row.purchase_category_name || '').trim() || null,
    allocationCount,
    hasInstallmentChain,
    hasRecurringRule: Number(row.recurring_rule_id || 0) > 0,
    parentTxnId: Number(row.parent_txn_id || 0) || null,
    recurringRuleId: Number(row.recurring_rule_id || 0) || null,
    sharedDebtRequestCount,
    sharedDebtQueueCount,
    sharedDebtSummary: buildImportSharedDebtSummary({
      requestCount: sharedDebtRequestCount,
      draftCount: sharedDebtQueueCount
    }),
    raw,
    installment,
    normalizedBaseDescription: normalizeImportDuplicateText((installment && installment.baseDescription) || stripTrailingInstallmentMarker(row.description))
  };

  mapped.overwriteBadgeLabel = mapped.overwriteEligible
    ? 'Manual · elegivel'
    : (mapped.isManual ? 'Manual travado' : 'Ja importada');
  mapped.version = buildImportExistingMatchVersion(mapped);
  return mapped;
}

function getExistingImportRowsForCardDueRange(userId, cardId, startMonth, startYear, endMonth, endYear) {
  const rows = db.prepare(`
    SELECT t.id, t.import_id, t.card_id, t.txn_date, t.description, t.amount_cents, t.card_number, t.raw_json,
           t.purchase_category_id, t.parent_txn_id, t.recurring_rule_id,
           COALESCE(t.due_month, i.month) AS month,
           COALESCE(t.due_year, i.year) AS year,
           pc.name AS purchase_category_name,
           (
             SELECT COUNT(*)
             FROM allocations a
             WHERE a.user_id = t.user_id
               AND a.transaction_id = t.id
           ) AS allocation_count,
           EXISTS(
             SELECT 1
             FROM transactions tx_child
             WHERE tx_child.user_id = t.user_id
               AND tx_child.parent_txn_id = t.id
             LIMIT 1
           ) AS has_child_installments,
           (
             SELECT COUNT(*)
             FROM shared_debt_requests r
             WHERE r.requester_user_id = t.user_id
               AND r.source_transaction_id = t.id
           ) AS shared_debt_request_count,
           (
             SELECT COUNT(*)
             FROM shared_debt_send_queue_items q
             WHERE q.requester_user_id = t.user_id
               AND q.source_transaction_id = t.id
           ) AS shared_debt_queue_count
    FROM transactions t
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    LEFT JOIN purchase_categories pc ON pc.id = t.purchase_category_id AND pc.user_id = t.user_id
    WHERE t.user_id = ?
      AND t.card_id = ?
      AND (
        COALESCE(t.due_year, i.year) > ? OR
        (COALESCE(t.due_year, i.year) = ? AND COALESCE(t.due_month, i.month) >= ?)
      )
      AND (
        COALESCE(t.due_year, i.year) < ? OR
        (COALESCE(t.due_year, i.year) = ? AND COALESCE(t.due_month, i.month) <= ?)
      )
    ORDER BY COALESCE(t.due_year, i.year) ASC, COALESCE(t.due_month, i.month) ASC, t.txn_date IS NULL ASC, t.txn_date ASC, t.amount_cents DESC, t.id ASC
  `).all(userId, cardId, startYear, startYear, startMonth, endYear, endYear, endMonth);

  return rows.map((row) => mapImportExistingRow(userId, row)).sort(compareImportExistingMatches);
}

function getExistingImportMonthRows(userId, cardId, month, year) {
  return getExistingImportRowsForCardDueRange(userId, cardId, month, year, month, year);
}

function countExactExistingMatchesForImportItem(item, matches, cardId, month, year) {
  if (!Array.isArray(matches) || !matches.length) return 0;

  const fingerprint = buildImportDuplicateFingerprint({
    cardId,
    month,
    year,
    txnDate: item.isoDate,
    description: item.description,
    amountCents: item.amountCents,
    cardNumber: item.cardNumber
  });

  return matches.reduce((total, row) => {
    const candidateFingerprint = buildImportDuplicateFingerprint({
      cardId,
      month,
      year,
      txnDate: row.txnDate,
      description: row.description,
      amountCents: row.amountCents,
      cardNumber: row.cardNumber
    });
    return total + (candidateFingerprint === fingerprint ? 1 : 0);
  }, 0);
}


function buildImportInstallmentPreviewImpact({ item, relatedRows = [], previewMonth, previewYear } = {}) {
  const installment = item?.installment || resolveImportInstallmentMeta({ raw: item?.raw, description: item?.description, amountCents: item?.amountCents });
  if (!installment) return null;

  const schedule = buildImportInstallmentSchedule(previewMonth, previewYear, installment);
  const futureSchedule = schedule.slice(1);
  const impactBase = {
    label: `${String(installment.position).padStart(2, '0')}/${String(installment.total).padStart(2, '0')}`,
    futureCreateCount: 0,
    futureExistingCount: 0,
    hasConflict: false,
    conflictReason: null,
    projectedImportAffectedCount: 1,
    projectedOverwriteAffectedCount: 1,
    projectedOverwriteNewTransactionCount: 0,
    projectedImportNewTransactionCount: 1
  };
  if (installment.conflictReason) {
    return {
      ...impactBase,
      hasConflict: true,
      conflictReason: installment.conflictReason
    };
  }
  if (!futureSchedule.length) return impactBase;

  const scheduleKeys = new Set(futureSchedule.map((entry) => entry.dueKey));
  const matchingRows = (Array.isArray(relatedRows) ? relatedRows : [])
    .filter((row) => scheduleKeys.has(buildImportInstallmentDueKey(row.month, row.year)))
    .filter((row) => matchImportInstallmentExistingRowToItem(row, item));

  const rootGroups = new Map();
  const dueGroups = new Map();
  const mismatchedTotals = new Set();

  matchingRows.forEach((row) => {
    const rootKey = Number(row.parentTxnId || row.id || 0) || Number(row.id || 0);
    if (!rootGroups.has(rootKey)) rootGroups.set(rootKey, []);
    rootGroups.get(rootKey).push(row);

    const dueKey = buildImportInstallmentDueKey(row.month, row.year);
    if (!dueGroups.has(dueKey)) dueGroups.set(dueKey, []);
    dueGroups.get(dueKey).push(row);

    const rowInstallment = row.installment || null;
    if (rowInstallment && Number(rowInstallment.total || 0) > 1 && Number(rowInstallment.total || 0) !== Number(installment.total || 0)) {
      mismatchedTotals.add(Number(rowInstallment.total || 0));
    }
  });

  let conflictReason = null;
  if (mismatchedTotals.size > 0) {
    conflictReason = 'O app encontrou parcelas parecidas com total diferente.';
  } else if (rootGroups.size > 1) {
    conflictReason = 'O app encontrou mais de uma cadeia parecida nas próximas faturas.';
  } else if (Array.from(dueGroups.values()).some((rows) => rows.length > 1)) {
    conflictReason = 'Mais de uma parcela parecida apareceu no mesmo mês futuro.';
  }

  const futureExistingCount = futureSchedule.reduce((sum, entry) => sum + (dueGroups.has(entry.dueKey) ? 1 : 0), 0);
  const futureCreateCount = conflictReason ? 0 : futureSchedule.reduce((sum, entry) => sum + (dueGroups.has(entry.dueKey) ? 0 : 1), 0);

  return {
    ...impactBase,
    futureCreateCount,
    futureExistingCount,
    hasConflict: !!conflictReason,
    conflictReason,
    matchedChainRootId: rootGroups.size === 1 ? Array.from(rootGroups.keys())[0] : null,
    projectedImportAffectedCount: 1 + futureCreateCount,
    projectedOverwriteAffectedCount: 1 + futureCreateCount,
    projectedOverwriteNewTransactionCount: futureCreateCount,
    projectedImportNewTransactionCount: 1 + futureCreateCount
  };
}

function buildImportPreviewSummary({ parsedCount, parsedTotalCents, existingCount, existingTotalCents, autoCount, autoTotalCents, autoAffectedCount = 0, appDuplicateCandidates, csvDuplicateGroups }) {
  const appDuplicateCount = appDuplicateCandidates.length;
  const appDuplicateTotalCents = appDuplicateCandidates.reduce((sum, candidate) => sum + Number(candidate.amountCents || 0), 0);
  const csvDuplicateGroupCount = csvDuplicateGroups.length;
  const csvDuplicateLineCount = csvDuplicateGroups.reduce((sum, group) => sum + Number(group.occurrenceCount || 0), 0);
  const csvDuplicateTotalCents = csvDuplicateGroups.reduce((sum, group) => sum + Number(group.groupTotalCents || 0), 0);
  const defaultCsvCount = csvDuplicateGroups.reduce((sum, group) => sum + Number(group.defaultKeepCount || 0), 0);
  const defaultCsvAffectedCount = csvDuplicateGroups.reduce((sum, group) => sum + Number(group.defaultAffectedCount || 0), 0);
  const defaultCsvTotalCents = csvDuplicateGroups.reduce((sum, group) => sum + (Number(group.amountCents || 0) * Number(group.defaultKeepCount || 0)), 0);
  const defaultFinalCount = autoCount + defaultCsvCount;
  const defaultFinalAffectedCount = autoAffectedCount + defaultCsvAffectedCount;
  const defaultFinalTotalCents = autoTotalCents + defaultCsvTotalCents;
  const projectedCardCount = existingCount + defaultFinalCount;
  const projectedCardTotalCents = existingTotalCents + defaultFinalTotalCents;

  return {
    parsedCount,
    parsedTotalCents,
    parsedTotalLabel: formatBRLFromCents(parsedTotalCents),
    existingCount,
    existingTotalCents,
    existingTotalLabel: formatBRLFromCents(existingTotalCents),
    autoCount,
    autoTotalCents,
    autoTotalLabel: formatBRLFromCents(autoTotalCents),
    appDuplicateCount,
    appDuplicateTotalCents,
    appDuplicateTotalLabel: formatBRLFromCents(appDuplicateTotalCents),
    csvDuplicateGroupCount,
    csvDuplicateLineCount,
    csvDuplicateTotalCents,
    csvDuplicateTotalLabel: formatBRLFromCents(csvDuplicateTotalCents),
    defaultFinalCount,
    defaultNewImportCount: defaultFinalCount,
    defaultOverwriteCount: 0,
    defaultFinalAffectedCount,
    defaultFinalTotalCents,
    defaultFinalTotalLabel: formatBRLFromCents(defaultFinalTotalCents),
    projectedCardCount,
    projectedCardTotalCents,
    projectedCardTotalLabel: formatBRLFromCents(projectedCardTotalCents)
  };
}

function buildImportPreviewData({ userId, cardId, cardName, month, year, originalFilename, txns }) {
  const items = txns.map((txn, index) => buildImportPreviewItem(txn, index));
  const itemMap = new Map(items.map((item) => [item.id, item]));
  const existingRows = getExistingImportMonthRows(userId, cardId, month, year);
  const maxFutureOffset = items.reduce((maxOffset, item) => {
    const installment = item.installment || null;
    if (!installment) return maxOffset;
    return Math.max(maxOffset, Math.max(0, Number(installment.total || 0) - Number(installment.position || 0)));
  }, 0);
  const lastDue = maxFutureOffset > 0 ? shiftMonth(year, month, maxFutureOffset) : { month, year };
  const existingRowsInRange = getExistingImportRowsForCardDueRange(userId, cardId, month, year, lastDue.month, lastDue.year);
  const existingByDayAmount = new Map();

  for (const row of existingRows) {
    const key = buildImportDayAmountKey({ txnDate: row.txnDate, amountCents: row.amountCents });
    if (!existingByDayAmount.has(key)) existingByDayAmount.set(key, []);
    existingByDayAmount.get(key).push(row);
  }

  items.forEach((item) => {
    const installmentImpact = buildImportInstallmentPreviewImpact({
      item,
      relatedRows: existingRowsInRange,
      previewMonth: month,
      previewYear: year
    });
    if (!installmentImpact) return;
    item.installmentImpact = installmentImpact;
    item.projectedImportAffectedCount = Number(installmentImpact.projectedImportAffectedCount || 1);
    item.projectedImportNewTransactionCount = Number(installmentImpact.projectedImportNewTransactionCount || 1);
    item.projectedOverwriteAffectedCount = Number(installmentImpact.projectedOverwriteAffectedCount || 1);
    item.projectedOverwriteNewTransactionCount = Number(installmentImpact.projectedOverwriteNewTransactionCount || 0);
  });

  const csvGroupsByFingerprint = new Map();
  for (const item of items) {
    const fingerprint = buildImportDuplicateFingerprint({
      cardId,
      month,
      year,
      txnDate: item.isoDate,
      description: item.description,
      amountCents: item.amountCents,
      cardNumber: item.cardNumber
    });
    if (!csvGroupsByFingerprint.has(fingerprint)) csvGroupsByFingerprint.set(fingerprint, []);
    csvGroupsByFingerprint.get(fingerprint).push(item.id);
  }

  const csvDuplicateGroups = [];
  const csvGroupIdByItemId = new Map();

  for (const itemIds of csvGroupsByFingerprint.values()) {
    if (itemIds.length <= 1) continue;
    const groupItems = itemIds.map((itemId) => itemMap.get(itemId)).filter(Boolean).sort(compareImportPreviewItems);
    if (!groupItems.length) continue;

    const representative = groupItems[0];
    const existingMatches = existingByDayAmount.get(buildImportDayAmountKey({ txnDate: representative.isoDate, amountCents: representative.amountCents })) || [];
    const defaultKeepCount = Math.max(0, Math.min(groupItems.length, groupItems.length - existingMatches.length));
    const exactMatchCount = countExactExistingMatchesForImportItem(representative, existingMatches, cardId, month, year);
    const groupId = `csv_group_${csvDuplicateGroups.length + 1}`;
    const defaultImportItems = groupItems.slice(0, defaultKeepCount);
    const defaultImportItemIds = defaultImportItems.map((item) => item.id);
    const defaultAffectedCount = defaultImportItems.reduce((sum, item) => sum + Number(item.projectedImportAffectedCount || 1), 0);

    groupItems.forEach((item) => csvGroupIdByItemId.set(item.id, groupId));

    csvDuplicateGroups.push({
      id: groupId,
      representativeItemId: representative.id,
      itemIds: groupItems.map((item) => item.id),
      defaultImportItemIds,
      defaultAffectedCount,
      occurrenceCount: groupItems.length,
      defaultKeepCount,
      amountCents: representative.amountCents,
      amountLabel: representative.amountLabel,
      groupTotalCents: representative.amountCents * groupItems.length,
      groupTotalLabel: formatBRLFromCents(representative.amountCents * groupItems.length),
      existingMatchCount: existingMatches.length,
      exactMatchCount,
      existingMatches
    });
  }

  const appDuplicateCandidates = [];
  const autoItemIds = [];

  const sortedItems = items.slice().sort(compareImportPreviewItems);
  for (const item of sortedItems) {
    if (csvGroupIdByItemId.has(item.id)) continue;

    const existingMatches = (existingByDayAmount.get(buildImportDayAmountKey({ txnDate: item.isoDate, amountCents: item.amountCents })) || [])
      .slice()
      .sort(compareImportExistingMatches);
    if (existingMatches.length) {
      const exactMatchCount = countExactExistingMatchesForImportItem(item, existingMatches, cardId, month, year);
      const overwriteCandidates = existingMatches.filter((match) => match.overwriteEligible);
      const lockedManualMatches = existingMatches.filter((match) => match.isManual && !match.overwriteEligible);
      const importedMatches = existingMatches.filter((match) => match.isImported);
      const installmentImpact = item.installmentImpact || null;

      appDuplicateCandidates.push({
        id: `app_group_${appDuplicateCandidates.length + 1}`,
        itemId: item.id,
        amountCents: item.amountCents,
        amountLabel: item.amountLabel,
        existingMatchCount: existingMatches.length,
        exactMatchCount,
        existingMatches,
        overwriteCandidateIds: overwriteCandidates.map((match) => Number(match.id || 0)).filter(Boolean),
        overwriteEligibleCount: overwriteCandidates.length,
        overwriteEligible: overwriteCandidates.length > 0,
        hasMultipleOverwriteTargets: overwriteCandidates.length > 1,
        defaultOverwriteTargetId: overwriteCandidates.length === 1 ? Number(overwriteCandidates[0].id || 0) : null,
        lockedManualCount: lockedManualMatches.length,
        importedMatchCount: importedMatches.length,
        overwriteUnavailableReason: overwriteCandidates.length > 0
          ? null
          : (lockedManualMatches.length > 0
              ? 'Os manuais encontrados ficam só como referência porque esse mês está fechado.'
              : 'As coincidências daqui ficam só como referência, porque já vieram de importação.'),
        installmentImpact,
        projectedImportAffectedCount: 1,
        projectedImportNewTransactionCount: 1,
        projectedOverwriteAffectedCount: installmentImpact ? Number(installmentImpact.projectedOverwriteAffectedCount || 1) : 1,
        projectedOverwriteNewTransactionCount: installmentImpact ? Number(installmentImpact.projectedOverwriteNewTransactionCount || 0) : 0
      });
      continue;
    }

    autoItemIds.push(item.id);
  }

  const autoItems = autoItemIds.map((itemId) => itemMap.get(itemId)).filter(Boolean);
  const parsedCount = items.length;
  const parsedTotalCents = items.reduce((sum, item) => sum + Number(item.amountCents || 0), 0);
  const existingCount = existingRows.length;
  const existingTotalCents = existingRows.reduce((sum, row) => sum + Number(row.amountCents || 0), 0);
  const autoCount = autoItems.length;
  const autoTotalCents = autoItems.reduce((sum, item) => sum + Number(item.amountCents || 0), 0);
  const autoAffectedCount = autoItems.reduce((sum, item) => sum + Number(item.projectedImportAffectedCount || 1), 0);

  return {
    id: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'),
    createdAt: nowIso(),
    originalFilename: originalFilename || 'fatura.csv',
    cardId,
    cardName,
    month,
    year,
    periodLabel: monthLabel(month, year),
    formSeed: { cardId, month, year },
    items,
    autoItemIds,
    appDuplicateCandidates,
    csvDuplicateGroups,
    summary: buildImportPreviewSummary({
      parsedCount,
      parsedTotalCents,
      existingCount,
      existingTotalCents,
      autoCount,
      autoTotalCents,
      autoAffectedCount,
      appDuplicateCandidates,
      csvDuplicateGroups
    })
  };
}

function resolveImportPreviewSelection(preview, body) {
  const safeBody = body || {};
  const importedItemIds = [];
  const seenImportedItemIds = new Set();
  const overwriteActions = [];
  const itemMap = new Map((preview?.items || []).map((item) => [item.id, item]));

  const pushImportedItemId = (itemId) => {
    if (!itemId || seenImportedItemIds.has(itemId)) return;
    if (!itemMap.has(itemId)) return;
    seenImportedItemIds.add(itemId);
    importedItemIds.push(itemId);
  };

  const normalizeResolution = (candidateId) => {
    const explicitResolution = String(safeBody[`app_resolution_${candidateId}`] || '').trim().toLowerCase();
    if (['skip', 'import', 'overwrite'].includes(explicitResolution)) return explicitResolution;
    return String(safeBody[`keep_app_${candidateId}`] || '') === '1' ? 'import' : 'skip';
  };

  for (const itemId of preview?.autoItemIds || []) {
    pushImportedItemId(itemId);
  }

  for (const candidate of preview?.appDuplicateCandidates || []) {
    const resolution = normalizeResolution(candidate.id);
    if (resolution === 'import') {
      pushImportedItemId(candidate.itemId);
      continue;
    }
    if (resolution !== 'overwrite') continue;

    const eligibleIds = Array.isArray(candidate.overwriteCandidateIds)
      ? candidate.overwriteCandidateIds.map((value) => Number(value || 0)).filter(Boolean)
      : [];
    let targetTransactionId = Number(safeBody[`app_overwrite_target_${candidate.id}`] || 0);
    if ((!targetTransactionId || !eligibleIds.includes(targetTransactionId)) && eligibleIds.length === 1) {
      targetTransactionId = eligibleIds[0];
    }

    overwriteActions.push({
      candidateId: candidate.id,
      itemId: candidate.itemId,
      targetTransactionId: targetTransactionId || null,
      resolution: 'overwrite'
    });
  }

  for (const group of preview?.csvDuplicateGroups || []) {
    const rawKeepCount = safeBody[`keep_csv_${group.id}`];
    const fallbackKeepCount = Number(group.defaultKeepCount || 0);
    let keepCount = Number(rawKeepCount);
    if (!Number.isInteger(keepCount)) keepCount = fallbackKeepCount;
    keepCount = Math.max(0, Math.min(Number(group.occurrenceCount || 0), keepCount));

    for (const itemId of (group.itemIds || []).slice(0, keepCount)) {
      pushImportedItemId(itemId);
    }
  }

  return {
    importedItems: importedItemIds
      .map((itemId) => itemMap.get(itemId))
      .filter(Boolean)
      .sort((a, b) => Number(a.sourceIndex || 0) - Number(b.sourceIndex || 0)),
    overwriteActions
  };
}

function hasChildInstallmentsForTransaction(userId, txnId) {
  const safeTxnId = Number(txnId || 0);
  if (!safeTxnId) return false;
  return !!db.prepare(`
    SELECT 1
    FROM transactions t
    WHERE t.user_id = ?
      AND t.parent_txn_id = ?
    LIMIT 1
  `).get(userId, safeTxnId);
}

function buildImportInstallmentExecutionPlan({ userId, cardId, previewMonth, previewYear, item, overwriteTargetRow = null, suppressFutureExpansion = false } = {}) {
  const installment = item?.installment || resolveImportInstallmentMeta({ raw: item?.raw, description: item?.description, amountCents: item?.amountCents });
  if (!installment) return null;

  const schedule = buildImportInstallmentSchedule(previewMonth, previewYear, installment);
  const currentEntry = schedule[0] || null;
  const futureSchedule = schedule.slice(1);
  if (installment.conflictReason) {
    return {
      installment,
      currentEntry,
      futureSchedule,
      currentDescription: formatInstallmentDescription(installment.baseDescription, installment.position, installment.total),
      currentRaw: buildImportInstallmentRawPayload(item.raw || {}, installment, {
        source: 'statement_import',
        generated_future_installment: false,
        conflictReason: installment.conflictReason
      }),
      matchedChainRootId: null,
      overwriteCurrentParentTxnId: null,
      currentInsertParentTxnId: overwriteTargetRow
        ? (Number(overwriteTargetRow.parent_txn_id || overwriteTargetRow.parentTxnId || 0) || null)
        : null,
      futureExistingCount: 0,
      futureCreateCount: 0,
      futureRowsToCreate: [],
      hasConflict: true,
      conflictReason: installment.conflictReason
    };
  }
  const futureKeys = new Set(futureSchedule.map((entry) => entry.dueKey));
  const relatedRows = futureSchedule.length
    ? getExistingImportRowsForCardDueRange(userId, cardId, futureSchedule[0].dueMonth, futureSchedule[0].dueYear, futureSchedule[futureSchedule.length - 1].dueMonth, futureSchedule[futureSchedule.length - 1].dueYear)
    : [];
  const matchingRows = relatedRows
    .filter((row) => futureKeys.has(buildImportInstallmentDueKey(row.month, row.year)))
    .filter((row) => matchImportInstallmentExistingRowToItem(row, item));

  const rootGroups = new Map();
  const dueGroups = new Map();
  const mismatchedTotals = new Set();
  matchingRows.forEach((row) => {
    const rootKey = Number(row.parentTxnId || row.id || 0) || Number(row.id || 0);
    if (!rootGroups.has(rootKey)) rootGroups.set(rootKey, []);
    rootGroups.get(rootKey).push(row);

    const dueKey = buildImportInstallmentDueKey(row.month, row.year);
    if (!dueGroups.has(dueKey)) dueGroups.set(dueKey, []);
    dueGroups.get(dueKey).push(row);

    const rowInstallment = row.installment || null;
    if (rowInstallment && Number(rowInstallment.total || 0) > 1 && Number(rowInstallment.total || 0) !== Number(installment.total || 0)) {
      mismatchedTotals.add(Number(rowInstallment.total || 0));
    }
  });

  let conflictReason = null;
  if (mismatchedTotals.size > 0) {
    conflictReason = 'O app encontrou parcelas parecidas com total diferente.';
  } else if (rootGroups.size > 1) {
    conflictReason = 'O app encontrou mais de uma cadeia parecida nas próximas faturas.';
  } else if (Array.from(dueGroups.values()).some((rows) => rows.length > 1)) {
    conflictReason = 'Mais de uma parcela parecida apareceu no mesmo mês futuro.';
  }

  const matchedGroupRootId = rootGroups.size === 1 ? Number(Array.from(rootGroups.keys())[0] || 0) || null : null;
  let overwriteCurrentParentTxnId = null;
  if (!conflictReason && overwriteTargetRow && matchedGroupRootId) {
    const targetOwnRootId = Number(overwriteTargetRow.parent_txn_id || overwriteTargetRow.parentTxnId || overwriteTargetRow.id || 0) || null;
    const targetHasOwnChain = Boolean(Number(overwriteTargetRow.parent_txn_id || overwriteTargetRow.parentTxnId || 0) > 0 || hasChildInstallmentsForTransaction(userId, overwriteTargetRow.id));
    if (targetOwnRootId && matchedGroupRootId !== targetOwnRootId) {
      if (targetHasOwnChain) {
        conflictReason = 'A parcela atual já faz parte de outra cadeia parcelada.';
      } else {
        overwriteCurrentParentTxnId = matchedGroupRootId;
      }
    }
  }

  if (!conflictReason && suppressFutureExpansion) {
    conflictReason = 'A expansão automática ficou desligada porque a linha atual foi mantida como nova mesmo com coincidência neste mês.';
  }

  const futureExistingCount = futureSchedule.reduce((sum, entry) => sum + (dueGroups.has(entry.dueKey) ? 1 : 0), 0);
  const futureRowsToCreate = conflictReason
    ? []
    : futureSchedule
        .filter((entry) => !dueGroups.has(entry.dueKey))
        .map((entry) => {
          const installmentMeta = buildImportInstallmentMeta(entry.position, installment.total, installment.baseDescription, {
            source: 'statement_import',
            fromRaw: false
          });
          return {
            dueMonth: entry.dueMonth,
            dueYear: entry.dueYear,
            description: formatInstallmentDescription(installment.baseDescription, entry.position, installment.total),
            amountCents: Number(item.amountCents || 0),
            cardNumber: normalizeImportCardNumber(item.cardNumber) || null,
            isoDate: item.isoDate || null,
            purchaseCategoryId: overwriteTargetRow ? (Number(overwriteTargetRow.purchase_category_id || overwriteTargetRow.purchaseCategoryId || 0) || null) : null,
            raw: buildImportInstallmentRawPayload(item.raw || {}, installmentMeta, {
              source: 'statement_import',
              generated_future_installment: true
            })
          };
        });

  return {
    installment,
    currentEntry,
    futureSchedule,
    currentDescription: formatInstallmentDescription(installment.baseDescription, installment.position, installment.total),
    currentRaw: buildImportInstallmentRawPayload(item.raw || {}, installment, {
      source: 'statement_import',
      generated_future_installment: false
    }),
    matchedChainRootId: matchedGroupRootId,
    overwriteCurrentParentTxnId,
    currentInsertParentTxnId: overwriteTargetRow
      ? (overwriteCurrentParentTxnId || Number(overwriteTargetRow.parent_txn_id || overwriteTargetRow.parentTxnId || 0) || null)
      : (matchedGroupRootId || null),
    futureExistingCount,
    futureCreateCount: futureRowsToCreate.length,
    futureRowsToCreate,
    hasConflict: !!conflictReason,
    conflictReason
  };
}

function buildImportConfirmationMessage(preview, importedSummary = {}, overwrittenCount = 0) {
  const periodLabel = preview?.periodLabel || monthLabel(preview?.month, preview?.year);
  const summaryPayload = typeof importedSummary === 'object' && importedSummary !== null
    ? importedSummary
    : {
        importedLineCount: importedSummary,
        overwrittenCount
      };

  const safeImportedCount = Math.max(0, Number(summaryPayload.importedLineCount || 0));
  const safeOverwrittenCount = Math.max(0, Number(summaryPayload.overwrittenCount || 0));
  const safeCreatedTransactionCount = Math.max(0, Number(summaryPayload.createdTransactionCount || 0));
  const safeFutureCreatedCount = Math.max(0, Number(summaryPayload.futureCreatedCount || 0));
  const safeBlockedFutureExpansionCount = Math.max(0, Number(summaryPayload.blockedFutureExpansionCount || 0));

  if (safeImportedCount <= 0 && safeOverwrittenCount <= 0) {
    return {
      type: 'info',
      message: `Nada ficou marcado para entrar em ${periodLabel}. A previa continua aberta para você ajustar.`
    };
  }

  const summary = preview?.summary || {};
  const reviewedParts = [];
  if (Number(summary.appDuplicateCount || 0) > 0) {
    reviewedParts.push(formatCountLabel(summary.appDuplicateCount, 'suspeita no app', 'suspeitas no app'));
  }
  if (Number(summary.csvDuplicateGroupCount || 0) > 0) {
    reviewedParts.push(formatCountLabel(summary.csvDuplicateGroupCount, 'grupo repetido no CSV', 'grupos repetidos no CSV'));
  }

  const actionParts = [];
  if (safeImportedCount > 0) {
    actionParts.push(safeImportedCount === 1
      ? '1 linha nova entrou'
      : `${safeImportedCount} linhas novas entraram`);
  }
  if (safeOverwrittenCount > 0) {
    actionParts.push(safeOverwrittenCount === 1
      ? '1 lancamento manual foi sobrescrito'
      : `${safeOverwrittenCount} lancamentos manuais foram sobrescritos`);
  }

  const detailParts = [];
  if (safeCreatedTransactionCount > safeImportedCount) {
    detailParts.push(safeCreatedTransactionCount === 1
      ? '1 transacao foi criada'
      : `${safeCreatedTransactionCount} transacoes foram criadas`);
  }
  if (safeFutureCreatedCount > 0) {
    detailParts.push(safeFutureCreatedCount === 1
      ? '1 parcela futura ficou preparada'
      : `${safeFutureCreatedCount} parcelas futuras ficaram preparadas`);
  }
  if (safeBlockedFutureExpansionCount > 0) {
    detailParts.push(safeBlockedFutureExpansionCount === 1
      ? '1 cadeia parcelada ficou so na parcela atual por prudencia'
      : `${safeBlockedFutureExpansionCount} cadeias parceladas ficaram so na parcela atual por prudencia`);
  }

  const baseMessage = `${actionParts.join(' e ')} em ${periodLabel}.`;
  const detailMessage = detailParts.length ? ` ${detailParts.join('. ')}.` : '';

  if (!reviewedParts.length) {
    return { type: 'success', message: `${baseMessage}${detailMessage} Tudo certinho por aqui.` };
  }

  return {
    type: 'success',
    message: `${baseMessage}${detailMessage} Revisei ${reviewedParts.join(' e ')} com voce antes de confirmar.`
  };
}

// Import
registerImportRoutes(app, {
  ensureAuthenticated,
  ensureCanImport,
  upload,
  safeRenderView,
  formatBRLFromCents,
  getActiveCards,
  db,
  clearImportPreview,
  setImportPreview,
  setImportFormSeed,
  parseCsvByCardName,
  buildImportPreviewData,
  formatCountLabel,
  resolveImportPreviewSelection,
  nowIso,
  getImportOverwriteTargetRow,
  buildImportExistingMatchVersion,
  buildImportOverwriteAuditSnapshot,
  buildImportOverwriteDescription,
  buildImportInstallmentExecutionPlan,
  isMonthClosed,
  getMonthLockMessage,
  getTransactionScopeRowsByIds,
  syncEqualAllocationsForEditedTransactions,
  queueSharedDebtDraftsForTransactions,
  applyImportOverwriteSharedDebtPolicy,
  buildImportConfirmationMessage,
  createNotification,
  setFlash
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

function normalizeLedgerFilterText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function ledgerTextIncludes(value, query) {
  const q = normalizeLedgerFilterText(query);
  if (!q) return true;
  return normalizeLedgerFilterText(value).includes(q);
}

function getMoneyFilterDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function filterSharedPurchaseProjectionRowsForMonth(rows = [], filters = {}) {
  const items = Array.isArray(rows) ? rows.slice() : [];
  const amountDigits = getMoneyFilterDigits(filters.f_amount);
  const allocatedFilter = String(filters.f_allocated || '').trim().toLowerCase();
  const categoryFilter = String(filters.f_category || '').trim();
  const personFilter = String(filters.f_person || '').trim();
  const originFilter = String(filters.f_origin || '').trim().toLowerCase();

  return items.filter((item) => {
    if (originFilter === 'own') return false;
    if (!item || item.kind !== 'shared_received') return false;

    if (filters.f_desc) {
      const haystack = [
        item.description,
        item.requesterName,
        item.categoryName,
        item.cardName,
        item.sharedCardLabel,
        item.virtualCardName,
        item.statusLabel
      ].filter(Boolean).join(' ');
      if (!ledgerTextIncludes(haystack, filters.f_desc)) return false;
    }

    if (filters.f_card) {
      const haystack = [item.sharedCardLabel, item.virtualCardName, item.cardName, item.requesterName].filter(Boolean).join(' ');
      if (!ledgerTextIncludes(haystack, filters.f_card)) return false;
    }

    if (filters.f_number) {
      if (!ledgerTextIncludes(item.cardNumber || '', filters.f_number)) return false;
    }

    if (filters.f_date) {
      if (!String(item.date || '').includes(String(filters.f_date || '').trim())) return false;
    }

    if (amountDigits) {
      const amountText = String(Math.abs(Number(item.amountCents || 0)));
      if (!amountText.includes(amountDigits)) return false;
    }

    if (categoryFilter) {
      if (categoryFilter === 'none') {
        if (Number(item.purchaseCategoryId || item.categoryId || 0) > 0) return false;
      } else {
        const categoryId = Number(categoryFilter || 0);
        if (categoryId > 0 && Number(item.purchaseCategoryId || item.categoryId || 0) !== categoryId) return false;
      }
    }

    if (allocatedFilter) {
      if (allocatedFilter.startsWith('n')) return false;
      if (!allocatedFilter.startsWith('s')) return false;
    }

    // O filtro de pessoa atual usa IDs locais do cadastro do recebedor. Como a compra compartilhada vem de outro usuário,
    // mantemos a busca por remetente no campo de texto e evitamos cruzar IDs de bases diferentes.
    if (personFilter) return false;

    return true;
  });
}

function buildMonthLedgerRows(txns = [], sharedRows = [], { sort = 'date', dir = 'asc' } = {}) {
  const ownRows = (Array.isArray(txns) ? txns : []).map((txn) => ({
    kind: 'own',
    id: `txn:${Number(txn?.id || 0)}`,
    isShared: false,
    isReadOnly: false,
    txn,
    date: txn?.txn_date || '',
    description: txn?.description || '',
    cardName: txn?.card_name || '',
    cardNumber: txn?.card_number || '',
    amountCents: Number(txn?.amount_cents || 0),
    categoryName: txn?.purchase_category_name || '',
    categoryId: Number(txn?.purchase_category_id || 0) || null,
    allocatedScore: Number(txn?.alloc_count || 0) > 0 ? 1 : 0,
    stableId: Number(txn?.id || 0)
  }));

  const projectedRows = (Array.isArray(sharedRows) ? sharedRows : []).map((item) => ({
    kind: 'shared',
    id: item?.id || `shared-request:${Number(item?.sourceRequestId || 0)}`,
    isShared: true,
    isReadOnly: true,
    shared: item,
    date: item?.date || '',
    description: item?.description || '',
    cardName: item?.sharedCardLabel || item?.ledgerCardName || item?.virtualCardName || item?.cardName || '',
    cardNumber: item?.cardNumber || '',
    amountCents: Number(item?.amountCents || 0),
    categoryName: item?.categoryName || item?.purchaseCategoryName || 'Compartilhadas',
    categoryId: Number(item?.purchaseCategoryId || item?.categoryId || 0) || null,
    allocatedScore: 1,
    stableId: Number(item?.sourceRequestId || 0)
  }));

  const rows = ownRows.concat(projectedRows);
  const normalizedSort = ['date', 'amount', 'card', 'desc', 'allocated', 'number'].includes(String(sort || '')) ? String(sort) : 'date';
  const direction = String(dir || 'asc').toLowerCase() === 'desc' ? -1 : 1;
  const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true });

  function valueFor(row) {
    switch (normalizedSort) {
      case 'amount': return Number(row.amountCents || 0);
      case 'card': return String(row.cardName || '');
      case 'desc': return String(row.description || '');
      case 'allocated': return Number(row.allocatedScore || 0);
      case 'number': return String(row.cardNumber || '');
      case 'date':
      default: return String(row.date || '');
    }
  }

  rows.sort((a, b) => {
    const av = valueFor(a);
    const bv = valueFor(b);
    let cmp = 0;
    if (typeof av === 'number' && typeof bv === 'number') {
      cmp = av === bv ? 0 : (av < bv ? -1 : 1);
    } else {
      cmp = collator.compare(String(av || ''), String(bv || ''));
    }
    if (cmp !== 0) return cmp * direction;

    const dateCmp = collator.compare(String(a.date || ''), String(b.date || ''));
    if (dateCmp !== 0) return dateCmp * (normalizedSort === 'date' ? direction : -1);
    if (a.kind !== b.kind) return a.kind === 'own' ? -1 : 1;
    return (Number(a.stableId || 0) - Number(b.stableId || 0)) * (normalizedSort === 'date' ? direction : 1);
  });

  return rows;
}


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

function buildCardHealthDetailModuleSummary(userId, month, year, {
  visibleCards = null,
  statementByCard = null,
  cardTotalsMap = null,
  isClosed = false,
  today = dayjs()
} = {}) {
  const safeUserId = Number(userId || 0);
  const safeMonth = Number(month || 0);
  const safeYear = Number(year || 0);
  const referenceToday = dayjs(today).isValid() ? dayjs(today).startOf('day') : dayjs().startOf('day');

  const baseSummary = {
    eyebrow: 'Saúde dos cartões',
    title: 'Saúde dos cartões',
    subtitle: 'Fatura, próximos meses e rateios em um só lugar.',
    primaryCta: {
      href: `/summary/${safeYear}/${safeMonth}`,
      label: 'Fechamento do mês'
    },
    secondaryCta: {
      href: '/geral',
      label: 'Ver cartões'
    },
    chips: [],
    hasAnyData: false,
    useCompactState: true,
    isAllClear: false,
    compact: {
      tone: 'default',
      title: 'Seu painel de cartão está quietinho.',
      description: 'Quando entrar fatura, mês futuro ou rateio com terceiros, esse bloco acorda sem bagunçar o topo.',
      badges: [
        { tone: 'default', label: 'Sem fatura aberta' },
        { tone: 'default', label: 'Sem próximo mês puxando' },
        { tone: 'default', label: 'Sem radar urgente' }
      ]
    },
    current: {
      totalCents: 0,
      paidCents: 0,
      remainingCents: 0,
      progressPct: 0,
      cardCount: 0,
      countLabel: 'Sem cartão puxando esta referência.',
      nextDueLabel: null,
      nextDueCardName: null,
      pressureLabel: 'Sem cartão pressionando o mês por aqui.',
      ctaHref: `/summary/${safeYear}/${safeMonth}`,
      ctaLabel: 'Abrir fechamento'
    },
    future: {
      totalCents: 0,
      paidCents: 0,
      remainingCents: 0,
      monthCount: 0,
      countLabel: 'Nenhuma competência futura aberta por enquanto.',
      firstLabel: null,
      leadLabel: 'Quando os próximos meses aparecerem em /geral, eles pousam aqui.',
      ctaHref: '/geral',
      ctaLabel: 'Ver próximos meses'
    },
    thirdParties: {
      totalCents: 0,
      paidCents: 0,
      remainingCents: 0,
      progressPct: 0,
      personCount: 0,
      countLabel: 'Sem rateio com terceiros neste mês.',
      highlightLabel: 'Quando alguém participar da conta, o retrato aparece aqui.',
      ctaHref: `/summary/${safeYear}/${safeMonth}`,
      ctaLabel: 'Ver pessoas do mês'
    },
    radar: {
      signalCount: 0,
      signalLabel: 'Sem susto operacional por agora.',
      items: [],
      ctaHref: `/month/${safeYear}/${safeMonth}`,
      ctaLabel: 'Abrir mês'
    }
  };

  if (!safeUserId || !safeMonth || !safeYear) {
    return baseSummary;
  }

  const cards = Array.isArray(visibleCards) ? visibleCards : getVisibleCardsForMonth(safeUserId, safeMonth, safeYear);

  let localCardTotalsMap = cardTotalsMap instanceof Map ? cardTotalsMap : null;
  if (!localCardTotalsMap) {
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
    `).all(safeUserId, safeMonth, safeYear, safeMonth, safeYear);
    localCardTotalsMap = new Map(cardTotalsRows.map((row) => [Number(row.card_id || 0), Math.max(0, Number(row.total_cents || 0))]));
  }

  let localStatementByCard = statementByCard instanceof Map ? statementByCard : null;
  if (!localStatementByCard) {
    const statementRows = db.prepare(`
      SELECT card_id, computed_due_date, override_due_date, paid_cents
      FROM card_statements
      WHERE user_id = ? AND month = ? AND year = ?
    `).all(safeUserId, safeMonth, safeYear);
    localStatementByCard = new Map(statementRows.map((row) => [Number(row.card_id || 0), row]));
  }

  const currentCards = cards
    .map((card) => {
      const safeCardId = Number(card?.id || 0);
      const stmt = localStatementByCard.get(safeCardId);
      const computedDueDate = computeDueDate({
        year: safeYear,
        month: safeMonth,
        dueDay: card?.due_day,
        holidayScope: card?.holiday_scope || 'BR'
      });
      const dueDate = stmt?.override_due_date || stmt?.computed_due_date || computedDueDate || null;
      const totalCents = Math.max(0, Number(localCardTotalsMap.get(safeCardId) || 0));
      const paidCents = Math.max(0, Number(stmt?.paid_cents || 0));
      const remainingCents = Math.max(0, totalCents - paidCents);
      const diffDays = dueDate ? dayjs(dueDate).startOf('day').diff(referenceToday, 'day') : null;
      return {
        card_id: safeCardId,
        card_name: card?.name || 'Cartão',
        total_cents: totalCents,
        paid_cents: paidCents,
        remaining_cents: remainingCents,
        due_date: dueDate,
        diff_days: diffDays,
        close_day: normalizeDayNumber(card?.close_day),
        due_day: normalizeDayNumber(card?.due_day)
      };
    })
    .filter((item) => item.total_cents > 0 || item.paid_cents > 0)
    .sort((a, b) => {
      const aTime = a.due_date ? dayjs(a.due_date).valueOf() : Number.MAX_SAFE_INTEGER;
      const bTime = b.due_date ? dayjs(b.due_date).valueOf() : Number.MAX_SAFE_INTEGER;
      if (aTime !== bTime) return aTime - bTime;
      return a.card_name.localeCompare(b.card_name, 'pt-BR', { sensitivity: 'base' });
    });

  const currentTotals = currentCards.reduce((acc, item) => {
    acc.totalCents += Number(item.total_cents || 0);
    acc.paidCents += Number(item.paid_cents || 0);
    acc.remainingCents += Number(item.remaining_cents || 0);
    return acc;
  }, { totalCents: 0, paidCents: 0, remainingCents: 0 });

  const nextDueCard = currentCards.find((item) => item.due_date && item.remaining_cents > 0)
    || currentCards.find((item) => item.due_date)
    || null;

  const pressureCard = currentCards.reduce((best, item) => {
    if (!best) return item;
    const itemWeight = Number(item.remaining_cents || 0) > 0 ? Number(item.remaining_cents || 0) : Number(item.total_cents || 0);
    const bestWeight = Number(best.remaining_cents || 0) > 0 ? Number(best.remaining_cents || 0) : Number(best.total_cents || 0);
    if (itemWeight !== bestWeight) return itemWeight > bestWeight ? item : best;
    return item.card_name.localeCompare(best.card_name, 'pt-BR', { sensitivity: 'base' }) < 0 ? item : best;
  }, null);

  baseSummary.current = {
    totalCents: currentTotals.totalCents,
    paidCents: currentTotals.paidCents,
    remainingCents: currentTotals.remainingCents,
    progressPct: currentTotals.totalCents > 0 ? Math.max(0, Math.min(100, Math.round((currentTotals.paidCents / currentTotals.totalCents) * 100))) : 0,
    cardCount: currentCards.length,
    countLabel: currentCards.length > 0
      ? formatCountLabel(currentCards.length, 'cartão entrou nesta fatura', 'cartões entraram nesta fatura')
      : 'Sem cartão puxando esta referência.',
    nextDueLabel: nextDueCard?.due_date ? dayjs(nextDueCard.due_date).format('DD/MM') : null,
    nextDueCardName: nextDueCard?.card_name || null,
    pressureLabel: pressureCard
      ? (Number(pressureCard.remaining_cents || 0) > 0
        ? `${pressureCard.card_name} é o que mais puxa agora, com ${formatBRLFromCents(pressureCard.remaining_cents)} ainda faltando.`
        : `${pressureCard.card_name} levou a maior fatia da fatura, com ${formatBRLFromCents(pressureCard.total_cents)}.`)
      : 'Sem cartão pressionando o mês por aqui.',
    ctaHref: `/summary/${safeYear}/${safeMonth}`,
    ctaLabel: currentTotals.totalCents > 0 ? 'Abrir fechamento' : 'Revisar fechamento'
  };

  const personAllocationRows = db.prepare(`
    SELECT a.person_id, SUM(a.share_cents) AS total_cents
    FROM allocations a
    JOIN transactions t ON t.id = a.transaction_id AND t.user_id = a.user_id
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    WHERE a.user_id = ?
      AND (
        (${EFFECTIVE_DUE_MONTH_SQL} = ? AND ${EFFECTIVE_DUE_YEAR_SQL} = ?) OR
        (${EFFECTIVE_DUE_MONTH_SQL} = ? AND ${EFFECTIVE_DUE_YEAR_SQL} = ?)
      )
    GROUP BY a.person_id
  `).all(safeUserId, safeMonth, safeYear, safeMonth, safeYear);

  const personTotalsMap = new Map(personAllocationRows.map((row) => [Number(row.person_id || 0), Math.max(0, Number(row.total_cents || 0))]));
  const paymentBreakdownMap = getCombinedPersonPaymentBreakdownMap(safeUserId, safeMonth, safeYear);
  const visiblePeople = getVisiblePeopleForMonth(safeUserId, safeMonth, safeYear, { includePayments: true });

  const thirdPartyRows = visiblePeople
    .filter((person) => !isSelfPersonRow(person))
    .map((person) => {
      const personId = Number(person?.id || 0);
      const paymentBreakdown = paymentBreakdownMap.get(personId) || { manualCents: 0, autoCents: 0, totalPaidCents: 0 };
      const totalCents = Math.max(0, Number(personTotalsMap.get(personId) || 0));
      const paidCents = Math.max(0, Number(paymentBreakdown.totalPaidCents || 0));
      return {
        person_id: personId,
        person_name: person?.name || 'Pessoa',
        total_cents: totalCents,
        paid_cents: paidCents,
        remaining_cents: Math.max(0, totalCents - paidCents)
      };
    })
    .filter((item) => item.total_cents > 0 || item.paid_cents > 0)
    .sort((a, b) => {
      if (Number(b.remaining_cents || 0) !== Number(a.remaining_cents || 0)) {
        return Number(b.remaining_cents || 0) - Number(a.remaining_cents || 0);
      }
      if (Number(b.total_cents || 0) !== Number(a.total_cents || 0)) {
        return Number(b.total_cents || 0) - Number(a.total_cents || 0);
      }
      return a.person_name.localeCompare(b.person_name, 'pt-BR', { sensitivity: 'base' });
    });

  const thirdPartyTotals = thirdPartyRows.reduce((acc, item) => {
    acc.totalCents += Number(item.total_cents || 0);
    acc.paidCents += Number(item.paid_cents || 0);
    acc.remainingCents += Number(item.remaining_cents || 0);
    return acc;
  }, { totalCents: 0, paidCents: 0, remainingCents: 0 });

  const leadThirdParty = thirdPartyRows[0] || null;

  baseSummary.thirdParties = {
    totalCents: thirdPartyTotals.totalCents,
    paidCents: thirdPartyTotals.paidCents,
    remainingCents: thirdPartyTotals.remainingCents,
    progressPct: thirdPartyTotals.totalCents > 0 ? Math.max(0, Math.min(100, Math.round((thirdPartyTotals.paidCents / thirdPartyTotals.totalCents) * 100))) : 0,
    personCount: thirdPartyRows.length,
    countLabel: thirdPartyRows.length > 0
      ? formatCountLabel(thirdPartyRows.length, 'pessoa entrou nesse rateio', 'pessoas entraram nesse rateio')
      : 'Sem rateio com terceiros neste mês.',
    highlightLabel: leadThirdParty
      ? (Number(leadThirdParty.remaining_cents || 0) > 0
        ? `${leadThirdParty.person_name} ainda tem ${formatBRLFromCents(leadThirdParty.remaining_cents)} nessa rodada.`
        : `${leadThirdParty.person_name} já ficou em dia nessa rodada.`)
      : 'Quando alguém participar da conta, o retrato aparece aqui.',
    ctaHref: `/summary/${safeYear}/${safeMonth}`,
    ctaLabel: thirdPartyRows.length > 0 ? 'Ver pessoas do mês' : 'Abrir fechamento'
  };

  const futureTransactionRows = db.prepare(`
    SELECT effective_due_year AS year, effective_due_month AS month, COALESCE(SUM(amount_cents), 0) AS total_cents
    FROM (
      SELECT
        t.amount_cents,
        ${EFFECTIVE_DUE_MONTH_SQL} AS effective_due_month,
        ${EFFECTIVE_DUE_YEAR_SQL} AS effective_due_year
      FROM transactions t
      LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
      WHERE t.user_id = ?
    ) grouped
    WHERE effective_due_year > ? OR (effective_due_year = ? AND effective_due_month > ?)
    GROUP BY effective_due_year, effective_due_month
    ORDER BY effective_due_year ASC, effective_due_month ASC
  `).all(safeUserId, safeYear, safeYear, safeMonth);

  const futurePaidRows = db.prepare(`
    SELECT year, month, COALESCE(SUM(paid_cents), 0) AS paid_cents
    FROM card_statements
    WHERE user_id = ?
      AND (year > ? OR (year = ? AND month > ?))
    GROUP BY year, month
  `).all(safeUserId, safeYear, safeYear, safeMonth);

  const futurePaidMap = new Map(futurePaidRows.map((row) => [monthKey(row.month, row.year), Math.max(0, Number(row.paid_cents || 0))]));
  const closedMonths = getClosedMonthsSet(safeUserId);

  const futureGroups = futureTransactionRows
    .map((row) => {
      const groupMonth = Number(row.month || 0);
      const groupYear = Number(row.year || 0);
      if (!groupMonth || !groupYear) return null;
      if (closedMonths.has(monthKey(groupMonth, groupYear))) return null;
      const totalCents = Math.max(0, Number(row.total_cents || 0));
      const paidCents = Math.max(0, Number(futurePaidMap.get(monthKey(groupMonth, groupYear)) || 0));
      return {
        month: groupMonth,
        year: groupYear,
        label: monthLabel(groupMonth, groupYear),
        total_cents: totalCents,
        paid_cents: paidCents,
        remaining_cents: Math.max(0, totalCents - paidCents)
      };
    })
    .filter(Boolean);

  const futureTotals = futureGroups.reduce((acc, item) => {
    acc.totalCents += Number(item.total_cents || 0);
    acc.paidCents += Number(item.paid_cents || 0);
    acc.remainingCents += Number(item.remaining_cents || 0);
    return acc;
  }, { totalCents: 0, paidCents: 0, remainingCents: 0 });

  const firstFutureGroup = futureGroups[0] || null;
  const leadFutureGroup = futureGroups.reduce((best, item) => {
    if (!best) return item;
    if (Number(item.total_cents || 0) !== Number(best.total_cents || 0)) {
      return Number(item.total_cents || 0) > Number(best.total_cents || 0) ? item : best;
    }
    return compareMonthYear(item.year, item.month, best.year, best.month) < 0 ? item : best;
  }, null);

  baseSummary.future = {
    totalCents: futureTotals.totalCents,
    paidCents: futureTotals.paidCents,
    remainingCents: futureTotals.remainingCents,
    monthCount: futureGroups.length,
    countLabel: futureGroups.length > 0
      ? formatCountLabel(futureGroups.length, 'competência futura já está aberta', 'competências futuras já estão abertas')
      : 'Nenhuma competência futura aberta por enquanto.',
    firstLabel: firstFutureGroup?.label || null,
    leadLabel: leadFutureGroup
      ? `${leadFutureGroup.label} carrega a maior fatia à frente, com ${formatBRLFromCents(leadFutureGroup.total_cents)}.`
      : 'Quando os próximos meses aparecerem em /geral, eles pousam aqui.',
    ctaHref: '/geral',
    ctaLabel: futureGroups.length > 0 ? 'Ver próximos meses' : 'Abrir cartões'
  };

  const unassignedRow = !isClosed
    ? (db.prepare(`
        SELECT COUNT(*) AS total_count, COALESCE(SUM(t.amount_cents), 0) AS total_cents
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
      `).get(safeUserId, safeMonth, safeYear, safeMonth, safeYear) || { total_count: 0, total_cents: 0 })
    : { total_count: 0, total_cents: 0 };

  const unassignedCount = Math.max(0, Number(unassignedRow?.total_count || 0));
  const unassignedCents = Math.max(0, Number(unassignedRow?.total_cents || 0));

  const isCurrentReferenceMonth = safeYear === referenceToday.year() && safeMonth === (referenceToday.month() + 1);
  const currentCardMap = new Map(currentCards.map((item) => [item.card_id, item]));

  const closingTodayCards = isCurrentReferenceMonth
    ? cards
      .map((card) => {
        const currentCard = currentCardMap.get(Number(card?.id || 0));
        return {
          card_name: card?.name || 'Cartão',
          close_day: normalizeDayNumber(card?.close_day),
          total_cents: Number(currentCard?.total_cents || 0)
        };
      })
      .filter((item) => Number(item.close_day || 0) > 0 && Math.min(Number(item.close_day || 0), referenceToday.daysInMonth()) === referenceToday.date() && Number(item.total_cents || 0) > 0)
    : [];

  const dueSoonCards = isCurrentReferenceMonth
    ? currentCards.filter((item) => item.due_date && Number(item.remaining_cents || 0) > 0 && Number(item.diff_days) >= 0 && Number(item.diff_days) <= 2)
    : [];

  const overdueCards = isCurrentReferenceMonth
    ? currentCards.filter((item) => item.due_date && Number(item.remaining_cents || 0) > 0 && Number(item.diff_days) < 0)
    : [];

  const radarItems = [];

  if (overdueCards.length) {
    radarItems.push({
      tone: 'warning',
      priority: 40,
      icon: '🚨',
      label: overdueCards.length === 1 ? '1 fatura vencida' : `${overdueCards.length} faturas vencidas`,
      title: overdueCards.length === 1 ? 'Fatura vencida com pendência' : 'Faturas vencidas com pendência',
      description: buildOverduePaymentAlertDescription(overdueCards),
      href: `/summary/${safeYear}/${safeMonth}`
    });
  }

  if (unassignedCount > 0) {
    radarItems.push({
      tone: 'warning',
      priority: 35,
      icon: '👥',
      label: unassignedCount === 1 ? '1 compra sem dono' : `${unassignedCount} compras sem dono`,
      title: unassignedCount === 1 ? 'Compra sem dono no mês' : 'Compras sem dono no mês',
      description: `${formatCountLabel(unassignedCount, 'item ainda não foi dividido', 'itens ainda não foram divididos')}, somando ${formatBRLFromCents(unassignedCents)}.`,
      href: `/month/${safeYear}/${safeMonth}?f_allocated=nao`
    });
  }

  if (dueSoonCards.length) {
    const preview = dueSoonCards.slice(0, 3).map((item) => `${item.card_name} (${dayjs(item.due_date).format('DD/MM')})`).join(', ');
    const extraCount = dueSoonCards.length - Math.min(dueSoonCards.length, 3);
    radarItems.push({
      tone: 'warning',
      priority: 30,
      icon: '📅',
      label: dueSoonCards.length === 1 ? '1 vence em até 2 dias' : `${dueSoonCards.length} vencem em até 2 dias`,
      title: dueSoonCards.length === 1 ? 'Vencimento em até 2 dias' : 'Vencimentos em até 2 dias',
      description: extraCount > 0 ? `${preview} e mais ${formatCountLabel(extraCount, 'fatura chegando', 'faturas chegando')}.` : preview,
      href: `/summary/${safeYear}/${safeMonth}`
    });
  }

  if (closingTodayCards.length) {
    const preview = closingTodayCards.slice(0, 3).map((item) => item.card_name).join(', ');
    const extraCount = closingTodayCards.length - Math.min(closingTodayCards.length, 3);
    radarItems.push({
      tone: 'info',
      priority: 20,
      icon: '⏰',
      label: closingTodayCards.length === 1 ? '1 fecha hoje' : `${closingTodayCards.length} fecham hoje`,
      title: closingTodayCards.length === 1 ? 'Cartão fecha hoje' : 'Cartões fecham hoje',
      description: extraCount > 0 ? `${preview} e mais ${formatCountLabel(extraCount, 'cartão', 'cartões')} fecham hoje.` : `${preview} ${closingTodayCards.length === 1 ? 'fecha' : 'fecham'} hoje.`,
      href: `/month/${safeYear}/${safeMonth}`
    });
  }

  radarItems.sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0));

  baseSummary.radar = {
    signalCount: radarItems.length,
    signalLabel: radarItems.length > 0
      ? formatCountLabel(radarItems.length, 'sinal pedindo sua mão', 'sinais pedindo sua mão')
      : 'Sem susto operacional por agora.',
    items: radarItems.slice(0, 4),
    ctaHref: radarItems[0]?.href || `/month/${safeYear}/${safeMonth}`,
    ctaLabel: radarItems.length > 0 ? 'Resolver agora' : 'Abrir mês'
  };

  baseSummary.hasAnyData = currentTotals.totalCents > 0
    || currentTotals.paidCents > 0
    || futureTotals.totalCents > 0
    || thirdPartyTotals.totalCents > 0
    || radarItems.length > 0;

  baseSummary.isAllClear = !radarItems.length
    && currentTotals.remainingCents === 0
    && futureTotals.totalCents === 0
    && thirdPartyTotals.remainingCents === 0
    && (currentTotals.totalCents > 0 || thirdPartyTotals.totalCents > 0);

  baseSummary.useCompactState = !baseSummary.hasAnyData || baseSummary.isAllClear;

  if (baseSummary.isAllClear) {
    baseSummary.chips = [{ tone: 'success', label: 'cartões em dia', href: `/summary/${safeYear}/${safeMonth}` }];
    baseSummary.compact = {
      tone: 'success',
      title: 'Cartões redondinhos por aqui.',
      description: 'A fatura desse mês já está domada e não há próximo mês aberto puxando assunto. Dá pra respirar sem promessa furada.',
      badges: [
        { tone: 'success', label: currentTotals.totalCents > 0 ? 'Fatura do mês em dia' : 'Sem fatura aberta' },
        { tone: 'success', label: 'Sem próximo mês aberto' },
        { tone: 'success', label: thirdPartyTotals.remainingCents > 0 ? 'Terceiros no radar' : 'Terceiros zerados' }
      ]
    };
  } else if (!baseSummary.hasAnyData) {
    baseSummary.compact = {
      tone: 'default',
      title: 'Seu painel de cartão está quietinho.',
      description: 'Quando entrar fatura, mês futuro ou rateio com terceiros, esse bloco acorda sem bagunçar o topo.',
      badges: [
        { tone: 'default', label: 'Sem fatura aberta' },
        { tone: 'default', label: 'Sem próximo mês puxando' },
        { tone: 'default', label: 'Sem radar urgente' }
      ]
    };
  } else {
    baseSummary.chips = radarItems.slice(0, 3).map((item) => ({
      tone: item.tone,
      label: item.label,
      href: item.href
    }));
  }

  return baseSummary;
}


app.get("/detalhamento/:year/:month", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const { year, month } = req.params;
  const currentMonth = parseInt(month);
  const currentYear = parseInt(year);

  ensureMonthlyFinanceScaffold(userId, currentMonth, currentYear);
  syncMonthlyFinanceCarryForward(userId, currentMonth, currentYear);

  const owner = getSelfPerson(userId) || ensureSelfPerson(userId, req.user?.name || req.user?.email, req.user?.email);
  if (!owner) return res.status(400).send("Ajuste seu perfil em Minha Rede antes de seguir por aqui.");

  const dashboardAlertContext = getManualDebtDueScheduleContext();

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

  const rawFinances = hydrateMonthlyFinances(userId, db.prepare(`
    SELECT *
    FROM monthly_finances
    WHERE user_id = ? AND month = ? AND year = ?
    ORDER BY CASE type WHEN 'income' THEN 0 ELSE 1 END, id ASC
  `).all(userId, currentMonth, currentYear));
  const decorateFinanceTodayKey = currentYear === dashboardAlertContext.now.year() && currentMonth === (dashboardAlertContext.now.month() + 1)
    ? dashboardAlertContext.dateKey
    : '';
  const finances = decorateMonthlyFinancesForView(rawFinances, {
    year: currentYear,
    month: currentMonth,
    todayDateKey: decorateFinanceTodayKey
  });

  const categories = db.prepare("SELECT * FROM finance_categories WHERE user_id = ? AND is_active = 1").all(userId);

  let notes = db.prepare("SELECT * FROM scratchpad WHERE user_id = ? AND month = ? AND year = ?").get(userId, currentMonth, currentYear);
  if (!notes) {
    db.prepare("INSERT INTO scratchpad (user_id, month, year, content_text, content_math) VALUES (?, ?, ?, '', '')")
      .run(userId, currentMonth, currentYear);
    notes = { content_text: '', content_math: '' };
  }

  const isClosed = isMonthClosed(userId, currentMonth, currentYear);
  const visibleCards = getVisibleCardsForMonth(userId, currentMonth, currentYear);
  const cards = getActiveCards(userId).map(({ id, name, close_day, due_day, brand }) => ({ id, name, close_day, due_day, brand }));
  const purchaseCategories = getPurchaseCategories(userId);
  const expensePaymentProgress = buildExpensePaymentProgress(userId, currentMonth, currentYear, finances);
  const cardPaymentProgress = buildSelfCardPaymentProgress(userId, currentMonth, currentYear, {
    ownerPersonId: owner.id,
    totalCents: Number(cardTotal?.total || 0)
  });

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
    const friendPendingMessageKey = pendingFriendRequests.length === 1
      ? 'dashboard.friendship.pending.single'
      : 'dashboard.friendship.pending.multi';
    const friendPendingTitle = pendingFriendRequests.length === 1
      ? `${newestFriendRequest.requester_name || 'Alguém'} quer entrar na sua rede`
      : 'Pedidos de amizade esperando resposta';
    const friendPendingDescription = pendingFriendRequests.length === 1
      ? 'Aceitando, vocês liberam cobranças automáticas dos dois lados com um ok de verdade.'
      : `${formatCountLabel(pendingFriendRequests.length, 'pedido de amizade está', 'pedidos de amizade estão')} te esperando na sua rede.`;
    const resolvedFriendPendingAlert = resolveCatalogText(friendPendingMessageKey, {
      pessoa: newestFriendRequest.requester_name || 'Alguém',
      n_pedidos: formatCountLabel(pendingFriendRequests.length, 'pedido', 'pedidos')
    }, {
      fallbackTitle: friendPendingTitle,
      fallbackBody: friendPendingDescription
    });
    alerts.push({
      type: 'info',
      icon: '💚',
      title: resolvedFriendPendingAlert.title,
      description: resolvedFriendPendingAlert.body,
      href: `/people?friendRequest=${newestFriendRequest.id}`
    });
  } else if (unreadFriendNotifications.length) {
    const newestFriendNotification = unreadFriendNotifications[0];
    const resolvedUnreadFriendAlert = resolveCatalogText('dashboard.friendship.unread', {
      titulo_reaproveitado: newestFriendNotification.title || 'Tem novidade na sua rede',
      body_reaproveitado: newestFriendNotification.body || 'Seu espaço de amizades ganhou novidade no AcerttaPay.'
    }, {
      fallbackTitle: newestFriendNotification.title || 'Tem novidade na sua rede',
      fallbackBody: newestFriendNotification.body || 'Seu espaço de amizades ganhou novidade no AcerttaPay.'
    });
    alerts.push({
      type: 'info',
      icon: '💌',
      title: resolvedUnreadFriendAlert.title,
      description: resolvedUnreadFriendAlert.body,
      href: newestFriendNotification.href || '/people'
    });
  }

  const unreadStatementImportNotifications = db.prepare(`
    SELECT id, title, body, href, created_at
    FROM notifications
    WHERE user_id = ? AND is_read = 0 AND (
      related_type = 'statement_import_job' OR
      type = 'statement_import_job_ready'
    )
    ORDER BY created_at DESC, id DESC
    LIMIT 5
  `).all(userId);

  if (unreadStatementImportNotifications.length) {
    const newestStatementImportNotification = unreadStatementImportNotifications[0];
    alerts.push({
      type: 'info',
      icon: '📄',
      title: newestStatementImportNotification.title || 'Seu PDF ficou pronto para revisao',
      description: newestStatementImportNotification.body || 'A conversao da fatura terminou e a revisao ja esta te esperando.',
      href: `/notifications/${newestStatementImportNotification.id}/open`
    });
  }

  const unreadSharedDebtNotifications = db.prepare(`
    SELECT title, body, href, created_at
    FROM notifications
    WHERE user_id = ? AND is_read = 0 AND (
      related_type IN ('shared_debt_request', 'shared_debt_batch', 'shared_debt_payment_intent') OR
      type IN ('shared_debt_request', 'shared_debt_batch', 'shared_debt_payment_intent')
    )
    ORDER BY created_at DESC
    LIMIT 5
  `).all(userId);

  if (unreadSharedDebtNotifications.length) {
    const newest = unreadSharedDebtNotifications[0];
    const sharedDebtAlertMessageKey = unreadSharedDebtNotifications.length === 1
      ? 'dashboard.shared_debt.unread.single'
      : 'dashboard.shared_debt.unread.multi';
    const sharedDebtAlertTitle = unreadSharedDebtNotifications.length === 1 ? (newest.title || 'Tem um acerto te esperando') : 'Acertos pendentes';
    const sharedDebtAlertBody = unreadSharedDebtNotifications.length === 1
      ? (newest.body || 'Você recebeu uma nova cobrança para analisar.')
      : `Você tem ${formatCountLabel(unreadSharedDebtNotifications.length, 'novidade', 'novidades')} em Acertos esperando sua olhada.`;
    const resolvedSharedDebtAlert = resolveCatalogText(sharedDebtAlertMessageKey, {
      titulo_reaproveitado: sharedDebtAlertTitle,
      body_reaproveitado: newest.body || 'Você recebeu uma nova cobrança para analisar.',
      n_novidades: formatCountLabel(unreadSharedDebtNotifications.length, 'novidade', 'novidades')
    }, {
      fallbackTitle: sharedDebtAlertTitle,
      fallbackBody: sharedDebtAlertBody
    });
    alerts.push({
      type: 'info',
      icon: '🤝',
      title: resolvedSharedDebtAlert.title,
      description: resolvedSharedDebtAlert.body,
      href: newest.href || '/shared-debts'
    });
  } else {
    const pendingSharedDebtCount = db.prepare(`
      SELECT COUNT(DISTINCT batch_id) AS total
      FROM shared_debt_requests
      WHERE receiver_user_id = ? AND status = 'pending'
    `).get(userId)?.total || 0;

    if (pendingSharedDebtCount > 0) {
      const pendingSharedDebtDescription = `${formatCountLabel(pendingSharedDebtCount, 'cobrança', 'cobranças')} ${pendingSharedDebtCount === 1 ? 'está' : 'estão'} te esperando.`;
      const resolvedPendingSharedDebtAlert = resolveCatalogText('dashboard.shared_debt.pending', {
        n_novidades: formatCountLabel(pendingSharedDebtCount, 'cobrança', 'cobranças')
      }, {
        fallbackTitle: 'Envios aguardando sua análise',
        fallbackBody: pendingSharedDebtDescription
      });
      alerts.push({
        type: 'warning',
        icon: '📨',
        title: resolvedPendingSharedDebtAlert.title,
        description: resolvedPendingSharedDebtAlert.body,
        href: '/shared-debts#received-inbox'
      });
    }
  }

  const draftSendQueueSummary = getSharedDebtSendQueueDraftSummary(userId);
  if (draftSendQueueSummary.queueCount > 0) {
    const draftQueueTitle = draftSendQueueSummary.queueCount === 1 ? 'Tem 1 envio guardado na caixa de saída' : 'Tem envios guardados na caixa de saída';
    const draftQueueDescription = `${formatCountLabel(draftSendQueueSummary.itemCount, 'cobrança está', 'cobranças estão')} prontas para disparar, somando ${formatBRLFromCents(draftSendQueueSummary.totalCents)}.`;
    const resolvedDraftQueueAlert = resolveCatalogText('dashboard.shared_debt.draft_queue', {
      n_cobrancas: formatCountLabel(draftSendQueueSummary.itemCount, 'cobrança', 'cobranças'),
      valor_total: formatBRLFromCents(draftSendQueueSummary.totalCents)
    }, {
      fallbackTitle: draftQueueTitle,
      fallbackBody: draftQueueDescription
    });
    alerts.push({
      type: 'info',
      icon: '📤',
      title: resolvedDraftQueueAlert.title,
      description: resolvedDraftQueueAlert.body,
      href: '/shared-debts#draft-queues'
    });
  }

  const privateDebtReminderSummary = getPrivateDebtReminderDashboardSummary(userId);
  if (privateDebtReminderSummary.hasActive || privateDebtReminderSummary.hasReadyToArchive) {
    const descriptionParts = [];
    if (privateDebtReminderSummary.hasActive) {
      descriptionParts.push(`${formatCountLabel(privateDebtReminderSummary.activeCount, 'lembrete privado segue', 'lembretes privados seguem')} em aberto, somando ${formatBRLFromCents(privateDebtReminderSummary.activeCents)}.`);
    }
    if (privateDebtReminderSummary.hasReadyToArchive) {
      descriptionParts.push(`${formatCountLabel(privateDebtReminderSummary.readyToArchiveCount, 'lembrete já pode', 'lembretes já podem')} ir para o arquivo.`);
    }

    const privateReminderTitle = privateDebtReminderSummary.hasActive
      ? (privateDebtReminderSummary.activeCount === 1 ? 'Tem 1 lembrete privado em aberto' : 'Tem lembretes privados em aberto')
      : (privateDebtReminderSummary.readyToArchiveCount === 1 ? 'Tem 1 lembrete privado pronto para arquivo' : 'Tem lembretes privados prontos para arquivo');
    const privateReminderDescription = `${descriptionParts.join(' ')} Esse radar existe só no seu app.`;
    const resolvedPrivateReminderAlert = resolveCatalogText('dashboard.private_reminders.radar', {
      titulo_radar: privateReminderTitle,
      descricao_radar: privateReminderDescription
    }, {
      fallbackTitle: privateReminderTitle,
      fallbackBody: privateReminderDescription
    });

    alerts.push({
      type: privateDebtReminderSummary.hasActive ? 'info' : 'success',
      icon: privateDebtReminderSummary.hasActive ? '🧾' : '🗂️',
      title: resolvedPrivateReminderAlert.title,
      description: resolvedPrivateReminderAlert.body,
      href: '/shared-debts#private-reminders'
    });
  }

  const manualDebtDueContext = dashboardAlertContext;
  const today = manualDebtDueContext.now;
  const todayManualDebtBucket = getManualDebtDueBucketsForDate(manualDebtDueContext.dateKey, { userIds: [userId] }).get(userId) || { pay: [], receive: [] };
  const todayFinanceBucket = getMonthlyFinanceBucketsForDate(manualDebtDueContext.dateKey, {
    userIds: [userId],
    month: currentMonth,
    year: currentYear
  }).get(userId) || { income: [], expense: [] };

  const sharedDebtDetailModuleSummary = getSharedDebtDetailModuleSummary(userId, currentMonth, currentYear);
  const cardHealthDetailModuleSummary = buildCardHealthDetailModuleSummary(userId, currentMonth, currentYear, {
    visibleCards,
    statementByCard,
    cardTotalsMap,
    isClosed,
    today
  });
  const sharedPurchaseProjectionDetailSummary = getAcceptedSharedPurchaseProjectionSummarySafe(userId, currentMonth, currentYear);

  if ((todayManualDebtBucket.pay || []).length) {
    alerts.push(buildManualDebtDueDashboardAlert('pay', todayManualDebtBucket.pay, manualDebtDueContext.dateKey));
  }

  if ((todayManualDebtBucket.receive || []).length) {
    alerts.push(buildManualDebtDueDashboardAlert('receive', todayManualDebtBucket.receive, manualDebtDueContext.dateKey));
  }

  const isCurrentReferenceMonth = currentYear === today.year() && currentMonth === (today.month() + 1);

  if (isCurrentReferenceMonth) {
    if ((todayFinanceBucket.income || []).length) {
      alerts.push(buildMonthlyFinanceDashboardAlert('income', todayFinanceBucket.income, {
        year: currentYear,
        month: currentMonth,
        dateKey: manualDebtDueContext.dateKey
      }));
    }

    if ((todayFinanceBucket.expense || []).length) {
      alerts.push(buildMonthlyFinanceDashboardAlert('expense', todayFinanceBucket.expense, {
        year: currentYear,
        month: currentMonth,
        dateKey: manualDebtDueContext.dateKey
      }));
    }
    const closingTodayCards = getActiveCards(userId).filter(card => {
      const closeDay = normalizeDayNumber(card.close_day);
      return closeDay && Math.min(closeDay, today.daysInMonth()) === today.date();
    });

    if (closingTodayCards.length) {
      const closingTodayTitle = closingTodayCards.length === 1 ? 'Cartão fecha hoje' : 'Cartões fecham hoje';
      const closingTodayDescription = `${closingTodayCards.map(card => card.name).join(', ')} ${closingTodayCards.length === 1 ? 'fecha' : 'fecham'} hoje.`;
      const resolvedClosingTodayAlert = resolveCatalogText('dashboard.cards.closing_today', {
        titulo_radar: closingTodayTitle,
        descricao_radar: closingTodayDescription
      }, {
        fallbackTitle: closingTodayTitle,
        fallbackBody: closingTodayDescription
      });
      alerts.push({
        type: 'info',
        icon: '⏰',
        title: resolvedClosingTodayAlert.title,
        description: resolvedClosingTodayAlert.body
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
      const dueSoonDescription = dueSoonCards.map(item => `${item.card_name} (${dayjs(item.due_date).format('DD/MM')})`).join(', ');
      const resolvedDueSoonAlert = resolveCatalogText('dashboard.cards.due_soon', {
        descricao_radar: dueSoonDescription,
        lista_cartoes_com_datas: dueSoonDescription
      }, {
        fallbackTitle: 'Vencimento em até 2 dias',
        fallbackBody: dueSoonDescription
      });
      alerts.push({
        type: 'warning',
        icon: '📅',
        title: resolvedDueSoonAlert.title,
        description: resolvedDueSoonAlert.body
      });
    }
  }

  const senderDecisionCount = db.prepare(`
    SELECT COUNT(*) AS total
    FROM shared_debt_requests
    WHERE requester_user_id = ? AND status = 'rejected_by_receiver'
  `).get(userId)?.total || 0;

  if (senderDecisionCount > 0) {
    const senderDecisionDescription = `${formatCountLabel(senderDecisionCount, 'recusa', 'recusas')} ${senderDecisionCount === 1 ? 'ainda aguarda' : 'ainda aguardam'} sua decisão para encerrar ou contestar.`;
    const resolvedSenderDecisionAlert = resolveCatalogText('dashboard.shared_debt.rejections_pending', {
      n_recusas: formatCountLabel(senderDecisionCount, 'recusa', 'recusas')
    }, {
      fallbackTitle: 'Rejeições aguardando sua decisão',
      fallbackBody: senderDecisionDescription
    });
    alerts.push({
      type: 'warning',
      icon: '⚖️',
      title: resolvedSenderDecisionAlert.title,
      description: resolvedSenderDecisionAlert.body,
      href: '/shared-debts#sent'
    });
  }

  const legacyPendingReceiptConfirmationCount = db.prepare(`
    SELECT COUNT(*) AS total
    FROM shared_debt_requests
    WHERE requester_user_id = ?
      AND status = 'accepted'
      AND payment_marked_at IS NOT NULL
  `).get(userId)?.total || 0;

  const monthlyPendingReceiptConfirmationCount = db.prepare(`
    SELECT COUNT(*) AS total
    FROM shared_debt_payment_intents
    WHERE requester_user_id = ?
      AND request_kind = 'card'
      AND status = 'reported'
  `).get(userId)?.total || 0;

  const pendingReceiptConfirmationCount = legacyPendingReceiptConfirmationCount + monthlyPendingReceiptConfirmationCount;

  if (pendingReceiptConfirmationCount > 0) {
    let title = 'Pagamentos aguardando sua confirmação';
    let description = `${formatCountLabel(pendingReceiptConfirmationCount, 'pagamento', 'pagamentos')} já ${pendingReceiptConfirmationCount === 1 ? 'foi marcado como feito e está' : 'foram marcados como feitos e estão'} esperando seu ok final.`;
    let messageKey = 'dashboard.shared_debt.payments_pending';
    const variables = {
      n_pagamentos: formatCountLabel(pendingReceiptConfirmationCount, 'pagamento', 'pagamentos'),
      n_pix_mes: formatCountLabel(monthlyPendingReceiptConfirmationCount, 'Pix do mês', 'Pix do mês'),
      dica_pix_mes: ''
    };

    if (monthlyPendingReceiptConfirmationCount > 0 && legacyPendingReceiptConfirmationCount === 0) {
      title = 'Pix do mês aguardando seu ok';
      description = `${formatCountLabel(monthlyPendingReceiptConfirmationCount, 'Pix do mês', 'Pix do mês')} já ${monthlyPendingReceiptConfirmationCount === 1 ? 'foi avisado e está' : 'foram avisados e estão'} esperando sua confirmação na carteira mensal.`;
      messageKey = 'dashboard.monthly_pix.pending_confirmation';
    } else if (monthlyPendingReceiptConfirmationCount > 0) {
      const monthlyHint = monthlyPendingReceiptConfirmationCount === 1
        ? '1 deles é Pix do mês.'
        : `${monthlyPendingReceiptConfirmationCount} deles são Pix do mês.`;
      description = `${description} ${monthlyHint}`;
      variables.dica_pix_mes = monthlyHint;
    }

    const resolvedPendingPaymentAlert = resolveCatalogText(messageKey, variables, {
      fallbackTitle: title,
      fallbackBody: description
    });

    alerts.push({
      type: 'warning',
      icon: '✅',
      title: resolvedPendingPaymentAlert.title,
      description: resolvedPendingPaymentAlert.body,
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
      const unassignedDescription = `${formatCountLabel(unassignedCount, 'item', 'itens')} deste mês ainda ${unassignedCount === 1 ? 'não foi dividido' : 'não foram divididos'} entre as pessoas.`;
      const resolvedUnassignedAlert = resolveCatalogText('dashboard.month.unassigned', {
        n_itens: formatCountLabel(unassignedCount, 'item', 'itens')
      }, {
        fallbackTitle: 'Itens sem distribuição',
        fallbackBody: unassignedDescription
      });
      alerts.push({
        type: 'warning',
        icon: '👥',
        title: resolvedUnassignedAlert.title,
        description: resolvedUnassignedAlert.body,
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
      const overdueTitle = overduePendingCards.length === 1 ? 'Fatura vencida com pendência' : 'Faturas vencidas com pendência';
      const overdueDescription = buildOverduePaymentAlertDescription(overduePendingCards);
      const resolvedOverdueAlert = resolveCatalogText('dashboard.cards.overdue', {
        titulo_radar: overdueTitle,
        descricao_radar: overdueDescription
      }, {
        fallbackTitle: overdueTitle,
        fallbackBody: overdueDescription
      });
      alerts.push({
        type: 'warning',
        icon: '🚨',
        title: resolvedOverdueAlert.title,
        description: resolvedOverdueAlert.body,
        href: `/summary/${currentYear}/${currentMonth}`
      });
    }
  }

  return safeRenderView(res, "detalhamento", {
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
    purchaseCategories,
    expensePaymentProgress,
    cardPaymentProgress,
    sharedDebtDetailModuleSummary,
    cardHealthDetailModuleSummary,
    sharedPurchaseProjectionDetailSummary
  });
});

app.get("/month/:year/:month", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const parsed = parseMonthYear(req.params.month, req.params.year);
  if (!parsed) return res.status(400).send("Esse mês/ano veio estranho por aqui.");
  const { month, year } = parsed;

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
    f_category: (req.query.f_category || "").toString().trim(),
    f_card: (req.query.f_card || "").toString().trim(),
    f_number: (req.query.f_number || "").toString().trim(),
    f_amount: (req.query.f_amount || "").toString().trim(),
    f_allocated: (req.query.f_allocated || "").toString().trim(),
    f_origin: (req.query.f_origin || "").toString().trim(),
    f_person: (req.query.f_person || "").toString().trim()
  };

  if (!["", "own", "shared"].includes(filters.f_origin)) filters.f_origin = "";

  const allocCountExpr = "(SELECT COUNT(*) FROM allocations a WHERE a.transaction_id = t.id AND a.user_id = t.user_id)";
  const selectedCsvExpr = "(SELECT GROUP_CONCAT(a.person_id) FROM allocations a WHERE a.transaction_id = t.id AND a.user_id = t.user_id)";
  const selectedSharesCsvExpr = "(SELECT GROUP_CONCAT(a.person_id || ':' || a.share_cents) FROM allocations a WHERE a.transaction_id = t.id AND a.user_id = t.user_id)";

  const where = [`((${EFFECTIVE_DUE_MONTH_SQL} = ? AND ${EFFECTIVE_DUE_YEAR_SQL} = ?) OR (${EFFECTIVE_DUE_MONTH_SQL} = ? AND ${EFFECTIVE_DUE_YEAR_SQL} = ?))`];
  const params = [month, year, month, year];

  if (filters.f_desc) {
    where.push("t.description LIKE ?");
    params.push(`%${filters.f_desc}%`);
  }

  if (filters.f_category) {
    if (filters.f_category === 'none') {
      where.push('t.purchase_category_id IS NULL');
    } else {
      const categoryId = Number(filters.f_category);
      if (categoryId > 0) {
        where.push('t.purchase_category_id = ?');
        params.push(categoryId);
      } else {
        filters.f_category = '';
      }
    }
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
    SELECT t.id, t.import_id, t.card_id, t.txn_date, t.description, t.amount_cents, t.card_number, c.name AS card_name,
           t.parent_txn_id, t.recurring_rule_id, t.due_month, t.due_year,
           t.purchase_category_id, pc.name AS purchase_category_name, COALESCE(pc.active, 0) AS purchase_category_active,
           COALESCE(t.due_month, i.month) AS month,
           COALESCE(t.due_year, i.year) AS year,
           ${allocCountExpr} AS alloc_count,
           ${selectedCsvExpr} AS selected_csv,
           ${selectedSharesCsvExpr} AS selected_shares_csv
    FROM transactions t
    LEFT JOIN cards c ON c.id = t.card_id AND c.user_id = t.user_id
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    LEFT JOIN purchase_categories pc ON pc.id = t.purchase_category_id AND pc.user_id = t.user_id
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
  const purchaseCategories = getPurchaseCategories(userId, { includeInactive: true });
  const activePurchaseCategories = purchaseCategories.filter((category) => Number(category.active || 0) !== 0);
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

  const draftQueueSummaryForMonth = getSharedDebtSendQueueDraftSummary(userId, { month, year });
  const sharedPurchaseProjectionSummary = getAcceptedSharedPurchaseProjectionSummarySafe(userId, month, year);
  const sharedPurchaseProjectionAllRows = Array.isArray(sharedPurchaseProjectionSummary.rows)
    ? sharedPurchaseProjectionSummary.rows
    : [];
  const sharedPurchaseProjections = filterSharedPurchaseProjectionRowsForMonth(sharedPurchaseProjectionAllRows, filters);
  const ownTxnsForLedger = filters.f_origin === 'shared' ? [] : txns;
  const sharedRowsForLedger = filters.f_origin === 'own' ? [] : sharedPurchaseProjections;
  const monthLedgerRows = buildMonthLedgerRows(ownTxnsForLedger, sharedRowsForLedger, { sort, dir });

  return safeRenderView(res, "month", {
    month,
    year,
    txns,
    monthLedgerRows,
    sharedPurchaseProjections,
    sharedPurchaseProjectionSummary,
    people,
    cards,
    recurringRules,
    purchaseCategories,
    activePurchaseCategories,
    formatBRLFromCents,
    sort,
    dir,
    sortLink,
    filters,
    isClosed,
    listOrder,
    draftQueueSummaryForMonth
  });
});

app.post("/txn/manual", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const { date, description, amount, card_id, first_due, installments } = req.body;
  const isRecurring = ["1", "true", "on", "sim"].includes(String(req.body.is_recurring || "").toLowerCase());
  const assignToOwner = ["1", "true", "on", "sim"].includes(String(req.body.assign_to_owner || "").toLowerCase());

  try {
    const purchaseCategoryId = resolvePurchaseCategorySelection(userId, req.body.purchase_category_id, req.body.purchase_category_custom);
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
      setFlash(req, "error", "Ajuste seu perfil em Minha Rede antes de usar 'Atribuir esse item a mim'.");
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
      const activePeople = db.prepare("SELECT id FROM people WHERE user_id = ? AND active = 1 AND COALESCE(status, CASE WHEN COALESCE(active, 1) = 0 THEN 'inactive' ELSE 'active' END) <> 'deleted'").all(userId);
      const autoAssignPersonId = assignToOwner
        ? Number(ownerPerson.id)
        : (activePeople.length === 1 ? Number(activePeople[0].id) : null);
      const insTxn = db.prepare(`
        INSERT INTO transactions (user_id, card_id, txn_date, description, amount_cents, due_month, due_year, parent_txn_id, recurring_rule_id, purchase_category_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insAlloc = db.prepare(`
        INSERT INTO allocations (user_id, transaction_id, person_id, share_cents, created_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      const insRecurring = db.prepare(`
        INSERT INTO recurring_rules (user_id, card_id, description, amount_cents, purchase_category_id, start_txn_date, start_due_month, start_due_year, active_from_month, active_from_year, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
      `);

      if (isRecurring) {
        const info = insRecurring.run(userId, cardIdNum, description, totalCents, purchaseCategoryId, date, startMonth, startYear, startMonth, startYear, nowIso(), nowIso());
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

        const info = insTxn.run(userId, cardIdNum, date, finalDesc, currentAmount, currentMonth, currentYear, currentParentTxnId, currentRecurringRuleId, purchaseCategoryId, nowIso());
        const txnIdCreated = Number(info.lastInsertRowid);
        if (!installmentRootTxnId) installmentRootTxnId = txnIdCreated;

        if (autoAssignPersonId) {
          insAlloc.run(userId, txnIdCreated, autoAssignPersonId, currentAmount, nowIso());
          createdTxnIds.push(txnIdCreated);
        }
      }
    })();

    if (createdTxnIds.length) {
      queueSharedDebtDraftsForTransactions(userId, getTransactionScopeRowsByIds(userId, createdTxnIds));
    }

    req.session.manualPurchaseDraftClearRequested = '1';

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
    syncRecurringTransactions(userId, currentYear, currentMonth, {
      referenceDate: today,
      includeCurrentMonthBeforeDate: true,
      scope: 'target_only'
    });
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
      requireSplitModeSelection: true
    });

    replaceAllocationsForTransactions(userId, targetRows, allocationPlan);

    const dispatchResult = applySharedDebtDispatchModeForTransactions(userId, targetRows, {
      deliveryMode: req.body.delivery_mode,
      originKind: detectSharedDebtOriginKindFromRows(targetRows)
    });

    const summary = dispatchResult.summary || { queueCount: 0, itemCount: 0, totalCents: 0 };
    setFlash(req, 'success', summary.itemCount > 0
      ? `Divisão salva. ${formatCountLabel(summary.itemCount, 'item foi para a caixa de saída', 'itens foram para a caixa de saída')}.`
      : 'Divisão salva. Nada entrou na caixa de saída dessa vez.');

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
    SELECT t.id, t.txn_date, t.description, t.amount_cents, t.card_id, t.import_id, t.card_number, t.parent_txn_id, t.recurring_rule_id, t.purchase_category_id,
           c.name AS card_name, pc.name AS purchase_category_name, COALESCE(pc.active, 0) AS purchase_category_active,
           COALESCE(t.due_month, i.month) as month,
           COALESCE(t.due_year, i.year) as year
    FROM transactions t
    LEFT JOIN cards c ON c.id = t.card_id AND c.user_id = t.user_id
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    LEFT JOIN purchase_categories pc ON pc.id = t.purchase_category_id AND pc.user_id = t.user_id
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
  const canEditPurchase = !Number(txn.import_id || 0) || isEditableImportedInstallmentTxn(txn);
  const initialSplitMode = inferAllocationMode(Number(txn.amount_cents || 0), allocationRows);
  const purchaseCategories = getPurchaseCategories(userId, {
    includeIds: txn.purchase_category_id ? [txn.purchase_category_id] : []
  });
  const cards = getCardsByIds(userId, [
    ...(getActiveCards(userId) || []).map((card) => Number(card.id || 0)),
    Number(txn.card_id || 0)
  ]);

  return safeRenderView(res, "txn", {
    txn,
    people,
    selected,
    selectedShares,
    initialSplitMode,
    purchaseCategories,
    cards,
    formatBRLFromCents,
    isClosed,
    hasFutureInstallments: hasFutureInstallmentsForTxn,
    canEditPurchase
  });
});

app.post("/txn/:id/edit", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const id = Number(req.params.id);
  const txn = getTransactionScopeRow(userId, id);

  const respondError = (status, message, fallbackRedirect = txn ? `/month/${txn.year}/${txn.month}` : '/month') => {
    if (isAjaxLikeRequest(req)) {
      return res.status(status).json({ ok: false, error: message });
    }
    setFlash(req, 'error', message);
    return res.redirect(fallbackRedirect);
  };

  const respondSuccess = (message, payload = {}) => {
    const redirectUrl = `/month/${payload.redirect_year || txn.year}/${payload.redirect_month || txn.month}`;
    if (isAjaxLikeRequest(req)) {
      return res.json({ ok: true, message, redirect: redirectUrl, ...payload });
    }
    setFlash(req, 'success', message);
    return res.redirect(redirectUrl);
  };

  if (!txn) return res.status(404).send("Transação não encontrada.");
  const allowImportedEdit = isEditableImportedInstallmentTxn(txn);
  if (Number(txn.import_id || 0) > 0 && !allowImportedEdit) {
    return respondError(409, 'Compras importadas ainda não entram na edição completa. Por enquanto, esse ajuste segue no combo excluir e lançar de novo.');
  }
  if (isMonthClosed(userId, txn.month, txn.year)) {
    return respondError(423, getMonthLockMessage(txn.month, txn.year));
  }

  const applyScope = String(req.body.apply_scope || 'single').trim().toLowerCase();
  const targetRows = getEditableTransactionScopeRows(userId, txn, applyScope);
  const settlementBlockMessage = buildSharedDebtCardMutationBlockerMessage(getSharedDebtCardMutationBlockersForTransactions(userId, targetRows));
  if (settlementBlockMessage) {
    return respondError(409, settlementBlockMessage, `/txn/${txn.id}`);
  }

  const lockedTarget = targetRows.find((row) => isMonthClosed(userId, row.month, row.year));
  if (lockedTarget) {
    return respondError(423, getMonthLockMessage(lockedTarget.month, lockedTarget.year));
  }

  const date = String(req.body.date || '').trim();
  const description = String(req.body.description || '').trim();
  const amountRaw = String(req.body.amount || '').trim();
  const firstDueRaw = String(req.body.first_due || '').trim();
  const cardIdNum = Number(req.body.card_id || 0);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !dayjs(date).isValid()) {
    return respondError(400, 'Me passa uma data válida para a compra seguir no trilho.');
  }
  if (!description) {
    return respondError(400, 'A descrição da compra não pode ficar em branco.');
  }
  if (!cardIdNum || Number.isNaN(cardIdNum)) {
    return respondError(400, 'Cartão inválido. Escolha um cartão válido.');
  }

  const card = db.prepare("SELECT id, name, close_day, due_day FROM cards WHERE id = ? AND user_id = ? AND COALESCE(active, 1) = 1").get(cardIdNum, userId);
  if (!card) {
    return respondError(400, 'Cartão não encontrado ou desativado.');
  }

  const amountCents = centsFromPtBrMoney(amountRaw);
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    return respondError(400, 'Me conta um valor válido para salvar essa compra.');
  }

  let purchaseCategoryId = null;
  try {
    const allowedInactiveIds = Array.from(new Set(targetRows.map((row) => Number(row.purchase_category_id || 0)).filter((value) => Number.isInteger(value) && value > 0)));
    purchaseCategoryId = resolvePurchaseCategorySelection(userId, req.body.purchase_category_id, req.body.purchase_category_custom, {
      allowInactiveIds: allowedInactiveIds
    });
  } catch (error) {
    return respondError(400, error.message || 'Não consegui entender a categoria dessa compra.');
  }

  const resolvedFirstDue = resolveFirstDueMonth({
    firstDue: firstDueRaw,
    purchaseDate: date,
    closeDay: card.close_day,
    dueDay: card.due_day
  });

  if (!resolvedFirstDue) {
    return respondError(400, 'Não consegui descobrir a fatura dessa compra.');
  }

  const [targetDueYear, targetDueMonth] = resolvedFirstDue.split('-').map(Number);
  if (!parseMonthYear(targetDueMonth, targetDueYear)) {
    return respondError(400, 'A fatura escolhida não parece válida.');
  }

  const dueShiftDelta = getMonthDelta(txn.year, txn.month, targetDueYear, targetDueMonth);
  const baseDescriptionForInstallments = normalizeImportInstallmentBaseDescription(stripTrailingInstallmentMarker(description)) || description;
  const futureScope = applyScope === 'future';
  const isRecurring = Number(txn.recurring_rule_id || 0) > 0;

  let invalidDestination = null;
  targetRows.some((row) => {
    let nextDueMonth = targetDueMonth;
    let nextDueYear = targetDueYear;
    if (futureScope) {
      if (isRecurring) {
        const offset = getMonthDelta(txn.year, txn.month, row.year, row.month);
        const shiftedDue = shiftMonth(targetDueYear, targetDueMonth, offset);
        nextDueMonth = shiftedDue.month;
        nextDueYear = shiftedDue.year;
      } else {
        const shiftedDue = shiftMonth(row.year, row.month, dueShiftDelta);
        nextDueMonth = shiftedDue.month;
        nextDueYear = shiftedDue.year;
      }
    }
    if (!isMonthClosed(userId, nextDueMonth, nextDueYear)) return false;
    invalidDestination = {
      row,
      target_month: nextDueMonth,
      target_year: nextDueYear
    };
    return true;
  });
  if (invalidDestination) {
    return respondError(423, getEditDestinationMonthLockMessage(invalidDestination.target_month, invalidDestination.target_year, {
      futureScope,
      isRecurring
    }));
  }
  const installmentMetaByTxnId = buildInstallmentMetaByTxnId(userId, txn);

  const hasEditMutations = targetRows.some((row) => {
    let nextDueMonth = targetDueMonth;
    let nextDueYear = targetDueYear;
    let nextTxnDate = date;

    if (futureScope) {
      if (isRecurring) {
        const offset = getMonthDelta(txn.year, txn.month, row.year, row.month);
        const shiftedDue = shiftMonth(targetDueYear, targetDueMonth, offset);
        nextDueMonth = shiftedDue.month;
        nextDueYear = shiftedDue.year;
        nextTxnDate = occurrenceDateFromStart(date, offset) || date;
      } else {
        const shiftedDue = shiftMonth(row.year, row.month, dueShiftDelta);
        nextDueMonth = shiftedDue.month;
        nextDueYear = shiftedDue.year;
      }
    }

    let nextDescription = description;
    const installmentMeta = installmentMetaByTxnId.get(Number(row.id || 0));
    if (installmentMeta && Number(installmentMeta.total || 1) > 1) {
      nextDescription = formatInstallmentDescription(description, installmentMeta.position, installmentMeta.total);
    }

    return String(row.txn_date || '') !== String(nextTxnDate || '')
      || String(row.description || '') !== String(nextDescription || '')
      || Number(row.amount_cents || 0) !== Number(amountCents || 0)
      || Number(row.card_id || 0) !== Number(cardIdNum || 0)
      || Number(row.month || 0) !== Number(nextDueMonth || 0)
      || Number(row.year || 0) !== Number(nextDueYear || 0)
      || Number(row.purchase_category_id || 0) !== Number(purchaseCategoryId || 0);
  });

  const recurringRuleNeedsUpdate = isRecurring && futureScope
    ? (() => {
        const rule = db.prepare(`
          SELECT card_id, description, amount_cents, purchase_category_id, start_txn_date, start_due_month, start_due_year, active_from_month, active_from_year
          FROM recurring_rules
          WHERE id = ? AND user_id = ?
        `).get(txn.recurring_rule_id, userId);
        if (!rule) return false;
        return Number(rule.card_id || 0) !== Number(cardIdNum || 0)
          || String(rule.description || '') !== String(description || '')
          || Number(rule.amount_cents || 0) !== Number(amountCents || 0)
          || Number(rule.purchase_category_id || 0) !== Number(purchaseCategoryId || 0)
          || String(rule.start_txn_date || '') !== String(date || '')
          || Number(rule.start_due_month || 0) !== Number(targetDueMonth || 0)
          || Number(rule.start_due_year || 0) !== Number(targetDueYear || 0)
          || Number(rule.active_from_month || 0) !== Number(targetDueMonth || 0)
          || Number(rule.active_from_year || 0) !== Number(targetDueYear || 0);
      })()
    : false;

  if (!hasEditMutations && !recurringRuleNeedsUpdate) {
    return respondSuccess('Nenhuma mudança detectada. Essa compra já está redondinha do jeitinho atual.', {
      affected_count: 0,
      redirect_month: txn.month,
      redirect_year: txn.year
    });
  }

  try {
    ensureAmountEditDoesNotBreakAllocations(userId, targetRows, amountCents);
  } catch (error) {
    return respondError(409, error.message || 'A divisão dessa compra precisa de uma revisão antes de trocar o valor.');
  }

  const updateTxn = db.prepare(`
    UPDATE transactions
    SET txn_date = ?, description = ?, amount_cents = ?, card_id = ?, due_month = ?, due_year = ?, purchase_category_id = ?
    WHERE id = ? AND user_id = ?
  `);
  const updateRule = db.prepare(`
    UPDATE recurring_rules
    SET card_id = ?, description = ?, amount_cents = ?, purchase_category_id = ?,
        start_txn_date = ?, start_due_month = ?, start_due_year = ?, active_from_month = ?, active_from_year = ?, updated_at = ?
    WHERE id = ? AND user_id = ?
  `);

  db.transaction(() => {
    targetRows.forEach((row) => {
      let nextDueMonth = targetDueMonth;
      let nextDueYear = targetDueYear;
      let nextTxnDate = date;

      if (futureScope) {
        if (isRecurring) {
          const offset = getMonthDelta(txn.year, txn.month, row.year, row.month);
          const shiftedDue = shiftMonth(targetDueYear, targetDueMonth, offset);
          nextDueMonth = shiftedDue.month;
          nextDueYear = shiftedDue.year;
          nextTxnDate = occurrenceDateFromStart(date, offset) || date;
        } else {
          const shiftedDue = shiftMonth(row.year, row.month, dueShiftDelta);
          nextDueMonth = shiftedDue.month;
          nextDueYear = shiftedDue.year;
        }
      }

      let nextDescription = description;
      const installmentMeta = installmentMetaByTxnId.get(Number(row.id || 0));
      if (installmentMeta && Number(installmentMeta.total || 1) > 1) {
        nextDescription = formatInstallmentDescription(baseDescriptionForInstallments || description, installmentMeta.position, installmentMeta.total);
      }

      updateTxn.run(nextTxnDate, nextDescription, amountCents, cardIdNum, nextDueMonth, nextDueYear, purchaseCategoryId, row.id, userId);
    });

    if (isRecurring && futureScope) {
      updateRule.run(
        cardIdNum,
        description,
        amountCents,
        purchaseCategoryId,
        date,
        targetDueMonth,
        targetDueYear,
        targetDueMonth,
        targetDueYear,
        nowIso(),
        txn.recurring_rule_id,
        userId
      );
    }
  })();

  const refreshedRows = getTransactionScopeRowsByIds(userId, targetRows.map((row) => row.id));
  syncEqualAllocationsForEditedTransactions(userId, refreshedRows);

  if (refreshedRows.length) {
    queueSharedDebtDraftsForTransactions(userId, refreshedRows);
  }

  const movedMonth = futureScope && dueShiftDelta !== 0;
  const message = futureScope
    ? (isRecurring
        ? `Compra atualizada nesta compra e nas próximas recorrências${movedMonth ? ', com a nova fatura já alinhada.' : '.'}`
        : `Compra atualizada nesta parcela e nas próximas${movedMonth ? ', com a fatura reencaixada junto.' : '.'}`)
    : 'Compra atualizada com sucesso.';

  return respondSuccess(message, {
    affected_count: refreshedRows.length,
    redirect_month: targetDueMonth,
    redirect_year: targetDueYear
  });
});

app.post("/txn/:id/category", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const id = Number(req.params.id);
  const txn = getTransactionScopeRow(userId, id);

  if (!txn) return res.status(404).send("Transação não encontrada.");
  if (isMonthClosed(userId, txn.month, txn.year)) {
    setFlash(req, 'error', getMonthLockMessage(txn.month, txn.year));
    return res.redirect(`/month/${txn.year}/${txn.month}`);
  }

  const applyScope = String(req.body.apply_scope || 'single').trim().toLowerCase();
  const targetRows = getPurchaseCategoryScopeRows(userId, txn, applyScope);
  const lockedTarget = targetRows.find((row) => isMonthClosed(userId, row.month, row.year));
  if (lockedTarget) {
    setFlash(req, 'error', getMonthLockMessage(lockedTarget.month, lockedTarget.year));
    return res.redirect(`/month/${txn.year}/${txn.month}`);
  }

  try {
    const allowedInactiveIds = Array.from(new Set(targetRows.map((row) => Number(row.purchase_category_id || 0)).filter((value) => Number.isInteger(value) && value > 0)));
    const purchaseCategoryId = resolvePurchaseCategorySelection(userId, req.body.purchase_category_id, req.body.purchase_category_custom, {
      allowInactiveIds: allowedInactiveIds
    });

    applyPurchaseCategoryToTransactions(userId, targetRows, purchaseCategoryId, { includeFutureRecurring: applyScope === 'future' });

    const categoryLabel = purchaseCategoryId
      ? (getPurchaseCategoryById(userId, purchaseCategoryId, { includeInactive: true })?.name || 'categoria escolhida')
      : 'sem categoria';
    const updatedRecurring = Number(txn.recurring_rule_id || 0) > 0 && applyScope === 'future';
    setFlash(req, 'success', applyScope === 'future'
      ? (updatedRecurring
          ? `Categoria atualizada para ${categoryLabel} nesta compra e nas próximas recorrências.`
          : `Categoria atualizada para ${categoryLabel} nesta compra e nas próximas parcelas.`)
      : `Categoria atualizada para ${categoryLabel}.`);
    return res.redirect(`/txn/${txn.id}`);
  } catch (error) {
    setFlash(req, 'error', error.message || 'Não consegui salvar a categoria dessa compra agora.');
    return res.redirect(`/txn/${txn.id}`);
  }
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
      requireSplitModeSelection: true
    });

    replaceAllocationsForTransactions(userId, targetRows, allocationPlan);

    const dispatchResult = applySharedDebtDispatchModeForTransactions(userId, targetRows, {
      deliveryMode: req.body.delivery_mode,
      originKind: detectSharedDebtOriginKindFromRows(targetRows)
    });

    const summary = dispatchResult.summary || { queueCount: 0, itemCount: 0, totalCents: 0 };
    setFlash(req, 'success', summary.itemCount > 0
      ? `Divisão salva. ${formatCountLabel(summary.itemCount, 'item foi para a caixa de saída', 'itens foram para a caixa de saída')}.`
      : 'Divisão salva. Nada entrou na caixa de saída dessa vez.');

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
    setFlash(req, "error", "Não achei esse lançamento por aqui.");
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
  if (!parsed) return res.status(400).json({ ok: false, error: "Esse mês/ano veio estranho por aqui." });

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
      requireSplitModeSelection: sourceRows.length === 1
    });

    replaceAllocationsForTransactions(userId, targetRows, allocationPlan);

    const dispatchResult = applySharedDebtDispatchModeForTransactions(userId, targetRows, {
      deliveryMode: req.body.delivery_mode,
      originKind: detectSharedDebtOriginKindFromRows(targetRows)
    });

    const summary = dispatchResult.summary || { queueCount: 0, itemCount: 0, totalCents: 0 };
    const message = summary.itemCount > 0
      ? `Divisão salva. ${formatCountLabel(summary.itemCount, 'item foi para a caixa de saída', 'itens foram para a caixa de saída')}.`
      : 'Divisão salva. Nada entrou na caixa de saída dessa vez.';

    return res.json({
      ok: true,
      affected_count: targetRows.length,
      source_count: sourceRows.length,
      delivery_mode: dispatchResult.deliveryMode,
      message
    });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error.message || 'Não foi possível atualizar a distribuição agora.' });
  }
});

app.post("/month/:year/:month/bulk/category", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const parsed = parseMonthYear(req.params.month, req.params.year);
  if (!parsed) return res.status(400).json({ ok: false, error: "Esse mês/ano veio estranho por aqui." });

  const sourceRows = getTransactionScopeRowsByIds(userId, req.body.txn_ids);
  if (!sourceRows.length) {
    return res.status(400).json({ ok: false, error: 'Selecione pelo menos uma compra.' });
  }

  const lockedSource = sourceRows.find((row) => isMonthClosed(userId, row.month, row.year));
  if (lockedSource) {
    return res.status(423).json({ ok: false, error: getMonthLockMessage(lockedSource.month, lockedSource.year) });
  }

  const applyScope = String(req.body.apply_scope || 'single').trim().toLowerCase();
  const targetRows = collectScopedCategoryTxnRows(userId, sourceRows, applyScope);
  const lockedTarget = targetRows.find((row) => isMonthClosed(userId, row.month, row.year));
  if (lockedTarget) {
    return res.status(423).json({ ok: false, error: getMonthLockMessage(lockedTarget.month, lockedTarget.year) });
  }

  try {
    const allowedInactiveIds = Array.from(new Set(targetRows.map((row) => Number(row.purchase_category_id || 0)).filter((value) => Number.isInteger(value) && value > 0)));
    const purchaseCategoryId = resolvePurchaseCategorySelection(userId, req.body.purchase_category_id, req.body.purchase_category_custom, {
      allowInactiveIds: allowedInactiveIds
    });

    const affectedCount = applyPurchaseCategoryToTransactions(userId, targetRows, purchaseCategoryId, { includeFutureRecurring: applyScope === 'future' });
    const categoryLabel = purchaseCategoryId
      ? (getPurchaseCategoryById(userId, purchaseCategoryId, { includeInactive: true })?.name || 'categoria escolhida')
      : 'sem categoria';

    return res.json({
      ok: true,
      affected_count: affectedCount,
      source_count: sourceRows.length,
      purchase_category_id: purchaseCategoryId,
      message: affectedCount > 1
        ? `${affectedCount} compra(s) ficaram com ${categoryLabel}.`
        : `Categoria atualizada para ${categoryLabel}.`
    });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error.message || 'Não consegui atualizar a categoria dessas compras agora.' });
  }
});

app.post("/month/:year/:month/bulk/delete", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const parsed = parseMonthYear(req.params.month, req.params.year);
  if (!parsed) return res.status(400).json({ ok: false, error: "Esse mês/ano veio estranho por aqui." });

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
  if (!parsed) return res.status(400).json({ ok: false, error: "Esse mês/ano veio estranho por aqui." });

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

  const refreshedRows = getTransactionScopeRowsByIds(userId, moveTargets.map((targetTxn) => targetTxn.id));
  if (refreshedRows.length) {
    queueSharedDebtDraftsForTransactions(userId, refreshedRows);
  }

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

function getSummaryCategoryDistribution(userId, month, year) {
  const rows = db.prepare(`
    SELECT
      t.purchase_category_id AS category_id,
      COALESCE(NULLIF(TRIM(pc.name), ''), 'Sem categoria') AS label,
      SUM(t.amount_cents) AS total_cents,
      COUNT(*) AS txn_count,
      CASE WHEN t.purchase_category_id IS NULL THEN 1 ELSE 0 END AS is_uncategorized
    FROM transactions t
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    LEFT JOIN purchase_categories pc ON pc.id = t.purchase_category_id AND pc.user_id = t.user_id
    WHERE t.user_id = ?
      AND (
        (${EFFECTIVE_DUE_MONTH_SQL} = ? AND ${EFFECTIVE_DUE_YEAR_SQL} = ?) OR
        (${EFFECTIVE_DUE_MONTH_SQL} = ? AND ${EFFECTIVE_DUE_YEAR_SQL} = ?)
      )
    GROUP BY CASE WHEN t.purchase_category_id IS NULL THEN 0 ELSE t.purchase_category_id END, label
    HAVING SUM(t.amount_cents) > 0
    ORDER BY total_cents DESC, label COLLATE NOCASE ASC
  `).all(userId, month, year, month, year);

  return rows.map((row) => ({
    id: row.category_id ? Number(row.category_id) : null,
    label: row.label,
    total_cents: row.total_cents || 0,
    txn_count: row.txn_count || 0,
    is_uncategorized: Number(row.is_uncategorized || 0) === 1
  }));
}


function getPersonShareCategoryDistribution(userId, personId, month, year) {
  const safePersonId = Number(personId || 0);
  if (!safePersonId) return [];

  const rows = db.prepare(`
    SELECT
      t.purchase_category_id AS category_id,
      COALESCE(NULLIF(TRIM(pc.name), ''), 'Sem categoria') AS label,
      SUM(a.share_cents) AS total_cents,
      COUNT(*) AS txn_count,
      CASE WHEN t.purchase_category_id IS NULL THEN 1 ELSE 0 END AS is_uncategorized
    FROM allocations a
    JOIN transactions t ON t.id = a.transaction_id AND t.user_id = a.user_id
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    LEFT JOIN purchase_categories pc ON pc.id = t.purchase_category_id AND pc.user_id = t.user_id
    WHERE a.user_id = ?
      AND a.person_id = ?
      AND a.share_cents > 0
      AND (
        (${EFFECTIVE_DUE_MONTH_SQL} = ? AND ${EFFECTIVE_DUE_YEAR_SQL} = ?) OR
        (${EFFECTIVE_DUE_MONTH_SQL} = ? AND ${EFFECTIVE_DUE_YEAR_SQL} = ?)
      )
    GROUP BY CASE WHEN t.purchase_category_id IS NULL THEN 0 ELSE t.purchase_category_id END, label
    HAVING SUM(a.share_cents) > 0
    ORDER BY total_cents DESC, label COLLATE NOCASE ASC
  `).all(userId, safePersonId, month, year, month, year);

  return rows.map((row) => ({
    id: row.category_id ? Number(row.category_id) : null,
    label: row.label,
    total_cents: row.total_cents || 0,
    txn_count: row.txn_count || 0,
    is_uncategorized: Number(row.is_uncategorized || 0) === 1
  }));
}

const MERCHANT_KEYWORD_RULES = [
  { label: 'iFood', searchTerm: 'ifood', keywords: ['ifood', 'ifd*ifood', 'ifood mercado'] },
  { label: 'Uber', searchTerm: 'uber', keywords: ['uber', 'uber trip', 'uber eats'] },
  { label: '99', searchTerm: '99', keywords: ['99app', '99 pop', '99pay', '99*'] },
  { label: 'Amazon', searchTerm: 'amazon', keywords: ['amazon', 'amzn', 'amazon br'] },
  { label: 'Mercado Livre', searchTerm: 'mercado livre', keywords: ['mercado livre', 'mercadolivre', 'ml mercado livre', 'merc libre'] },
  { label: 'Shopee', searchTerm: 'shopee', keywords: ['shopee'] },
  { label: 'Magalu', searchTerm: 'magalu', keywords: ['magazine luiza', 'magalu'] },
  { label: 'Shein', searchTerm: 'shein', keywords: ['shein'] },
  { label: 'AliExpress', searchTerm: 'aliexpress', keywords: ['aliexpress', 'ali express'] },
  { label: 'Mercado Pago', searchTerm: 'mercado pago', keywords: ['mercado pago', 'mercadopago', 'mp*'] },
  { label: 'PicPay', searchTerm: 'picpay', keywords: ['picpay'] },
  { label: 'PayPal', searchTerm: 'paypal', keywords: ['paypal'] },
  { label: 'Nubank', searchTerm: 'nubank', keywords: ['nubank', 'nu pagamentos'] },
  { label: 'Netflix', searchTerm: 'netflix', keywords: ['netflix'] },
  { label: 'Spotify', searchTerm: 'spotify', keywords: ['spotify'] },
  { label: 'YouTube', searchTerm: 'youtube', keywords: ['youtube', 'google youtube'] },
  { label: 'Google', searchTerm: 'google', keywords: ['google', 'google play'] },
  { label: 'Apple', searchTerm: 'apple', keywords: ['apple', 'apple com bill', 'itunes'] },
  { label: 'Steam', searchTerm: 'steam', keywords: ['steam'] },
  { label: 'PlayStation', searchTerm: 'playstation', keywords: ['playstation', 'psn'] },
  { label: 'Xbox', searchTerm: 'xbox', keywords: ['xbox', 'microsoft xbox'] },
  { label: 'McDonald\'s', searchTerm: 'mcdonald', keywords: ['mcdonald', 'mcdonalds', 'mc donald'] },
  { label: 'Burger King', searchTerm: 'burger king', keywords: ['burger king', 'bk brasil'] },
  { label: 'Habib\'s', searchTerm: 'habibs', keywords: ['habibs', 'habib'] },
  { label: 'Outback', searchTerm: 'outback', keywords: ['outback'] },
  { label: 'Starbucks', searchTerm: 'starbucks', keywords: ['starbucks'] },
  { label: 'Rappi', searchTerm: 'rappi', keywords: ['rappi'] },
  { label: 'Zé Delivery', searchTerm: 'ze delivery', keywords: ['ze delivery', 'zedelivery'] },
  { label: 'Airbnb', searchTerm: 'airbnb', keywords: ['airbnb'] },
  { label: 'Booking', searchTerm: 'booking', keywords: ['booking'] },
  { label: 'Decolar', searchTerm: 'decolar', keywords: ['decolar'] },
  { label: 'Localiza', searchTerm: 'localiza', keywords: ['localiza'] },
  { label: 'Shell', searchTerm: 'shell', keywords: ['shell'] },
  { label: 'Ipiranga', searchTerm: 'ipiranga', keywords: ['ipiranga'] },
  { label: 'Petrobras', searchTerm: 'petrobras', keywords: ['petrobras', 'br mania', 'posto br'] },
  { label: 'Drogasil', searchTerm: 'drogasil', keywords: ['drogasil'] },
  { label: 'Droga Raia', searchTerm: 'droga raia', keywords: ['droga raia'] },
  { label: 'Pague Menos', searchTerm: 'pague menos', keywords: ['pague menos'] },
  { label: 'Carrefour', searchTerm: 'carrefour', keywords: ['carrefour'] },
  { label: 'Assaí', searchTerm: 'assai', keywords: ['assai', 'assai atacadista'] },
  { label: 'Atacadão', searchTerm: 'atacadao', keywords: ['atacadao', 'atacadão'] },
  { label: 'Extra', searchTerm: 'extra', keywords: ['extra hiper', 'extra mercado', 'extra'] },
  { label: 'Pão de Açúcar', searchTerm: 'pao de acucar', keywords: ['pao de acucar', 'pão de açúcar', 'paodeacucar'] },
  { label: 'Americanas', searchTerm: 'americanas', keywords: ['americanas'] }
];

function normalizeMerchantText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\(\d{2}\/\d{2}\)\s*$/g, ' ')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function humanizeMerchantLabel(value) {
  return String(value || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
    .trim();
}

function buildMerchantTextTokens(normalized) {
  if (!normalized) return [];
  const cleaned = normalized
    .replace(/compra(?:\s+no)?/g, ' ')
    .replace(/debito/g, ' ')
    .replace(/credito/g, ' ')
    .replace(/parcela(?:do)?/g, ' ')
    .replace(/pagamento/g, ' ')
    .replace(/transacao/g, ' ')
    .replace(/pix/g, ' ')
    .replace(/elo/g, ' ')
    .replace(/mastercard/g, ' ')
    .replace(/visa/g, ' ')
    .replace(/deb/g, ' ')
    .replace(/cred/g, ' ')
    .replace(/online/g, ' ')
    .replace(/app/g, ' ')
    .replace(/marketplace/g, ' ')
    .replace(/brasil/g, ' ')
    .replace(/sao/g, ' ')
    .replace(/paulo/g, ' ')
    .replace(/sp/g, ' ')
    .replace(/rj/g, ' ')
    .replace(/mg/g, ' ')
    .replace(/curitiba/g, ' ')
    .replace(/belo\s+horizonte/g, ' ')
    .replace(/porto\s+alegre/g, ' ')
    .replace(/recife/g, ' ')
    .replace(/fortaleza/g, ' ')
    .replace(/salvador/g, ' ')
    .replace(/\d+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const stopwords = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'para', 'na', 'no', 'com', 'sem', 'por', 'via']);
  return cleaned.split(' ').filter((token) => token.length >= 2 && !stopwords.has(token));
}

function buildMerchantPatternFromDescription(description) {
  const normalized = normalizeMerchantText(description);
  const tokens = buildMerchantTextTokens(normalized);
  return tokens.slice(0, 2).join(' ').trim();
}

function getMerchantLearningRules(userId) {
  return db.prepare(`
    SELECT normalized_pattern, merchant_label, search_term, source_sample, status, updated_at
    FROM merchant_learning_feedback
    WHERE user_id = ?
    ORDER BY updated_at DESC, id DESC
  `).all(userId).map((row) => ({
    normalizedPattern: normalizeMerchantText(row.normalized_pattern),
    merchantLabel: String(row.merchant_label || '').trim(),
    searchTerm: String(row.search_term || '').trim(),
    sourceSample: String(row.source_sample || '').trim(),
    status: String(row.status || 'confirmed').trim().toLowerCase(),
    updatedAt: row.updated_at
  })).filter((row) => row.normalizedPattern && row.merchantLabel);
}

function upsertMerchantLearningFeedback(userId, { normalizedPattern, merchantLabel, searchTerm = '', sourceSample = '', status = 'confirmed' }) {
  const pattern = normalizeMerchantText(normalizedPattern);
  const label = humanizeMerchantLabel(merchantLabel) || 'Estabelecimento sugerido';
  const safeSearchTerm = normalizeMerchantText(searchTerm).split(' ').slice(0, 3).join(' ');
  if (!pattern) {
    const error = new Error('Padrão de agrupamento inválido.');
    error.status = 400;
    throw error;
  }
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO merchant_learning_feedback (
      user_id, normalized_pattern, merchant_label, search_term, source_sample, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, normalized_pattern) DO UPDATE SET
      merchant_label = excluded.merchant_label,
      search_term = excluded.search_term,
      source_sample = excluded.source_sample,
      status = excluded.status,
      updated_at = excluded.updated_at
  `).run(userId, pattern, label, safeSearchTerm, String(sourceSample || '').trim(), String(status || 'confirmed'), now, now);
}

function resolveMerchantFromDescription(description, userRules = []) {
  const raw = String(description || '').trim();
  const normalized = normalizeMerchantText(raw);
  if (!normalized) {
    return {
      label: 'Sem estabelecimento definido',
      normalizedLabel: 'sem estabelecimento definido',
      searchTerm: '',
      confidence: 'empty',
      raw,
      source: 'empty'
    };
  }

  for (const rule of userRules) {
    if (rule.status !== 'confirmed') continue;
    const normalizedPattern = normalizeMerchantText(rule.normalizedPattern || rule.normalized_pattern);
    if (normalizedPattern && normalized.includes(normalizedPattern)) {
      return {
        label: rule.merchantLabel,
        normalizedLabel: normalizeMerchantText(rule.merchantLabel),
        searchTerm: rule.searchTerm || normalizedPattern,
        confidence: 'high',
        raw,
        source: 'user-rule'
      };
    }
  }

  for (const rule of MERCHANT_KEYWORD_RULES) {
    const matched = rule.keywords.some((keyword) => {
      const normalizedKeyword = normalizeMerchantText(keyword).replace(/\*/g, '');
      return normalizedKeyword && normalized.includes(normalizedKeyword);
    });
    if (matched) {
      return {
        label: rule.label,
        normalizedLabel: normalizeMerchantText(rule.label),
        searchTerm: rule.searchTerm,
        confidence: 'high',
        raw,
        source: 'keyword-rule'
      };
    }
  }

  const tokens = buildMerchantTextTokens(normalized);
  const baseTokens = tokens.slice(0, 3);
  const fallbackLabel = humanizeMerchantLabel(baseTokens.join(' ')) || humanizeMerchantLabel(normalized.split(' ').slice(0, 3).join(' ')) || 'Estabelecimento variado';
  const searchTerm = baseTokens.slice(0, 2).join(' ') || normalized.split(' ').slice(0, 2).join(' ');

  return {
    label: fallbackLabel,
    normalizedLabel: normalizeMerchantText(fallbackLabel),
    searchTerm,
    confidence: baseTokens.length >= 1 ? 'medium' : 'low',
    raw,
    source: 'fallback'
  };
}

function getRelativeMonthYear(month, year, offset) {
  const baseMonth = Number(month || 1);
  const baseYear = Number(year || 1970);
  const date = new Date(Date.UTC(baseYear, Math.max(0, baseMonth - 1) + Number(offset || 0), 1));
  return {
    month: date.getUTCMonth() + 1,
    year: date.getUTCFullYear()
  };
}

function getSummaryMerchantRanking(userId, month, year, limit = 6) {
  const rows = db.prepare(`
    SELECT t.id, t.description, t.amount_cents
    FROM transactions t
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    WHERE t.user_id = ?
      AND (
        (${EFFECTIVE_DUE_MONTH_SQL} = ? AND ${EFFECTIVE_DUE_YEAR_SQL} = ?) OR
        (${EFFECTIVE_DUE_MONTH_SQL} = ? AND ${EFFECTIVE_DUE_YEAR_SQL} = ?)
      )
      AND t.amount_cents > 0
    ORDER BY t.amount_cents DESC, t.id DESC
  `).all(userId, month, year, month, year);

  const userRules = getMerchantLearningRules(userId);
  const grouped = new Map();

  rows.forEach((row) => {
    const merchant = resolveMerchantFromDescription(row.description, userRules);
    const key = merchant.normalizedLabel || normalizeMerchantText(merchant.label) || 'sem estabelecimento definido';
    const current = grouped.get(key) || {
      id: key,
      label: merchant.label,
      search_term: merchant.searchTerm || '',
      total_cents: 0,
      txn_count: 0,
      shared_total_cents: 0,
      shared_txn_count: 0,
      has_shared_origin: false,
      confidence: merchant.confidence,
      source: merchant.source,
      sample_descriptions: []
    };
    const amountCents = Number(row.amount_cents || 0);
    const isSharedOrigin = row?.origin_kind === 'shared_received' || row?.is_shared === true;
    current.total_cents += amountCents;
    current.txn_count += 1;
    if (isSharedOrigin) {
      current.shared_total_cents += amountCents;
      current.shared_txn_count += 1;
      current.has_shared_origin = true;
    }
    const sample = String(row.description || '').trim();
    if (sample && current.sample_descriptions.length < 2 && !current.sample_descriptions.includes(sample)) {
      current.sample_descriptions.push(sample);
    }
    if (!current.search_term && merchant.searchTerm) current.search_term = merchant.searchTerm;
    if (current.confidence !== 'high' && merchant.confidence === 'high') current.confidence = 'high';
    if (current.source !== 'user-rule' && merchant.source === 'user-rule') current.source = 'user-rule';
    grouped.set(key, current);
  });

  const ranking = Array.from(grouped.values())
    .sort((a, b) => {
      const totalDiff = Number(b.total_cents || 0) - Number(a.total_cents || 0);
      if (totalDiff !== 0) return totalDiff;
      return String(a.label || '').localeCompare(String(b.label || ''), 'pt-BR', { sensitivity: 'base' });
    });

  const recognizedCount = ranking.filter((item) => item.confidence === 'high').length;
  const learnedCount = ranking.filter((item) => item.source === 'user-rule').length;
  const totalCents = ranking.reduce((acc, item) => acc + Number(item.total_cents || 0), 0);
  const visible = ranking.slice(0, Math.max(1, Number(limit || 6)));
  const previousRef = getRelativeMonthYear(month, year, -1);
  const previousRows = db.prepare(`
    SELECT t.id, t.description, t.amount_cents
    FROM transactions t
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    WHERE t.user_id = ?
      AND (
        (${EFFECTIVE_DUE_MONTH_SQL} = ? AND ${EFFECTIVE_DUE_YEAR_SQL} = ?) OR
        (${EFFECTIVE_DUE_MONTH_SQL} = ? AND ${EFFECTIVE_DUE_YEAR_SQL} = ?)
      )
      AND t.amount_cents > 0
    ORDER BY t.amount_cents DESC, t.id DESC
  `).all(userId, previousRef.month, previousRef.year, previousRef.month, previousRef.year);
  const previousGrouped = new Map();
  previousRows.forEach((row) => {
    const merchant = resolveMerchantFromDescription(row.description, userRules);
    const key = merchant.normalizedLabel || normalizeMerchantText(merchant.label) || 'sem estabelecimento definido';
    previousGrouped.set(key, (previousGrouped.get(key) || 0) + Number(row.amount_cents || 0));
  });

  return {
    ranking: visible.map((item, index) => {
      const previousTotalCents = Number(previousGrouped.get(item.id) || 0);
      const deltaCents = Number(item.total_cents || 0) - previousTotalCents;
      const deltaPct = previousTotalCents > 0 ? Math.round((deltaCents / previousTotalCents) * 100) : null;
      return {
        ...item,
        position: index + 1,
        share_pct: totalCents > 0 ? Math.round((Number(item.total_cents || 0) / totalCents) * 100) : 0,
        avg_ticket_cents: Number(item.txn_count || 0) > 0 ? Math.round(Number(item.total_cents || 0) / Number(item.txn_count || 1)) : 0,
        previous_total_cents: previousTotalCents,
        delta_cents: deltaCents,
        delta_pct: deltaPct
      };
    }),
    totalCents,
    merchantCount: ranking.length,
    recognizedCount,
    learnedCount,
    totalTransactions: rows.length,
    topMerchant: ranking[0]
      ? {
          ...ranking[0],
          share_pct: totalCents > 0 ? Math.round((Number(ranking[0].total_cents || 0) / totalCents) * 100) : 0,
          avg_ticket_cents: Number(ranking[0].txn_count || 0) > 0 ? Math.round(Number(ranking[0].total_cents || 0) / Number(ranking[0].txn_count || 1)) : 0
        }
      : null
  };
}

function getSummaryMerchantSuggestions(userId, month, year, limit = 4) {
  const rows = db.prepare(`
    SELECT t.id, t.description, t.amount_cents
    FROM transactions t
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    WHERE t.user_id = ?
      AND (
        (${EFFECTIVE_DUE_MONTH_SQL} = ? AND ${EFFECTIVE_DUE_YEAR_SQL} = ?) OR
        (${EFFECTIVE_DUE_MONTH_SQL} = ? AND ${EFFECTIVE_DUE_YEAR_SQL} = ?)
      )
      AND t.amount_cents > 0
    ORDER BY t.amount_cents DESC, t.id DESC
  `).all(userId, month, year, month, year);

  const userRules = getMerchantLearningRules(userId);
  const blockedPatterns = new Set(
    userRules
      .filter((rule) => rule.status !== 'confirmed')
      .map((rule) => normalizeMerchantText(rule.normalizedPattern || rule.normalized_pattern))
      .filter(Boolean)
  );
  const confirmedPatterns = new Set(
    userRules
      .filter((rule) => rule.status === 'confirmed')
      .map((rule) => normalizeMerchantText(rule.normalizedPattern || rule.normalized_pattern))
      .filter(Boolean)
  );

  const grouped = new Map();
  rows.forEach((row) => {
    const merchant = resolveMerchantFromDescription(row.description, userRules);
    if (merchant.source !== 'fallback' || merchant.confidence !== 'medium') return;
    const pattern = buildMerchantPatternFromDescription(row.description);
    if (!pattern || pattern.length < 4 || blockedPatterns.has(pattern) || confirmedPatterns.has(pattern)) return;
    const key = `${pattern}::${merchant.normalizedLabel}`;
    const current = grouped.get(key) || {
      pattern,
      label: merchant.label,
      normalizedLabel: merchant.normalizedLabel,
      search_term: merchant.searchTerm || pattern,
      total_cents: 0,
      txn_count: 0,
      sample_descriptions: []
    };
    current.total_cents += Number(row.amount_cents || 0);
    current.txn_count += 1;
    const sample = String(row.description || '').trim();
    if (sample && current.sample_descriptions.length < 3 && !current.sample_descriptions.includes(sample)) {
      current.sample_descriptions.push(sample);
    }
    grouped.set(key, current);
  });

  return Array.from(grouped.values())
    .filter((item) => item.txn_count >= 2 || item.total_cents >= 5000)
    .sort((a, b) => {
      const totalDiff = Number(b.total_cents || 0) - Number(a.total_cents || 0);
      if (totalDiff !== 0) return totalDiff;
      return Number(b.txn_count || 0) - Number(a.txn_count || 0);
    })
    .slice(0, Math.max(1, Number(limit || 4)))
    .map((item, index) => ({
      ...item,
      position: index + 1,
      preview_label: humanizeMerchantLabel(item.pattern),
      sample_description: item.sample_descriptions[0] || ''
    }));
}

function buildMerchantRankingOverviewFromRows({ rows = [], previousRows = [], userRules = [], limit = 6 } = {}) {
  const grouped = new Map();

  rows.forEach((row) => {
    const merchant = resolveMerchantFromDescription(row.description, userRules);
    const key = merchant.normalizedLabel || normalizeMerchantText(merchant.label) || 'sem estabelecimento definido';
    const current = grouped.get(key) || {
      id: key,
      label: merchant.label,
      search_term: merchant.searchTerm || '',
      total_cents: 0,
      txn_count: 0,
      shared_total_cents: 0,
      shared_txn_count: 0,
      has_shared_origin: false,
      confidence: merchant.confidence,
      source: merchant.source,
      sample_descriptions: []
    };
    const amountCents = Number(row.amount_cents || 0);
    const isSharedOrigin = row?.origin_kind === 'shared_received' || row?.is_shared === true;
    current.total_cents += amountCents;
    current.txn_count += 1;
    if (isSharedOrigin) {
      current.shared_total_cents += amountCents;
      current.shared_txn_count += 1;
      current.has_shared_origin = true;
    }
    const sample = String(row.description || '').trim();
    if (sample && current.sample_descriptions.length < 2 && !current.sample_descriptions.includes(sample)) {
      current.sample_descriptions.push(sample);
    }
    if (!current.search_term && merchant.searchTerm) current.search_term = merchant.searchTerm;
    if (current.confidence !== 'high' && merchant.confidence === 'high') current.confidence = 'high';
    if (current.source !== 'user-rule' && merchant.source === 'user-rule') current.source = 'user-rule';
    grouped.set(key, current);
  });

  const ranking = Array.from(grouped.values())
    .sort((a, b) => {
      const totalDiff = Number(b.total_cents || 0) - Number(a.total_cents || 0);
      if (totalDiff !== 0) return totalDiff;
      return String(a.label || '').localeCompare(String(b.label || ''), 'pt-BR', { sensitivity: 'base' });
    });

  const recognizedCount = ranking.filter((item) => item.confidence === 'high').length;
  const learnedCount = ranking.filter((item) => item.source === 'user-rule').length;
  const totalCents = ranking.reduce((acc, item) => acc + Number(item.total_cents || 0), 0);
  const visible = ranking.slice(0, Math.max(1, Number(limit || 6)));
  const previousGrouped = new Map();
  previousRows.forEach((row) => {
    const merchant = resolveMerchantFromDescription(row.description, userRules);
    const key = merchant.normalizedLabel || normalizeMerchantText(merchant.label) || 'sem estabelecimento definido';
    previousGrouped.set(key, (previousGrouped.get(key) || 0) + Number(row.amount_cents || 0));
  });

  return {
    ranking: visible.map((item, index) => {
      const previousTotalCents = Number(previousGrouped.get(item.id) || 0);
      const deltaCents = Number(item.total_cents || 0) - previousTotalCents;
      const deltaPct = previousTotalCents > 0 ? Math.round((deltaCents / previousTotalCents) * 100) : null;
      return {
        ...item,
        position: index + 1,
        share_pct: totalCents > 0 ? Math.round((Number(item.total_cents || 0) / totalCents) * 100) : 0,
        avg_ticket_cents: Number(item.txn_count || 0) > 0 ? Math.round(Number(item.total_cents || 0) / Number(item.txn_count || 1)) : 0,
        previous_total_cents: previousTotalCents,
        delta_cents: deltaCents,
        delta_pct: deltaPct
      };
    }),
    totalCents,
    merchantCount: ranking.length,
    recognizedCount,
    learnedCount,
    totalTransactions: rows.length,
    topMerchant: ranking[0]
      ? {
          ...ranking[0],
          share_pct: totalCents > 0 ? Math.round((Number(ranking[0].total_cents || 0) / totalCents) * 100) : 0,
          avg_ticket_cents: Number(ranking[0].txn_count || 0) > 0 ? Math.round(Number(ranking[0].total_cents || 0) / Number(ranking[0].txn_count || 1)) : 0
        }
      : null
  };
}

function getPersonMerchantRanking(userId, personId, month, year, limit = 6, options = {}) {
  const safePersonId = Number(personId || 0);
  const extraRows = Array.isArray(options.extraRows) ? options.extraRows : [];
  const extraPreviousRows = Array.isArray(options.extraPreviousRows) ? options.extraPreviousRows : [];
  if (!safePersonId) {
    return {
      ranking: [],
      totalCents: 0,
      merchantCount: 0,
      recognizedCount: 0,
      learnedCount: 0,
      totalTransactions: 0,
      topMerchant: null
    };
  }

  const rows = db.prepare(`
    SELECT t.id, t.description, a.share_cents AS amount_cents
    FROM allocations a
    JOIN transactions t ON t.id = a.transaction_id AND t.user_id = a.user_id
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    WHERE a.user_id = ?
      AND a.person_id = ?
      AND a.share_cents > 0
      AND (
        (${EFFECTIVE_DUE_MONTH_SQL} = ? AND ${EFFECTIVE_DUE_YEAR_SQL} = ?) OR
        (${EFFECTIVE_DUE_MONTH_SQL} = ? AND ${EFFECTIVE_DUE_YEAR_SQL} = ?)
      )
    ORDER BY a.share_cents DESC, t.id DESC
  `).all(userId, safePersonId, month, year, month, year);

  const previousRef = getRelativeMonthYear(month, year, -1);
  const previousRows = db.prepare(`
    SELECT t.id, t.description, a.share_cents AS amount_cents
    FROM allocations a
    JOIN transactions t ON t.id = a.transaction_id AND t.user_id = a.user_id
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    WHERE a.user_id = ?
      AND a.person_id = ?
      AND a.share_cents > 0
      AND (
        (${EFFECTIVE_DUE_MONTH_SQL} = ? AND ${EFFECTIVE_DUE_YEAR_SQL} = ?) OR
        (${EFFECTIVE_DUE_MONTH_SQL} = ? AND ${EFFECTIVE_DUE_YEAR_SQL} = ?)
      )
    ORDER BY a.share_cents DESC, t.id DESC
  `).all(userId, safePersonId, previousRef.month, previousRef.year, previousRef.month, previousRef.year);

  return buildMerchantRankingOverviewFromRows({
    rows: rows.concat(extraRows),
    previousRows: previousRows.concat(extraPreviousRows),
    userRules: getMerchantLearningRules(userId),
    limit
  });
}

function getPersonMerchantSuggestions(userId, personId, month, year, limit = 4) {
  const safePersonId = Number(personId || 0);
  if (!safePersonId) return [];

  const rows = db.prepare(`
    SELECT t.id, t.description, a.share_cents AS amount_cents
    FROM allocations a
    JOIN transactions t ON t.id = a.transaction_id AND t.user_id = a.user_id
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    WHERE a.user_id = ?
      AND a.person_id = ?
      AND a.share_cents > 0
      AND (
        (${EFFECTIVE_DUE_MONTH_SQL} = ? AND ${EFFECTIVE_DUE_YEAR_SQL} = ?) OR
        (${EFFECTIVE_DUE_MONTH_SQL} = ? AND ${EFFECTIVE_DUE_YEAR_SQL} = ?)
      )
    ORDER BY a.share_cents DESC, t.id DESC
  `).all(userId, safePersonId, month, year, month, year);

  const userRules = getMerchantLearningRules(userId);
  const blockedPatterns = new Set(
    userRules
      .filter((rule) => rule.status !== 'confirmed')
      .map((rule) => normalizeMerchantText(rule.normalizedPattern || rule.normalized_pattern))
      .filter(Boolean)
  );
  const confirmedPatterns = new Set(
    userRules
      .filter((rule) => rule.status === 'confirmed')
      .map((rule) => normalizeMerchantText(rule.normalizedPattern || rule.normalized_pattern))
      .filter(Boolean)
  );

  const grouped = new Map();
  rows.forEach((row) => {
    const merchant = resolveMerchantFromDescription(row.description, userRules);
    if (merchant.source !== 'fallback' || merchant.confidence !== 'medium') return;
    const pattern = buildMerchantPatternFromDescription(row.description);
    if (!pattern || pattern.length < 4 || blockedPatterns.has(pattern) || confirmedPatterns.has(pattern)) return;
    const key = `${pattern}::${merchant.normalizedLabel}`;
    const current = grouped.get(key) || {
      pattern,
      label: merchant.label,
      normalizedLabel: merchant.normalizedLabel,
      search_term: merchant.searchTerm || pattern,
      total_cents: 0,
      txn_count: 0,
      sample_descriptions: []
    };
    current.total_cents += Number(row.amount_cents || 0);
    current.txn_count += 1;
    const sample = String(row.description || '').trim();
    if (sample && current.sample_descriptions.length < 3 && !current.sample_descriptions.includes(sample)) {
      current.sample_descriptions.push(sample);
    }
    grouped.set(key, current);
  });

  return Array.from(grouped.values())
    .filter((item) => item.txn_count >= 2 || item.total_cents >= 5000)
    .sort((a, b) => {
      const totalDiff = Number(b.total_cents || 0) - Number(a.total_cents || 0);
      if (totalDiff !== 0) return totalDiff;
      return Number(b.txn_count || 0) - Number(a.txn_count || 0);
    })
    .slice(0, Math.max(1, Number(limit || 4)))
    .map((item, index) => ({
      ...item,
      position: index + 1,
      preview_label: humanizeMerchantLabel(item.pattern),
      sample_description: item.sample_descriptions[0] || ''
    }));
}

function getPersonShareMonthlyTrend(userId, personId, month, year, monthsBack = 5) {
  const safePersonId = Number(personId || 0);
  const points = [];
  if (!safePersonId) return points;

  const selectTotal = db.prepare(`
    SELECT COALESCE(SUM(a.share_cents), 0) AS total_cents
    FROM allocations a
    JOIN transactions t ON t.id = a.transaction_id AND t.user_id = a.user_id
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    WHERE a.user_id = ?
      AND a.person_id = ?
      AND (
        (${EFFECTIVE_DUE_MONTH_SQL} = ? AND ${EFFECTIVE_DUE_YEAR_SQL} = ?) OR
        (${EFFECTIVE_DUE_MONTH_SQL} = ? AND ${EFFECTIVE_DUE_YEAR_SQL} = ?)
      )
  `);

  for (let offset = Number(monthsBack || 0) * -1; offset <= 0; offset += 1) {
    const ref = shiftMonth(year, month, offset);
    const row = selectTotal.get(userId, safePersonId, ref.month, ref.year, ref.month, ref.year);
    points.push({
      month: ref.month,
      year: ref.year,
      key: `${ref.year}-${String(ref.month).padStart(2, '0')}`,
      label: `${String(ref.month).padStart(2, '0')}/${ref.year}`,
      total_cents: row?.total_cents || 0,
      is_current: ref.month === Number(month) && ref.year === Number(year)
    });
  }

  return points;
}


function normalizeProjectionCategoryLabel(value) {
  const label = String(value || '').replace(/\s+/g, ' ').trim();
  return label || 'Compartilhadas';
}

function mergeSharedProjectionCategories(categories = [], sharedRows = []) {
  const map = new Map();
  const orderedKeys = [];

  (Array.isArray(categories) ? categories : []).forEach((item) => {
    const label = normalizeProjectionCategoryLabel(item?.label || item?.categoryName || 'Sem categoria');
    const key = label.toLocaleLowerCase('pt-BR');
    if (!map.has(key)) {
      orderedKeys.push(key);
      map.set(key, {
        id: item?.id ? Number(item.id) : null,
        label,
        total_cents: 0,
        txn_count: 0,
        shared_total_cents: 0,
        shared_txn_count: 0,
        own_total_cents: 0,
        own_txn_count: 0,
        is_uncategorized: !!item?.is_uncategorized,
        has_shared_origin: false
      });
    }
    const bucket = map.get(key);
    const totalCents = Math.max(0, Number(item?.total_cents || item?.totalCents || 0));
    const txnCount = Math.max(0, Number(item?.txn_count || item?.count || 0));
    bucket.total_cents += totalCents;
    bucket.own_total_cents += totalCents;
    bucket.txn_count += txnCount;
    bucket.own_txn_count += txnCount;
    if (!bucket.id && item?.id) bucket.id = Number(item.id);
    bucket.is_uncategorized = bucket.is_uncategorized || !!item?.is_uncategorized;
  });

  (Array.isArray(sharedRows) ? sharedRows : []).forEach((item) => {
    const amountCents = Math.max(0, Number(item?.amountCents || item?.totalCents || 0));
    if (!amountCents) return;
    const label = normalizeProjectionCategoryLabel(item?.categoryName || item?.purchaseCategoryName || 'Compartilhadas');
    const key = label.toLocaleLowerCase('pt-BR');
    if (!map.has(key)) {
      orderedKeys.push(key);
      map.set(key, {
        id: null,
        label,
        total_cents: 0,
        txn_count: 0,
        shared_total_cents: 0,
        shared_txn_count: 0,
        own_total_cents: 0,
        own_txn_count: 0,
        is_uncategorized: label.toLocaleLowerCase('pt-BR') === 'sem categoria',
        has_shared_origin: false
      });
    }
    const bucket = map.get(key);
    bucket.total_cents += amountCents;
    bucket.shared_total_cents += amountCents;
    bucket.txn_count += 1;
    bucket.shared_txn_count += 1;
    bucket.has_shared_origin = true;
  });

  return orderedKeys
    .map((key) => map.get(key))
    .filter((item) => Number(item.total_cents || 0) > 0)
    .sort((a, b) => {
      const totalDiff = Number(b.total_cents || 0) - Number(a.total_cents || 0);
      if (totalDiff !== 0) return totalDiff;
      return String(a.label || '').localeCompare(String(b.label || ''), 'pt-BR', { sensitivity: 'base' });
    });
}

function mergeSharedProjectionTrend(userId, trendPoints = [], currentSummary = null) {
  const points = Array.isArray(trendPoints) ? trendPoints : [];
  return points.map((point) => {
    const pointMonth = Number(point?.month || 0);
    const pointYear = Number(point?.year || 0);
    const canReuseCurrent = currentSummary
      && Number(currentSummary.month || 0) === pointMonth
      && Number(currentSummary.year || 0) === pointYear;
    const projectionSummary = canReuseCurrent
      ? currentSummary
      : getAcceptedSharedPurchaseProjectionSummarySafe(userId, pointMonth, pointYear);
    const ownCardCents = Math.max(0, Number(point?.total_cents || 0));
    const sharedCents = Math.max(0, Number(projectionSummary?.totalCents || 0));
    const sharedConfirmedCents = Math.max(0, Number(projectionSummary?.confirmedPaidCents || 0));
    const sharedPendingCents = Math.max(0, Number(projectionSummary?.pendingReportedCents || 0));
    const sharedOpenCents = Math.max(0, Number(projectionSummary?.openCents || 0));
    return {
      ...point,
      own_card_cents: ownCardCents,
      shared_cents: sharedCents,
      shared_confirmed_cents: sharedConfirmedCents,
      shared_pending_cents: sharedPendingCents,
      shared_open_cents: sharedOpenCents,
      shared_count: Math.max(0, Number(projectionSummary?.count || 0)),
      has_shared_origin: sharedCents > 0,
      total_cents: ownCardCents + sharedCents
    };
  });
}

function buildSharedProjectionMerchantRows(sharedRows = []) {
  return (Array.isArray(sharedRows) ? sharedRows : [])
    .map((item) => {
      const amountCents = Math.max(0, Number(item?.amountCents || item?.totalCents || 0));
      if (!amountCents) return null;
      return {
        id: item?.id || `shared-request:${Number(item?.sourceRequestId || 0)}`,
        description: item?.description || item?.originLabel || 'Compra compartilhada recebida',
        amount_cents: amountCents,
        origin_kind: 'shared_received',
        is_shared: true,
        requester_name: item?.requesterName || ''
      };
    })
    .filter(Boolean);
}

function getSummaryMonthlyTrend(userId, month, year, monthsBack = 5) {
  const points = [];
  const selectTotal = db.prepare(`
    SELECT COALESCE(SUM(t.amount_cents), 0) AS total_cents
    FROM transactions t
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    WHERE t.user_id = ?
      AND (
        (${EFFECTIVE_DUE_MONTH_SQL} = ? AND ${EFFECTIVE_DUE_YEAR_SQL} = ?) OR
        (${EFFECTIVE_DUE_MONTH_SQL} = ? AND ${EFFECTIVE_DUE_YEAR_SQL} = ?)
      )
  `);

  for (let offset = Number(monthsBack || 0) * -1; offset <= 0; offset += 1) {
    const ref = shiftMonth(year, month, offset);
    const row = selectTotal.get(userId, ref.month, ref.year, ref.month, ref.year);
    points.push({
      month: ref.month,
      year: ref.year,
      key: `${ref.year}-${String(ref.month).padStart(2, '0')}`,
      label: `${String(ref.month).padStart(2, '0')}/${ref.year}`,
      total_cents: row?.total_cents || 0,
      is_current: ref.month === Number(month) && ref.year === Number(year)
    });
  }

  return points;
}

function getSummaryMerchantLearningOverview(userId, month, year, activeLimit = 6, pausedLimit = 3) {
  const rules = getMerchantLearningRules(userId);
  const confirmedRules = rules.filter((rule) => rule.status === 'confirmed');
  const dismissedRules = rules.filter((rule) => rule.status !== 'confirmed');
  const monthRows = db.prepare(`
    SELECT t.description, t.amount_cents
    FROM transactions t
    LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
    WHERE t.user_id = ?
      AND (
        (${EFFECTIVE_DUE_MONTH_SQL} = ? AND ${EFFECTIVE_DUE_YEAR_SQL} = ?) OR
        (${EFFECTIVE_DUE_MONTH_SQL} = ? AND ${EFFECTIVE_DUE_YEAR_SQL} = ?)
      )
      AND t.amount_cents > 0
  `).all(userId, month, year, month, year);

  const activeRules = confirmedRules
    .map((rule) => {
      const normalizedPattern = normalizeMerchantText(rule.normalizedPattern || rule.normalized_pattern);
      let appliedTxnCount = 0;
      let appliedTotalCents = 0;
      let latestSample = rule.sourceSample || '';
      monthRows.forEach((row) => {
        const normalizedDescription = normalizeMerchantText(row.description);
        if (!normalizedPattern || !normalizedDescription.includes(normalizedPattern)) return;
        appliedTxnCount += 1;
        appliedTotalCents += Number(row.amount_cents || 0);
        if (!latestSample && row.description) latestSample = String(row.description || '').trim();
      });
      return {
        normalizedPattern,
        label: humanizeMerchantLabel(rule.merchantLabel),
        search_term: rule.searchTerm || normalizedPattern,
        source_sample: latestSample,
        applied_txn_count: appliedTxnCount,
        applied_total_cents: appliedTotalCents,
        updated_at: rule.updatedAt || null
      };
    })
    .sort((a, b) => {
      const appliedDiff = Number(b.applied_txn_count || 0) - Number(a.applied_txn_count || 0);
      if (appliedDiff !== 0) return appliedDiff;
      const centsDiff = Number(b.applied_total_cents || 0) - Number(a.applied_total_cents || 0);
      if (centsDiff !== 0) return centsDiff;
      return String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
    });

  const pausedRules = dismissedRules
    .slice(0, Math.max(0, Number(pausedLimit || 3)))
    .map((rule) => ({
      normalizedPattern: normalizeMerchantText(rule.normalizedPattern || rule.normalized_pattern),
      label: humanizeMerchantLabel(rule.merchantLabel),
      search_term: rule.searchTerm || '',
      source_sample: rule.sourceSample || '',
      updated_at: rule.updatedAt || null
    }));

  const appliedRuleTxnCount = activeRules.reduce((acc, item) => acc + Number(item.applied_txn_count || 0), 0);
  const appliedRuleTotalCents = activeRules.reduce((acc, item) => acc + Number(item.applied_total_cents || 0), 0);
  const mostAppliedRule = activeRules.find((item) => Number(item.applied_txn_count || 0) > 0) || activeRules[0] || null;

  return {
    activeCount: activeRules.length,
    pausedCount: dismissedRules.length,
    appliedRuleTxnCount,
    appliedRuleTotalCents,
    mostAppliedRule: mostAppliedRule ? {
      label: mostAppliedRule.label,
      applied_txn_count: mostAppliedRule.applied_txn_count,
      applied_total_cents: mostAppliedRule.applied_total_cents,
      search_term: mostAppliedRule.search_term || '',
      source_sample: mostAppliedRule.source_sample || ''
    } : null,
    activeRules: activeRules.slice(0, Math.max(0, Number(activeLimit || 6))),
    pausedRules,
    lastLearnedAt: confirmedRules.length ? confirmedRules[0].updatedAt || null : null
  };
}

function buildSummaryChartsPayload({ userId, month, year, cardsPanel = [], personPanel = [], unassigned = [] }) {
  const categories = getSummaryCategoryDistribution(userId, month, year);
  const monthlyTrend = getSummaryMonthlyTrend(userId, month, year, 5);
  const merchantIntel = getSummaryMerchantRanking(userId, month, year, 6);
  const merchantSuggestions = getSummaryMerchantSuggestions(userId, month, year, 4);
  const merchantLearning = getSummaryMerchantLearningOverview(userId, month, year, 6, 3);
  const totalSpentCents = cardsPanel.reduce((acc, item) => acc + Number(item?.total_cents || 0), 0);
  const totalPaidCardsCents = cardsPanel.reduce((acc, item) => acc + Number(item?.paid_cents || 0), 0);
  const totalRemainingCardsCents = cardsPanel.reduce((acc, item) => acc + (Number(item?.total_cents || 0) - Number(item?.paid_cents || 0)), 0);
  const totalPeopleAssignedCents = personPanel.reduce((acc, item) => acc + Number(item?.total_cents || 0), 0);
  const totalUnassignedCents = unassigned.reduce((acc, item) => acc + Number(item?.total_cents || 0), 0);
  const categorizedCents = categories
    .filter((item) => !item.is_uncategorized)
    .reduce((acc, item) => acc + Number(item?.total_cents || 0), 0);
  const categoryCoveragePct = totalSpentCents > 0 ? Math.round((categorizedCents / totalSpentCents) * 100) : 0;
  const topCategory = categories.find((item) => Number(item?.total_cents || 0) > 0) || null;
  const previousPoint = monthlyTrend.length > 1 ? monthlyTrend[monthlyTrend.length - 2] : null;
  const currentPoint = monthlyTrend.length > 0 ? monthlyTrend[monthlyTrend.length - 1] : null;
  const deltaCents = previousPoint ? Number(currentPoint?.total_cents || 0) - Number(previousPoint?.total_cents || 0) : 0;
  const deltaPct = previousPoint && Number(previousPoint.total_cents || 0) > 0
    ? Math.round((deltaCents / Number(previousPoint.total_cents || 0)) * 100)
    : null;
  const averageMonthlySpendCents = monthlyTrend.length
    ? Math.round(monthlyTrend.reduce((acc, point) => acc + Number(point?.total_cents || 0), 0) / monthlyTrend.length)
    : 0;
  const peakPoint = monthlyTrend.reduce((best, point) => {
    if (!best) return point;
    return Number(point?.total_cents || 0) > Number(best?.total_cents || 0) ? point : best;
  }, null);
  const monthsWithSpend = monthlyTrend.filter((point) => Number(point?.total_cents || 0) > 0).length;

  return {
    categories,
    monthlyTrend,
    kpis: {
      totalSpentCents,
      totalPaidCardsCents,
      totalRemainingCardsCents,
      totalPeopleAssignedCents,
      totalUnassignedCents,
      uncategorizedCents: Math.max(0, totalSpentCents - categorizedCents),
      categorizedCents,
      categoryCoveragePct,
      deltaCents,
      deltaPct,
      topCategory: topCategory ? {
        label: topCategory.label,
        total_cents: topCategory.total_cents,
        share_pct: totalSpentCents > 0 ? Math.round((Number(topCategory.total_cents || 0) / totalSpentCents) * 100) : 0
      } : null
    },
    insights: {
      averageMonthlySpendCents,
      peakPoint: peakPoint ? {
        month: peakPoint.month,
        year: peakPoint.year,
        label: peakPoint.label,
        total_cents: peakPoint.total_cents
      } : null,
      monthsWithSpend,
      currentVsAveragePct: averageMonthlySpendCents > 0
        ? Math.round(((Number(currentPoint?.total_cents || 0) - averageMonthlySpendCents) / averageMonthlySpendCents) * 100)
        : null,
      trackedCategories: categories.length,
      merchantCount: merchantIntel.merchantCount,
      recognizedMerchantCount: merchantIntel.recognizedCount,
      learnedMerchantCount: merchantIntel.learnedCount,
      merchantSuggestionCount: merchantSuggestions.length,
      merchantLearning: merchantLearning,
      topMerchant: merchantIntel.topMerchant
        ? {
            label: merchantIntel.topMerchant.label,
            total_cents: merchantIntel.topMerchant.total_cents,
            txn_count: merchantIntel.topMerchant.txn_count,
            share_pct: merchantIntel.topMerchant.share_pct,
            avg_ticket_cents: merchantIntel.topMerchant.avg_ticket_cents,
            search_term: merchantIntel.topMerchant.search_term || ''
          }
        : null
    },
    establishments: merchantIntel.ranking,
    establishmentSuggestions: merchantSuggestions
  };
}


function buildAnalyticsBreakdown(items, { idKey = 'id', labelKey = 'label', totalKey = 'total_cents', paidKey = 'paid_cents', activeKey = null } = {}) {
  const rows = Array.isArray(items) ? items : [];
  const normalized = rows
    .map((item) => {
      const totalCents = Math.max(0, Number(item?.[totalKey] || 0));
      const paidCents = Math.max(0, Number(item?.[paidKey] || 0));
      return {
        id: Number(item?.[idKey] || 0),
        label: String(item?.[labelKey] || '').trim(),
        total_cents: totalCents,
        paid_cents: paidCents,
        remaining_cents: Math.max(0, totalCents - paidCents),
        active: activeKey ? Number(item?.[activeKey] || 0) !== 0 : true
      };
    })
    .filter((item) => item.label && item.total_cents > 0)
    .sort((a, b) => {
      const diff = Number(b.total_cents || 0) - Number(a.total_cents || 0);
      if (diff !== 0) return diff;
      return String(a.label || '').localeCompare(String(b.label || ''), 'pt-BR', { sensitivity: 'base' });
    });

  const totalAllCents = normalized.reduce((acc, item) => acc + Number(item.total_cents || 0), 0);
  const maxCents = normalized.reduce((best, item) => Math.max(best, Number(item.total_cents || 0)), 0);

  return normalized.map((item, index) => ({
    ...item,
    position: index + 1,
    share_pct: totalAllCents > 0 ? Math.round((Number(item.total_cents || 0) / totalAllCents) * 100) : 0,
    paid_pct: Number(item.total_cents || 0) > 0 ? Math.round((Number(item.paid_cents || 0) / Number(item.total_cents || 0)) * 100) : 0,
    intensity_pct: maxCents > 0 ? Math.max(8, Math.round((Number(item.total_cents || 0) / maxCents) * 100)) : 0
  }));
}

function normalizeFinanceAnalyticsLabel(rawLabel, fallback) {
  const label = String(rawLabel || '').trim();
  return label || fallback;
}

function aggregateFinanceAnalyticsRows(rows, type) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const fallbackLabel = type === 'income' ? 'Outras entradas' : 'Outras saídas';
  const grouped = new Map();

  safeRows.forEach((row) => {
    const amountCents = Math.max(0, Number(row?.amount_cents || 0));
    if (amountCents <= 0) return;
    const label = normalizeFinanceAnalyticsLabel(row?.description || row?.category_name, fallbackLabel);
    const key = label.toLocaleLowerCase('pt-BR');
    const current = grouped.get(key) || {
      label,
      total_cents: 0,
      row_count: 0,
      item_count: 0,
      amount_mode: normalizeFinanceAmountMode(row?.amount_mode)
    };
    current.total_cents += amountCents;
    current.row_count += 1;
    current.item_count += normalizeFinanceAmountMode(row?.amount_mode) === 'variable'
      ? Math.max(1, Number(row?.item_count || 0))
      : 1;
    grouped.set(key, current);
  });

  const normalized = Array.from(grouped.values()).sort((a, b) => {
    const centsDiff = Number(b.total_cents || 0) - Number(a.total_cents || 0);
    if (centsDiff !== 0) return centsDiff;
    return String(a.label || '').localeCompare(String(b.label || ''), 'pt-BR', { sensitivity: 'base' });
  });

  const totalAllCents = normalized.reduce((acc, item) => acc + Number(item.total_cents || 0), 0);
  const maxCents = normalized.reduce((best, item) => Math.max(best, Number(item.total_cents || 0)), 0);

  return normalized.map((item, index) => ({
    ...item,
    position: index + 1,
    share_pct: totalAllCents > 0 ? Math.round((Number(item.total_cents || 0) / totalAllCents) * 100) : 0,
    intensity_pct: maxCents > 0 ? Math.max(8, Math.round((Number(item.total_cents || 0) / maxCents) * 100)) : 0
  }));
}

function getCardMonthlyTrend(userId, month, year, span = 6, { personId = null } = {}) {
  const refs = [];
  for (let offset = Math.max(0, Number(span || 6)) - 1; offset >= 0; offset -= 1) {
    refs.push(shiftMonth(year, month, -offset));
  }
  if (!refs.length) return { refs: [], cards: [] };

  const conditions = refs.map(() => `(${EFFECTIVE_DUE_MONTH_SQL} = ? AND ${EFFECTIVE_DUE_YEAR_SQL} = ?)`).join(' OR ');
  const params = refs.flatMap((ref) => [ref.month, ref.year]);
  const safePersonId = Number(personId || 0);

  const rows = safePersonId
    ? db.prepare(`
        SELECT
          t.card_id,
          c.name AS card_name,
          ${EFFECTIVE_DUE_MONTH_SQL} AS ref_month,
          ${EFFECTIVE_DUE_YEAR_SQL} AS ref_year,
          SUM(a.share_cents) AS total_cents
        FROM allocations a
        JOIN transactions t ON t.id = a.transaction_id AND t.user_id = a.user_id
        JOIN cards c ON c.id = t.card_id AND c.user_id = t.user_id
        LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
        WHERE a.user_id = ?
          AND a.person_id = ?
          AND a.share_cents > 0
          AND (${conditions})
        GROUP BY t.card_id, c.name, ref_year, ref_month
      `).all(userId, safePersonId, ...params)
    : db.prepare(`
        SELECT
          t.card_id,
          c.name AS card_name,
          ${EFFECTIVE_DUE_MONTH_SQL} AS ref_month,
          ${EFFECTIVE_DUE_YEAR_SQL} AS ref_year,
          SUM(t.amount_cents) AS total_cents
        FROM transactions t
        JOIN cards c ON c.id = t.card_id AND c.user_id = t.user_id
        LEFT JOIN imports i ON i.id = t.import_id AND i.user_id = t.user_id
        WHERE t.user_id = ?
          AND t.amount_cents > 0
          AND (${conditions})
        GROUP BY t.card_id, c.name, ref_year, ref_month
      `).all(userId, ...params);

  const refKeys = refs.map((ref) => `${ref.year}-${String(ref.month).padStart(2, '0')}`);
  const cardsById = new Map();

  rows.forEach((row) => {
    const cardId = Number(row.card_id || 0);
    if (!cardId) return;
    const key = `${row.ref_year}-${String(row.ref_month).padStart(2, '0')}`;
    if (!cardsById.has(cardId)) {
      cardsById.set(cardId, {
        card_id: cardId,
        label: String(row.card_name || '').trim() || 'Cartão sem nome',
        seriesMap: new Map(refKeys.map((refKey, index) => [
          refKey,
          {
            month: refs[index].month,
            year: refs[index].year,
            label: `${String(refs[index].month).padStart(2, '0')}/${refs[index].year}`,
            total_cents: 0,
            is_current: refs[index].month === Number(month) && refs[index].year === Number(year)
          }
        ]))
      });
    }
    const card = cardsById.get(cardId);
    const point = card.seriesMap.get(key);
    if (!point) return;
    point.total_cents = Number(row.total_cents || 0);
  });

  const cards = Array.from(cardsById.values())
    .map((card) => {
      const series = refKeys.map((key) => card.seriesMap.get(key)).filter(Boolean);
      const totalCents = series.reduce((acc, point) => acc + Number(point.total_cents || 0), 0);
      const currentPoint = series.find((point) => point.is_current) || series[series.length - 1] || null;
      const peakCents = series.reduce((best, point) => Math.max(best, Number(point.total_cents || 0)), 0);
      return {
        card_id: card.card_id,
        label: card.label,
        total_cents: totalCents,
        current_cents: Number(currentPoint?.total_cents || 0),
        peak_cents: peakCents,
        series
      };
    })
    .filter((card) => Number(card.total_cents || 0) > 0)
    .sort((a, b) => {
      const currentDiff = Number(b.current_cents || 0) - Number(a.current_cents || 0);
      if (currentDiff !== 0) return currentDiff;
      const totalDiff = Number(b.total_cents || 0) - Number(a.total_cents || 0);
      if (totalDiff !== 0) return totalDiff;
      return String(a.label || '').localeCompare(String(b.label || ''), 'pt-BR', { sensitivity: 'base' });
    });

  return { refs, cards };
}

function getMonthlyFinanceAnalytics(userId, month, year, span = 6) {
  const currentRows = hydrateMonthlyFinances(userId, db.prepare(`
    SELECT mf.*, fc.name AS category_name
    FROM monthly_finances mf
    LEFT JOIN finance_categories fc ON fc.id = mf.category_id AND fc.user_id = mf.user_id
    WHERE mf.user_id = ? AND mf.month = ? AND mf.year = ?
    ORDER BY CASE mf.type WHEN 'income' THEN 0 ELSE 1 END, mf.id ASC
  `).all(userId, month, year));

  const incomeRows = currentRows.filter((row) => row?.type === 'income' && Number(row?.amount_cents || 0) > 0);
  const expenseRows = currentRows.filter((row) => row?.type === 'expense' && Number(row?.amount_cents || 0) > 0);

  const incomeCents = incomeRows.reduce((acc, row) => acc + Number(row?.amount_cents || 0), 0);
  const expenseCents = expenseRows.reduce((acc, row) => acc + Number(row?.amount_cents || 0), 0);

  const refs = [];
  for (let offset = Math.max(0, Number(span || 6)) - 1; offset >= 0; offset -= 1) {
    refs.push(shiftMonth(year, month, -offset));
  }

  let trendRows = [];
  if (refs.length > 0) {
    const conditions = refs.map(() => '(mf.month = ? AND mf.year = ?)').join(' OR ');
    const params = refs.flatMap((ref) => [ref.month, ref.year]);
    trendRows = hydrateMonthlyFinances(userId, db.prepare(`
      SELECT mf.*, fc.name AS category_name
      FROM monthly_finances mf
      LEFT JOIN finance_categories fc ON fc.id = mf.category_id AND fc.user_id = mf.user_id
      WHERE mf.user_id = ? AND (${conditions})
    `).all(userId, ...params));
  }

  const buckets = new Map(refs.map((ref) => [
    `${ref.year}-${String(ref.month).padStart(2, '0')}`,
    {
      month: ref.month,
      year: ref.year,
      label: `${String(ref.month).padStart(2, '0')}/${ref.year}`,
      income_cents: 0,
      expense_cents: 0,
      net_cents: 0,
      is_current: ref.month === Number(month) && ref.year === Number(year)
    }
  ]));

  trendRows.forEach((row) => {
    const key = `${row.year}-${String(row.month).padStart(2, '0')}`;
    const bucket = buckets.get(key);
    if (!bucket) return;
    const amountCents = Math.max(0, Number(row?.amount_cents || 0));
    if (row?.type === 'income') bucket.income_cents += amountCents;
    if (row?.type === 'expense') bucket.expense_cents += amountCents;
  });

  const trend = refs.map((ref) => {
    const key = `${ref.year}-${String(ref.month).padStart(2, '0')}`;
    const point = buckets.get(key) || {
      month: ref.month,
      year: ref.year,
      label: `${String(ref.month).padStart(2, '0')}/${ref.year}`,
      income_cents: 0,
      expense_cents: 0,
      net_cents: 0,
      is_current: ref.month === Number(month) && ref.year === Number(year)
    };
    point.net_cents = Number(point.income_cents || 0) - Number(point.expense_cents || 0);
    return point;
  });

  const topIncome = aggregateFinanceAnalyticsRows(incomeRows, 'income');
  const topExpense = aggregateFinanceAnalyticsRows(expenseRows, 'expense');
  const positiveNetMonths = trend.filter((point) => Number(point.net_cents || 0) >= 0 && (Number(point.income_cents || 0) > 0 || Number(point.expense_cents || 0) > 0)).length;

  return {
    totals: {
      incomeCents,
      expenseCents,
      netCents: incomeCents - expenseCents,
      incomeRowCount: incomeRows.length,
      expenseRowCount: expenseRows.length,
      positiveNetMonths
    },
    incomeSources: topIncome,
    expenseSources: topExpense,
    trend,
    topIncome: topIncome[0] || null,
    topExpense: topExpense[0] || null
  };
}

function buildMonthlyReviewViewModel(userId, month, year) {
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

  const financeAnalytics = getMonthlyFinanceAnalytics(userId, month, year, 6);
  const peopleBreakdown = buildAnalyticsBreakdown(personPanel, {
    idKey: 'person_id',
    labelKey: 'person_name',
    totalKey: 'total_cents',
    paidKey: 'paid_cents',
    activeKey: 'active'
  });
  const cardBreakdown = buildAnalyticsBreakdown(cardsPanel, {
    idKey: 'card_id',
    labelKey: 'card_name',
    totalKey: 'total_cents',
    paidKey: 'paid_cents'
  });
  const summaryCharts = buildSummaryChartsPayload({ userId, month, year, cardsPanel, personPanel, unassigned });
  const selfPerson = people.find((person) => isSelfPersonRow(person)) || getSelfPerson(userId) || null;
  const selfPersonId = Number(selfPerson?.id || 0);
  const selfPersonPanel = selfPersonId
    ? personPanel.find((item) => Number(item.person_id || 0) === selfPersonId) || null
    : null;
  const privateDebtReminderSummary = getPrivateDebtReminderDashboardSummary(userId);
  const sharedPurchaseProjectionSummary = getAcceptedSharedPurchaseProjectionSummarySafe(userId, month, year);
  const sharedPurchaseProjectionRows = Array.isArray(sharedPurchaseProjectionSummary?.rows)
    ? sharedPurchaseProjectionSummary.rows
    : [];
  const personalCategoriesBase = getPersonShareCategoryDistribution(userId, selfPersonId, month, year);
  const personalCategories = mergeSharedProjectionCategories(personalCategoriesBase, sharedPurchaseProjectionRows);
  const personalMonthlyTrendBase = getPersonShareMonthlyTrend(userId, selfPersonId, month, year, 5);
  const personalMonthlyTrend = mergeSharedProjectionTrend(userId, personalMonthlyTrendBase, sharedPurchaseProjectionSummary);
  const previousSharedRef = getRelativeMonthYear(month, year, -1);
  const previousSharedPurchaseProjectionSummary = getAcceptedSharedPurchaseProjectionSummarySafe(userId, previousSharedRef.month, previousSharedRef.year);
  const previousSharedPurchaseProjectionRows = Array.isArray(previousSharedPurchaseProjectionSummary?.rows)
    ? previousSharedPurchaseProjectionSummary.rows
    : [];
  const personalMerchantRanking = getPersonMerchantRanking(userId, selfPersonId, month, year, 6, {
    extraRows: buildSharedProjectionMerchantRows(sharedPurchaseProjectionRows),
    extraPreviousRows: buildSharedProjectionMerchantRows(previousSharedPurchaseProjectionRows)
  });
  const personalMerchantSuggestions = getPersonMerchantSuggestions(userId, selfPersonId, month, year, 4);
  const cardMonthlyTrend = getCardMonthlyTrend(userId, month, year, 6);
  const personalCardShareCents = Number(selfPersonPanel?.total_cents || 0);
  const personalPaidCents = Number(selfPersonPanel?.paid_cents || 0);
  const sharedAcceptedCents = Number(sharedPurchaseProjectionSummary?.totalCents || 0);
  const sharedConfirmedPaidCents = Number(sharedPurchaseProjectionSummary?.confirmedPaidCents || 0);
  const sharedPendingReportedCents = Number(sharedPurchaseProjectionSummary?.pendingReportedCents || 0);
  const sharedOpenCents = Number(sharedPurchaseProjectionSummary?.openCents || 0);
  const sharedRemainingCents = Number(sharedPurchaseProjectionSummary?.remainingCents || 0);
  const personalTotalSpendCents = personalCardShareCents + sharedAcceptedCents;
  const personalPaidWithSharedCents = personalPaidCents + sharedConfirmedPaidCents;
  const personalRemainingCents = Math.max(0, personalCardShareCents - personalPaidCents);
  const personalRemainingWithSharedCents = personalRemainingCents + sharedRemainingCents;
  const personalFinancialSnapshot = {
    ownCardShareCents: personalCardShareCents,
    sharedAcceptedCents,
    totalCents: personalTotalSpendCents,
    ownPaidCents: personalPaidCents,
    sharedConfirmedPaidCents,
    sharedPendingReportedCents,
    sharedOpenCents,
    sharedRemainingCents
  };
  const personalCategorizedCents = personalCategories
    .filter((item) => !item.is_uncategorized)
    .reduce((acc, item) => acc + Number(item?.total_cents || 0), 0);
  const personalCoveragePct = personalTotalSpendCents > 0 ? Math.round((personalCategorizedCents / personalTotalSpendCents) * 100) : 0;
  const personalTopCategory = personalCategories.find((item) => Number(item?.total_cents || 0) > 0) || null;
  const personalPreviousPoint = personalMonthlyTrend.length > 1 ? personalMonthlyTrend[personalMonthlyTrend.length - 2] : null;
  const personalCurrentPoint = personalMonthlyTrend.length > 0 ? personalMonthlyTrend[personalMonthlyTrend.length - 1] : null;
  const personalDeltaCents = personalPreviousPoint ? Number(personalCurrentPoint?.total_cents || 0) - Number(personalPreviousPoint?.total_cents || 0) : 0;
  const personalDeltaPct = personalPreviousPoint && Number(personalPreviousPoint.total_cents || 0) > 0
    ? Math.round((personalDeltaCents / Number(personalPreviousPoint.total_cents || 0)) * 100)
    : null;
  const personalAverageMonthlySpendCents = personalMonthlyTrend.length
    ? Math.round(personalMonthlyTrend.reduce((acc, point) => acc + Number(point?.total_cents || 0), 0) / personalMonthlyTrend.length)
    : 0;
  const personalPeakPoint = personalMonthlyTrend.reduce((best, point) => {
    if (!best) return point;
    return Number(point?.total_cents || 0) > Number(best?.total_cents || 0) ? point : best;
  }, null);
  const personalTrendMap = new Map(personalMonthlyTrend.map((point) => [point.key, point]));
  const flowTrend = (financeAnalytics?.trend || []).map((point) => {
    const key = `${point.year}-${String(point.month).padStart(2, '0')}`;
    const personalPoint = personalTrendMap.get(key);
    const ownCardCents = Number(personalPoint?.own_card_cents ?? personalPoint?.total_cents ?? 0);
    const sharedCents = Number(personalPoint?.shared_cents || 0);
    const personalSpendCents = ownCardCents + sharedCents;
    const outsideExpenseCents = Number(point.expense_cents || 0);
    const totalOutflowCents = outsideExpenseCents + personalSpendCents;
    return {
      ...point,
      card_cents: ownCardCents,
      shared_cents: sharedCents,
      personal_spend_cents: personalSpendCents,
      total_outflow_cents: totalOutflowCents,
      net_cents: Number(point.income_cents || 0) - totalOutflowCents
    };
  });
  const analyticsCharts = {
    categories: personalCategories,
    monthlyTrend: personalMonthlyTrend,
    flowTrend,
    kpis: {
      totalSpentCents: personalTotalSpendCents,
      ownCardSpentCents: personalCardShareCents,
      sharedAcceptedCents,
      totalPaidCardsCents: personalPaidWithSharedCents,
      ownPaidCardsCents: personalPaidCents,
      sharedConfirmedPaidCents,
      sharedPendingReportedCents,
      totalRemainingCardsCents: personalRemainingWithSharedCents,
      ownRemainingCardsCents: personalRemainingCents,
      sharedRemainingCents,
      categorizedCents: personalCategorizedCents,
      uncategorizedCents: Math.max(0, personalTotalSpendCents - personalCategorizedCents),
      categoryCoveragePct: personalCoveragePct,
      deltaCents: personalDeltaCents,
      deltaPct: personalDeltaPct,
      topCategory: personalTopCategory ? {
        label: personalTopCategory.label,
        total_cents: personalTopCategory.total_cents,
        share_pct: personalTotalSpendCents > 0 ? Math.round((Number(personalTopCategory.total_cents || 0) / personalTotalSpendCents) * 100) : 0
      } : null
    },
    insights: {
      averageMonthlySpendCents: personalAverageMonthlySpendCents,
      peakPoint: personalPeakPoint ? {
        month: personalPeakPoint.month,
        year: personalPeakPoint.year,
        label: personalPeakPoint.label,
        total_cents: personalPeakPoint.total_cents
      } : null,
      currentVsAveragePct: personalAverageMonthlySpendCents > 0
        ? Math.round(((Number(personalCurrentPoint?.total_cents || 0) - personalAverageMonthlySpendCents) / personalAverageMonthlySpendCents) * 100)
        : null,
      trackedCategories: personalCategories.length,
      sharedAcceptedCents,
      sharedAcceptedCount: Number(sharedPurchaseProjectionSummary?.count || 0),
      includesSharedAccepted: sharedAcceptedCents > 0,
      merchantCount: personalMerchantRanking.merchantCount,
      recognizedMerchantCount: personalMerchantRanking.recognizedCount,
      learnedMerchantCount: personalMerchantRanking.learnedCount,
      merchantSuggestionCount: personalMerchantSuggestions.length,
      merchantLearning: summaryCharts?.insights?.merchantLearning || { activeRules: [], pausedRules: [] },
      topMerchant: personalMerchantRanking.topMerchant
        ? {
            label: personalMerchantRanking.topMerchant.label,
            total_cents: personalMerchantRanking.topMerchant.total_cents,
            txn_count: personalMerchantRanking.topMerchant.txn_count,
            share_pct: personalMerchantRanking.topMerchant.share_pct,
            avg_ticket_cents: personalMerchantRanking.topMerchant.avg_ticket_cents,
            search_term: personalMerchantRanking.topMerchant.search_term || '',
            shared_total_cents: personalMerchantRanking.topMerchant.shared_total_cents || 0,
            shared_txn_count: personalMerchantRanking.topMerchant.shared_txn_count || 0,
            has_shared_origin: !!personalMerchantRanking.topMerchant.has_shared_origin
          }
        : null
    },
    establishments: personalMerchantRanking.ranking,
    establishmentSuggestions: personalMerchantSuggestions.length ? personalMerchantSuggestions : (summaryCharts?.establishmentSuggestions || []),
    cardTrendByCard: cardMonthlyTrend.cards,
    sharedAccepted: {
      totalCents: sharedAcceptedCents,
      confirmedPaidCents: sharedConfirmedPaidCents,
      pendingReportedCents: sharedPendingReportedCents,
      openCents: sharedOpenCents,
      remainingCents: sharedRemainingCents,
      count: Number(sharedPurchaseProjectionSummary?.count || 0),
      byCategory: sharedPurchaseProjectionSummary?.byCategory || [],
      byRequester: sharedPurchaseProjectionSummary?.byRequester || [],
      topRows: sharedPurchaseProjectionRows.slice()
        .sort((a, b) => Number(b?.amountCents || 0) - Number(a?.amountCents || 0))
        .slice(0, 5)
    }
  };

  return {
    month,
    year,
    people,
    cards,
    rows,
    unassigned,
    cardsPanel,
    personPanel,
    peopleBreakdown,
    cardBreakdown,
    financeAnalytics,
    analyticsCharts,
    cardMonthlyTrend,
    selfPerson,
    isClosed,
    summaryCharts,
    privateDebtReminderSummary,
    sharedPurchaseProjectionSummary,
    sharedPurchaseProjectionRows,
    personalFinancialSnapshot,
    previousSummaryRef: shiftMonth(year, month, -1),
    nextSummaryRef: shiftMonth(year, month, 1)
  };
}

registerSummaryRoutes(app, {
  ensureAuthenticated,
  safeRenderView,
  formatBRLFromCents,
  parseMonthYear,
  buildMonthlyReviewViewModel,
  buildMerchantPatternFromDescription,
  humanizeMerchantLabel,
  normalizeMerchantText,
  upsertMerchantLearningFeedback,
  getFriendlyErrorDetails,
  setFlash,
  isMonthClosed,
  getMonthLockMessage,
  upsertCardStatementsForMonth,
  upsertPersonPaymentsForMonth
});

registerMonthlyEmailSummaryRoutes(app, {
  ensureAuthenticated,
  parseMonthYear,
  buildMonthlyReviewViewModel,
  buildMonthTransactionsCsvExport,
  getEmailRuntimeConfig,
  isEmailConfigured,
  normalizeEmail,
  buildAppUrl,
  createEmailDeliveryEvent,
  finalizeEmailDeliveryEvent,
  getNextEmailAttemptNo,
  sendEmail,
  logEmailFlowError,
  buildEmailTransportLogContext
});

function getPersonStatementExportData(userId, month, year, personId, itemOrder = "oldest") {
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
  const safePixPayload = String(pixPayload || '').trim();
  const hasPix = !!safePixPayload;

  let nativeShareTitle = `Resumo ${periodLabel} — ${safePersonName}`;
  let nativeShareText = '';
  let whatsappCaption = '';
  let whatsappFollowUpMessage = '';

  if (safeState === 'settled') {
    const nativeFallback = [
      `Separei o resumo de ${periodLabel} só para registro.`,
      'Já ficou tudo certinho por aqui. Obrigado por fechar essa com a gente.',
      '',
      `Total do período: ${totalLabel}.`,
      `Valor pago: ${paidLabel}.`
    ].join('\n');
    const whatsappFallback = [
      `*Oi, ${safePersonName}!* ✨`,
      '',
      `Separei o resumo de *${periodLabel}* só para registro.`,
      'Já ficou tudo certinho por aqui.',
      '',
      'A imagem com os detalhes foi logo abaixo 👇'
    ].join('\n');

    const resolvedNative = resolveCatalogText('share.summary.settled.native', {
      periodo: periodLabel,
      pessoa: safePersonName,
      valor_total: totalLabel,
      valor_pago: paidLabel
    }, {
      fallbackTitle: nativeShareTitle,
      fallbackBody: nativeFallback
    });

    nativeShareTitle = resolvedNative.title || nativeShareTitle;
    nativeShareText = resolvedNative.body;
    whatsappCaption = resolveCatalogText('whatsapp.summary.settled.caption', {
      periodo: periodLabel,
      pessoa: safePersonName
    }, {
      fallbackTitle: `Resumo ${periodLabel}`,
      fallbackBody: whatsappFallback
    }).body;
  } else if (safeState === 'partial_due') {
    const nativeFallback = [
      `Separei o resumo de ${periodLabel}. Já entrou ${paidLabel} e ainda falta ${remainingLabel} para fechar tudo.`,
      'A imagem vai junto com os detalhes.'
    ].join('\n\n');
    const nativeFallbackWithPix = [
      nativeFallback,
      'Pix copia e cola do saldo restante:',
      safePixPayload
    ].join('\n\n');
    const whatsappFallback = [
      `*Oi, ${safePersonName}!* 💳`,
      '',
      `Separei o resumo de *${periodLabel}*. Já entrou *${paidLabel}* e ainda falta *${remainingLabel}* para fechar tudo.`,
      '',
      'A imagem com os detalhes foi logo abaixo 👇'
    ].join('\n');
    const whatsappFollowFallback = [
      `Pix copia e cola do saldo restante (${remainingLabel}):`,
      '',
      safePixPayload,
      '',
      'Quando pagar, me manda o comprovante por aqui 💸'
    ].join('\n');

    const resolvedNative = resolveCatalogText(hasPix ? 'share.summary.partial.native.with_pix' : 'share.summary.partial.native.no_pix', {
      periodo: periodLabel,
      pessoa: safePersonName,
      valor_pago: paidLabel,
      valor_restante: remainingLabel,
      pix_payload: safePixPayload
    }, {
      fallbackTitle: nativeShareTitle,
      fallbackBody: hasPix ? nativeFallbackWithPix : nativeFallback
    });

    nativeShareTitle = resolvedNative.title || nativeShareTitle;
    nativeShareText = resolvedNative.body;
    whatsappCaption = resolveCatalogText('whatsapp.summary.partial.caption', {
      periodo: periodLabel,
      pessoa: safePersonName,
      valor_pago: paidLabel,
      valor_restante: remainingLabel
    }, {
      fallbackTitle: `Resumo ${periodLabel}`,
      fallbackBody: whatsappFallback
    }).body;

    if (hasPix) {
      whatsappFollowUpMessage = resolveCatalogText('whatsapp.summary.partial.followup', {
        valor_restante: remainingLabel,
        pix_payload: safePixPayload
      }, {
        fallbackTitle: 'Pix copia e cola do saldo restante',
        fallbackBody: whatsappFollowFallback
      }).body;
    }
  } else {
    const nativeFallback = [
      `Separei o resumo de ${periodLabel}. O total em aberto ficou em ${remainingLabel}.`,
      'A imagem vai junto com os detalhes.'
    ].join('\n\n');
    const nativeFallbackWithPix = [
      nativeFallback,
      'Pix copia e cola para facilitar o acerto:',
      safePixPayload
    ].join('\n\n');
    const whatsappFallback = [
      `*Oi, ${safePersonName}!* 💳`,
      '',
      `Separei o resumo de *${periodLabel}*. O total em aberto ficou em *${remainingLabel}*.`,
      '',
      'A imagem com os detalhes foi logo abaixo 👇'
    ].join('\n');
    const whatsappFollowFallback = [
      `Pix copia e cola para fechar esse resumo (${remainingLabel}):`,
      '',
      safePixPayload,
      '',
      'Quando pagar, me manda o comprovante por aqui 💸'
    ].join('\n');

    const resolvedNative = resolveCatalogText(hasPix ? 'share.summary.open.native.with_pix' : 'share.summary.open.native.no_pix', {
      periodo: periodLabel,
      pessoa: safePersonName,
      valor_restante: remainingLabel,
      pix_payload: safePixPayload
    }, {
      fallbackTitle: nativeShareTitle,
      fallbackBody: hasPix ? nativeFallbackWithPix : nativeFallback
    });

    nativeShareTitle = resolvedNative.title || nativeShareTitle;
    nativeShareText = resolvedNative.body;
    whatsappCaption = resolveCatalogText('whatsapp.summary.open.caption', {
      periodo: periodLabel,
      pessoa: safePersonName,
      valor_restante: remainingLabel
    }, {
      fallbackTitle: `Resumo ${periodLabel}`,
      fallbackBody: whatsappFallback
    }).body;

    if (hasPix) {
      whatsappFollowUpMessage = resolveCatalogText('whatsapp.summary.open.followup', {
        valor_restante: remainingLabel,
        pix_payload: safePixPayload
      }, {
        fallbackTitle: 'Pix copia e cola do resumo',
        fallbackBody: whatsappFollowFallback
      }).body;
    }
  }

  return {
    nativeShareTitle,
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
      pix.reason = 'Salve o Pix do seu perfil em Minha Rede para este resumo já sair com copia e cola.';
    } else if (!ownerPixProfile.pixValid) {
      pix.reason = ownerPixProfile.pixReason || 'Seu Pix ainda precisa de um ajuste em Minha Rede.';
    } else {
      try {
        const txid = buildStatementSharePixTxid(userId, person?.id, month, year, safeRemainingCents);
        const description = sanitizePixText(`RESUMO ${periodLabel} ${person?.name || ''}`, { max: 72 })
          || sanitizePixText(`RESUMO ${periodLabel}`, { max: 72 });
        const payload = buildPixPayload({
          keyType: ownerPixProfile.pixKeyType,
          keyValue: ownerPixProfile.pixKeyValue,
          merchantName: ownerPixProfile.pixMerchantName || ownerPixProfile.ownerName || 'ACERTTAPAY',
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
  const whatsappAutoSecondMessage = pix.available
    ? resolveCatalogText('whatsapp.summary.auto.second.pix_only', {
      pix_payload: pix.payload
    }, {
      fallbackTitle: 'Automação do WhatsApp — Pix bruto',
      fallbackBody: pix.payload
    }).body
    : '';

  return {
    state,
    periodLabel,
    shareTitle: messages.nativeShareTitle || `Resumo ${periodLabel} — ${person?.name || 'AcerttaPay'}`,
    nativeShareText: messages.nativeShareText,
    whatsappCaption: messages.whatsappCaption,
    whatsappFollowUpMessage: messages.whatsappFollowUpMessage,
    whatsappAutoSecondMessage,
    pix
  };
}

// WhatsApp e compartilhamento
registerSocialShareRoutes(app, {
  ensureAuthenticated,
  safeRenderView,
  setFlash,
  formatBRLFromCents,
  isAdminUser,
  parseMonthYear,
  parseChronologicalOrder,
  getPersonStatementExportData,
  buildSharePixContext,
  decoratePersonPhoneForView,
  DEFAULT_PHONE_COUNTRY,
  normalizePhoneForWhatsapp,
  getSettingText
});

// --- ROTAS DO detalhamento ---

registerFinancesRoutes(app, {
  ensureAuthenticated,
  db,
  serializeFinanceForApi,
  isMonthClosed,
  normalizeFinanceType,
  normalizeFinanceAmountMode,
  sanitizeFinanceDescription,
  sanitizeVariableFinanceItems,
  normalizeFinanceDayOfMonth,
  normalizeFinanceScheduleKind,
  sumFinanceItemCents,
  createMonthlyFinanceCarryKey,
  getFriendlyErrorMessage,
  getFriendlyErrorDetails,
  getFinanceByIdForUser,
  getFinanceItemsByFinanceId,
  normalizePositiveInteger,
  normalizeFinancePaidFlag,
  buildExpensePaymentProgress,
  normalizeMonthlyFinanceCarryKey,
  syncFutureLegacyFixedFinanceScheduleFromRow,
  getMonthLockMessage,
  nowIso
});

// ===== PÁGINA DE ADMIN (GERENCIAR USUÁRIOS) =====
registerAdminCoreRoutes(app, {
  ensureAuthenticated,
  backupRestoreUpload,
  renderAdmin,
  isAdminUser,
  getSettingSection,
  getSettingDefinitionsBySection,
  getSettingValue,
  sanitizeSettingValue,
  resolveConfiguredDirectory,
  DEFAULT_PRIMARY_BACKUP_DIR,
  DEFAULT_SECONDARY_BACKUP_DIR,
  updateAppSettings,
  isGoogleAuthConfigured,
  buildPushAdminState,
  getBackupRuntimeConfig,
  getEmailRuntimeConfig,
  isEmailConfigured,
  verifyEmailTransport,
  logEmailRuntimeIssue,
  logEmailFlowError,
  buildEmailTransportLogContext,
  getUserRecord,
  sendAdminTestEmail,
  getFriendlyErrorMessage,
  buildGoogleBackupAuthUrl,
  exchangeGoogleBackupCodeForTokens,
  getInternalSettingValue,
  fetchGoogleBackupProfile,
  ensureGoogleBackupFolder,
  setInternalSettings,
  currentConfigTimestamp,
  BACKUP_GOOGLE_REFRESH_TOKEN_KEY,
  BACKUP_GOOGLE_CONNECTED_EMAIL_KEY,
  BACKUP_GOOGLE_CONNECTED_AT_KEY,
  BACKUP_GOOGLE_SCOPE_KEY,
  BACKUP_GOOGLE_FOLDER_ID_KEY,
  BACKUP_GOOGLE_FOLDER_NAME_META_KEY,
  clearInternalSettings,
  createServerBackup,
  formatBytes,
  restoreServerBackupFromZip,
  backupRunsSelectById,
  fs,
  fsp,
  path,
  appRoot: __dirname,
  automationService: automationApiService
});

registerAutomationApiRoutes(app, {
  service: automationApiService
});

registerAdminMessagesRoutes(app, {
  ensureAuthenticated,
  upload,
  isAdminUser,
  renderAdminMessages,
  normalizeAdminMessageActionFilters,
  getAdminMessageImportPreview,
  buildMessageCsvExport,
  getFriendlyErrorMessage,
  clearAdminMessageImportPreview,
  buildImportPreviewFromBuffer,
  setAdminMessageImportPreview,
  applyImportPreview,
  setFlash,
  buildAdminMessagesPath,
  saveMessageTemplateCustomization,
  resetMessageTemplateCustomization,
  buildMessagePreview,
  buildPushTestPayload,
  isPushConfigured,
  webPush,
  ADMIN_MESSAGE_PUSH_TEST_RATE_LIMIT_MS,
  adminMessagePushTestRateLimit,
  upsertPushSubscription,
  removePushSubscriptionForUser
});

app.post("/admin/add-user", ensureAuthenticated, async (req, res) => {
  const userId = req.user.id;
  const safeEmail = normalizeEmail(req.body.email);
  const safeName = String(req.body.name || '').trim();
  const safeRole = String(req.body.role || 'user') === 'admin' ? 'admin' : 'user';
  const canImport = req.body.can_import ? 1 : 0;
  const wantsWelcomeEmail = !!req.body.send_welcome_email;
  const safeAdminMessage = sanitizeAdminEmailMessage(req.body.welcome_admin_message);

  if (!isAdminUser(userId)) {
    return res.status(403).send('Acesso negado.');
  }

  if (!safeEmail || !safeEmail.includes('@')) {
    return renderAdmin(res, { error: 'Esse e-mail não parece válido.' });
  }

  const duplicatedUser = db.prepare('SELECT id FROM users WHERE email = ?').get(safeEmail);
  if (duplicatedUser) {
    return renderAdmin(res, { error: 'Esse e-mail já está autorizado por aqui. Dá uma conferida antes de convidar de novo.' });
  }

  try {
    db.prepare("INSERT INTO users (email, name, role, can_import, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(safeEmail, safeName || safeEmail.split('@')[0], safeRole, canImport, dayjs().toISOString());

    const newUser = db.prepare("SELECT id, email, name, role, can_import FROM users WHERE email = ?").get(safeEmail);
    const insertCat = db.prepare("INSERT OR IGNORE INTO finance_categories (user_id, name) VALUES (?, ?)");
    DEFAULT_FINANCE_CATEGORIES.forEach(cat => insertCat.run(newUser.id, cat));
    ensurePurchaseCategoriesForUser(newUser.id);

    let success = `Acesso para ${safeEmail} criado com sucesso!`;
    const emailConfig = getEmailRuntimeConfig();
    if (wantsWelcomeEmail) {
      if (!emailConfig.enabled) {
        success += ' O acesso foi criado, mas o envio automático de boas-vindas está pausado nas configurações.';
      } else {
        try {
          const currentAdmin = getUserRecord(userId, { includeDeleted: false }) || req.user;
          await sendWelcomeEmailToUser({
            targetUser: newUser,
            createdByUser: currentAdmin,
            customMessage: safeAdminMessage,
            req
          });
          success += ' O e-mail de boas-vindas já saiu no embalo.';
        } catch (emailError) {
          if (emailError?.code === 'EMAIL_RUNTIME_MISSING') {
            logEmailRuntimeIssue('admin-create-user-welcome');
          }
          logEmailFlowError('admin-create-user-welcome', emailError, {
            adminUserId: userId,
            targetUserId: newUser?.id || null,
            recipientEmail: newUser?.email || null
          });
          success += ` O acesso foi criado, mas o e-mail tropeçou: ${getFriendlyErrorMessage(emailError, { defaultMessage: 'não consegui mandar agora' })}`;
        }
      }
    }

    return renderAdmin(res, { success, activeSection: 'access' });
  } catch (err) {
    return renderAdmin(res, { error: getFriendlyErrorMessage(err, { defaultMessage: 'Não consegui adicionar esse usuário agora.' }), activeSection: 'access' });
  }
});

app.post('/admin/users/:id/resend-welcome', ensureAuthenticated, async (req, res) => {
  const userId = req.user.id;
  const targetUserId = Number(req.params.id);
  if (!isAdminUser(userId)) {
    return res.status(403).send('Acesso negado.');
  }

  if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
    return renderAdmin(res, { error: 'Não encontrei esse usuário por aqui.', activeSection: 'access' });
  }

  const targetUser = getUserRecord(targetUserId, { includeDeleted: false });
  if (!targetUser) {
    return renderAdmin(res, { error: 'Não achei esse usuário por aqui.', activeSection: 'access' });
  }

  try {
    const currentAdmin = getUserRecord(userId, { includeDeleted: false }) || req.user;
    await sendWelcomeEmailToUser({
      targetUser,
      createdByUser: currentAdmin,
      customMessage: '',
      req
    });
    return renderAdmin(res, {
      success: `E-mail de boas-vindas reenviado para ${targetUser.email}. Agora o convite foi de novo para o correio.`,
      activeSection: 'access'
    });
  } catch (error) {
    if (error?.code === 'EMAIL_RUNTIME_MISSING') {
      logEmailRuntimeIssue('admin-resend-welcome');
    }
    logEmailFlowError('admin-resend-welcome', error, {
      adminUserId: userId,
      targetUserId,
      recipientEmail: targetUser?.email || null,
      ...buildEmailTransportLogContext(getEmailRuntimeConfig())
    });
    return renderAdmin(res, {
      error: getFriendlyErrorMessage(error, { defaultMessage: 'Não consegui reenviar o e-mail de boas-vindas agora.' }),
      activeSection: 'access'
    });
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
    return renderAdmin(res, { error: 'Não encontrei esse usuário por aqui.' });
  }

  if (!safeEmail || !safeEmail.includes('@')) {
    return renderAdmin(res, { error: 'Esse e-mail não parece válido.' });
  }

  const targetUser = getUserRecord(targetUserId);
  if (!targetUser) {
    return renderAdmin(res, { error: 'Não achei esse usuário por aqui.' });
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

    return renderAdmin(res, { success: 'Acesso atualizado com sucesso!' });
  } catch (err) {
    return renderAdmin(res, { error: getFriendlyErrorMessage(err, { defaultMessage: 'Não consegui atualizar esse usuário agora.' }) });
  }
});

app.post("/admin/remove-user/:id", ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const targetUserId = Number(req.params.id);

  if (!isAdminUser(userId)) {
    return res.status(403).send('Acesso negado.');
  }

  if (String(userId) === String(targetUserId)) {
    return renderAdmin(res, { error: 'Você não pode remover sua própria conta.' });
  }

  const targetUser = getUserRecord(targetUserId, { includeDeleted: true });
  if (!targetUser) {
    return renderAdmin(res, { error: 'Não achei esse usuário por aqui.' });
  }

  if (isDeletedUserRow(targetUser)) {
    return renderAdmin(res, { success: 'Esse acesso já tinha sido removido antes.' });
  }

  const blockers = getUserDeletionBlockers(targetUserId);
  if (blockers.hasDraftQueue) {
    return renderAdmin(res, { error: 'Esse acesso ainda tem caixa de saída com acerto guardado. Envie ou descarte esses rascunhos antes de excluir.' });
  }

  if (blockers.hasOpenPixIntent) {
    return renderAdmin(res, { error: 'Esse acesso ainda participa de um Pix do mês em andamento. Fecha esse fluxo primeiro e depois a exclusão fica liberada.' });
  }

  if (blockers.hasOpenRequests) {
    return renderAdmin(res, { error: 'Esse acesso ainda está ligado a acertos em aberto. Resolve essas pendências antes de excluir.' });
  }

  try {
    offboardUserAccess(userId, targetUserId);
    return renderAdmin(res, { success: 'Acesso removido da área ativa com histórico preservado. Mais tarde, o mesmo e-mail pode ser autorizado de novo como um novo acesso.' });
  } catch (err) {
    return renderAdmin(res, { error: getFriendlyErrorMessage(err, { defaultMessage: 'Não consegui remover esse acesso agora.' }) });
  }
});

app.use((req, res, next) => {
  if (res.headersSent) return next();
  res.status(404);
  return safeRenderView(res, 'error', {
    title: 'AcerttaPay | Opa',
    errorTitle: 'Deu uma tropeçadinha no caminho',
    errorMessage: 'Essa página não apareceu por aqui. Bora voltar para um cantinho conhecido do app?',
    actionHref: req?.isAuthenticated?.() ? (res.locals.dashboardHref || '/') : '/login',
    actionLabel: req?.isAuthenticated?.() ? 'Voltar para o app' : 'Ir para o login'
  });
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

const DEFAULT_PORT = BOOTSTRAP_PORT || 3001;

function createApp() {
  return app;
}

function startSchedulers() {
  startCardDueTodayPushScheduler();
  startManualDebtDueScheduler();
  restartRecurringScheduler();
  restartBackupScheduler();
}

function stopSchedulers() {
  clearCardDueTodayPushScheduler();
  clearManualDebtDueScheduler();
  clearRecurringScheduler();
  clearBackupScheduler();
}

function resolveListeningPort(server, fallbackPort) {
  if (server && typeof server.address === 'function') {
    const address = server.address();
    if (address && typeof address === 'object' && address.port) {
      return address.port;
    }
  }
  return fallbackPort;
}

function startServer(options = {}) {
  const hasCustomPort = Object.prototype.hasOwnProperty.call(options, 'port');
  const port = hasCustomPort ? options.port : DEFAULT_PORT;
  const host = typeof options.host === 'string' && options.host.trim() ? options.host.trim() : null;

  let server = null;
  const handleListen = () => {
    const activePort = resolveListeningPort(server, port);
    console.log(`✅ Rodando em http://localhost:${activePort}`);

    if (options.startSchedulers !== false) {
      startSchedulers();
    }

    if (typeof options.onListen === 'function') {
      options.onListen(server);
    }
  };

  if (host) {
    server = app.listen(port, host, handleListen);
  } else {
    server = app.listen(port, handleListen);
  }

  return server;
}

module.exports = {
  app,
  createApp,
  startServer,
  startSchedulers,
  stopSchedulers
};

