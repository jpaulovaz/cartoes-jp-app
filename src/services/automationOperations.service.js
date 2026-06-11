const { createAutomationOperationsRepository } = require('../repositories/automationOperations.repository');

function createAutomationOperationsService(deps = {}) {
  const repository = deps.repository || createAutomationOperationsRepository(deps);
  const isAdminUser = deps.isAdminUser || (() => false);
  const getFriendlyErrorMessage = deps.getFriendlyErrorMessage || ((error, opts = {}) => error?.message || opts.defaultMessage || 'Não consegui concluir essa ação agora.');

  function ensureAdmin(userId) {
    if (isAdminUser(userId)) return null;
    return { status: 403, text: 'Acesso negado. Apenas administradores podem operar as automações.' };
  }

  function normalizeFilters(query = {}) {
    return {
      q: String(query.q || '').trim(),
      workflow_key: String(query.workflow_key || query.workflowKey || 'all').trim() || 'all',
      status: String(query.status || 'all').trim() || 'all',
      user_id: Number(query.user_id || query.userId || 0) || 0,
      from: String(query.from || '').trim(),
      to: String(query.to || '').trim(),
      limit: Math.max(1, Math.min(250, Number(query.limit || 50) || 50))
    };
  }

  function buildPageState(userId, query = {}, extra = {}) {
    const forbidden = ensureAdmin(userId);
    if (forbidden) return { forbidden };

    repository.seedWorkflowRegistry();
    const filters = normalizeFilters(query);
    const workflows = repository.listWorkflows();
    const users = repository.getUsersWithPreferences();
    const logs = repository.listIntentLogs(filters);
    const errors = repository.listErrorEvents(12);
    const stats = repository.getDashboardStats();
    const pendingConversations = repository.getPendingConversations(12);
    const hmacRequired = String(repository.getAppSetting('AUTOMATION_HMAC_REQUIRED', '0')) === '1';
    const hmacSecretConfigured = !!String(repository.getAppSetting('AUTOMATION_HMAC_SECRET', '') || '').trim();
    const tokenConfigured = !!String(repository.getAppSetting('AUTOMATION_API_TOKEN', '') || '').trim();

    return {
      state: {
        ...extra,
        filters,
        workflows,
        users,
        logs,
        errors,
        stats,
        pendingConversations,
        securityState: {
          hmacRequired,
          hmacSecretConfigured,
          tokenConfigured,
          allowedIps: String(repository.getAppSetting('AUTOMATION_ALLOWED_IPS', '') || '').trim(),
          logRetentionDays: Number(repository.getAppSetting('AUTOMATION_LOG_RETENTION_DAYS', '90') || 90),
          errorRetentionDays: Number(repository.getAppSetting('AUTOMATION_ERROR_RETENTION_DAYS', '180') || 180)
        }
      }
    };
  }

  function updateWorkflow(userId, workflowKey, body = {}) {
    const forbidden = ensureAdmin(userId);
    if (forbidden) return { forbidden };
    try {
      const workflow = repository.updateWorkflow(workflowKey, {
        enabled: body.enabled ? '1' : '0',
        maintenance_mode: body.maintenance_mode ? '1' : '0',
        rate_limit_per_minute: body.rate_limit_per_minute,
        notes: body.notes
      });
      if (!workflow) throw new Error('Workflow não encontrado.');
      return buildPageState(userId, body, {
        success: `${workflow.title || workflow.name} atualizado. O interruptor ficou do jeito combinado.`,
        activePanel: 'workflows'
      });
    } catch (error) {
      return buildPageState(userId, body, {
        error: getFriendlyErrorMessage(error, { defaultMessage: 'Não consegui atualizar esse workflow agora.' }),
        activePanel: 'workflows'
      });
    }
  }

  function updateUserPreferences(userId, targetUserId, body = {}) {
    const forbidden = ensureAdmin(userId);
    if (forbidden) return { forbidden };
    try {
      const workflowPrefs = {};
      repository.listWorkflows()
        .filter((workflow) => workflow.workflow_key !== 'automation-api' && workflow.workflow_key !== '9.1')
        .forEach((workflow) => {
          workflowPrefs[workflow.workflow_key] = body[`workflow_${workflow.workflow_key}`] ? '1' : '0';
        });
      repository.updateUserPreferences(targetUserId, workflowPrefs, userId);
      return buildPageState(userId, body, {
        success: 'Preferências do usuário salvas. Cada família fica no seu quadrado, sem derrubar as outras.',
        activePanel: 'users'
      });
    } catch (error) {
      return buildPageState(userId, body, {
        error: getFriendlyErrorMessage(error, { defaultMessage: 'Não consegui salvar as preferências desse usuário agora.' }),
        activePanel: 'users'
      });
    }
  }

  function rotateToken(userId, body = {}) {
    const forbidden = ensureAdmin(userId);
    if (forbidden) return { forbidden };
    try {
      const confirmation = String(body.confirmation || '').trim().toLowerCase();
      if (confirmation !== 'rotacionar token') {
        throw new Error('Para girar a chave, escreva exatamente: rotacionar token. Segredo financeiro não gira no susto.');
      }
      const token = repository.generateAutomationToken();
      repository.setAppSetting('AUTOMATION_API_TOKEN', token, userId);
      return buildPageState(userId, {}, {
        success: 'Token da automação rotacionado. Atualize o N8N antes de testar os fluxos novamente.',
        rotatedToken: token,
        activePanel: 'security'
      });
    } catch (error) {
      return buildPageState(userId, {}, {
        error: getFriendlyErrorMessage(error, { defaultMessage: 'Não consegui rotacionar o token agora.' }),
        activePanel: 'security'
      });
    }
  }

  function pruneLogs(userId, body = {}) {
    const forbidden = ensureAdmin(userId);
    if (forbidden) return { forbidden };
    try {
      const requestDays = Number(body.request_days || repository.getAppSetting('AUTOMATION_LOG_RETENTION_DAYS', '90') || 90);
      const errorDays = Number(body.error_days || repository.getAppSetting('AUTOMATION_ERROR_RETENTION_DAYS', '180') || 180);
      const result = repository.pruneAutomationLogs({ requestDays, errorDays, intentDays: requestDays });
      return buildPageState(userId, {}, {
        success: `Limpeza concluída: ${result.requestLogs} log(s) técnicos, ${result.intentLogs} intent(s) e ${result.errorEvents} erro(s) arquivaram a chuteira.`,
        activePanel: 'logs'
      });
    } catch (error) {
      return buildPageState(userId, {}, {
        error: getFriendlyErrorMessage(error, { defaultMessage: 'Não consegui limpar os logs agora.' }),
        activePanel: 'logs'
      });
    }
  }

  return {
    buildPageState,
    updateWorkflow,
    updateUserPreferences,
    rotateToken,
    pruneLogs
  };
}

module.exports = {
  createAutomationOperationsService
};
