const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), "utf8");
}

test("package and shell mark the final 4.0 release", () => {
  const pkg = JSON.parse(read("package.json"));
  const header = read("views/partials/header.ejs");
  const verify = read("scripts/verify-refactor.js");

  assert.match(pkg.version, /^4\.0\.\d+$/);
  assert.match(pkg.scripts.test, /ui-v4-release\.test\.js/);
  assert.match(header, /op-ui-v4-release/);
  assert.match(header, /data-op-ui="v4"/);
  assert.ok(verify.includes("4\\.0\\.(?:0(?:-beta\\.\\d+)?|[1-9]\\d*)$"));
});

test("final release marks summary, analytics, txn and dashboard with the closing v4 layer", () => {
  const css = read("public/app.css");
  const summary = read("views/summary.ejs");
  const analytics = read("views/analytics.ejs");
  const txn = read("views/txn.ejs");
  const dashboard = read("views/detalhamento.ejs");

  assert.match(css, /UI v4 final - Fechamento e limpeza/);
  assert.match(css, /op-summary-screen-v4/);
  assert.match(css, /op-analytics-screen-v4/);
  assert.match(css, /op-txn-screen-v4/);
  assert.match(css, /op-dashboard-screen-v4/);
  assert.match(summary, /op-summary-screen-v4/);
  assert.match(summary, /op-summary-hero-v4/);
  assert.match(analytics, /op-analytics-screen-v4/);
  assert.match(analytics, /op-analytics-hero-v4/);
  assert.match(txn, /op-txn-screen-v4/);
  assert.match(txn, /op-txn-hero-v4/);
  assert.match(dashboard, /op-dashboard-screen-v4/);
  assert.match(dashboard, /op-dashboard-hero-v4/);
  assert.match(dashboard, /op-screen--detalhamento op-dashboard-screen-v4 max-w-7xl mx-auto/);
});


test("shared partials and lock screen tolerate optional locals after release hotfixes", () => {
  const header = read("views/partials/header.ejs");
  const footer = read("views/partials/footer.ejs");
  const lock = read("views/lock.ejs");
  const verify = read("scripts/verify-refactor.js");

  assert.match(header, /safePushNotificationsEnabled/);
  assert.match(header, /safeUser/);
  assert.match(header, /safeFlash/);
  assert.match(footer, /safeFooterUser/);
  assert.match(lock, /currentFlash/);
  assert.match(lock, /typeof appPinSecurity !== 'undefined'/);
  assert.match(verify, /header\.ejs precisa blindar pushNotificationsEnabled ausente/);
});


test("post-release visual hotfixes keep key mobile and desktop CTAs readable", () => {
  const css = read("public/app.css");
  const month = read("views/month.ejs");
  const summary = read("views/summary.ejs");
  const people = read("views/people.ejs");
  const settings = read("views/settings.ejs");
  const admin = read("views/admin.ejs");

  assert.match(month, /op-month-import-btn/);
  assert.match(month, /op-month-export-btn/);
  assert.match(month, /document\.body\.appendChild\(toolbar\)/);
  assert.match(month, /op-month-row__hint/);
  assert.match(month, /op-month-table-shell overflow-x-auto/);
  assert.match(month, /max-w-\[104rem\]/);
  assert.match(summary, /max-w-\[104rem\]/);
  assert.match(month, /md:min-w-\[94rem\]/);
  assert.match(month, /min-w-\[20rem\] xl:min-w-\[21rem\]/);
  assert.match(month, /Resumo e ações<\/th>/);
  assert.match(people, /op-chip-nav__item--add-person/);
  assert.match(people, /op-chip-nav-shell--people-grid/);
  assert.doesNotMatch(people, /peopleHeroActionsHtml/);
  assert.match(settings, /pixStateList/);
  assert.match(admin, /op-admin-access-modal__panel/);
  assert.match(css, /op-month-import-btn/);
  assert.match(css, /op-chip-nav__item--add-person/);
  assert.match(css, /op-dashboard-screen-v4::before/);
  assert.match(css, /op-chip-nav-shell--people-grid/);
  assert.match(css, /op-admin-access-modal__panel/);
  assert.match(css, /data-theme-style="confete"/);
  assert.match(css, /data-theme-style="orgulho"/);
});
