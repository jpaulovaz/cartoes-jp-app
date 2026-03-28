let phoneLib = null;
try {
  phoneLib = require('libphonenumber-js/max');
} catch (error) {
  phoneLib = null;
}

const DEFAULT_PHONE_COUNTRY = 'BR';
const PREFERRED_PHONE_COUNTRIES = ['BR', 'PT', 'US', 'AR', 'CL', 'UY', 'PY', 'MX', 'CA', 'GB', 'ES', 'FR', 'DE', 'IT', 'JP'];
const FALLBACK_COUNTRY_OPTIONS = [
  { code: 'BR', name: 'Brasil', callingCode: '55' },
  { code: 'PT', name: 'Portugal', callingCode: '351' },
  { code: 'US', name: 'Estados Unidos', callingCode: '1' },
  { code: 'AR', name: 'Argentina', callingCode: '54' },
  { code: 'CL', name: 'Chile', callingCode: '56' },
  { code: 'UY', name: 'Uruguai', callingCode: '598' },
  { code: 'PY', name: 'Paraguai', callingCode: '595' },
  { code: 'MX', name: 'Mexico', callingCode: '52' },
  { code: 'CA', name: 'Canada', callingCode: '1' },
  { code: 'GB', name: 'Reino Unido', callingCode: '44' },
  { code: 'ES', name: 'Espanha', callingCode: '34' },
  { code: 'FR', name: 'Franca', callingCode: '33' },
  { code: 'DE', name: 'Alemanha', callingCode: '49' },
  { code: 'IT', name: 'Italia', callingCode: '39' },
  { code: 'JP', name: 'Japao', callingCode: '81' },
  { code: 'AU', name: 'Australia', callingCode: '61' }
];

const supportedCountries = phoneLib && typeof phoneLib.getCountries === 'function'
  ? new Set(phoneLib.getCountries())
  : new Set(FALLBACK_COUNTRY_OPTIONS.map((option) => option.code));

const regionDisplayNames = typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function'
  ? new Intl.DisplayNames(['pt-BR', 'en'], { type: 'region' })
  : null;

let phoneCountryOptionsCache = null;

function normalizeCountryCode(value, fallback = DEFAULT_PHONE_COUNTRY) {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized && supportedCountries.has(normalized)) return normalized;
  return String(fallback || DEFAULT_PHONE_COUNTRY).trim().toUpperCase() || DEFAULT_PHONE_COUNTRY;
}

function getFallbackCountryRecord(countryCode) {
  const safeCountryCode = normalizeCountryCode(countryCode);
  return FALLBACK_COUNTRY_OPTIONS.find((entry) => entry.code === safeCountryCode) || null;
}

function getCountryCallingCodeSafe(countryCode) {
  const safeCountryCode = normalizeCountryCode(countryCode);
  if (phoneLib && typeof phoneLib.getCountryCallingCode === 'function') {
    try {
      return String(phoneLib.getCountryCallingCode(safeCountryCode) || '').trim();
    } catch (error) {
      // usa fallback logo abaixo
    }
  }

  return String(getFallbackCountryRecord(safeCountryCode)?.callingCode || '').trim();
}

function countryFlagEmoji(countryCode) {
  const safeCountryCode = String(countryCode || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(safeCountryCode)) return '🌍';
  return Array.from(safeCountryCode)
    .map((char) => String.fromCodePoint(127397 + char.charCodeAt(0)))
    .join('');
}

function getCountryName(countryCode) {
  const safeCountryCode = normalizeCountryCode(countryCode);
  if (regionDisplayNames) {
    try {
      const label = regionDisplayNames.of(safeCountryCode);
      if (label) return label;
    } catch (error) {
      // usa fallback logo abaixo
    }
  }

  return getFallbackCountryRecord(safeCountryCode)?.name || safeCountryCode;
}

function buildPhoneCountryOptions() {
  if (phoneCountryOptionsCache) return phoneCountryOptionsCache;

  const preferredSet = new Set(PREFERRED_PHONE_COUNTRIES);
  const preferredOrder = new Map(PREFERRED_PHONE_COUNTRIES.map((code, index) => [code, index]));
  const baseCodes = phoneLib && typeof phoneLib.getCountries === 'function'
    ? phoneLib.getCountries()
    : FALLBACK_COUNTRY_OPTIONS.map((option) => option.code);

  const codes = Array.from(new Set([DEFAULT_PHONE_COUNTRY, ...baseCodes]))
    .map((code) => normalizeCountryCode(code))
    .filter((code) => Boolean(getCountryCallingCodeSafe(code)));

  const options = codes.map((code) => {
    const callingCode = getCountryCallingCodeSafe(code);
    if (!callingCode) return null;
    const flag = countryFlagEmoji(code);
    const name = getCountryName(code);
    return {
      code,
      name,
      callingCode,
      flag,
      preferred: preferredSet.has(code),
      label: `${flag} ${name} (+${callingCode})`
    };
  }).filter(Boolean);

  const preferredOptions = options
    .filter((option) => option.preferred)
    .sort((a, b) => (preferredOrder.get(a.code) ?? 999) - (preferredOrder.get(b.code) ?? 999));
  const otherOptions = options
    .filter((option) => !option.preferred)
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  phoneCountryOptionsCache = [...preferredOptions, ...otherOptions];
  return phoneCountryOptionsCache;
}

