const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../db');
const { createAutomationApiRepository } = require('./automationApi.repository');

const APP_ROOT = path.resolve(__dirname, '..', '..');
const STAGING_ROOT = path.join(APP_ROOT, 'storage', 'automation-receipt-images');

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
    // limpeza nao pode derrubar o fluxo
  }
}

function deleteDirSafe(targetPath) {
  try {
    if (targetPath && fs.existsSync(targetPath)) fs.rmSync(targetPath, { recursive: true, force: true });
  } catch (error) {
    // limpeza nao pode derrubar o fluxo
  }
}

function sanitizeFilenamePart(value, fallback = 'comprovante.jpg') {
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
  const cardName = normalizeText(card?.name || card?.label || '');
  const brand = normalizeText(card?.brand || '');
  const text = normalizeText(hint);
  if (!text) return 0;
  let score = 0;
  if (cardName === text) score = Math.max(score, 100);
  if (cardName && cardName.startsWith(text)) score = Math.max(score, 92);
  if (cardName && (cardName.includes(text) || text.includes(cardName))) score = Math.max(score, 82);
  if (brand && brand === text) score = Math.max(score, 64);
  if (brand && (brand.includes(text) || text.includes(brand))) score = Math.max(score, 54);
  const words = text.split(' ').filter((word) => word.length > 2);
  const hits = words.filter((word) => cardName.includes(word) || brand.includes(word)).length;
  if (hits) score = Math.max(score, 30 + hits * 10);
  return score;
}

function mapStagingRow(row) {
  if (!row) return null;
  return {
    ...row,
    id: Number(row.id || 0),
    user_id: Number(row.user_id || 0),
    byte_size: Number(row.byte_size || 0),
    purchase_id: Number(row.purchase_id || 0) || null,
    source_meta: safeJsonParse(row.source_meta_json, {}),
    parsed: safeJsonParse(row.parsed_json, {})
  };
}

