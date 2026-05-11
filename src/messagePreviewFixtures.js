const BASE_MESSAGE_PREVIEW_FIXTURES = {
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
    pix_payload: '00020126580014BR.GOV.BCB.PIX0136teste.acerttapay@pix.com5204000053039865405120.005802BR5925ACERTTAPAY TESTE6009SAO PAULO62070503***6304ABCD'
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
    pix_payload: '00020126580014BR.GOV.BCB.PIX0136teste.acerttapay@pix.com5204000053039865405240.005802BR5925ACERTTAPAY TESTE6009SAO PAULO62070503***6304EFGH'
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
    pix_payload: '00020126580014BR.GOV.BCB.PIX0136teste.acerttapay@pix.com5204000053039865405120.005802BR5925ACERTTAPAY TESTE6009SAO PAULO62070503***6304ABCD'
  },
  'whatsapp.summary.open.caption': {
    periodo: '04/2026',
    pessoa: 'Mari',
    valor_restante: 'R$ 240,00'
  },
  'whatsapp.summary.open.followup': {
    valor_restante: 'R$ 240,00',
    pix_payload: '00020126580014BR.GOV.BCB.PIX0136teste.acerttapay@pix.com5204000053039865405240.005802BR5925ACERTTAPAY TESTE6009SAO PAULO62070503***6304EFGH'
  },
  'whatsapp.summary.auto.second.pix_only': {
    pix_payload: '00020126580014BR.GOV.BCB.PIX0136teste.acerttapay@pix.com5204000053039865405240.005802BR5925ACERTTAPAY TESTE6009SAO PAULO62070503***6304EFGH'
  },
  'whatsapp.summary.auto.second.fallback': {
    valor_restante: 'R$ 240,00',
    pix_payload: '00020126580014BR.GOV.BCB.PIX0136teste.acerttapay@pix.com5204000053039865405240.005802BR5925ACERTTAPAY TESTE6009SAO PAULO62070503***6304EFGH'
  },
  'whatsapp.summary.pix_payload_only': {
    pix_payload: '00020126580014BR.GOV.BCB.PIX0136teste.acerttapay@pix.com5204000053039865405240.005802BR5925ACERTTAPAY TESTE6009SAO PAULO62070503***6304EFGH'
  },
  'pix.manual_request.share': {
    credor: 'Mari',
    valor: 'R$ 72,00',
    descricao: 'pizza do sábado',
    pix_payload: '00020126580014BR.GOV.BCB.PIX0136teste.acerttapay@pix.com520400005303986540572.005802BR5925ACERTTAPAY TESTE6009SAO PAULO62070503***6304IJKL'
  },
  'pix.monthly_settlement.share': {
    credor: 'Mari',
    valor: 'R$ 240,00',
    periodo: '04/2026',
    pix_payload: '00020126580014BR.GOV.BCB.PIX0136teste.acerttapay@pix.com5204000053039865405240.005802BR5925ACERTTAPAY TESTE6009SAO PAULO62070503***6304MNOP'
  },
  'email.admin_access.welcome': {
    app: 'AcerttaPay',
    nome: 'Mari',
    admin_ou_sistema: 'Caio',
    perfil: 'Usuário do app',
    link_login: 'https://app.acerttapay.com.br/login',
    recado_admin: 'Qualquer dúvida, me chama por aqui que eu te ajudo.'
  },
  'email.admin_access.test': {
    app: 'AcerttaPay',
    nome: 'Mari',
    admin_ou_time: 'Caio',
    link_login: 'https://app.acerttapay.com.br/login'
  }
};


