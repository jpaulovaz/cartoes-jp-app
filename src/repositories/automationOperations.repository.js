const crypto = require('crypto');
const db = require('../db');

function nowIso() {
  return new Date().toISOString();
}

function safeJsonParse(value, fallback = null) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch (error) {
    return fallback;
  }
}

function safeJsonStringify(value, fallback = '{}') {
  try {
    return JSON.stringify(value == null ? null : value);
  } catch (error) {
    return fallback;
  }
}

function normalizeBool(value, fallback = false) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return ['1', 'true', 'on', 'yes', 'sim', 'enabled'].includes(String(value).trim().toLowerCase());
}

function normalizeInteger(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeSearch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9@._+ -]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const WORKFLOW_DEFINITIONS = [
  {
    workflow_key: 'automation-api',
    family_key: '0',
    name: 'Automation API',
    title: 'API base de automações',
    description: 'Camada protegida usada por todos os workflows N8N.',
    risk_level: 'operational',
    default_enabled: 1,
    default_rate_limit_per_minute: 300
  },

  {
    workflow_key: '0.0',
    family_key: '0.x',
    name: '0.0 - ACERTTAPAY_FLUXO_INICIAL',
    title: 'Fluxo Inicial WhatsApp',
    description: 'Orquestrador central: recebe a Evolution API, valida o usuário, monta capacidades, roteia intenção e aciona subfluxos.',
    risk_level: 'operational',
    default_enabled: 1,
    default_rate_limit_per_minute: 240
  },  {
    workflow_key: '1.1',
    family_key: '1.x',
    name: '1.1 - ACERTTAPAY_COMPRA_ASSISTIDA_CONCIERGE',
    title: 'Compra Assistida — Concierge',
    description: 'Registro de novas compras, escolha de cartão e divisão inicial.',
    risk_level: 'medium',
    default_enabled: 1,
    default_rate_limit_per_minute: 120
  },
  {
    workflow_key: '1.2',
    family_key: '1.x',
    name: '1.2 - ACERTTAPAY_COMPRA_ASSISTIDA_CORRECOES',
    title: 'Compra Assistida — Correções',
    description: 'Correção e remoção de compras recentes com confirmação.',
    risk_level: 'high',
    default_enabled: 1,
    default_rate_limit_per_minute: 60
  },
  {
    workflow_key: '1.3',
    family_key: '1.x',
    name: '1.3 - ACERTTAPAY_COMPRA_ASSISTIDA_PARTICIPANTES',
    title: 'Compra Assistida — Participantes',
    description: 'Reabre participantes e divisões de compras recentes.',
    risk_level: 'medium',
    default_enabled: 1,
    default_rate_limit_per_minute: 80
  },

  {
    workflow_key: '1.4',
    family_key: '1.x',
    name: '1.4 - ACERTTAPAY_COMPRA_ASSISTIDA_COMPROVANTE',
    title: 'Compra Assistida — Comprovante',
    description: 'Recebe imagens de comprovantes de cartão, extrai dados com IA e prepara compras para confirmação.',
    risk_level: 'high',
    default_enabled: 1,
    default_rate_limit_per_minute: 50
  },
  {
    workflow_key: '2.1',
    family_key: '2.x',
    name: '2.1 - ACERTTAPAY_CONSULTAS_FINANCEIRAS',
    title: 'Consultas Financeiras',
    description: 'Consultas de gastos, faturas, compras recentes e pendências.',
    risk_level: 'low',
    default_enabled: 1,
    default_rate_limit_per_minute: 180
  },
  {
    workflow_key: '3.1',
    family_key: '3.x',
    name: '3.1 - ACERTTAPAY_LEMBRETES',
    title: 'Lembretes — Conversa',
    description: 'Cria, lista, conclui, cancela e adia lembretes financeiros.',
    risk_level: 'medium',
    default_enabled: 1,
    default_rate_limit_per_minute: 100
  },
  {
    workflow_key: '3.2',
    family_key: '3.x',
    name: '3.2 - ACERTTAPAY_LEMBRETES_DISPAROS',
    title: 'Lembretes — Disparos',
    description: 'Busca lembretes vencidos e marca envios programados.',
    risk_level: 'medium',
    default_enabled: 1,
    default_rate_limit_per_minute: 120
  },
  {
    workflow_key: '4.1',
    family_key: '4.x',
    name: '4.1 - ACERTTAPAY_CENTRAL_DE_ACERTOS',
    title: 'Central de Acertos',
    description: 'Consulta e executa ações controladas em cobranças e Pix.',
    risk_level: 'high',
    default_enabled: 1,
    default_rate_limit_per_minute: 60
  },
  {
    workflow_key: '5.1',
    family_key: '5.x',
    name: '5.1 - ACERTTAPAY_FINANCAS_MENSAIS',
    title: 'Finanças Mensais',
    description: 'Gerencia receitas e despesas fora do cartão pelo WhatsApp.',
    risk_level: 'high',
    default_enabled: 1,
    default_rate_limit_per_minute: 70
  },
  {
    workflow_key: '6.1',
    family_key: '6.x',
    name: '6.1 - ACERTTAPAY_FECHAMENTO_ASSISTIDO',
    title: 'Fechamento Assistido',
    description: 'Diagnóstico, fechamento e reabertura mensal com confirmação forte.',
    risk_level: 'critical',
    default_enabled: 1,
    default_rate_limit_per_minute: 40
  },
  {
    workflow_key: '7.1',
    family_key: '7.x',
    name: '7.1 - ACERTTAPAY_IMPORTACAO_PDF_WHATSAPP',
    title: 'Importação PDF por WhatsApp',
    description: 'Recebe fatura PDF e cria job para revisão no app.',
    risk_level: 'high',
    default_enabled: 1,
    default_rate_limit_per_minute: 30
  },
  {
    workflow_key: '8.1',
    family_key: '8.x',
    name: '8.1 - ACERTTAPAY_CATEGORIAS_E_APRENDIZADO',
    title: 'Categorias e Aprendizado',
    description: 'Categoriza compras e cria regras de estabelecimento confirmadas.',
    risk_level: 'medium',
    default_enabled: 1,
    default_rate_limit_per_minute: 80
  },
  {
    workflow_key: '8.2',
    family_key: '8.x',
    name: '8.2 - ACERTTAPAY_RESUMOS_INTELIGENTES',
    title: 'Resumos Inteligentes',
    description: 'Gera resumos sob demanda e automáticos com opt-in.',
    risk_level: 'medium',
    default_enabled: 1,
    default_rate_limit_per_minute: 100
  },
  {
    workflow_key: '9.1',
    family_key: '9.x',
    name: '9.1 - ACERTTAPAY_OPERACOES_AUTOMACAO',
    title: 'Governança e Operação',
    description: 'Dashboard, logs, hardening, preferências e manutenção dos workflows.',
    risk_level: 'operational',
    default_enabled: 1,
    default_rate_limit_per_minute: 60
  }
];

