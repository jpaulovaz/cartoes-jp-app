const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

test('package version and header activate UI v4 beta foundation', () => {
  const pkg = JSON.parse(read('package.json'));
  const header = read('views/partials/header.ejs');

  assert.match(pkg.version, /^4\.0\.0-beta\.\d+$/);
  assert.match(header, /data-op-ui="v4"/);
  assert.match(header, /themeColor = nextTheme === 'dark' \? '#08111e' : '#f4f7fb';/);
  assert.match(header, /op-shell-v4/);
});

test('css and shared partials include v4 shell/component overrides', () => {
  const css = read('public/app.css');
  const hero = read('views/partials/page-hero.ejs');
  const chipNav = read('views/partials/page-chip-nav.ejs');

  assert.match(css, /\/\* === UI V4 BETA FOUNDATION === \*\//);
  assert.match(css, /html\[data-op-ui="v4"\] \.op-topbar-shell/);
  assert.match(css, /html\[data-op-ui="v4"\] \.op-page-hero/);
  assert.match(css, /html\[data-op-ui="v4"\] \.op-bottom-nav__inner/);
  assert.match(css, /html\[data-op-ui="v4"\] \.op-chip-nav__item/);
  assert.match(hero, /op-page-hero--compact/);
  assert.match(hero, /op-page-hero__actions/);
  assert.match(hero, /op-page-hero__actions--compact/);
  assert.match(chipNav, /op-chip-nav/);
  assert.match(chipNav, /op-chip-nav__item/);
});