function getPhoneCountryOption(countryCode) {
  const safeCountryCode = normalizeCountryCode(countryCode);
  return buildPhoneCountryOptions().find((option) => option.code === safeCountryCode) || {
    code: safeCountryCode,
    name: getCountryName(safeCountryCode),
    callingCode: getCountryCallingCodeSafe(safeCountryCode),
    flag: countryFlagEmoji(safeCountryCode),
    preferred: false,
    label: `${countryFlagEmoji(safeCountryCode)} ${getCountryName(safeCountryCode)} (+${getCountryCallingCodeSafe(safeCountryCode)})`
  };
}

function cleanPhoneText(rawPhone) {
  return String(rawPhone || '').trim();
}

function extractDigits(rawPhone) {
  return String(rawPhone || '').replace(/\D/g, '');
}

function parsePhoneNumberSafe(rawPhone, options = {}) {
  if (!phoneLib || typeof phoneLib.parsePhoneNumberFromString !== 'function') return null;
  const safePhone = cleanPhoneText(rawPhone);
  if (!safePhone) return null;

  try {
    return phoneLib.parsePhoneNumberFromString(safePhone, { extract: false, ...options }) || null;
  } catch (error) {
    return null;
  }
}

function isPossiblePhoneNumberObject(phoneNumber) {
  if (!phoneNumber) return false;
  if (typeof phoneNumber.isPossible === 'function') {
    try {
      return phoneNumber.isPossible();
    } catch (error) {
      return false;
    }
  }
  return false;
}

function isValidPhoneNumberObject(phoneNumber) {
  if (!phoneNumber) return false;
  if (typeof phoneNumber.isValid === 'function') {
    try {
      return phoneNumber.isValid();
    } catch (error) {
      return false;
    }
  }
  return isPossiblePhoneNumberObject(phoneNumber);
}

function formatBrazilNationalPhone(digits) {
  const safeDigits = extractDigits(digits);
  if (!safeDigits) return '';

  let localDigits = safeDigits;
  if ((localDigits.length === 12 || localDigits.length === 13) && localDigits.startsWith('55')) {
    localDigits = localDigits.slice(2);
  }

  if (localDigits.length === 11) {
    return `(${localDigits.slice(0, 2)}) ${localDigits.slice(2, 7)}-${localDigits.slice(7)}`;
  }

  if (localDigits.length === 10) {
    return `(${localDigits.slice(0, 2)}) ${localDigits.slice(2, 6)}-${localDigits.slice(6)}`;
  }

  if (localDigits.length > 2) {
    return `(${localDigits.slice(0, 2)}) ${localDigits.slice(2)}`;
  }

  return localDigits;
}

function formatFallbackPhone(rawPhone, countryCode) {
  const safeCountryCode = normalizeCountryCode(countryCode);
  if (safeCountryCode === 'BR') {
    return formatBrazilNationalPhone(rawPhone);
  }
  return cleanPhoneText(rawPhone);
}

function prependCallingCodeIfMissing(digits, countryCode) {
  const safeDigits = extractDigits(digits);
  if (!safeDigits) return '';

  const callingCode = getCountryCallingCodeSafe(countryCode);
  if (!callingCode) return safeDigits;

  if (safeDigits.startsWith(callingCode) && safeDigits.length > callingCode.length + 5) {
    return safeDigits;
  }

  return `${callingCode}${safeDigits}`;
}

