const MESSAGE_PREVIEW_FIXTURES = {
  'notification.shared_debt.batch.new': {
    remetente: 'Mari',
    n_cobrancas: '3 cobranças',
    valor_total: 'R$ 184,90',
    previsao_descricoes: 'mercado e gasolina'
  },
  'notification.shared_debt.batch.updated': {
    remetente: 'Mari',
    n_cobrancas: '2 cobranças',
    valor_total: 'R$ 122,40',
    previsao_descricoes: 'almoço e farmácia'
  },
  'notification.shared_debt.batch.adjusted': {
    remetente: 'Mari',
    n_cobrancas: '2 cobranças',
    valor_total: 'R$ 96,30',
    previsao_descricoes: 'padaria e gasolina'
  },
  'notification.shared_debt.batch.mixed': {
    remetente: 'Mari',
    n_cobrancas: '4 cobranças',
    valor_total: 'R$ 241,80',
    previsao_descricoes: 'mercado, farmácia e mais 1'
  },
  'notification.manual_debt_due.pay.single': {
    valor: 'R$ 72,00',
    contraparte: 'Bia',
    descricao: 'pizza do sábado'
  },
  'notification.manual_debt_due.receive.single': {
    valor: 'R$ 55,00',
    contraparte: 'Leo',
    descricao: 'uber de ontem'
  },
  'notification.manual_debt_due.pay.multi': {
    n_combinados: '3 combinados',
    valor_total: 'R$ 148,50',
    previsao_contrapartes: 'Bia e Leo'
  },
  'notification.manual_debt_due.receive.multi': {
    n_combinados: '2 combinados',
    valor_total: 'R$ 91,20',
    previsao_contrapartes: 'Mari e Gui'
  },
  'notification.monthly_finance.income.single': {
    descricao: 'freela da semana',
    valor: 'R$ 280,00'
  },
  'notification.monthly_finance.expense.single.pay': {
    descricao: 'internet de casa',
    valor: 'R$ 119,90'
  },
  'notification.monthly_finance.expense.single.due': {
    descricao: 'academia',
    valor: 'R$ 89,90'
  },
  'notification.monthly_finance.income.multi': {
    n_entradas: '2 entradas',
    valor_total: 'R$ 850,00',
    previsao_descricoes: 'freela e reembolso'
  },
  'notification.monthly_finance.expense.multi': {
    n_saidas: '3 saidas',
    valor_total: 'R$ 420,70',
    previsao_descricoes: 'internet, academia e mercado'
  },
  'dashboard.manual_debt_due.pay': {
    body_reaproveitado: 'Sao 3 combinados batendo hoje, somando R$ 148,50 com Bia e Leo.'
  },
  'dashboard.manual_debt_due.receive': {
    body_reaproveitado: 'Sao 2 combinados batendo hoje, somando R$ 91,20 com Mari e Gui.'
  },
  'push.card_due_today.single.first.partial': {
    cartao: 'Nubank',
    valor_restante: 'R$ 320,45'
  },
  'push.card_due_today.single.first.expected': {
    cartao: 'Nubank',
    valor_total: 'R$ 780,45'
  },
  'push.card_due_today.single.repeat.partial': {
    cartao: 'Nubank',
    valor_restante: 'R$ 320,45'
  },
  'push.card_due_today.single.repeat.expected': {
    cartao: 'Nubank',
    valor_total: 'R$ 780,45'
  },
  'push.card_due_today.multi.first': {
    n_faturas: '3 faturas',
    previsao_cartoes: 'Nubank, Inter e mais 1',
    valor_total_pendente: 'R$ 1.420,15'
  },
  'push.card_due_today.multi.repeat': {
    n_faturas: '3 faturas',
    previsao_cartoes: 'Nubank, Inter e mais 1',
    valor_total_pendente: 'R$ 1.420,15'
  }
};

function getMessagePreviewFixture(messageKey) {
  const safeKey = String(messageKey || '').trim();
  return safeKey && MESSAGE_PREVIEW_FIXTURES[safeKey]
    ? { ...MESSAGE_PREVIEW_FIXTURES[safeKey] }
    : {};
}

module.exports = {
  MESSAGE_PREVIEW_FIXTURES,
  getMessagePreviewFixture
};
