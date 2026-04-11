const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

test('package version and shared partials reflect UI v4 shell beta 2', () => {
  const pkg = JSON.parse(read('package.json'));
  const header = read('views/partials/header.ejs');
  const footer = read('views/partials/footer.ejs');
  const hero = read('views/partials/page-hero.ejs');
  const chipNav = read('views/partials/page-chip-nav.ejs');

  assert.match(pkg.version, /^4\.0\.0-beta\.[2-9]\d*$/);
  assert.match(pkg.scripts.test, /ui-v4-beta1\.test\.js/);
  assert.match(pkg.scripts.test, /ui-v4-beta2\.test\.js/);
  assert.match(pkg.scripts.test, /ui-v4-beta3\.test\.js/);
  assert.match(header, /op-brand-card/);
  assert.match(header, /op-topbar-actions/);
  assert.match(footer, /op-bottom-nav__surface/);
  assert.match(hero, /op-page-hero__frame/);
  assert.match(hero, /op-page-hero__meta--inline/);
  assert.match(chipNav, /op-chip-nav-shell/);
  assert.match(chipNav, /op-chip-nav--scroll/);
});

test('css includes beta 2 shell and component overrides', () => {
  const css = read('public/app.css');

  assert.match(css, /\/\* === UI V4 BETA SHELL GLOBAL === \*\//);
  assert.match(css, /html\[data-op-ui="v4"\] \.op-app-main/);
  assert.match(css, /html\[data-op-ui="v4"\] \.op-brand-card/);
  assert.match(css, /html\[data-op-ui="v4"\] \.op-chip-nav-shell/);
  assert.match(css, /html\[data-op-ui="v4"\] \.op-kpi-card/);
  assert.match(css, /html\[data-op-ui="v4"\] \.op-auth-card/);
  assert.match(css, /html\[data-op-ui="v4"\] \.op-manual-modal__scroll/);
  assert.match(css, /html\[data-op-ui="v4"\] \.op-style-center-panel/);
});
