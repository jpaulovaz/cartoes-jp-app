const { parse } = require("csv-parse/sync");

// Espera cabeçalho: Cartão;Data;Descrição;Valor
function parseInterCSV(buffer) {
  const text = buffer.toString("utf-8");
  const records = parse(text, {
    columns: true,
    delimiter: ";",
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
    trim: true
  });

  const txns = [];
  for (const r of records) {
    const cardNumber = (r["Cartão"] || r["Cartao"] || "").toString().trim() || null;
    const date = (r["Data"] || "").trim();
    const description = (r["Descrição"] || r["Descricao"] || "").trim() || "(sem descrição)";
    const valorRaw = (r["Valor"] || "").toString().trim();

    const cleaned = valorRaw
      .replace(/\s+/g, "")
      .replace(".", "")
      .replace(",", ".")
      .replace(/^\+/, "");
    const amount = Number(cleaned);
    if (Number.isNaN(amount)) continue;

    txns.push({
      card_number: cardNumber,
      txn_date: date || null,
      description,
      amount_cents: Math.round(amount * 100),
      raw: r
    });
  }
  return txns;
}

module.exports = { parseInterCSV };
