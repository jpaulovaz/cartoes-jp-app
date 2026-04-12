const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const existing = args
  .map((relPath) => ({ relPath, absPath: path.join(root, relPath) }))
  .filter((entry) => fs.existsSync(entry.absPath));

if (!existing.length) {
  console.log('Nenhuma suíte de caracterização encontrada. Rodando apenas a verificação estrutural do pacote.');
  const verify = spawnSync(process.execPath, [path.join(root, 'scripts', 'verify-refactor.js')], { stdio: 'inherit' });
  process.exit(verify.status || 0);
}

const testRun = spawnSync(process.execPath, ['--test', ...existing.map((entry) => entry.absPath)], { stdio: 'inherit' });
process.exit(testRun.status || 0);
