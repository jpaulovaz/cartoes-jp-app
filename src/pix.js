const { normalizePixState } = require('./brazil-locations');

function stripDiacritics(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

const PIX_KEY_TYPE_LABELS = {
  cpf: 'CPF',
  cnpj: 'CNPJ',
  email: 'E-mail',
  phone: 'Celular',
  evp: 'Chave aleatória'
};

function normalizePixKeyType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['cpf'].includes(normalized)) return 'cpf';
  if (['cnpj'].includes(normalized)) return 'cnpj';
  if (['email', 'e-mail'].includes(normalized)) return 'email';
  if (['phone', 'telefone', 'celular'].includes(normalized)) return 'phone';
  if (['evp', 'aleatoria', 'aleatória', 'chave_aleatoria', 'chave-aleatoria'].includes(normalized)) return 'evp';
  return null;
}

function sanitizePixText(value, { max = 25, fallback = '' } = {}) {
  const normalized = stripDiacritics(value)
    .toUpperCase()
    .replace(/[^A-Z0-9 $%*+\-./:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const sliced = normalized.slice(0, Math.max(0, Number(max || 0))).trim();
  return sliced || fallback;
}

function normalizePixPhoneKeyValue(value) {
  const raw = String(value || '').trim();
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';

  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) {
    return `+${digits}`;
  }

  if (digits.length === 10 || digits.length === 11) {
    return `+55${digits}`;
  }

  if (raw.startsWith('+')) {
    return `+${digits}`;
  }

  return `+${digits}`;
}

function normalizePixKeyValue(type, value) {
  const keyType = normalizePixKeyType(type);
  const raw = String(value || '').trim();
  if (!keyType) return '';

  if (keyType === 'cpf' || keyType === 'cnpj') {
    return raw.replace(/\D/g, '');
  }

  if (keyType === 'email') {
    return raw.toLowerCase();
  }

  if (keyType === 'phone') {
    return normalizePixPhoneKeyValue(raw);
  }

  if (keyType === 'evp') {
    return raw.toLowerCase();
  }

  return raw;
}

function formatPixKeyValueForInput(keyType, keyValue) {
  const type = normalizePixKeyType(keyType);
  const value = String(keyValue || '').trim();
  if (!type || !value) return '';

  if (type === 'phone') {
    const digits = value.replace(/\D/g, '');
    if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) {
      return digits.slice(2);
    }
    return digits;
  }

  return value;
}

function isValidPixKey(keyType, keyValue) {
  const type = normalizePixKeyType(keyType);
  const value = String(keyValue || '').trim();
  if (!type || !value) return false;

  switch (type) {
    case 'cpf':
      return /^\d{11}$/.test(value);
    case 'cnpj':
      return /^\d{14}$/.test(value);
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    case 'phone':
      return /^\+55\d{10,11}$/.test(value);
    case 'evp':
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
    default:
      return false;
  }
}

function maskPixKey({ keyType, keyValue } = {}) {
  const type = normalizePixKeyType(keyType);
  const value = String(keyValue || '').trim();
  if (!type || !value) return 'Não configurada';

  if (type === 'cpf') {
    return value.replace(/^(\d{3})\d{5}(\d{3})$/, '$1•••••$2');
  }

  if (type === 'cnpj') {
    return value.replace(/^(\d{2})\d{8}(\d{4})$/, '$1••••••••$2');
  }

  if (type === 'email') {
    const [local, domain] = value.split('@');
    if (!local || !domain) return '••••';
    const safeLocal = local.length <= 2
      ? `${local.charAt(0)}•`
      : `${local.slice(0, 2)}•••`;
    return `${safeLocal}@${domain}`;
  }

  if (type === 'phone') {
    const digits = value.replace(/\D/g, '');
    if (digits.length < 8) return '••••';
    return `+${digits.slice(0, 4)}••••${digits.slice(-3)}`;
  }

  if (type === 'evp') {
    if (value.length <= 12) return `${value.slice(0, 4)}••••`;
    return `${value.slice(0, 8)}••••${value.slice(-4)}`;
  }

  return '••••';
}

