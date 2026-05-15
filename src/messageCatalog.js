const BASE_MESSAGE_CATALOG = [
  {
    catalogId: 'NTF-001',
    messageKey: 'notification.shared_debt.batch.new',
    channel: 'Central de avisos do app + Push',
    previewRenderer: 'notification',
    category: 'Acertos compartilhados',
    flow: 'Leva de acertos compartilhados',
    purpose: 'Novo lote enviado para o destinatário',
    defaultTitle: 'Chegou um acerto por aqui',
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
    category: 'Acertos compartilhados',
    flow: 'Leva de acertos compartilhados',
    purpose: 'Leva atualizada',
    defaultTitle: 'Um acerto por aqui foi atualizado',
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
    category: 'Acertos compartilhados',
    flow: 'Leva de acertos compartilhados',
    purpose: 'Lote só com cancelamentos ou ajustes',
    defaultTitle: 'Um acerto compartilhado mudou por aqui',
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
    category: 'Acertos compartilhados',
    flow: 'Leva de acertos compartilhados',
    purpose: 'Lote misto com criação e ajuste',
    defaultTitle: 'Tem novidade em um acerto por aqui',
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
    category: 'Acertos / datas combinadas',
    flow: 'Acerto manual com data combinada',
    purpose: 'Lembrete do dia para pagar com um item',
    defaultTitle: 'Hoje é o dia combinado para pagar',
    defaultBody: 'Tem {valor} combinado com {contraparte} em {descricao} te esperando hoje.',
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
    category: 'Acertos / datas combinadas',
    flow: 'Acerto manual com data combinada',
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
    category: 'Acertos / datas combinadas',
    flow: 'Acerto manual com data combinada',
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
    category: 'Acertos / datas combinadas',
    flow: 'Acerto manual com data combinada',
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
  },
  {
    catalogId: 'SHR-001',
    messageKey: 'share.summary.settled.native',
    channel: 'Compartilhamento nativo da imagem/resumo',
    previewRenderer: 'share_text',
    category: 'Compartilhamento de resumo',
    flow: 'Resumo do mês - liquidado',
    purpose: 'Texto nativo para share quando já está tudo pago',
    defaultTitle: 'Resumo {periodo} — {pessoa}',
    defaultBody: 'Separei o resumo de {periodo} só para registro.\nJá ficou tudo certinho por aqui. Obrigado por fechar essa com a gente.\n\nTotal do período: {valor_total}.\nValor pago: {valor_pago}.',
    variables: [
      { name: 'periodo', required: true, fields: ['title', 'body'] },
      { name: 'pessoa', required: true, fields: ['title'] },
      { name: 'valor_total', required: true, fields: ['body'] },
      { name: 'valor_pago', required: true, fields: ['body'] }
    ]
  },
  {
    catalogId: 'SHR-002',
    messageKey: 'share.summary.partial.native.no_pix',
    channel: 'Compartilhamento nativo da imagem/resumo',
    previewRenderer: 'share_text',
    category: 'Compartilhamento de resumo',
    flow: 'Resumo do mês - parcialmente pago',
    purpose: 'Texto nativo para share sem Pix embutido',
    defaultTitle: 'Resumo {periodo} — {pessoa}',
    defaultBody: 'Separei o resumo de {periodo}. Já entrou {valor_pago} e ainda falta {valor_restante} para fechar tudo.\n\nA imagem vai junto com os detalhes.',
    variables: [
      { name: 'periodo', required: true, fields: ['title', 'body'] },
      { name: 'pessoa', required: true, fields: ['title'] },
      { name: 'valor_pago', required: true, fields: ['body'] },
      { name: 'valor_restante', required: true, fields: ['body'] }
    ]
  },
  {
    catalogId: 'SHR-003',
    messageKey: 'share.summary.partial.native.with_pix',
    channel: 'Compartilhamento nativo da imagem/resumo',
    previewRenderer: 'share_text',
    category: 'Compartilhamento de resumo',
    flow: 'Resumo do mês - parcialmente pago',
    purpose: 'Texto nativo para share com Pix embutido',
    defaultTitle: 'Resumo {periodo} — {pessoa}',
    defaultBody: 'Separei o resumo de {periodo}. Já entrou {valor_pago} e ainda falta {valor_restante} para fechar tudo.\n\nA imagem vai junto com os detalhes.\n\nPix copia e cola do saldo restante:\n\n{pix_payload}',
    variables: [
      { name: 'periodo', required: true, fields: ['title', 'body'] },
      { name: 'pessoa', required: true, fields: ['title'] },
      { name: 'valor_pago', required: true, fields: ['body'] },
      { name: 'valor_restante', required: true, fields: ['body'] },
      { name: 'pix_payload', required: true, fields: ['body'] }
    ]
  },
  {
    catalogId: 'SHR-004',
    messageKey: 'share.summary.open.native.no_pix',
    channel: 'Compartilhamento nativo da imagem/resumo',
    previewRenderer: 'share_text',
    category: 'Compartilhamento de resumo',
    flow: 'Resumo do mês - em aberto',
    purpose: 'Texto nativo para share sem Pix embutido',
    defaultTitle: 'Resumo {periodo} — {pessoa}',
    defaultBody: 'Separei o resumo de {periodo}. O total em aberto ficou em {valor_restante}.\n\nA imagem vai junto com os detalhes.',
    variables: [
      { name: 'periodo', required: true, fields: ['title', 'body'] },
      { name: 'pessoa', required: true, fields: ['title'] },
      { name: 'valor_restante', required: true, fields: ['body'] }
    ]
  },
  {
    catalogId: 'SHR-005',
    messageKey: 'share.summary.open.native.with_pix',
    channel: 'Compartilhamento nativo da imagem/resumo',
    previewRenderer: 'share_text',
    category: 'Compartilhamento de resumo',
    flow: 'Resumo do mês - em aberto',
    purpose: 'Texto nativo para share com Pix embutido',
    defaultTitle: 'Resumo {periodo} — {pessoa}',
    defaultBody: 'Separei o resumo de {periodo}. O total em aberto ficou em {valor_restante}.\n\nA imagem vai junto com os detalhes.\n\nPix copia e cola para facilitar o acerto:\n\n{pix_payload}',
    variables: [
      { name: 'periodo', required: true, fields: ['title', 'body'] },
      { name: 'pessoa', required: true, fields: ['title'] },
      { name: 'valor_restante', required: true, fields: ['body'] },
      { name: 'pix_payload', required: true, fields: ['body'] }
    ]
  },
  {
    catalogId: 'WPP-001',
    messageKey: 'whatsapp.summary.settled.caption',
    channel: 'WhatsApp (legenda da imagem)',
    previewRenderer: 'whatsapp',
    category: 'Compartilhamento de resumo',
    flow: 'Resumo do mês - liquidado',
    purpose: 'Legenda enviada junto da imagem',
    defaultTitle: 'Legenda do WhatsApp — resumo liquidado',
    defaultBody: '*Oi, {pessoa}!* ✨\n\nSeparei o resumo de *{periodo}* só para registro.\nJá ficou tudo certinho por aqui.\n\nA imagem com os detalhes foi logo abaixo 👇',
    variables: [
      { name: 'pessoa', required: true, fields: ['body'] },
      { name: 'periodo', required: true, fields: ['body'] }
    ]
  },
  {
    catalogId: 'WPP-002',
    messageKey: 'whatsapp.summary.partial.caption',
    channel: 'WhatsApp (legenda da imagem)',
    previewRenderer: 'whatsapp',
    category: 'Compartilhamento de resumo',
    flow: 'Resumo do mês - parcialmente pago',
    purpose: 'Legenda enviada junto da imagem',
    defaultTitle: 'Legenda do WhatsApp — resumo parcial',
    defaultBody: '*Oi, {pessoa}!* 💳\n\nSeparei o resumo de *{periodo}*. Já entrou *{valor_pago}* e ainda falta *{valor_restante}* para fechar tudo.\n\nA imagem com os detalhes foi logo abaixo 👇',
    variables: [
      { name: 'pessoa', required: true, fields: ['body'] },
      { name: 'periodo', required: true, fields: ['body'] },
      { name: 'valor_pago', required: true, fields: ['body'] },
      { name: 'valor_restante', required: true, fields: ['body'] }
    ]
  },
  {
    catalogId: 'WPP-003',
    messageKey: 'whatsapp.summary.partial.followup',
    channel: 'WhatsApp (mensagem de apoio)',
    previewRenderer: 'whatsapp',
    category: 'Compartilhamento de resumo',
    flow: 'Resumo do mês - parcialmente pago, sem automação Pix bruto',
    purpose: 'Mensagem complementar pensada para cópia manual',
    defaultTitle: 'Mensagem de apoio do WhatsApp — resumo parcial',
    defaultBody: 'Pix copia e cola do saldo restante ({valor_restante}):\n\n{pix_payload}\n\nQuando pagar, me manda o comprovante por aqui 💸',
    variables: [
      { name: 'valor_restante', required: true, fields: ['body'] },
      { name: 'pix_payload', required: true, fields: ['body'] }
    ]
  },
  {
    catalogId: 'WPP-004',
    messageKey: 'whatsapp.summary.open.caption',
    channel: 'WhatsApp (legenda da imagem)',
    previewRenderer: 'whatsapp',
    category: 'Compartilhamento de resumo',
    flow: 'Resumo do mês - em aberto',
    purpose: 'Legenda enviada junto da imagem',
    defaultTitle: 'Legenda do WhatsApp — resumo em aberto',
    defaultBody: '*Oi, {pessoa}!* 💳\n\nSeparei o resumo de *{periodo}*. O total em aberto ficou em *{valor_restante}*.\n\nA imagem com os detalhes foi logo abaixo 👇',
    variables: [
      { name: 'pessoa', required: true, fields: ['body'] },
      { name: 'periodo', required: true, fields: ['body'] },
      { name: 'valor_restante', required: true, fields: ['body'] }
    ]
  },
  {
    catalogId: 'WPP-005',
    messageKey: 'whatsapp.summary.open.followup',
    channel: 'WhatsApp (mensagem de apoio)',
    previewRenderer: 'whatsapp',
    category: 'Compartilhamento de resumo',
    flow: 'Resumo do mês - em aberto, sem automação Pix bruto',
    purpose: 'Mensagem complementar pensada para cópia manual',
    defaultTitle: 'Mensagem de apoio do WhatsApp — resumo em aberto',
    defaultBody: 'Pix copia e cola para fechar esse resumo ({valor_restante}):\n\n{pix_payload}\n\nQuando pagar, me manda o comprovante por aqui 💸',
    variables: [
      { name: 'valor_restante', required: true, fields: ['body'] },
      { name: 'pix_payload', required: true, fields: ['body'] }
    ]
  },
  {
    catalogId: 'WPP-006',
    messageKey: 'whatsapp.summary.auto.second.pix_only',
    channel: 'WhatsApp automação (2ª mensagem)',
    previewRenderer: 'whatsapp',
    category: 'Compartilhamento de resumo',
    flow: 'Resumo do mês com Pix configurado',
    purpose: 'Automação envia somente o Pix bruto como segunda mensagem',
    defaultTitle: 'Automação do WhatsApp — Pix bruto',
    defaultBody: '{pix_payload}',
    variables: [
      { name: 'pix_payload', required: true, fields: ['body'] }
    ]
  },
  {
    catalogId: 'WPP-007',
    messageKey: 'whatsapp.summary.auto.second.fallback',
    channel: 'WhatsApp automação (2ª mensagem)',
    previewRenderer: 'whatsapp',
    category: 'Compartilhamento de resumo',
    flow: 'Resumo do mês sem Pix configurado',
    purpose: 'Automação cai no texto complementar quando não há Pix',
    defaultTitle: 'Automação do WhatsApp — apoio sem Pix bruto',
    defaultBody: 'Pix copia e cola do saldo restante ({valor_restante}):\n\n{pix_payload}\n\nQuando pagar, me manda o comprovante por aqui 💸',
    variables: [
      { name: 'valor_restante', required: true, fields: ['body'] },
      { name: 'pix_payload', required: true, fields: ['body'] }
    ]
  },
  {
    catalogId: 'PIX-001',
    messageKey: 'pix.manual_request.share',
    channel: 'Compartilhamento Pix (share/cópia)',
    previewRenderer: 'pix_copy',
    category: 'Pix / cobrança avulsa',
    flow: 'Acerto avulso com Pix',
    purpose: 'Texto compartilhável da cobrança avulsa',
    defaultTitle: 'Acerto com Pix[ de {credor}]',
    defaultBody: 'Oi! Ficou pendente {valor} referente a {descricao}.\n\nPara facilitar, já deixei o Pix copia e cola de {credor} aqui embaixo:\n\n{pix_payload}\n\nDepois me avisa por aqui quando pagar 💸',
    variables: [
      { name: 'credor', required: true, fields: ['body'] },
      { name: 'valor', required: true, fields: ['body'] },
      { name: 'descricao', required: true, fields: ['body'] },
      { name: 'pix_payload', required: true, fields: ['body'] }
    ]
  },
  {
    catalogId: 'PIX-002',
    messageKey: 'pix.monthly_settlement.share',
    channel: 'Compartilhamento Pix (share/cópia)',
    previewRenderer: 'pix_copy',
    category: 'Pix / carteira mensal',
    flow: 'Pix do mês',
    purpose: 'Texto compartilhável do Pix do mês',
    defaultTitle: 'Pix do mês[ para {credor}]',
    defaultBody: 'Oi! Separei {valor} para acertar {periodo} por aqui.\n\nPara facilitar, já deixei o Pix copia e cola de {credor} logo abaixo:\n\n{pix_payload}\n\nDepois me avisa no app quando fizer o Pix 💸',
    variables: [
      { name: 'credor', required: true, fields: ['body'] },
      { name: 'valor', required: true, fields: ['body'] },
      { name: 'periodo', required: true, fields: ['body'] },
      { name: 'pix_payload', required: true, fields: ['body'] }
    ]
  },
  {
    catalogId: 'EML-001',
    messageKey: 'email.admin_access.welcome',
    channel: 'E-mail',
    previewRenderer: 'email',
    category: 'E-mail',
    flow: 'Admin / convite',
    purpose: 'Boas-vindas / acesso liberado',
    defaultTitle: 'Seu acesso ao {app} foi liberado',
    defaultBody: 'Oi[, {nome}]!\n\n{admin_ou_sistema} liberou o seu acesso ao {app}.\nSeu perfil entrou como {perfil}.\n\nPara entrar, use a mesma conta Google deste e-mail.\nNada de senha por e-mail nem código temporário: é só entrar com a conta Google certa.\n\nEntrar no {app}: {link_login}[\n\nRecado do admin:\n{recado_admin}]',
    variables: [
      { name: 'app', required: true, fields: ['title', 'body'] },
      { name: 'nome', required: false, fields: ['body'] },
      { name: 'admin_ou_sistema', required: true, fields: ['body'] },
      { name: 'perfil', required: true, fields: ['body'] },
      { name: 'link_login', required: true, fields: ['body'] },
      { name: 'recado_admin', required: false, fields: ['body'] }
    ]
  },
  {
    catalogId: 'EML-002',
    messageKey: 'email.admin_access.test',
    channel: 'E-mail',
    previewRenderer: 'email',
    category: 'E-mail',
    flow: 'Admin / teste SMTP',
    purpose: 'Teste técnico de e-mail',
    defaultTitle: 'Teste de e-mail do {app}',
    defaultBody: 'Oi[, {nome}]!\n\n{admin_ou_time} acabou de testar a trilha de e-mail do {app}.\n\nSe esta mensagem chegou, o SMTP já está pronto para mandar os boas-vindas do Admin.[\n\nLink atual de entrada: {link_login}]',
    variables: [
      { name: 'app', required: true, fields: ['title', 'body'] },
      { name: 'nome', required: false, fields: ['body'] },
      { name: 'admin_ou_time', required: true, fields: ['body'] },
      { name: 'link_login', required: false, fields: ['body'] }
    ]
  }
];

