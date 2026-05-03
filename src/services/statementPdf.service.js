const axios = require('axios');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const repository = require('../repositories/statementPdf.repository');

const WORKER_STATE = {
  started: false,
  timer: null,
  processing: false,
  cleanupRuns: 0,
  deps: {}
};

const STATEMENT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['issuer', 'confidence', 'warnings', 'import_rows'],
  properties: {
    issuer: {
      type: 'string',
      enum: ['inter', 'itau', 'sams_club', 'carrefour', 'santander', 'caixa', 'nubank', 'unknown']
    },
    confidence: {
      type: 'string',
      enum: ['high', 'medium', 'low']
    },
    warnings: {
      type: 'array',
      description: 'Liste incertezas importantes em portugues do Brasil. Se nao houver alerta, devolva um array vazio.',
      items: {
        type: 'string',
        description: 'Frase curta em portugues do Brasil explicando a incerteza.'
      }
    },
    import_rows: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['date', 'description', 'amount'],
        properties: {
          date: {
            type: 'string',
            pattern: '^\\d{2}\\/\\d{2}\\/\\d{4}$'
          },
          description: { type: 'string' },
          amount: { type: ['number', 'string'] },
          card_last4: { type: ['string', 'null'] }
        }
      }
    }
  }
};


const INSTALLMENT_ENRICHMENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['warnings', 'rows'],
  properties: {
    warnings: {
      type: 'array',
      description: 'Liste incertezas importantes em portugues do Brasil. Se nao houver alerta, devolva um array vazio.',
      items: {
        type: 'string',
        description: 'Frase curta em portugues do Brasil explicando a incerteza.'
      }
    },
    rows: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['row_id', 'installment_detected'],
        properties: {
          row_id: { type: 'string' },
          installment_detected: { type: 'boolean' },
          installment_position: { type: ['integer', 'null'] },
          installment_total: { type: ['integer', 'null'] },
          base_description: { type: ['string', 'null'] },
          confidence: {
            type: ['string', 'null'],
            enum: ['high', 'medium', 'low', null]
          },
          pattern_kind: { type: ['string', 'null'] }
        }
      }
    }
  }
};

const MONTH_TOKEN_TO_NUMBER = {
  jan: '01', janeiro: '01', january: '01',
  fev: '02', fevereiro: '02', feb: '02', february: '02',
  mar: '03', marco: '03', março: '03', march: '03',
  abr: '04', abril: '04', apr: '04', april: '04',
  mai: '05', maio: '05', may: '05',
  jun: '06', junho: '06', june: '06',
  jul: '07', julho: '07', july: '07',
  ago: '08', agosto: '08', aug: '08', august: '08',
  set: '09', setembro: '09', sep: '09', sept: '09', september: '09',
  out: '10', outubro: '10', oct: '10', october: '10',
  nov: '11', novembro: '11', november: '11',
  dez: '12', dezembro: '12', dec: '12', december: '12'
};

function nowIso() {
  return repository.nowIso();
}

function safeJsonParse(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
}

