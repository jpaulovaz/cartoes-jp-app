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
  assert.match(header, /data-op-ui=\"v4\"/);
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
});