const ADDITIONAL_MESSAGE_CATALOG = [
  {
    catalogId: "NTF-014",
    messageKey: "notification.shared_debt.single.updated",
    channel: "Central de avisos do app + Push",
    previewRenderer: "notification",
    category: "Acertos compartilhados",
    flow: "Sincronização automática da divisão",
    purpose: "Acerto individual atualizado",
    defaultTitle: "Um acerto compartilhado foi atualizado",
    defaultBody: "{remetente} ajustou o acerto de {valor} ({descricao}).",
    variables: [
      { name: "remetente", required: true, fields: ["body"] },
      { name: "valor", required: true, fields: ["body"] },
      { name: "descricao", required: true, fields: ["body"] },
    ]
  },
  {
    catalogId: "NTF-015",
    messageKey: "notification.shared_debt.single.created",
    channel: "Central de avisos do app + Push",
    previewRenderer: "notification",
    category: "Acertos compartilhados",
    flow: "Sincronização automática da divisão",
    purpose: "Acerto individual criado",
    defaultTitle: "Chegou um acerto compartilhado",
    defaultBody: "{remetente} te enviou um acerto de {valor} ({descricao}).",
    variables: [
      { name: "remetente", required: true, fields: ["body"] },
      { name: "valor", required: true, fields: ["body"] },
      { name: "descricao", required: true, fields: ["body"] },
    ]
  },
  {
    catalogId: "NTF-016",
    messageKey: "notification.shared_debt.single.manual_created",
    channel: "Central de avisos do app + Push",
    previewRenderer: "notification",
    category: "Acertos compartilhados",
    flow: "Lembrete avulso manual",
    purpose: "Lembrete avulso enviado",
    defaultTitle: "Chegou um lembrete avulso",
    defaultBody: "{remetente} te enviou um lembrete de {valor} ({descricao}). [Recado: {nota}]",
    variables: [
      { name: "remetente", required: true, fields: ["body"] },
      { name: "valor", required: true, fields: ["body"] },
      { name: "descricao", required: true, fields: ["body"] },
      { name: "nota", required: false, fields: ["body"] },
    ]
  },
  {
    catalogId: "NTF-017",
    messageKey: "notification.shared_debt.batch.response.accept.regular",
    channel: "Central de avisos do app + Push",
    previewRenderer: "notification",
    category: "Acertos compartilhados",
    flow: "Resposta a envio em lote",
    purpose: "Lote regular aceito pelo destinatário",
    defaultTitle: "Seu envio foi aceito",
    defaultBody: "{destinatario} aceitou {n_cobrancas} do seu envio, somando {valor_total}. [Recado: {nota}]",
    variables: [
      { name: "destinatario", required: true, fields: ["body"] },
      { name: "n_cobrancas", required: true, fields: ["body"] },
      { name: "valor_total", required: true, fields: ["body"] },
      { name: "nota", required: false, fields: ["body"] },
    ]
  },
  {
    catalogId: "NTF-018",
    messageKey: "notification.shared_debt.batch.response.reject.regular",
    channel: "Central de avisos do app + Push",
    previewRenderer: "notification",
    category: "Acertos compartilhados",
    flow: "Resposta a envio em lote",
    purpose: "Lote regular recusado pelo destinatário",
    defaultTitle: "Seu envio foi recusado",
    defaultBody: "{destinatario} recusou {n_cobrancas} do seu envio, somando {valor_total}. [Recado: {nota}]",
    variables: [
      { name: "destinatario", required: true, fields: ["body"] },
      { name: "n_cobrancas", required: true, fields: ["body"] },
      { name: "valor_total", required: true, fields: ["body"] },
      { name: "nota", required: false, fields: ["body"] },
    ]
  },
  {
    catalogId: "NTF-019",
    messageKey: "notification.shared_debt.batch.response.accept.manual",
    channel: "Central de avisos do app + Push",
    previewRenderer: "notification",
    category: "Acertos compartilhados",
    flow: "Resposta a envio em lote",
    purpose: "Lote de lembrete avulso aceito",
    defaultTitle: "Seu lembrete avulso foi aceito",
    defaultBody: "{destinatario} aceitou {n_lembretes} do seu envio, somando {valor_total}. [Recado: {nota}]",
    variables: [
      { name: "destinatario", required: true, fields: ["body"] },
      { name: "n_lembretes", required: true, fields: ["body"] },
      { name: "valor_total", required: true, fields: ["body"] },
      { name: "nota", required: false, fields: ["body"] },
    ]
  },
  {
    catalogId: "NTF-020",
    messageKey: "notification.shared_debt.batch.response.reject.manual",
    channel: "Central de avisos do app + Push",
    previewRenderer: "notification",
    category: "Acertos compartilhados",
    flow: "Resposta a envio em lote",
    purpose: "Lote de lembrete avulso recusado",
    defaultTitle: "Seu lembrete avulso foi recusado",
    defaultBody: "{destinatario} recusou {n_lembretes} do seu envio, somando {valor_total}. [Recado: {nota}]",
    variables: [
      { name: "destinatario", required: true, fields: ["body"] },
      { name: "n_lembretes", required: true, fields: ["body"] },
      { name: "valor_total", required: true, fields: ["body"] },
      { name: "nota", required: false, fields: ["body"] },
    ]
  },
  {
    catalogId: "NTF-021",
    messageKey: "notification.shared_debt.single.response.accept.regular",
    channel: "Central de avisos do app + Push",
    previewRenderer: "notification",
    category: "Acertos compartilhados",
    flow: "Resposta a acerto individual",
    purpose: "Acerto regular aceito",
    defaultTitle: "Aceitaram seu acerto compartilhado",
    defaultBody: "{destinatario} aceitou o acerto de {valor} ({descricao}). [Recado: {nota}]",
    variables: [
      { name: "destinatario", required: true, fields: ["body"] },
      { name: "valor", required: true, fields: ["body"] },
      { name: "descricao", required: true, fields: ["body"] },
      { name: "nota", required: false, fields: ["body"] },
    ]
  },
  {
    catalogId: "NTF-022",
    messageKey: "notification.shared_debt.single.response.reject.regular",
    channel: "Central de avisos do app + Push",
    previewRenderer: "notification",
    category: "Acertos compartilhados",
    flow: "Resposta a acerto individual",
    purpose: "Acerto regular recusado",
    defaultTitle: "Recusaram seu acerto compartilhado",
    defaultBody: "{destinatario} recusou o acerto de {valor} ({descricao}). [Recado: {nota}]",
    variables: [
      { name: "destinatario", required: true, fields: ["body"] },
      { name: "valor", required: true, fields: ["body"] },
      { name: "descricao", required: true, fields: ["body"] },
      { name: "nota", required: false, fields: ["body"] },
    ]
  },
  {
    catalogId: "NTF-023",
    messageKey: "notification.shared_debt.single.response.accept.manual",
    channel: "Central de avisos do app + Push",
    previewRenderer: "notification",
    category: "Acertos compartilhados",
    flow: "Resposta a acerto individual",
    purpose: "Lembrete avulso aceito",
    defaultTitle: "Aceitaram seu lembrete avulso",
    defaultBody: "{destinatario} aceitou o lembrete avulso de {valor} ({descricao}). [Recado: {nota}]",
    variables: [
      { name: "destinatario", required: true, fields: ["body"] },
      { name: "valor", required: true, fields: ["body"] },
      { name: "descricao", required: true, fields: ["body"] },
      { name: "nota", required: false, fields: ["body"] },
    ]
  },
  {
    catalogId: "NTF-024",
    messageKey: "notification.shared_debt.single.response.reject.manual",
    channel: "Central de avisos do app + Push",
    previewRenderer: "notification",
    category: "Acertos compartilhados",
    flow: "Resposta a acerto individual",
    purpose: "Lembrete avulso recusado",
    defaultTitle: "Recusaram seu lembrete avulso",
    defaultBody: "{destinatario} recusou o lembrete avulso de {valor} ({descricao}). [Recado: {nota}]",
    variables: [
      { name: "destinatario", required: true, fields: ["body"] },
      { name: "valor", required: true, fields: ["body"] },
      { name: "descricao", required: true, fields: ["body"] },
      { name: "nota", required: false, fields: ["body"] },
    ]
  },
  {
    catalogId: "NTF-025",
    messageKey: "notification.shared_debt.single.sender_action.accept_rejection.regular",
    channel: "Central de avisos do app + Push",
    previewRenderer: "notification",
    category: "Acertos compartilhados",
    flow: "Decisão do remetente após recusa",
    purpose: "Recusa aceita (acerto regular)",
    defaultTitle: "Sua recusa foi aceita",
    defaultBody: "{remetente} aceitou a sua recusa do acerto de {valor} ({descricao}). [Recado: {nota}]",
    variables: [
      { name: "remetente", required: true, fields: ["body"] },
      { name: "valor", required: true, fields: ["body"] },
      { name: "descricao", required: true, fields: ["body"] },
      { name: "nota", required: false, fields: ["body"] },
    ]
  },
  {
    catalogId: "NTF-026",
    messageKey: "notification.shared_debt.single.sender_action.contest_rejection.regular",
    channel: "Central de avisos do app + Push",
    previewRenderer: "notification",
    category: "Acertos compartilhados",
    flow: "Decisão do remetente após recusa",
    purpose: "Recusa contestada (acerto regular)",
    defaultTitle: "Sua recusa foi contestada",
    defaultBody: "{remetente} contestou a sua recusa do acerto de {valor} ({descricao}). [Recado: {nota}]",
    variables: [
      { name: "remetente", required: true, fields: ["body"] },
      { name: "valor", required: true, fields: ["body"] },
      { name: "descricao", required: true, fields: ["body"] },
      { name: "nota", required: false, fields: ["body"] },
    ]
  },
  {
    catalogId: "NTF-027",
    messageKey: "notification.shared_debt.single.sender_action.accept_rejection.manual",
    channel: "Central de avisos do app + Push",
    previewRenderer: "notification",
    category: "Acertos compartilhados",
    flow: "Decisão do remetente após recusa",
    purpose: "Recusa aceita (lembrete avulso)",
    defaultTitle: "A recusa do lembrete foi aceita",
    defaultBody: "{remetente} aceitou a sua recusa do lembrete avulso de {valor} ({descricao}). [Recado: {nota}]",
    variables: [
      { name: "remetente", required: true, fields: ["body"] },
      { name: "valor", required: true, fields: ["body"] },
      { name: "descricao", required: true, fields: ["body"] },
      { name: "nota", required: false, fields: ["body"] },
    ]
  },
  {
    catalogId: "NTF-028",
    messageKey: "notification.shared_debt.single.sender_action.contest_rejection.manual",
    channel: "Central de avisos do app + Push",
    previewRenderer: "notification",
    category: "Acertos compartilhados",
    flow: "Decisão do remetente após recusa",
    purpose: "Recusa contestada (lembrete avulso)",
    defaultTitle: "A recusa do lembrete foi contestada",
    defaultBody: "{remetente} contestou a sua recusa do lembrete avulso de {valor} ({descricao}). [Recado: {nota}]",
    variables: [
      { name: "remetente", required: true, fields: ["body"] },
      { name: "valor", required: true, fields: ["body"] },
      { name: "descricao", required: true, fields: ["body"] },
      { name: "nota", required: false, fields: ["body"] },
    ]
  },
  {
    catalogId: "NTF-029",
    messageKey: "notification.monthly_pix.reported",
    channel: "Central de avisos do app + Push",
    previewRenderer: "notification",
    category: "Pix do mês",
    flow: "Carteira mensal / Pix",
    purpose: "Pagador informou o Pix do mês",
    defaultTitle: "Pix do mês informado",
    defaultBody: "{pagador} avisou um Pix de {valor} para {mes_referencia}. [Recado: {nota}]",
    variables: [
      { name: "pagador", required: true, fields: ["body"] },
      { name: "valor", required: true, fields: ["body"] },
      { name: "mes_referencia", required: true, fields: ["body"] },
      { name: "nota", required: false, fields: ["body"] },
    ]
  },
  {
    catalogId: "NTF-030",
    messageKey: "notification.monthly_pix.confirmed",
    channel: "Central de avisos do app + Push",
    previewRenderer: "notification",
    category: "Pix do mês",
    flow: "Carteira mensal / Pix",
    purpose: "Credor confirmou o Pix do mês",
    defaultTitle: "Pix do mês confirmado",
    defaultBody: "{credor} confirmou o Pix de {valor} em {mes_referencia}. {resumo_distribuicao_pix}. [Recado: {nota}]",
    variables: [
      { name: "credor", required: true, fields: ["body"] },
      { name: "valor", required: true, fields: ["body"] },
      { name: "mes_referencia", required: true, fields: ["body"] },
      { name: "resumo_distribuicao_pix", required: true, fields: ["body"] },
      { name: "nota", required: false, fields: ["body"] },
    ]
  },
  {
    catalogId: "NTF-031",
    messageKey: "notification.monthly_pix.revision",
    channel: "Central de avisos do app + Push",
    previewRenderer: "notification",
    category: "Pix do mês",
    flow: "Carteira mensal / Pix",
    purpose: "Credor devolveu o Pix para revisão",
    defaultTitle: "Pix do mês voltou para revisão",
    defaultBody: "{credor} não confirmou o Pix de {valor} em {mes_referencia}. O valor voltou para o saldo aberto dessa carteira. [Recado: {nota}]",
    variables: [
      { name: "credor", required: true, fields: ["body"] },
      { name: "valor", required: true, fields: ["body"] },
      { name: "mes_referencia", required: true, fields: ["body"] },
      { name: "nota", required: false, fields: ["body"] },
    ]
  },
  {
    catalogId: "NTF-032",
    messageKey: "notification.shared_debt.payment_marked.regular",
    channel: "Central de avisos do app + Push",
    previewRenderer: "notification",
    category: "Acertos compartilhados",
    flow: "Pagamento de acerto",
    purpose: "Pagador avisou que pagou o acerto",
    defaultTitle: "Pagamento marcado como feito",
    defaultBody: "{pagador} avisou que já pagou o acerto de {valor} ({descricao}). [Recado: {nota}]",
    variables: [
      { name: "pagador", required: true, fields: ["body"] },
      { name: "valor", required: true, fields: ["body"] },
      { name: "descricao", required: true, fields: ["body"] },
      { name: "nota", required: false, fields: ["body"] },
    ]
  },
  {
    catalogId: "NTF-033",
    messageKey: "notification.shared_debt.payment_marked.manual",
    channel: "Central de avisos do app + Push",
    previewRenderer: "notification",
    category: "Acertos compartilhados",
    flow: "Pagamento de lembrete avulso",
    purpose: "Pagador marcou o lembrete avulso como pago",
    defaultTitle: "Pagamento do lembrete marcado como feito",
    defaultBody: "{pagador} avisou que já pagou o lembrete avulso de {valor} ({descricao}). [Recado: {nota}]",
    variables: [
      { name: "pagador", required: true, fields: ["body"] },
      { name: "valor", required: true, fields: ["body"] },
      { name: "descricao", required: true, fields: ["body"] },
      { name: "nota", required: false, fields: ["body"] },
    ]
  },
  {
    catalogId: "NTF-034",
    messageKey: "notification.shared_debt.payment_confirmed.regular",
    channel: "Central de avisos do app + Push",
    previewRenderer: "notification",
    category: "Acertos compartilhados",
    flow: "Confirmação de recebimento",
    purpose: "Credor confirmou o recebimento do acerto",
    defaultTitle: "Pagamento confirmado",
    defaultBody: "{credor} confirmou o recebimento do acerto de {valor} ({descricao}). [Recado: {nota}]",
    variables: [
      { name: "credor", required: true, fields: ["body"] },
      { name: "valor", required: true, fields: ["body"] },
      { name: "descricao", required: true, fields: ["body"] },
      { name: "nota", required: false, fields: ["body"] },
    ]
  },
  {
    catalogId: "NTF-035",
    messageKey: "notification.shared_debt.payment_confirmed.manual",
    channel: "Central de avisos do app + Push",
    previewRenderer: "notification",
    category: "Acertos compartilhados",
    flow: "Confirmação de recebimento",
    purpose: "Credor confirmou o recebimento do lembrete avulso",
    defaultTitle: "Pagamento do lembrete confirmado",
    defaultBody: "{credor} confirmou o recebimento do lembrete avulso de {valor} ({descricao}). [Recado: {nota}]",
    variables: [
      { name: "credor", required: true, fields: ["body"] },
      { name: "valor", required: true, fields: ["body"] },
      { name: "descricao", required: true, fields: ["body"] },
      { name: "nota", required: false, fields: ["body"] },
    ]
  },
  {
    catalogId: "NTF-036",
    messageKey: "notification.shared_debt.payment_marked.bulk",
    channel: "Central de avisos do app + Push",
    previewRenderer: "notification",
    category: "Acertos compartilhados",
    flow: "Pagamento em lote",
    purpose: "Pagador avisou que pagou vários acertos",
    defaultTitle: "Pagamentos marcados como feitos",
    defaultBody: "{pagador} avisou o pagamento de {n_cobrancas}[ no período {periodo}], somando {valor_total}. [Recado: {nota}]",
    variables: [
      { name: "pagador", required: true, fields: ["body"] },
      { name: "n_cobrancas", required: true, fields: ["body"] },
      { name: "periodo", required: false, fields: ["body"] },
      { name: "valor_total", required: true, fields: ["body"] },
      { name: "nota", required: false, fields: ["body"] },
    ]
  },
  {
    catalogId: "NTF-037",
    messageKey: "notification.shared_debt.payment_confirmed.bulk",
    channel: "Central de avisos do app + Push",
    previewRenderer: "notification",
    category: "Acertos compartilhados",
    flow: "Confirmação em lote",
    purpose: "Credor confirmou vários acertos",
    defaultTitle: "Pagamentos confirmados",
    defaultBody: "{credor} confirmou o recebimento de {n_cobrancas}[ no período {periodo}], somando {valor_total}. [Recado: {nota}]",
    variables: [
      { name: "credor", required: true, fields: ["body"] },
      { name: "n_cobrancas", required: true, fields: ["body"] },
      { name: "periodo", required: false, fields: ["body"] },
      { name: "valor_total", required: true, fields: ["body"] },
      { name: "nota", required: false, fields: ["body"] },
    ]
  },
  {
    catalogId: "NTF-038",
    messageKey: "notification.friendship.request_received",
    channel: "Central de avisos do app + Push",
    previewRenderer: "notification",
    category: "Amizades",
    flow: "Rede de contatos",
    purpose: "Pedido de amizade recebido",
    defaultTitle: "Chegou um pedido de amizade",
    defaultBody: "{pessoa} quer virar seu contato de confiança no AcerttaPay.",
    variables: [
      { name: "pessoa", required: true, fields: ["body"] },
    ]
  },
  {
    catalogId: "NTF-039",
    messageKey: "notification.friendship.request_accepted",
    channel: "Central de avisos do app + Push",
    previewRenderer: "notification",
    category: "Amizades",
    flow: "Rede de contatos",
    purpose: "Pedido aceito",
    defaultTitle: "Amizade ativada",
    defaultBody: "{pessoa} aceitou seu pedido. Agora vocês já podem trocar acertos automáticos com mais privacidade.",
    variables: [
      { name: "pessoa", required: true, fields: ["body"] },
    ]
  },
  {
    catalogId: "NTF-040",
    messageKey: "notification.friendship.request_rejected",
    channel: "Central de avisos do app + Push",
    previewRenderer: "notification",
    category: "Amizades",
    flow: "Rede de contatos",
    purpose: "Pedido recusado",
    defaultTitle: "Pedido não aceito",
    defaultBody: "{pessoa} preferiu não ativar a amizade agora.",
    variables: [
      { name: "pessoa", required: true, fields: ["body"] },
    ]
  },
  {
    catalogId: "NTF-041",
    messageKey: "notification.friendship.ended",
    channel: "Central de avisos do app + Push",
    previewRenderer: "notification",
    category: "Amizades",
    flow: "Rede de contatos",
    purpose: "Amizade encerrada",
    defaultTitle: "Amizade desfeita",
    defaultBody: "{pessoa} desfez a amizade no AcerttaPay. O histórico continua, mas novos envios automáticos param por aqui.",
    variables: [
      { name: "pessoa", required: true, fields: ["body"] },
    ]
  },
  {
    catalogId: "NTF-042",
    messageKey: "notification.statement_pdf.ready",
    channel: "Central de avisos do app + Push",
    previewRenderer: "notification",
    category: "Importacao de fatura",
    flow: "PDF com IA",
    purpose: "Job pronto para revisao",
    defaultTitle: "Seu PDF ja ficou pronto para conferir",
    defaultBody: "{arquivo} no {cartao} ({competencia}) ja virou revisao. {status_resumo}",
    variables: [
      { name: "arquivo", required: true, fields: ["body"] },
      { name: "cartao", required: true, fields: ["body"] },
      { name: "competencia", required: true, fields: ["body"] },
      { name: "status_resumo", required: true, fields: ["body"] },
    ]
  },
  {
    catalogId: "NTF-043",
    messageKey: "notification.shared_debt.bulk_send.new",
    channel: "Central de avisos do app + Push",
    previewRenderer: "notification",
    category: "Acertos compartilhados",
    flow: "Envio em massa da caixa de saída",
    purpose: "Várias cobranças novas enviadas em uma única ação",
    defaultTitle: "Chegou uma leva de acertos por aqui",
    defaultBody: "{remetente} enviou {n_cobrancas} de uma vez, somando {valor_total}.[ Pegamos {n_periodos}: {periodos}.][ Na sacola: {previsao_descricoes}.]",
    variables: [
      { name: "remetente", required: true, fields: ["body"] },
      { name: "n_cobrancas", required: true, fields: ["body"] },
      { name: "valor_total", required: true, fields: ["body"] },
      { name: "n_periodos", required: false, fields: ["body"] },
      { name: "periodos", required: false, fields: ["body"] },
      { name: "previsao_descricoes", required: false, fields: ["body"] },
      { name: "n_novas", required: false, fields: ["body"] },
      { name: "n_atualizadas", required: false, fields: ["body"] },
      { name: "n_canceladas", required: false, fields: ["body"] },
    ]
  },
  {
    catalogId: "NTF-044",
    messageKey: "notification.shared_debt.bulk_send.updated",
    channel: "Central de avisos do app + Push",
    previewRenderer: "notification",
    category: "Acertos compartilhados",
    flow: "Envio em massa da caixa de saída",
    purpose: "Várias cobranças atualizadas em uma única ação",
    defaultTitle: "Uma leva de acertos foi atualizada",
    defaultBody: "{remetente} atualizou {n_cobrancas} de uma vez, somando {valor_total}.[ Pegamos {n_periodos}: {periodos}.][ Mexeu em: {previsao_descricoes}.]",
    variables: [
      { name: "remetente", required: true, fields: ["body"] },
      { name: "n_cobrancas", required: true, fields: ["body"] },
      { name: "valor_total", required: true, fields: ["body"] },
      { name: "n_periodos", required: false, fields: ["body"] },
      { name: "periodos", required: false, fields: ["body"] },
      { name: "previsao_descricoes", required: false, fields: ["body"] },
      { name: "n_novas", required: false, fields: ["body"] },
      { name: "n_atualizadas", required: false, fields: ["body"] },
      { name: "n_canceladas", required: false, fields: ["body"] },
    ]
  },
  {
    catalogId: "NTF-045",
    messageKey: "notification.shared_debt.bulk_send.adjusted",
    channel: "Central de avisos do app + Push",
    previewRenderer: "notification",
    category: "Acertos compartilhados",
    flow: "Envio em massa da caixa de saída",
    purpose: "Vários ajustes/cancelamentos enviados em uma única ação",
    defaultTitle: "Uma leva de acertos mudou por aqui",
    defaultBody: "{remetente} ajustou {n_cobrancas} de uma vez, somando {valor_total}.[ Pegamos {n_periodos}: {periodos}.][ Teve mexida em: {previsao_descricoes}.]",
    variables: [
      { name: "remetente", required: true, fields: ["body"] },
      { name: "n_cobrancas", required: true, fields: ["body"] },
      { name: "valor_total", required: true, fields: ["body"] },
      { name: "n_periodos", required: false, fields: ["body"] },
      { name: "periodos", required: false, fields: ["body"] },
      { name: "previsao_descricoes", required: false, fields: ["body"] },
      { name: "n_novas", required: false, fields: ["body"] },
      { name: "n_atualizadas", required: false, fields: ["body"] },
      { name: "n_canceladas", required: false, fields: ["body"] },
    ]
  },
  {
    catalogId: "NTF-046",
    messageKey: "notification.shared_debt.bulk_send.mixed",
    channel: "Central de avisos do app + Push",
    previewRenderer: "notification",
    category: "Acertos compartilhados",
    flow: "Envio em massa da caixa de saída",
    purpose: "Envio em massa com novas cobranças e ajustes misturados",
    defaultTitle: "Tem uma leva nova de acertos",
    defaultBody: "{remetente} organizou {n_cobrancas} de uma vez, somando {valor_total}.[ Pegamos {n_periodos}: {periodos}.][ Resumo: {n_novas}, {n_atualizadas}, {n_canceladas}.][ Na lista: {previsao_descricoes}.]",
    variables: [
      { name: "remetente", required: true, fields: ["body"] },
      { name: "n_cobrancas", required: true, fields: ["body"] },
      { name: "valor_total", required: true, fields: ["body"] },
      { name: "n_periodos", required: false, fields: ["body"] },
      { name: "periodos", required: false, fields: ["body"] },
      { name: "previsao_descricoes", required: false, fields: ["body"] },
      { name: "n_novas", required: false, fields: ["body"] },
      { name: "n_atualizadas", required: false, fields: ["body"] },
      { name: "n_canceladas", required: false, fields: ["body"] },
    ]
  },
  {
    catalogId: "NTF-047",
    messageKey: "notification.shared_debt.bulk_response.accept.regular",
    channel: "Central de avisos do app + Push",
    previewRenderer: "notification",
    category: "Acertos compartilhados",
    flow: "Resposta em massa da caixa de entrada",
    purpose: "Várias cobranças regulares aceitas em uma única ação",
    defaultTitle: "Cobranças aceitas de uma vez",
    defaultBody: "{destinatario} aceitou {n_cobrancas}, somando {valor_total}.[ Foram {n_periodos}: {periodos}.] [Recado: {nota}]",
    variables: [
      { name: "destinatario", required: true, fields: ["body"] },
      { name: "n_cobrancas", required: true, fields: ["body"] },
      { name: "valor_total", required: true, fields: ["body"] },
      { name: "n_periodos", required: false, fields: ["body"] },
      { name: "periodos", required: false, fields: ["body"] },
      { name: "nota", required: false, fields: ["body"] },
    ]
  },
  {
    catalogId: "NTF-048",
    messageKey: "notification.shared_debt.bulk_response.reject.regular",
    channel: "Central de avisos do app + Push",
    previewRenderer: "notification",
    category: "Acertos compartilhados",
    flow: "Resposta em massa da caixa de entrada",
    purpose: "Várias cobranças regulares recusadas em uma única ação",
    defaultTitle: "Cobranças recusadas de uma vez",
    defaultBody: "{destinatario} recusou {n_cobrancas}, somando {valor_total}.[ Foram {n_periodos}: {periodos}.] [Recado: {nota}]",
    variables: [
      { name: "destinatario", required: true, fields: ["body"] },
      { name: "n_cobrancas", required: true, fields: ["body"] },
      { name: "valor_total", required: true, fields: ["body"] },
      { name: "n_periodos", required: false, fields: ["body"] },
      { name: "periodos", required: false, fields: ["body"] },
      { name: "nota", required: false, fields: ["body"] },
    ]
  },
  {
    catalogId: "NTF-049",
    messageKey: "notification.shared_debt.bulk_response.accept.manual",
    channel: "Central de avisos do app + Push",
    previewRenderer: "notification",
    category: "Acertos compartilhados",
    flow: "Resposta em massa da caixa de entrada",
    purpose: "Vários lembretes avulsos aceitos em uma única ação",
    defaultTitle: "Lembretes avulsos aceitos",
    defaultBody: "{destinatario} aceitou {n_lembretes}, somando {valor_total}. [Recado: {nota}]",
    variables: [
      { name: "destinatario", required: true, fields: ["body"] },
      { name: "n_lembretes", required: true, fields: ["body"] },
      { name: "valor_total", required: true, fields: ["body"] },
      { name: "nota", required: false, fields: ["body"] },
    ]
  },
  {
    catalogId: "NTF-050",
    messageKey: "notification.shared_debt.bulk_response.reject.manual",
    channel: "Central de avisos do app + Push",
    previewRenderer: "notification",
    category: "Acertos compartilhados",
    flow: "Resposta em massa da caixa de entrada",
    purpose: "Vários lembretes avulsos recusados em uma única ação",
    defaultTitle: "Lembretes avulsos recusados",
    defaultBody: "{destinatario} recusou {n_lembretes}, somando {valor_total}. [Recado: {nota}]",
    variables: [
      { name: "destinatario", required: true, fields: ["body"] },
      { name: "n_lembretes", required: true, fields: ["body"] },
      { name: "valor_total", required: true, fields: ["body"] },
      { name: "nota", required: false, fields: ["body"] },
    ]
  },
  {
    catalogId: "NTF-051",
    messageKey: "notification.shared_debt.bulk_response.accept.mixed",
    channel: "Central de avisos do app + Push",
    previewRenderer: "notification",
    category: "Acertos compartilhados",
    flow: "Resposta em massa da caixa de entrada",
    purpose: "Cobranças regulares e lembretes avulsos aceitos juntos",
    defaultTitle: "Acertos aceitos de uma vez",
    defaultBody: "{destinatario} aceitou {n_cobrancas} e {n_lembretes}, somando {valor_total}.[ Foram {n_periodos}: {periodos}.] [Recado: {nota}]",
    variables: [
      { name: "destinatario", required: true, fields: ["body"] },
      { name: "n_cobrancas", required: true, fields: ["body"] },
      { name: "n_lembretes", required: true, fields: ["body"] },
      { name: "valor_total", required: true, fields: ["body"] },
      { name: "n_periodos", required: false, fields: ["body"] },
      { name: "periodos", required: false, fields: ["body"] },
      { name: "nota", required: false, fields: ["body"] },
    ]
  },
  {
    catalogId: "NTF-052",
    messageKey: "notification.shared_debt.bulk_response.reject.mixed",
    channel: "Central de avisos do app + Push",
    previewRenderer: "notification",
    category: "Acertos compartilhados",
    flow: "Resposta em massa da caixa de entrada",
    purpose: "Cobranças regulares e lembretes avulsos recusados juntos",
    defaultTitle: "Acertos recusados de uma vez",
    defaultBody: "{destinatario} recusou {n_cobrancas} e {n_lembretes}, somando {valor_total}.[ Foram {n_periodos}: {periodos}.] [Recado: {nota}]",
    variables: [
      { name: "destinatario", required: true, fields: ["body"] },
      { name: "n_cobrancas", required: true, fields: ["body"] },
      { name: "n_lembretes", required: true, fields: ["body"] },
      { name: "valor_total", required: true, fields: ["body"] },
      { name: "n_periodos", required: false, fields: ["body"] },
      { name: "periodos", required: false, fields: ["body"] },
      { name: "nota", required: false, fields: ["body"] },
    ]
  },
  {
    catalogId: "NTF-053",
    messageKey: "notification.shared_debt.sender_action.bulk.accept_rejection",
    channel: "Central de avisos do app + Push",
    previewRenderer: "notification",
    category: "Acertos compartilhados",
    flow: "Decisão do remetente após recusa",
    purpose: "Recusas aceitas em lote",
    defaultTitle: "Recusas aceitas",
    defaultBody: "{remetente} aceitou a recusa de {n_cobrancas}[ no período {periodo}], somando {valor_total}. [Recado: {nota}]",
    variables: [
      { name: "remetente", required: true, fields: ["body"] },
      { name: "n_cobrancas", required: true, fields: ["body"] },
      { name: "periodo", required: false, fields: ["body"] },
      { name: "valor_total", required: true, fields: ["body"] },
      { name: "nota", required: false, fields: ["body"] },
    ]
  },
  {
    catalogId: "NTF-054",
    messageKey: "notification.shared_debt.sender_action.bulk.contest_rejection",
    channel: "Central de avisos do app + Push",
    previewRenderer: "notification",
    category: "Acertos compartilhados",
    flow: "Decisão do remetente após recusa",
    purpose: "Recusas contestadas em lote",
    defaultTitle: "Recusas contestadas",
    defaultBody: "{remetente} contestou a recusa de {n_cobrancas}[ no período {periodo}], somando {valor_total}. [Recado: {nota}]",
    variables: [
      { name: "remetente", required: true, fields: ["body"] },
      { name: "n_cobrancas", required: true, fields: ["body"] },
      { name: "periodo", required: false, fields: ["body"] },
      { name: "valor_total", required: true, fields: ["body"] },
      { name: "nota", required: false, fields: ["body"] },
    ]
  },
  {
    catalogId: "NTF-055",
    messageKey: "notification.shared_debt.outside_app.confirmed.full",
    channel: "Central de avisos do app + Push",
    previewRenderer: "notification",
    category: "Acertos compartilhados",
    flow: "Encerramento por fora",
    purpose: "Credor registrou quitação feita fora do app",
    defaultTitle: "Pagamento registrado",
    defaultBody: "{credor} registrou {valor} fora do app em {mes_referencia}.[ {n_acertos_fechados}.][ {n_acertos_parciais}.][ Ainda ficam {valor_em_aberto} em aberto.] [Recado: {nota}]",
    variables: [
      { name: "credor", required: true, fields: ["body"] },
      { name: "valor", required: true, fields: ["body"] },
      { name: "mes_referencia", required: true, fields: ["body"] },
      { name: "n_acertos_fechados", required: false, fields: ["body"] },
      { name: "n_acertos_parciais", required: false, fields: ["body"] },
      { name: "valor_em_aberto", required: false, fields: ["body"] },
      { name: "nota", required: false, fields: ["body"] },
    ]
  },
  {
    catalogId: "NTF-056",
    messageKey: "notification.shared_debt.outside_app.confirmed.partial",
    channel: "Central de avisos do app + Push",
    previewRenderer: "notification",
    category: "Acertos compartilhados",
    flow: "Encerramento por fora",
    purpose: "Credor registrou pagamento parcial feito fora do app",
    defaultTitle: "Pagamento parcial registrado",
    defaultBody: "{credor} registrou {valor} fora do app em {mes_referencia}.[ {n_acertos_fechados}.][ {n_acertos_parciais}.][ Ainda ficam {valor_em_aberto} em aberto.] [Recado: {nota}]",
    variables: [
      { name: "credor", required: true, fields: ["body"] },
      { name: "valor", required: true, fields: ["body"] },
      { name: "mes_referencia", required: true, fields: ["body"] },
      { name: "n_acertos_fechados", required: false, fields: ["body"] },
      { name: "n_acertos_parciais", required: false, fields: ["body"] },
      { name: "valor_em_aberto", required: false, fields: ["body"] },
      { name: "nota", required: false, fields: ["body"] },
    ]
  },
  {
    catalogId: "GER-001",
    messageKey: "dashboard.friendship.pending.single",
    channel: "Card de alerta na visão geral",
    previewRenderer: "dashboard_alert",
    category: "Aba Geral / alertas",
    flow: "Rede de contatos",
    purpose: "Pedido de amizade pendente (1 pedido)",
    defaultTitle: "{pessoa} quer entrar na sua rede",
    defaultBody: "Aceitando, vocês liberam acertos automáticos dos dois lados com um ok de verdade.",
    variables: [
      { name: "pessoa", required: true, fields: ["title"] },
    ]
  },
  {
    catalogId: "GER-002",
    messageKey: "dashboard.friendship.pending.multi",
    channel: "Card de alerta na visão geral",
    previewRenderer: "dashboard_alert",
    category: "Aba Geral / alertas",
    flow: "Rede de contatos",
    purpose: "Pedidos de amizade pendentes (vários)",
    defaultTitle: "Pedidos de amizade esperando resposta",
    defaultBody: "{n_pedidos} te esperando na sua rede.",
    variables: [
      { name: "n_pedidos", required: true, fields: ["body"] },
    ]
  },
  {
    catalogId: "GER-003",
    messageKey: "dashboard.friendship.unread",
    channel: "Card de alerta na visão geral",
    previewRenderer: "dashboard_alert",
    category: "Aba Geral / alertas",
    flow: "Rede de contatos",
    purpose: "Novidade de amizade não lida",
    defaultTitle: "{titulo_reaproveitado}",
    defaultBody: "{body_reaproveitado}",
    variables: [
      { name: "titulo_reaproveitado", required: true, fields: ["title"] },
      { name: "body_reaproveitado", required: true, fields: ["body"] },
    ]
  },
  {
    catalogId: "GER-004",
    messageKey: "dashboard.shared_debt.unread.single",
    channel: "Card de alerta na visão geral",
    previewRenderer: "dashboard_alert",
    category: "Aba Geral / alertas",
    flow: "Acertos compartilhados",
    purpose: "Novidade única de acerto não lida",
    defaultTitle: "{titulo_reaproveitado}",
    defaultBody: "{body_reaproveitado}",
    variables: [
      { name: "titulo_reaproveitado", required: true, fields: ["title"] },
      { name: "body_reaproveitado", required: true, fields: ["body"] },
    ]
  },
  {
    catalogId: "GER-005",
    messageKey: "dashboard.shared_debt.unread.multi",
    channel: "Card de alerta na visão geral",
    previewRenderer: "dashboard_alert",
    category: "Aba Geral / alertas",
    flow: "Acertos compartilhados",
    purpose: "Múltiplas novidades de acerto não lidas",
    defaultTitle: "Acertos pendentes",
    defaultBody: "Você tem {n_novidades} em Acertos esperando sua olhada.",
    variables: [
      { name: "n_novidades", required: true, fields: ["body"] },
    ]
  },
  {
    catalogId: "GER-006",
    messageKey: "dashboard.shared_debt.pending",
    channel: "Card de alerta na visão geral",
    previewRenderer: "dashboard_alert",
    category: "Aba Geral / alertas",
    flow: "Acertos compartilhados",
    purpose: "Acertos pendentes sem notificação não lida",
    defaultTitle: "Envios aguardando sua análise",
    defaultBody: "{n_cobrancas} te esperando.",
    variables: [
      { name: "n_cobrancas", required: true, fields: ["body"] },
    ]
  },
  {
    catalogId: "GER-007",
    messageKey: "dashboard.shared_debt.draft_queue",
    channel: "Card de alerta na visão geral",
    previewRenderer: "dashboard_alert",
    category: "Aba Geral / alertas",
    flow: "Caixa de saída",
    purpose: "Envio guardado na caixa de saída",
    defaultTitle: "Tem 1 envio guardado na caixa de saída / Tem envios guardados na caixa de saída",
    defaultBody: "{n_cobrancas} prontas para disparar, somando {valor_total}.",
    variables: [
      { name: "n_cobrancas", required: true, fields: ["body"] },
      { name: "valor_total", required: true, fields: ["body"] },
    ]
  },
  {
    catalogId: "GER-008",
    messageKey: "dashboard.private_reminders.radar",
    channel: "Card de alerta na visão geral",
    previewRenderer: "dashboard_alert",
    category: "Aba Geral / alertas",
    flow: "Lembretes privados",
    purpose: "Radar de lembretes privados",
    defaultTitle: "{titulo_radar}",
    defaultBody: "{descricao_radar}",
    variables: [
      { name: "titulo_radar", required: true, fields: ["title"] },
      { name: "descricao_radar", required: true, fields: ["body"] },
    ]
  },
  {
    catalogId: "GER-011",
    messageKey: "dashboard.monthly_finance.today",
    channel: "Card de alerta na visão geral",
    previewRenderer: "dashboard_alert",
    category: "Aba Geral / alertas",
    flow: "Agenda financeira do mês",
    purpose: "Entradas/saídas do dia",
    defaultTitle: "{titulo_reaproveitado}",
    defaultBody: "{body_reaproveitado}",
    variables: [
      { name: "titulo_reaproveitado", required: true, fields: ["title"] },
      { name: "body_reaproveitado", required: true, fields: ["body"] },
    ]
  },
  {
    catalogId: "GER-012",
    messageKey: "dashboard.cards.closing_today",
    channel: "Card de alerta na visão geral",
    previewRenderer: "dashboard_alert",
    category: "Aba Geral / alertas",
    flow: "Cartões",
    purpose: "Cartão fecha hoje",
    defaultTitle: "{titulo_radar}",
    defaultBody: "{descricao_radar}",
    variables: [
      { name: "titulo_radar", required: true, fields: ["title"] },
      { name: "descricao_radar", required: true, fields: ["body"] },
    ]
  },
  {
    catalogId: "GER-013",
    messageKey: "dashboard.cards.due_soon",
    channel: "Card de alerta na visão geral",
    previewRenderer: "dashboard_alert",
    category: "Aba Geral / alertas",
    flow: "Cartões",
    purpose: "Vencimento em até 2 dias",
    defaultTitle: "Vencimento em até 2 dias",
    defaultBody: "{descricao_radar}",
    variables: [
      { name: "descricao_radar", required: true, fields: ["body"] },
    ]
  },
  {
    catalogId: "GER-014",
    messageKey: "dashboard.shared_debt.rejections_pending",
    channel: "Card de alerta na visão geral",
    previewRenderer: "dashboard_alert",
    category: "Aba Geral / alertas",
    flow: "Acertos compartilhados",
    purpose: "Recusas aguardando decisão do remetente",
    defaultTitle: "Rejeições aguardando sua decisão",
    defaultBody: "{n_recusas} ainda aguarda(m) sua decisão para encerrar ou contestar.",
    variables: [
      { name: "n_recusas", required: true, fields: ["body"] },
    ]
  },
  {
    catalogId: "GER-015",
    messageKey: "dashboard.shared_debt.payments_pending",
    channel: "Card de alerta na visão geral",
    previewRenderer: "dashboard_alert",
    category: "Aba Geral / alertas",
    flow: "Confirmação de pagamento",
    purpose: "Pagamentos aguardando confirmação final",
    defaultTitle: "Pagamentos aguardando sua confirmação",
    defaultBody: "{n_pagamentos} já foi/foram marcado(s) como feito(s) e está/estão esperando seu ok final. [{dica_pix_mes}]",
    variables: [
      { name: "n_pagamentos", required: true, fields: ["body"] },
      { name: "dica_pix_mes", required: false, fields: ["body"] },
    ]
  },
  {
    catalogId: "GER-016",
    messageKey: "dashboard.monthly_pix.pending_confirmation",
    channel: "Card de alerta na visão geral",
    previewRenderer: "dashboard_alert",
    category: "Aba Geral / alertas",
    flow: "Confirmação de pagamento",
    purpose: "Somente Pix do mês aguardando ok",
    defaultTitle: "Pix do mês aguardando seu ok",
    defaultBody: "{n_pix_mes} já foi/foram avisado(s) e está/estão esperando sua confirmação na carteira mensal.",
    variables: [
      { name: "n_pix_mes", required: true, fields: ["body"] },
    ]
  },
  {
    catalogId: "GER-017",
    messageKey: "dashboard.month.unassigned",
    channel: "Card de alerta na visão geral",
    previewRenderer: "dashboard_alert",
    category: "Aba Geral / alertas",
    flow: "Distribuição das compras",
    purpose: "Itens sem distribuição",
    defaultTitle: "Itens sem distribuição",
    defaultBody: "{n_itens} deste mês ainda não foi/foram dividido(s) entre as pessoas.",
    variables: [
      { name: "n_itens", required: true, fields: ["body"] },
    ]
  },
  {
    catalogId: "GER-018",
    messageKey: "dashboard.cards.overdue",
    channel: "Card de alerta na visão geral",
    previewRenderer: "dashboard_alert",
    category: "Aba Geral / alertas",
    flow: "Cartões",
    purpose: "Fatura vencida com pendência",
    defaultTitle: "{titulo_radar}",
    defaultBody: "{descricao_radar}",
    variables: [
      { name: "titulo_radar", required: true, fields: ["title"] },
      { name: "descricao_radar", required: true, fields: ["body"] },
    ]
  }
];

