const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../db');
const { buildSeedValue, getSettingDefinition, parseBooleanSetting, parseIntegerSetting } = require('../appConfig');

const APP_ROOT = path.resolve(__dirname, '..', '..');
const STORAGE_ROOT = path.join(APP_ROOT, 'storage', 'statement-imports');
const RUNNING_STATUSES = new Set(['queued', 'processing', 'revalidating']);
const READY_STATUSES = new Set(['review_ready', 'review_warn']);

function nowIso() {
  return new Date().toISOString();
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function sanitizeFilenamePart(value, fallback = 'arquivo') {
  const clean = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .trim();
  return clean || fallback;
}

function getStorageDirForJob(jobId) {
  const bucket = String(Math.max(0, Number(jobId || 0) || 0)).padStart(8, '0').slice(0, 4);
  return path.join(STORAGE_ROOT, bucket, String(jobId));
}

function writeArtifactFile(jobId, fileName, content, encoding = null) {
  const dir = getStorageDirForJob(jobId);
  ensureDir(dir);
  const target = path.join(dir, fileName);
  if (encoding) {
    fs.writeFileSync(target, content, { encoding });
  } else {
    fs.writeFileSync(target, content);
  }
  return target;
}

function deleteFileSafe(targetPath) {
  try {
    if (targetPath && fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
  } catch (error) {
    // segue o baile
  }
}

function deleteDirSafe(targetPath) {
  try {
    if (targetPath && fs.existsSync(targetPath)) {
      fs.rmSync(targetPath, { recursive: true, force: true });
    }
  } catch (error) {
    // segue o baile
  }
}

function getSettingValue(key, fallback = '') {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ? LIMIT 1').get(key);
  if (row && row.value != null && String(row.value).trim() !== '') {
    return String(row.value);
  }
  const definition = getSettingDefinition(key);
  if (!definition) return String(fallback || '');
  return buildSeedValue(definition);
}

function getPdfImportRuntimeConfig() {
  return {
    enabled: parseBooleanSetting(getSettingValue('STATEMENT_PDF_ENABLED', '1'), true),
    geminiEnabled: parseBooleanSetting(getSettingValue('STATEMENT_PDF_GEMINI_ENABLED', '1'), true),
    openaiEnabled: parseBooleanSetting(getSettingValue('STATEMENT_PDF_OPENAI_ENABLED', '0'), false),
    geminiApiKey: String(getSettingValue('STATEMENT_PDF_GEMINI_API_KEY', '') || '').trim(),
    openaiApiKey: String(getSettingValue('STATEMENT_PDF_OPENAI_API_KEY', '') || '').trim(),
    geminiModel: String(getSettingValue('STATEMENT_PDF_GEMINI_MODEL', 'gemini-3.1-pro-preview') || '').trim() || 'gemini-3.1-pro-preview',
    openaiModel: String(getSettingValue('STATEMENT_PDF_OPENAI_MODEL', 'gpt-4.1') || '').trim() || 'gpt-4.1',
    providerTimeoutMs: parseIntegerSetting(getSettingValue('STATEMENT_PDF_PROVIDER_TIMEOUT_MS', '360000'), 360000, { min: 30000, max: 900000 }),
    debugEnabled: parseBooleanSetting(getSettingValue('STATEMENT_PDF_DEBUG_ENABLED', '0'), false),
    retentionDays: parseIntegerSetting(getSettingValue('STATEMENT_PDF_RETENTION_DAYS', '7'), 7, { min: 1, max: 90 }),
    maxRetries: parseIntegerSetting(getSettingValue('STATEMENT_PDF_MAX_RETRIES', '2'), 2, { min: 0, max: 5 })
  };
}

function resolveEnabledProviders(config = getPdfImportRuntimeConfig()) {
  const providers = [];
  if (config.geminiEnabled && config.geminiApiKey) providers.push('gemini');
  if (config.openaiEnabled && config.openaiApiKey) providers.push('openai');
  return providers;
}

function providerLabel(providerKey) {
  if (providerKey === 'gemini') return 'Gemini';
  if (providerKey === 'openai') return 'OpenAI';
  return 'IA';
}

function mapJobRow(row) {
  if (!row) return null;
  const status = String(row.status || 'queued');
  const runtimeConfig = getPdfImportRuntimeConfig();
  const maxRetries = Math.max(0, Number(runtimeConfig.maxRetries || 0));
  const retryCount = Number(row.retry_count || 0);
  const baseName = sanitizeFilenamePart(path.basename(row.original_filename || 'fatura.pdf').replace(/\.pdf$/i, ''), 'fatura');
  return {
    id: Number(row.id || 0),
    userId: Number(row.user_id || 0),
    cardId: Number(row.card_id || 0),
    cardName: String(row.card_name || '').trim() || 'Cartao',
    month: Number(row.month || 0),
    year: Number(row.year || 0),
    status,
    statusLabel: {
      queued: 'Na fila',
      processing: 'Lendo PDF',
      revalidating: 'Revalidando',
      review_ready: 'Pronto para revisar',
      review_warn: 'Pronto com alerta',
      failed: 'Precisa de carinho',
      cancelled: 'Cancelado'
    }[status] || 'Em andamento',
    originalFilename: row.original_filename || 'fatura.pdf',
    csvFilename: `${baseName}.csv`,
    providerUsed: String(row.provider_used || '').trim() || null,
    preferredProvider: String(row.preferred_provider || '').trim() || null,
    warningMessage: String(row.warning_message || '').trim() || null,
    errorMessage: String(row.error_message || '').trim() || null,
    issuerKey: String(row.issuer_key || '').trim() || null,
    rowCount: Number(row.row_count || 0),
    totalCents: Number(row.total_cents || 0),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    startedAt: row.started_at || null,
    finishedAt: row.finished_at || null,
    attemptCount: Number(row.attempt_count || 0),
    retryCount,
    isRunning: RUNNING_STATUSES.has(status),
    isReady: READY_STATUSES.has(status),
    canRetry: ['failed', 'review_warn'].includes(status) && retryCount < maxRetries,
    canReview: READY_STATUSES.has(status),
    canDownload: READY_STATUSES.has(status),
    canDelete: !['processing', 'revalidating'].includes(status),
    detailsSummary: String(row.details_summary || '').trim() || null
  };
}

function listJobsForUser(userId, { limit = 10 } = {}) {
  const rows = db.prepare(`
    SELECT j.*, c.name AS card_name
    FROM statement_import_jobs j
    LEFT JOIN cards c ON c.id = j.card_id
    WHERE j.user_id = ?
    ORDER BY j.created_at DESC, j.id DESC
    LIMIT ?
  `).all(userId, limit);
  return rows.map(mapJobRow).map((job) => {
    const eventRows = db.prepare(`
      SELECT level, message, created_at
      FROM statement_import_events
      WHERE job_id = ?
      ORDER BY id DESC
      LIMIT 6
    `).all(job.id);
    return {
      ...job,
      events: eventRows.reverse().map((row) => ({
        level: row.level,
        message: row.message,
        createdAt: row.created_at
      }))
    };
  });
}

function findActiveCardById(userId, cardId) {
  return db.prepare('SELECT id, name FROM cards WHERE id = ? AND user_id = ? AND COALESCE(active, 1) = 1').get(cardId, userId);
}

function findJobByIdForUser(userId, jobId) {
  const row = db.prepare(`
    SELECT j.*, c.name AS card_name
    FROM statement_import_jobs j
    LEFT JOIN cards c ON c.id = j.card_id
    WHERE j.id = ? AND j.user_id = ?
    LIMIT 1
  `).get(jobId, userId);
  return mapJobRow(row);
}

function findJobById(jobId) {
  const row = db.prepare(`
    SELECT j.*, c.name AS card_name
    FROM statement_import_jobs j
    LEFT JOIN cards c ON c.id = j.card_id
    WHERE j.id = ?
    LIMIT 1
  `).get(jobId);
  return mapJobRow(row);
}

function appendJobEvent(jobId, level, message) {
  db.prepare(`
    INSERT INTO statement_import_events (job_id, level, message, created_at)
    VALUES (?, ?, ?, ?)
  `).run(jobId, level, String(message || '').trim() || 'Evento registrado.', nowIso());
}

function clearJobNotifications(jobId) {
  db.prepare(`
    DELETE FROM notifications
    WHERE related_type = 'statement_import_job' AND related_id = ?
  `).run(jobId);
}

function unlinkAutomationPdfStagingFromJob(jobId) {
  const safeJobId = Number(jobId || 0);
  if (!safeJobId) return 0;
  const info = db.prepare(`
    UPDATE automation_pdf_import_staging
    SET job_id = NULL, updated_at = ?
    WHERE job_id = ?
  `).run(nowIso(), safeJobId);
  return Number(info?.changes || 0);
}

function createPdfImportJob({ userId, cardId, month, year, file, preferredProvider = 'gemini' }) {
  const now = nowIso();
  const originalFilename = String(file?.originalname || 'fatura.pdf').trim() || 'fatura.pdf';
  const safeExt = path.extname(originalFilename).toLowerCase() || '.pdf';

  const transaction = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO statement_import_jobs (
        user_id, card_id, month, year, status,
        original_filename, source_mime, source_size_bytes,
        preferred_provider, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      cardId,
      month,
      year,
      originalFilename,
      file?.mimetype || 'application/pdf',
      Number(file?.size || (Buffer.isBuffer(file?.buffer) ? file.buffer.length : 0) || 0),
      preferredProvider,
      now,
      now
    );

    const jobId = Number(info.lastInsertRowid || 0);
    const sourcePath = writeArtifactFile(jobId, `source${safeExt}`, file.buffer);
    const fileSizeBytes = Number(file?.size || file.buffer.length || 0);

    db.prepare(`
      INSERT INTO statement_import_artifacts (job_id, kind, provider_key, path, mime_type, byte_size, created_at)
      VALUES (?, 'source_pdf', NULL, ?, ?, ?, ?)
    `).run(jobId, sourcePath, file?.mimetype || 'application/pdf', fileSizeBytes, now);

    appendJobEvent(jobId, 'info', 'PDF recebido e colocado na fila.');
    return jobId;
  });

  const jobId = transaction();
  return findJobById(jobId);
}

