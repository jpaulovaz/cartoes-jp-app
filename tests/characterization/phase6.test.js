const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..', '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

test('phase 6 wires partials, docs and maintenance script', () => {
  const result = spawnSync(process.execPath, ['scripts/verify-refactor.js'], {
    cwd: root,
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr || result.stdout || 'verify-refactor falhou');
  assert.match(result.stdout, /verificação estrutural da fase 6 concluída/i);
});

test('critical views became smaller and reusable through partials', () => {
  const settingsView = read('views/settings.ejs');
  const peopleView = read('views/people.ejs');

  assert.ok(settingsView.includes("include('partials/settings/profile-section')"));
  assert.ok(settingsView.includes("include('partials/settings/security-section')"));
  assert.ok(peopleView.includes("include('partials/people/my-profile-section')"));
  assert.ok(peopleView.includes("include('partials/people/network-list-section')"));

  assert.ok(settingsView.split('\n').length < 1700);
  assert.ok(peopleView.split('\n').length < 1750);
});