function parseStoredPhone(rawPhone, { fallbackCountry = DEFAULT_PHONE_COUNTRY } = {}) {
  const raw = cleanPhoneText(rawPhone);
  const resolvedCountry = normalizeCountryCode(fallbackCountry);
  if (!raw) {
    return { phoneNumber: null, raw: '', countryCode: resolvedCountry };
  }

  if (!phoneLib) {
    return { phoneNumber: null, raw, countryCode: resolvedCountry };
  }

  if (raw.startsWith('+')) {
    const direct = parsePhoneNumberSafe(raw);
    if (direct) {
      return {
        phoneNumber: direct,
        raw,
        countryCode: normalizeCountryCode(direct.country || resolvedCountry)
      };
    }
  }

  const digits = extractDigits(raw);
  if (digits.length >= 8) {
    const internationalCandidate = parsePhoneNumberSafe(`+${digits}`);
    if (internationalCandidate && (isValidPhoneNumberObject(internationalCandidate) || isPossiblePhoneNumberObject(internationalCandidate))) {
      return {
        phoneNumber: internationalCandidate,
        raw,
        countryCode: normalizeCountryCode(internationalCandidate.country || resolvedCountry)
      };
    }
  }

  const localCandidate = parsePhoneNumberSafe(raw, { defaultCountry: resolvedCountry });
  if (localCandidate && (isValidPhoneNumberObject(localCandidate) || isPossiblePhoneNumberObject(localCandidate))) {
    return {
      phoneNumber: localCandidate,
      raw,
      countryCode: normalizeCountryCode(localCandidate.country || resolvedCountry)
    };
  }

  if (digits && digits !== raw) {
    const localDigitsCandidate = parsePhoneNumberSafe(digits, { defaultCountry: resolvedCountry });
    if (localDigitsCandidate && (isValidPhoneNumberObject(localDigitsCandidate) || isPossiblePhoneNumberObject(localDigitsCandidate))) {
      return {
        phoneNumber: localDigitsCandidate,
        raw,
        countryCode: normalizeCountryCode(localDigitsCandidate.country || resolvedCountry)
      };
    }
  }

  return { phoneNumber: null, raw, countryCode: resolvedCountry };
}

function buildPhoneFieldState(storedPhone, { fallbackCountry = DEFAULT_PHONE_COUNTRY } = {}) {
  const raw = cleanPhoneText(storedPhone);
  const resolvedCountry = normalizeCountryCode(fallbackCountry);
  if (!raw) {
    return {
      raw: '',
      e164: '',
      countryCode: resolvedCountry,
      countryCallingCode: getCountryCallingCodeSafe(resolvedCountry),
      nationalValue: '',
      display: '',
      valid: false
    };
  }

  const parsed = parseStoredPhone(raw, { fallbackCountry: resolvedCountry });
  if (parsed.phoneNumber) {
    const phoneNumber = parsed.phoneNumber;
    const countryCode = normalizeCountryCode(phoneNumber.country || parsed.countryCode || resolvedCountry);
    let nationalValue = String(phoneNumber.nationalNumber || '').trim();

    if (phoneLib && typeof phoneLib.AsYouType === 'function' && nationalValue) {
      try {
        nationalValue = new phoneLib.AsYouType(countryCode).input(nationalValue) || nationalValue;
      } catch (error) {
        // mantem o nationalValue cru
      }
    }

    let display = String(phoneNumber.number || '').trim();
    if (typeof phoneNumber.formatInternational === 'function') {
      try {
        display = phoneNumber.formatInternational() || display;
      } catch (error) {
        // mantem a versao E.164
      }
    }

    return {
      raw,
      e164: String(phoneNumber.number || '').trim(),
      countryCode,
      countryCallingCode: getCountryCallingCodeSafe(countryCode),
      nationalValue,
      display,
      valid: isValidPhoneNumberObject(phoneNumber)
    };
  }

  return {
    raw,
    e164: raw.startsWith('+') ? `+${extractDigits(raw)}` : '',
    countryCode: resolvedCountry,
    countryCallingCode: getCountryCallingCodeSafe(resolvedCountry),
    nationalValue: formatFallbackPhone(raw, resolvedCountry),
    display: formatFallbackPhone(raw, resolvedCountry) || raw,
    valid: false
  };
}

