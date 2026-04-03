const MESSAGE_CATALOG = [
  {
    catalogId: 'NTF-001',
    messageKey: 'notification.shared_debt.batch.new',
    channel: 'Central de avisos do app + Push',
    previewRenderer: 'notification',
    category: 'Cobranças compartilhadas',
    flow: 'Lote de cobranças compartilhadas',
    purpose: 'Novo lote enviado para o destinatário',
    defaultTitle: 'Chegou um novo envio compartilhado',
    defaultBody: '{remetente} enviou {n_cobrancas} para você, somando {valor_total}.[ Nessa leva entraram: {previsao_descricoes}.]',
    variables: [
      { name: 'remetente', required: true, fields: ['body'] },
      { name: 'n_cobrancas', required: true, fields: ['body'] },
      { name: 'valor_total', required: true, fields: ['body'] },
      { name: 'previsao_descricoes', required: false, fields: ['body'] }
    ]
  },
  {
    catalogId: 'NTF-002',
    messageKey: 'notification.shared_debt.batch.updated',
    channel: 'Central de avisos do app + Push',
    previewRenderer: 'notification',
    category: 'Cobranças compartilhadas',
    flow: 'Lote de cobranças compartilhadas',
    purpose: 'Lote atualizado',
    defaultTitle: 'Um envio compartilhado foi atualizado',
    defaultBody: '{remetente} atualizou {n_cobrancas} para você, somando {valor_total}.[ Nessa leva entraram: {previsao_descricoes}.]',
    variables: [
      { name: 'remetente', required: true, fields: ['body'] },
      { name: 'n_cobrancas', required: true, fields: ['body'] },
      { name: 'valor_total', required: true, fields: ['body'] },
      { name: 'previsao_descricoes', required: false, fields: ['body'] }
    ]
  },
  {
    catalogId: 'NTF-003',
    messageKey: 'notification.shared_debt.batch.adjusted',
    channel: 'Central de avisos do app + Push',
    previewRenderer: 'notification',
    category: 'Cobranças compartilhadas',
    flow: 'Lote de cobranças compartilhadas',
    purpose: 'Lote só com cancelamentos ou ajustes',
    defaultTitle: 'Uma cobrança compartilhada mudou por aqui',
    defaultBody: '{remetente} ajustou {n_cobrancas} para você, somando {valor_total}.[ Teve mexida em: {previsao_descricoes}.]',
    variables: [
      { name: 'remetente', required: true, fields: ['body'] },
      { name: 'n_cobrancas', required: true, fields: ['body'] },
      { name: 'valor_total', required: true, fields: ['body'] },
      { name: 'previsao_descricoes', required: false, fields: ['body'] }
    ]
  },
  {
    catalogId: 'NTF-004',
    messageKey: 'notification.shared_debt.batch.mixed',
    channel: 'Central de avisos do app + Push',
    previewRenderer: 'notification',
    category: 'Cobranças compartilhadas',
    flow: 'Lote de cobranças compartilhadas',
    purpose: 'Lote misto com criação e ajuste',
    defaultTitle: 'Tem novidade em um envio compartilhado',
    defaultBody: '{remetente} ajustou {n_cobrancas} para você, somando {valor_total}.[ Teve mexida em: {previsao_descricoes}.]',
    variables: [
      { name: 'remetente', required: true, fields: ['body'] },
      { name: 'n_cobrancas', required: true, fields: ['body'] },
      { name: 'valor_total', required: true, fields: ['body'] },
      { name: 'previsao_descricoes', required: false, fields: ['body'] }
    ]
  },
  {
    catalogId: 'NTF-005',
    messageKey: 'notification.manual_debt_due.pay.single',
    channel: 'Central de avisos do app + Push',
    previewRenderer: 'notification',
    category: 'Cobranças / datas combinadas',
    flow: 'Cobrança manual com data combinada',
    purpose: 'Lembrete do dia para pagar com um item',
    defaultTitle: 'Hoje é o dia combinado para pagar',
    defaultBody: 'Tem {valor} combinado com {contraparte} em {descricao}.',
    variables: [
      { name: 'valor', required: true, fields: ['body'] },
      { name: 'contraparte', required: true, fields: ['body'] },
      { name: 'descricao', required: true, fields: ['body'] }
    ]
  },
  {
    catalogId: 'NTF-006',
    messageKey: 'notification.manual_debt_due.receive.single',
    channel: 'Central de avisos do app + Push',
    previewRenderer: 'notification',
    category: 'Cobranças / datas combinadas',
    flow: 'Cobrança manual com data combinada',
    purpose: 'Lembrete do dia para receber com um item',
    defaultTitle: 'Hoje é o dia combinado para receber',
    defaultBody: 'Tem {valor} combinado com {contraparte} em {descricao} batendo hoje.',
    variables: [
      { name: 'valor', required: true, fields: ['body'] },
      { name: 'contraparte', required: true, fields: ['body'] },
      { name: 'descricao', required: true, fields: ['body'] }
    ]
  },
  {
    catalogId: 'NTF-007',
    messageKey: 'notification.manual_debt_due.pay.multi',
    channel: 'Central de avisos do app + Push',
    previewRenderer: 'notification',
    category: 'Cobranças / datas combinadas',
    flow: 'Cobrança manual com data combinada',
    purpose: 'Lembrete do dia para pagar com vários itens',
    defaultTitle: 'Hoje tem combinados para pagar',
    defaultBody: 'São {n_combinados} batendo hoje, somando {valor_total}[ com {previsao_contrapartes}].',
    variables: [
      { name: 'n_combinados', required: true, fields: ['body'] },
      { name: 'valor_total', required: true, fields: ['body'] },
      { name: 'previsao_contrapartes', required: false, fields: ['body'] }
    ]
  },
  {
    catalogId: 'NTF-008',
    messageKey: 'notification.manual_debt_due.receive.multi',
    channel: 'Central de avisos do app + Push',
    previewRenderer: 'notification',
    category: 'Cobranças / datas combinadas',
    flow: 'Cobrança manual com data combinada',
    purpose: 'Lembrete do dia para receber com vários itens',
    defaultTitle: 'Hoje tem combinados para receber',
    defaultBody: 'São {n_combinados} batendo hoje, somando {valor_total}[ com {previsao_contrapartes}].',
    variables: [
      { name: 'n_combinados', required: true, fields: ['body'] },
      { name: 'valor_total', required: true, fields: ['body'] },
      { name: 'previsao_contrapartes', required: false, fields: ['body'] }
    ]
  },
  {
    catalogId: 'NTF-009',
    messageKey: 'notification.monthly_finance.income.single',
    channel: 'Central de avisos do app + Push',
    previewRenderer: 'notification',
    category: 'Finanças mensais',
    flow: 'Agenda financeira do mês',
    purpose: 'Entrada prevista para hoje com um item',
    defaultTitle: 'Hoje entra {descricao}',
    defaultBody: '{descricao} esta no radar de hoje com {valor}.',
    variables: [
      { name: 'descricao', required: true, fields: ['title', 'body'] },
      { name: 'valor', required: true, fields: ['body'] }
    ]
  },
  {
    catalogId: 'NTF-010',
    messageKey: 'notification.monthly_finance.expense.single.pay',
    channel: 'Central de avisos do app + Push',
    previewRenderer: 'notification',
    category: 'Finanças mensais',
    flow: 'Agenda financeira do mês',
    purpose: 'Saída marcada para hoje com um item',
    defaultTitle: 'Hoje sai {descricao}',
    defaultBody: '{descricao} esta marcado para hoje com {valor}.',
    variables: [
      { name: 'descricao', required: true, fields: ['title', 'body'] },
      { name: 'valor', required: true, fields: ['body'] }
    ]
  },
  {
    catalogId: 'NTF-011',
    messageKey: 'notification.monthly_finance.expense.single.due',
    channel: 'Central de avisos do app + Push',
    previewRenderer: 'notification',
    category: 'Finanças mensais',
    flow: 'Agenda financeira do mês',
    purpose: 'Saída vencendo hoje com um item',
    defaultTitle: 'Hoje vence {descricao}',
    defaultBody: '{descricao} bate hoje com {valor} no radar.',
    variables: [
      { name: 'descricao', required: true, fields: ['title', 'body'] },
      { name: 'valor', required: true, fields: ['body'] }
    ]
  },
  {
    catalogId: 'NTF-012',
    messageKey: 'notification.monthly_finance.income.multi',
    channel: 'Central de avisos do app + Push',
    previewRenderer: 'notification',
    category: 'Finanças mensais',
    flow: 'Agenda financeira do mês',
    purpose: 'Entradas previstas para hoje com vários itens',
    defaultTitle: 'Hoje tem entradas do mês',
    defaultBody: '{n_entradas} somam {valor_total}[ por conta de {previsao_descricoes}].',
    variables: [
      { name: 'n_entradas', required: true, fields: ['body'] },
      { name: 'valor_total', required: true, fields: ['body'] },
      { name: 'previsao_descricoes', required: false, fields: ['body'] }
    ]
  },
  {
    catalogId: 'NTF-013',
    messageKey: 'notification.monthly_finance.expense.multi',
    channel: 'Central de avisos do app + Push',
    previewRenderer: 'notification',
    category: 'Finanças mensais',
    flow: 'Agenda financeira do mês',
    purpose: 'Saídas previstas para hoje com vários itens',
    defaultTitle: 'Hoje tem saídas do mês',
    defaultBody: '{n_saidas} somam {valor_total}[ por conta de {previsao_descricoes}].',
    variables: [
      { name: 'n_saidas', required: true, fields: ['body'] },
      { name: 'valor_total', required: true, fields: ['body'] },
      { name: 'previsao_descricoes', required: false, fields: ['body'] }
    ]
  },
  {
    catalogId: 'GER-009',
    messageKey: 'dashboard.manual_debt_due.pay',
    channel: 'Card de alerta na visão geral',
    previewRenderer: 'dashboard_alert',
    category: 'Aba Geral / alertas',
    flow: 'Datas combinadas',
    purpose: 'Combinados para pagar hoje',
    defaultTitle: 'Tem combinado batendo hoje para pagar',
    defaultBody: '{body_reaproveitado}',
    variables: [
      { name: 'body_reaproveitado', required: true, fields: ['body'] }
    ]
  },
  {
    catalogId: 'GER-010',
    messageKey: 'dashboard.manual_debt_due.receive',
    channel: 'Card de alerta na visão geral',
    previewRenderer: 'dashboard_alert',
    category: 'Aba Geral / alertas',
    flow: 'Datas combinadas',
    purpose: 'Combinados para receber hoje',
    defaultTitle: 'Tem combinado batendo hoje para receber',
    defaultBody: '{body_reaproveitado}',
    variables: [
      { name: 'body_reaproveitado', required: true, fields: ['body'] }
    ]
  },
  {
    catalogId: 'PUSH-001A',
    messageKey: 'push.card_due_today.single.first.partial',
    channel: 'Push automático (somente push)',
    previewRenderer: 'push',
    category: 'Cartões',
    flow: 'Vencimento de fatura no dia',
    purpose: 'Lembrete inicial de fatura única vencendo hoje com pagamento parcial',
    defaultTitle: 'Hoje vence sua fatura',
    defaultBody: '{cartao} vence hoje. Ainda faltam {valor_restante} para fechar essa conta.',
    variables: [
      { name: 'cartao', required: true, fields: ['body'] },
      { name: 'valor_restante', required: true, fields: ['body'] }
    ]
  },
  {
    catalogId: 'PUSH-001B',
    messageKey: 'push.card_due_today.single.first.expected',
    channel: 'Push automático (somente push)',
    previewRenderer: 'push',
    category: 'Cartões',
    flow: 'Vencimento de fatura no dia',
    purpose: 'Lembrete inicial de fatura única vencendo hoje sem pagamento informado',
    defaultTitle: 'Hoje vence sua fatura',
    defaultBody: '{cartao} vence hoje. O valor previsto é {valor_total}.',
    variables: [
      { name: 'cartao', required: true, fields: ['body'] },
      { name: 'valor_total', required: true, fields: ['body'] }
    ]
  },
  {
    catalogId: 'PUSH-001C',
    messageKey: 'push.card_due_today.single.repeat.partial',
    channel: 'Push automático (somente push)',
    previewRenderer: 'push',
    category: 'Cartões',
    flow: 'Vencimento de fatura no dia',
    purpose: 'Lembrete repetido de fatura única vencendo hoje com pagamento parcial',
    defaultTitle: 'Lembrete: sua fatura vence hoje',
    defaultBody: '{cartao} vence hoje. Ainda faltam {valor_restante} para fechar essa conta.',
    variables: [
      { name: 'cartao', required: true, fields: ['body'] },
      { name: 'valor_restante', required: true, fields: ['body'] }
    ]
  },
  {
    catalogId: 'PUSH-001D',
    messageKey: 'push.card_due_today.single.repeat.expected',
    channel: 'Push automático (somente push)',
    previewRenderer: 'push',
    category: 'Cartões',
    flow: 'Vencimento de fatura no dia',
    purpose: 'Lembrete repetido de fatura única vencendo hoje sem pagamento informado',
    defaultTitle: 'Lembrete: sua fatura vence hoje',
    defaultBody: '{cartao} vence hoje. O valor previsto é {valor_total}.',
    variables: [
      { name: 'cartao', required: true, fields: ['body'] },
      { name: 'valor_total', required: true, fields: ['body'] }
    ]
  },
  {
    catalogId: 'PUSH-002A',
    messageKey: 'push.card_due_today.multi.first',
    channel: 'Push automático (somente push)',
    previewRenderer: 'push',
    category: 'Cartões',
    flow: 'Vencimento de faturas no dia',
    purpose: 'Lembrete inicial de múltiplas faturas vencendo hoje',
    defaultTitle: 'Hoje tem fatura vencendo',
    defaultBody: '{n_faturas} vencem hoje. Entre elas: {previsao_cartoes}. Ainda faltam {valor_total_pendente} para quitar tudo no resumo.',
    variables: [
      { name: 'n_faturas', required: true, fields: ['body'] },
      { name: 'previsao_cartoes', required: true, fields: ['body'] },
      { name: 'valor_total_pendente', required: true, fields: ['body'] }
    ]
  },
  {
    catalogId: 'PUSH-002B',
    messageKey: 'push.card_due_today.multi.repeat',
    channel: 'Push automático (somente push)',
    previewRenderer: 'push',
    category: 'Cartões',
    flow: 'Vencimento de faturas no dia',
    purpose: 'Lembrete repetido de múltiplas faturas vencendo hoje',
    defaultTitle: 'Lembrete: tem fatura vencendo hoje',
    defaultBody: '{n_faturas} vencem hoje. Entre elas: {previsao_cartoes}. Ainda faltam {valor_total_pendente} para quitar tudo no resumo.',
    variables: [
      { name: 'n_faturas', required: true, fields: ['body'] },
      { name: 'previsao_cartoes', required: true, fields: ['body'] },
      { name: 'valor_total_pendente', required: true, fields: ['body'] }
    ]
  }
];

