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

  if (renderer === 'share_text') {
    return {
      ...resolved,
      renderer,
      preview: {
        kind: 'share_text',
        title: resolved.title,
        body: resolved.body,
        note: 'Prévia do texto que acompanha o compartilhamento nativo'
      }
    };
  }

  if (renderer === 'whatsapp') {
    return {
      ...resolved,
      renderer,
      preview: {
        kind: 'whatsapp',
        title: resolved.title,
        body: resolved.body,
        note: 'Prévia da mensagem pronta para ir ao WhatsApp'
      }
    };
  }

  if (renderer === 'pix_copy') {
    return {
      ...resolved,
      renderer,
      preview: {
        kind: 'pix_copy',
        title: resolved.title,
        body: resolved.body,
        note: 'Prévia do texto de copiar e colar com Pix'
      }
    };
  }

  if (renderer === 'email') {
    return {
      ...resolved,
      renderer,
      preview: {
        kind: 'email',
        title: resolved.title,
        body: resolved.body,
        note: 'Prévia do assunto e do corpo do e-mail em texto'
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
