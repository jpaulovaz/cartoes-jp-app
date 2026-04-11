const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const errors = [];

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

function ensure(condition, message) {
  if (!condition) errors.push(message);
}

const requiredFiles = [
  'server.js',
  'server.runtime.js',
  'src/routes/index.js',
  'views/settings.ejs',
  'views/people.ejs',
  'views/partials/page-hero.ejs',
  'views/partials/page-chip-nav.ejs',
  'views/partials/settings/profile-section.ejs',
  'views/partials/settings/alerts-section.ejs',
  'views/partials/settings/pix-section.ejs',
  'views/partials/settings/security-section.ejs',
  'views/partials/people/my-profile-section.ejs',
  'views/partials/people/friend-requests-section.ejs',
  'views/partials/people/contact-modal.ejs',
  'views/partials/people/network-list-section.ejs',
  'tests/characterization/phase6.test.js',
  'docs/refactor/smoke-3.20.11-fase-6.md',
  'README.md'
];

requiredFiles.forEach((rel) => ensure(exists(rel), `Arquivo obrigatório ausente: ${rel}`));

const packageJson = JSON.parse(read('package.json'));
ensure(packageJson.version === '3.20.11', `Versão esperada 3.20.11, encontrada ${packageJson.version}`);
ensure(typeof packageJson.scripts?.test === 'string' && packageJson.scripts.test.includes('phase6.test.js'), 'package.json precisa incluir phase6.test.js no script test');
ensure(packageJson.scripts?.['verify:refactor'] === 'node scripts/verify-refactor.js', 'package.json precisa expor npm run verify:refactor');

const settingsView = read('views/settings.ejs');
ensure(settingsView.includes("include('partials/page-hero'"), 'settings.ejs deve usar partial page-hero');
ensure(settingsView.includes("include('partials/page-chip-nav'"), 'settings.ejs deve usar partial page-chip-nav');
ensure(settingsView.includes("include('partials/settings/profile-section'"), 'settings.ejs deve usar partial de perfil');
ensure(settingsView.includes("include('partials/settings/alerts-section'"), 'settings.ejs deve usar partial de alertas');
ensure(settingsView.includes("include('partials/settings/pix-section'"), 'settings.ejs deve usar partial de Pix');
ensure(settingsView.includes("include('partials/settings/security-section'"), 'settings.ejs deve usar partial de segurança');

const peopleView = read('views/people.ejs');
ensure(peopleView.includes("include('partials/page-hero'"), 'people.ejs deve usar partial page-hero');
ensure(peopleView.includes("include('partials/page-chip-nav'"), 'people.ejs deve usar partial page-chip-nav');
ensure(peopleView.includes("include('partials/people/my-profile-section'"), 'people.ejs deve usar partial do perfil social');
ensure(peopleView.includes("include('partials/people/friend-requests-section'"), 'people.ejs deve usar partial de convites');
ensure(peopleView.includes("include('partials/people/contact-modal'"), 'people.ejs deve usar partial do modal de contato');
ensure(peopleView.includes("include('partials/people/network-list-section'"), 'people.ejs deve usar partial da lista de rede');

const settingsLineCount = settingsView.split('\n').length;
const peopleLineCount = peopleView.split('\n').length;
ensure(settingsLineCount < 1700, `settings.ejs deveria ficar abaixo de 1700 linhas; atual ${settingsLineCount}`);
ensure(peopleLineCount < 1750, `people.ejs deveria ficar abaixo de 1750 linhas; atual ${peopleLineCount}`);

const readme = read('README.md');
ensure(readme.includes('server.runtime.js'), 'README precisa documentar server.runtime.js');
ensure(readme.includes('src/routes/'), 'README precisa documentar src/routes/');
ensure(readme.includes('npm run verify:refactor'), 'README precisa documentar verify:refactor');
ensure(readme.includes('monólito modular enxuto') || readme.includes('monolito modular enxuto'), 'README precisa registrar a arquitetura final');

const serverEntry = read('server.js');
ensure(serverEntry.includes('bootstrapDatabase'), 'server.js precisa continuar chamando bootstrapDatabase');
ensure(serverEntry.includes("require('./server.runtime')"), 'server.js precisa continuar delegando para server.runtime.js');

const runtime = read('server.runtime.js');
['registerAuthRoutes', 'registerSecurityRoutes', 'registerCardsRoutes', 'registerFinancesRoutes', 'registerImportRoutes', 'registerSummaryRoutes', 'registerSharedDebtsRoutes', 'registerPeopleRoutes', 'registerSocialShareRoutes'].forEach((token) => {
  ensure(runtime.includes(token), `server.runtime.js precisa registrar ${token}`);
});

if (errors.length) {
  console.error('Falhas na verificação estrutural da refatoração final:');
  errors.forEach((err) => console.error(`- ${err}`));
  process.exit(1);
}

console.log('OK - verificação estrutural da fase 6 concluída.');
