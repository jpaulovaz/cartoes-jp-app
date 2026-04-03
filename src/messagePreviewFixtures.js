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
  },
  'share.summary.settled.native': {
    periodo: '04/2026',
    pessoa: 'Mari',
    valor_total: 'R$ 240,00',
    valor_pago: 'R$ 240,00'
  },
  'share.summary.partial.native.no_pix': {
    periodo: '04/2026',
    pessoa: 'Mari',
    valor_pago: 'R$ 120,00',
    valor_restante: 'R$ 120,00'
  },
  'share.summary.partial.native.with_pix': {
    periodo: '04/2026',
    pessoa: 'Mari',
    valor_pago: 'R$ 120,00',
    valor_restante: 'R$ 120,00',
    pix_payload: '00020126580014BR.GOV.BCB.PIX0136teste.organizapay@pix.com5204000053039865405120.005802BR5925ORGANIZAPAY TESTE6009SAO PAULO62070503***6304ABCD'
  },
  'share.summary.open.native.no_pix': {
    periodo: '04/2026',
    pessoa: 'Mari',
    valor_restante: 'R$ 240,00'
  },
  'share.summary.open.native.with_pix': {
    periodo: '04/2026',
    pessoa: 'Mari',
    valor_restante: 'R$ 240,00',
    pix_payload: '00020126580014BR.GOV.BCB.PIX0136teste.organizapay@pix.com5204000053039865405240.005802BR5925ORGANIZAPAY TESTE6009SAO PAULO62070503***6304EFGH'
  },
  'whatsapp.summary.settled.caption': {
    periodo: '04/2026',
    pessoa: 'Mari'
  },
  'whatsapp.summary.partial.caption': {
    periodo: '04/2026',
    pessoa: 'Mari',
    valor_pago: 'R$ 120,00',
    valor_restante: 'R$ 120,00'
  },
  'whatsapp.summary.partial.followup': {
    valor_restante: 'R$ 120,00',
    pix_payload: '00020126580014BR.GOV.BCB.PIX0136teste.organizapay@pix.com5204000053039865405120.005802BR5925ORGANIZAPAY TESTE6009SAO PAULO62070503***6304ABCD'
  },
  'whatsapp.summary.open.caption': {
    periodo: '04/2026',
    pessoa: 'Mari',
    valor_restante: 'R$ 240,00'
  },
  'whatsapp.summary.open.followup': {
    valor_restante: 'R$ 240,00',
    pix_payload: '00020126580014BR.GOV.BCB.PIX0136teste.organizapay@pix.com5204000053039865405240.005802BR5925ORGANIZAPAY TESTE6009SAO PAULO62070503***6304EFGH'
  },
  'whatsapp.summary.auto.second.pix_only': {
    pix_payload: '00020126580014BR.GOV.BCB.PIX0136teste.organizapay@pix.com5204000053039865405240.005802BR5925ORGANIZAPAY TESTE6009SAO PAULO62070503***6304EFGH'
  },
  'whatsapp.summary.auto.second.fallback': {
    valor_restante: 'R$ 240,00',
    pix_payload: '00020126580014BR.GOV.BCB.PIX0136teste.organizapay@pix.com5204000053039865405240.005802BR5925ORGANIZAPAY TESTE6009SAO PAULO62070503***6304EFGH'
  },
  'whatsapp.summary.pix_payload_only': {
    pix_payload: '00020126580014BR.GOV.BCB.PIX0136teste.organizapay@pix.com5204000053039865405240.005802BR5925ORGANIZAPAY TESTE6009SAO PAULO62070503***6304EFGH'
  },
  'pix.manual_request.share': {
    credor: 'Mari',
    valor: 'R$ 72,00',
    descricao: 'pizza do sábado',
    pix_payload: '00020126580014BR.GOV.BCB.PIX0136teste.organizapay@pix.com520400005303986540572.005802BR5925ORGANIZAPAY TESTE6009SAO PAULO62070503***6304IJKL'
  },
  'pix.monthly_settlement.share': {
    credor: 'Mari',
    valor: 'R$ 240,00',
    periodo: '04/2026',
    pix_payload: '00020126580014BR.GOV.BCB.PIX0136teste.organizapay@pix.com5204000053039865405240.005802BR5925ORGANIZAPAY TESTE6009SAO PAULO62070503***6304MNOP'
  },
  'email.admin_access.welcome': {
    app: 'AcerttaPay',
    nome: 'Mari',
    admin_ou_sistema: 'Caio',
    perfil: 'Usuário do app',
    link_login: 'https://app.organizapay.com.br/login',
    recado_admin: 'Qualquer dúvida, me chama por aqui que eu te ajudo.'
  },
  'email.admin_access.test': {
    app: 'AcerttaPay',
    nome: 'Mari',
    admin_ou_time: 'Caio',
    link_login: 'https://app.organizapay.com.br/login'
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
