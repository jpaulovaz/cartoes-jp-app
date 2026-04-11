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
  assert.match(result.stdout, /verificação estrutural .* concluída/i);
});

test('critical views became smaller and reusable through partials', () => {
  const settingsView = read('views/settings.ejs');
  const peopleView = read('views/people.ejs');

  assert.ok(settingsView.includes("include('partials/settings/profile-section', settingsPartialLocals)"));
  assert.ok(settingsView.includes("include('partials/settings/security-section', settingsPartialLocals)"));
  assert.ok(peopleView.includes("include('partials/people/my-profile-section', peoplePartialLocals)"));
  assert.ok(peopleView.includes("include('partials/people/network-list-section', peoplePartialLocals)"));
  assert.ok(settingsView.includes('getAvatarUrl') && settingsView.includes('settingsPartialLocals'));
  assert.ok(peopleView.includes('getAvatarUrl') && peopleView.includes('peoplePartialLocals'));

  assert.ok(settingsView.split('\n').length < 1700);
  assert.ok(peopleView.split('\n').length < 1750);
});