function createAutomationReceiptPurchasesRepository() {
  const base = createAutomationApiRepository();

  function getMaxFileBytes() {
    return Math.max(512 * 1024, base.getIntegerSetting('AUTOMATION_RECEIPT_IMAGE_MAX_FILE_BYTES', 8000000));
  }

  function getStagingTtlMinutes() {
    return Math.max(5, Math.min(24 * 60, base.getIntegerSetting('AUTOMATION_RECEIPT_IMAGE_STAGING_TTL_MINUTES', 60)));
  }

  function getGeminiApiKey() {
    return String(
      base.getAppSetting('AUTOMATION_RECEIPT_IMAGE_GEMINI_API_KEY', '')
      || base.getAppSetting('STATEMENT_PDF_GEMINI_API_KEY', '')
      || base.getAppSetting('GEMINI_API_KEY', '')
      || ''
    ).trim();
  }

  function getGeminiModel() {
    return String(base.getAppSetting('AUTOMATION_RECEIPT_IMAGE_GEMINI_MODEL', 'gemini-2.5-flash') || 'gemini-2.5-flash').trim();
  }

  function isReceiptImageEnabled() {
    return base.getBooleanSetting('AUTOMATION_RECEIPT_IMAGE_ENABLED', false);
  }

  function isDebugEnabled() {
    return base.getBooleanSetting('AUTOMATION_RECEIPT_IMAGE_DEBUG_ENABLED', false);
  }

  function findCardByHint(userId, hint) {
    const cards = base.getActiveCards(userId);
    const scored = cards
      .map((card) => ({ card, score: cardMatchScore(card, hint) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || Number(a.card.id || 0) - Number(b.card.id || 0));
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
    const filename = sanitizeFilenamePart(file.originalname || payload.originalFilename || 'comprovante.jpg', 'comprovante.jpg');
    const buffer = Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.alloc(0);
    const sha256 = String(payload.sha256 || crypto.createHash('sha256').update(buffer).digest('hex')).trim();
    const info = db.prepare(`
      INSERT INTO automation_receipt_image_staging (
        user_id, phone_e164, whatsapp_number, channel, original_filename, mime_type, byte_size,
        sha256, storage_path, source_message_id, source_meta_json, caption, parsed_json,
        provider_key, provider_model, confidence, status, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, NULL, ?, ?, NULL, ?, ?, ?)
    `).run(
      Number(payload.userId || 0),
      payload.phoneE164 || null,
      payload.whatsappNumber || null,
      payload.channel || 'whatsapp',
      filename,
      file.mimetype || payload.mimeType || 'image/jpeg',
      Number(file.size || buffer.length || 0),
      sha256,
      payload.sourceMessageId || null,
      safeJsonStringify(payload.sourceMeta || {}, '{}'),
      payload.caption || null,
      payload.providerKey || 'gemini',
      payload.providerModel || getGeminiModel(),
      payload.status || 'extracting',
      expiresAt,
      now,
      now
    );

    const stagingId = Number(info.lastInsertRowid || 0);
    const dir = path.join(STAGING_ROOT, String(stagingId).padStart(8, '0'));
    ensureDir(dir);
    const target = path.join(dir, filename);
    fs.writeFileSync(target, buffer);
    db.prepare('UPDATE automation_receipt_image_staging SET storage_path = ?, updated_at = ? WHERE id = ?')
      .run(target, nowIso(), stagingId);
    return getStagingByIdForUser(payload.userId, stagingId);
  }

  function updateStagingParsed(userId, stagingId, { parsed = {}, confidence = null, status = 'waiting_confirmation' } = {}) {
    const now = nowIso();
    db.prepare(`
      UPDATE automation_receipt_image_staging
      SET parsed_json = ?, confidence = ?, status = ?, updated_at = ?
      WHERE id = ? AND user_id = ?
    `).run(safeJsonStringify(parsed || {}, '{}'), confidence || parsed.confidence || null, status, now, Number(stagingId || 0), Number(userId || 0));
    return getStagingByIdForUser(userId, stagingId);
  }

  function getStagingByIdForUser(userId, stagingId) {
    return mapStagingRow(db.prepare(`
      SELECT *
      FROM automation_receipt_image_staging
      WHERE id = ? AND user_id = ?
      LIMIT 1
    `).get(Number(stagingId || 0), Number(userId || 0)));
  }

  function getOpenStagingByHash(userId, sha256) {
    if (!sha256) return null;
    return mapStagingRow(db.prepare(`
      SELECT *
      FROM automation_receipt_image_staging
      WHERE user_id = ?
        AND sha256 = ?
        AND status IN ('extracting', 'waiting_confirmation', 'waiting_details')
        AND datetime(expires_at) > datetime(?)
      ORDER BY id DESC
      LIMIT 1
    `).get(Number(userId || 0), String(sha256 || '').trim(), nowIso()));
  }

  function loadStagingFile(staging) {
    if (!staging?.storage_path || !fs.existsSync(staging.storage_path)) return null;
    const buffer = fs.readFileSync(staging.storage_path);
    return {
      buffer,
      originalname: staging.original_filename || 'comprovante.jpg',
      mimetype: staging.mime_type || 'image/jpeg',
      size: buffer.length
    };
  }

  function markStagingConsumed(userId, stagingId, purchaseId) {
    const now = nowIso();
    db.prepare(`
      UPDATE automation_receipt_image_staging
      SET status = 'consumed', purchase_id = ?, consumed_at = ?, updated_at = ?
      WHERE id = ? AND user_id = ?
    `).run(Number(purchaseId || 0) || null, now, now, Number(stagingId || 0), Number(userId || 0));
    const staging = getStagingByIdForUser(userId, stagingId);
    if (!isDebugEnabled() && staging?.storage_path && path.resolve(staging.storage_path).startsWith(path.resolve(STAGING_ROOT))) {
      deleteFileSafe(staging.storage_path);
      deleteDirSafe(path.dirname(staging.storage_path));
    }
    return staging;
  }

  function cancelStaging(userId, stagingId) {
    const staging = getStagingByIdForUser(userId, stagingId);
    if (!staging) return null;
    const now = nowIso();
    db.prepare(`
      UPDATE automation_receipt_image_staging
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
      FROM automation_receipt_image_staging
      WHERE status IN ('extracting', 'waiting_confirmation', 'waiting_details')
        AND datetime(expires_at) <= datetime(?)
        ${userWhere}
    `).all(...params).map(mapStagingRow);
    rows.forEach((row) => cancelStaging(row.user_id, row.id));
    return rows.length;
  }

  function findSimilarPurchase(userId, purchase = {}) {
    const normalizedMerchant = normalizeText(purchase.description || purchase.merchant || '');
    if (!normalizedMerchant || !purchase.date || !Number(purchase.amount_cents || 0)) return null;
    const rows = db.prepare(`
      SELECT t.id, t.description, t.amount_cents, t.txn_date, c.name AS card_name, t.created_at
      FROM transactions t
      LEFT JOIN cards c ON c.id = t.card_id AND c.user_id = t.user_id
      WHERE t.user_id = ?
        AND COALESCE(t.parent_txn_id, 0) = 0
        AND t.txn_date = ?
        AND ABS(COALESCE(t.amount_cents, 0) - ?) <= 2
      ORDER BY datetime(t.created_at) DESC, t.id DESC
      LIMIT 10
    `).all(Number(userId || 0), String(purchase.date || ''), Number(purchase.amount_cents || 0));
    return rows.find((row) => {
      const rowText = normalizeText(row.description || '');
      return rowText.includes(normalizedMerchant) || normalizedMerchant.includes(rowText);
    }) || null;
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
    getMaxFileBytes,
    getStagingTtlMinutes,
    getGeminiApiKey,
    getGeminiModel,
    isReceiptImageEnabled,
    isDebugEnabled,
    findCardByHint,
    createStaging,
    updateStagingParsed,
    getStagingByIdForUser,
    getOpenStagingByHash,
    loadStagingFile,
    markStagingConsumed,
    cancelStaging,
    cleanupExpiredStaging,
    findSimilarPurchase,
    makeRequestHash
  };
}

module.exports = {
  createAutomationReceiptPurchasesRepository
};
