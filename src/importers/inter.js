function decodeCsvBuffer(buffer) {
  const utf8 = buffer.toString("utf8");
  const latin1 = buffer.toString("latin1");

  const score = (text) => {
    const replacementCount = (text.match(/\uFFFD/g) || []).length;
    const controlCount = (text.match(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g) || []).length;
    return (replacementCount * 10) + controlCount;
  };

  return score(latin1) < score(utf8) ? latin1 : utf8;
}

function normalizeHeader(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function parseSemicolonCsv(text) {
  const normalized = String(text || "")
    .replace(/^\uFEFF/, "")
    .replace(/\u0000/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");

  const records = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let justClosedQuote = false;

  for (let i = 0; i < normalized.length; i += 1) {
    const ch = normalized[i];

    if (inQuotes) {
      if (ch === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
          justClosedQuote = true;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (justClosedQuote) {
      if (ch === ';') {
        row.push(field);
        field = "";
        justClosedQuote = false;
        continue;
      }
      if (ch === '\n') {
        row.push(field);
        if (row.some((cell) => String(cell || "").trim() !== "")) records.push(row);
        row = [];
        field = "";
        justClosedQuote = false;
        continue;
      }
      if (/^[ \t\u00A0]$/.test(ch)) {
        continue;
      }
      field += ch;
      justClosedQuote = false;
      continue;
    }

    if (ch === ';') {
      row.push(field);
      field = "";
      continue;
    }

    if (ch === '\n') {
      row.push(field);
      if (row.some((cell) => String(cell || "").trim() !== "")) records.push(row);
      row = [];
      field = "";
      continue;
    }

    if (ch === '"' && field.trim() === "") {
      field = "";
      inQuotes = true;
      continue;
    }

    field += ch;
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.some((cell) => String(cell || "").trim() !== "")) records.push(row);
  }

  if (records.length > 0 && /^sep=.$/i.test(String(records[0][0] || "").trim())) {
    records.shift();
  }

  return records;
}

// Espera cabeçalho: Cartão;Data;Descrição;Valor
function parseInterCSV(buffer) {
  const text = decodeCsvBuffer(buffer);
  const records = parseSemicolonCsv(text);

  if (!records.length) {
    throw new Error("O CSV está vazio ou não segue o formato esperado.");
  }

  const header = records[0].map(normalizeHeader);
  const columnIndex = {
    card: header.findIndex((h) => ["cartao", "cartão", "cartao final", "cartao numero"].includes(h)),
    date: header.findIndex((h) => ["data", "data compra", "data da compra"].includes(h)),
    description: header.findIndex((h) => ["descricao", "descrição", "historico", "histórico", "estabelecimento"].includes(h)),
    value: header.findIndex((h) => ["valor", "valor final", "valor da compra"].includes(h))
  };

  if (columnIndex.date === -1 || columnIndex.description === -1 || columnIndex.value === -1) {
    throw new Error("Formato de CSV não reconhecido. Use o arquivo modelo como referência.");
  }

  const txns = [];
  for (const row of records.slice(1)) {
    const get = (idx) => (idx >= 0 && idx < row.length ? row[idx] : "");

    const cardNumber = String(get(columnIndex.card) || "").trim() || null;
    const date = String(get(columnIndex.date) || "").trim();
    const description = String(get(columnIndex.description) || "").trim() || "(sem descrição)";
    const valorRaw = String(get(columnIndex.value) || "").trim();

    const cleaned = valorRaw
      .replace(/\s+/g, "")
      .replace(/R\$/gi, "")
      .replace(/\./g, "")
      .replace(/,/g, ".")
      .replace(/^\+/, "")
      .replace(/^\((.*)\)$/, "-$1")
      .replace(/[–—−]/g, "-");

    const amount = Number(cleaned);
    if (!date || Number.isNaN(amount)) continue;

    txns.push({
      card_number: cardNumber,
      txn_date: date,
      description,
      amount_cents: Math.round(amount * 100),
      raw: Object.fromEntries(header.map((key, index) => [key || `col_${index + 1}`, row[index] ?? ""]))
    });
  }

  if (!txns.length) {
    throw new Error("Não foi possível ler lançamentos válidos no CSV. Use o arquivo modelo como referência.");
  }

  return txns;
}

module.exports = { parseInterCSV };
