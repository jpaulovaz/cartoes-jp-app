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
      enum: ['inter', 'itau', 'sams_club', 'carrefour', 'santander', 'caixa', 'unknown']
    },
    confidence: {
      type: 'string',
      enum: ['high', 'medium', 'low']
    },
    warnings: {
      type: 'array',
      items: { type: 'string' }
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
  if (/banco inter|resumo da fatura|inter loop/.test(source)) return 'inter';
  if (/santander|detalhamento da fatura|pagamento e demais créditos/.test(source)) return 'santander';
  if (/ita[uú]|lançamentos atuais|pagamento efetuado em/.test(source)) return 'itau';
  if (/sam's club|sams club|cart[aã]o sam's club/.test(source)) return 'sams_club';
  if (/carrefour|banco csf|cartaocarrefour/.test(source)) return 'carrefour';
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
    '15. Use warnings para registrar qualquer incerteza importante; caso contrário, devolva um array vazio.',
    '16. Não invente linhas para bater com o total da fatura.',
    '17. Se existir subtotal de despesas do mês ou lançamentos atuais, use isso como prova dos nove silenciosa, mas sem inventar itens.',
    '',
    'Texto extraído da fatura:',
    text
  ].join('\n');
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

async function callGemini({ apiKey, model, prompt, timeoutMs }) {
  const response = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseJsonSchema: STATEMENT_JSON_SCHEMA,
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

async function callOpenAI({ apiKey, model, prompt, timeoutMs }) {
  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model,
      temperature: 0.1,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'statement_import_rows',
          strict: true,
          schema: STATEMENT_JSON_SCHEMA
        }
      },
      messages: [
        {
          role: 'system',
          content: 'Você extrai faturas de cartão e responde apenas no JSON schema solicitado.'
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

function buildTxnsForPreview(validationResult, providerKey, cardName) {
  return validationResult.rows.map((row) => ({
    card_number: row.cardLast4,
    txn_date: row.date,
    description: row.description,
    amount_cents: row.amountCents,
    raw: {
      source: 'pdf_ia',
      provider: providerKey,
      issuer: validationResult.issuerKey,
      confidence: validationResult.confidence,
      card_name: cardName,
      card_last4: row.cardLast4,
      warnings: validationResult.warnings
    }
  }));
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
  if (providerKey === 'gemini') {
    return callGemini({
      apiKey: context.config.geminiApiKey,
      model: context.config.geminiModel,
      prompt: context.prompt,
      timeoutMs: context.config.providerTimeoutMs
    });
  }
  if (providerKey === 'openai') {
    return callOpenAI({
      apiKey: context.config.openaiApiKey,
      model: context.config.openaiModel,
      prompt: context.prompt,
      timeoutMs: context.config.providerTimeoutMs
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

  const txns = buildTxnsForPreview(bestResult.validation, bestResult.providerKey, job.cardName);
  const preview = deps.buildImportPreviewData({
    userId: job.userId,
    cardId: job.cardId,
    cardName: job.cardName,
    month: job.month,
    year: job.year,
    originalFilename: job.originalFilename,
    txns
  });
  const csvText = buildCsvFromRows(job.cardName, bestResult.validation.rows);

  repository.saveArtifact({
    jobId: job.id,
    kind: 'normalized_json',
    filename: 'normalized.json',
    mimeType: 'application/json',
    content: JSON.stringify({
      issuer: bestResult.validation.issuerKey,
      confidence: bestResult.validation.confidence,
      warnings: bestResult.validation.warnings,
      import_rows: bestResult.validation.rows.map((row) => ({
        date: row.date,
        description: row.description,
        amount: row.amountCents / 100,
        card_last4: row.cardLast4 || null
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