const ADDITIONAL_MESSAGE_PREVIEW_FIXTURES = {
  "notification.shared_debt.single.updated": {
    remetente: "Mari",
    valor: "R$ 72,00",
    descricao: "pizza do sábado",
  },
  "notification.shared_debt.single.created": {
    remetente: "Mari",
    valor: "R$ 72,00",
    descricao: "pizza do sábado",
  },
  "notification.shared_debt.single.manual_created": {
    remetente: "Mari",
    valor: "R$ 72,00",
    descricao: "pizza do sábado",
    nota: "Pode me mandar o comprovante por aqui.",
  },
  "notification.shared_debt.batch.response.accept.regular": {
    destinatario: "Leo",
    n_cobrancas: "3 cobranças",
    valor_total: "R$ 184,90",
    nota: "Pode me mandar o comprovante por aqui.",
  },
  "notification.shared_debt.batch.response.reject.regular": {
    destinatario: "Leo",
    n_cobrancas: "3 cobranças",
    valor_total: "R$ 184,90",
    nota: "Pode me mandar o comprovante por aqui.",
  },
  "notification.shared_debt.batch.response.accept.manual": {
    destinatario: "Leo",
    n_lembretes: "2 lembretes avulsos",
    valor_total: "R$ 184,90",
    nota: "Pode me mandar o comprovante por aqui.",
  },
  "notification.shared_debt.batch.response.reject.manual": {
    destinatario: "Leo",
    n_lembretes: "2 lembretes avulsos",
    valor_total: "R$ 184,90",
    nota: "Pode me mandar o comprovante por aqui.",
  },
  "notification.shared_debt.single.response.accept.regular": {
    destinatario: "Leo",
    valor: "R$ 72,00",
    descricao: "pizza do sábado",
    nota: "Pode me mandar o comprovante por aqui.",
  },
  "notification.shared_debt.single.response.reject.regular": {
    destinatario: "Leo",
    valor: "R$ 72,00",
    descricao: "pizza do sábado",
    nota: "Pode me mandar o comprovante por aqui.",
  },
  "notification.shared_debt.single.response.accept.manual": {
    destinatario: "Leo",
    valor: "R$ 72,00",
    descricao: "pizza do sábado",
    nota: "Pode me mandar o comprovante por aqui.",
  },
  "notification.shared_debt.single.response.reject.manual": {
    destinatario: "Leo",
    valor: "R$ 72,00",
    descricao: "pizza do sábado",
    nota: "Pode me mandar o comprovante por aqui.",
  },
  "notification.shared_debt.single.sender_action.accept_rejection.regular": {
    remetente: "Mari",
    valor: "R$ 72,00",
    descricao: "pizza do sábado",
    nota: "Pode me mandar o comprovante por aqui.",
  },
  "notification.shared_debt.single.sender_action.contest_rejection.regular": {
    remetente: "Mari",
    valor: "R$ 72,00",
    descricao: "pizza do sábado",
    nota: "Pode me mandar o comprovante por aqui.",
  },
  "notification.shared_debt.single.sender_action.accept_rejection.manual": {
    remetente: "Mari",
    valor: "R$ 72,00",
    descricao: "pizza do sábado",
    nota: "Pode me mandar o comprovante por aqui.",
  },
  "notification.shared_debt.single.sender_action.contest_rejection.manual": {
    remetente: "Mari",
    valor: "R$ 72,00",
    descricao: "pizza do sábado",
    nota: "Pode me mandar o comprovante por aqui.",
  },
  "notification.monthly_pix.reported": {
    pagador: "Leo",
    valor: "R$ 72,00",
    mes_referencia: "04/2026",
    nota: "Pode me mandar o comprovante por aqui.",
  },
  "notification.monthly_pix.confirmed": {
    credor: "Mari",
    valor: "R$ 72,00",
    mes_referencia: "04/2026",
    resumo_distribuicao_pix: "2 cobranças ficaram quitadas.",
    nota: "Pode me mandar o comprovante por aqui.",
  },
  "notification.monthly_pix.revision": {
    credor: "Mari",
    valor: "R$ 72,00",
    mes_referencia: "04/2026",
    nota: "Pode me mandar o comprovante por aqui.",
  },
  "notification.shared_debt.payment_marked.regular": {
    pagador: "Leo",
    valor: "R$ 72,00",
    descricao: "pizza do sábado",
    nota: "Pode me mandar o comprovante por aqui.",
  },
  "notification.shared_debt.payment_marked.manual": {
    pagador: "Leo",
    valor: "R$ 72,00",
    descricao: "pizza do sábado",
    nota: "Pode me mandar o comprovante por aqui.",
  },
  "notification.shared_debt.payment_confirmed.regular": {
    credor: "Mari",
    valor: "R$ 72,00",
    descricao: "pizza do sábado",
    nota: "Pode me mandar o comprovante por aqui.",
  },
  "notification.shared_debt.payment_confirmed.manual": {
    credor: "Mari",
    valor: "R$ 72,00",
    descricao: "pizza do sábado",
    nota: "Pode me mandar o comprovante por aqui.",
  },
  "notification.shared_debt.payment_marked.bulk": {
    pagador: "Leo",
    n_cobrancas: "3 cobranças",
    periodo: "04/2026",
    valor_total: "R$ 184,90",
    nota: "Pode me mandar o comprovante por aqui.",
  },
  "notification.shared_debt.payment_confirmed.bulk": {
    credor: "Mari",
    n_cobrancas: "3 cobranças",
    periodo: "04/2026",
    valor_total: "R$ 184,90",
    nota: "Pode me mandar o comprovante por aqui.",
  },
  "notification.friendship.request_received": {
    pessoa: "Mari",
  },
  "notification.friendship.request_accepted": {
    pessoa: "Mari",
  },
  "notification.friendship.request_rejected": {
    pessoa: "Mari",
  },
  "notification.friendship.ended": {
    pessoa: "Mari",
  },
  "notification.statement_pdf.ready": {
    arquivo: "fatura-santander-marco.pdf",
    cartao: "Santander Free",
    competencia: "03/2026",
    status_resumo: "42 lancamentos ficaram prontos para revisao.",
  },
  "dashboard.friendship.pending.single": {
    pessoa: "Mari",
  },
  "dashboard.friendship.pending.multi": {
    n_pedidos: "3 pedidos",
  },
  "dashboard.friendship.unread": {
    titulo_reaproveitado: "Hoje entra freela da semana",
    body_reaproveitado: "freela da semana está no radar de hoje com R$ 280,00.",
  },
  "dashboard.shared_debt.unread.single": {
    titulo_reaproveitado: "Hoje entra freela da semana",
    body_reaproveitado: "freela da semana está no radar de hoje com R$ 280,00.",
  },
  "dashboard.shared_debt.unread.multi": {
    n_novidades: "4 novidades",
  },
  "dashboard.shared_debt.pending": {
    n_cobrancas: "3 cobranças",
  },
  "dashboard.shared_debt.draft_queue": {
    n_cobrancas: "3 cobranças",
    valor_total: "R$ 184,90",
  },
  "dashboard.private_reminders.radar": {
    titulo_radar: "Fatura vencida com pendência",
    descricao_radar: "Nubank (10/04) ainda tem R$ 240,00 pendente.",
  },
  "dashboard.monthly_finance.today": {
    titulo_reaproveitado: "Hoje entra freela da semana",
    body_reaproveitado: "freela da semana está no radar de hoje com R$ 280,00.",
  },
  "dashboard.cards.closing_today": {
    titulo_radar: "Fatura vencida com pendência",
    descricao_radar: "Nubank (10/04) ainda tem R$ 240,00 pendente.",
  },
  "dashboard.cards.due_soon": {
    descricao_radar: "Nubank (10/04) ainda tem R$ 240,00 pendente.",
  },
  "dashboard.shared_debt.rejections_pending": {
    n_recusas: "2 recusas",
  },
  "dashboard.shared_debt.payments_pending": {
    n_pagamentos: "3 pagamentos",
    dica_pix_mes: "1 deles é Pix do mês.",
  },
  "dashboard.monthly_pix.pending_confirmation": {
    n_pix_mes: "2 avisos",
  },
  "dashboard.month.unassigned": {
    n_itens: "5 itens",
  },
  "dashboard.cards.overdue": {
    titulo_radar: "Fatura vencida com pendência",
    descricao_radar: "Nubank (10/04) ainda tem R$ 240,00 pendente.",
  }
};

const MESSAGE_PREVIEW_FIXTURES = {
  ...BASE_MESSAGE_PREVIEW_FIXTURES,
  ...ADDITIONAL_MESSAGE_PREVIEW_FIXTURES
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
