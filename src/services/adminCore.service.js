const { createAdminCoreRepository } = require('../repositories/adminCore.repository');

function createAdminCoreService(deps = {}) {
  const repository = deps.repository || createAdminCoreRepository(deps);

  function ensureAdmin(userId, { page = false } = {}) {
    if (repository.isAdminUser(userId)) {
      return null;
    }

    return page
      ? { status: 403, text: 'Acesso negado. Apenas administradores podem acessar esta página.' }
      : { status: 403, text: 'Acesso negado.' };
  }

  function renderAdminPage(userId) {
    const forbidden = ensureAdmin(userId, { page: true });
    if (forbidden) return { forbidden };
    return { state: {} };
  }

  function saveSettingsSection(userId, sectionKey, body = {}) {
    const forbidden = ensureAdmin(userId);
    if (forbidden) return { forbidden };

    const safeSectionKey = String(sectionKey || '').trim();
    const section = repository.getSettingSection(safeSectionKey);
    if (!section) {
      return {
        state: { error: 'Seção de configuração não encontrada.', activeSection: 'access' }
      };
    }

    const definitions = repository.getSettingDefinitionsBySection(safeSectionKey);
    const previousValues = Object.fromEntries(definitions.map((definition) => [definition.key, repository.getSettingValue(definition.key)]));

    try {
      const nextValues = {};

      definitions.forEach((definition) => {
        const rawValue = definition.input === 'switch'
          ? (body[definition.key] ? '1' : '0')
          : body[definition.key];
        nextValues[definition.key] = repository.sanitizeSettingValue(definition, rawValue);
      });

      if (safeSectionKey === 'backup') {
        const primaryDir = repository.resolveConfiguredDirectory(repository.appRoot, nextValues.BACKUP_LOCAL_PRIMARY_DIR, repository.DEFAULT_PRIMARY_BACKUP_DIR);
        const secondaryDir = repository.resolveConfiguredDirectory(repository.appRoot, nextValues.BACKUP_LOCAL_SECONDARY_DIR, repository.DEFAULT_SECONDARY_BACKUP_DIR);
        if (repository.path.resolve(primaryDir) === repository.path.resolve(secondaryDir)) {
          throw new Error('As duas pastas locais do backup precisam ser diferentes. Espelho no mesmo lugar vira só déjà vu.');
        }
      }

      repository.updateAppSettings(nextValues, userId);

      const changedDefinitions = definitions.filter((definition) => String(previousValues[definition.key] ?? '') !== String(nextValues[definition.key] ?? ''));
      const liveChanges = changedDefinitions.filter((definition) => !definition.restartRequired);
      const restartChanges = changedDefinitions.filter((definition) => definition.restartRequired);

      let success = changedDefinitions.length
        ? `${section.title} guardada com sucesso.`
        : `${section.title} conferida. Não achei nada novo para salvar.`;

      if (liveChanges.length) {
        success += ' O que dava para recarregar na hora já entrou em campo.';
      }

      if (restartChanges.length) {
        success += ` Para ${restartChanges.map((definition) => definition.label).join(', ')} valerem, reinicie o servidor.`;
      }

      if (safeSectionKey === 'google' && !repository.isGoogleAuthConfigured()) {
        success += ' Enquanto Client ID e secret não estiverem completos, o login com Google segue de folga.';
      }

      if (safeSectionKey === 'push') {
        const pushPanel = repository.buildPushAdminState();
        success += ` Agenda automática em ${pushPanel.schedule.label}. ${pushPanel.activeCount} de ${pushPanel.totalCount} rotinas estão ligadas.`;
        if (!pushPanel.infrastructure.configured) {
          success += pushPanel.hasInAppFallback
            ? ' O push web ainda depende do trio VAPID, mas os alertas que também viram aviso interno continuam no jogo.'
            : ' Sem o trio VAPID completo, o sininho ainda não acorda.';
        }
      }

      if (safeSectionKey === 'backup') {
        const backupConfig = repository.getBackupRuntimeConfig();
        if (backupConfig.googleEnabled && !backupConfig.googleRefreshToken) {
          success += ' O Google Drive ficou habilitado, mas ainda falta conectar uma conta ali no bloco da seção.';
        }
      }

      if (safeSectionKey === 'email') {
        const emailConfig = repository.getEmailRuntimeConfig();
        if (emailConfig.enabled && !repository.isEmailConfigured(emailConfig)) {
          success += ' O bloco já salvou, mas ainda faltam host, porta, usuário, senha ou remetente para o e-mail entrar em campo.';
        }
      }

      return {
        state: { success, activeSection: safeSectionKey }
      };
    } catch (error) {
      return {
        state: {
          error: repository.getFriendlyErrorMessage(error, { defaultMessage: 'Não consegui salvar essa seção agora.' }),
          activeSection: safeSectionKey
        }
      };
    }
  }

  async function testEmailConnection(userId) {
    const forbidden = ensureAdmin(userId);
    if (forbidden) return { forbidden };

    try {
      const emailConfig = repository.getEmailRuntimeConfig();
      if (!repository.isEmailConfigured(emailConfig)) {
        throw new Error('Antes do teste, complete host, porta, usuário, senha e remetente do SMTP.');
      }
      await repository.verifyEmailTransport(emailConfig);
      return {
        state: {
          success: `Conexão SMTP validada com sucesso em ${emailConfig.host}:${emailConfig.port}. O correio está com a chuteira amarrada.`,
          activeSection: 'email'
        }
      };
    } catch (error) {
      if (error?.code === 'EMAIL_RUNTIME_MISSING') {
        repository.logEmailRuntimeIssue('admin-test-connection');
      }
      repository.logEmailFlowError('test-connection', error, {
        adminUserId: userId,
        ...repository.buildEmailTransportLogContext(repository.getEmailRuntimeConfig())
      });
      return {
        state: {
          error: repository.getFriendlyErrorMessage(error, { defaultMessage: 'Não consegui validar a conexão SMTP agora.' }),
          activeSection: 'email'
        }
      };
    }
  }

  async function sendTestEmail({ userId, body = {}, req, currentUser = null }) {
    const forbidden = ensureAdmin(userId);
    if (forbidden) return { forbidden };

    try {
      const adminUser = repository.getUserRecord(userId, { includeDeleted: false }) || currentUser;
      const result = await repository.sendAdminTestEmail({
        recipientEmail: body.test_recipient_email,
        createdByUser: adminUser,
        req
      });
      return {
        state: {
          success: `E-mail de teste enviado direitinho${result.messageId ? ` (messageId ${result.messageId})` : ''}. Agora o SMTP já mostrou que sabe o caminho.`,
          activeSection: 'email'
        }
      };
    } catch (error) {
      if (error?.code === 'EMAIL_RUNTIME_MISSING') {
        repository.logEmailRuntimeIssue('admin-send-test');
      }
      repository.logEmailFlowError('admin-send-test', error, {
        adminUserId: userId,
        recipientEmail: String(body.test_recipient_email || '').trim() || null,
        ...repository.buildEmailTransportLogContext(repository.getEmailRuntimeConfig())
      });
      return {
        state: {
          error: repository.getFriendlyErrorMessage(error, { defaultMessage: 'Não consegui mandar o e-mail de teste agora.' }),
          activeSection: 'email'
        }
      };
    }
  }

  function downloadBackupGuide(userId) {
    const forbidden = ensureAdmin(userId);
    if (forbidden) return { forbidden };

    const guidePath = repository.path.join(repository.appRoot, 'public', 'docs', 'guia-backup-acerttapay.pdf');
    if (!repository.fs.existsSync(guidePath)) {
      return {
        state: {
          error: 'O guia em PDF ainda não está disponível neste servidor.',
          activeSection: 'backup'
        }
      };
    }

    return {
      downloadPath: guidePath,
      filename: 'guia-backup-acerttapay.pdf'
    };
  }

  function connectGoogleBackup(userId, req) {
    const forbidden = ensureAdmin(userId);
    if (forbidden) return { forbidden };

    try {
      return { redirectTo: repository.buildGoogleBackupAuthUrl(req) };
    } catch (error) {
      return {
        state: {
          error: repository.getFriendlyErrorMessage(error, { defaultMessage: 'Não consegui preparar a conexão com o Google Drive agora.' }),
          activeSection: 'backup'
        }
      };
    }
  }

  async function handleGoogleBackupCallback(userId, req) {
    const forbidden = ensureAdmin(userId);
    if (forbidden) return { forbidden };

    const returnedState = String(req.query.state || '').trim();
    const expectedState = String(req.session?.backupGoogleAuthState || '').trim();
    delete req.session.backupGoogleAuthState;
    delete req.session.backupGoogleAuthCreatedAt;

    if (req.query.error) {
      return {
        state: {
          error: `O Google devolveu um não agora: ${String(req.query.error_description || req.query.error)}`,
          activeSection: 'backup'
        }
      };
    }

    if (!returnedState || !expectedState || returnedState !== expectedState) {
      return {
        state: {
          error: 'A validação da conexão com o Google Drive não bateu. Tenta conectar de novo.',
          activeSection: 'backup'
        }
      };
    }

    const code = String(req.query.code || '').trim();
    if (!code) {
      return {
        state: {
          error: 'O Google não devolveu o código de autorização do backup.',
          activeSection: 'backup'
        }
      };
    }

    try {
      const tokens = await repository.exchangeGoogleBackupCodeForTokens(code);
      const refreshToken = String(tokens.refresh_token || '').trim() || repository.getInternalSettingValue(repository.BACKUP_GOOGLE_REFRESH_TOKEN_KEY);
      if (!refreshToken) {
        throw new Error('O Google não devolveu refresh token. Revogue o acesso anterior e conecte novamente para liberar o modo automático.');
      }

      const accessToken = String(tokens.access_token || '').trim();
      const profile = accessToken ? await repository.fetchGoogleBackupProfile(accessToken).catch(() => ({})) : {};
      const config = repository.getBackupRuntimeConfig();
      const folder = accessToken
        ? await repository.ensureGoogleBackupFolder(accessToken, { ...config, googleRefreshToken: refreshToken }, userId).catch(() => null)
        : null;

      repository.setInternalSettings({
        [repository.BACKUP_GOOGLE_REFRESH_TOKEN_KEY]: refreshToken,
        [repository.BACKUP_GOOGLE_CONNECTED_EMAIL_KEY]: String(profile.email || config.googleConnectedEmail || '').trim(),
        [repository.BACKUP_GOOGLE_CONNECTED_AT_KEY]: repository.currentConfigTimestamp(),
        [repository.BACKUP_GOOGLE_SCOPE_KEY]: String(tokens.scope || '').trim(),
        [repository.BACKUP_GOOGLE_FOLDER_ID_KEY]: folder?.id || config.googleFolderId || '',
        [repository.BACKUP_GOOGLE_FOLDER_NAME_META_KEY]: folder?.name || config.googleFolderName
      }, userId);

      return {
        state: {
          success: `Google Drive conectado com sucesso${profile.email ? ` na conta ${profile.email}` : ''}. Agora o backup pode subir pra nuvem também.`,
          activeSection: 'backup'
        }
      };
    } catch (error) {
      return {
        state: {
          error: error?.response?.data?.error?.message || error.message || 'Não consegui concluir a conexão com o Google Drive agora.',
          activeSection: 'backup'
        }
      };
    }
  }

  function disconnectGoogleBackup(userId) {
    const forbidden = ensureAdmin(userId);
    if (forbidden) return { forbidden };

    repository.clearInternalSettings([
      repository.BACKUP_GOOGLE_REFRESH_TOKEN_KEY,
      repository.BACKUP_GOOGLE_CONNECTED_EMAIL_KEY,
      repository.BACKUP_GOOGLE_CONNECTED_AT_KEY,
      repository.BACKUP_GOOGLE_FOLDER_ID_KEY,
      repository.BACKUP_GOOGLE_SCOPE_KEY,
      repository.BACKUP_GOOGLE_FOLDER_NAME_META_KEY
    ], userId);

    return {
      state: {
        success: 'Conta do Google Drive desconectada. As cópias locais continuam valendo e a nuvem ficou de folga.',
        activeSection: 'backup'
      }
    };
  }

  async function runBackup(userId) {
    const forbidden = ensureAdmin(userId);
    if (forbidden) return { forbidden };

    try {
      const result = await repository.createServerBackup({ triggerKind: 'manual', createdByUserId: userId });
      return {
        state: {
          success: `${result.message} Pacote ${result.backupName} salvo com ${result.sizeBytes ? repository.formatBytes(result.sizeBytes) : 'tamanho ainda tímido'} de puro carinho preventivo.`,
          activeSection: 'backup'
        }
      };
    } catch (error) {
      return {
        state: {
          error: repository.getFriendlyErrorMessage(error, { defaultMessage: 'Não consegui criar o backup manual agora.' }),
          activeSection: 'backup'
        }
      };
    }
  }

  async function restoreBackup({ userId, uploadedPath, uploadedName }) {
    const forbidden = ensureAdmin(userId);
    if (forbidden) return { forbidden };

    if (!uploadedPath) {
      return {
        state: {
          error: 'Escolha um .zip de backup antes de mandar restaurar.',
          activeSection: 'backup'
        }
      };
    }

    try {
      const result = await repository.restoreServerBackupFromZip({
        zipPath: uploadedPath,
        uploadedFilename: uploadedName,
        restoredByUserId: userId
      });

      const extra = result.safetyBackupRunId
        ? ` Antes da restauração eu ainda gerei um backup de segurança (ID ${result.safetyBackupRunId}) para ninguém passar aperto.`
        : '';

      return {
        state: {
          success: `${result.message}${extra}`,
          activeSection: 'backup'
        }
      };
    } catch (error) {
      return {
        state: {
          error: repository.getFriendlyErrorMessage(error, { defaultMessage: 'Não consegui restaurar o backup agora.' }),
          activeSection: 'backup'
        }
      };
    }
  }

  async function cleanupUploadedBackup(uploadedPath) {
    if (!uploadedPath) return;
    await repository.fsp.rm(uploadedPath, { force: true }).catch(() => {});
  }

  function downloadBackupFile(userId, backupId, slot) {
    const forbidden = ensureAdmin(userId);
    if (forbidden) return { forbidden };

    const safeBackupId = Number(backupId);
    const safeSlot = String(slot || '').trim().toLowerCase();
    const row = Number.isInteger(safeBackupId) && safeBackupId > 0 ? repository.backupRunsSelectById.get(safeBackupId) : null;
    if (!row) {
      return {
        state: {
          error: 'Não achei esse backup para download.',
          activeSection: 'backup'
        }
      };
    }

    const targetPath = safeSlot === 'secondary' ? row.local_secondary_path : row.local_primary_path;
    if (!targetPath || !repository.fs.existsSync(targetPath)) {
      return {
        state: {
          error: 'Esse arquivo local não está mais disponível neste servidor.',
          activeSection: 'backup'
        }
      };
    }

    return {
      downloadPath: targetPath,
      filename: repository.path.basename(targetPath)
    };
  }

  return {
    renderAdminPage,
    saveSettingsSection,
    testEmailConnection,
    sendTestEmail,
    downloadBackupGuide,
    connectGoogleBackup,
    handleGoogleBackupCallback,
    disconnectGoogleBackup,
    runBackup,
    restoreBackup,
    cleanupUploadedBackup,
    downloadBackupFile
  };
}

module.exports = {
  createAdminCoreService
};
