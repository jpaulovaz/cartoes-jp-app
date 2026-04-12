const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STORAGE_ROOT_DIRNAME = 'statement-ai';
const TEMP_PDF_DIRNAME = 'pdf-temp';

function sanitizeFileSegment(value, fallback = 'fatura') {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '')
    .trim();
  return normalized || fallback;
}

function getStatementAiStorageRoot(appRoot) {
  return path.join(appRoot, 'data', STORAGE_ROOT_DIRNAME);
}

function getStatementAiTempPdfDir(appRoot) {
  return path.join(getStatementAiStorageRoot(appRoot), TEMP_PDF_DIRNAME);
}

function ensureDir(targetPath) {
  fs.mkdirSync(targetPath, { recursive: true });
  return targetPath;
}

function ensureStatementAiStorageRoot(appRoot) {
  const root = ensureDir(getStatementAiStorageRoot(appRoot));
  const tempPdfDir = ensureDir(getStatementAiTempPdfDir(appRoot));
  return { root, tempPdfDir };
}

function buildRelativeStoragePath(appRoot, absolutePath) {
  return path.relative(appRoot, absolutePath).replace(/\\/g, '/');
}

function persistTempStatementPdf({ appRoot, userId, originalFilename, buffer, now = new Date() }) {
  if (!appRoot) {
    throw new Error('A raiz do app é obrigatória para guardar PDFs temporários da IA de faturas.');
  }

  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw new Error('Recebi um PDF vazio para a esteira da IA de faturas.');
  }

  const { tempPdfDir } = ensureStatementAiStorageRoot(appRoot);
  const safeUserId = Math.max(0, Number(userId || 0));
  const yearMonth = `${String(now.getUTCFullYear())}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const targetDir = ensureDir(path.join(tempPdfDir, String(safeUserId || 'anonimo'), yearMonth));
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  const originalBase = sanitizeFileSegment(path.parse(String(originalFilename || 'fatura.pdf')).name, 'fatura');
  const storedFilename = `${timestamp}_${safeUserId || 'anonimo'}_${sha256.slice(0, 12)}_${originalBase}.pdf`;
  const absolutePath = path.join(targetDir, storedFilename);

  fs.writeFileSync(absolutePath, buffer);

  return {
    sha256,
    sizeBytes: buffer.length,
    storedFilename,
    absolutePath,
    relativePath: buildRelativeStoragePath(appRoot, absolutePath),
    tempPdfDir
  };
}

function isPathInsideStatementAiStorage(appRoot, targetPath) {
  const storageRoot = getStatementAiStorageRoot(appRoot);
  const resolvedStorageRoot = path.resolve(storageRoot);
  const resolvedTarget = path.resolve(targetPath);
  return resolvedTarget === resolvedStorageRoot || resolvedTarget.startsWith(`${resolvedStorageRoot}${path.sep}`);
}

function removeStoredStatementPdf(appRoot, targetPath) {
  if (!targetPath) return false;
  if (!isPathInsideStatementAiStorage(appRoot, targetPath)) {
    throw new Error('O arquivo indicado não pertence ao storage da IA de faturas.');
  }
  if (!fs.existsSync(targetPath)) return false;
  fs.unlinkSync(targetPath);
  return true;
}

module.exports = {
  STORAGE_ROOT_DIRNAME,
  TEMP_PDF_DIRNAME,
  sanitizeFileSegment,
  getStatementAiStorageRoot,
  getStatementAiTempPdfDir,
  ensureStatementAiStorageRoot,
  persistTempStatementPdf,
  isPathInsideStatementAiStorage,
  removeStoredStatementPdf
};