function validatePixProfile({ enabled, keyType, keyValue, city, state, label, name } = {}) {
  const pixEnabled = enabled === true || enabled === '1' || enabled === 1 || enabled === 'true' || enabled === 'on';
  const normalizedType = normalizePixKeyType(keyType);
  const normalizedKeyValue = normalizePixKeyValue(normalizedType, keyValue);
  const normalizedState = normalizePixState(state);
  const normalizedCity = sanitizePixText(city, { max: 15 });
  const merchantName = sanitizePixText(label || name || 'ORGANIZAPAY', { max: 25, fallback: 'ORGANIZAPAY' });
  const errors = [];

  if (pixEnabled) {
    if (!normalizedType) errors.push('Escolha o tipo da chave Pix.');
    if (!normalizedKeyValue) {
      errors.push('Preencha a chave Pix.');
    } else if (!isValidPixKey(normalizedType, normalizedKeyValue)) {
      if (normalizedType === 'phone') {
        errors.push('Para celular, use DDD + número. O +55 entra por nossa conta.');
      } else {
        errors.push('Essa chave Pix não parece válida.');
      }
    }
    if (!normalizedCity) errors.push('Escolha a cidade para o Pix.');
  }

  return {
    enabled: pixEnabled,
    valid: pixEnabled && errors.length === 0,
    errors,
    reason: errors[0] || null,
    keyType: normalizedType,
    keyTypeLabel: normalizedType ? (PIX_KEY_TYPE_LABELS[normalizedType] || normalizedType) : null,
    keyValue: normalizedKeyValue,
    keyValueInput: formatPixKeyValueForInput(normalizedType, normalizedKeyValue),
    keyMasked: maskPixKey({ keyType: normalizedType, keyValue: normalizedKeyValue }),
    city: normalizedCity,
    state: normalizedState,
    merchantName,
    label: sanitizePixText(label, { max: 25 }) || null
  };
}

function emv(id, value) {
  const safeValue = String(value || '');
  return `${String(id)}${safeValue.length.toString().padStart(2, '0')}${safeValue}`;
}

function crc16(payload) {
  let crc = 0xFFFF;
  for (let i = 0; i < payload.length; i += 1) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j += 1) {
      if ((crc & 0x8000) !== 0) {
        crc = (crc << 1) ^ 0x1021;
      } else {
        crc <<= 1;
      }
      crc &= 0xFFFF;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function sanitizeTxid(value) {
  const raw = String(value || '').trim();
  if (!raw) return '***';
  const safe = stripDiacritics(raw)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 25);
  return safe || '***';
}

function buildPixPayload({ keyType, keyValue, merchantName, merchantCity, amountCents, txid, description } = {}) {
  const profile = validatePixProfile({
    enabled: true,
    keyType,
    keyValue,
    city: merchantCity,
    label: merchantName,
    name: merchantName
  });

  if (!profile.valid) {
    throw new Error(profile.reason || 'Não consegui montar esse Pix agora.');
  }

  const merchantAccountFields = [
    emv('00', 'br.gov.bcb.pix'),
    emv('01', profile.keyValue)
  ];

  const safeDescription = sanitizePixText(description, { max: 72 });
  if (safeDescription) {
    merchantAccountFields.push(emv('02', safeDescription));
  }

  const fields = [
    emv('00', '01'),
    emv('26', merchantAccountFields.join('')),
    emv('52', '0000'),
    emv('53', '986')
  ];

  const cents = Math.max(0, Number(amountCents || 0));
  if (cents > 0) {
    fields.push(emv('54', (cents / 100).toFixed(2)));
  }

  fields.push(
    emv('58', 'BR'),
    emv('59', profile.merchantName),
    emv('60', profile.city),
    emv('62', emv('05', sanitizeTxid(txid)))
  );

  const partialPayload = `${fields.join('')}6304`;
  return `${partialPayload}${crc16(partialPayload)}`;
}

function buildSharedDebtPixTxid(requestId, version = 0) {
  const safeRequestId = Math.max(0, Number(requestId || 0));
  const safeVersion = Math.max(0, Number(version || 0));
  return sanitizeTxid(`OPAYAV${safeRequestId.toString(36)}${safeVersion ? `V${safeVersion.toString(36)}` : ''}`);
}

function buildSharedDebtCardMonthlyPixTxid(settlementId, intentId = 0) {
  const safeSettlementId = Math.max(0, Number(settlementId || 0));
  const safeIntentId = Math.max(0, Number(intentId || 0));
  return sanitizeTxid(`OPAYCM${safeSettlementId.toString(36)}${safeIntentId ? `I${safeIntentId.toString(36)}` : ''}`);
}

module.exports = {
  PIX_KEY_TYPE_LABELS,
  normalizePixKeyType,
  normalizePixKeyValue,
  formatPixKeyValueForInput,
  validatePixProfile,
  maskPixKey,
  sanitizePixText,
  sanitizeTxid,
  buildPixPayload,
  buildSharedDebtPixTxid,
  buildSharedDebtCardMonthlyPixTxid
};
