const axios = require('axios');
const dayjs = require('dayjs');
const { createAutomationReceiptPurchasesRepository } = require('../repositories/automationReceiptPurchases.repository');
const { createPurchaseCreationService, PurchaseCreationError } = require('./purchaseCreation.service');
const { DEFAULT_PHONE_COUNTRY, normalizePhoneForWhatsapp } = require('../phone');
const { formatBRLFromCents, toISOFromBRDate, centsFromPtBrMoney } = require('../utils');

class ReceiptPurchaseAutomationError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'ReceiptPurchaseAutomationError';
    this.code = options.code || 'RECEIPT_PURCHASE_ERROR';
    this.statusCode = options.statusCode || 400;
    this.details = options.details || null;
  }
}

function makeResult(payload = {}, statusCode = 200) {
  return { statusCode, ...payload };
}

function normalizeDigits(value) {
  return String(value || '')
    .replace(/@s\.whatsapp\.net$/i, '')
    .replace(/@c\.us$/i, '')
    .replace(/\D/g, '');
}

function normalizeAutomationPhone(rawPhone, options = {}) {
  const fallbackCountry = options.fallbackCountry || DEFAULT_PHONE_COUNTRY;
  const raw = String(rawPhone || '').trim();
  if (!raw) return { ok: false, reason: 'Telefone não informado.' };
  const digits = normalizeDigits(raw);
  const candidate = raw.startsWith('+') ? raw : (digits.startsWith('55') && digits.length >= 12 ? `+${digits}` : raw);
  const normalized = normalizePhoneForWhatsapp(candidate, { fallbackCountry });
  if (!normalized.ok) return { ok: false, reason: normalized.reason || 'Não consegui normalizar esse telefone.' };
  return {
    ok: true,
    e164: normalized.e164,
    whatsappNumber: normalized.number,
    countryCode: normalized.countryCode || fallbackCountry
  };
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanDisplayText(value, fallback = '') {
  return String(value || fallback || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

function stripDataUrl(raw) {
  return String(raw || '').replace(/^data:[^;]+;base64,/i, '').replace(/\s+/g, '').trim();
}

function fileFromPayload(payload = {}) {
  const image = payload.image || payload.file || {};
  const base64 = stripDataUrl(image.base64 || payload.image_base64 || payload.base64 || payload.file_base64 || '');
  if (!base64) return null;
  let buffer;
  try {
    buffer = Buffer.from(base64, 'base64');
  } catch (error) {
    return null;
  }
  if (!buffer.length) return null;
  return {
    buffer,
    originalname: cleanDisplayText(image.filename || payload.filename || payload.original_filename || 'comprovante.jpg', 'comprovante.jpg'),
    mimetype: cleanDisplayText(image.mime_type || image.mimetype || payload.mime_type || payload.mimetype || 'image/jpeg', 'image/jpeg'),
    size: buffer.length,
    sha256: image.sha256 || payload.sha256 || null
  };
}

function validateImageFile(file, repository) {
  if (!file || !Buffer.isBuffer(file.buffer) || !file.buffer.length) {
    throw new ReceiptPurchaseAutomationError('Não recebi a imagem do comprovante. Me manda uma foto nítida do comprovante inteiro.', {
      code: 'RECEIPT_IMAGE_REQUIRED',
      statusCode: 400
    });
  }
  const maxBytes = repository.getMaxFileBytes();
  if (file.buffer.length > maxBytes) {
    throw new ReceiptPurchaseAutomationError(`Essa imagem passou do limite de ${Math.round(maxBytes / 1024 / 1024)} MB. Manda uma versão menor para eu conseguir analisar.`, {
      code: 'RECEIPT_IMAGE_TOO_LARGE',
      statusCode: 413
    });
  }
  const filename = String(file.originalname || '').trim();
  const mime = String(file.mimetype || '').toLowerCase();
  const allowedMime = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  const allowedExtension = /\.(jpe?g|png|webp)$/i.test(filename);
  if (!allowedMime.includes(mime) && !allowedExtension) {
    throw new ReceiptPurchaseAutomationError('Esse arquivo não parece imagem de comprovante. Manda uma foto em JPG, PNG ou WEBP.', {
      code: 'INVALID_RECEIPT_IMAGE',
      statusCode: 400
    });
  }
}

function normalizeAmountCents(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  const raw = String(value || '').trim();
  if (!raw) return 0;
  if (/^-?\d+$/.test(raw)) return Number(raw);
  return centsFromPtBrMoney(raw);
}

function normalizeDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw) && dayjs(raw).isValid()) return dayjs(raw).format('YYYY-MM-DD');
  const br = toISOFromBRDate(raw);
  if (br) return br;
  const compact = raw.match(/^(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?$/);
  if (compact) {
    const day = compact[1].padStart(2, '0');
    const month = compact[2].padStart(2, '0');
    const year = compact[3]
      ? (compact[3].length === 2 ? `20${compact[3]}` : compact[3])
      : new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 4);
    const iso = `${year}-${month}-${day}`;
    if (dayjs(iso).isValid()) return dayjs(iso).format('YYYY-MM-DD');
  }
  return '';
}

