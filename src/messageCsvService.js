const { parse } = require('csv-parse/sync');
const db = require('./db');
const { ensureMessageTemplateTables, syncMessageCatalogWithDatabase } = require('./messageCatalog');
const {
  listMessageTemplatesForAdmin,
  saveMessageTemplateCustomization,
  validateAdminMessageDraft
} = require('./messageAdminService');

function safeTrimmedString(value) {
  if (value == null) return '';
  return String(value).trim();
}

function normalizeText(value) {
  return String(value == null ? '' : value).replace(/\r\n/g, '\n').trim();
}

function ensureCatalogReady() {
  ensureMessageTemplateTables(db);
  syncMessageCatalogWithDatabase(db);
}

function serializeCsvValue(value) {
  const stringValue = String(value == null ? '' : value);
  if (!/[";\n\r]/.test(stringValue)) return stringValue;
  return `"${stringValue.replace(/"/g, '""')}"`;
}

function formatCsvDate(value) {
  return safeTrimmedString(value);
}

function buildMessageCsvRows() {
  const pageData = listMessageTemplatesForAdmin({});
  return pageData.allItems.map((item) => ({
    'ID': item.catalogId,
    'Chave técnica': item.messageKey,
    'Canal': item.channel,
    'Categoria': item.category,
    'Fluxo': item.flow,
    'Função': item.purpose,
    'Renderizador': item.previewRenderer,
    'Título padrão': item.defaultTitle,
    'Texto padrão': item.defaultBody,
    'Título atual': item.currentTitleTemplate,
    'Texto atual': item.currentBodyTemplate,
    'Variáveis': item.placeholderSpec.map((placeholder) => `{${placeholder.name}}${placeholder.required ? '' : '?'}`).join(', '),
    'Atualizado em': formatCsvDate(item.updatedAt),
    'Atualizado por': item.updatedByLabel
  }));
}

function buildMessageCsvExport() {
  ensureCatalogReady();
  const rows = buildMessageCsvRows();
  const headers = [
    'ID',
    'Chave técnica',
    'Canal',
    'Categoria',
    'Fluxo',
    'Função',
    'Renderizador',
    'Título padrão',
    'Texto padrão',
    'Título atual',
    'Texto atual',
    'Variáveis',
    'Atualizado em',
    'Atualizado por'
  ];

  const lines = [headers.map(serializeCsvValue).join(';')];
  rows.forEach((row) => {
    lines.push(headers.map((header) => serializeCsvValue(row[header])).join(';'));
  });

  return {
    filename: `catalogo_mensagens_acerttapay_${new Date().toISOString().slice(0, 10)}.csv`,
    content: `\uFEFF${lines.join('\r\n')}`,
    rowCount: rows.length
  };
}

function detectDelimiter(content) {
  const sample = String(content || '').split(/\r?\n/).slice(0, 5).join('\n');
  const semicolonCount = (sample.match(/;/g) || []).length;
  const commaCount = (sample.match(/,/g) || []).length;
  return semicolonCount >= commaCount ? ';' : ',';
}

function pickRowValue(row, aliases = []) {
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(row, alias) && row[alias] != null && String(row[alias]).trim() !== '') {
      return String(row[alias]);
    }
  }
  return '';
}

function buildLookupByCatalog() {
  const pageData = listMessageTemplatesForAdmin({});
  const byCatalogId = new Map();
  const byMessageKey = new Map();
  pageData.allItems.forEach((item) => {
    byCatalogId.set(item.catalogId, item);
    byMessageKey.set(item.messageKey, item);
  });
  return { byCatalogId, byMessageKey, allItems: pageData.allItems };
}

function parseMessageCsvImport(fileBuffer) {
  const content = Buffer.isBuffer(fileBuffer) ? fileBuffer.toString('utf8') : String(fileBuffer || '');
  const delimiter = detectDelimiter(content);
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    delimiter,
    relax_column_count: true,
    trim: true
  });
  return Array.isArray(records) ? records : [];
}

