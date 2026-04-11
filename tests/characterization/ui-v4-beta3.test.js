const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), "utf8");
}

test("package version and views reflect UI v4 beta 3 monthly reading redesign", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.match(pkg.version, /^4\.0\.(?:0(?:-beta\.[3-9]\d*)?|[1-9]\d*)$/);

  const home = read("views/home.ejs");
  assert.match(home, /op-radar-screen/);
  assert.match(home, /op-radar-period__summary/);
  assert.match(home, /op-radar-card__metrics/);

  const month = read("views/month.ejs");
  assert.match(month, /op-month-screen-v4/);
  assert.match(month, /op-month-filter-card/);
  assert.match(month, /op-month-ledger-card/);
  assert.match(month, /op-month-table-shell/);
  assert.match(pkg.scripts.test, /ui-v4-beta4\.test\.js/);
});

test("css includes beta 3 radar and monthly reading system", () => {
  const css = read("public/app.css");
  assert.match(css, /UI v4 beta 3 - Meu Radar e leitura mensal/);
  assert.match(css, /op-radar-period__summary/);
  assert.match(css, /op-radar-card__metric/);
  assert.match(css, /op-month-filter-card/);
  assert.match(css, /op-month-ledger-card/);
  assert.match(css, /op-month-ledger-row/);
});
