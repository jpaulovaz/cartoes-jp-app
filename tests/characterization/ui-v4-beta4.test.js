const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), "utf8");
}

test("package version and social charging screens reflect UI v4 beta 4", () => {
  const pkg = JSON.parse(read("package.json"));
  const people = read("views/people.ejs");
  const sharedDebts = read("views/shared-debts.ejs");
  const share = read("views/share.ejs");
  const whatsapp = read("views/whatsapp.ejs");
  const networkList = read("views/partials/people/network-list-section.ejs");

  assert.match(pkg.version, /^4\.0\.0(?:-beta\.[4-9]\d*)?$/);
  assert.match(pkg.scripts.test, /ui-v4-beta4\.test\.js/);
  assert.match(people, /op-network-screen-v4/);
  assert.match(people, /op-network-hero-v4/);
  assert.match(sharedDebts, /op-debts-screen-v4/);
  assert.match(sharedDebts, /op-debts-hero-v4/);
  assert.match(sharedDebts, /op-debts-kpi-strip/);
  assert.match(share, /op-share-screen-v4/);
  assert.match(share, /op-share-preview-shell/);
  assert.match(whatsapp, /op-whatsapp-screen-v4/);
  assert.match(whatsapp, /op-whatsapp-preview-shell/);
  assert.match(networkList, /op-network-card/);
});

test("css includes beta 4 social and charging redesign system", () => {
  const css = read("public/app.css");
  const shareSummary = read("views/partials/share-summary-card.ejs");

  assert.match(css, /UI v4 beta 4 - Rede e cobrancas/);
  assert.match(css, /html\[data-op-ui="v4"\] \.op-network-screen-v4/);
  assert.match(css, /html\[data-op-ui="v4"\] \.op-debts-screen-v4/);
  assert.match(css, /html\[data-op-ui="v4"\] \.op-share-screen-v4/);
  assert.match(css, /html\[data-op-ui="v4"\] \.op-whatsapp-screen-v4/);
  assert.match(css, /share-summary-card--v4/);
  assert.match(shareSummary, /share-summary-card--v4/);
});