function buildImportPreviewFromBuffer({ fileBuffer, fileName = '' } = {}) {
  ensureCatalogReady();
  const rows = parseMessageCsvImport(fileBuffer);
  const { byCatalogId, byMessageKey } = buildLookupByCatalog();
  const previewRows = [];
  const errors = [];
  const seenKeys = new Set();
  let changedRows = 0;
  let unchangedRows = 0;
  let ignoredRows = 0;

  rows.forEach((rawRow, index) => {
    const lineNumber = index + 2;
    const catalogId = safeTrimmedString(pickRowValue(rawRow, ['ID', 'Catalog ID', 'catalog_id']));
    const messageKey = safeTrimmedString(pickRowValue(rawRow, ['Chave técnica', 'message_key', 'Chave de controle']));
    const item = (catalogId && byCatalogId.get(catalogId)) || (messageKey && byMessageKey.get(messageKey)) || null;

    if (!item) {
      ignoredRows += 1;
      previewRows.push({
        lineNumber,
        messageKey: messageKey || '',
        catalogId: catalogId || '',
        channel: '',
        category: '',
        purpose: 'Linha fora do catálogo desta fase',
        previewRenderer: 'notification',
        currentTitleTemplate: '',
        currentBodyTemplate: '',
        nextTitleTemplate: normalizeText(pickRowValue(rawRow, ['Novo título (opcional)', 'Novo titulo (opcional)', 'Título atual', 'Titulo atual', 'Título', 'Titulo', 'custom_title'])),
        nextBodyTemplate: normalizeText(pickRowValue(rawRow, ['Novo texto (opcional)', 'Texto atual', 'Texto', 'custom_body'])),
        status: 'ignored'
      });
      return;
    }

    if (seenKeys.has(item.messageKey)) {
      errors.push({ lineNumber, message: `${item.catalogId} apareceu mais de uma vez neste CSV. Deixa só uma linha por mensagem.` });
      return;
    }
    seenKeys.add(item.messageKey);

    const nextTitle = normalizeText(pickRowValue(rawRow, ['Novo título (opcional)', 'Novo titulo (opcional)', 'Título atual', 'Titulo atual', 'Título', 'Titulo', 'custom_title']));
    const nextBody = normalizeText(pickRowValue(rawRow, ['Novo texto (opcional)', 'Texto atual', 'Texto', 'custom_body']));

    if (!nextTitle || !nextBody) {
      errors.push({ lineNumber, message: `${item.catalogId} precisa manter título e texto preenchidos no CSV.` });
      return;
    }

    try {
      validateAdminMessageDraft(item.messageKey, { customTitle: nextTitle, customBody: nextBody });
    } catch (error) {
      const detail = Array.isArray(error?.validationErrors) && error.validationErrors.length
        ? error.validationErrors.map((entry) => entry.message).join(' ')
        : 'Placeholder pedindo atenção antes de importar.';
      errors.push({ lineNumber, message: `${item.catalogId}: ${detail}` });
      previewRows.push({
        lineNumber,
        messageKey: item.messageKey,
        catalogId: item.catalogId,
        channel: item.channel,
        category: item.category,
        purpose: item.purpose,
        previewRenderer: item.previewRenderer,
        currentTitleTemplate: item.currentTitleTemplate,
        currentBodyTemplate: item.currentBodyTemplate,
        nextTitleTemplate: nextTitle,
        nextBodyTemplate: nextBody,
        status: 'error'
      });
      return;
    }

    const changed = nextTitle !== normalizeText(item.currentTitleTemplate) || nextBody !== normalizeText(item.currentBodyTemplate);
    if (changed) changedRows += 1;
    else unchangedRows += 1;

    previewRows.push({
      lineNumber,
      messageKey: item.messageKey,
      catalogId: item.catalogId,
      channel: item.channel,
      category: item.category,
      purpose: item.purpose,
      previewRenderer: item.previewRenderer,
      currentTitleTemplate: item.currentTitleTemplate,
      currentBodyTemplate: item.currentBodyTemplate,
      nextTitleTemplate: nextTitle,
      nextBodyTemplate: nextBody,
      status: changed ? 'changed' : 'unchanged'
    });
  });

  return {
    fileName: safeTrimmedString(fileName) || 'catalogo.csv',
    createdAt: new Date().toISOString(),
    rowCount: rows.length,
    changedRows,
    unchangedRows,
    ignoredRows,
    errorRows: errors.length,
    rows: previewRows,
    errors,
    readyToImport: previewRows.some((row) => row.status === 'changed') && errors.length === 0
  };
}

function createImportBatch({ preview, createdByUserId = null } = {}) {
  const stamp = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO message_template_import_batches (
      created_at,
      created_by_user_id,
      source_filename,
      total_rows,
      changed_rows,
      unchanged_rows,
      error_rows,
      summary_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    stamp,
    Number(createdByUserId || 0) || null,
    safeTrimmedString(preview?.fileName) || null,
    Number(preview?.rowCount || 0),
    Number(preview?.changedRows || 0),
    Number(preview?.unchangedRows || 0),
    Number(preview?.errorRows || 0),
    JSON.stringify({
      fileName: safeTrimmedString(preview?.fileName),
      createdAt: preview?.createdAt || stamp,
      changedCatalogIds: (preview?.rows || []).filter((row) => row.status === 'changed').map((row) => row.catalogId)
    })
  );
  return Number(result.lastInsertRowid || 0);
}

function applyImportPreview({ preview, changedByUserId = null } = {}) {
  ensureCatalogReady();
  const changedRows = Array.isArray(preview?.rows)
    ? preview.rows.filter((row) => row.status === 'changed')
    : [];

  if (!changedRows.length) {
    return { appliedCount: 0, batchId: null, changedCatalogIds: [] };
  }

  if (Number(preview?.errorRows || 0) > 0) {
    const error = new Error('A importação ainda tem linhas com erro. Corrige a prévia antes de aplicar.');
    error.status = 422;
    throw error;
  }

  const batchId = createImportBatch({ preview, createdByUserId: changedByUserId });
  const changedCatalogIds = [];

  changedRows.forEach((row) => {
    saveMessageTemplateCustomization({
      messageKey: row.messageKey,
      customTitle: row.nextTitleTemplate,
      customBody: row.nextBodyTemplate,
      changedByUserId,
      source: 'csv_import',
      importBatchId: batchId
    });
    changedCatalogIds.push(row.catalogId);
  });

  return {
    appliedCount: changedRows.length,
    batchId,
    changedCatalogIds
  };
}

module.exports = {
  buildMessageCsvExport,
  buildImportPreviewFromBuffer,
  applyImportPreview
};
