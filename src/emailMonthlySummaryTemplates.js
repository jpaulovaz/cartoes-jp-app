const { formatBRLFromCents } = require('./utils');

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toSafeNumber(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function monthLongLabel(month, year) {
  try {
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
    const label = date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    return label.charAt(0).toUpperCase() + label.slice(1);
  } catch (error) {
    return `${String(month).padStart(2, '0')}/${year}`;
  }
}

function shortMonthLabel(month, year) {
  return `${String(month).padStart(2, '0')}/${year}`;
}

function formatDateBR(value) {
  const raw = String(value || '').trim();
  if (!raw) return '-';
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  return raw;
}

function formatPct(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '-';
  return `${Math.round(parsed)}%`;
}

function summarizeCards(cardsPanel = []) {
  const cards = Array.isArray(cardsPanel) ? cardsPanel : [];
  const totalCents = cards.reduce((acc, item) => acc + toSafeNumber(item.total_cents), 0);
  const paidCents = cards.reduce((acc, item) => acc + toSafeNumber(item.paid_cents), 0);
  return {
    totalCents,
    paidCents,
    remainingCents: Math.max(0, totalCents - paidCents),
    count: cards.length
  };
}

function summarizePeople(personPanel = []) {
  const people = Array.isArray(personPanel) ? personPanel : [];
  const totalCents = people.reduce((acc, item) => acc + toSafeNumber(item.total_cents), 0);
  const paidCents = people.reduce((acc, item) => acc + toSafeNumber(item.paid_cents), 0);
  return {
    totalCents,
    paidCents,
    remainingCents: Math.max(0, totalCents - paidCents),
    count: people.length
  };
}

function buildKpiCard(label, value, caption) {
  return `<td style="width:50%;padding:6px;vertical-align:top;">
    <div style="min-height:96px;border:1px solid #e2e8f0;border-radius:18px;background:#f8fafc;padding:16px;">
      <div style="font-size:11px;line-height:1.25;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:.08em;">${escapeHtml(label)}</div>
      <div style="margin-top:8px;font-size:22px;line-height:1.12;font-weight:900;color:#0f172a;">${escapeHtml(value)}</div>
      <div style="margin-top:7px;font-size:12px;line-height:1.5;color:#64748b;">${escapeHtml(caption || '')}</div>
    </div>
  </td>`;
}

function buildKpiGrid(cards = []) {
  const safeCards = Array.isArray(cards) ? cards : [];
  const rows = [];
  for (let index = 0; index < safeCards.length; index += 2) {
    rows.push(`<tr>${safeCards[index] || '<td style="width:50%;padding:6px;"></td>'}${safeCards[index + 1] || '<td style="width:50%;padding:6px;"></td>'}</tr>`);
  }
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 -6px;width:calc(100% + 12px);">${rows.join('')}</table>`;
}

function renderSection(title, subtitle, bodyHtml) {
  if (!String(bodyHtml || '').trim()) return '';
  return `<section style="margin-top:22px;padding-top:22px;border-top:1px solid #e2e8f0;">
    <h2 style="margin:0;color:#0f172a;font-size:20px;line-height:1.25;font-weight:900;">${escapeHtml(title)}</h2>
    ${subtitle ? `<p style="margin:6px 0 0;color:#64748b;font-size:13px;line-height:1.6;">${escapeHtml(subtitle)}</p>` : ''}
    <div style="margin-top:14px;">${bodyHtml}</div>
  </section>`;
}

function renderSimpleTable(headers = [], rows = []) {
  const safeRows = Array.isArray(rows) ? rows : [];
  if (!safeRows.length) {
    return `<div style="border:1px dashed #cbd5e1;border-radius:16px;padding:14px;color:#64748b;font-size:13px;line-height:1.6;background:#f8fafc;">Nada para listar nesse bloco por enquanto. O radar esta limpo.</div>`;
  }

  const headerHtml = headers.map((header) => `<th align="left" style="padding:10px 8px;border-bottom:1px solid #e2e8f0;color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:.08em;">${escapeHtml(header)}</th>`).join('');
  const bodyHtml = safeRows.map((row) => `<tr>${row.map((cell) => `<td style="padding:10px 8px;border-bottom:1px solid #f1f5f9;color:#0f172a;font-size:13px;line-height:1.45;vertical-align:top;">${escapeHtml(cell)}</td>`).join('')}</tr>`).join('');
  return `<div style="overflow:hidden;border:1px solid #e2e8f0;border-radius:16px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;background:#ffffff;">
      <thead><tr style="background:#f8fafc;">${headerHtml}</tr></thead>
      <tbody>${bodyHtml}</tbody>
    </table>
  </div>`;
}

function renderBarList(items = [], { emptyText = 'Sem dados suficientes para desenhar barras por aqui.' } = {}) {
  const safeItems = (Array.isArray(items) ? items : [])
    .filter((item) => toSafeNumber(item.total_cents) > 0)
    .slice(0, 5);
  if (!safeItems.length) {
    return `<div style="border:1px dashed #cbd5e1;border-radius:16px;padding:14px;color:#64748b;font-size:13px;line-height:1.6;background:#f8fafc;">${escapeHtml(emptyText)}</div>`;
  }
  const maxCents = safeItems.reduce((best, item) => Math.max(best, toSafeNumber(item.total_cents)), 0);
  return safeItems.map((item, index) => {
    const width = maxCents > 0 ? Math.max(8, Math.round((toSafeNumber(item.total_cents) / maxCents) * 100)) : 8;
    const label = item.label || item.name || `Item ${index + 1}`;
    const share = Number.isFinite(Number(item.share_pct)) ? ` - ${formatPct(item.share_pct)}` : '';
    return `<div style="margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;gap:12px;margin-bottom:6px;font-size:13px;line-height:1.4;color:#0f172a;font-weight:800;">
        <span>${escapeHtml(label)}</span>
        <span>${escapeHtml(formatBRLFromCents(item.total_cents))}${escapeHtml(share)}</span>
      </div>
      <div style="height:10px;border-radius:999px;background:#e2e8f0;overflow:hidden;">
        <div style="height:10px;border-radius:999px;background:#2563eb;width:${width}%;"></div>
      </div>
    </div>`;
  }).join('');
}

function buildTextLines(title, rows = []) {
  const safeRows = Array.isArray(rows) ? rows.filter(Boolean) : [];
  if (!safeRows.length) return [];
  return ['', title, ...safeRows];
}

function buildMonthlySummaryEmailTemplate({ viewModel = {}, sections = {}, attachments = {}, recipientName = '', appUrl = '', analyticsUrl = '', generatedAt = new Date(), csvMeta = null } = {}) {
  const month = Number(viewModel.month || 0);
  const year = Number(viewModel.year || 0);
  const monthLabel = monthLongLabel(month, year);
  const shortLabel = shortMonthLabel(month, year);
  const cardsSummary = summarizeCards(viewModel.cardsPanel);
  const peopleSummary = summarizePeople(viewModel.personPanel);
  const analytics = viewModel.analyticsCharts || {};
  const financeAnalytics = viewModel.financeAnalytics || {};
  const financeTotals = financeAnalytics.totals || {};
  const kpis = analytics.kpis || {};
  const sharedSummary = viewModel.sharedPurchaseProjectionSummary || analytics.sharedAccepted || {};
  const sharedRowsSource = Array.isArray(viewModel.sharedPurchaseProjectionRows)
    ? viewModel.sharedPurchaseProjectionRows
    : (Array.isArray(sharedSummary.rows) ? sharedSummary.rows : (Array.isArray(sharedSummary.topRows) ? sharedSummary.topRows : []));
  const sharedAcceptedCents = toSafeNumber(sharedSummary.totalCents || sharedSummary.total_cents || kpis.sharedAcceptedCents);
  const sharedConfirmedPaidCents = toSafeNumber(sharedSummary.confirmedPaidCents || kpis.sharedConfirmedPaidCents);
  const sharedPendingReportedCents = toSafeNumber(sharedSummary.pendingReportedCents || kpis.sharedPendingReportedCents);
  const sharedOpenSource = sharedSummary.openCents !== undefined && sharedSummary.openCents !== null ? sharedSummary.openCents : (sharedSummary.remainingCents || kpis.sharedRemainingCents);
  const sharedOpenCents = toSafeNumber(sharedOpenSource);
  const hasSharedAccepted = sharedRowsSource.length > 0 || sharedAcceptedCents > 0;
  const personalSpentCents = toSafeNumber(kpis.totalSpentCents);
  const personalPaidCents = toSafeNumber(kpis.totalPaidCardsCents);
  const personalRemainingCents = toSafeNumber(kpis.totalRemainingCardsCents);
  const ownCardSpentCents = toSafeNumber(kpis.ownCardSpentCents || Math.max(0, personalSpentCents - sharedAcceptedCents));
  const ownPaidCardsCents = toSafeNumber(kpis.ownPaidCardsCents || Math.max(0, personalPaidCents - sharedConfirmedPaidCents));
  const outsideExpenseCents = toSafeNumber(financeTotals.expenseCents);
  const incomeCents = toSafeNumber(financeTotals.incomeCents);
  const estimatedNetCents = incomeCents - outsideExpenseCents - personalSpentCents;
  const statusLabel = viewModel.isClosed ? 'Mes fechado' : 'Mes aberto';
  const safeRecipientName = String(recipientName || '').trim();
  const headingName = safeRecipientName ? `Oi, ${safeRecipientName}!` : 'Oi!';
  const subject = `Seu resumo financeiro de ${shortLabel} chegou`;
  const preview = `O raio-x de ${shortLabel} esta pronto: totais, cartoes, categorias e CSV se voce pediu.`;
  const generatedAtLabel = generatedAt instanceof Date && !Number.isNaN(generatedAt.getTime())
    ? generatedAt.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
    : '';

  const enabledSections = {
    overview: sections.overview !== false,
    cards: sections.cards !== false,
    analytics: sections.analytics !== false,
    financeFlow: sections.financeFlow !== false,
    people: sections.people !== false,
    sharedAccepted: sections.sharedAccepted !== false
  };

  const introCardItems = [
    buildKpiCard('Cartoes no mes', formatBRLFromCents(cardsSummary.totalCents), `${cardsSummary.count} cartao(oes) proprio(s) no radar`),
    buildKpiCard('Ja pago', formatBRLFromCents(cardsSummary.paidCents + sharedConfirmedPaidCents), `${formatBRLFromCents(cardsSummary.remainingCents + sharedOpenCents)} ainda falta`),
    buildKpiCard('Meu mes', formatBRLFromCents(personalSpentCents), `${formatBRLFromCents(personalRemainingCents)} pendente para voce`),
    buildKpiCard('Saldo previsto', formatBRLFromCents(estimatedNetCents), `${statusLabel} - entradas menos saidas mapeadas`)
  ];
  if (hasSharedAccepted) {
    introCardItems.splice(1, 0, buildKpiCard('Compartilhadas aceitas', formatBRLFromCents(sharedAcceptedCents), `${Number(sharedSummary.count || sharedRowsSource.length || 0)} recebida(s) de amigos`));
  }
  const introCards = buildKpiGrid(introCardItems);

  const overviewHtml = enabledSections.overview ? renderSection(
    'Retrato do mes',
    'Um resumo executivo para bater o olho antes de encarar a planilha.',
    `${introCards}
    <div style="margin-top:14px;padding:14px;border-radius:16px;background:#eff6ff;border:1px solid #bfdbfe;color:#1e3a8a;font-size:13px;line-height:1.6;">
      ${escapeHtml(csvMeta && attachments.transactionsCsv ? `CSV anexado com ${csvMeta.rowCount} linha(s).` : 'CSV nao foi anexado neste envio.')}
      ${analyticsUrl ? ` <a href="${escapeHtml(analyticsUrl)}" style="color:#1d4ed8;font-weight:900;text-decoration:none;">Abrir analises no app</a>` : ''}
    </div>`
  ) : '';

  const cardRows = (Array.isArray(viewModel.cardsPanel) ? viewModel.cardsPanel : [])
    .filter((item) => toSafeNumber(item.total_cents) > 0 || toSafeNumber(item.paid_cents) > 0)
    .slice(0, 8)
    .map((item) => [
      item.card_name || 'Cartao',
      formatBRLFromCents(item.total_cents),
      formatBRLFromCents(item.paid_cents),
      formatBRLFromCents(Math.max(0, toSafeNumber(item.total_cents) - toSafeNumber(item.paid_cents))),
      formatDateBR(item.due_date)
    ]);
  const cardsHtml = enabledSections.cards ? renderSection(
    'Compras por cartao',
    'Total, o que ja saiu e o que ainda esta na fila de cada cartao.',
    renderSimpleTable(['Cartao', 'Total', 'Pago', 'Falta', 'Vencimento'], cardRows)
  ) : '';

  const sharedRows = sharedRowsSource.slice()
    .sort((a, b) => toSafeNumber(b.amountCents || b.totalCents) - toSafeNumber(a.amountCents || a.totalCents))
    .slice(0, 8)
    .map((item) => [
      item.description || 'Compra compartilhada',
      item.requesterName || 'Amigo',
      formatBRLFromCents(item.amountCents || item.totalCents),
      formatBRLFromCents(item.confirmedPaidCents || item.paidCents),
      formatBRLFromCents(item.pendingReportedCents),
      formatBRLFromCents(item.openCents !== undefined && item.openCents !== null ? item.openCents : item.remainingCents),
      item.statusLabel || 'Aceita'
    ]);
  const sharedSummaryCards = buildKpiGrid([
    buildKpiCard('Total aceito', formatBRLFromCents(sharedAcceptedCents), `${Number(sharedSummary.count || sharedRowsSource.length || 0)} item(ns) no mes`),
    buildKpiCard('Pago confirmado', formatBRLFromCents(sharedConfirmedPaidCents), 'Confirmado na Central de Acertos'),
    buildKpiCard('Em conferencia', formatBRLFromCents(sharedPendingReportedCents), 'Informado e aguardando confirmacao'),
    buildKpiCard('Ainda falta', formatBRLFromCents(sharedOpenCents), 'Saldo ainda em aberto')
  ]);
  const sharedHtml = enabledSections.sharedAccepted && hasSharedAccepted ? renderSection(
    'Compras compartilhadas aceitas',
    'Entraram no seu mes e continuam acompanhadas pela Central de Acertos.',
    `${sharedSummaryCards}<div style="margin-top:14px;">${renderSimpleTable(['Compra', 'Enviado por', 'Valor', 'Pago', 'Em conferencia', 'Falta', 'Status'], sharedRows)}</div>`
  ) : '';

  const categoryHtml = renderBarList(analytics.categories || [], { emptyText: 'Ainda nao tem categorias suficientes nesse mes.' });
  const topMerchant = analytics.insights && analytics.insights.topMerchant ? analytics.insights.topMerchant : null;
  const merchantHtml = topMerchant
    ? `<div style="margin-top:14px;border:1px solid #e2e8f0;border-radius:16px;padding:14px;background:#f8fafc;color:#0f172a;font-size:13px;line-height:1.6;"><strong>Estabelecimento destaque:</strong> ${escapeHtml(topMerchant.label || 'Sem nome')} com ${escapeHtml(formatBRLFromCents(topMerchant.total_cents))} em ${escapeHtml(topMerchant.txn_count || 0)} compra(s).</div>`
    : `<div style="margin-top:14px;border:1px dashed #cbd5e1;border-radius:16px;padding:14px;background:#f8fafc;color:#64748b;font-size:13px;line-height:1.6;">Sem estabelecimento campeao ainda. Talvez seja ate uma boa noticia.</div>`;
  const trendRows = (Array.isArray(analytics.monthlyTrend) ? analytics.monthlyTrend : [])
    .slice(-5)
    .map((point) => [point.label || shortMonthLabel(point.month, point.year), formatBRLFromCents(point.total_cents), point.is_current ? 'Mes atual' : 'Historico']);
  const analyticsHtml = enabledSections.analytics ? renderSection(
    'Meu pedaco, categorias e graficos',
    'Versao de email dos graficos: barras simples, ranking e tendencia em texto.',
    `${categoryHtml}${merchantHtml}<div style="margin-top:14px;">${renderSimpleTable(['Mes', 'Meu pedaco', 'Status'], trendRows)}</div>`
  ) : '';

  const flowRows = [
    ['Entradas do mes', formatBRLFromCents(incomeCents), `${toSafeNumber(financeTotals.incomeRowCount)} item(ns)`],
    ['Saidas fora do cartao', formatBRLFromCents(outsideExpenseCents), `${toSafeNumber(financeTotals.expenseRowCount)} item(ns)`],
    ['Cartoes - meu pedaco', formatBRLFromCents(ownCardSpentCents), `${formatBRLFromCents(ownPaidCardsCents)} ja pago`],
    ...(hasSharedAccepted ? [['Compartilhadas aceitas', formatBRLFromCents(sharedAcceptedCents), `${formatBRLFromCents(sharedConfirmedPaidCents)} pago confirmado`]] : []),
    ['Saldo previsto', formatBRLFromCents(estimatedNetCents), estimatedNetCents >= 0 ? 'Ficou no azul' : 'Pediu freio de mao']
  ];
  const financeHtml = enabledSections.financeFlow ? renderSection(
    'Entradas e saidas fora do cartao',
    'Para enxergar o mes sem deixar as despesas avulsas no ponto cego.',
    renderSimpleTable(['Bloco', 'Valor', 'Nota'], flowRows)
  ) : '';

  const peopleRows = (Array.isArray(viewModel.personPanel) ? viewModel.personPanel : [])
    .filter((item) => toSafeNumber(item.total_cents) > 0 || toSafeNumber(item.paid_cents) > 0)
    .slice(0, 10)
    .map((item) => [
      item.person_name || 'Pessoa',
      formatBRLFromCents(item.total_cents),
      formatBRLFromCents(item.paid_cents),
      formatBRLFromCents(Math.max(0, toSafeNumber(item.total_cents) - toSafeNumber(item.paid_cents)))
    ]);
  const peopleHtml = enabledSections.people ? renderSection(
    'Pessoas e acertos',
    'Como o resumo vai so para voce, esse bloco mostra o combinado da sua rede de despesas.',
    renderSimpleTable(['Pessoa', 'Total', 'Pago', 'Pendente'], peopleRows)
  ) : '';

  const ctaHtml = analyticsUrl
    ? `<a href="${escapeHtml(analyticsUrl)}" style="display:inline-block;margin-top:22px;padding:14px 20px;border-radius:16px;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:900;font-size:15px;">Abrir analises no AcerttaPay</a>`
    : '';
  const appLinkHtml = appUrl
    ? `<div style="margin-top:18px;color:#64748b;font-size:12px;line-height:1.6;word-break:break-all;">Link do app: ${escapeHtml(appUrl)}</div>`
    : '';

  const html = `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:24px;background:#f1f5f9;font-family:Inter,Segoe UI,Roboto,Arial,sans-serif;color:#0f172a;">
    <div style="max-width:680px;margin:0 auto;background:#ffffff;border-radius:28px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 20px 45px rgba(15,23,42,.08);">
      <div style="padding:28px 28px 20px;background:linear-gradient(135deg,#0f172a,#2563eb);color:#ffffff;">
        <div style="font-size:12px;font-weight:900;letter-spacing:.18em;text-transform:uppercase;opacity:.82;">Resumo financeiro mensal</div>
        <h1 style="margin:14px 0 0;font-size:30px;line-height:1.15;">${escapeHtml(headingName)}</h1>
        <p style="margin:12px 0 0;font-size:15px;line-height:1.65;color:#dbeafe;">Seu raio-x de ${escapeHtml(monthLabel)} chegou. Sem bronca, sem susto: so o mapa para decidir o proximo passo.</p>
      </div>
      <div style="padding:28px;">
        <div style="display:inline-block;border-radius:999px;background:#e0f2fe;color:#075985;padding:8px 12px;font-size:12px;font-weight:900;">${escapeHtml(statusLabel)} - gerado em ${escapeHtml(generatedAtLabel)}</div>
        ${overviewHtml}
        ${cardsHtml}
        ${sharedHtml}
        ${analyticsHtml}
        ${financeHtml}
        ${peopleHtml}
        ${ctaHtml}
        ${appLinkHtml}
        <p style="margin:24px 0 0;color:#64748b;font-size:12px;line-height:1.7;">Dica de bolso: se o email cair em Promocoes ou Spam, ele so foi passear. Marque como confiavel para o proximo resumo chegar mais rapido.</p>
      </div>
    </div>
  </body>
</html>`;

  const textLines = [
    headingName,
    `Seu resumo financeiro de ${monthLabel} chegou.`,
    `${statusLabel} - gerado em ${generatedAtLabel}`,
    ...buildTextLines('Retrato do mes', enabledSections.overview ? [
      `Cartoes proprios: ${formatBRLFromCents(cardsSummary.totalCents)}`,
      hasSharedAccepted ? `Compartilhadas aceitas: ${formatBRLFromCents(sharedAcceptedCents)}` : null,
      `Ja pago: ${formatBRLFromCents(cardsSummary.paidCents + sharedConfirmedPaidCents)}`,
      `Meu mes: ${formatBRLFromCents(personalSpentCents)}`,
      `Saldo previsto: ${formatBRLFromCents(estimatedNetCents)}`
    ] : []),
    ...buildTextLines('Cartoes', enabledSections.cards ? cardRows.map((row) => `${row[0]} - total ${row[1]}, pago ${row[2]}, falta ${row[3]}`) : []),
    ...buildTextLines('Compras compartilhadas aceitas', enabledSections.sharedAccepted && hasSharedAccepted ? sharedRows.map((row) => `${row[0]} - ${row[2]} enviado por ${row[1]}, pago ${row[3]}, falta ${row[5]} (${row[6]})`) : []),
    ...buildTextLines('Categorias', enabledSections.analytics ? (analytics.categories || []).slice(0, 5).map((item) => `${item.label}: ${formatBRLFromCents(item.total_cents)}`) : []),
    ...buildTextLines('Fluxo financeiro', enabledSections.financeFlow ? flowRows.map((row) => `${row[0]}: ${row[1]} (${row[2]})`) : []),
    ...buildTextLines('Pessoas e acertos', enabledSections.people ? peopleRows.map((row) => `${row[0]} - total ${row[1]}, pago ${row[2]}, pendente ${row[3]}`) : []),
    attachments.transactionsCsv && csvMeta ? '' : '',
    attachments.transactionsCsv && csvMeta ? `CSV anexado: ${csvMeta.filename} com ${csvMeta.rowCount} linha(s).` : '',
    analyticsUrl ? `Abrir analises: ${analyticsUrl}` : '',
    appUrl ? `Abrir app: ${appUrl}` : ''
  ].filter((line) => line !== false && line != null).join('\n');

  return {
    subject,
    preview,
    html,
    text: textLines,
    audit: {
      month,
      year,
      statusLabel,
      cardsTotalCents: cardsSummary.totalCents,
      personalSpentCents,
      sharedAcceptedCents,
      sharedAcceptedCount: Number(sharedSummary.count || sharedRowsSource.length || 0),
      csvAttached: !!(attachments.transactionsCsv && csvMeta),
      csvRowCount: csvMeta ? csvMeta.rowCount : 0,
      sections: enabledSections
    }
  };
}

module.exports = {
  buildMonthlySummaryEmailTemplate,
  monthLongLabel,
  shortMonthLabel
};
