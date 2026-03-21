const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { promisify } = require('util');
const { execFile } = require('child_process');

const fsp = fs.promises;
const execFileAsync = promisify(execFile);

const BACKUP_FILE_PREFIX = 'organizapay-backup';
const BACKUP_MANIFEST_FILENAME = 'manifest.json';
const BACKUP_SIGNATURE = 'organizapay-backup-v1';
const DEFAULT_PRIMARY_BACKUP_DIR = 'data/backups/local-principal';
const DEFAULT_SECONDARY_BACKUP_DIR = 'data/backups/local-espelho';

function isValidTimeZone(timeZone) {
  if (!timeZone) return false;
  try {
    Intl.DateTimeFormat('pt-BR', { timeZone }).format(new Date());
    return true;
  } catch (error) {
    return false;
  }
}

function resolveConfiguredDirectory(appRoot, configuredValue, fallbackRelativePath) {
  const raw = String(configuredValue || '').trim();
  const target = raw || fallbackRelativePath;
  if (!target) {
    throw new Error('Não consegui descobrir a pasta do backup agora.');
  }
  return path.isAbsolute(target)
    ? path.normalize(target)
    : path.normalize(path.join(appRoot, target));
}

function toDisplayPath(appRoot, absolutePath) {
  if (!absolutePath) return '-';
  const normalizedAppRoot = path.normalize(appRoot);
  const normalizedTarget = path.normalize(absolutePath);
  if (normalizedTarget.startsWith(normalizedAppRoot)) {
    return path.relative(normalizedAppRoot, normalizedTarget) || '.';
  }
  return normalizedTarget;
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let idx = 0;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx += 1;
  }
  return `${size >= 10 || idx === 0 ? size.toFixed(idx === 0 ? 0 : 1) : size.toFixed(2)} ${units[idx]}`;
}

function triggerLabel(triggerKind) {
  const map = {
    manual: 'Manual',
    scheduled: 'Agendado',
    before_restore: 'Rede antes da restauração',
    restore: 'Restauração'
  };
  return map[String(triggerKind || '').trim()] || 'Rotina';
}

function backupStatusTone(status) {
  if (status === 'success') return 'success';
  if (status === 'warning') return 'warning';
  return 'muted';
}

function createTempWorkspace(prefix = 'organizapay-backup-') {
  return fsp.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function ensureDir(dirPath) {
  await fsp.mkdir(dirPath, { recursive: true });
}

async function copyFileIfExists(sourcePath, targetPath) {
  try {
    const stat = await fsp.stat(sourcePath);
    if (!stat.isFile()) return false;
    await ensureDir(path.dirname(targetPath));
    await fsp.copyFile(sourcePath, targetPath);
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') return false;
    throw error;
  }
}

async function hashFileSha256(filePath) {
  return await new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function createZipFromDirectory(sourceDir, outputZipPath) {
  await ensureDir(path.dirname(outputZipPath));
  try {
    await execFileAsync('zip', ['-rq', outputZipPath, '.'], { cwd: sourceDir });
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      throw new Error('O servidor precisa ter o comando zip instalado para criar os pacotes de backup.');
    }
    throw error;
  }
}

async function listZipEntries(zipPath) {
  try {
    const result = await execFileAsync('unzip', ['-Z1', zipPath]);
    return String(result.stdout || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      throw new Error('O servidor precisa ter o comando unzip instalado para conferir os pacotes de backup.');
    }
    throw error;
  }
}

function validateZipEntries(entries) {
  const safeEntries = Array.isArray(entries) ? entries : [];
  if (!safeEntries.length) {
    throw new Error('O zip chegou vazio ou não consegui listar o conteúdo dele.');
  }

  safeEntries.forEach((entry) => {
    if (entry.startsWith('/') || entry.startsWith('..') || entry.includes('../') || entry.includes('..\\')) {
      throw new Error('O zip enviado tem caminhos suspeitos e foi barrado por segurança.');
    }
  });

  if (!safeEntries.includes(BACKUP_MANIFEST_FILENAME)) {
    throw new Error('Esse zip não parece ter sido criado pelo OrganizaPay: faltou o manifest.json oficial.');
  }
}

async function extractZip(zipPath, outputDir) {
  await ensureDir(outputDir);
  try {
    await execFileAsync('unzip', ['-q', zipPath, '-d', outputDir]);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      throw new Error('O servidor precisa ter o comando unzip instalado para restaurar os backups.');
    }
    throw error;
  }
}

async function pruneBackupDirectory(dirPath, prefix, keepCount) {
  const desired = Math.max(1, Number(keepCount || 1));
  const entries = await fsp.readdir(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.startsWith(prefix) || !entry.name.endsWith('.zip')) continue;
    const absolutePath = path.join(dirPath, entry.name);
    const stat = await fsp.stat(absolutePath);
    files.push({ absolutePath, name: entry.name, mtimeMs: stat.mtimeMs });
  }

  files.sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name));
  const extras = files.slice(desired);
  for (const file of extras) {
    await fsp.rm(file.absolutePath, { force: true });
  }
}

module.exports = {
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
  isValidTimeZone,
  listZipEntries,
  pruneBackupDirectory,
  resolveConfiguredDirectory,
  toDisplayPath,
  triggerLabel,
  validateZipEntries
};
