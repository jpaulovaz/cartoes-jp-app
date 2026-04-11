const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), "utf8");
}

test("package version and shared mobile shells reflect UI v4 beta 6", () => {
  const pkg = JSON.parse(read("package.json"));
  const header = read("views/partials/header.ejs");
  const footer = read("views/partials/footer.ejs");
  const hero = read("views/partials/page-hero.ejs");
  const summary = read("views/summary.ejs");
  const analytics = read("views/analytics.ejs");
  const txn = read("views/txn.ejs");
  const detalhamento = read("views/detalhamento.ejs");

  assert.match(pkg.version, /^4\.0\.(?:0(?:-beta\.6)?|[1-9]\d*)$/);
  assert.match(pkg.scripts.test, /ui-v4-beta6\.test\.js/);
  assert.match(header, /op-ui-v4-beta6/);
  assert.match(header, /data-op-topbar/);
  assert.match(header, /data-op-main-shell/);
  assert.match(footer, /data-op-bottom-nav/);
  assert.match(footer, /data-op-bottom-nav-surface/);
  assert.match(hero, /data-op-hero-shell/);
  assert.match(hero, /data-op-hero-actions/);
  assert.match(summary, /data-op-mobile-safe-area="bottom-nav"/);
  assert.match(analytics, /data-op-mobile-safe-area="bottom-nav"/);
  assert.match(txn, /data-op-mobile-safe-area="bottom-nav"/);
  assert.match(detalhamento, /data-op-mobile-safe-area="bottom-nav"/);
});

test("css and app.js include beta 6 mobile polish system", () => {
  const css = read("public/app.css");
  const appJs = read("public/app.js");

  assert.match(css, /UI v4 beta 6 - Mobile, PWA e iOS polish/);
  assert.match(css, /html\[data-op-ui="v4"\] \[data-op-mobile-safe-area="bottom-nav"\]/);
  assert.match(css, /html\[data-op-ui="v4"\]\.op-ios-standalone \.op-bottom-nav__surface/);
  assert.match(css, /html\[data-op-ui="v4"\] \[data-dialog-surface\]/);
  assert.match(css, /html\[data-op-ui="v4"\] body\.op-has-focused-field \[data-op-bottom-nav\]/);
  assert.match(appJs, /--op-topbar-height/);
  assert.match(appJs, /--op-bottom-nav-height/);
  assert.match(appJs, /op-touch-ui/);
  assert.match(appJs, /op-has-focused-field/);
  assert.match(appJs, /scrollIntoView\(\{ block: 'center'/);
});