function normalizePhoneForStorage(rawPhone, countryCode, { allowEmpty = true } = {}) {
  const raw = cleanPhoneText(rawPhone);
  const resolvedCountry = normalizeCountryCode(countryCode);

  if (!raw) {
    return {
      ok: allowEmpty,
      value: '',
      countryCode: resolvedCountry,
      display: '',
      nationalValue: '',
      whatsappNumber: ''
    };
  }

  if (!phoneLib) {
    const digits = extractDigits(raw);
    if (!digits || digits.length < 8) {
      return {
        ok: false,
        reason: 'Nao consegui entender esse telefone ainda. Confere o pais e o numero e tenta de novo.',
        countryCode: resolvedCountry
      };
    }

    const e164Digits = raw.startsWith('+') ? extractDigits(raw) : prependCallingCodeIfMissing(digits, resolvedCountry);
    const e164 = e164Digits ? `+${e164Digits}` : '';
    const fieldState = buildPhoneFieldState(e164, { fallbackCountry: resolvedCountry });
    return {
      ok: Boolean(e164),
      value: e164,
      countryCode: resolvedCountry,
      display: fieldState.display,
      nationalValue: fieldState.nationalValue,
      whatsappNumber: e164Digits
    };
  }

  const directCandidate = raw.startsWith('+') ? parsePhoneNumberSafe(raw) : null;
  const localCandidate = directCandidate || parsePhoneNumberSafe(raw, { defaultCountry: resolvedCountry }) || parsePhoneNumberSafe(extractDigits(raw), { defaultCountry: resolvedCountry });

  let phoneNumber = localCandidate;
  if (!phoneNumber && !raw.startsWith('+')) {
    const digits = extractDigits(raw);
    if (digits.length >= 8) {
      const intlCandidate = parsePhoneNumberSafe(`+${digits}`);
      if (intlCandidate && isValidPhoneNumberObject(intlCandidate)) {
        phoneNumber = intlCandidate;
      }
    }
  }

  if (!phoneNumber) {
    return {
      ok: false,
      reason: 'Nao consegui entender esse telefone ainda. Confere o pais e o numero e tenta de novo.',
      countryCode: resolvedCountry
    };
  }

  const detectedCountry = normalizeCountryCode(phoneNumber.country || resolvedCountry);
  if (!isPossiblePhoneNumberObject(phoneNumber)) {
    return {
      ok: false,
      reason: `Esse telefone parece curto ou longo demais para ${getCountryName(detectedCountry)} (+${getCountryCallingCodeSafe(detectedCountry)}). Da mais uma conferida?`,
      countryCode: detectedCountry
    };
  }

  if (!isValidPhoneNumberObject(phoneNumber)) {
    return {
      ok: false,
      reason: `Esse telefone nao fechou certinho para ${getCountryName(detectedCountry)} (+${getCountryCallingCodeSafe(detectedCountry)}). Confere o DDI e o numero e tenta de novo.`,
      countryCode: detectedCountry
    };
  }

  const fieldState = buildPhoneFieldState(phoneNumber.number, { fallbackCountry: detectedCountry });
  return {
    ok: true,
    value: String(phoneNumber.number || '').trim(),
    countryCode: detectedCountry,
    display: fieldState.display,
    nationalValue: fieldState.nationalValue,
    whatsappNumber: String(phoneNumber.number || '').replace(/\D/g, '')
  };
}

function normalizePhoneForWhatsapp(rawPhone, { fallbackCountry = DEFAULT_PHONE_COUNTRY } = {}) {
  const raw = cleanPhoneText(rawPhone);
  const resolvedCountry = normalizeCountryCode(fallbackCountry);
  if (!raw) {
    return {
      ok: false,
      reason: 'Essa pessoa ainda nao tem um telefone valido para envio.'
    };
  }

  const stored = parseStoredPhone(raw, { fallbackCountry: resolvedCountry });
  if (stored.phoneNumber) {
    const normalizedNumber = String(stored.phoneNumber.number || '').replace(/\D/g, '');
    if (normalizedNumber) {
      return {
        ok: true,
        number: normalizedNumber,
        e164: String(stored.phoneNumber.number || '').trim(),
        countryCode: normalizeCountryCode(stored.phoneNumber.country || resolvedCountry)
      };
    }
  }

  if (!phoneLib) {
    const digits = extractDigits(raw);
    if (digits.length < 8) {
      return {
        ok: false,
        reason: 'Esse telefone ainda nao esta num formato que o WhatsApp aceite. Confere o DDI e o celular e tenta de novo.'
      };
    }

    const normalizedDigits = raw.startsWith('+') ? digits : prependCallingCodeIfMissing(digits, resolvedCountry);
    return {
      ok: Boolean(normalizedDigits),
      number: normalizedDigits,
      e164: normalizedDigits ? `+${normalizedDigits}` : '',
      countryCode: resolvedCountry
    };
  }

  const strict = normalizePhoneForStorage(raw, resolvedCountry, { allowEmpty: false });
  if (strict.ok && strict.whatsappNumber) {
    return {
      ok: true,
      number: strict.whatsappNumber,
      e164: strict.value,
      countryCode: strict.countryCode
    };
  }

  return {
    ok: false,
    reason: strict.reason || 'Esse telefone ainda nao esta num formato que o WhatsApp aceite. Confere o DDI e o celular e tenta de novo.'
  };
}

function decoratePersonPhoneForView(person, { fallbackCountry = DEFAULT_PHONE_COUNTRY } = {}) {
  if (!person || typeof person !== 'object') return person;
  const phoneState = buildPhoneFieldState(person.phone, { fallbackCountry });
  return {
    ...person,
    phone_ui_country: phoneState.countryCode,
    phone_ui_national: phoneState.nationalValue,
    phone_display: phoneState.display,
    phone_e164: phoneState.e164,
    phone_search_text: [person.phone, phoneState.display, phoneState.e164, phoneState.nationalValue].filter(Boolean).join(' ')
  };
}

module.exports = {
  DEFAULT_PHONE_COUNTRY,
  buildPhoneCountryOptions,
  getPhoneCountryOption,
  normalizePhoneForStorage,
  normalizePhoneForWhatsapp,
  buildPhoneFieldState,
  decoratePersonPhoneForView
};
