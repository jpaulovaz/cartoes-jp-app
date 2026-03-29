const crypto = require('crypto');

const APP_PIN_MIN_LENGTH = 4;
const APP_PIN_MAX_LENGTH = 6;
const APP_PIN_DEFAULT_IDLE_SECONDS = 60;
const APP_PIN_REAUTH_WINDOW_SECONDS = 10 * 60;
const APP_PIN_MAX_ATTEMPTS_BEFORE_REAUTH = 10;
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
const APP_PIN_COMMON_BLOCKLIST = new Set([
  '0000', '1111', '1212', '1234', '12345', '123456', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999',
  '000000', '0101', '1010', '111111', '112233', '121212', '123123', '1313', '2000', '2020', '202020', '2468', '2580',
  '4321', '543210', '654321', '6969', '7410', '7890', '8080', '9090', '9876', '987654'
]);

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

function isStraightPinSequence(value) {
  const digits = String(value || '').trim();
  if (!digits || digits.length < APP_PIN_MIN_LENGTH) return false;
  const numbers = digits.split('').map((char) => Number(char));
  if (numbers.some((digit) => !Number.isInteger(digit))) return false;

  let ascending = true;
  let descending = true;
  for (let index = 1; index < numbers.length; index += 1) {
    if (numbers[index] !== numbers[index - 1] + 1) ascending = false;
    if (numbers[index] !== numbers[index - 1] - 1) descending = false;
  }
  return ascending || descending;
}

function isRepeatedPinPattern(value) {
  const digits = String(value || '').trim();
  if (!digits) return false;
  if (/^(\d)\1+$/.test(digits)) return true;
  if (/^(\d\d)\1+$/.test(digits)) return true;
  if (/^(\d\d\d)\1+$/.test(digits)) return true;
  return false;
}

function validateNewPinInput(value) {
  const prepared = validatePinInput(value);
  if (!prepared.ok) return prepared;

  if (APP_PIN_COMMON_BLOCKLIST.has(prepared.value) || isStraightPinSequence(prepared.value) || isRepeatedPinPattern(prepared.value)) {
    return {
      ok: false,
      value: prepared.value,
      reason: 'Esse PIN ficou fácil demais de adivinhar. Escolhe outro sem sequência óbvia, tipo 1234, 0000 ou repetições parecidas.'
    };
  }

  return prepared;
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

function formatPinCooldownLabel(seconds) {
  const totalSeconds = Math.max(0, Math.ceil(Number(seconds || 0) || 0));
  if (!totalSeconds) return 'agora';
  if (totalSeconds < 60) return `${totalSeconds} segundo${totalSeconds === 1 ? '' : 's'}`;
  const totalMinutes = Math.ceil(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes} minuto${totalMinutes === 1 ? '' : 's'}`;
  const totalHours = Math.ceil(totalMinutes / 60);
  return `${totalHours} hora${totalHours === 1 ? '' : 's'}`;
}

function getPinFailurePolicy(failedAttempts) {
  const attempts = Math.max(0, Math.floor(Number(failedAttempts || 0) || 0));

  if (attempts >= APP_PIN_MAX_ATTEMPTS_BEFORE_REAUTH) {
    return {
      failedAttempts: attempts,
      cooldownSeconds: 0,
      cooldownLabel: '',
      requiresReauth: true
    };
  }

  let cooldownSeconds = 0;
  if (attempts >= 9) cooldownSeconds = 1800;
  else if (attempts >= 8) cooldownSeconds = 900;
  else if (attempts >= 7) cooldownSeconds = 300;
  else if (attempts >= 6) cooldownSeconds = 60;
  else if (attempts >= 5) cooldownSeconds = 30;

  return {
    failedAttempts: attempts,
    cooldownSeconds,
    cooldownLabel: cooldownSeconds > 0 ? formatPinCooldownLabel(cooldownSeconds) : '',
    requiresReauth: false
  };
}

module.exports = {
  APP_PIN_MIN_LENGTH,
  APP_PIN_MAX_LENGTH,
  APP_PIN_DEFAULT_IDLE_SECONDS,
  APP_PIN_REAUTH_WINDOW_SECONDS,
  APP_PIN_MAX_ATTEMPTS_BEFORE_REAUTH,
  APP_PIN_IDLE_OPTIONS,
  normalizePinDigits,
  validatePinInput,
  validateNewPinInput,
  normalizePinIdleSeconds,
  getPinIdleOptionLabel,
  buildStoredPinPayload,
  verifyStoredPin,
  getPinFailurePolicy,
  formatPinCooldownLabel
};
