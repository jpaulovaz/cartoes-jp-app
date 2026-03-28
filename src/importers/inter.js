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

function buildColumnIndex(header) {
  return {
    card: header.findIndex((h) => ["cartao", "cartão", "cartao final", "cartao numero"].includes(h)),
    date: header.findIndex((h) => ["data", "data compra", "data da compra"].includes(h)),
    description: header.findIndex((h) => ["descricao", "descrição", "historico", "histórico", "estabelecimento"].includes(h)),
    value: header.findIndex((h) => ["valor", "valor final", "valor da compra"].includes(h))
  };
}

function getDecodePenalty(text) {
  const replacementCount = (String(text || "").match(/\uFFFD/g) || []).length;
  const controlCount = (String(text || "").match(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g) || []).length;
  return (replacementCount * 10) + controlCount;
}

function decodeCsvBuffer(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    return {
      chosenRecords: parseSemicolonCsv(String(buffer || "")),
      fallbackRecords: [],
      header: [],
      columnIndex: buildColumnIndex([])
    };
  }

  const utf8Text = buffer.toString("utf8");
  const latin1Text = buffer.toString("latin1");
  const utf8Records = parseSemicolonCsv(utf8Text);
  const latin1Records = parseSemicolonCsv(latin1Text);
  const utf8Header = (utf8Records[0] || []).map(normalizeHeader);
  const latin1Header = (latin1Records[0] || []).map(normalizeHeader);
  const utf8Columns = buildColumnIndex(utf8Header);
  const latin1Columns = buildColumnIndex(latin1Header);
  const utf8Score = Object.values(utf8Columns).filter((idx) => idx !== -1).length;
  const latin1Score = Object.values(latin1Columns).filter((idx) => idx !== -1).length;

  if (utf8Score > latin1Score) {
    return {
      chosenRecords: utf8Records,
      fallbackRecords: latin1Records,
      header: utf8Header,
      columnIndex: utf8Columns
    };
  }

  if (latin1Score > utf8Score) {
    return {
      chosenRecords: latin1Records,
      fallbackRecords: utf8Records,
      header: latin1Header,
      columnIndex: latin1Columns
    };
  }

  const utf8Penalty = getDecodePenalty(utf8Text);
  const latin1Penalty = getDecodePenalty(latin1Text);
  if (latin1Penalty < utf8Penalty) {
    return {
      chosenRecords: latin1Records,
      fallbackRecords: utf8Records,
      header: latin1Header,
      columnIndex: latin1Columns
    };
  }

  return {
    chosenRecords: utf8Records,
    fallbackRecords: latin1Records,
    header: utf8Header,
    columnIndex: utf8Columns
  };
}

function pickField(row, fallbackRow, index) {
  const primary = index >= 0 && index < row.length ? row[index] : "";
  const fallback = index >= 0 && fallbackRow && index < fallbackRow.length ? fallbackRow[index] : "";

  if (String(primary || "").includes("\uFFFD") && !String(fallback || "").includes("\uFFFD")) {
    return fallback;
  }

  return primary;
}

// Espera cabeçalho: Cartão;Data;Descrição;Valor
function parseInterCSV(buffer) {
  const { chosenRecords, fallbackRecords, header, columnIndex } = decodeCsvBuffer(buffer);
  const records = chosenRecords;

  if (!records.length) {
    throw new Error("O CSV está vazio ou não segue o formato esperado.");
  }

  if (columnIndex.date === -1 || columnIndex.description === -1 || columnIndex.value === -1) {
    throw new Error("Formato de CSV não reconhecido. Use o arquivo modelo como referência.");
  }

  const txns = [];
  records.slice(1).forEach((row, rowIndex) => {
    const fallbackRow = fallbackRecords[rowIndex + 1] || [];

    const cardNumber = String(pickField(row, fallbackRow, columnIndex.card) || "").trim() || null;
    const date = String(pickField(row, fallbackRow, columnIndex.date) || "").trim();
    const description = String(pickField(row, fallbackRow, columnIndex.description) || "").trim() || "(sem descrição)";
    const valorRaw = String(pickField(row, fallbackRow, columnIndex.value) || "").trim();

    const cleaned = valorRaw
      .replace(/\s+/g, "")
      .replace(/R\$/gi, "")
      .replace(/\./g, "")
      .replace(/,/g, ".")
      .replace(/^\+/, "")
      .replace(/^\((.*)\)$/, "-$1")
      .replace(/[–—−]/g, "-");

    const amount = Number(cleaned);
    if (!date || Number.isNaN(amount)) return;

    txns.push({
      card_number: cardNumber,
      txn_date: date,
      description,
      amount_cents: Math.round(amount * 100),
      raw: Object.fromEntries(header.map((key, index) => [key || `col_${index + 1}`, pickField(row, fallbackRow, index) ?? ""]))
    });
  });

  if (!txns.length) {
    throw new Error("Não foi possível ler lançamentos válidos no CSV. Use o arquivo modelo como referência.");
  }

  return txns;
}

module.exports = { parseInterCSV };
