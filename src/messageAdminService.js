const db = require('./db');
const {
  ensureMessageTemplateTables,
  syncMessageCatalogWithDatabase,
  getMessageCatalogByKey,
  normalizeVariableSpec
} = require('./messageCatalog');
const {
  validateTemplateField,
  getMessageTemplateRow
} = require('./messageResolver');

function nowIso() {
  return new Date().toISOString();
}

function safeTrimmedString(value) {
  if (value == null) return '';
  return String(value).trim();
}

function normalizeTemplateInput(value) {
  return String(value == null ? '' : value)
    .replace(/\r\n/g, '\n')
    .trim();
}

function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function ensureCatalogReady() {
  ensureMessageTemplateTables(db);
  syncMessageCatalogWithDatabase(db);
}

function parseVariablesJson(value, fallbackVariables = []) {
  try {
    const parsed = value ? JSON.parse(value) : null;
    return normalizeVariableSpec(Array.isArray(parsed) ? parsed : fallbackVariables);
  } catch (error) {
    return normalizeVariableSpec(fallbackVariables);
  }
}

function buildTemplateState(entry, row) {
  const defaultTitle = normalizeTemplateInput(row?.default_title || entry?.defaultTitle || '');
  const defaultBody = normalizeTemplateInput(row?.default_body || entry?.defaultBody || '');
  const rawCustomTitle = normalizeTemplateInput(row?.custom_title || '');
  const rawCustomBody = normalizeTemplateInput(row?.custom_body || '');

  const titleValidation = rawCustomTitle
    ? validateTemplateField(entry, 'title', rawCustomTitle)
    : { valid: false, errors: [] };
  const bodyValidation = rawCustomBody
    ? validateTemplateField(entry, 'body', rawCustomBody)
    : { valid: false, errors: [] };

  const usesCustomTitle = !!rawCustomTitle && titleValidation.valid;
  const usesCustomBody = !!rawCustomBody && bodyValidation.valid;
  const hasInvalidCustom = (!!rawCustomTitle && !titleValidation.valid) || (!!rawCustomBody && !bodyValidation.valid);
  const currentTitleTemplate = usesCustomTitle ? rawCustomTitle : defaultTitle;
  const currentBodyTemplate = usesCustomBody ? rawCustomBody : defaultBody;
  const isCustomized = usesCustomTitle || usesCustomBody;

  return {
    defaultTitle,
    defaultBody,
    rawCustomTitle,
    rawCustomBody,
    currentTitleTemplate,
    currentBodyTemplate,
    usesCustomTitle,
    usesCustomBody,
    isCustomized,
    hasInvalidCustom,
    validationErrors: [...titleValidation.errors, ...bodyValidation.errors]
  };
}

function buildMessageTemplateAdminRecord(row, draft = null) {
  const entry = getMessageCatalogByKey(row?.message_key || '');
  if (!entry) return null;

  const templateState = buildTemplateState(entry, row);
  const variables = parseVariablesJson(row?.variables_json, entry.variables || []);
  const hasDraftTitle = !!(draft && Object.prototype.hasOwnProperty.call(draft, 'custom_title'));
  const hasDraftBody = !!(draft && Object.prototype.hasOwnProperty.call(draft, 'custom_body'));
  const formTitle = hasDraftTitle ? String(draft.custom_title ?? '') : templateState.currentTitleTemplate;
  const formBody = hasDraftBody ? String(draft.custom_body ?? '') : templateState.currentBodyTemplate;
  const updatedByLabel = safeTrimmedString(row?.updated_by_name)
    || safeTrimmedString(row?.updated_by_email)
    || (row?.updated_by_user_id ? `Usuário #${row.updated_by_user_id}` : 'Padrão do app');
  const searchText = normalizeSearchText([
    row?.catalog_id,
    row?.message_key,
    row?.channel,
    row?.category,
    row?.flow,
    row?.purpose,
    templateState.currentTitleTemplate,
    templateState.currentBodyTemplate,
    entry.previewRenderer,
    variables.map((item) => item.name).join(' ')
  ].filter(Boolean).join(' '));

  return {
    messageKey: row.message_key,
    catalogId: row.catalog_id,
    channel: row.channel,
    category: row.category,
    flow: row.flow,
    purpose: row.purpose,
    previewRenderer: row.preview_renderer || entry.previewRenderer || 'notification',
    defaultTitle: templateState.defaultTitle,
    defaultBody: templateState.defaultBody,
    currentTitleTemplate: templateState.currentTitleTemplate,
    currentBodyTemplate: templateState.currentBodyTemplate,
    rawCustomTitle: templateState.rawCustomTitle,
    rawCustomBody: templateState.rawCustomBody,
    usesCustomTitle: templateState.usesCustomTitle,
    usesCustomBody: templateState.usesCustomBody,
    isCustomized: templateState.isCustomized,
    hasInvalidCustom: templateState.hasInvalidCustom,
    validationErrors: templateState.validationErrors,
    placeholderSpec: variables,
    updatedAt: row.updated_at,
    updatedByUserId: row.updated_by_user_id,
    updatedByLabel,
    formTitle,
    formBody,
    searchText
  };
}

