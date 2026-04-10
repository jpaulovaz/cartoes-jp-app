function createAdminMessagesController(deps = {}) {
  const {
    isAdminUser,
    renderAdminMessages,
    normalizeAdminMessageActionFilters,
    getAdminMessageImportPreview,
    buildMessageCsvExport,
    getFriendlyErrorMessage,
    clearAdminMessageImportPreview,
    buildImportPreviewFromBuffer,
    setAdminMessageImportPreview,
    applyImportPreview,
    setFlash,
    buildAdminMessagesPath,
    saveMessageTemplateCustomization,
    resetMessageTemplateCustomization,
    buildMessagePreview,
    buildPushTestPayload,
    isPushConfigured,
    webPush,
    ADMIN_MESSAGE_PUSH_TEST_RATE_LIMIT_MS,
    adminMessagePushTestRateLimit,
    upsertPushSubscription,
    removePushSubscriptionForUser
  } = deps;

  return {
    renderMessagesPage(req, res) {
      const userId = req.user.id;
      if (!isAdminUser(userId)) {
        return res.status(403).send('Acesso negado. Apenas administradores podem acessar esta página.');
      }

      return renderAdminMessages(res, {
        filters: normalizeAdminMessageActionFilters(req.query),
        openMessageKey: req.query.open,
        importPreview: getAdminMessageImportPreview(req)
      });
    },

    exportCsv(req, res) {
      const userId = req.user.id;
      if (!isAdminUser(userId)) {
        return res.status(403).send('Acesso negado.');
      }

      try {
        const exportFile = buildMessageCsvExport();
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${exportFile.filename}"`);
        return res.send(exportFile.content);
      } catch (error) {
        return renderAdminMessages(res, {
          error: getFriendlyErrorMessage(error, { defaultMessage: 'Não consegui montar o CSV do catálogo agora.' }),
          filters: normalizeAdminMessageActionFilters(req.query),
          importPreview: getAdminMessageImportPreview(req)
        });
      }
    },

    importPreview(req, res) {
      const userId = req.user.id;
      if (!isAdminUser(userId)) {
        return res.status(403).send('Acesso negado.');
      }

      const filters = normalizeAdminMessageActionFilters(req.body);
      const uploadedFile = req.file;
      if (!uploadedFile || !uploadedFile.buffer) {
        clearAdminMessageImportPreview(req);
        return renderAdminMessages(res, {
          error: 'Escolha um CSV do catálogo antes de pedir a prévia do lote.',
          filters,
          importPreview: null
        });
      }

      try {
        const importPreview = buildImportPreviewFromBuffer({
          fileBuffer: uploadedFile.buffer,
          fileName: uploadedFile.originalname
        });

        setAdminMessageImportPreview(req, importPreview);
        const infoMessage = importPreview.errorRows > 0
          ? 'A prévia encontrou algumas linhas pedindo ajuste antes de importar.'
          : (importPreview.changedRows > 0
            ? 'Prévia do lote pronta. Confere os impactos antes de aplicar.'
            : 'Prévia pronta. Esse arquivo não trouxe mudança nova para aplicar.');

        return renderAdminMessages(res, {
          success: infoMessage,
          filters,
          importPreview
        });
      } catch (error) {
        clearAdminMessageImportPreview(req);
        return renderAdminMessages(res, {
          error: getFriendlyErrorMessage(error, { defaultMessage: 'Não consegui ler esse CSV agora.' }),
          filters,
          importPreview: null
        });
      }
    },

    confirmImport(req, res) {
      const userId = req.user.id;
      if (!isAdminUser(userId)) {
        return res.status(403).send('Acesso negado.');
      }

      const filters = normalizeAdminMessageActionFilters(req.body);
      const preview = getAdminMessageImportPreview(req);
      if (!preview) {
        setFlash(req, 'error', 'A prévia do lote expirou por aqui. Reimporte o CSV para seguir.');
        return res.redirect(buildAdminMessagesPath(filters));
      }

      try {
        const result = applyImportPreview({ preview, changedByUserId: userId });
        clearAdminMessageImportPreview(req);
        const success = result.appliedCount > 0
          ? `Lote aplicado. ${result.appliedCount} mensagem(ns) já saíram atualizadas sem precisar de deploy.`
          : 'Esse lote não tinha mudança nova para aplicar.';
        setFlash(req, 'success', success);
        return res.redirect(buildAdminMessagesPath(filters));
      } catch (error) {
        return renderAdminMessages(res, {
          error: getFriendlyErrorMessage(error, { defaultMessage: 'Não consegui aplicar esse lote agora.' }),
          filters,
          importPreview: preview
        });
      }
    },

    cancelImport(req, res) {
      const userId = req.user.id;
      if (!isAdminUser(userId)) {
        return res.status(403).send('Acesso negado.');
      }

      clearAdminMessageImportPreview(req);
      setFlash(req, 'info', 'Prévia do lote descartada. Nada foi aplicado no catálogo.');
      return res.redirect(buildAdminMessagesPath(normalizeAdminMessageActionFilters(req.body)));
    },

    saveCustomization(req, res) {
      const userId = req.user.id;
      if (!isAdminUser(userId)) {
        return res.status(403).send('Acesso negado.');
      }

      const messageKey = String(req.params.messageKey || '').trim();
      const filters = normalizeAdminMessageActionFilters(req.body);

      try {
        const result = saveMessageTemplateCustomization({
          messageKey,
          customTitle: req.body.custom_title,
          customBody: req.body.custom_body,
          changedByUserId: userId,
          source: 'admin_panel'
        });

        const success = result.changed
          ? 'Mensagem guardada por aqui. Agora o catálogo já fala esse texto sem depender de deploy.'
          : 'Mensagem conferida. Não achei mudança nova para guardar aqui.';

        clearAdminMessageImportPreview(req);
        setFlash(req, 'success', success);
        return res.redirect(buildAdminMessagesPath(filters, { open: messageKey }));
      } catch (error) {
        const validationMessage = Array.isArray(error?.validationErrors) && error.validationErrors.length
          ? error.validationErrors.map((item) => item.message).join(' ')
          : getFriendlyErrorMessage(error, { defaultMessage: 'Não consegui salvar essa mensagem agora.' });

        return renderAdminMessages(res, {
          error: validationMessage,
          filters,
          openMessageKey: messageKey,
          importPreview: getAdminMessageImportPreview(req),
          draftByMessageKey: {
            [messageKey]: {
              custom_title: req.body.custom_title,
              custom_body: req.body.custom_body
            }
          }
        });
      }
    },

    resetCustomization(req, res) {
      const userId = req.user.id;
      if (!isAdminUser(userId)) {
        return res.status(403).send('Acesso negado.');
      }

      const messageKey = String(req.params.messageKey || '').trim();
      const filters = normalizeAdminMessageActionFilters(req.body);

      try {
        const result = resetMessageTemplateCustomization({
          messageKey,
          changedByUserId: userId,
          source: 'admin_reset'
        });

        const success = result.changed
          ? 'Mensagem restaurada para o padrão do app. Voltou para a versão nativa sem drama.'
          : 'Essa mensagem já estava usando o padrão do app. Nada precisou ser desfeito.';

        clearAdminMessageImportPreview(req);
        setFlash(req, 'success', success);
        return res.redirect(buildAdminMessagesPath(filters, { open: messageKey }));
      } catch (error) {
        return renderAdminMessages(res, {
          error: getFriendlyErrorMessage(error, { defaultMessage: 'Não consegui restaurar essa mensagem agora.' }),
          filters,
          openMessageKey: messageKey,
          importPreview: getAdminMessageImportPreview(req)
        });
      }
    },

    previewMessage(req, res) {
      const userId = req.user.id;
      if (!isAdminUser(userId)) {
        return res.status(403).json({ ok: false, message: 'Acesso negado.' });
      }

      const messageKey = String(req.params.messageKey || '').trim();

      try {
        const preview = buildMessagePreview(messageKey, {
          templateOverrides: {
            titleTemplate: req.body.custom_title,
            bodyTemplate: req.body.custom_body
          }
        });

        if (Array.isArray(preview.validationErrors) && preview.validationErrors.length) {
          return res.status(422).json({
            ok: false,
            message: 'A prévia encontrou placeholder pedindo atenção antes de seguir.',
            validationErrors: preview.validationErrors
          });
        }

        return res.json({ ok: true, preview });
      } catch (error) {
        return res.status(error?.status || 500).json({
          ok: false,
          message: getFriendlyErrorMessage(error, { defaultMessage: 'Não consegui montar a prévia agora.' })
        });
      }
    },

    async pushTest(req, res) {
      const userId = req.user.id;
      if (!isAdminUser(userId)) {
        return res.status(403).json({ ok: false, message: 'Acesso negado.' });
      }

      if (!isPushConfigured() || !webPush) {
        return res.status(503).json({ ok: false, message: 'O push ainda não está configurado neste servidor.' });
      }

      const messageKey = String(req.params.messageKey || '').trim();
      const rateKey = `${userId}:${messageKey}`;
      const lastSentAt = adminMessagePushTestRateLimit.get(rateKey) || 0;
      const elapsed = Date.now() - lastSentAt;

      if (elapsed < ADMIN_MESSAGE_PUSH_TEST_RATE_LIMIT_MS) {
        const secondsLeft = Math.max(1, Math.ceil((ADMIN_MESSAGE_PUSH_TEST_RATE_LIMIT_MS - elapsed) / 1000));
        return res.status(429).json({
          ok: false,
          message: `Segura só ${secondsLeft}s para repetir esse push de teste neste aparelho.`
        });
      }

      const subscription = req.body?.subscription;
      const endpoint = String(subscription?.endpoint || '').trim();
      if (!endpoint) {
        return res.status(409).json({ ok: false, message: 'Antes do teste, ative os alertas neste aparelho para a gente saber onde bater.' });
      }

      try {
        const preview = buildMessagePreview(messageKey, {
          templateOverrides: {
            titleTemplate: req.body.custom_title,
            bodyTemplate: req.body.custom_body
          }
        });

        if (preview.preview?.kind !== 'push') {
          return res.status(400).json({ ok: false, message: 'Esse item usa prévia visual na tela. O push de teste só entra em campo quando o canal é push.' });
        }

        if (Array.isArray(preview.validationErrors) && preview.validationErrors.length) {
          return res.status(422).json({
            ok: false,
            message: 'O push de teste encontrou placeholder pedindo atenção antes de seguir.',
            validationErrors: preview.validationErrors
          });
        }

        const payload = buildPushTestPayload(messageKey, {
          templateOverrides: {
            titleTemplate: req.body.custom_title,
            bodyTemplate: req.body.custom_body
          }
        });

        payload.href = '/admin/messages';
        payload.tag = `preview:${messageKey}:${userId}`;
        upsertPushSubscription(userId, subscription);

        await webPush.sendNotification(subscription, JSON.stringify({
          title: payload.title,
          body: payload.body,
          href: payload.href,
          tag: payload.tag,
          isTest: true,
          previewMessageKey: payload.previewMessageKey
        }));

        adminMessagePushTestRateLimit.set(rateKey, Date.now());
        return res.json({ ok: true, message: 'Push de teste enviado para este aparelho. Dá uma olhadinha se ele apareceu redondinho por aí.' });
      } catch (error) {
        if (error?.statusCode === 404 || error?.statusCode === 410) {
          removePushSubscriptionForUser(userId, endpoint);
          return res.status(410).json({ ok: false, message: 'A inscrição deste aparelho expirou. Liga os alertas de novo e a gente tenta mais uma.' });
        }

        return res.status(500).json({
          ok: false,
          message: getFriendlyErrorMessage(error, { defaultMessage: 'Não consegui mandar o push de teste agora.' })
        });
      }
    }
  };
}

module.exports = {
  createAdminMessagesController
};
