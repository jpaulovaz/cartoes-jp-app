const { createAdminMessagesRepository } = require('../repositories/adminMessages.repository');

function createAdminMessagesService(deps = {}) {
  const {
    getFriendlyErrorMessage
  } = deps;

  const repository = deps.repository || createAdminMessagesRepository(deps);

  function ensureAdmin(userId, { json = false } = {}) {
    if (repository.isAdminUser(userId)) {
      return null;
    }

    return json
      ? { status: 403, body: { ok: false, message: 'Acesso negado.' } }
      : { status: 403, text: 'Acesso negado. Apenas administradores podem acessar esta página.' };
  }

  function buildPageState(query = {}, req) {
    return {
      filters: repository.normalizeAdminMessageActionFilters(query),
      openMessageKey: query.open,
      importPreview: repository.getAdminMessageImportPreview(req)
    };
  }

  function exportCsv() {
    return repository.buildMessageCsvExport();
  }

  function buildImportPreview(req, body, uploadedFile) {
    const filters = repository.normalizeAdminMessageActionFilters(body);
    if (!uploadedFile || !uploadedFile.buffer) {
      repository.clearAdminMessageImportPreview(req);
      return {
        filters,
        importPreview: null,
        error: 'Escolha um CSV do catálogo antes de pedir a prévia do lote.'
      };
    }

    const importPreview = repository.buildImportPreviewFromBuffer({
      fileBuffer: uploadedFile.buffer,
      fileName: uploadedFile.originalname
    });

    repository.setAdminMessageImportPreview(req, importPreview);
    const success = importPreview.errorRows > 0
      ? 'A prévia encontrou algumas linhas pedindo ajuste antes de importar.'
      : (importPreview.changedRows > 0
        ? 'Prévia do lote pronta. Confere os impactos antes de aplicar.'
        : 'Prévia pronta. Esse arquivo não trouxe mudança nova para aplicar.');

    return {
      filters,
      importPreview,
      success
    };
  }

  function confirmImport(req, userId, body) {
    const filters = repository.normalizeAdminMessageActionFilters(body);
    const preview = repository.getAdminMessageImportPreview(req);
    if (!preview) {
      return {
        redirectTo: repository.buildAdminMessagesPath(filters),
        flash: { type: 'error', message: 'A prévia do lote expirou por aqui. Reimporte o CSV para seguir.' }
      };
    }

    const result = repository.applyImportPreview({ preview, changedByUserId: userId });
    repository.clearAdminMessageImportPreview(req);
    return {
      redirectTo: repository.buildAdminMessagesPath(filters),
      flash: {
        type: 'success',
        message: result.appliedCount > 0
          ? `Lote aplicado. ${result.appliedCount} mensagem(ns) já saíram atualizadas sem precisar de deploy.`
          : 'Esse lote não tinha mudança nova para aplicar.'
      }
    };
  }

  function cancelImport(req, body) {
    repository.clearAdminMessageImportPreview(req);
    return {
      redirectTo: repository.buildAdminMessagesPath(repository.normalizeAdminMessageActionFilters(body)),
      flash: { type: 'info', message: 'Prévia do lote descartada. Nada foi aplicado no catálogo.' }
    };
  }

  function saveCustomization(userId, messageKey, body) {
    const filters = repository.normalizeAdminMessageActionFilters(body);
    const result = repository.saveMessageTemplateCustomization({
      messageKey,
      customTitle: body.custom_title,
      customBody: body.custom_body,
      changedByUserId: userId,
      source: 'admin_panel'
    });

    return {
      redirectTo: repository.buildAdminMessagesPath(filters, { open: messageKey }),
      flash: {
        type: 'success',
        message: result.changed
          ? 'Mensagem guardada por aqui. Agora o catálogo já fala esse texto sem depender de deploy.'
          : 'Mensagem conferida. Não achei mudança nova para guardar aqui.'
      }
    };
  }

  function resetCustomization(userId, messageKey, body) {
    const filters = repository.normalizeAdminMessageActionFilters(body);
    const result = repository.resetMessageTemplateCustomization({
      messageKey,
      changedByUserId: userId,
      source: 'admin_reset'
    });

    return {
      redirectTo: repository.buildAdminMessagesPath(filters, { open: messageKey }),
      flash: {
        type: 'success',
        message: result.changed
          ? 'Mensagem restaurada para o padrão do app. Voltou para a versão nativa sem drama.'
          : 'Essa mensagem já estava usando o padrão do app. Nada precisou ser desfeito.'
      }
    };
  }

  function previewMessage(messageKey, body) {
    const preview = repository.buildMessagePreview(messageKey, {
      templateOverrides: {
        titleTemplate: body.custom_title,
        bodyTemplate: body.custom_body
      }
    });

    if (Array.isArray(preview.validationErrors) && preview.validationErrors.length) {
      return {
        status: 422,
        body: {
          ok: false,
          message: 'A prévia encontrou placeholder pedindo atenção antes de seguir.',
          validationErrors: preview.validationErrors
        }
      };
    }

    return { status: 200, body: { ok: true, preview } };
  }

  async function pushTest(userId, messageKey, body) {
    if (!repository.isPushConfigured() || !repository.webPush) {
      return { status: 503, body: { ok: false, message: 'O push ainda não está configurado neste servidor.' } };
    }

    const rateKey = `${userId}:${messageKey}`;
    const lastSentAt = repository.adminMessagePushTestRateLimit.get(rateKey) || 0;
    const elapsed = Date.now() - lastSentAt;

    if (elapsed < repository.ADMIN_MESSAGE_PUSH_TEST_RATE_LIMIT_MS) {
      const secondsLeft = Math.max(1, Math.ceil((repository.ADMIN_MESSAGE_PUSH_TEST_RATE_LIMIT_MS - elapsed) / 1000));
      return { status: 429, body: { ok: false, message: `Segura só ${secondsLeft}s para repetir esse push de teste neste aparelho.` } };
    }

    const subscription = body?.subscription;
    const endpoint = String(subscription?.endpoint || '').trim();
    if (!endpoint) {
      return { status: 409, body: { ok: false, message: 'Antes do teste, ative os alertas neste aparelho para a gente saber onde bater.' } };
    }

    const preview = repository.buildMessagePreview(messageKey, {
      templateOverrides: {
        titleTemplate: body.custom_title,
        bodyTemplate: body.custom_body
      }
    });

    if (preview.preview?.kind !== 'push') {
      return { status: 400, body: { ok: false, message: 'Esse item usa prévia visual na tela. O push de teste só entra em campo quando o canal é push.' } };
    }

    if (Array.isArray(preview.validationErrors) && preview.validationErrors.length) {
      return {
        status: 422,
        body: {
          ok: false,
          message: 'O push de teste encontrou placeholder pedindo atenção antes de seguir.',
          validationErrors: preview.validationErrors
        }
      };
    }

    const payload = repository.buildPushTestPayload(messageKey, {
      templateOverrides: {
        titleTemplate: body.custom_title,
        bodyTemplate: body.custom_body
      }
    });

    payload.href = '/admin/messages';
    payload.tag = `preview:${messageKey}:${userId}`;
    repository.upsertPushSubscription(userId, subscription);

    try {
      await repository.webPush.sendNotification(subscription, JSON.stringify({
        title: payload.title,
        body: payload.body,
        href: payload.href,
        tag: payload.tag,
        isTest: true,
        previewMessageKey: payload.previewMessageKey
      }));

      repository.adminMessagePushTestRateLimit.set(rateKey, Date.now());
      return { status: 200, body: { ok: true, message: 'Push de teste enviado para este aparelho. Dá uma olhadinha se ele apareceu redondinho por aí.' } };
    } catch (error) {
      if (error?.statusCode === 404 || error?.statusCode === 410) {
        repository.removePushSubscriptionForUser(userId, endpoint);
        return { status: 410, body: { ok: false, message: 'A inscrição deste aparelho expirou. Liga os alertas de novo e a gente tenta mais uma.' } };
      }

      return { status: 500, body: { ok: false, message: getFriendlyErrorMessage(error, { defaultMessage: 'Não consegui mandar o push de teste agora.' }) } };
    }
  }

  function getFriendlyMessage(error, fallback) {
    return getFriendlyErrorMessage(error, { defaultMessage: fallback });
  }

  return {
    ensureAdmin,
    buildPageState,
    exportCsv,
    buildImportPreview,
    confirmImport,
    cancelImport,
    saveCustomization,
    resetCustomization,
    previewMessage,
    pushTest,
    getFriendlyMessage
  };
}

module.exports = {
  createAdminMessagesService
};
