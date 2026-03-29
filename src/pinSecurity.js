const crypto = require('crypto');

const APP_PIN_MIN_LENGTH = 4;
const APP_PIN_MAX_LENGTH = 6;
const APP_PIN_DEFAULT_IDLE_SECONDS = 60;
const APP_PIN_REAUTH_WINDOW_SECONDS = 10 * 60;
const APP_PIN_IDLE_OPTIONS = [
  { value: 0, label: 'Ao sair do app' },
  { value: 30, label: '30 segundos' },
  { value: 60, label: '1 minuto' },
  { value: 120, label: '2 minutos' },
  { value: 300, label: '5 minutos' },
  { value: 600, label: '10 minutos' },
  { value: 900, label: '15 minutos' },
  { value: 1800, label: '30 minutos' }
];

const APP_PIN_IDLE_OPTION_VALUES = new Set(APP_PIN_IDLE_OPTIONS.map((option) => Number(option.value)));

function normalizePinDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function validatePinInput(value) {
  const normalized = normalizePinDigits(value);

  if (!normalized) {
    return { ok: false, value: '', reason: 'Antes de salvar, me passa um PIN numérico para eu proteger seu app direitinho.' };
  }

  if (normalized.length < APP_PIN_MIN_LENGTH || normalized.length > APP_PIN_MAX_LENGTH) {
    return {
      ok: false,
      value: normalized,
      reason: `Seu PIN precisa ter de ${APP_PIN_MIN_LENGTH} a ${APP_PIN_MAX_LENGTH} dígitos numéricos.`
    };
  }

  return { ok: true, value: normalized };
}

function normalizePinIdleSeconds(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return APP_PIN_DEFAULT_IDLE_SECONDS;
  const rounded = Math.max(0, Math.floor(numeric));
  return APP_PIN_IDLE_OPTION_VALUES.has(rounded) ? rounded : APP_PIN_DEFAULT_IDLE_SECONDS;
}

function getPinIdleOptionLabel(seconds) {
  const normalized = normalizePinIdleSeconds(seconds);
  return APP_PIN_IDLE_OPTIONS.find((option) => Number(option.value) === normalized)?.label || '1 minuto';
}

function createPinHash(pin, { salt, pepper = '' }) {
  const safePin = normalizePinDigits(pin);
  const safeSalt = String(salt || '').trim();
  const safePepper = String(pepper || '');
  if (!safePin || !safeSalt) return '';
  return crypto.scryptSync(`${safePepper}:${safePin}`, safeSalt, 64).toString('hex');
}

function buildStoredPinPayload(pin, { pepper = '' } = {}) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = createPinHash(pin, { salt, pepper });
  return {
    salt,
    hash,
    kdf: 'scrypt-v1'
  };
}

function verifyStoredPin(pin, stored, { pepper = '' } = {}) {
  const hash = createPinHash(pin, { salt: stored?.salt, pepper });
  const current = Buffer.from(String(hash || ''), 'hex');
  const expected = Buffer.from(String(stored?.hash || ''), 'hex');
  if (!current.length || current.length !== expected.length) return false;
  return crypto.timingSafeEqual(current, expected);
}

module.exports = {
  APP_PIN_MIN_LENGTH,
  APP_PIN_MAX_LENGTH,
  APP_PIN_DEFAULT_IDLE_SECONDS,
  APP_PIN_REAUTH_WINDOW_SECONDS,
  APP_PIN_IDLE_OPTIONS,
  normalizePinDigits,
  validatePinInput,
  normalizePinIdleSeconds,
  getPinIdleOptionLabel,
  buildStoredPinPayload,
  verifyStoredPin
};
