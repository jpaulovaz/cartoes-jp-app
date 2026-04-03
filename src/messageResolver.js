const db = require('./db');
const { getMessageCatalogByKey, normalizeVariableSpec } = require('./messageCatalog');

function safeTrimmedString(value) {
  if (value == null) return '';
  return String(value).trim();
}

function extractTemplatePlaceholders(template) {
  const matches = String(template || '').match(/\{\s*([a-zA-Z0-9_]+)\s*\}/g) || [];
  return Array.from(new Set(matches.map((match) => match.replace(/[{}\s]/g, ''))));
}

function getCatalogPlaceholderMap(entry) {
  const fallbackTitlePlaceholders = extractTemplatePlaceholders(entry?.defaultTitle || '');
  const fallbackBodyPlaceholders = extractTemplatePlaceholders(entry?.defaultBody || '');
  const spec = normalizeVariableSpec(entry?.variables || []);
  const map = new Map();

  spec.forEach((item) => {
    map.set(item.name, {
      name: item.name,
      required: item.required,
      fields: Array.isArray(item.fields) && item.fields.length ? item.fields : ['title', 'body']
    });
  });

  fallbackTitlePlaceholders.forEach((name) => {
    if (!map.has(name)) map.set(name, { name, required: true, fields: ['title'] });
  });
  fallbackBodyPlaceholders.forEach((name) => {
    if (!map.has(name)) map.set(name, { name, required: true, fields: ['body'] });
  });

  return Array.from(map.values());
}

function normalizeTemplateCandidate(template) {
  return String(template == null ? '' : template).replace(/\r\n/g, '\n');
}