function normalizeAdminMessageFilters(filters = {}) {
  const normalized = {
    q: safeTrimmedString(filters.q),
    channel: safeTrimmedString(filters.channel),
    category: safeTrimmedString(filters.category),
    status: safeTrimmedString(filters.status) || 'all'
  };

  if (!normalized.channel || normalized.channel.toLowerCase() === 'all') normalized.channel = 'all';
  if (!normalized.category || normalized.category.toLowerCase() === 'all') normalized.category = 'all';
  if (!['all', 'custom', 'default', 'attention'].includes(normalized.status)) normalized.status = 'all';
  return normalized;
}

function listMessageTemplatesForAdmin(filters = {}, { draftByMessageKey = {} } = {}) {
  ensureCatalogReady();

  const rows = db.prepare(`
    SELECT mt.message_key, mt.catalog_id, mt.channel, mt.category, mt.flow, mt.purpose,
           mt.preview_renderer, mt.variables_json, mt.default_title, mt.default_body,
           mt.custom_title, mt.custom_body, mt.is_active, mt.updated_at, mt.updated_by_user_id,
           u.name AS updated_by_name, u.email AS updated_by_email
      FROM message_templates mt
      LEFT JOIN users u ON u.id = mt.updated_by_user_id
     ORDER BY mt.catalog_id ASC
  `).all();

  const allItems = rows
    .map((row) => buildMessageTemplateAdminRecord(row, draftByMessageKey[row.message_key] || null))
    .filter(Boolean);

  const normalizedFilters = normalizeAdminMessageFilters(filters);
  const searchTerm = normalizeSearchText(normalizedFilters.q);
  const filteredItems = allItems.filter((item) => {
    if (normalizedFilters.channel !== 'all' && item.channel !== normalizedFilters.channel) return false;
    if (normalizedFilters.category !== 'all' && item.category !== normalizedFilters.category) return false;
    if (normalizedFilters.status === 'custom' && !item.isCustomized) return false;
    if (normalizedFilters.status === 'default' && (item.isCustomized || item.hasInvalidCustom)) return false;
    if (normalizedFilters.status === 'attention' && !item.hasInvalidCustom) return false;
    if (searchTerm && !item.searchText.includes(searchTerm)) return false;
    return true;
  });

  return {
    allItems,
    items: filteredItems,
    filters: normalizedFilters,
    filterOptions: {
      channels: Array.from(new Set(allItems.map((item) => item.channel))).sort((a, b) => String(a).localeCompare(String(b), 'pt-BR', { sensitivity: 'base' })),
      categories: Array.from(new Set(allItems.map((item) => item.category))).sort((a, b) => String(a).localeCompare(String(b), 'pt-BR', { sensitivity: 'base' }))
    },
    stats: {
      total: allItems.length,
      filtered: filteredItems.length,
      custom: allItems.filter((item) => item.isCustomized).length,
      defaults: allItems.filter((item) => !item.isCustomized && !item.hasInvalidCustom).length,
      attention: allItems.filter((item) => item.hasInvalidCustom).length,
      push: allItems.filter((item) => item.previewRenderer === 'push').length
    }
  };
}

function buildAdminMessageValidationError(message, errors = []) {
  const error = new Error(message || 'Não consegui validar essa mensagem agora.');
  error.code = 'MESSAGE_TEMPLATE_VALIDATION';
  error.status = 422;
  error.validationErrors = errors;
  return error;
}