const MESSAGE_CATALOG = [...BASE_MESSAGE_CATALOG, ...ADDITIONAL_MESSAGE_CATALOG];

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

  db.exec(`
    CREATE TABLE IF NOT EXISTS message_template_import_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      created_by_user_id INTEGER,
      source_filename TEXT,
      total_rows INTEGER NOT NULL DEFAULT 0,
      changed_rows INTEGER NOT NULL DEFAULT 0,
      unchanged_rows INTEGER NOT NULL DEFAULT 0,
      error_rows INTEGER NOT NULL DEFAULT 0,
      summary_json TEXT,
      FOREIGN KEY (created_by_user_id) REFERENCES users(id)
    )
  `);

  const historyColumns = db.prepare(`PRAGMA table_info(message_template_history)`).all().map((row) => row.name);
  if (!historyColumns.includes('import_batch_id')) {
    db.exec(`ALTER TABLE message_template_history ADD COLUMN import_batch_id INTEGER REFERENCES message_template_import_batches(id)`);
  }

  db.exec(`CREATE INDEX IF NOT EXISTS idx_message_templates_category ON message_templates(category, channel, catalog_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_message_templates_updated_at ON message_templates(updated_at DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_message_template_history_message_key ON message_template_history(message_key, changed_at DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_message_template_history_batch ON message_template_history(import_batch_id, changed_at DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_message_template_import_batches_created_at ON message_template_import_batches(created_at DESC)`);
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
