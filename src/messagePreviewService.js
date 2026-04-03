const { getMessageCatalogByKey } = require('./messageCatalog');
const { resolveMessage } = require('./messageResolver');
const { getMessagePreviewFixture } = require('./messagePreviewFixtures');

function buildMessagePreview(messageKey, options = {}) {
  const entry = getMessageCatalogByKey(messageKey);
  const variableOverrides = options && typeof options === 'object' && options.variableOverrides && typeof options.variableOverrides === 'object'
    ? options.variableOverrides
    : {};
  const templateOverrides = options && typeof options === 'object' && options.templateOverrides && typeof options.templateOverrides === 'object'
    ? options.templateOverrides
    : null;
  const variables = {
    ...getMessagePreviewFixture(messageKey),
    ...variableOverrides
  };
  const resolved = resolveMessage(messageKey, variables, { templateOverrides });
  const renderer = entry?.previewRenderer || resolved.previewRenderer || 'notification';

  if (renderer === 'dashboard_alert') {
    return {
      ...resolved,
      renderer,
      preview: {
        kind: 'dashboard_alert',
        title: resolved.title,
        description: resolved.body,
        note: 'Prévia com dados de exemplo'
      }
    };
  }

  if (renderer === 'push') {
    return {
      ...resolved,
      renderer,
      preview: {
        kind: 'push',
        title: resolved.title,
        body: resolved.body,
        note: 'Push de teste com dados de exemplo',
        tag: `message-preview:${resolved.messageKey}`
      }
    };
  }

  return {
    ...resolved,
    renderer,
    preview: {
      kind: 'notification',
      title: resolved.title,
      body: resolved.body,
      note: 'Prévia com dados de exemplo'
    }
  };
}

function buildPushTestPayload(messageKey, options = {}) {
  const result = buildMessagePreview(messageKey, options);
  return {
    title: result.preview.kind === 'push' ? `[Teste] ${result.title}` : result.title,
    body: result.body,
    href: '/geral',
    tag: `preview:${result.messageKey}`,
    isTest: true,
    previewMessageKey: result.messageKey
  };
}

module.exports = {
  buildMessagePreview,
  buildPushTestPayload
};