const MESSAGE_CATALOG_BY_KEY = new Map(MESSAGE_CATALOG.map((entry) => [entry.messageKey, entry]));
const MESSAGE_CATALOG_BY_ID = new Map(MESSAGE_CATALOG.map((entry) => [entry.catalogId, entry]));

function nowIso() {
  return new Date().toISOString();
}

function normalizeVariableSpec(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const name = String(item?.name || '').trim();
      if (!name) return null;
      const fields = Array.isArray(item?.fields)
        ? item.fields.map((field) => String(field || '').trim()).filter(Boolean)
        : [];
      return {
        name,
        required: Number(item?.required || 0) !== 0 || item?.required === true,
        fields: fields.length ? Array.from(new Set(fields)) : ['title', 'body']
      };
    })
    .filter(Boolean);
}

function getMessageCatalog() {
  return MESSAGE_CATALOG.slice();
}

function getMessageCatalogByKey(messageKey) {
  const safeKey = String(messageKey || '').trim();
  return safeKey ? (MESSAGE_CATALOG_BY_KEY.get(safeKey) || null) : null;
}

function getMessageCatalogById(catalogId) {
  const safeId = String(catalogId || '').trim();
  return safeId ? (MESSAGE_CATALOG_BY_ID.get(safeId) || null) : null;
}