function normalizeInstallments(value) {
  const parsed = Number.parseInt(String(value ?? '').replace(/\D/g, ''), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.min(120, parsed);
}

function normalizeConfidence(value) {
  const normalized = normalizeText(value);
  if (['high', 'medium', 'low'].includes(normalized)) return normalized;
  if (['alta', 'alto'].includes(normalized)) return 'high';
  if (['media', 'medio'].includes(normalized)) return 'medium';
  if (['baixa', 'baixo'].includes(normalized)) return 'low';
  return 'medium';
}

function safeJsonParse(value, fallback = null) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  const raw = String(value || '').trim();
  const withoutFence = raw.replace(/^```json/i, '').replace(/^```/i, '').replace(/```$/i, '').trim();
  const first = withoutFence.indexOf('{');
  const last = withoutFence.lastIndexOf('}');
  const candidate = first >= 0 && last > first ? withoutFence.slice(first, last + 1) : withoutFence;
  try {
    return JSON.parse(candidate);
  } catch (error) {
    return fallback;
  }
}

function extractGeminiText(response) {
  const candidates = response?.data?.candidates || [];
  for (const candidate of candidates) {
    const parts = candidate?.content?.parts || [];
    const text = parts.map((part) => part.text || '').join('\n').trim();
    if (text) return text;
  }
  return '';
}

function compactLogText(value, limit = 900) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, Math.max(80, Number(limit || 900)));
}

function extractGeminiMeta(response) {
  const data = response?.data || {};
  const candidates = Array.isArray(data.candidates) ? data.candidates : [];
  return {
    candidate_count: candidates.length,
    finish_reasons: candidates.map((candidate) => candidate?.finishReason || null).filter(Boolean),
    prompt_feedback: data.promptFeedback || null,
    usage_metadata: data.usageMetadata || null
  };
}

function normalizeReceiptPayload(parsed = {}) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const candidates = [
    parsed,
    parsed.receipt,
    parsed.comprovante,
    parsed.purchase,
    parsed.compra,
    parsed.data,
    parsed.result
  ].filter((item) => item && typeof item === 'object' && !Array.isArray(item));
  return candidates.find((item) => Object.keys(item).length) || null;
}

function parseAmountCentsFromText(text = '') {
  const normalized = String(text || '');
  const preferred = normalized.match(/(?:valor|total|credito|cr[eé]dito|debito|d[eé]bito)[^\d]{0,18}(?:r\$)?\s*(\d{1,6}(?:[.,]\d{2}))/i);
  const generic = preferred || normalized.match(/(?:r\$)\s*(\d{1,6}(?:[.,]\d{2}))/i);
  if (!generic) return null;
  const cents = normalizeAmountCents(generic[1]);
  return cents > 0 ? cents : null;
}

function parseDateFromText(text = '') {
  const normalized = String(text || '');
  const matches = normalized.match(/\b\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}\b/g) || [];
  for (const match of matches) {
    const iso = normalizeDate(match);
    if (iso) return iso;
  }
  return '';
}

function parseCardLast4FromText(text = '') {
  const normalized = String(text || '');
  const direct = normalized.match(/(?:cart[aã]o|cartao|card)[^\d]{0,20}(?:x{2,}|[*]{2,}|\.)?[\s.:-]*(\d{4})\b/i);
  if (direct) return direct[1];
  const masked = normalized.match(/(?:x{2,}|[*]{2,}|\.)[\s.:-]*(\d{4})\b/i);
  return masked ? masked[1] : '';
}

function parseAuthorizationFromText(text = '') {
  const match = String(text || '').match(/(?:autoriza[cç][aã]o|autorizacao|auth|authorization)[^a-z0-9]{0,10}([a-z0-9-]{3,24})/i);
  return match ? cleanDisplayText(match[1]) : '';
}

function parsePaymentMethodFromText(text = '') {
  const normalized = String(text || '');
  const parts = [];
  if (/cr[eé]dito/i.test(normalized)) parts.push('crédito');
  if (/d[eé]bito/i.test(normalized)) parts.push('débito');
  if (/mastercard/i.test(normalized)) parts.push('Mastercard');
  else if (/visa/i.test(normalized)) parts.push('Visa');
  else if (/elo/i.test(normalized)) parts.push('Elo');
  else if (/amex|american express/i.test(normalized)) parts.push('American Express');
  return cleanDisplayText(parts.join(' '));
}

function parseMerchantFromText(text = '') {
  const labelMatch = String(text || '').match(/(?:estabelecimento|loja|merchant|nome)[^a-z0-9À-ÿ]{0,12}([a-zÀ-ÿ0-9 .,&'-]{3,120})/i);
  if (labelMatch) return cleanDisplayText(labelMatch[1]);
  const forbidden = /cnpj|cpf|comprovante|valor|total|credito|cr[eé]dito|debito|d[eé]bito|cart[aã]o|cartao|mastercard|visa|elo|rede|sitef|autoriz|arqc|aid|pdv|nfc|transa[cç][aã]o|aprovada|emissor|cidade|endere[cç]o|\br\$\b/i;
  const lines = String(text || '')
    .split(/\r?\n|\s{2,}/)
    .map((line) => cleanDisplayText(line))
    .filter((line) => /[a-zÀ-ÿ]{3,}/i.test(line) && !forbidden.test(line));
  return lines[0] || '';
}

function buildReceiptFromPlainText(text = '') {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const merchant = parseMerchantFromText(raw);
  const amountCents = parseAmountCentsFromText(raw);
  const date = parseDateFromText(raw);
  const cardLast4 = parseCardLast4FromText(raw);
  const paymentMethod = parsePaymentMethodFromText(raw);
  const authorizationCode = parseAuthorizationFromText(raw);
  const hasReceiptSignal = /comprovante|valor|total|cr[eé]dito|d[eé]bito|cart[aã]o|cartao|mastercard|visa|elo|autoriz|transa[cç][aã]o|pdv|nfc/i.test(raw);
  if (!hasReceiptSignal || (!merchant && !amountCents && !date)) return null;
  return sanitizeExtractedReceipt({
    is_credit_card_receipt: /cr[eé]dito|cart[aã]o|cartao|mastercard|visa|elo/i.test(raw) || undefined,
    merchant: merchant || null,
    date: date || null,
    amount_cents: amountCents || null,
    installments: 1,
    card_hint: cardLast4 ? `final ${cardLast4}` : null,
    card_last4: cardLast4 || null,
    authorization_code: authorizationCode || null,
    raw_payment_method: paymentMethod || null,
    confidence: merchant && amountCents && date ? 'medium' : 'low',
    field_confidence: {
      merchant: merchant ? 'medium' : 'low',
      date: date ? 'medium' : 'low',
      amount: amountCents ? 'medium' : 'low',
      installments: 'low',
      card: cardLast4 ? 'medium' : 'low'
    },
    warnings: ['Extração recuperada do texto livre retornado pela IA; confirme antes de lançar.']
  });
}

function sanitizeExtractedReceipt(parsed = {}) {
  const amountCents = normalizeAmountCents(parsed.amount_cents ?? parsed.amountCents ?? parsed.amount ?? parsed.total_amount);
  return {
    is_credit_card_receipt: parsed.is_credit_card_receipt !== false,
    merchant: cleanDisplayText(parsed.merchant || parsed.establishment || parsed.estabelecimento || parsed.description || ''),
    date: normalizeDate(parsed.date || parsed.purchase_date || parsed.transaction_date || parsed.data || ''),
    amount_cents: amountCents > 0 ? amountCents : null,
    installments: normalizeInstallments(parsed.installments || parsed.parcelas || 1),
    card_hint: cleanDisplayText(parsed.card_hint || parsed.card || parsed.card_name || parsed.cartao || ''),
    card_last4: cleanDisplayText(parsed.card_last4 || parsed.last4 || ''),
    authorization_code: cleanDisplayText(parsed.authorization_code || parsed.authorization || parsed.autorizacao || ''),
    nsu: cleanDisplayText(parsed.nsu || ''),
    raw_payment_method: cleanDisplayText(parsed.raw_payment_method || parsed.payment_method || ''),
    confidence: normalizeConfidence(parsed.confidence || 'medium'),
    field_confidence: parsed.field_confidence && typeof parsed.field_confidence === 'object' ? parsed.field_confidence : {},
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map((item) => cleanDisplayText(item)).filter(Boolean) : []
  };
}

function missingRequiredFields(receipt = {}) {
  const missing = [];
  if (!receipt.merchant) missing.push('estabelecimento');
  if (!receipt.date) missing.push('data');
  if (!Number(receipt.amount_cents || 0)) missing.push('valor');
  return missing;
}

function hasAllRequiredReceiptFields(receipt = {}) {
  return missingRequiredFields(receipt).length === 0;
}

function missingCriticalReceiptFields(receipt = {}) {
  return missingRequiredFields(receipt).filter((field) => ['estabelecimento', 'data', 'valor'].includes(field));
}

function shouldKeepReceiptConversation(receipt = {}) {
  const missing = missingCriticalReceiptFields(receipt);
  if (!missing.length) return true;
  const presentCount = ['merchant', 'date', 'amount_cents'].filter((key) => {
    if (key === 'amount_cents') return Number(receipt.amount_cents || 0) > 0;
    return Boolean(receipt[key]);
  }).length;
  return presentCount >= 2;
}

function mergeReceiptFields(...items) {
  const output = {};
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    for (const [key, value] of Object.entries(item)) {
      if (value === undefined || value === null || value === '') continue;
      if (key === 'amount_cents' && !Number(value || 0)) continue;
      if (key === 'warnings') {
        const current = Array.isArray(output.warnings) ? output.warnings : [];
        output.warnings = [...current, ...(Array.isArray(value) ? value : [value])].filter(Boolean);
        continue;
      }
      if (key === 'field_confidence') {
        output.field_confidence = { ...(output.field_confidence || {}), ...(value || {}) };
        continue;
      }
      if (output[key] === undefined || output[key] === null || output[key] === '' || (key === 'amount_cents' && !Number(output[key] || 0))) {
        output[key] = value;
      }
    }
  }
  return sanitizeExtractedReceipt(output);
}

function enrichReceiptFromOcrText(receipt = {}, parsed = {}, plainText = '') {
  const ocrText = [
    plainText,
    parsed.ocr_text_excerpt,
    parsed.ocr_text,
    parsed.raw_text,
    parsed.transcription,
    parsed.transcricao,
    parsed.text
  ].filter(Boolean).join('\n');
  if (!ocrText.trim()) return receipt;
  const fallback = buildReceiptFromPlainText(ocrText);
  return fallback ? mergeReceiptFields(receipt, fallback) : receipt;
}

function isReceiptConversationAbort(value = '') {
  const text = normalizeText(value);
  return /^(cancelar|cancela|cancelado|desistir|desisto|desisti|descartar|descarta|parar|para|sair|voltar|deixa|deixa pra la|deixa para la|esquece|nao quero|não quero|mudei de assunto)$/i.test(text)
    || text.includes('pode cancelar')
    || text.includes('quero cancelar')
    || text.includes('quero desistir')
    || text.includes('mudei de assunto')
    || text.includes('deixa pra la')
    || text.includes('deixa para la')
    || text.includes('esquece isso');
}

function looksLikeReceiptNewTopic(value = '') {
  const text = normalizeText(value);
  if (!text || isReceiptConversationAbort(text) || isAffirmative(text)) return false;
  return /^(oi|ola|olá|bom dia|boa tarde|boa noite|ajuda|menu)$/i.test(text)
    || /(ultimas compras|ultimos lancamentos|listar.*compras|lista.*compras|minhas compras|gastos?|gastei|fatura|resumo|quem me deve|o que devo|lembrete|central de acertos|fechamento|categoria|pdf)/i.test(text)
    || /(nova compra|comprei|lancar|lançar|cadastrar|registrar|adicionar|corrigir uma compra|apagar uma compra|dividir uma compra)/i.test(text);
}

function cardOptionsText(cards = []) {
  if (!Array.isArray(cards) || !cards.length) return '';
  return cards.map((card, index) => `${index + 1}. ${card.name || card.label || `Cartão #${card.id}`}`).join('\n');
}

function buildPurchasePayloadFromReceipt(receipt = {}) {
  return {
    date: receipt.date,
    description: receipt.merchant,
    amount_cents: Number(receipt.amount_cents || 0),
    installments: normalizeInstallments(receipt.installments || 1),
    is_recurring: false,
    purchase_category_id: null,
    card_hint: receipt.card_hint || null,
    receipt_staging_id: receipt.receipt_staging_id || null
  };
}

function buildReceiptConfirmationText({ receipt, card = null, cardAmbiguous = false, cardMatches = [], similar = null, missingCard = false } = {}) {
  const lines = [
    '🧾 *Li o comprovante assim:*',
    '',
    `Compra: *${receipt.merchant || 'não consegui ler'}*`,
    `Valor: *${formatBRLFromCents(receipt.amount_cents || 0)}*`,
    receipt.date ? `Data: *${dayjs(receipt.date).format('DD/MM/YYYY')}*` : 'Data: *não consegui ler*',
    `Parcelas: *${normalizeInstallments(receipt.installments || 1)}x*`
  ];
  if (card) {
    lines.push(`Cartão identificado: *${card.name}*`);
  } else if (receipt.card_hint) {
    lines.push(`Cartão lido no comprovante: *${receipt.card_hint}*`);
  } else {
    lines.push('Cartão: *não encontrei no comprovante*');
  }
  if (cardAmbiguous && cardMatches.length) {
    lines.push('', 'Achei mais de um cartão possível:', cardOptionsText(cardMatches));
  }
  if (similar) {
    lines.push('', `⚠️ Já existe uma compra parecida em *${dayjs(similar.txn_date).format('DD/MM/YYYY')}*: ${similar.description} por ${formatBRLFromCents(similar.amount_cents)}.`);
  }
  lines.push('');
  if (missingCard || cardAmbiguous) {
    lines.push('Me diz qual cartão foi ou responde *cancelar* para descartar. Se estiver tudo certo e eu ainda precisar escolher o cartão, responda *confirmar* que eu te mostro as opções.');
  } else {
    lines.push('Responde *confirmar* para eu lançar ou me diga o que corrigir. Ex.: *corrigir valor para 42,26*.');
  }
  return lines.join('\n');
}

function buildMissingDetailsText(receipt = {}, missing = []) {
  return [
    '🧾 Consegui ler parte do comprovante, mas faltou uma informação importante.',
    '',
    receipt.merchant ? `Compra: *${receipt.merchant}*` : '',
    receipt.amount_cents ? `Valor: *${formatBRLFromCents(receipt.amount_cents)}*` : '',
    receipt.date ? `Data: *${dayjs(receipt.date).format('DD/MM/YYYY')}*` : '',
    receipt.installments ? `Parcelas: *${receipt.installments}x*` : '',
    '',
    `Me confirma: *${missing.join(', ')}*.`,
    'Se preferir parar por aqui, responde *cancelar*.'
  ].filter(Boolean).join('\n');
}

function buildReceiptParseFailedText() {
  return [
    'Não consegui ler os dados principais desse comprovante com segurança.',
    '',
    'Para não te prender numa confirmação ruim, descartei essa tentativa.',
    'Você pode mandar outra foto mais nítida ou registrar por texto, tipo:',
    '*Nova compra hoje de R$ 42,26 no Inter em Rede Economia*.'
  ].join('\n');
}

function isAffirmative(value = '') {
  const text = normalizeText(value);
  return /^(sim|s|confirmar|confirmo|ok|pode|isso|isso mesmo|correto|confere|lançar|lancar)$/i.test(text)
    || text.includes('pode lancar')
    || text.includes('pode lançar')
    || text.includes('confirmar');
}

function isNegative(value = '') {
  const text = normalizeText(value);
  return /^(nao|não|n|cancelar|cancela|cancelado|desistir|desisto|desisti|descartar|descarta|parar|para|sair|voltar|deixa|deixa pra la|deixa para la|esquece|nao quero|não quero)$/i.test(text)
    || text.includes('cancela')
    || text.includes('cancelar')
    || text.includes('desist')
    || text.includes('descartar')
    || text.includes('parar')
    || text.includes('deixa pra la')
    || text.includes('deixa para la')
    || text.includes('esquece')
    || text.includes('nao quero')
    || text.includes('não quero');
}

function parseCorrections(rawText = {}, reply = {}) {
  const text = String(rawText || reply.text || reply.raw_text || '').trim();
  const normalized = normalizeText(text);
  const patch = {};
  const amountMatch = text.match(/(?:valor|total)\s*(?:para|de|é|e)?\s*(?:r\$\s*)?(\d{1,6}(?:[.,]\d{2})?)/i)
    || text.match(/(?:r\$\s*)?(\d{1,6}[,.]\d{2})/i);
  if (amountMatch) patch.amount_cents = normalizeAmountCents(amountMatch[1]);

  const dateMatch = text.match(/(?:data|dia)\s*(?:para|de|é|e)?\s*(\d{1,2}[\/.-]\d{1,2}(?:[\/.-]\d{2,4})?)/i)
    || text.match(/(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4})/i);
  if (dateMatch) patch.date = normalizeDate(dateMatch[1]);

  const installmentsMatch = normalized.match(/(?:parcela|parcelas|parcelamento)\s*(?:para|de|em|é|e)?\s*(\d{1,3})/i)
    || normalized.match(/(\d{1,3})\s*x/);
  if (installmentsMatch) patch.installments = normalizeInstallments(installmentsMatch[1]);

  const cardMatch = text.match(/(?:cart[aã]o|cartao)\s*(?:para|de|é|e|foi|no|na)?\s*([\wÀ-ÿ0-9 .'-]{2,80})/i);
  if (cardMatch) patch.card_hint = cleanDisplayText(cardMatch[1].replace(/^(foi|no|na)\s+/i, ''));

  const merchantMatch = text.match(/(?:compra|estabelecimento|loja|descri[cç][aã]o)\s*(?:para|de|é|e|foi)?\s*([\wÀ-ÿ0-9 .,&'-]{2,120})/i);
  if (merchantMatch) patch.merchant = cleanDisplayText(merchantMatch[1]);

  if (!patch.card_hint && !patch.amount_cents && !patch.date && !patch.merchant && !patch.installments && normalized && !isAffirmative(normalized) && !isNegative(normalized)) {
    const cardLike = text.replace(/^(cart[aã]o|cartao)\s*/i, '').trim();
    if (cardLike && cardLike.length <= 80 && !/\d+[,.]\d{2}/.test(cardLike)) patch.card_hint = cleanDisplayText(cardLike);
  }

  if (reply && typeof reply === 'object') {
    if (reply.amount_cents || reply.amount) patch.amount_cents = normalizeAmountCents(reply.amount_cents ?? reply.amount);
    if (reply.date) patch.date = normalizeDate(reply.date);
    if (reply.installments) patch.installments = normalizeInstallments(reply.installments);
    if (reply.card_hint || reply.card) patch.card_hint = cleanDisplayText(reply.card_hint || reply.card);
    if (reply.merchant || reply.description) patch.merchant = cleanDisplayText(reply.merchant || reply.description);
  }
  return patch;
}

function buildReceiptExtractionPrompt({ retry = false, focused = false } = {}) {
  const base = [
    'Você é um extrator de dados de comprovantes de cartão brasileiros.',
    'Responda somente JSON válido, sem markdown e sem texto fora do JSON.',
    'Extraia os dados financeiros do comprovante enviado na imagem.',
    'Nunca invente cartão, parcelamento, valor, estabelecimento ou data.',
    'O valor deve ser o valor total da compra. Ignore troco, subtotal, desconto e saldo.',
    'A data deve ser a data da transação. Se houver data de impressão e data de transação, use a data da transação.',
    'Se não houver parcelamento claro, use 1 apenas quando o comprovante indicar crédito à vista ou não houver pista de parcelas.',
    'Não retorne número completo de cartão. Se houver só final, use card_last4.',
    'Se a imagem não for comprovante de cartão, retorne is_credit_card_receipt=false.',
    'Padrões comuns em comprovantes de maquininha brasileiros:',
    '- estabelecimento pode aparecer no topo ou na linha logo antes da data/hora;',
    '- valor pode aparecer como VALOR:, TOTAL:, Crédito Self R$, Credito R$ ou somente R$ 42,26;',
    '- data pode aparecer como 11/06/2026, 11.06.26-17:08 ou 11/06/2026 17:08:39;',
    '- CNPJ/CPF, cidade, rede, Sitef, autorização, ARQC e AID não são o estabelecimento;',
    '- se aparecer SUPERMERCADOS FEIRA NOVA LTDA ou SUPERMERC FEIRA NOVA, isso é o estabelecimento.'
  ];
  if (retry || focused) {
    base.push(
      'A imagem pode estar amassada, com baixo contraste ou parcialmente borrada.',
      'Mesmo assim, retorne os campos que estiverem legíveis e use confidence low ou medium quando houver dúvida.',
      'Não rejeite a imagem apenas por qualidade se valor, data ou estabelecimento estiverem parcialmente legíveis.',
      'Leia também textos de baixa resolução e abreviações de cupom/maquininha.',
      'Use warnings para dúvidas e campos incertos.'
    );
  }
  if (focused) {
    base.push(
      'Faça uma leitura focada nos três campos principais: estabelecimento, data e valor.',
      'Se conseguir ler uma linha parecida com "VALOR: 42,26", amount_cents deve ser 4226.',
      'Se conseguir ler uma linha parecida com "11.06.26-17:08", date deve ser 2026-06-11.',
      'Inclua em ocr_text_excerpt um trecho curto das linhas que você usou para decidir.'
    );
  }
  base.push('Formato exato:', JSON.stringify({
    is_credit_card_receipt: true,
    merchant: 'string ou null',
    date: 'YYYY-MM-DD ou null',
    amount_cents: 4226,
    installments: 1,
    card_hint: 'string ou null',
    card_last4: 'string ou null',
    authorization_code: 'string ou null',
    nsu: 'string ou null',
    raw_payment_method: 'string ou null',
    ocr_text_excerpt: 'string curta ou null',
    confidence: 'high|medium|low',
    field_confidence: { merchant: 'high|medium|low', date: 'high|medium|low', amount: 'high|medium|low', installments: 'high|medium|low', card: 'high|medium|low' },
    warnings: []
  }));
  return base.join('\n');
}

async function callGeminiReceiptAttempt({ apiKey, model, file, caption, retry = false, focused = false } = {}) {
  const prompt = buildReceiptExtractionPrompt({ retry, focused });
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const generationConfig = {
    temperature: 0,
    maxOutputTokens: retry || focused ? 1400 : 900
  };
  if (!retry && !focused) generationConfig.responseMimeType = 'application/json';
  const response = await axios.post(url, {
    contents: [{
      role: 'user',
      parts: [
        { text: caption ? `${prompt}\n\nLegenda do usuário: ${caption}` : prompt },
        { inline_data: { mime_type: file.mimetype || 'image/jpeg', data: file.buffer.toString('base64') } }
      ]
    }],
    generationConfig
  }, { timeout: retry || focused ? 60000 : 45000 });
  const text = extractGeminiText(response);
  const parsed = normalizeReceiptPayload(safeJsonParse(text, null));
  return {
    text,
    parsed,
    meta: extractGeminiMeta(response),
    retry,
    focused
  };
}

function attemptToReceipt(attempt) {
  if (!attempt) return null;
  if (attempt.parsed) {
    return enrichReceiptFromOcrText(sanitizeExtractedReceipt(attempt.parsed), attempt.parsed, attempt.text);
  }
  return buildReceiptFromPlainText(attempt.text);
}

function buildReceiptParseFailureDetails(attempts = []) {
  return {
    provider: 'gemini',
    attempts: attempts.map((attempt, index) => ({
      index: index + 1,
      retry: Boolean(attempt?.retry),
      focused: Boolean(attempt?.focused),
      parsed_json: Boolean(attempt?.parsed),
      text_excerpt: compactLogText(attempt?.text || '', 700),
      meta: attempt?.meta || null
    }))
  };
}

async function callGeminiForReceipt({ apiKey, model, file, caption, debugEnabled = false }) {
  const attempts = [];
  const receipts = [];

  const first = await callGeminiReceiptAttempt({ apiKey, model, file, caption, retry: false });
  attempts.push(first);
  let receipt = attemptToReceipt(first);
  if (receipt) {
    receipts.push(receipt);
    if (hasAllRequiredReceiptFields(receipt)) return receipt;
  }

  const second = await callGeminiReceiptAttempt({ apiKey, model, file, caption, retry: true });
  attempts.push(second);
  receipt = attemptToReceipt(second);
  if (receipt) {
    receipts.push(receipt);
    const merged = mergeReceiptFields(...receipts);
    if (hasAllRequiredReceiptFields(merged)) return merged;
  }

  const mergedAfterTwo = receipts.length ? mergeReceiptFields(...receipts) : null;
  if (mergedAfterTwo && shouldKeepReceiptConversation(mergedAfterTwo)) return mergedAfterTwo;

  const third = await callGeminiReceiptAttempt({ apiKey, model, file, caption, retry: true, focused: true });
  attempts.push(third);
  receipt = attemptToReceipt(third);
  if (receipt) receipts.push(receipt);

  const merged = receipts.length ? mergeReceiptFields(...receipts) : null;
  if (merged) {
    if (hasAllRequiredReceiptFields(merged) || shouldKeepReceiptConversation(merged)) return merged;
  }

  throw new ReceiptPurchaseAutomationError(buildReceiptParseFailedText(), {
    code: 'RECEIPT_IMAGE_PARSE_FAILED',
    statusCode: 422,
    details: debugEnabled ? buildReceiptParseFailureDetails(attempts) : null
  });
}

function buildCardOptions(cards = []) {
  return cards.map((card, index) => ({
    id: Number(card.id || 0),
    name: card.name,
    label: card.name,
    brand: card.brand || null,
    option: index + 1
  }));
}

function createAutomationReceiptPurchasesService(deps = {}) {
  const repository = deps.receiptPurchasesRepository || createAutomationReceiptPurchasesRepository();
  const purchaseService = deps.purchaseService || createPurchaseCreationService({ repository });

  function assertApiEnabled() {
    if (!repository.getBooleanSetting('AUTOMATION_API_ENABLED', false)) {
      throw new ReceiptPurchaseAutomationError('A API de automações está desligada no AcerttaPay.', {
        code: 'AUTOMATION_DISABLED',
        statusCode: 503
      });
    }
  }

  function assertFeatureEnabled() {
    if (!repository.isReceiptImageEnabled()) {
      throw new ReceiptPurchaseAutomationError('Compra por imagem ainda está desligada no AcerttaPay. Ative nas configurações antes de testar pelo WhatsApp.', {
        code: 'RECEIPT_IMAGE_DISABLED',
        statusCode: 503
      });
    }
  }

  function buildErrorDebug(error) {
    if (!repository.isDebugEnabled()) return null;
    return {
      name: error?.name || 'Error',
      code: error?.code || null,
      message: error?.message || null,
      stack: String(error?.stack || '').split('\n').slice(0, 8).join('\n') || null
    };
  }

  function handleServiceError(error) {
    const debug = buildErrorDebug(error);
    const responseMeta = {
      error_name: error?.name || 'Error',
      error_code: error?.code || null,
      error_message: error?.message || null,
      debug_enabled: Boolean(debug)
    };
    if (error instanceof ReceiptPurchaseAutomationError || error instanceof PurchaseCreationError) {
      return makeResult({
        ok: false,
        code: error.code || 'RECEIPT_PURCHASE_VALIDATION_ERROR',
        message: error.message,
        details: error.details || null,
        whatsapp: { text: error.message },
        response_meta: responseMeta,
        ...(debug ? { debug } : {})
      }, error.statusCode || 400);
    }
    return makeResult({
      ok: false,
      code: error.code || 'RECEIPT_PURCHASE_INTERNAL_ERROR',
      message: error.message || 'A leitura do comprovante tropeçou por aqui. Tenta de novo em instantes.',
      whatsapp: { text: 'A leitura do comprovante tropeçou por aqui. Tenta de novo em instantes.' },
      response_meta: responseMeta,
      ...(debug ? { debug } : {})
    }, error.statusCode || 500);
  }

  function resolveAuthorizedPhone(phone) {
    const normalized = normalizeAutomationPhone(phone);
    if (!normalized.ok) {
      throw new ReceiptPurchaseAutomationError(normalized.reason || 'Telefone inválido.', { code: 'INVALID_PHONE', statusCode: 400 });
    }
    const authorization = repository.getAuthorizationByPhone(normalized.e164, normalized.whatsappNumber);
    if (!authorization || Number(authorization.enabled || 0) === 0 || String(authorization.user_status || 'active') === 'deleted') {
      throw new ReceiptPurchaseAutomationError('Esse número ainda não está liberado no AcerttaPay. Ative o WhatsApp nas Configurações do app.', {
        code: 'NOT_AUTHORIZED',
        statusCode: 403
      });
    }
    const user = repository.getUserById(authorization.user_id);
    if (!user) throw new ReceiptPurchaseAutomationError('Não encontrei esse usuário no AcerttaPay.', { code: 'USER_NOT_FOUND', statusCode: 404 });
    repository.touchAuthorization(authorization.id);
    return { user, phone: normalized, authorization };
  }

  function executeIdempotent({ userId, channel = 'whatsapp', idempotencyKey, operation, hashPayload, fn }) {
    const key = String(idempotencyKey || '').trim();
    if (!key) {
      throw new ReceiptPurchaseAutomationError('Idempotency-Key é obrigatório para compra por imagem.', {
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        statusCode: 400
      });
    }
    const idempotency = repository.tryCreateIdempotency({
      userId,
      channel,
      idempotencyKey: key,
      operation,
      requestHash: repository.makeRequestHash(hashPayload || {})
    });
    if (!idempotency.created) {
      const cached = repository.safeJsonParse(idempotency.row?.response_json, null);
      if (cached) return makeResult({ ...cached, duplicate: true }, 200);
      throw new ReceiptPurchaseAutomationError('Essa imagem já está sendo processada. Não dupliquei a leitura.', {
        code: 'IDEMPOTENCY_IN_PROGRESS',
        statusCode: 409
      });
    }
    try {
      const response = fn();
      if (response && typeof response.then === 'function') {
        return response.then((asyncResponse) => {
          repository.finishIdempotency({ channel, idempotencyKey: key, response: asyncResponse, status: asyncResponse.ok ? 'success' : 'completed' });
          return asyncResponse;
        }).catch((error) => {
          const errorResponse = handleServiceError(error);
          repository.finishIdempotency({ channel, idempotencyKey: key, response: errorResponse, status: 'error' });
          throw error;
        });
      }
      repository.finishIdempotency({ channel, idempotencyKey: key, response, status: response.ok ? 'success' : 'completed' });
      return response;
    } catch (error) {
      const errorResponse = handleServiceError(error);
      repository.finishIdempotency({ channel, idempotencyKey: key, response: errorResponse, status: 'error' });
      throw error;
    }
  }

  function withHandling(payload, meta, operation, fn) {
    let resolved = null;
    const channel = payload.source?.channel || payload.channel || 'whatsapp';
    const sourceMessageId = payload.source?.message_id || payload.message_id || null;
    try {
      assertApiEnabled();
      assertFeatureEnabled();
      repository.cleanupExpiredStaging();
      resolved = resolveAuthorizedPhone(payload.phone || payload.user_phone || payload.number);
      const result = fn(resolved);
      if (result && typeof result.then === 'function') {
        return result.then((asyncResult) => {
          repository.logRequest({
            userId: resolved.user.id,
            phoneE164: resolved.phone.e164,
            channel,
            operation,
            statusCode: asyncResult.statusCode,
            resultCode: asyncResult.code,
            sourceMessageId,
            ipAddress: meta?.ipAddress || null,
            responseMeta: asyncResult.response_meta || {}
          });
          return asyncResult;
        }).catch((error) => {
          const response = handleServiceError(error);
          repository.logRequest({
            userId: resolved?.user?.id || null,
            phoneE164: resolved?.phone?.e164 || null,
            channel,
            operation,
            statusCode: response.statusCode,
            resultCode: response.code,
            sourceMessageId,
            ipAddress: meta?.ipAddress || null,
            responseMeta: response.response_meta || {}
          });
          return response;
        });
      }
      repository.logRequest({
        userId: resolved.user.id,
        phoneE164: resolved.phone.e164,
        channel,
        operation,
        statusCode: result.statusCode,
        resultCode: result.code,
        sourceMessageId,
        ipAddress: meta?.ipAddress || null,
        responseMeta: result.response_meta || {}
      });
      return result;
    } catch (error) {
      const response = handleServiceError(error);
      repository.logRequest({
        userId: resolved?.user?.id || null,
        phoneE164: resolved?.phone?.e164 || null,
        channel,
        operation,
        statusCode: response.statusCode,
        resultCode: response.code,
        sourceMessageId,
        ipAddress: meta?.ipAddress || null,
        responseMeta: response.response_meta || {}
      });
      return response;
    }
  }

  function resolveReceiptCard(userId, receipt = {}) {
    const activeCards = repository.getActiveCards(userId);
    const cardHint = cleanDisplayText(receipt.card_hint || '');
    if (!cardHint) return { card: null, cardHint: '', ambiguous: false, matches: [], activeCards };
    const match = repository.findCardByHint(userId, cardHint);
    return {
      card: match.card || null,
      cardHint,
      ambiguous: match.ambiguous,
      matches: match.matches || [],
      activeCards
    };
  }

  function createCardSelectionConversation({ userId, phoneE164, receipt, source, cards, stagingId }) {
    const purchase = buildPurchasePayloadFromReceipt({ ...receipt, receipt_staging_id: stagingId });
    const options = buildCardOptions(cards);
    const conversation = repository.createConversationState({
      userId,
      phoneE164,
      channel: source?.channel || 'whatsapp',
      state: 'awaiting_card_choice',
      payload: { purchase, source, cards: options, receipt_staging_id: stagingId }
    });
    return makeResult({
      ok: false,
      code: 'NEEDS_CARD_SELECTION',
      conversation: {
        id: Number(conversation.id || 0),
        state: conversation.state,
        expires_at: conversation.expires_at
      },
      cards: options,
      whatsapp: { text: `Não fechei o cartão desse comprovante. Qual cartão foi?\n${options.map((card) => `${card.option}. ${card.label}`).join('\n')}` }
    }, 200);
  }

  function createPurchaseWithCard({ resolved, receipt, source, cardId, stagingId }) {
    const purchase = buildPurchasePayloadFromReceipt({ ...receipt, receipt_staging_id: stagingId });
    const created = purchaseService.createAutomationPurchase({
      userId: resolved.user.id,
      purchase: { ...purchase, card_id: cardId },
      source,
      cardId,
      assignToSelf: true
    });
    repository.markStagingConsumed(resolved.user.id, stagingId, created.id);
    const conversation = repository.createConversationState({
      userId: resolved.user.id,
      phoneE164: resolved.phone.e164,
      channel: source?.channel || 'whatsapp',
      state: 'awaiting_split_confirmation',
      relatedPurchaseId: created.id,
      payload: {
        purchase_id: created.id,
        transaction_ids: created.transaction_ids,
        description: created.description,
        amount_cents: created.amount_cents,
        card_name: created.card_name,
        source
      }
    });
    return makeResult({
      ok: true,
      code: 'RECEIPT_PURCHASE_CREATED',
      purchase: {
        id: created.id,
        root_transaction_id: created.root_transaction_id,
        transaction_ids: created.transaction_ids,
        description: created.description,
        amount_cents: created.amount_cents,
        installments: created.installments,
        card_id: created.card_id,
        card_name: created.card_name,
        due_month: created.due_month,
        due_year: created.due_year
      },
      conversation: {
        id: Number(conversation.id || 0),
        state: conversation.state,
        related_purchase_id: Number(conversation.related_purchase_id || 0) || null,
        expires_at: conversation.expires_at
      },
      whatsapp: { text: `Compra lançada pelo comprovante: *${created.description}* por *${formatBRLFromCents(created.amount_cents)}* no *${created.card_name}*. Quer definir os participantes dessa compra?` }
    }, 200);
  }

  function buildConversationForReceipt({ resolved, payload, receipt, staging, statusCode = 202 } = {}) {
    const cardInfo = resolveReceiptCard(resolved.user.id, receipt);
    const missing = missingRequiredFields(receipt);
    const source = payload.source || {};
    const similar = repository.findSimilarPurchase(resolved.user.id, {
      description: receipt.merchant,
      date: receipt.date,
      amount_cents: receipt.amount_cents
    });

    if (!receipt.is_credit_card_receipt) {
      repository.updateStagingParsed(resolved.user.id, staging.id, { parsed: receipt, confidence: receipt.confidence, status: 'waiting_details' });
      return makeResult({
        ok: false,
        code: 'RECEIPT_IMAGE_NOT_CREDIT_CARD_RECEIPT',
        receipt,
        staging: { id: staging.id, expires_at: staging.expires_at },
        whatsapp: { text: 'Não consegui identificar isso como comprovante de cartão. Me manda uma foto mais nítida do comprovante inteiro, ou registra a compra por texto.' }
      }, 422);
    }

    if (missing.length) {
      if (!shouldKeepReceiptConversation(receipt)) {
        repository.updateStagingParsed(resolved.user.id, staging.id, { parsed: receipt, confidence: receipt.confidence, status: 'parse_failed' });
        return makeResult({
          ok: false,
          code: 'RECEIPT_IMAGE_PARSE_FAILED',
          receipt,
          staging: { id: staging.id, expires_at: staging.expires_at },
          missing,
          whatsapp: { text: buildReceiptParseFailedText() },
          response_meta: { provider: 'gemini', model: repository.getGeminiModel(), confidence: receipt.confidence, missing_fields: missing, receipt_staging_id: staging.id }
        }, 422);
      }
      const updated = repository.updateStagingParsed(resolved.user.id, staging.id, { parsed: receipt, confidence: receipt.confidence, status: 'waiting_details' });
      const conversation = repository.createConversationState({
        userId: resolved.user.id,
        phoneE164: resolved.phone.e164,
        channel: source.channel || payload.channel || 'whatsapp',
        state: 'awaiting_receipt_purchase_details',
        ttlMinutes: repository.getStagingTtlMinutes(),
        payload: {
          kind: 'receipt_image_purchase',
          staging_id: staging.id,
          receipt,
          missing,
          source
        }
      });
      return makeResult({
        ok: false,
        code: 'NEEDS_RECEIPT_PURCHASE_DETAILS',
        receipt,
        staging: { id: updated.id, expires_at: updated.expires_at },
        missing,
        conversation: { id: Number(conversation.id || 0), state: conversation.state, expires_at: conversation.expires_at },
        whatsapp: { text: buildMissingDetailsText(receipt, missing) },
        response_meta: { provider: 'gemini', model: repository.getGeminiModel(), confidence: receipt.confidence, missing_fields: missing, receipt_staging_id: staging.id }
      }, statusCode);
    }

    const updated = repository.updateStagingParsed(resolved.user.id, staging.id, { parsed: receipt, confidence: receipt.confidence, status: 'waiting_confirmation' });
    const conversation = repository.createConversationState({
      userId: resolved.user.id,
      phoneE164: resolved.phone.e164,
      channel: source.channel || payload.channel || 'whatsapp',
      state: 'awaiting_receipt_purchase_confirmation',
      ttlMinutes: repository.getStagingTtlMinutes(),
      payload: {
        kind: 'receipt_image_purchase',
        staging_id: staging.id,
        receipt,
        source,
        card_hint: receipt.card_hint || null,
        suggested_card_id: cardInfo.card?.id || null,
        missing_card: !cardInfo.card,
        duplicate_purchase_id: similar?.id || null
      }
    });
    return makeResult({
      ok: false,
      code: 'NEEDS_RECEIPT_PURCHASE_CONFIRMATION',
      receipt,
      card: cardInfo.card ? { id: Number(cardInfo.card.id || 0), name: cardInfo.card.name } : null,
      staging: { id: updated.id, expires_at: updated.expires_at },
      conversation: { id: Number(conversation.id || 0), state: conversation.state, expires_at: conversation.expires_at },
      whatsapp: { text: buildReceiptConfirmationText({ receipt, card: cardInfo.card, cardAmbiguous: cardInfo.ambiguous, cardMatches: cardInfo.matches, similar, missingCard: !cardInfo.card }) },
      response_meta: { provider: 'gemini', model: repository.getGeminiModel(), confidence: receipt.confidence, missing_fields: [], receipt_staging_id: staging.id }
    }, statusCode);
  }

  async function prepareReceiptImagePurchase(payload = {}, meta = {}) {
    const file = fileFromPayload(payload);
    const channel = payload.source?.channel || payload.channel || 'whatsapp';
    const sourceMessageId = payload.source?.message_id || payload.message_id || null;
    const idempotencyKey = String(meta.idempotencyKey || payload.idempotency_key || '').trim();

    return withHandling(payload, meta, 'purchase.receipt_image.prepare', (resolved) => executeIdempotent({
      userId: resolved.user.id,
      channel,
      idempotencyKey,
      operation: 'purchase.receipt_image.prepare',
      hashPayload: {
        phone: resolved.phone.e164,
        sourceMessageId,
        filename: file?.originalname || null,
        size: file?.size || null,
        caption: payload.caption || null
      },
      fn: async () => {
        validateImageFile(file, repository);
        const apiKey = repository.getGeminiApiKey();
        const model = repository.getGeminiModel();
        if (!apiKey) {
          throw new ReceiptPurchaseAutomationError('Chave da Gemini não configurada para ler comprovantes. Configure AUTOMATION_RECEIPT_IMAGE_GEMINI_API_KEY ou STATEMENT_PDF_GEMINI_API_KEY.', {
            code: 'RECEIPT_IMAGE_PROVIDER_NOT_READY',
            statusCode: 503
          });
        }
        const sha256 = file.sha256 || require('crypto').createHash('sha256').update(file.buffer).digest('hex');
        const existing = repository.getOpenStagingByHash(resolved.user.id, sha256);
        if (existing?.parsed && Object.keys(existing.parsed || {}).length) {
          return buildConversationForReceipt({ resolved, payload, receipt: sanitizeExtractedReceipt(existing.parsed), staging: existing, statusCode: 202 });
        }
        const staging = repository.createStaging({
          userId: resolved.user.id,
          phoneE164: resolved.phone.e164,
          whatsappNumber: resolved.phone.whatsappNumber,
          channel,
          file,
          sha256,
          sourceMessageId,
          sourceMeta: { source: payload.source || {}, caption: payload.caption || null },
          caption: payload.caption || null,
          providerKey: 'gemini',
          providerModel: model,
          status: 'extracting'
        });
        let receipt;
        try {
          receipt = await callGeminiForReceipt({ apiKey, model, file, caption: payload.caption || payload.source?.raw_text || '', debugEnabled: repository.isDebugEnabled() });
        } catch (error) {
          repository.updateStagingParsed(resolved.user.id, staging.id, { parsed: { error: error.message, code: error.code || null, details: error.details || null }, confidence: 'low', status: 'waiting_details' });
          throw error;
        }
        return buildConversationForReceipt({ resolved, payload, receipt, staging, statusCode: 202 });
      }
    }));
  }

  function handleConversationReply(payload = {}, meta = {}) {
    const channel = payload.source?.channel || payload.channel || 'whatsapp';
    const idempotencyKey = String(meta.idempotencyKey || payload.idempotency_key || '').trim();
    return withHandling(payload, meta, 'purchase.receipt_image.reply', (resolved) => executeIdempotent({
      userId: resolved.user.id,
      channel,
      idempotencyKey,
      operation: 'purchase.receipt_image.reply',
      hashPayload: {
        phone: resolved.phone.e164,
        reply: payload.reply || null,
        raw_text: payload.source?.raw_text || payload.message_text || payload.text || ''
      },
      fn: () => {
        const conversation = repository.getOpenConversationForUser(resolved.user.id, resolved.phone.e164);
        if (!conversation || !['awaiting_receipt_purchase_confirmation', 'awaiting_receipt_purchase_details'].includes(conversation.state)) {
          throw new ReceiptPurchaseAutomationError('Não encontrei um comprovante esperando confirmação por aqui.', {
            code: 'RECEIPT_PURCHASE_CONVERSATION_NOT_FOUND',
            statusCode: 404
          });
        }
        const data = repository.getConversationPayload(conversation) || {};
        const stagingId = Number(data.staging_id || payload.staging_id || 0);
        const staging = repository.getStagingByIdForUser(resolved.user.id, stagingId);
        if (!staging || !['extracting', 'waiting_confirmation', 'waiting_details'].includes(staging.status)) {
          repository.resolveConversationState(conversation.id);
          throw new ReceiptPurchaseAutomationError('Esse comprovante não está mais disponível. Me manda a imagem de novo para eu recomeçar.', {
            code: 'RECEIPT_IMAGE_STAGING_EXPIRED',
            statusCode: 410
          });
        }
        if (new Date(staging.expires_at).getTime() <= Date.now()) {
          repository.cancelStaging(resolved.user.id, staging.id);
          repository.resolveConversationState(conversation.id);
          throw new ReceiptPurchaseAutomationError('Esse comprovante expirou antes da confirmação. Me manda a imagem de novo para eu recomeçar.', {
            code: 'RECEIPT_IMAGE_STAGING_EXPIRED',
            statusCode: 410
          });
        }
        const rawText = payload.source?.raw_text || payload.message_text || payload.text || payload.reply?.text || '';
        const reply = payload.reply || {};
        let receipt = sanitizeExtractedReceipt({ ...(staging.parsed || data.receipt || {}) });
        if (looksLikeReceiptNewTopic(rawText) || reply.intent === 'new_topic') {
          repository.cancelStaging(resolved.user.id, staging.id);
          repository.resolveConversationState(conversation.id);
          return makeResult({
            ok: true,
            code: 'RECEIPT_PURCHASE_INTERRUPTED',
            whatsapp: { text: 'Parei a leitura daquele comprovante para não misturar assuntos. Me manda o novo pedido do jeito que você quer seguir.' }
          });
        }
        if (isNegative(rawText) || isReceiptConversationAbort(rawText) || reply.confirm === false || reply.intent === 'cancel_receipt_purchase') {
          repository.cancelStaging(resolved.user.id, staging.id);
          repository.resolveConversationState(conversation.id);
          return makeResult({
            ok: true,
            code: 'RECEIPT_PURCHASE_CANCELLED',
            whatsapp: { text: 'Fechado, descartei esse comprovante. Nenhuma compra foi lançada.' }
          });
        }

        const patch = parseCorrections(rawText, reply);
        if (Object.keys(patch).length) {
          receipt = sanitizeExtractedReceipt({ ...receipt, ...patch });
          const updated = repository.updateStagingParsed(resolved.user.id, staging.id, { parsed: receipt, confidence: receipt.confidence, status: 'waiting_confirmation' });
          return buildConversationForReceipt({ resolved, payload: { ...payload, source: data.source || payload.source || {} }, receipt, staging: updated, statusCode: 200 });
        }

        if (!isAffirmative(rawText) && reply.confirm !== true && conversation.state === 'awaiting_receipt_purchase_confirmation') {
          return makeResult({
            ok: false,
            code: 'NEEDS_RECEIPT_PURCHASE_CONFIRMATION',
            conversation: { id: Number(conversation.id || 0), state: conversation.state, expires_at: conversation.expires_at },
            whatsapp: { text: 'Para lançar essa compra, responde *confirmar*. Para corrigir, manda algo como *corrigir valor para 42,26*. Para desistir, responde *cancelar*.' }
          });
        }

        const missing = missingRequiredFields(receipt);
        if (missing.length) {
          return makeResult({
            ok: false,
            code: 'NEEDS_RECEIPT_PURCHASE_DETAILS',
            missing,
            conversation: { id: Number(conversation.id || 0), state: conversation.state, expires_at: conversation.expires_at },
            whatsapp: { text: buildMissingDetailsText(receipt, missing) }
          }, 422);
        }

        const cardInfo = resolveReceiptCard(resolved.user.id, receipt);
        const source = data.source || payload.source || {};
        repository.resolveConversationState(conversation.id);
        if (!cardInfo.card) {
          return createCardSelectionConversation({
            userId: resolved.user.id,
            phoneE164: resolved.phone.e164,
            receipt,
            source,
            cards: cardInfo.activeCards,
            stagingId: staging.id
          });
        }
        return createPurchaseWithCard({
          resolved,
          receipt,
          source,
          cardId: cardInfo.card.id,
          stagingId: staging.id
        });
      }
    }));
  }

  return {
    prepareReceiptImagePurchase,
    handleConversationReply,
    handleServiceError
  };
}

module.exports = {
  ReceiptPurchaseAutomationError,
  createAutomationReceiptPurchasesService
};