function interpolateTemplate(template, variables = {}) {
  const normalizedTemplate = normalizeTemplateCandidate(template);
  const safeVariables = variables && typeof variables === 'object' ? variables : {};

  const withOptionalSegments = normalizedTemplate.replace(/\[([^\[\]]+)\]/g, (fullMatch, inner) => {
    const placeholderNames = extractTemplatePlaceholders(inner);
    if (!placeholderNames.length) return inner;
    const hasAllValues = placeholderNames.every((name) => safeTrimmedString(safeVariables[name]).length > 0);
    return hasAllValues ? inner : '';
  });

  return withOptionalSegments
    .replace(/\{\s*([a-zA-Z0-9_]+)\s*\}/g, (match, name) => {
      const value = safeVariables[name];
      return value == null ? '' : String(value);
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/ {2,}/g, ' ')
    .trim();
}

function validateTemplateField(entry, fieldName, candidateTemplate) {
  const safeFieldName = fieldName === 'title' ? 'title' : 'body';
  const template = normalizeTemplateCandidate(candidateTemplate);
  if (!template.trim()) {
    return {
      valid: false,
      errors: [{ field: safeFieldName, code: 'empty_template', message: `O campo ${safeFieldName} não pode ficar vazio.` }]
    };
  }

  const placeholderMap = getCatalogPlaceholderMap(entry);
  const requiredNames = placeholderMap
    .filter((item) => item.required && item.fields.includes(safeFieldName))
    .map((item) => item.name);
  const presentNames = extractTemplatePlaceholders(template);
  const errors = requiredNames
    .filter((name) => !presentNames.includes(name))
    .map((name) => ({
      field: safeFieldName,
      code: 'missing_placeholder',
      placeholder: name,
      message: `O placeholder {${name}} precisa continuar no ${safeFieldName}.`
    }));

  return {
    valid: errors.length === 0,
    errors
  };
}

function resolveTemplateSource(entry, row = null, fallbackTitle = '', fallbackBody = '', templateOverrides = null) {
  const customTitle = safeTrimmedString(row?.custom_title);
  const customBody = safeTrimmedString(row?.custom_body);
  const defaultTitle = normalizeTemplateCandidate(row?.default_title || entry?.defaultTitle || fallbackTitle || '');
  const defaultBody = normalizeTemplateCandidate(row?.default_body || entry?.defaultBody || fallbackBody || '');

  const titleValidation = customTitle ? validateTemplateField(entry, 'title', customTitle) : { valid: false, errors: [] };
  const bodyValidation = customBody ? validateTemplateField(entry, 'body', customBody) : { valid: false, errors: [] };
  const validationErrors = [...titleValidation.errors, ...bodyValidation.errors];

  let titleTemplate = titleValidation.valid ? customTitle : defaultTitle;
  let bodyTemplate = bodyValidation.valid ? customBody : defaultBody;
  let usesCustomTitle = titleValidation.valid;
  let usesCustomBody = bodyValidation.valid;

  if (templateOverrides && typeof templateOverrides === 'object') {
    if (Object.prototype.hasOwnProperty.call(templateOverrides, 'titleTemplate')) {
      const candidateTitle = normalizeTemplateCandidate(templateOverrides.titleTemplate);
      const candidateValidation = validateTemplateField(entry, 'title', candidateTitle);
      if (candidateValidation.valid) {
        titleTemplate = candidateTitle;
        usesCustomTitle = candidateTitle !== defaultTitle;
      } else {
        validationErrors.push(...candidateValidation.errors);
      }
    }

    if (Object.prototype.hasOwnProperty.call(templateOverrides, 'bodyTemplate')) {
      const candidateBody = normalizeTemplateCandidate(templateOverrides.bodyTemplate);
      const candidateValidation = validateTemplateField(entry, 'body', candidateBody);
      if (candidateValidation.valid) {
        bodyTemplate = candidateBody;
        usesCustomBody = candidateBody !== defaultBody;
      } else {
        validationErrors.push(...candidateValidation.errors);
      }
    }
  }

  return {
    titleTemplate,
    bodyTemplate,
    usesCustomTitle,
    usesCustomBody,
    validationErrors
  };
}

function getMessageTemplateRow(messageKey) {
  const safeKey = safeTrimmedString(messageKey);
  if (!safeKey) return null;
  try {
    return db.prepare(`
      SELECT message_key, catalog_id, channel, category, flow, purpose, preview_renderer,
             variables_json, default_title, default_body, custom_title, custom_body,
             is_active, updated_at, updated_by_user_id
        FROM message_templates
       WHERE message_key = ?
       LIMIT 1
    `).get(safeKey);
  } catch (error) {
    return null;
  }
}

function resolveMessage(messageKey, variables = {}, options = {}) {
  const entry = getMessageCatalogByKey(messageKey);
  if (!entry) {
    return {
      messageKey: safeTrimmedString(messageKey),
      catalogId: null,
      channel: null,
      category: null,
      flow: null,
      purpose: null,
      title: safeTrimmedString(options.fallbackTitle),
      body: safeTrimmedString(options.fallbackBody),
      titleTemplate: safeTrimmedString(options.fallbackTitle),
      bodyTemplate: safeTrimmedString(options.fallbackBody),
      usesCustomTitle: false,
      usesCustomBody: false,
      validationErrors: [{ code: 'catalog_missing', message: 'Mensagem ainda não cadastrada no catálogo.' }],
      variables: variables && typeof variables === 'object' ? { ...variables } : {}
    };
  }

  const row = getMessageTemplateRow(entry.messageKey);
  const source = resolveTemplateSource(
    entry,
    row,
    options.fallbackTitle,
    options.fallbackBody,
    options.templateOverrides || null
  );

  return {
    messageKey: entry.messageKey,
    catalogId: entry.catalogId,
    channel: entry.channel,
    category: entry.category,
    flow: entry.flow,
    purpose: entry.purpose,
    previewRenderer: entry.previewRenderer || 'notification',
    title: interpolateTemplate(source.titleTemplate, variables),
    body: interpolateTemplate(source.bodyTemplate, variables),
    titleTemplate: source.titleTemplate,
    bodyTemplate: source.bodyTemplate,
    usesCustomTitle: source.usesCustomTitle,
    usesCustomBody: source.usesCustomBody,
    validationErrors: source.validationErrors,
    variables: variables && typeof variables === 'object' ? { ...variables } : {},
    placeholderSpec: getCatalogPlaceholderMap(entry)
  };
}

module.exports = {
  extractTemplatePlaceholders,
  getCatalogPlaceholderMap,
  getMessageTemplateRow,
  interpolateTemplate,
  resolveMessage,
  validateTemplateField
};