function ensureMessageTemplateTables(db) {
  if (!db) return;

  db.exec(`
    CREATE TABLE IF NOT EXISTS message_templates (
      message_key TEXT PRIMARY KEY,
      catalog_id TEXT NOT NULL UNIQUE,
      channel TEXT NOT NULL,
      category TEXT NOT NULL,
      flow TEXT NOT NULL,
      purpose TEXT NOT NULL,
      preview_renderer TEXT NOT NULL DEFAULT 'notification',
      variables_json TEXT,
      default_title TEXT,
      default_body TEXT,
      custom_title TEXT,
      custom_body TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL,
      updated_by_user_id INTEGER,
      FOREIGN KEY (updated_by_user_id) REFERENCES users(id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS message_template_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_key TEXT NOT NULL,
      catalog_id TEXT NOT NULL,
      previous_custom_title TEXT,
      next_custom_title TEXT,
      previous_custom_body TEXT,
      next_custom_body TEXT,
      changed_at TEXT NOT NULL,
      changed_by_user_id INTEGER,
      source TEXT NOT NULL DEFAULT 'system',
      FOREIGN KEY (changed_by_user_id) REFERENCES users(id)
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_message_templates_category ON message_templates(category, channel, catalog_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_message_templates_updated_at ON message_templates(updated_at DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_message_template_history_message_key ON message_template_history(message_key, changed_at DESC)`);
}