function normalizeWhitespace(value) {
  return String(value || '')
    .replace(/\u0000/g, ' ')
    .replace(/[\t\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqueNormalizedTextList(values = []) {
  const seen = new Set();
  const result = [];
  values.forEach((value) => {
    const text = normalizeWhitespace(value);
    if (!text) return;
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push(text);
  });
  return result;
}

function normalizeDigits(value) {
  const digits = String(value || '').replace(/\D+/g, '');
  if (!digits) return null;
  return digits.slice(-4).padStart(4, '0');
}

function normalizeBrDate(value) {
  const rawText = String(value || '').trim();
  if (!rawText) return null;

  const text = rawText
    .replace(/[–—−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

  const brMatch = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (brMatch) {
    const day = brMatch[1].padStart(2, '0');
    const month = brMatch[2].padStart(2, '0');
    const year = brMatch[3];
    return `${day}/${month}/${year}`;
  }

  const isoMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    const year = isoMatch[1];
    const month = isoMatch[2].padStart(2, '0');
    const day = isoMatch[3].padStart(2, '0');
    return `${day}/${month}/${year}`;
  }

  const compactMonthText = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  const namedMonthMatch = compactMonthText.match(/^(\d{1,2})(?:\s+de)?\s+([a-z]+)(?:\s+de)?\s+(\d{4})$/i);
  if (namedMonthMatch) {
    const day = namedMonthMatch[1].padStart(2, '0');
    const month = MONTH_TOKEN_TO_NUMBER[namedMonthMatch[2]] || null;
    const year = namedMonthMatch[3];
    if (month) return `${day}/${month}/${year}`;
  }

  return null;
}

function parseBrDateParts(value) {
  const normalized = normalizeBrDate(value);
  if (!normalized) return null;
  const match = normalized.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  return {
    day: Number(match[1]),
    month: Number(match[2]),
    year: Number(match[3])
  };
}

function formatBrDateParts(parts) {
  const day = Number(parts?.day || 0);
  const month = Number(parts?.month || 0);
  const year = Number(parts?.year || 0);
  if (!day || !month || !year) return null;
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${String(year).padStart(4, '0')}`;
}

function shiftStatementMonth(month, year, offset) {
  const safeMonth = Number(month || 0);
  const safeYear = Number(year || 0);
  if (!safeMonth || !safeYear) return null;
  const anchor = new Date(Date.UTC(safeYear, safeMonth - 1 + Number(offset || 0), 1));
  if (Number.isNaN(anchor.getTime())) return null;
  return {
    month: anchor.getUTCMonth() + 1,
    year: anchor.getUTCFullYear()
  };
}

function inferInstallmentPurchaseYear({ statementMonth, statementYear, purchaseMonth, position }) {
  const safePurchaseMonth = Number(purchaseMonth || 0);
  const safePosition = Number(position || 0);
  if (!safePurchaseMonth || !safePosition) return null;

  const candidateOffsets = Array.from(new Set([
    Math.max(0, safePosition),
    Math.max(0, safePosition - 1)
  ]));

  for (const offset of candidateOffsets) {
    const candidate = shiftStatementMonth(statementMonth, statementYear, -offset);
    if (!candidate) continue;
    if (Number(candidate.month || 0) !== safePurchaseMonth) continue;
    return {
      year: Number(candidate.year || 0) || null,
      matchedOffset: offset
    };
  }

  return null;
}

function buildDateInferenceMetadata({ originalDate, adjustedDate, reason, strategy, installmentMeta = null, matchedOffset = null }) {
  const metadata = {
    original_date: originalDate,
    adjusted_date: adjustedDate,
    reason,
    strategy
  };
  if (installmentMeta) {
    metadata.installment = {
      position: Number(installmentMeta.position || 0) || null,
      total: Number(installmentMeta.total || 0) || null,
      label: installmentMeta.label || null
    };
  }
  if (matchedOffset != null) {
    metadata.matched_month_offset = Number(matchedOffset || 0);
  }
  return metadata;
}

function inferRowDateFromStatementContext(row, { statementMonth, statementYear, installmentMeta = null } = {}) {
  const parsed = parseBrDateParts(row?.date);
  if (!parsed) return null;

  const safeStatementMonth = Number(statementMonth || 0);
  const safeStatementYear = Number(statementYear || 0);
  if (!safeStatementMonth || !safeStatementYear) return null;

  let inferredYear = null;
  let reason = null;
  let strategy = null;
  let matchedOffset = null;

  if (installmentMeta && Number(installmentMeta.position || 0) > 0 && Number(installmentMeta.total || 0) > 1) {
    const installmentInference = inferInstallmentPurchaseYear({
      statementMonth: safeStatementMonth,
      statementYear: safeStatementYear,
      purchaseMonth: parsed.month,
      position: installmentMeta.position
    });
    if (installmentInference && Number(installmentInference.year || 0)) {
      inferredYear = Number(installmentInference.year || 0);
      matchedOffset = installmentInference.matchedOffset;
      reason = 'Ano reancorado pela parcela atual e pela competencia da fatura.';
      strategy = 'installment_position_alignment';
    }
  }

  if (inferredYear == null) {
    const rolloverYear = parsed.month > safeStatementMonth ? safeStatementYear - 1 : safeStatementYear;
    const looksFutureWithinStatementYear = parsed.year > safeStatementYear
      || (parsed.year === safeStatementYear && parsed.month > safeStatementMonth);
    if (looksFutureWithinStatementYear) {
      inferredYear = rolloverYear;
      reason = 'Ano reancorado porque a data extraida cairia no futuro em relacao a competencia da fatura.';
      strategy = installmentMeta ? 'generic_future_guard_for_installment' : 'generic_future_guard';
    }
  }

  if (inferredYear == null || inferredYear === parsed.year) return null;

  const adjustedDate = formatBrDateParts({
    day: parsed.day,
    month: parsed.month,
    year: inferredYear
  });
  if (!adjustedDate || adjustedDate === String(row?.date || '').trim()) return null;

  return {
    adjustedDate,
    metadata: buildDateInferenceMetadata({
      originalDate: row.date,
      adjustedDate,
      reason,
      strategy,
      installmentMeta,
      matchedOffset
    })
  };
}

function applyStatementDateInference(rows = [], { statementMonth, statementYear, enrichmentByRowId = null } = {}) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const enrichmentMap = enrichmentByRowId instanceof Map ? enrichmentByRowId : new Map();
  const adjustedRows = [];
  const adjustments = [];

  safeRows.forEach((row) => {
    const enrichmentEntry = enrichmentMap.get(row?.id) || null;
    const installmentMeta = enrichmentEntry?.meta || detectInstallmentMetaFromDescription(row?.description, row?.amountCents) || null;
    const inferred = inferRowDateFromStatementContext(row, {
      statementMonth,
      statementYear,
      installmentMeta
    });

    if (!inferred) {
      adjustedRows.push(row);
      return;
    }

    adjustedRows.push({
      ...row,
      date: inferred.adjustedDate,
      dateInference: inferred.metadata
    });
    adjustments.push({
      rowId: row.id,
      description: row.description,
      originalDate: row.date,
      adjustedDate: inferred.adjustedDate,
      strategy: inferred.metadata.strategy,
      installmentLabel: installmentMeta?.label || null
    });
  });

  return {
    rows: adjustedRows,
    adjustments,
    adjustedCount: adjustments.length
  };
}

function parseAmountToCents(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value * 100);
  }

  const text = String(value || '').trim();
  if (!text) return null;

  const normalized = text
    .replace(/R\$/gi, '')
    .replace(/\s+/g, '')
    .replace(/\./g, '')
    .replace(/,/g, '.')
    .replace(/^[–—−]/, '-')
    .replace(/^\+/, '+')
    .replace(/^\((.*)\)$/, '-$1');

  const amount = Number(normalized);
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount * 100);
}

function hasExplicitPlusSign(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  return /^\+\s*(?:R\$)?/i.test(text);
}

function hasStrongMerchantMarker(description) {
  const text = normalizeWhitespace(description)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  if (!text) return false;

  const ignoredTokens = new Set([
    'ajuste',
    'antecipado',
    'automatico',
    'banco',
    'caixa',
    'cartao',
    'cartoes',
    'compra',
    'compras',
    'cred',
    'credito',
    'csf',
    'da',
    'de',
    'debito',
    'do',
    'elo',
    'estorno',
    'fatura',
    'inter',
    'internet',
    'itau',
    'itaucard',
    'lancamento',
    'lancamentos',
    'mastercard',
    'na',
    'no',
    'obrigado',
    'pag',
    'pagamento',
    'pagto',
    'parcela',
    'parcelado',
    'parcelamento',
    'pelo',
    'pix',
    'reembolso',
    'rotativo',
    'santander',
    'servico',
    'valor',
    'via',
    'visa'
  ]);

  const merchantTokens = text
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .filter((token) => /[a-z]/.test(token) && token.length >= 4 && !ignoredTokens.has(token));

  if (!merchantTokens.length) return false;

  return /[*@/]/.test(text) || /\bvalor\s+antecipado\b/.test(text);
}

function isOwnStatementPayment(description) {
  const text = normalizeWhitespace(description).toLowerCase();
  if (!text) return false;
  if (hasStrongMerchantMarker(text)) return false;
  const patterns = [
    /^pag(?:to|amento)\s+de\s+fatura\b/,
    /^pag(?:to|amento)\s+fatura\b/,
    /^pagto\s+debito\s+automatico\b/,
    /^pagamento\s+de\s+fatura-?internet\b/,
    /^pagamento\s+de\s+fatura\s+via\s+pix\b/,
    /^pagamento\s+via\s+pix\b/,
    /^obrigado\s+pelo\s+pagamento\b/
  ];
  return patterns.some((pattern) => pattern.test(text));
}

function isCreditLikeDescription(description) {
  const text = normalizeWhitespace(description).toLowerCase();
  if (!text) return false;
  return /(estorno|credito|crédito|reembolso|ajuste\s+cred|ajuste\s+credito|valor\s+antecipado|pagto\s+debito\s+automatico|obrigado\s+pelo\s+pagamento)/i.test(text);
}

function formatCsvAmount(amountCents) {
  const signal = amountCents < 0 ? '-' : '';
  const absolute = Math.abs(Number(amountCents || 0));
  const integer = Math.trunc(absolute / 100);
  const cents = String(absolute % 100).padStart(2, '0');
  return `${signal}${integer},${cents}`;
}

function quoteCsvCell(value) {
  const text = String(value == null ? '' : value);
  if (!/[";\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function buildCsvCardLabel(cardName, cardLast4) {
  const digits = normalizeDigits(cardLast4);
  return digits ? `${cardName} (final ${digits})` : cardName;
}

function buildCsvFromRows(cardName, rows) {
  const lines = ['Cartão;Data;Descrição;Valor'];
  rows.forEach((row) => {
    lines.push([
      quoteCsvCell(buildCsvCardLabel(cardName, row.cardLast4)),
      quoteCsvCell(row.date),
      quoteCsvCell(row.description),
      quoteCsvCell(formatCsvAmount(row.amountCents))
    ].join(';'));
  });
  return `${lines.join('\n')}\n`;
}

function detectIssuerHint(text, filename = '') {
  const source = `${filename}\n${text}`.toLowerCase();
  if (/cartoes?\s+caixa|cartões?\s+caixa|app cartões caixa|obrigado pelo pagamento/.test(source)) return 'caixa';
  if (/santander|detalhamento da fatura|pagamento e demais créditos/.test(source)) return 'santander';
  if (/ita[uú]|lançamentos atuais|pagamento efetuado em/.test(source)) return 'itau';
  if (/sam's club|sams club|cart[aã]o sam's club/.test(source)) return 'sams_club';
  if (/carrefour|banco csf|cartaocarrefour/.test(source)) return 'carrefour';
  if (/mercado\s+pago|cartao de credito mercado pago|cartão de crédito mercado pago/.test(source)) return 'mercado_pago';
  if (/\bnubank\b|\bnu pagamentos\b/.test(source)) return 'nubank';
  if (/\bbanco\s+inter\b|\binter\s+loop\b|\bcart[aã]o\s+inter\b|\binter\s+(visa|mastercard|elo|black|gold|platinum)\b/.test(source)) return 'inter';
  return 'unknown';
}

function getIssuerSpecificInstructions(issuer) {
  const shared = [
    'Nunca deduza duplicidade dentro do mesmo PDF. Se a fatura repetir a mesma data, descrição e valor, preserve todas as ocorrências.',
    'Exclua apenas pagamento da própria fatura. Não exclua lojistas válidos só porque a descrição contém a palavra FATURA.',
    'Se uma linha datada trouxer nome claro de lojista ou estabelecimento, ela entra mesmo quando vier junto de expressões como VALOR ANTECIPADO. Exemplos de lojista válido: AMAZONMKTPLC*WFCOMERCI, UBER, IFOOD, CLARO.',
    'Quando houver conflito entre o rótulo de valor antecipado e uma descrição clara de lojista, preserve a linha do lojista. Só exclua o que for claramente pagamento da própria fatura.',
    'Compras normais costumam vir sem sinal. Crédito, estorno, reembolso e valor antecipado devem sair com amount negativo.',
    'Linhas com valor zero ficam fora.',
    'Microajustes datados, juros, IOF, anuidade, seguro, multa e tarifas datadas entram normalmente.'
  ];

  const issuerRules = {
    inter: [
      'No Inter, pagamento da própria fatura pode aparecer como PAGTO DEBITO AUTOMATICO com + R$. Exclua isso da importação.',
      'No Inter, créditos válidos de lojista também podem aparecer com + R$. Esses entram como amount negativo.',
      'No Inter, VALOR ANTECIPADO com nome de lojista é crédito válido do lojista e não deve ser excluído.',
      'PIX CRED PARCELADO é lançamento válido quando aparece datado no detalhamento.'
    ],
    itau: [
      'No Itaú, ignore saldo anterior, pagamento efetuado e resumos. Foque só nos lançamentos datados.',
      'Microajustes como -0,01 entram se estiverem datados.'
    ],
    santander: [
      'No Santander, a fatura pode estar em duas colunas e com vários cartões adicionais. Preserve o card_last4 quando aparecer.',
      'PAGAMENTO DE FATURA-INTERNET é pagamento da própria fatura e deve ser excluído.',
      'NET PGT*FATURA CLARO é lojista válido e deve entrar normalmente.'
    ],
    sams_club: [
      'No Sam\'s Club, pagamento de fatura via PIX deve ser excluído. Cartão virtual deve manter card_last4 quando aparecer.'
    ],
    carrefour: [
      'No Carrefour, pagamento de fatura via PIX deve ser excluído.',
      'Juros de rotativo e IOF datados entram normalmente.'
    ],
    nubank: [
      'No Nubank, desconsidere tudo que estiver na seção PAGAMENTOS E FINANCIAMENTOS.',
      'No Nubank, linhas como PAGAMENTO EM DD MON dentro de PAGAMENTOS E FINANCIAMENTOS representam pagamento da fatura anterior e devem ficar fora.',
      'No Nubank, SALDO RESTANTE DA FATURA ANTERIOR não é compra e deve ficar fora, mesmo quando vier datado ou repetido.',
      'No Nubank, foque nas linhas da seção TRANSAÇÕES DE ... A ... para montar import_rows.'
    ],
    caixa: [
      'Na Caixa, D significa débito normal e C significa crédito/estorno.',
      'OBRIGADO PELO PAGAMENTO é pagamento da própria fatura e deve ser excluído.',
      'AJUSTE CRED e microcréditos datados entram com amount negativo.'
    ]
  };

  return shared.concat(issuerRules[issuer] || []);
}

function buildExtractionPrompt({ issuerHint, cardName, month, year, text }) {
  const issuerLabel = issuerHint === 'unknown' ? 'desconhecido' : issuerHint;
  const rules = getIssuerSpecificInstructions(issuerHint)
    .map((line, index) => `${index + 1}. ${line}`)
    .join('\n');

  return [
    'Você é um extrator rigoroso de fatura de cartão brasileira.',
    'Converta o texto abaixo em um JSON estruturado no schema informado.',
    `Cartão selecionado no app: ${cardName}.`,
    `Competência escolhida no app: ${String(month).padStart(2, '0')}/${year}.`,
    `Emissor percebido: ${issuerLabel}.`,
    '',
    'Regras obrigatórias:',
    rules,
    '8. Só inclua linhas que tenham data explícita.',
    '9. A data deve vir obrigatoriamente no formato DD/MM/AAAA. Nunca devolva data textual como "12 de mar. 2026".',
    '10. Preserve a data original que aparece na fatura, inclusive em parcelas antigas.',
    '11. A descrição deve ser fiel ao lançamento, sem floreio. Pode limpar só espaços duplicados.',
    '12. card_last4 deve trazer apenas os 4 dígitos finais do cartão adicional/virtual quando essa informação estiver disponível. Caso contrário, null.',
    '13. amount deve ser numérico em reais, sem símbolo, com créditos/estornos negativos.',
    '14. Use confidence high quando estiver confiante, medium quando houver ruído e low quando houver muita incerteza.',
    '15. Use warnings para registrar qualquer incerteza importante; caso contrário, devolva um array vazio. Cada item desse array deve ser escrito em português do Brasil, com frase curta e clara.',
    '16. Não invente linhas para bater com o total da fatura.',
    '17. Se existir subtotal de despesas do mês ou lançamentos atuais, use isso como prova dos nove silenciosa, mas sem inventar itens.',
    '',
    'Texto extraído da fatura:',
    text
  ].join('\n');
}


function normalizeInstallmentBaseDescription(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\s*[\-–—:;/,]+$/g, '')
    .trim();
}

function stripTrailingInstallmentMarker(description) {
  const safe = String(description || '').replace(/\s+/g, ' ').trim();
  if (!safe) return '';

  let base = safe
    .replace(/\s*(?:[\-–—:;/,]\s*)?\(?\d{1,2}\s*\/\s*\d{1,2}\)?\s*$/i, '')
    .replace(/\s*(?:[\-–—:;/,]\s*)?(?:parc(?:ela)?\s*)?\d{1,2}\s*(?:de|\/)\s*\d{1,2}\)?\s*$/i, '')
    .replace(/\s*(?:[\-–—:;/,]\s*)?\(?\d{1,2}\s+de\s+\d{1,2}\)?\s*$/i, '')
    .replace(/\s*[()\-–—:;/,]+$/g, '')
    .trim();

  if (!base) {
    base = safe
      .replace(/\(?\d{1,2}\s*\/\s*\d{1,2}\)?/g, ' ')
      .replace(/\(?\d{1,2}\s+de\s+\d{1,2}\)?/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  return normalizeInstallmentBaseDescription(base || safe) || safe;
}

function buildInstallmentMeta(position, total, baseDescription, extra = {}) {
  const normalizedPosition = Number(position || 0);
  const normalizedTotal = Number(total || 0);
  if (!Number.isInteger(normalizedPosition) || !Number.isInteger(normalizedTotal)) return null;
  if (normalizedPosition < 1 || normalizedTotal <= 1 || normalizedPosition > normalizedTotal || normalizedTotal > 240) return null;
  const cleanBaseDescription = normalizeInstallmentBaseDescription(baseDescription) || '(sem descricao)';
  return {
    detected: true,
    position: normalizedPosition,
    total: normalizedTotal,
    label: `${normalizedPosition}/${normalizedTotal}`,
    baseDescription: cleanBaseDescription,
    ...extra
  };
}

function detectInstallmentMetaFromDescription(description, amountCents = 0) {
  if (Number(amountCents || 0) <= 0) return null;
  const safe = normalizeWhitespace(description);
  if (!safe) return null;

  const patterns = [
    /(?:^|\s|\-|\()([A-Z])?\s*(\d{1,2})\s*\/\s*(\d{1,2})(?:\))?\s*$/i,
    /\bparc(?:ela)?\s*(\d{1,2})\s*(?:de|\/)\s*(\d{1,2})\)?\s*$/i,
    /\(\s*parc(?:ela)?\s*(\d{1,2})\s*(?:de|\/)\s*(\d{1,2})\s*\)$/i,
    /(?:^|\s|\-|\()([A-Z])?\s*(\d{1,2})\s+de\s+(\d{1,2})(?:\))?\s*$/i
  ];

  for (const pattern of patterns) {
    const match = safe.match(pattern);
    if (!match) continue;
    const numbers = match.slice(1).filter((value) => /^\d+$/.test(String(value || '')));
    if (numbers.length < 2) continue;
    const meta = buildInstallmentMeta(numbers[0], numbers[1], stripTrailingInstallmentMarker(safe), {
      source: 'description',
      validator: 'regex',
      fromRaw: false
    });
    if (meta) return meta;
  }

  return null;
}

function buildInstallmentEnrichmentPrompt({ issuerHint, cardName, month, year, rows }) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const payload = safeRows.map((row) => ({
    row_id: row.id,
    date: row.date,
    description: row.description,
    amount: Number(row.amountCents || 0) / 100,
    card_last4: row.cardLast4 || null
  }));

  return [
    'Você recebe linhas já extraídas de uma fatura de cartão e deve apenas enriquecer metadados de parcelamento.',
    'Não altere datas, valores, descrição, quantidade de linhas ou row_id.',
    'Sua missão é só dizer se cada linha é uma compra parcelada, qual a parcela atual, qual o total e qual a descrição-base sem o marcador de parcela.',
    'Considere as variações comuns entre emissores brasileiros, como 02/08, 02 DE 08, Parcela 1 de 5, (Parcela 02 de 02), -6/12, F 10/10, S 01/03 e formatos equivalentes.',
    'Quando a linha não for parcelada, devolva installment_detected false para aquele row_id.',
    'Só marque parcelamento para compras parceladas reais. Não use parcelamento da fatura, rotativo, pagamento mínimo ou parcelamento automático da fatura como compra parcelada.',
    'PIX CRED PARCELADO e compras parceladas de lojista são compras válidas quando a linha representa a compra em si.',
    'A base_description deve manter o nome do lojista e remover apenas o marcador de parcela.',
    `Cartão selecionado no app: ${cardName}.`,
    `Competência escolhida no app: ${String(month).padStart(2, '0')}/${year}.`,
    `Emissor percebido: ${issuerHint || 'unknown'}.`,
    '',
    'Linhas para classificar (JSON):',
    JSON.stringify(payload, null, 2)
  ].join('\n');
}

function mergeInstallmentEnrichment(rows = [], payload = null) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const warnings = uniqueNormalizedTextList(Array.isArray(payload?.warnings) ? payload.warnings : []);
  const payloadRows = Array.isArray(payload?.rows) ? payload.rows : [];
  const sourceRowsById = new Map(safeRows.map((row) => [row.id, row]));
  const aiByRowId = new Map();
  payloadRows.forEach((row) => {
    const rowId = normalizeWhitespace(row?.row_id || '');
    if (!rowId || aiByRowId.has(rowId)) return;
    aiByRowId.set(rowId, row);
  });

  const enrichmentByRowId = new Map();
  let conflictCount = 0;

  safeRows.forEach((sourceRow) => {
    const localMeta = detectInstallmentMetaFromDescription(sourceRow.description, sourceRow.amountCents);
    const aiRow = aiByRowId.get(sourceRow.id);
    const aiDetected = !!aiRow?.installment_detected;
    const aiMeta = aiDetected
      ? buildInstallmentMeta(
          aiRow?.installment_position,
          aiRow?.installment_total,
          aiRow?.base_description || stripTrailingInstallmentMarker(sourceRow.description),
          {
            source: 'ai_enrichment',
            confidence: ['high', 'medium', 'low'].includes(String(aiRow?.confidence || '').trim().toLowerCase())
              ? String(aiRow.confidence).trim().toLowerCase()
              : 'medium',
            patternKind: normalizeWhitespace(aiRow?.pattern_kind || '') || null,
            validator: localMeta ? 'ai_and_regex' : 'ai_only',
            fromRaw: false
          }
        )
      : null;

    let finalMeta = null;
    let conflictReason = null;

    if (aiMeta && localMeta) {
      if (Number(aiMeta.position || 0) !== Number(localMeta.position || 0) || Number(aiMeta.total || 0) !== Number(localMeta.total || 0)) {
        conflictReason = 'A IA e a validacao local discordaram sobre a fracao da parcela.';
        conflictCount += 1;
        warnings.push(`${sourceRow.id}: ${conflictReason}`);
        finalMeta = {
          ...localMeta,
          source: 'description',
          confidence: 'medium',
          validator: 'regex_conflict_fallback',
          conflictReason
        };
      } else {
        finalMeta = {
          ...aiMeta,
          position: localMeta.position,
          total: localMeta.total,
          label: localMeta.label,
          validator: 'ai_and_regex'
        };
      }
    } else if (aiMeta) {
      finalMeta = aiMeta;
    } else if (localMeta) {
      finalMeta = {
        ...localMeta,
        source: 'description',
        confidence: 'medium',
        validator: 'regex_fallback'
      };
    }

    if (!finalMeta) return;

    enrichmentByRowId.set(sourceRow.id, {
      meta: finalMeta,
      conflictReason
    });
  });

  return {
    warnings: uniqueNormalizedTextList(warnings),
    enrichmentByRowId,
    detectedCount: Array.from(enrichmentByRowId.values()).filter((entry) => entry?.meta).length,
    conflictCount
  };
}

async function runInstallmentEnrichment(providerKey, context) {
  if (!providerKey) return null;
  const prompt = buildInstallmentEnrichmentPrompt({
    issuerHint: context.issuerHint,
    cardName: context.cardName,
    month: context.month,
    year: context.year,
    rows: context.rows
  });
  return runProvider(providerKey, {
    ...context,
    prompt,
    responseSchema: INSTALLMENT_ENRICHMENT_SCHEMA,
    schemaName: 'statement_installment_enrichment',
    systemMessage: 'Você classifica parcelamento linha a linha e responde apenas no JSON schema solicitado.'
  });
}

async function enrichValidatedRowsInstallments({ rows = [], config, providerKey, issuerHint, cardName, month, year }) {
  const localFallback = mergeInstallmentEnrichment(rows, null);
  if (!Array.isArray(rows) || !rows.length || !providerKey) {
    return {
      ...localFallback,
      usedAi: false,
      providerKey: null,
      rawText: null,
      errorMessage: null,
      responseMeta: null
    };
  }

  try {
    const response = await runInstallmentEnrichment(providerKey, {
      config,
      issuerHint,
      cardName,
      month,
      year,
      rows
    });
    if (!response?.parsed) {
      return {
        ...localFallback,
        usedAi: false,
        providerKey,
        rawText: response?.rawText || null,
        errorMessage: 'A IA de parcelamento nao devolveu JSON utilizavel.',
        responseMeta: response?.meta || null
      };
    }

    const merged = mergeInstallmentEnrichment(rows, response.parsed);
    return {
      ...merged,
      usedAi: true,
      providerKey,
      rawText: response.rawText || null,
      errorMessage: null,
      responseMeta: response.meta || null
    };
  } catch (error) {
    return {
      ...localFallback,
      usedAi: false,
      providerKey,
      rawText: null,
      errorMessage: normalizeProviderErrorMessage(error, providerKey, config),
      responseMeta: null
    };
  }
}

function extractPdfText(pdfPath) {
  try {
    const raw = execFileSync('pdftotext', ['-layout', '-enc', 'UTF-8', pdfPath, '-'], {
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024
    });
    return String(raw || '').replace(/\f/g, '\n\n=== PAGE BREAK ===\n\n').trim();
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      throw new Error('O servidor ainda nao tem o pdftotext instalado. Antes de usar PDF, precisamos liberar esse leitor no ambiente.');
    }
    throw new Error('Nao consegui ler esse PDF como texto agora. Vale tentar o arquivo de novo ou revisar se ele veio completo.');
  }
}


async function callGeminiStructured({ apiKey, model, prompt, timeoutMs, responseSchema, systemMessage = null }) {
  const response = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      contents: [{ role: 'user', parts: [{ text: systemMessage ? `${systemMessage}\n\n${prompt}` : prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseJsonSchema: responseSchema,
        temperature: 0.1
      }
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      timeout: Math.max(30000, Number(timeoutMs || 180000)),
      validateStatus: () => true
    }
  );

  if (response.status < 200 || response.status >= 300) {
    const message = response.data?.error?.message || `Gemini respondeu com status ${response.status}.`;
    throw new Error(message);
  }

  const text = response.data?.candidates?.[0]?.content?.parts?.map((part) => part?.text || '').join('') || '';
  if (!text.trim()) throw new Error('Gemini nao devolveu JSON utilizavel.');
  return {
    rawText: text,
    parsed: safeJsonParse(text),
    meta: {
      status: response.status,
      model,
      candidateCount: Array.isArray(response.data?.candidates) ? response.data.candidates.length : 0
    }
  };
}

async function callGemini({ apiKey, model, prompt, timeoutMs }) {
  return callGeminiStructured({
    apiKey,
    model,
    prompt,
    timeoutMs,
    responseSchema: STATEMENT_JSON_SCHEMA,
    systemMessage: null
  });
}

async function callOpenAIStructured({ apiKey, model, prompt, timeoutMs, responseSchema, schemaName = 'statement_import_rows', systemMessage = 'Você extrai faturas de cartão e responde apenas no JSON schema solicitado.' }) {
  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model,
      temperature: 0.1,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: schemaName,
          strict: true,
          schema: responseSchema
        }
      },
      messages: [
        {
          role: 'system',
          content: systemMessage
        },
        {
          role: 'user',
          content: prompt
        }
      ]
    },
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      timeout: Math.max(30000, Number(timeoutMs || 180000)),
      validateStatus: () => true
    }
  );

  if (response.status < 200 || response.status >= 300) {
    const message = response.data?.error?.message || `OpenAI respondeu com status ${response.status}.`;
    throw new Error(message);
  }

  const text = response.data?.choices?.[0]?.message?.content || '';
  if (!String(text).trim()) throw new Error('OpenAI nao devolveu JSON utilizavel.');
  return {
    rawText: text,
    parsed: safeJsonParse(text),
    meta: {
      status: response.status,
      model,
      completionId: response.data?.id || null
    }
  };
}

async function callOpenAI({ apiKey, model, prompt, timeoutMs }) {
  return callOpenAIStructured({
    apiKey,
    model,
    prompt,
    timeoutMs,
    responseSchema: STATEMENT_JSON_SCHEMA,
    schemaName: 'statement_import_rows',
    systemMessage: 'Você extrai faturas de cartão e responde apenas no JSON schema solicitado.'
  });
}

function validateStructuredRows(payload, { providerKey, issuerHint }) {
  const normalized = {
    issuer: typeof payload?.issuer === 'string' ? payload.issuer : issuerHint,
    confidence: typeof payload?.confidence === 'string' ? payload.confidence : 'medium',
    warnings: Array.isArray(payload?.warnings) ? payload.warnings.map((item) => normalizeWhitespace(item)).filter(Boolean) : [],
    import_rows: Array.isArray(payload?.import_rows) ? payload.import_rows : []
  };

  const suspicionCodes = [];
  const finalRows = [];
  let droppedWithoutDate = 0;
  let droppedInvalidAmount = 0;
  let droppedZero = 0;
  let droppedPayments = 0;
  let adjustedCreditSigns = 0;
  const droppedDateExamples = [];
  const invalidAmountExamples = [];

  normalized.import_rows.forEach((row, index) => {
    const rawDate = normalizeWhitespace(row?.date || '');
    const date = normalizeBrDate(rawDate);
    if (!date) {
      droppedWithoutDate += 1;
      if (rawDate && droppedDateExamples.length < 5 && !droppedDateExamples.includes(rawDate)) {
        droppedDateExamples.push(rawDate);
      }
      return;
    }

    const description = normalizeWhitespace(row?.description || '(sem descricao)');
    const rawAmount = normalizeWhitespace(row?.amount || '');
    let amountCents = parseAmountToCents(row?.amount);
    if (amountCents == null) {
      droppedInvalidAmount += 1;
      if (rawAmount && invalidAmountExamples.length < 5 && !invalidAmountExamples.includes(rawAmount)) {
        invalidAmountExamples.push(rawAmount);
      }
      return;
    }

    if (amountCents === 0) {
      droppedZero += 1;
      return;
    }

    if (isOwnStatementPayment(description)) {
      droppedPayments += 1;
      return;
    }

    if (amountCents > 0 && hasExplicitPlusSign(rawAmount)) {
      amountCents *= -1;
      adjustedCreditSigns += 1;
    }

    if (amountCents > 0 && isCreditLikeDescription(description)) {
      amountCents *= -1;
      adjustedCreditSigns += 1;
    }

    finalRows.push({
      id: `row_${index + 1}`,
      date,
      description,
      amountCents,
      cardLast4: normalizeDigits(row?.card_last4)
    });
  });

  if (!finalRows.length) suspicionCodes.push('empty_after_validation');
  if (droppedWithoutDate > 0) suspicionCodes.push('rows_without_date');
  if (droppedInvalidAmount > 0) suspicionCodes.push('rows_with_invalid_amount');
  if (droppedZero > 0) suspicionCodes.push('rows_with_zero_amount');
  if (droppedPayments > 0) suspicionCodes.push('own_statement_payments_removed');
  if (adjustedCreditSigns > 0) suspicionCodes.push('credit_sign_adjusted');
  if (normalized.warnings.length > 0) suspicionCodes.push('provider_warnings');
  if (normalized.confidence === 'medium') suspicionCodes.push('provider_confidence_medium');
  if (normalized.confidence === 'low') suspicionCodes.push('provider_confidence_low');

  const totalCents = finalRows.reduce((sum, row) => sum + Number(row.amountCents || 0), 0);
  const score = (finalRows.length * 100)
    - (droppedWithoutDate * 35)
    - (droppedInvalidAmount * 40)
    - (droppedZero * 15)
    - (normalized.warnings.length * 20)
    - (normalized.confidence === 'low' ? 80 : normalized.confidence === 'medium' ? 25 : 0);

  const details = [];
  if (normalized.warnings.length) details.push(...normalized.warnings);
  if (droppedWithoutDate > 0) {
    const examples = droppedDateExamples.length ? ` Ex.: ${droppedDateExamples.join(' | ')}.` : '';
    details.push(`${droppedWithoutDate} linha(s) vieram sem data válida e ficaram de fora.${examples}`);
  }
  if (droppedInvalidAmount > 0) {
    const examples = invalidAmountExamples.length ? ` Ex.: ${invalidAmountExamples.join(' | ')}.` : '';
    details.push(`${droppedInvalidAmount} linha(s) vieram com valor ruim.${examples}`);
  }
  if (droppedPayments > 0) details.push(`${droppedPayments} pagamento(s) da própria fatura ficaram de fora.`);
  if (adjustedCreditSigns > 0) details.push(`${adjustedCreditSigns} crédito(s) tiveram o sinal ajustado.`);

  return {
    providerKey,
    issuerKey: normalized.issuer || issuerHint || 'unknown',
    confidence: normalized.confidence,
    warnings: normalized.warnings,
    suspicionCodes,
    rows: finalRows,
    rowCount: finalRows.length,
    totalCents,
    score,
    needsRevalidation: !finalRows.length
      || normalized.confidence !== 'high'
      || normalized.warnings.length > 0
      || droppedWithoutDate > 0
      || droppedInvalidAmount > 0
      || droppedPayments > 0
      || adjustedCreditSigns > 0
      || normalized.issuer === 'unknown',
    detailsSummary: details.join(' ')
  };
}


function buildTxnsForPreview(validationResult, providerKey, cardName, installmentEnrichment = null) {
  const enrichmentByRowId = installmentEnrichment?.enrichmentByRowId instanceof Map
    ? installmentEnrichment.enrichmentByRowId
    : new Map();

  return validationResult.rows.map((row) => {
    const raw = {
      source: 'pdf_ia',
      provider: providerKey,
      issuer: validationResult.issuerKey,
      confidence: validationResult.confidence,
      card_name: cardName,
      card_last4: row.cardLast4,
      warnings: validationResult.warnings
    };

    if (row?.dateInference && typeof row.dateInference === 'object') {
      raw.import_date_inference = row.dateInference;
    }

    const enrichment = enrichmentByRowId.get(row.id) || null;
    if (enrichment?.meta) {
      raw.import_installment = {
        detected: true,
        position: Number(enrichment.meta.position || 0) || 1,
        total: Number(enrichment.meta.total || 0) || 1,
        label: enrichment.meta.label || `${Number(enrichment.meta.position || 0) || 1}/${Number(enrichment.meta.total || 0) || 1}`,
        base_description: enrichment.meta.baseDescription || stripTrailingInstallmentMarker(row.description) || row.description,
        source: enrichment.meta.source || 'ai_enrichment',
        confidence: enrichment.meta.confidence || 'medium',
        pattern_kind: enrichment.meta.patternKind || null,
        validator: enrichment.meta.validator || null
      };
      if (enrichment.conflictReason) {
        raw.import_installment_conflict = {
          reason: enrichment.conflictReason
        };
      }
    }

    return {
      card_number: row.cardLast4,
      txn_date: row.date,
      description: row.description,
      amount_cents: row.amountCents,
      raw
    };
  });
}

function chooseBestResult(results = []) {
  return results
    .filter(Boolean)
    .sort((a, b) => {
      const aPenalty = a.validation.needsRevalidation ? 1 : 0;
      const bPenalty = b.validation.needsRevalidation ? 1 : 0;
      if (aPenalty !== bPenalty) return aPenalty - bPenalty;
      return b.validation.score - a.validation.score;
    })[0] || null;
}

function buildReadyWarningMessage(bestResult, { revalidated = false } = {}) {
  const bits = [];
  if (revalidated) bits.push('Passei a fatura por uma segunda checagem antes de liberar a revisão.');
  if (bestResult.validation.warnings.length) bits.push(...bestResult.validation.warnings);
  if (bestResult.validation.detailsSummary) bits.push(bestResult.validation.detailsSummary);
  const dedupedBits = uniqueNormalizedTextList(bits);
  return normalizeWhitespace(dedupedBits.join(' ')) || null;
}

function formatTimeoutLabel(timeoutMs) {
  const safeTimeoutMs = Math.max(1000, Number(timeoutMs || 0) || 0);
  if (!safeTimeoutMs) return 'alguns minutos';
  if (safeTimeoutMs < 60000) return `${Math.max(1, Math.round(safeTimeoutMs / 1000))}s`;
  const minutes = safeTimeoutMs / 60000;
  const rounded = Math.round(minutes * 10) / 10;
  return `${String(rounded).replace(/\.0$/, '')} min`;
}

function normalizeProviderErrorMessage(error, providerKey, config = {}) {
  const rawMessage = normalizeWhitespace(error?.message || String(error || ''));
  if (!rawMessage) return `${repository.providerLabel(providerKey)} nao conseguiu concluir essa leitura.`;

  if (error?.code === 'ECONNABORTED' || /timeout of \d+ms exceeded/i.test(rawMessage)) {
    return `o limite de ${formatTimeoutLabel(config.providerTimeoutMs)} estourou antes de ${repository.providerLabel(providerKey)} terminar de ler a fatura.`;
  }

  return rawMessage;
}

function buildJobReadyStatusSummary(validation, warningMessage) {
  const rowCount = Math.max(0, Number(validation?.rowCount || 0));
  if (warningMessage) {
    return rowCount === 1
      ? '1 lancamento ficou pronto, com um alerta pedindo seu olho extra antes de importar.'
      : `${rowCount} lancamentos ficaram prontos, com alguns alertas pedindo seu olho extra antes de importar.`;
  }
  return rowCount === 1
    ? '1 lancamento ficou pronto para revisao.'
    : `${rowCount} lancamentos ficaram prontos para revisao.`;
}

function emitJobReadyNotification(job, validation, warningMessage) {
  const deps = WORKER_STATE.deps || {};
  if (typeof deps.createNotification !== 'function' || !job?.id || !job?.userId) return;

  const competencia = `${String(job.month).padStart(2, '0')}/${job.year}`;
  const statusResumo = buildJobReadyStatusSummary(validation, warningMessage);

  repository.clearJobNotifications(job.id);

  try {
    deps.createNotification({
      userId: job.userId,
      type: 'statement_import_job_ready',
      title: 'Seu PDF ja ficou pronto para conferir',
      body: `${job.originalFilename} no ${job.cardName} (${competencia}) ja virou revisao. ${statusResumo}`,
      href: `/import/pdf/jobs/${job.id}/review`,
      relatedType: 'statement_import_job',
      relatedId: job.id,
      groupKey: 'card_due_today',
      messageKey: 'notification.statement_pdf.ready',
      messageVariables: {
        arquivo: job.originalFilename,
        cartao: job.cardName,
        competencia,
        status_resumo: statusResumo
      }
    });
  } catch (error) {
    console.error('[statement-pdf-worker] falha ao criar notificacao do job pronto:', error?.message || error);
  }
}

async function runProvider(providerKey, context) {
  const timeoutMs = Number(context?.timeoutMs || context?.config?.providerTimeoutMs || 180000);
  if (providerKey === 'gemini') {
    if (context?.responseSchema) {
      return callGeminiStructured({
        apiKey: context.config.geminiApiKey,
        model: context.config.geminiModel,
        prompt: context.prompt,
        timeoutMs,
        responseSchema: context.responseSchema,
        systemMessage: context.systemMessage || null
      });
    }
    return callGemini({
      apiKey: context.config.geminiApiKey,
      model: context.config.geminiModel,
      prompt: context.prompt,
      timeoutMs
    });
  }
  if (providerKey === 'openai') {
    if (context?.responseSchema) {
      return callOpenAIStructured({
        apiKey: context.config.openaiApiKey,
        model: context.config.openaiModel,
        prompt: context.prompt,
        timeoutMs,
        responseSchema: context.responseSchema,
        schemaName: context.schemaName || 'statement_enrichment',
        systemMessage: context.systemMessage || 'Você responde apenas no JSON schema solicitado.'
      });
    }
    return callOpenAI({
      apiKey: context.config.openaiApiKey,
      model: context.config.openaiModel,
      prompt: context.prompt,
      timeoutMs
    });
  }
  throw new Error('Provedor de IA desconhecido.');
}

async function processQueuedJob(job) {
  if (!job?.id) return;
  const deps = WORKER_STATE.deps || {};
  if (typeof deps.buildImportPreviewData !== 'function') {
    repository.markJobFailed(job.id, {
      errorMessage: 'O motor da revisão não ficou disponível nesta inicialização.',
      detailsSummary: 'buildImportPreviewData não foi injetado na fila de PDF.',
      attemptCount: Number(job.attemptCount || 0)
    });
    return;
  }

  try {
    const config = repository.getPdfImportRuntimeConfig();
  const enabledProviders = repository.resolveEnabledProviders(config);
  if (!config.enabled) {
    repository.markJobFailed(job.id, {
      errorMessage: 'A importação de PDF está desligada no admin.',
      attemptCount: Number(job.attemptCount || 0)
    });
    return;
  }
  if (!enabledProviders.length) {
    repository.markJobFailed(job.id, {
      errorMessage: 'Nenhum provedor de IA está ligado com chave válida no admin.',
      attemptCount: Number(job.attemptCount || 0)
    });
    return;
  }

  const sourcePath = repository.getSourcePdfPath(job.id);
  if (!sourcePath) {
    repository.markJobFailed(job.id, {
      errorMessage: 'Não achei o PDF original deste job para processar.',
      attemptCount: Number(job.attemptCount || 0)
    });
    return;
  }

  const extractedText = extractPdfText(sourcePath);
  const issuerHint = detectIssuerHint(extractedText, job.originalFilename);
  repository.saveArtifact({
    jobId: job.id,
    kind: 'extracted_text',
    filename: 'extracted-layout.txt',
    mimeType: 'text/plain',
    content: extractedText,
    encoding: 'utf8'
  });

  const prompt = buildExtractionPrompt({
    issuerHint,
    cardName: job.cardName,
    month: job.month,
    year: job.year,
    text: extractedText
  });

  const results = [];
  let usedRevalidation = false;

  for (let index = 0; index < enabledProviders.length; index += 1) {
    const providerKey = enabledProviders[index];
    if (index > 0) {
      repository.markJobRevalidating(job.id, `${repository.providerLabel(providerKey)} entrou para conferir o que o primeiro retorno deixou estranho.`);
      usedRevalidation = true;
    }

    repository.incrementJobAttemptCount(job.id);
    const attemptId = repository.beginAttempt(job.id, providerKey, index === 0 ? 'extract' : 'revalidate');
    const startedAt = Date.now();

    try {
      const providerResponse = await runProvider(providerKey, {
        config,
        prompt,
        issuerHint,
        job
      });
      const parsed = providerResponse.parsed;
      if (!parsed) {
        throw new Error(`${repository.providerLabel(providerKey)} devolveu um JSON que não fechou.`);
      }

      const validation = validateStructuredRows(parsed, { providerKey, issuerHint });

      if (config.debugEnabled || validation.needsRevalidation) {
        repository.saveArtifact({
          jobId: job.id,
          kind: 'provider_raw',
          providerKey,
          filename: `${providerKey}-raw.json`,
          mimeType: 'application/json',
          content: providerResponse.rawText,
          encoding: 'utf8'
        });
      }
      repository.finishAttempt(attemptId, {
        status: validation.needsRevalidation ? 'warning' : 'success',
        latencyMs: Date.now() - startedAt,
        suspicionCodes: validation.suspicionCodes,
        responseMeta: providerResponse.meta
      });
      repository.appendJobEvent(
        job.id,
        validation.needsRevalidation ? 'warning' : 'info',
        `${repository.providerLabel(providerKey)} trouxe ${validation.rowCount} linha(s) úteis${validation.needsRevalidation ? ` e pediu uma conferida extra. ${validation.detailsSummary || ''}` : '.'}`.trim()
      );
      results.push({ providerKey, providerResponse, validation });

      if (!validation.needsRevalidation) break;
    } catch (error) {
      const providerErrorMessage = normalizeProviderErrorMessage(error, providerKey, config);
      repository.finishAttempt(attemptId, {
        status: 'error',
        latencyMs: Date.now() - startedAt,
        errorMessage: providerErrorMessage
      });
      repository.appendJobEvent(job.id, 'warning', `${repository.providerLabel(providerKey)} tropeçou: ${providerErrorMessage}`);
      if (index === enabledProviders.length - 1) {
        results.push({ providerKey, error: { message: providerErrorMessage } });
      }
    }
  }

  const successfulResults = results.filter((entry) => entry && entry.validation && entry.providerResponse);
  const bestResult = chooseBestResult(successfulResults);

  if (!bestResult) {
    const finalError = results.filter((entry) => entry && entry.error).map((entry) => entry.error?.message).filter(Boolean).join(' ');
    repository.markJobFailed(job.id, {
      providerUsed: results[results.length - 1]?.providerKey || null,
      errorMessage: finalError || 'Os provedores não conseguiram devolver um retorno utilizável desta vez.',
      detailsSummary: finalError || null
    });
    return;
  }

  const installmentEnrichment = await enrichValidatedRowsInstallments({
    rows: bestResult.validation.rows,
    config,
    providerKey: bestResult.providerKey,
    issuerHint,
    cardName: job.cardName,
    month: job.month,
    year: job.year
  });

  const dateInference = applyStatementDateInference(bestResult.validation.rows, {
    statementMonth: job.month,
    statementYear: job.year,
    enrichmentByRowId: installmentEnrichment?.enrichmentByRowId || null
  });
  const previewRows = dateInference.rows;

  if (dateInference.adjustedCount > 0) {
    repository.appendJobEvent(
      job.id,
      'info',
      dateInference.adjustedCount === 1
        ? '1 data teve o ano reancorado pela competencia da fatura para evitar uma compra no futuro.'
        : `${dateInference.adjustedCount} datas tiveram o ano reancorado pela competencia da fatura para evitar compras no futuro.`
    );
  }

  if (installmentEnrichment.errorMessage) {
    repository.appendJobEvent(job.id, 'warning', `A segunda leitura de parcelamento caiu no fluxo simples: ${installmentEnrichment.errorMessage}`);
  } else if (installmentEnrichment.detectedCount > 0) {
    repository.appendJobEvent(
      job.id,
      installmentEnrichment.conflictCount > 0 ? 'warning' : 'info',
      installmentEnrichment.conflictCount > 0
        ? `${installmentEnrichment.detectedCount} linha(s) receberam metadados de parcelamento e ${installmentEnrichment.conflictCount} ficaram travadas na parcela atual por conflito de validação.`
        : `${installmentEnrichment.detectedCount} linha(s) receberam metadados de parcelamento antes da revisão.`
    );
  }

  if ((config.debugEnabled || installmentEnrichment.conflictCount > 0 || (installmentEnrichment.warnings || []).length > 0) && installmentEnrichment.rawText) {
    repository.saveArtifact({
      jobId: job.id,
      kind: 'installment_enrichment',
      providerKey: installmentEnrichment.providerKey || bestResult.providerKey,
      filename: `${installmentEnrichment.providerKey || bestResult.providerKey}-installment-enrichment.json`,
      mimeType: 'application/json',
      content: installmentEnrichment.rawText,
      encoding: 'utf8'
    });
  }

  const previewValidation = {
    ...bestResult.validation,
    rows: previewRows
  };
  const txns = buildTxnsForPreview(previewValidation, bestResult.providerKey, job.cardName, installmentEnrichment);
  const preview = deps.buildImportPreviewData({
    userId: job.userId,
    cardId: job.cardId,
    cardName: job.cardName,
    month: job.month,
    year: job.year,
    originalFilename: job.originalFilename,
    txns
  });
  const csvText = buildCsvFromRows(job.cardName, previewRows);

  repository.saveArtifact({
    jobId: job.id,
    kind: 'normalized_json',
    filename: 'normalized.json',
    mimeType: 'application/json',
    content: JSON.stringify({
      issuer: bestResult.validation.issuerKey,
      confidence: bestResult.validation.confidence,
      warnings: bestResult.validation.warnings,
      import_rows: previewRows.map((row) => ({
        date: row.date,
        description: row.description,
        amount: row.amountCents / 100,
        card_last4: row.cardLast4 || null,
        ...(row.dateInference ? { date_inference: row.dateInference } : {})
      }))
    }, null, 2),
    encoding: 'utf8'
  });
  repository.saveArtifact({
    jobId: job.id,
    kind: 'generated_csv',
    filename: `${path.basename(job.originalFilename || 'fatura.pdf').replace(/\.pdf$/i, '') || 'fatura'}.csv`,
    mimeType: 'text/csv',
    content: csvText,
    encoding: 'utf8'
  });
  repository.saveArtifact({
    jobId: job.id,
    kind: 'preview_json',
    filename: 'preview.json',
    mimeType: 'application/json',
    content: JSON.stringify(preview),
    encoding: 'utf8'
  });

  const warningMessage = bestResult.validation.needsRevalidation || usedRevalidation
    ? buildReadyWarningMessage(bestResult, { revalidated: usedRevalidation })
    : null;

  repository.markJobReady(job.id, {
    providerUsed: bestResult.providerKey,
    issuerKey: bestResult.validation.issuerKey,
    rowCount: bestResult.validation.rowCount,
    totalCents: bestResult.validation.totalCents,
    warningMessage,
    detailsSummary: bestResult.validation.detailsSummary || null
  });
  emitJobReadyNotification(job, bestResult.validation, warningMessage);
  } catch (error) {
    repository.markJobFailed(job.id, {
      errorMessage: error && error.message ? error.message : 'A análise desse PDF tropeçou no meio do caminho.',
      detailsSummary: error && error.stack ? String(error.stack).slice(0, 4000) : null
    });
  }
}

async function tickWorker() {
  if (WORKER_STATE.processing) return;
  WORKER_STATE.processing = true;
  try {
    if (WORKER_STATE.cleanupRuns % 180 === 0) {
      repository.cleanupExpiredArtifacts();
    }
    WORKER_STATE.cleanupRuns += 1;

    const job = repository.claimNextQueuedJob();
    if (!job) return;
    await processQueuedJob(job);
  } catch (error) {
    // sem pânico: o próximo ciclo tenta de novo só no que estiver na fila
    console.error('[statement-pdf-worker] erro inesperado:', error && error.stack ? error.stack : error);
  } finally {
    WORKER_STATE.processing = false;
  }
}

function ensureStatementPdfWorkerStarted(deps = {}) {
  WORKER_STATE.deps = { ...WORKER_STATE.deps, ...deps };
  if (WORKER_STATE.started) return;
  WORKER_STATE.started = true;
  setTimeout(() => { tickWorker(); }, 1200);
  WORKER_STATE.timer = setInterval(() => {
    tickWorker();
  }, 5000);
}

function createStatementPdfService(deps = {}) {
  ensureStatementPdfWorkerStarted(deps);

  const featureRepository = deps.statementPdfRepository || repository;

  function buildFeatureState() {
    const config = featureRepository.getPdfImportRuntimeConfig();
    const enabledProviders = featureRepository.resolveEnabledProviders(config);
    return {
      enabled: !!config.enabled,
      providersReady: enabledProviders.length > 0,
      providerLabels: enabledProviders.map((providerKey) => featureRepository.providerLabel(providerKey)),
      config
    };
  }

  function enqueuePdfImports(userId, body = {}, files = []) {
    const feature = buildFeatureState();
    const cardId = Number(body.card_id || 0);
    const month = Number(body.month || 0);
    const year = Number(body.year || 0);
    const fileList = Array.isArray(files) ? files.filter(Boolean) : [];

    if (!feature.enabled) throw new Error('A importação por PDF ainda está desligada no admin.');
    if (!fileList.length) throw new Error('Envie ao menos um PDF da fatura.');
    if (!cardId) throw new Error('Selecione o cartao.');
    if (!month || month < 1 || month > 12) throw new Error('Mes invalido.');
    if (!year || year < 2000 || year > 2100) throw new Error('Ano invalido.');

    const card = featureRepository.findActiveCardById(userId, cardId);
    if (!card) throw new Error('Cartao invalido ou desativado.');
    if (!feature.providersReady) throw new Error('Nenhum provedor de IA está pronto no admin. Ligue as chaves antes de subir a fatura.');

    fileList.forEach((file) => {
      if (!/\.pdf$/i.test(String(file.originalname || '')) && !/pdf/i.test(String(file.mimetype || ''))) {
        throw new Error(`O arquivo ${file.originalname || 'enviado'} nao parece ser um PDF de fatura.`);
      }
    });

    const preferredProvider = featureRepository.resolveEnabledProviders(feature.config)[0] || 'gemini';
    const jobs = fileList.map((file) => featureRepository.createPdfImportJob({
      userId,
      cardId,
      month,
      year,
      file,
      preferredProvider
    }));

    const count = jobs.length;
    const leadName = jobs[0]?.originalFilename || 'o PDF';

    return {
      jobs,
      flash: {
        type: 'info',
        message: count === 1
          ? `PDF recebido. Coloquei ${leadName} na fila e libero os botoes assim que a analise desse job terminar.`
          : `${count} PDFs entraram na fila. Vou processar um por vez e soltar os botoes de cada job assim que ele terminar.`
      },
      redirectTo: '/import'
    };
  }

  function listRecentJobs(userId) {
    return featureRepository.listJobsForUser(userId, { limit: 12 });
  }

  function openReviewFromJob(userId, jobId, req) {
    const job = featureRepository.findJobByIdForUser(userId, jobId);
    if (!job) {
      return {
        redirectTo: '/import',
        flash: {
          type: 'error',
          message: 'Nao achei esse PDF por aqui.'
        }
      };
    }
    if (!job.canReview) {
      return {
        redirectTo: '/import',
        flash: {
          type: 'info',
          message: 'Esse PDF ainda nao terminou a analise. Assim que ficar pronto, o botao de conferir aparece.'
        }
      };
    }

    const preview = featureRepository.getPreviewPayload(job.id);
    if (!preview) {
      return {
        redirectTo: '/import',
        flash: {
          type: 'error',
          message: 'A revisão desse PDF não está disponível agora. Tenta rodar de novo que eu refaço a trilha.'
        }
      };
    }

    if (typeof deps.setImportPreview === 'function') deps.setImportPreview(req, preview);
    if (typeof deps.setImportFormSeed === 'function') deps.setImportFormSeed(req, preview.formSeed || null);
    return {
      redirectTo: '/import',
      flash: {
        type: job.status === 'review_warn' ? 'info' : 'success',
        message: job.status === 'review_warn'
          ? 'Abri a revisão do PDF com um aviso para você conferir os pontos mais sensíveis.'
          : 'Revisão do PDF aberta. Agora é só passar o olho e confirmar.'
      }
    };
  }

  function getCsvDownload(userId, jobId) {
    const job = featureRepository.findJobByIdForUser(userId, jobId);
    if (!job || !job.canDownload) {
      throw new Error('Esse CSV ainda não ficou pronto para baixar.');
    }
    const csvPath = featureRepository.getGeneratedCsvPath(job.id);
    if (!csvPath) throw new Error('Nao achei o CSV gerado desse job agora.');
    return {
      downloadPath: csvPath,
      filename: job.csvFilename
    };
  }

  function retryJob(userId, jobId) {
    const job = featureRepository.requeueJob(userId, jobId);
    return {
      job,
      redirectTo: '/import',
      flash: {
        type: 'info',
        message: `Beleza, joguei ${job.originalFilename} de volta na fila para uma nova leitura.`
      }
    };
  }

  function deleteJob(userId, jobId) {
    const job = featureRepository.deleteJob(userId, jobId);
    return {
      job,
      redirectTo: '/import',
      flash: {
        type: 'success',
        message: `Pronto, apaguei ${job.originalFilename} e os arquivos gerados desse job.`
      }
    };
  }

  return {
    buildFeatureState,
    enqueuePdfImports,
    listRecentJobs,
    openReviewFromJob,
    getCsvDownload,
    retryJob,
    deleteJob,
    ensureStatementPdfWorkerStarted
  };
}

module.exports = {
  createStatementPdfService,
  ensureStatementPdfWorkerStarted
};