function validateAdminMessageDraft(messageKey, { customTitle, customBody } = {}) {
  ensureCatalogReady();

  const entry = getMessageCatalogByKey(messageKey);
  if (!entry) {
    const error = new Error('Mensagem não encontrada no catálogo.');
    error.code = 'MESSAGE_TEMPLATE_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  const normalizedTitle = normalizeTemplateInput(customTitle);
  const normalizedBody = normalizeTemplateInput(customBody);
  const titleValidation = validateTemplateField(entry, 'title', normalizedTitle);
  const bodyValidation = validateTemplateField(entry, 'body', normalizedBody);
  const errors = [...titleValidation.errors, ...bodyValidation.errors];

  if (errors.length) {
    throw buildAdminMessageValidationError('Tem placeholder pedindo atenção antes de salvar ou pré-visualizar.', errors);
  }

  return {
    entry,
    normalizedTitle,
    normalizedBody
  };
}

function saveMessageTemplateCustomization({ messageKey, customTitle, customBody, changedByUserId = null, source = 'admin' } = {}) {
  const { entry, normalizedTitle, normalizedBody } = validateAdminMessageDraft(messageKey, { customTitle, customBody });
  const existing = getMessageTemplateRow(entry.messageKey);
  if (!existing) {
    const error = new Error('Mensagem ainda não sincronizada com o banco.');
    error.code = 'MESSAGE_TEMPLATE_ROW_MISSING';
    error.status = 404;
    throw error;
  }

  const defaultTitle = normalizeTemplateInput(existing.default_title || entry.defaultTitle || '');
  const defaultBody = normalizeTemplateInput(existing.default_body || entry.defaultBody || '');
  const previousCustomTitle = normalizeTemplateInput(existing.custom_title || '');
  const previousCustomBody = normalizeTemplateInput(existing.custom_body || '');
  const nextCustomTitle = normalizedTitle === defaultTitle ? null : normalizedTitle;
  const nextCustomBody = normalizedBody === defaultBody ? null : normalizedBody;

  if ((previousCustomTitle || '') === (nextCustomTitle || '') && (previousCustomBody || '') === (nextCustomBody || '')) {
    return {
      changed: false,
      row: getMessageTemplateRow(entry.messageKey),
      usesDefaultTitle: !nextCustomTitle,
      usesDefaultBody: !nextCustomBody
    };
  }

  const stamp = nowIso();
  db.transaction(() => {
    db.prepare(`
      UPDATE message_templates
         SET custom_title = ?,
             custom_body = ?,
             updated_at = ?,
             updated_by_user_id = ?
       WHERE message_key = ?
    `).run(nextCustomTitle, nextCustomBody, stamp, Number(changedByUserId || 0) || null, entry.messageKey);

    db.prepare(`
      INSERT INTO message_template_history (
        message_key,
        catalog_id,
        previous_custom_title,
        next_custom_title,
        previous_custom_body,
        next_custom_body,
        changed_at,
        changed_by_user_id,
        source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.messageKey,
      entry.catalogId,
      previousCustomTitle || null,
      nextCustomTitle,
      previousCustomBody || null,
      nextCustomBody,
      stamp,
      Number(changedByUserId || 0) || null,
      safeTrimmedString(source) || 'admin'
    );
  })();

  return {
    changed: true,
    row: getMessageTemplateRow(entry.messageKey),
    usesDefaultTitle: !nextCustomTitle,
    usesDefaultBody: !nextCustomBody
  };
}

function resetMessageTemplateCustomization({ messageKey, changedByUserId = null, source = 'admin_reset' } = {}) {
  ensureCatalogReady();
  const entry = getMessageCatalogByKey(messageKey);
  if (!entry) {
    const error = new Error('Mensagem não encontrada no catálogo.');
    error.code = 'MESSAGE_TEMPLATE_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  const existing = getMessageTemplateRow(entry.messageKey);
  if (!existing) {
    const error = new Error('Mensagem ainda não sincronizada com o banco.');
    error.code = 'MESSAGE_TEMPLATE_ROW_MISSING';
    error.status = 404;
    throw error;
  }

  const previousCustomTitle = normalizeTemplateInput(existing.custom_title || '');
  const previousCustomBody = normalizeTemplateInput(existing.custom_body || '');
  if (!previousCustomTitle && !previousCustomBody) {
    return { changed: false, row: existing };
  }

  const stamp = nowIso();
  db.transaction(() => {
    db.prepare(`
      UPDATE message_templates
         SET custom_title = NULL,
             custom_body = NULL,
             updated_at = ?,
             updated_by_user_id = ?
       WHERE message_key = ?
    `).run(stamp, Number(changedByUserId || 0) || null, entry.messageKey);

    db.prepare(`
      INSERT INTO message_template_history (
        message_key,
        catalog_id,
        previous_custom_title,
        next_custom_title,
        previous_custom_body,
        next_custom_body,
        changed_at,
        changed_by_user_id,
        source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.messageKey,
      entry.catalogId,
      previousCustomTitle || null,
      null,
      previousCustomBody || null,
      null,
      stamp,
      Number(changedByUserId || 0) || null,
      safeTrimmedString(source) || 'admin_reset'
    );
  })();

  return {
    changed: true,
    row: getMessageTemplateRow(entry.messageKey)
  };
}

module.exports = {
  listMessageTemplatesForAdmin,
  normalizeAdminMessageFilters,
  saveMessageTemplateCustomization,
  resetMessageTemplateCustomization,
  validateAdminMessageDraft
};