function getArtifactRow(jobId, kind, providerKey = null) {
  return db.prepare(`
    SELECT *
    FROM statement_import_artifacts
    WHERE job_id = ? AND kind = ? AND COALESCE(provider_key, '') = COALESCE(?, '')
    ORDER BY id DESC
    LIMIT 1
  `).get(jobId, kind, providerKey || '');
}

function getArtifactText(jobId, kind, providerKey = null) {
  const row = getArtifactRow(jobId, kind, providerKey);
  if (!row?.path || !fs.existsSync(row.path)) return null;
  return fs.readFileSync(row.path, 'utf8');
}

function getArtifactPath(jobId, kind, providerKey = null) {
  const row = getArtifactRow(jobId, kind, providerKey);
  if (!row?.path || !fs.existsSync(row.path)) return null;
  return row.path;
}

function saveArtifact({ jobId, kind, providerKey = null, mimeType = 'text/plain', filename, content, encoding = 'utf8' }) {
  const now = nowIso();
  const safeName = sanitizeFilenamePart(filename || `${kind}.txt`, `${kind}.txt`);
  const targetPath = writeArtifactFile(jobId, safeName, content, encoding);
  const size = encoding ? Buffer.byteLength(String(content || ''), encoding) : Buffer.byteLength(content || Buffer.alloc(0));
  const existing = getArtifactRow(jobId, kind, providerKey);
  if (existing?.path && existing.path !== targetPath) deleteFileSafe(existing.path);

  db.prepare(`
    DELETE FROM statement_import_artifacts
    WHERE job_id = ? AND kind = ? AND COALESCE(provider_key, '') = COALESCE(?, '')
  `).run(jobId, kind, providerKey || '');

  db.prepare(`
    INSERT INTO statement_import_artifacts (job_id, kind, provider_key, path, mime_type, byte_size, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(jobId, kind, providerKey, targetPath, mimeType, size, now);
  return targetPath;
}

function claimNextQueuedJob() {
  const now = nowIso();
  const tx = db.transaction(() => {
    const row = db.prepare(`
      SELECT id
      FROM statement_import_jobs
      WHERE status = 'queued'
      ORDER BY created_at ASC, id ASC
      LIMIT 1
    `).get();
    if (!row?.id) return null;
    const updated = db.prepare(`
      UPDATE statement_import_jobs
      SET status = 'processing', started_at = COALESCE(started_at, ?), updated_at = ?, error_message = NULL
      WHERE id = ? AND status = 'queued'
    `).run(now, now, row.id);
    if (!updated.changes) return null;
    appendJobEvent(row.id, 'info', 'Processamento iniciado.');
    return Number(row.id);
  });
  const claimedId = tx();
  if (!claimedId) return null;
  return findJobById(claimedId);
}

function markJobRevalidating(jobId, message = 'Chamando uma segunda opinião para conferir.') {
  db.prepare(`UPDATE statement_import_jobs SET status = 'revalidating', updated_at = ? WHERE id = ?`).run(nowIso(), jobId);
  appendJobEvent(jobId, 'info', message);
}

function markJobReady(jobId, payload = {}) {
  const now = nowIso();
  const status = payload.warningMessage ? 'review_warn' : 'review_ready';
  const detailsSummary = String(payload.detailsSummary || '').trim() || null;
  const attemptCount = payload.attemptCount == null ? null : Number(payload.attemptCount || 0);
  db.prepare(`
    UPDATE statement_import_jobs
    SET status = ?, provider_used = ?, issuer_key = ?, row_count = ?, total_cents = ?,
        warning_message = ?, error_message = NULL, details_summary = ?,
        updated_at = ?, finished_at = ?, attempt_count = COALESCE(?, attempt_count), started_at = COALESCE(started_at, ?)
    WHERE id = ?
  `).run(
    status,
    payload.providerUsed || null,
    payload.issuerKey || null,
    Number(payload.rowCount || 0),
    Number(payload.totalCents || 0),
    payload.warningMessage || null,
    detailsSummary,
    now,
    now,
    attemptCount,
    payload.startedAt || now,
    jobId
  );
  appendJobEvent(jobId, payload.warningMessage ? 'warning' : 'success', payload.warningMessage || 'Prontinho. A revisão e o CSV já podem ser abertos.');
}

function markJobFailed(jobId, payload = {}) {
  const now = nowIso();
  const attemptCount = payload.attemptCount == null ? null : Number(payload.attemptCount || 0);
  db.prepare(`
    UPDATE statement_import_jobs
    SET status = 'failed', provider_used = ?, error_message = ?, warning_message = NULL,
        details_summary = ?, updated_at = ?, finished_at = ?, attempt_count = COALESCE(?, attempt_count)
    WHERE id = ?
  `).run(
    payload.providerUsed || null,
    payload.errorMessage || 'Nao consegui concluir essa analise agora.',
    payload.detailsSummary || null,
    now,
    now,
    attemptCount,
    jobId
  );
  appendJobEvent(jobId, 'error', payload.errorMessage || 'O processamento falhou.');
}

function beginAttempt(jobId, providerKey, stage = 'extract') {
  const now = nowIso();
  const info = db.prepare(`
    INSERT INTO statement_import_job_attempts (job_id, provider_key, stage, status, started_at, created_at)
    VALUES (?, ?, ?, 'running', ?, ?)
  `).run(jobId, providerKey, stage, now, now);
  return Number(info.lastInsertRowid || 0);
}

function finishAttempt(attemptId, payload = {}) {
  db.prepare(`
    UPDATE statement_import_job_attempts
    SET status = ?, finished_at = ?, latency_ms = ?, error_message = ?, suspicion_codes_json = ?, response_meta_json = ?
    WHERE id = ?
  `).run(
    payload.status || 'success',
    nowIso(),
    Number(payload.latencyMs || 0),
    payload.errorMessage || null,
    payload.suspicionCodes ? JSON.stringify(payload.suspicionCodes) : null,
    payload.responseMeta ? JSON.stringify(payload.responseMeta) : null,
    attemptId
  );
}

function getSourcePdfPath(jobId) {
  return getArtifactPath(jobId, 'source_pdf');
}

function getPreviewPayload(jobId) {
  const text = getArtifactText(jobId, 'preview_json');
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

function getGeneratedCsvPath(jobId) {
  return getArtifactPath(jobId, 'generated_csv');
}

function requeueJob(userId, jobId) {
  const job = findJobByIdForUser(userId, jobId);
  if (!job) throw new Error('Nao achei esse job por aqui.');
  if (!job.canRetry) {
    const runtimeConfig = getPdfImportRuntimeConfig();
    const maxRetries = Math.max(0, Number(runtimeConfig.maxRetries || 0));
    if (Number(job.retryCount || 0) >= maxRetries) {
      throw new Error('Esse job ja bateu no limite de novas tentativas configurado no admin.');
    }
    throw new Error('Esse job ainda nao esta numa etapa que aceite nova tentativa.');
  }

  const now = nowIso();
  db.transaction(() => {
    const artifacts = db.prepare(`
      SELECT id, path
      FROM statement_import_artifacts
      WHERE job_id = ? AND kind <> 'source_pdf'
    `).all(jobId);
    artifacts.forEach((artifact) => deleteFileSafe(artifact.path));
    db.prepare(`DELETE FROM statement_import_artifacts WHERE job_id = ? AND kind <> 'source_pdf'`).run(jobId);
    clearJobNotifications(jobId);
    db.prepare(`DELETE FROM statement_import_job_attempts WHERE job_id = ?`).run(jobId);
    db.prepare(`DELETE FROM statement_import_events WHERE job_id = ?`).run(jobId);
    db.prepare(`
      UPDATE statement_import_jobs
      SET status = 'queued', provider_used = NULL, issuer_key = NULL, row_count = NULL, total_cents = NULL,
          warning_message = NULL, error_message = NULL, details_summary = NULL,
          updated_at = ?, finished_at = NULL, started_at = NULL, attempt_count = 0, retry_count = COALESCE(retry_count, 0) + 1
      WHERE id = ? AND user_id = ?
    `).run(now, jobId, userId);
    appendJobEvent(jobId, 'info', 'Job recolocado na fila para uma nova tentativa.');
  })();

  return findJobByIdForUser(userId, jobId);
}


function deleteJob(userId, jobId) {
  const job = findJobByIdForUser(userId, jobId);
  if (!job) throw new Error('Nao achei esse job por aqui.');
  if (!job.canDelete) {
    throw new Error('Esse job ainda esta rodando. Assim que terminar, o botao de excluir aparece para limpar tudo de uma vez.');
  }

  const artifactRows = db.prepare(`
    SELECT path
    FROM statement_import_artifacts
    WHERE job_id = ?
  `).all(jobId);
  const storageDir = getStorageDirForJob(jobId);

  db.transaction(() => {
    clearJobNotifications(jobId);
    unlinkAutomationPdfStagingFromJob(jobId);
    db.prepare(`DELETE FROM statement_import_artifacts WHERE job_id = ?`).run(jobId);
    db.prepare(`DELETE FROM statement_import_job_attempts WHERE job_id = ?`).run(jobId);
    db.prepare(`DELETE FROM statement_import_events WHERE job_id = ?`).run(jobId);
    db.prepare(`DELETE FROM statement_import_jobs WHERE id = ? AND user_id = ?`).run(jobId, userId);
  })();

  artifactRows.forEach((artifact) => deleteFileSafe(artifact.path));
  deleteDirSafe(storageDir);
  return job;
}

function incrementJobAttemptCount(jobId) {
  db.prepare('UPDATE statement_import_jobs SET attempt_count = COALESCE(attempt_count, 0) + 1, updated_at = ? WHERE id = ?').run(nowIso(), jobId);
}

function cleanupExpiredArtifacts() {
  const config = getPdfImportRuntimeConfig();
  const retentionDays = Math.max(1, Number(config.retentionDays || 7));
  const threshold = new Date(Date.now() - (retentionDays * 24 * 60 * 60 * 1000)).toISOString();
  const rows = db.prepare(`
    SELECT id
    FROM statement_import_jobs
    WHERE finished_at IS NOT NULL
      AND finished_at < ?
      AND status IN ('review_ready', 'review_warn', 'failed', 'cancelled')
  `).all(threshold);
  rows.forEach((row) => {
    const artifacts = db.prepare('SELECT path FROM statement_import_artifacts WHERE job_id = ?').all(row.id);
    artifacts.forEach((artifact) => deleteFileSafe(artifact.path));
    db.prepare('DELETE FROM statement_import_artifacts WHERE job_id = ?').run(row.id);
  });
}

module.exports = {
  nowIso,
  getPdfImportRuntimeConfig,
  resolveEnabledProviders,
  providerLabel,
  listJobsForUser,
  findActiveCardById,
  findJobByIdForUser,
  findJobById,
  createPdfImportJob,
  claimNextQueuedJob,
  markJobRevalidating,
  markJobReady,
  markJobFailed,
  beginAttempt,
  finishAttempt,
  appendJobEvent,
  getSourcePdfPath,
  saveArtifact,
  getArtifactText,
  getArtifactPath,
  getPreviewPayload,
  getGeneratedCsvPath,
  requeueJob,
  deleteJob,
  clearJobNotifications,
  incrementJobAttemptCount,
  cleanupExpiredArtifacts
};
