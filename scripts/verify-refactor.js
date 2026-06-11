const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const errors = [];
const { runSharedPurchaseProjectionVerification } = require('./verify-shared-purchase-projections');

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
  'scripts/run-tests-or-verify.js',
  'README.md'
];

requiredFiles.forEach((rel) => ensure(exists(rel), `Arquivo obrigatório ausente: ${rel}`));

const packageJson = JSON.parse(read('package.json'));
ensure(/^3\.20\.12$|^4\.(?:0|1|2|3|4|5|6|7|8|9|10|11|12|13)\.(?:0(?:-beta\.\d+)?|[1-9]\d*)$/.test(packageJson.version), `Versão incompatível com o gate estrutural: ${packageJson.version}`);
ensure(typeof packageJson.scripts?.test === 'string' && packageJson.scripts.test.includes('scripts/run-tests-or-verify.js'), 'package.json precisa usar scripts/run-tests-or-verify.js no script test');
ensure(packageJson.scripts.test.includes('phase6.test.js'), 'package.json precisa manter referência a phase6.test.js para fallback quando a suíte existir');
ensure(packageJson.scripts.test.includes('ui-v4-release.test.js'), 'package.json precisa incluir ui-v4-release.test.js no script test');
ensure(packageJson.scripts?.['verify:refactor'] === 'node scripts/verify-refactor.js', 'package.json precisa expor npm run verify:refactor');

const settingsView = read('views/settings.ejs');
ensure(settingsView.includes("include('partials/page-hero'"), 'settings.ejs deve usar partial page-hero');
ensure(settingsView.includes("include('partials/page-chip-nav'"), 'settings.ejs deve usar partial page-chip-nav');
ensure(settingsView.includes("include('partials/settings/profile-section', settingsPartialLocals)"), 'settings.ejs deve passar locals ao partial de perfil');
ensure(settingsView.includes("include('partials/settings/alerts-section', settingsPartialLocals)"), 'settings.ejs deve passar locals ao partial de alertas');
ensure(settingsView.includes("include('partials/settings/pix-section', settingsPartialLocals)"), 'settings.ejs deve passar locals ao partial de Pix');
ensure(settingsView.includes("include('partials/settings/security-section', settingsPartialLocals)"), 'settings.ejs deve passar locals ao partial de segurança');
ensure(settingsView.includes('getAvatarUrl') && settingsView.includes('settingsPartialLocals'), 'settings.ejs precisa compartilhar helpers com seus partials');

const peopleView = read('views/people.ejs');
ensure(peopleView.includes("include('partials/page-hero'"), 'people.ejs deve usar partial page-hero');
ensure(peopleView.includes("include('partials/page-chip-nav'"), 'people.ejs deve usar partial page-chip-nav');
ensure(peopleView.includes("include('partials/people/my-profile-section', peoplePartialLocals)"), 'people.ejs deve passar locals ao partial do perfil social');
ensure(peopleView.includes("include('partials/people/friend-requests-section', peoplePartialLocals)"), 'people.ejs deve passar locals ao partial de convites');
ensure(peopleView.includes("include('partials/people/contact-modal', peoplePartialLocals)"), 'people.ejs deve passar locals ao partial do modal de contato');
ensure(peopleView.includes("include('partials/people/network-list-section', peoplePartialLocals)"), 'people.ejs deve passar locals ao partial da lista de rede');
ensure(peopleView.includes('getAvatarUrl') && peopleView.includes('peoplePartialLocals'), 'people.ejs precisa compartilhar helpers com seus partials');

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
const summaryView = read('views/summary.ejs');
const analyticsView = read('views/analytics.ejs');
const txnView = read('views/txn.ejs');
const dashboardView = read('views/detalhamento.ejs');
ensure(summaryView.includes('op-summary-screen-v4'), 'summary.ejs precisa marcar a tela final v4');
ensure(analyticsView.includes('op-analytics-screen-v4'), 'analytics.ejs precisa marcar a tela final v4');
ensure(txnView.includes('op-txn-screen-v4'), 'txn.ejs precisa marcar a tela final v4');
ensure(dashboardView.includes('op-dashboard-screen-v4'), 'detalhamento.ejs precisa marcar a tela final v4');
const headerPartial = read('views/partials/header.ejs');
const footerPartial = read('views/partials/footer.ejs');
const lockView = read('views/lock.ejs');
ensure(headerPartial.includes('safePushNotificationsEnabled'), 'header.ejs precisa blindar pushNotificationsEnabled ausente');
ensure(headerPartial.includes('safeUser'), 'header.ejs precisa blindar user ausente');
ensure(headerPartial.includes('safeFlash'), 'header.ejs precisa blindar flash ausente');
ensure(footerPartial.includes('safeFooterUser'), 'footer.ejs precisa blindar user ausente');
ensure(lockView.includes('currentFlash') && lockView.includes('typeof appPinSecurity'), 'lock.ejs precisa blindar locals opcionais do PIN lock');
ensure(peopleView.includes('op-chip-nav__item--add-person'), 'people.ejs precisa marcar o CTA de adicionar alguém para o ajuste visual pós-release');
ensure(read('views/month.ejs').includes('op-month-import-btn') && read('views/month.ejs').includes('op-month-export-btn'), 'month.ejs precisa marcar Importar/Exportar para o ajuste visual pós-release');
ensure(read('public/app.css').includes('.op-chip-nav__item--add-person') && read('public/app.css').includes('.op-month-import-btn') && read('public/app.css').includes('.op-detalhamento-hero__action-row--month'), 'app.css precisa conter os ajustes visuais pós-release de people, month e detalhamento');
ensure(peopleView.includes("shellClass: 'op-chip-nav-shell--people-grid'"), 'people.ejs precisa aplicar o grid móvel da navegação da rede');
ensure(!peopleView.includes('peopleHeroActionsHtml'), 'people.ejs deve remover os CTAs duplicados do hero da rede');
ensure(settingsView.includes('pixStateList'), 'settings.ejs precisa compartilhar pixStateList com o partial de Pix');
ensure(read('views/admin.ejs').includes('op-admin-access-modal__panel'), 'admin.ejs precisa marcar o modal de novo acesso para scroll seguro');
ensure(read('views/month.ejs').includes('document.body.appendChild(toolbar)'), 'month.ejs precisa montar a toolbar de seleção no body para ficar visível');
ensure(read('public/app.css').includes('.op-chip-nav-shell--people-grid') && read('public/app.css').includes('.op-admin-access-modal__panel') && read('public/app.css').includes('data-theme-style="confete"') && read('public/app.css').includes('data-theme-style="orgulho"'), 'app.css precisa conter os hotfixes visuais 4.0.4 de people, admin e temas claros');

['registerAuthRoutes', 'registerSecurityRoutes', 'registerCardsRoutes', 'registerFinancesRoutes', 'registerImportRoutes', 'registerSummaryRoutes', 'registerSharedDebtsRoutes', 'registerPeopleRoutes', 'registerSocialShareRoutes'].forEach((token) => {
  ensure(runtime.includes(token), `server.runtime.js precisa registrar ${token}`);
});

try {
  runSharedPurchaseProjectionVerification({ silent: true });
} catch (error) {
  if (Array.isArray(error.details)) {
    error.details.forEach((detail) => errors.push(detail));
  } else {
    errors.push(error.message || String(error));
  }
}

if (errors.length) {
  console.error('Falhas na verificação estrutural da refatoração final:');
  errors.forEach((err) => console.error(`- ${err}`));
  process.exit(1);
}

console.log('OK - verificação estrutural da trilha refatorada e da UI 4.0 concluída.');
