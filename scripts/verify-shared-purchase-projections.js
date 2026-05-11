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

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function withoutComments(value) {
  return String(value || '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '');
}

function ensureIncludes(rel, tokens) {
  const content = read(rel);
  tokens.forEach((token) => {
    ensure(content.includes(token), `${rel} precisa conter ${token}`);
  });
}

function ensureNoWriteQueries(rel) {
  const content = withoutComments(read(rel));
  const writeQueryPattern = /(?:\bprepare\s*\(|\bexec\s*\()\s*`[\s\S]*?\b(INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE)\b/i;
  ensure(!writeQueryPattern.test(content), `${rel} deve permanecer como read model, sem comandos de escrita SQL`);
}

function ensureIncludesAny(rel, tokens, label) {
  const content = read(rel);
  ensure(tokens.some((token) => content.includes(token)), `${rel} precisa conter ${label || tokens.join(' ou ')}`);
}

function runSharedPurchaseProjectionVerification(options = {}) {
  errors.length = 0;

  const requiredFiles = [
    'src/repositories/sharedPurchaseProjection.repository.js',
    'src/services/sharedPurchaseProjection.service.js',
    'src/monthTransactionsCsv.js',
    'src/services/monthlyEmailSummary.service.js',
    'src/emailMonthlySummaryTemplates.js',
    'views/month.ejs',
    'views/home.ejs',
    'views/summary.ejs',
    'views/detalhamento.ejs',
    'views/analytics.ejs',
    'views/shared-debts.ejs'
  ];

  requiredFiles.forEach((rel) => ensure(exists(rel), `Arquivo obrigatorio da fase 4.2 ausente: ${rel}`));

  if (exists('package.json')) {
    const packageJson = JSON.parse(read('package.json'));
    const [major, minor] = String(packageJson.version || '0.0.0').split('.').map((part) => Number.parseInt(part, 10));
    ensure(major > 4 || (major === 4 && minor >= 2), `Versao ${packageJson.version} nao representa a linha 4.2+ de compras compartilhadas`);
    ensure(packageJson.scripts?.['verify:shared-projections'] === 'node scripts/verify-shared-purchase-projections.js', 'package.json precisa expor npm run verify:shared-projections');
  }

  ['.env.example', 'env.minimal'].forEach((rel) => {
    if (!exists(rel)) return;
    ensure(read(rel).includes('ENABLE_SHARED_PURCHASE_PROJECTIONS'), `${rel} precisa documentar ENABLE_SHARED_PURCHASE_PROJECTIONS`);
  });

  if (exists('src/repositories/sharedPurchaseProjection.repository.js')) {
    const repository = read('src/repositories/sharedPurchaseProjection.repository.js');
    const normalizedSql = normalizeWhitespace(repository);
    ensure(normalizedSql.includes('WHERE r.receiver_user_id = ?'), 'repository precisa filtrar receiver_user_id pelo usuario logado');
    ensure(normalizedSql.includes("COALESCE(r.request_kind, 'card') = 'card'"), 'repository precisa limitar a request_kind card');
    ensure(normalizedSql.includes("r.status IN ('accepted', 'settled')"), 'repository precisa limitar status a accepted/settled');
    ensure(normalizedSql.includes('r.amount_cents > 0'), 'repository precisa excluir creditos/valores negativos da projecao');
    ensure(normalizedSql.includes('COALESCE(r.source_due_month, i.month, t.due_month)'), 'repository precisa resolver a competencia mensal da origem');
    ensureNoWriteQueries('src/repositories/sharedPurchaseProjection.repository.js');
  }

  if (exists('src/services/sharedPurchaseProjection.service.js')) {
    ensureIncludes('src/services/sharedPurchaseProjection.service.js', [
      'ENABLE_SHARED_PURCHASE_PROJECTIONS',
      "SHARED_PURCHASE_PROJECTION_KIND = 'shared_received'",
      "SHARED_PURCHASE_PROJECTION_ID_PREFIX = 'shared-request:'",
      'isSharedPurchaseProjectionId',
      'isReadOnly: true',
      "originLabel: 'Compra compartilhada recebida'",
      'amountCents',
      'confirmedPaidCents',
      'pendingReportedCents',
      'openCents',
      'statusLabel',
      'virtualCardName',
      'actionsUrl'
    ]);
    ensureNoWriteQueries('src/services/sharedPurchaseProjection.service.js');
  }

  if (exists('server.runtime.js')) {
    const runtime = read('server.runtime.js');
    ensure(runtime.includes('createSharedPurchaseProjectionService({ db })'), 'server.runtime.js precisa instanciar o service de projecoes');
    ensure(runtime.includes('getAcceptedSharedPurchaseProjectionSummarySafe'), 'server.runtime.js precisa usar wrapper seguro de resumo');
    ensure(runtime.includes('getAcceptedSharedPurchaseProjectionPeriodsSafe'), 'server.runtime.js precisa usar wrapper seguro de periodos');
    ensure((runtime.match(/getAcceptedSharedPurchaseProjectionSummarySafe/g) || []).length >= 6, 'server.runtime.js precisa integrar projecoes nas telas e exportacoes planejadas');
    ensure(runtime.includes('buildSharedPurchaseProjectionCsvRows'), 'server.runtime.js precisa montar linhas CSV de compartilhadas');
    ensure(runtime.includes('ownRows.concat(sharedRows)'), 'CSV mensal precisa unir lancamentos proprios e compartilhadas aceitas');
    ensure(runtime.includes('mergeSharedProjectionCategories'), 'analytics precisa mesclar categorias de compartilhadas');
    ensure(runtime.includes('mergeSharedProjectionTrend'), 'analytics precisa mesclar tendencia de compartilhadas');
    ensure(runtime.includes('sharedPurchaseProjectionDetailSummary'), 'detalhamento precisa receber resumo de compartilhadas');
  }

  if (exists('views/month.ejs')) {
    const monthView = read('views/month.ejs');
    ensure(monthView.includes('id="shared-purchases"'), 'month.ejs precisa ter ancora para o bloco de compartilhadas');
    ensure(monthView.includes('sharedReceivedProjections'), 'month.ejs precisa renderizar projecoes separadas das transactions');
    ensure(monthView.includes('Compras compartilhadas aceitas'), 'month.ejs precisa nomear o bloco de compartilhadas');
    ensure(monthView.includes('Somente leitura'), 'month.ejs precisa sinalizar somente leitura');
    ensure(monthView.includes('Ver na Central'), 'month.ejs precisa direcionar acoes para a Central de Acertos');
    ensure(!monthView.includes('data-txn-id="<%= item.id'), 'month.ejs nao deve tratar linha compartilhada como transaction real');
    ensure(!monthView.includes('name="transaction_id" value="<%= item.id'), 'month.ejs nao deve enviar ID virtual para endpoint de transacao');
  }

  if (exists('views/home.ejs')) {
    ensureIncludes('views/home.ejs', [
      'shared_total_cents',
      'Compartilhadas aceitas',
      'hasSharedProjections'
    ]);
  }

  if (exists('views/summary.ejs')) {
    ensureIncludes('views/summary.ejs', [
      'sharedPurchaseProjectionSummary',
      'Compras compartilhadas aceitas',
      'Central de Acertos'
    ]);
  }

  if (exists('views/detalhamento.ejs')) {
    ensureIncludes('views/detalhamento.ejs', [
      'sharedPurchaseProjectionDetailSummary',
      'Compras compartilhadas aceitas',
      'Somente leitura'
    ]);
  }

  if (exists('views/analytics.ejs')) {
    ensureIncludes('views/analytics.ejs', [
      'sharedAnalytics',
      'Compartilhadas aceitas',
      'sharedAcceptedCents'
    ]);
  }

  if (exists('views/shared-debts.ejs')) {
    ensureIncludes('views/shared-debts.ejs', [
      'Central de Acertos',
      'request-',
      'Ver no mês'
    ]);
  }

  if (exists('src/monthTransactionsCsv.js')) {
    ensureIncludes('src/monthTransactionsCsv.js', [
      'Somente leitura',
      'Enviado por',
      'Status do acerto',
      'Pago confirmado (R$)',
      'Ainda falta (R$)'
    ]);
    ensureIncludesAny('src/monthTransactionsCsv.js', ['Aguardando confirmação (R$)', 'Aguardando confirma\\u00e7\\u00e3o (R$)'], 'Aguardando confirmação (R$)');
  }

  if (exists('src/services/monthlyEmailSummary.service.js')) {
    ensureIncludes('src/services/monthlyEmailSummary.service.js', [
      'buildMonthlyReviewViewModel',
      'buildMonthTransactionsCsvExport',
      'buildMonthlySummaryEmailTemplate'
    ]);
  }

  if (exists('src/emailMonthlySummaryTemplates.js')) {
    ensureIncludes('src/emailMonthlySummaryTemplates.js', [
      'Compras compartilhadas aceitas',
      'sharedPurchaseProjectionSummary',
      'sharedPurchaseProjectionRows'
    ]);
  }

  if (errors.length) {
    const error = new Error('Falhas na verificacao de compras compartilhadas read-only');
    error.details = errors.slice();
    if (!options.silent) {
      console.error(error.message + ':');
      error.details.forEach((detail) => console.error(`- ${detail}`));
    }
    throw error;
  }

  if (!options.silent) {
    console.log('OK - verificacao de compras compartilhadas read-only concluida.');
  }

  return true;
}

if (require.main === module) {
  try {
    runSharedPurchaseProjectionVerification();
  } catch (error) {
    process.exit(1);
  }
}

module.exports = {
  runSharedPurchaseProjectionVerification
};
