const { formatBRLFromCents } = require('./utils');

function csvEscape(value) {
  const str = String(value == null ? '' : value);
  if (/[";\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function formatDateBR(dateStr) {
  const raw = String(dateStr || '').trim();
  if (!raw) return '-';
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
  return raw;
}

function monthLabel(month, year) {
  return `${String(month).padStart(2, '0')}/${year}`;
}

function buildMonthTransactionsCsv(rows = [], { month, year } = {}) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const safeMonth = Number(month || 0);
  const safeYear = Number(year || 0);
  const header = [
    'Data da compra',
    'Descri\u00e7\u00e3o',
    'Cart\u00e3o',
    'N\u00famero',
    'Valor (R$)',
    'Distribu\u00eddo',
    'Pessoas',
    'Divis\u00e3o detalhada',
    'Categoria',
    'Tipo de lan\u00e7amento',
    'Forma de compra',
    'Parcela',
    'Parcela atual',
    'Total de parcelas',
    'Compra base',
    'Fatura',
    'Origem',
    'Compet\u00eancia'
  ];
  const lines = [header.map(csvEscape).join(';')];

  safeRows.forEach((row) => {
    lines.push([
      formatDateBR(row.txn_date),
      row.description,
      row.card_name,
      row.card_number,
      formatBRLFromCents(row.amount_cents),
      row.allocated,
      row.people_names,
      row.allocation_details,
      row.purchase_category_name,
      row.entry_type,
      row.purchase_mode,
      row.installment_label,
      row.installment_position,
      row.installment_total,
      row.base_description,
      row.due_label,
      row.origem,
      monthLabel(safeMonth, safeYear)
    ].map(csvEscape).join(';'));
  });

  const filename = `acerttapay-cartoes-${safeYear}-${String(safeMonth).padStart(2, '0')}.csv`;
  const content = `\uFEFF${lines.join('\r\n')}`;
  return {
    filename,
    content,
    rowCount: safeRows.length,
    byteLength: Buffer.byteLength(content, 'utf8'),
    contentType: 'text/csv; charset=utf-8'
  };
}

module.exports = {
  buildMonthTransactionsCsv
};
