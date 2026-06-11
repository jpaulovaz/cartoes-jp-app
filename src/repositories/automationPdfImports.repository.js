const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../db');
const { createAutomationApiRepository } = require('./automationApi.repository');
const statementPdfRepository = require('./statementPdf.repository');

const APP_ROOT = path.resolve(__dirname, '..', '..');
const STAGING_ROOT = path.join(APP_ROOT, 'storage', 'automation-pdf-staging');

function nowIso() {
  return new Date().toISOString();
}

function safeJsonParse(value, fallback = null) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch (error) {
    return fallback;
  }
}

function safeJsonStringify(value, fallback = '{}') {
  try {
    return JSON.stringify(value == null ? null : value);
  } catch (error) {
    return fallback;
  }
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function deleteFileSafe(targetPath) {
  try {
    if (targetPath && fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
  } catch (error) {
    // limpeza nao deve derrubar o fluxo
  }
}

function deleteDirSafe(targetPath) {
  try {
    if (targetPath && fs.existsSync(targetPath)) fs.rmSync(targetPath, { recursive: true, force: true });
  } catch (error) {
    // limpeza nao deve derrubar o fluxo
  }
}

function sanitizeFilenamePart(value, fallback = 'fatura') {
  const clean = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .trim();
  return clean || fallback;
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cardMatchScore(card, hint) {
  const cardName = normalizeText(card?.name);
  const text = normalizeText(hint);
  if (!cardName || !text) return 0;
  if (cardName === text) return 100;
  if (cardName.includes(text)) return 80;
  if (text.includes(cardName)) return 75;
  const words = text.split(' ').filter((word) => word.length > 2);
  const hits = words.filter((word) => cardName.includes(word)).length;
  return hits ? 30 + hits * 10 : 0;
}

function mapStagingRow(row) {
  if (!row) return null;
  return {
    ...row,
    id: Number(row.id || 0),
    user_id: Number(row.user_id || 0),
    byte_size: Number(row.byte_size || 0),
    month: Number(row.month || 0) || null,
    year: Number(row.year || 0) || null,
    job_id: Number(row.job_id || 0) || null,
    source_meta: safeJsonParse(row.source_meta_json, {})
  };
}

function createAutomationPdfImportsRepository() {
  const base = createAutomationApiRepository();

  function getPdfRuntimeConfig() {
    return statementPdfRepository.getPdfImportRuntimeConfig();
  }

  function getMaxFileBytes() {
    return Math.max(1024 * 1024, base.getIntegerSetting('AUTOMATION_PDF_MAX_FILE_BYTES', 12000000));
  }

  function getStagingTtlMinutes() {
    return Math.max(5, Math.min(24 * 60, base.getIntegerSetting('AUTOMATION_PDF_STAGING_TTL_MINUTES', 60)));
  }

  function getActiveCards(userId) {
    return base.getActiveCards(userId);
  }

  function getActiveCardById(userId, cardId) {
    return base.getActiveCardById(userId, cardId);
  }

  function findCardByHint(userId, hint) {
    const cards = getActiveCards(userId);
    const scored = cards
      .map((card) => ({ card, score: cardMatchScore(card, hint) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || String(a.card.name || '').localeCompare(String(b.card.name || '')));
    if (!scored.length) return { card: null, ambiguous: false, matches: [] };
    const topScore = scored[0].score;
    const topMatches = scored.filter((entry) => entry.score === topScore);
    if (topMatches.length > 1) return { card: null, ambiguous: true, matches: topMatches.map((entry) => entry.card) };
    return { card: scored[0].card, ambiguous: false, matches: scored.map((entry) => entry.card) };
  }

  function createStaging(payload = {}) {
    const now = nowIso();
    const ttlMinutes = Math.max(5, Number(payload.ttlMinutes || getStagingTtlMinutes()) || 60);
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
    const file = payload.file || {};
    const filename = sanitizeFilenamePart(file.originalname || payload.originalFilename || 'fatura.pdf', 'fatura.pdf');
    const info = db.prepare(`
      INSERT INTO automation_pdf_import_staging (
        user_id, phone_e164, whatsapp_number, channel, original_filename, mime_type, byte_size,
        storage_path, source_message_id, source_meta_json, card_hint, month, year,
        status, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, 'waiting_details', ?, ?, ?)
    `).run(
      Number(payload.userId || 0),
      payload.phoneE164 || null,
      payload.whatsappNumber || null,
      payload.channel || 'whatsapp',
      filename,
      file.mimetype || payload.mimeType || 'application/pdf',
      Number(file.size || (Buffer.isBuffer(file.buffer) ? file.buffer.length : 0) || 0),
      payload.sourceMessageId || null,
      safeJsonStringify(payload.sourceMeta || {}, '{}'),
      payload.cardHint || null,
      Number(payload.month || 0) || null,
      Number(payload.year || 0) || null,
      expiresAt,
      now,
      now
    );

    const stagingId = Number(info.lastInsertRowid || 0);
    const dir = path.join(STAGING_ROOT, String(stagingId).padStart(8, '0'));
    ensureDir(dir);
    const target = path.join(dir, filename.toLowerCase().endsWith('.pdf') ? filename : `${filename}.pdf`);
    fs.writeFileSync(target, file.buffer || Buffer.alloc(0));
    db.prepare('UPDATE automation_pdf_import_staging SET storage_path = ?, updated_at = ? WHERE id = ?')
      .run(target, nowIso(), stagingId);
    return getStagingByIdForUser(payload.userId, stagingId);
  }

  function getStagingByIdForUser(userId, stagingId) {
    return mapStagingRow(db.prepare(`
      SELECT *
      FROM automation_pdf_import_staging
      WHERE id = ? AND user_id = ?
      LIMIT 1
    `).get(Number(stagingId || 0), Number(userId || 0)));
  }

  function getOpenStagingByMessage(userId, sourceMessageId) {
    if (!sourceMessageId) return null;
    return mapStagingRow(db.prepare(`
      SELECT *
      FROM automation_pdf_import_staging
      WHERE user_id = ?
        AND source_message_id = ?
        AND status IN ('waiting_details', 'ready')
      ORDER BY id DESC
      LIMIT 1
    `).get(Number(userId || 0), String(sourceMessageId || '').trim()));
  }

  function loadStagingFile(staging) {
    if (!staging?.storage_path || !fs.existsSync(staging.storage_path)) return null;
    const buffer = fs.readFileSync(staging.storage_path);
    return {
      buffer,
      originalname: staging.original_filename || 'fatura.pdf',
      mimetype: staging.mime_type || 'application/pdf',
      size: buffer.length
    };
  }

  function markStagingConsumed(userId, stagingId, jobId) {
    const now = nowIso();
    db.prepare(`
      UPDATE automation_pdf_import_staging
      SET status = 'consumed', job_id = ?, consumed_at = ?, updated_at = ?
      WHERE id = ? AND user_id = ?
    `).run(Number(jobId || 0) || null, now, now, Number(stagingId || 0), Number(userId || 0));
    return getStagingByIdForUser(userId, stagingId);
  }

  function cancelStaging(userId, stagingId) {
    const staging = getStagingByIdForUser(userId, stagingId);
    if (!staging) return null;
    const now = nowIso();
    db.prepare(`
      UPDATE automation_pdf_import_staging
      SET status = 'cancelled', cancelled_at = ?, updated_at = ?
      WHERE id = ? AND user_id = ?
    `).run(now, now, Number(stagingId || 0), Number(userId || 0));
    if (staging.storage_path && path.resolve(staging.storage_path).startsWith(path.resolve(STAGING_ROOT))) {
      deleteFileSafe(staging.storage_path);
      deleteDirSafe(path.dirname(staging.storage_path));
    }
    return getStagingByIdForUser(userId, stagingId);
  }

  function cleanupExpiredStaging(userId = null) {
    const now = nowIso();
    const params = [now];
    let userWhere = '';
    if (Number(userId || 0)) {
      userWhere = 'AND user_id = ?';
      params.push(Number(userId || 0));
    }
    const rows = db.prepare(`
      SELECT *
      FROM automation_pdf_import_staging
      WHERE status = 'waiting_details'
        AND datetime(expires_at) <= datetime(?)
        ${userWhere}
    `).all(...params).map(mapStagingRow);
    rows.forEach((row) => cancelStaging(row.user_id, row.id));
    return rows.length;
  }

  function enqueuePdfImportJob(userId, { cardId, month, year, file, preferredProvider = null } = {}, statementPdfService) {
    const service = statementPdfService;
    const result = service.enqueuePdfImports(userId, {
      card_id: Number(cardId || 0),
      month: Number(month || 0),
      year: Number(year || 0),
      preferred_provider: preferredProvider || null
    }, [file]);
    return result;
  }

  function findJobByIdForUser(userId, jobId) {
    return statementPdfRepository.findJobByIdForUser(Number(userId || 0), Number(jobId || 0));
  }

  function listJobsForUser(userId, options = {}) {
    return statementPdfRepository.listJobsForUser(Number(userId || 0), options);
  }

  function cancelJob(userId, jobId) {
    const job = findJobByIdForUser(userId, jobId);
    if (!job) return null;
    if (['processing', 'revalidating'].includes(job.status)) {
      const error = new Error('Esse PDF já está no meio da leitura. Espera terminar para revisar ou apagar pelo app.');
      error.code = 'PDF_IMPORT_RUNNING';
      throw error;
    }
    const now = nowIso();
    db.prepare(`
      UPDATE statement_import_jobs
      SET status = 'cancelled', error_message = NULL, warning_message = NULL, finished_at = COALESCE(finished_at, ?), updated_at = ?
      WHERE id = ? AND user_id = ?
    `).run(now, now, Number(jobId || 0), Number(userId || 0));
    statementPdfRepository.clearJobNotifications(jobId);
    statementPdfRepository.appendJobEvent(jobId, 'info', 'Importação cancelada pelo WhatsApp.');
    return findJobByIdForUser(userId, jobId);
  }

  function createLocalNotification({ userId, title, body, href = '', relatedType = null, relatedId = null }) {
    try {
      db.prepare(`
        INSERT INTO notifications (user_id, type, title, body, href, is_read, related_type, related_id, created_at)
        VALUES (?, 'automation_pdf_import', ?, ?, ?, 0, ?, ?, ?)
      `).run(Number(userId || 0), title, body || null, href || null, relatedType || null, relatedId || null, nowIso());
    } catch (error) {
      // notificação nao pode derrubar a ação principal
    }
  }

  function makeRequestHash(payload) {
    return crypto.createHash('sha256').update(safeJsonStringify(payload || {}, '{}')).digest('hex');
  }

  return {
    ...base,
    db,
    nowIso,
    safeJsonParse,
    safeJsonStringify,
    getPdfRuntimeConfig,
    getMaxFileBytes,
    getStagingTtlMinutes,
    getActiveCards,
    getActiveCardById,
    findCardByHint,
    createStaging,
    getStagingByIdForUser,
    getOpenStagingByMessage,
    loadStagingFile,
    markStagingConsumed,
    cancelStaging,
    cleanupExpiredStaging,
    enqueuePdfImportJob,
    findJobByIdForUser,
    listJobsForUser,
    cancelJob,
    createLocalNotification,
    makeRequestHash
  };
}

module.exports = {
  createAutomationPdfImportsRepository
};