function syncMessageCatalogWithDatabase(db) {
  if (!db) return { inserted: 0, updated: 0 };
  ensureMessageTemplateTables(db);

  const selectExisting = db.prepare(`
    SELECT message_key, catalog_id, custom_title, custom_body, is_active, updated_at, updated_by_user_id
    FROM message_templates
    WHERE message_key = ?
    LIMIT 1
  `);

  const insertRow = db.prepare(`
    INSERT INTO message_templates (
      message_key,
      catalog_id,
      channel,
      category,
      flow,
      purpose,
      preview_renderer,
      variables_json,
      default_title,
      default_body,
      custom_title,
      custom_body,
      is_active,
      updated_at,
      updated_by_user_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const updateRow = db.prepare(`
    UPDATE message_templates
       SET catalog_id = ?,
           channel = ?,
           category = ?,
           flow = ?,
           purpose = ?,
           preview_renderer = ?,
           variables_json = ?,
           default_title = ?,
           default_body = ?
     WHERE message_key = ?
  `);

  let inserted = 0;
  let updated = 0;
  const stamp = nowIso();

  const runSync = db.transaction(() => {
    MESSAGE_CATALOG.forEach((entry) => {
      const variablesJson = JSON.stringify(normalizeVariableSpec(entry.variables));
      const existing = selectExisting.get(entry.messageKey);
      if (!existing) {
        insertRow.run(
          entry.messageKey,
          entry.catalogId,
          entry.channel,
          entry.category,
          entry.flow,
          entry.purpose,
          entry.previewRenderer || 'notification',
          variablesJson,
          entry.defaultTitle || '',
          entry.defaultBody || '',
          null,
          null,
          1,
          stamp,
          null
        );
        inserted += 1;
        return;
      }

      updateRow.run(
        entry.catalogId,
        entry.channel,
        entry.category,
        entry.flow,
        entry.purpose,
        entry.previewRenderer || 'notification',
        variablesJson,
        entry.defaultTitle || '',
        entry.defaultBody || '',
        entry.messageKey
      );
      updated += 1;
    });
  });

  runSync();
  return { inserted, updated };
}

module.exports = {
  MESSAGE_CATALOG,
  getMessageCatalog,
  getMessageCatalogByKey,
  getMessageCatalogById,
  ensureMessageTemplateTables,
  syncMessageCatalogWithDatabase,
  normalizeVariableSpec
};