function createAutomationOperationsRepository(deps = {}) {
  const database = deps.db || db;

  function tableExists(tableName) {
    try {
      return !!database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1").get(tableName);
    } catch (error) {
      return false;
    }
  }

  function automationTablesReady() {
    return tableExists('automation_workflow_registry') && tableExists('automation_user_preferences');
  }

  function getWorkflowDefinition(workflowKey) {
    const safeKey = String(workflowKey || '').trim();
    return WORKFLOW_DEFINITIONS.find((item) => item.workflow_key === safeKey) || WORKFLOW_DEFINITIONS[0];
  }

  function seedWorkflowRegistry() {
    if (!tableExists('automation_workflow_registry')) return [];
    const now = nowIso();
    const insert = database.prepare(`
      INSERT OR IGNORE INTO automation_workflow_registry (
        workflow_key, family_key, name, title, description, enabled, maintenance_mode,
        risk_level, rate_limit_per_minute, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
    `);
    const update = database.prepare(`
      UPDATE automation_workflow_registry
      SET family_key = ?,
          name = ?,
          title = ?,
          description = ?,
          risk_level = ?,
          rate_limit_per_minute = CASE WHEN COALESCE(rate_limit_per_minute, 0) <= 0 THEN ? ELSE rate_limit_per_minute END,
          updated_at = COALESCE(updated_at, ?)
      WHERE workflow_key = ?
    `);
    database.transaction(() => {
      WORKFLOW_DEFINITIONS.forEach((item) => {
        insert.run(
          item.workflow_key,
          item.family_key,
          item.name,
          item.title,
          item.description,
          Number(item.default_enabled ? 1 : 0),
          item.risk_level,
          Number(item.default_rate_limit_per_minute || 60),
          now,
          now
        );
        update.run(
          item.family_key,
          item.name,
          item.title,
          item.description,
          item.risk_level,
          Number(item.default_rate_limit_per_minute || 60),
          now,
          item.workflow_key
        );
      });
    })();
    return listWorkflows();
  }

  function listWorkflows() {
    if (!tableExists('automation_workflow_registry')) {
      return WORKFLOW_DEFINITIONS.map((item) => ({
        ...item,
        enabled: Number(item.default_enabled || 0),
        maintenance_mode: 0,
        rate_limit_per_minute: Number(item.default_rate_limit_per_minute || 60)
      }));
    }
    const rows = database.prepare(`
      SELECT *
      FROM automation_workflow_registry
      ORDER BY workflow_key ASC
    `).all();
    if (!rows.length) return WORKFLOW_DEFINITIONS;
    return rows;
  }

  function getWorkflowByKey(workflowKey) {
    const safeKey = String(workflowKey || '').trim() || 'automation-api';
    try {
      seedWorkflowRegistry();
      if (tableExists('automation_workflow_registry')) {
        const row = database.prepare(`
          SELECT *
          FROM automation_workflow_registry
          WHERE workflow_key = ?
          LIMIT 1
        `).get(safeKey);
        if (row) return row;
      }
    } catch (error) {
      // Sem migration, usamos fallback em memória para a aplicação continuar subindo.
    }
    const definition = getWorkflowDefinition(safeKey);
    return {
      ...definition,
      enabled: Number(definition.default_enabled || 0),
      maintenance_mode: 0,
      rate_limit_per_minute: Number(definition.default_rate_limit_per_minute || 60)
    };
  }

  function updateWorkflow(workflowKey, patch = {}) {
    if (!tableExists('automation_workflow_registry')) return null;
    seedWorkflowRegistry();
    const safeKey = String(workflowKey || '').trim();
    const current = getWorkflowByKey(safeKey);
    if (!current) return null;
    const enabled = patch.enabled === undefined ? Number(current.enabled || 0) : (normalizeBool(patch.enabled) ? 1 : 0);
    const maintenance = patch.maintenance_mode === undefined ? Number(current.maintenance_mode || 0) : (normalizeBool(patch.maintenance_mode) ? 1 : 0);
    const rateLimit = Math.max(1, Math.min(5000, normalizeInteger(patch.rate_limit_per_minute, Number(current.rate_limit_per_minute || 60))));
    const notes = normalizeText(patch.notes || current.notes || '').slice(0, 600);
    database.prepare(`
      UPDATE automation_workflow_registry
      SET enabled = ?,
          maintenance_mode = ?,
          rate_limit_per_minute = ?,
          notes = ?,
          updated_at = ?
      WHERE workflow_key = ?
    `).run(enabled, maintenance, rateLimit, notes, nowIso(), safeKey);
    return getWorkflowByKey(safeKey);
  }

  function inferWorkflowFromPath(pathname = '', method = '') {
    const path = `/${String(pathname || '').split('?')[0].replace(/^\/+/, '')}`;
    const httpMethod = String(method || '').toUpperCase();
    let workflowKey = 'automation-api';
    let operation = 'automation.api';
    let familyKey = '0';

    if (path === '/health') {
      workflowKey = 'automation-api';
      operation = 'automation.health';
    } else if (path.startsWith('/router/')) {
      workflowKey = '0.0';
      operation = `router.${path.split('/').filter(Boolean).slice(1).join('.') || 'run'}`;
    } else if (path.startsWith('/queries/')) {
      workflowKey = '2.1';
      operation = `query.${path.split('/').filter(Boolean).slice(1).join('.') || 'run'}`;
    } else if (path.startsWith('/reminders/due') || path.includes('/mark-sent')) {
      workflowKey = '3.2';
      operation = 'reminder.dispatch';
    } else if (path.startsWith('/reminders')) {
      workflowKey = '3.1';
      operation = 'reminder.command';
    } else if (path.startsWith('/shared-debts')) {
      workflowKey = '4.1';
      operation = 'shared_debt.command';
    } else if (path.startsWith('/monthly-finances')) {
      workflowKey = '5.1';
      operation = 'monthly_finance.command';
    } else if (path.startsWith('/month-close')) {
      workflowKey = '6.1';
      operation = 'month_close.command';
    } else if (path.startsWith('/purchases/receipt-image')) {
      workflowKey = '1.4';
      operation = 'purchase.receipt_image';
    } else if (path.startsWith('/imports/pdf')) {
      workflowKey = '7.1';
      operation = 'pdf_import.command';
    } else if (path.startsWith('/categories')) {
      workflowKey = '8.1';
      operation = 'category.command';
    } else if (path.startsWith('/insights')) {
      workflowKey = '8.2';
      operation = 'insight.command';
    } else if (path.includes('/participants/reopen')) {
      workflowKey = '1.3';
      operation = 'purchase.participants.reopen';
    } else if (path.includes('/prepare-edit') || path.includes('/confirm-edit') || path.includes('/prepare-delete') || path.includes('/confirm-delete') || path === '/purchases/recent') {
      workflowKey = '1.2';
      operation = 'purchase.correction';
    } else if (path.startsWith('/purchases') || path.startsWith('/conversations') || path.startsWith('/whatsapp/resolve')) {
      workflowKey = '1.1';
      operation = path.startsWith('/whatsapp/resolve') ? 'whatsapp.resolve' : 'purchase.assisted';
    }

    const definition = getWorkflowDefinition(workflowKey);
    familyKey = definition.family_key || `${workflowKey.split('.')[0]}.x`;
    return { workflowKey, familyKey, operation, path, method: httpMethod };
  }

  function extractPhoneFromPayload(payload = {}) {
    if (!payload || typeof payload !== 'object') return '';
    return String(
      payload.phone ||
      payload.user_phone ||
      payload.number ||
      payload.whatsapp_number ||
      payload.source?.phone ||
      payload.source?.user_phone ||
      ''
    ).trim();
  }

  function getUserPreference(userId, workflowKey) {
    if (!tableExists('automation_user_preferences')) return null;
    return database.prepare(`
      SELECT *
      FROM automation_user_preferences
      WHERE user_id = ? AND workflow_key = ?
      LIMIT 1
    `).get(Number(userId || 0), String(workflowKey || '').trim());
  }

  function isUserWorkflowEnabled(userId, workflowKey) {
    const safeUserId = Number(userId || 0);
    const safeWorkflowKey = String(workflowKey || '').trim();
    if (!safeUserId || !safeWorkflowKey || safeWorkflowKey === 'automation-api') return true;
    const pref = getUserPreference(safeUserId, safeWorkflowKey);
    return !pref || Number(pref.enabled || 0) !== 0;
  }

  function updateUserPreferences(userId, workflowPreferenceMap = {}, updatedByUserId = null) {
    if (!tableExists('automation_user_preferences')) return [];
    seedWorkflowRegistry();
    const safeUserId = Number(userId || 0);
    if (!safeUserId) return [];
    const now = nowIso();
    const upsert = database.prepare(`
      INSERT INTO automation_user_preferences (user_id, workflow_key, enabled, created_at, updated_at, updated_by_user_id)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, workflow_key) DO UPDATE SET
        enabled = excluded.enabled,
        updated_at = excluded.updated_at,
        updated_by_user_id = excluded.updated_by_user_id
    `);
    database.transaction(() => {
      listWorkflows().filter((workflow) => workflow.workflow_key !== 'automation-api' && workflow.workflow_key !== '9.1').forEach((workflow) => {
        const enabled = normalizeBool(workflowPreferenceMap[workflow.workflow_key], false) ? 1 : 0;
        upsert.run(safeUserId, workflow.workflow_key, enabled, now, now, Number(updatedByUserId || 0) || null);
      });
    })();
    return listUserPreferences(safeUserId);
  }

  function listUserPreferences(userId) {
    if (!tableExists('automation_user_preferences')) return [];
    return database.prepare(`
      SELECT p.*, w.title, w.family_key, w.risk_level
      FROM automation_user_preferences p
      LEFT JOIN automation_workflow_registry w ON w.workflow_key = p.workflow_key
      WHERE p.user_id = ?
      ORDER BY p.workflow_key ASC
    `).all(Number(userId || 0));
  }

  function getUsersWithPreferences() {
    const users = database.prepare(`
      SELECT u.id, u.name, u.email, u.status,
             a.phone_e164, a.enabled AS whatsapp_enabled, a.last_used_at
      FROM users u
      LEFT JOIN automation_whatsapp_authorizations a ON a.user_id = u.id
      WHERE COALESCE(u.status, 'active') <> 'deleted'
      ORDER BY lower(COALESCE(u.name, u.email)), u.id ASC
    `).all();

    const workflows = listWorkflows().filter((workflow) => workflow.workflow_key !== 'automation-api' && workflow.workflow_key !== '9.1');
    return users.map((user) => {
      const prefs = listUserPreferences(user.id);
      const byKey = new Map(prefs.map((pref) => [pref.workflow_key, Number(pref.enabled || 0) !== 0]));
      return {
        ...user,
        preferences: workflows.map((workflow) => ({
          workflow_key: workflow.workflow_key,
          title: workflow.title || workflow.name,
          enabled: byKey.has(workflow.workflow_key) ? byKey.get(workflow.workflow_key) : true
        }))
      };
    });
  }

  function logIntentEvent(payload = {}) {
    if (!tableExists('automation_intent_logs')) return null;
    const info = database.prepare(`
      INSERT INTO automation_intent_logs (
        user_id, phone_e164, workflow_key, family_key, intent, operation, status_code,
        result_code, channel, source_message_id, request_meta_json, response_meta_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      Number(payload.userId || 0) || null,
      payload.phoneE164 || null,
      payload.workflowKey || null,
      payload.familyKey || null,
      payload.intent || null,
      payload.operation || null,
      Number(payload.statusCode || 0) || null,
      payload.resultCode || null,
      payload.channel || 'whatsapp',
      payload.sourceMessageId || null,
      safeJsonStringify(payload.requestMeta || {}, '{}'),
      safeJsonStringify(payload.responseMeta || {}, '{}'),
      payload.createdAt || nowIso()
    );
    return Number(info.lastInsertRowid || 0) || null;
  }

  function logErrorEvent(payload = {}) {
    if (!tableExists('automation_error_events')) return null;
    const info = database.prepare(`
      INSERT INTO automation_error_events (
        user_id, phone_e164, workflow_key, family_key, operation, status_code,
        result_code, error_message, error_stack, request_meta_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      Number(payload.userId || 0) || null,
      payload.phoneE164 || null,
      payload.workflowKey || null,
      payload.familyKey || null,
      payload.operation || null,
      Number(payload.statusCode || 0) || null,
      payload.resultCode || null,
      payload.errorMessage || null,
      payload.errorStack || null,
      safeJsonStringify(payload.requestMeta || {}, '{}'),
      payload.createdAt || nowIso()
    );
    return Number(info.lastInsertRowid || 0) || null;
  }

  function findAutomationUserByPhone(phoneE164) {
    const phone = String(phoneE164 || '').trim();
    if (!phone || !tableExists('automation_whatsapp_authorizations')) return null;
    return database.prepare(`
      SELECT a.*, u.email, u.name, u.status AS user_status
      FROM automation_whatsapp_authorizations a
      JOIN users u ON u.id = a.user_id
      WHERE a.phone_e164 = ? OR a.whatsapp_number = ?
      ORDER BY a.enabled DESC, a.id DESC
      LIMIT 1
    `).get(phone, phone.replace(/\D/g, ''));
  }

  function listIntentLogs(filters = {}) {
    if (!tableExists('automation_intent_logs')) return [];
    const where = [];
    const params = [];
    const q = normalizeSearch(filters.q || '');
    if (q) {
      where.push(`(
        lower(COALESCE(l.phone_e164, '')) LIKE ? OR
        lower(COALESCE(l.workflow_key, '')) LIKE ? OR
        lower(COALESCE(l.operation, '')) LIKE ? OR
        lower(COALESCE(l.result_code, '')) LIKE ? OR
        lower(COALESCE(u.email, '')) LIKE ? OR
        lower(COALESCE(u.name, '')) LIKE ?
      )`);
      const like = `%${q}%`;
      params.push(like, like, like, like, like, like);
    }
    const workflowKey = String(filters.workflow_key || filters.workflowKey || '').trim();
    if (workflowKey && workflowKey !== 'all') {
      where.push('l.workflow_key = ?');
      params.push(workflowKey);
    }
    const status = String(filters.status || '').trim();
    if (status === 'error') {
      where.push('(COALESCE(l.status_code, 200) >= 400 OR COALESCE(l.result_code, \'\') LIKE \'%ERROR%\' OR COALESCE(l.result_code, \'\') IN (\'UNAUTHORIZED\', \'RATE_LIMITED\', \'WORKFLOW_MAINTENANCE\'))');
    } else if (status === 'success') {
      where.push('COALESCE(l.status_code, 200) < 400');
    }
    const userId = Number(filters.user_id || filters.userId || 0);
    if (userId) {
      where.push('l.user_id = ?');
      params.push(userId);
    }
    const from = String(filters.from || '').trim();
    if (from) {
      where.push('datetime(l.created_at) >= datetime(?)');
      params.push(from);
    }
    const to = String(filters.to || '').trim();
    if (to) {
      where.push('datetime(l.created_at) <= datetime(?)');
      params.push(to);
    }
    const limit = Math.max(1, Math.min(250, normalizeInteger(filters.limit, 50)));
    params.push(limit);
    return database.prepare(`
      SELECT l.*, u.email AS user_email, u.name AS user_name
      FROM automation_intent_logs l
      LEFT JOIN users u ON u.id = l.user_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY datetime(l.created_at) DESC, l.id DESC
      LIMIT ?
    `).all(...params).map((row) => ({
      ...row,
      request_meta: safeJsonParse(row.request_meta_json, {}),
      response_meta: safeJsonParse(row.response_meta_json, {})
    }));
  }

  function listErrorEvents(limit = 20) {
    if (!tableExists('automation_error_events')) return [];
    return database.prepare(`
      SELECT e.*, u.email AS user_email, u.name AS user_name
      FROM automation_error_events e
      LEFT JOIN users u ON u.id = e.user_id
      ORDER BY datetime(e.created_at) DESC, e.id DESC
      LIMIT ?
    `).all(Math.max(1, Math.min(100, normalizeInteger(limit, 20))));
  }

  function getDashboardStats() {
    seedWorkflowRegistry();
    const stats = {
      workflowsTotal: 0,
      workflowsEnabled: 0,
      workflowsMaintenance: 0,
      authorizedPhones: 0,
      disabledPhones: 0,
      openConversations: 0,
      requests24h: 0,
      errors24h: 0,
      mutations24h: 0
    };

    try {
      const workflowRows = listWorkflows();
      stats.workflowsTotal = workflowRows.length;
      stats.workflowsEnabled = workflowRows.filter((row) => Number(row.enabled || 0) !== 0).length;
      stats.workflowsMaintenance = workflowRows.filter((row) => Number(row.maintenance_mode || 0) !== 0).length;
    } catch (_) {}

    try {
      const auth = database.prepare(`
        SELECT
          SUM(CASE WHEN COALESCE(enabled, 0) = 1 THEN 1 ELSE 0 END) AS enabled_count,
          SUM(CASE WHEN COALESCE(enabled, 0) = 0 THEN 1 ELSE 0 END) AS disabled_count
        FROM automation_whatsapp_authorizations
      `).get();
      stats.authorizedPhones = Number(auth?.enabled_count || 0);
      stats.disabledPhones = Number(auth?.disabled_count || 0);
    } catch (_) {}

    try {
      const conv = database.prepare(`
        SELECT COUNT(*) AS count
        FROM automation_conversation_states
        WHERE resolved_at IS NULL AND datetime(expires_at) > datetime('now')
      `).get();
      stats.openConversations = Number(conv?.count || 0);
    } catch (_) {}

    try {
      const req = tableExists('automation_intent_logs')
        ? database.prepare("SELECT COUNT(*) AS count FROM automation_intent_logs WHERE datetime(created_at) >= datetime('now', '-1 day')").get()
        : database.prepare("SELECT COUNT(*) AS count FROM automation_request_logs WHERE datetime(created_at) >= datetime('now', '-1 day')").get();
      stats.requests24h = Number(req?.count || 0);
    } catch (_) {}

    try {
      const err = tableExists('automation_error_events')
        ? database.prepare("SELECT COUNT(*) AS count FROM automation_error_events WHERE datetime(created_at) >= datetime('now', '-1 day')").get()
        : { count: 0 };
      stats.errors24h = Number(err?.count || 0);
    } catch (_) {}

    try {
      const mut = database.prepare("SELECT COUNT(*) AS count FROM automation_mutation_events WHERE datetime(created_at) >= datetime('now', '-1 day')").get();
      stats.mutations24h = Number(mut?.count || 0);
    } catch (_) {}

    return stats;
  }

  function getPendingConversations(limit = 20) {
    if (!tableExists('automation_conversation_states')) return [];
    return database.prepare(`
      SELECT c.*, u.email AS user_email, u.name AS user_name
      FROM automation_conversation_states c
      LEFT JOIN users u ON u.id = c.user_id
      WHERE c.resolved_at IS NULL AND datetime(c.expires_at) > datetime('now')
      ORDER BY datetime(c.updated_at) DESC, c.id DESC
      LIMIT ?
    `).all(Math.max(1, Math.min(100, normalizeInteger(limit, 20))));
  }

  function pruneAutomationLogs(options = {}) {
    const requestDays = Math.max(1, normalizeInteger(options.requestDays, 90));
    const errorDays = Math.max(1, normalizeInteger(options.errorDays, 180));
    const intentDays = Math.max(1, normalizeInteger(options.intentDays, requestDays));
    const result = { requestLogs: 0, intentLogs: 0, errorEvents: 0 };
    const requestCutoff = new Date(Date.now() - requestDays * 86400000).toISOString();
    const intentCutoff = new Date(Date.now() - intentDays * 86400000).toISOString();
    const errorCutoff = new Date(Date.now() - errorDays * 86400000).toISOString();

    if (tableExists('automation_request_logs')) {
      result.requestLogs = database.prepare('DELETE FROM automation_request_logs WHERE datetime(created_at) < datetime(?)').run(requestCutoff).changes || 0;
    }
    if (tableExists('automation_intent_logs')) {
      result.intentLogs = database.prepare('DELETE FROM automation_intent_logs WHERE datetime(created_at) < datetime(?)').run(intentCutoff).changes || 0;
    }
    if (tableExists('automation_error_events')) {
      result.errorEvents = database.prepare('DELETE FROM automation_error_events WHERE datetime(created_at) < datetime(?)').run(errorCutoff).changes || 0;
    }
    return result;
  }

  function setAppSetting(key, value, userId = null) {
    const now = nowIso();
    database.prepare(`
      INSERT INTO app_settings (key, value, updated_at, updated_by_user_id)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at,
        updated_by_user_id = excluded.updated_by_user_id
    `).run(String(key || '').trim(), String(value ?? ''), now, Number(userId || 0) || null);
  }

  function getAppSetting(key, fallback = '') {
    try {
      const row = database.prepare('SELECT value FROM app_settings WHERE key = ? LIMIT 1').get(String(key || '').trim());
      if (row && row.value !== null && row.value !== undefined) return row.value;
    } catch (_) {}
    return fallback;
  }

  function generateAutomationToken() {
    return crypto.randomBytes(42).toString('base64url');
  }

  return {
    WORKFLOW_DEFINITIONS,
    automationTablesReady,
    seedWorkflowRegistry,
    listWorkflows,
    getWorkflowByKey,
    updateWorkflow,
    inferWorkflowFromPath,
    extractPhoneFromPayload,
    getUserPreference,
    isUserWorkflowEnabled,
    updateUserPreferences,
    listUserPreferences,
    getUsersWithPreferences,
    logIntentEvent,
    logErrorEvent,
    findAutomationUserByPhone,
    listIntentLogs,
    listErrorEvents,
    getDashboardStats,
    getPendingConversations,
    pruneAutomationLogs,
    setAppSetting,
    getAppSetting,
    generateAutomationToken,
    tableExists
  };
}

module.exports = {
  createAutomationOperationsRepository,
  WORKFLOW_DEFINITIONS
};
