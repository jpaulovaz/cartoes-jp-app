const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), "utf8");
}

test("package version and operational screens reflect UI v4 beta 5", () => {
  const pkg = JSON.parse(read("package.json"));
  const cards = read("views/cards.ejs");
  const importView = read("views/import.ejs");
  const settings = read("views/settings.ejs");
  const admin = read("views/admin.ejs");
  const adminMessages = read("views/admin-messages.ejs");
  const lock = read("views/lock.ejs");
  const adminSidebar = read("views/partials/admin/sidebar.ejs");
  const settingsProfile = read("views/partials/settings/profile-section.ejs");

  assert.match(pkg.version, /^4\.0\.0-beta\.[5-9]\d*$/);
  assert.match(pkg.scripts.test, /ui-v4-beta5\.test\.js/);
  assert.match(cards, /op-cards-screen-v4/);
  assert.match(cards, /op-cards-hero-v4/);
  assert.match(cards, /op-wallet-card/);
  assert.match(importView, /op-import-screen-v4/);
  assert.match(importView, /op-import-hero-v4/);
  assert.match(importView, /op-import-upload-card/);
  assert.match(settings, /op-settings-screen-v4/);
  assert.match(settings, /op-settings-hero-v4/);
  assert.match(settingsProfile, /op-settings-profile-card/);
  assert.match(admin, /op-admin-screen-v4/);
  assert.match(admin, /op-admin-hero-v4/);
  assert.match(adminSidebar, /op-admin-sidebar-card/);
  assert.match(adminMessages, /op-admin-messages-screen-v4/);
  assert.match(adminMessages, /op-admin-messages-hero-v4/);
  assert.match(lock, /op-lock-screen-v4/);
  assert.match(lock, /op-lock-main-v4/);
});

test("css includes beta 5 operational redesign system", () => {
  const css = read("public/app.css");

  assert.match(css, /UI v4 beta 5 - Cadastros, importacao e backoffice/);
  assert.match(css, /html\[data-op-ui="v4"\] \.op-cards-screen-v4/);
  assert.match(css, /html\[data-op-ui="v4"\] \.op-import-screen-v4/);
  assert.match(css, /html\[data-op-ui="v4"\] \.op-settings-screen-v4/);
  assert.match(css, /html\[data-op-ui="v4"\] \.op-admin-screen-v4/);
  assert.match(css, /html\[data-op-ui="v4"\] \.op-admin-messages-screen-v4/);
  assert.match(css, /html\[data-op-ui="v4"\] \.op-lock-screen-v4 \.op-auth-card/);
  assert.match(css, /html\[data-op-ui="v4"\] \.op-wallet-card/);
  assert.match(css, /html\[data-op-ui="v4"\] \.op-admin-sidebar-card/);
});
