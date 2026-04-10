const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { getRuntimeConfig } = require('./bootstrap/runtimeConfig');

const { dbPath } = getRuntimeConfig();

function ensureDatabaseDirectory(targetPath) {
  if (!targetPath || targetPath === ':memory:' || String(targetPath).startsWith('file:')) {
    return;
  }

  const dataDir = path.dirname(path.resolve(targetPath));
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

ensureDatabaseDirectory(dbPath);

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

module.exports = db;
