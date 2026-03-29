const crypto = require('crypto');

let simpleWebAuthnServer = null;
try {
  simpleWebAuthnServer = require('@simplewebauthn/server');
} catch (_error) {
  simpleWebAuthnServer = null;
}

const PASSKEY_MAX_CREDENTIALS_PER_USER = 6;
const PASSKEY_CHALLENGE_MAX_AGE_MS = 5 * 60 * 1000;
const PASSKEY_RP_NAME = String(process.env.APP_PASSKEY_RP_NAME || process.env.WEBAUTHN_RP_NAME || 'AcerttaPay').trim() || 'AcerttaPay';
const PASSKEY_SUPPORTED_ALGORITHM_IDS = [-8, -7, -257];
const PASSKEY_RUNTIME_AVAILABLE = !!simpleWebAuthnServer;

function bufferToBase64Url(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input || []);
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlToBuffer(value) {
  const safe = String(value || '').trim();
  if (!safe) return Buffer.alloc(0);
  const normalized = safe.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, 'base64');
}

function getPasskeyServerApi() {
  if (!simpleWebAuthnServer) return null;
  return {
    generateRegistrationOptions: simpleWebAuthnServer.generateRegistrationOptions,
    verifyRegistrationResponse: simpleWebAuthnServer.verifyRegistrationResponse,
    generateAuthenticationOptions: simpleWebAuthnServer.generateAuthenticationOptions,
    verifyAuthenticationResponse: simpleWebAuthnServer.verifyAuthenticationResponse
  };
}

function getRequestProtocol(req) {
  const headerCandidates = [
    req?.get?.('x-forwarded-proto'),
    req?.get?.('x-forwarded-scheme'),
    req?.get?.('x-url-scheme')
  ];

  for (const candidate of headerCandidates) {
    const normalized = String(candidate || '').split(',')[0].trim().toLowerCase();
    if (normalized) return normalized;
  }

  const cfVisitor = String(req?.get?.('cf-visitor') || '').trim();
  if (/\"scheme\"\s*:\s*\"https\"/i.test(cfVisitor)) return 'https';
  if (/\"scheme\"\s*:\s*\"http\"/i.test(cfVisitor)) return 'http';

  if (req?.protocol) return String(req.protocol).trim().toLowerCase();
  return req?.secure ? 'https' : 'http';
}

function getRequestHost(req) {
  const headerCandidates = [
    req?.get?.('x-forwarded-host'),
    req?.get?.('x-original-host'),
    req?.get?.('host')
  ];

  for (const candidate of headerCandidates) {
    const normalized = String(candidate || '').split(',')[0].trim();
    if (normalized) return normalized;
  }

  return '';
}

function normalizeHostname(value) {
  return String(value || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
}

function isLoopbackHostname(hostname) {
  const safeHost = normalizeHostname(hostname);
  return safeHost === 'localhost' || safeHost === '127.0.0.1' || safeHost === '::1';
}

function normalizePasskeyRpId(value) {
  const safeValue = String(value || '').trim();
  if (!safeValue) return '';

  try {
    const candidateUrl = safeValue.includes('://') ? safeValue : `https://${safeValue}`;
    return normalizeHostname(new URL(candidateUrl).hostname);
  } catch (_error) {
    return normalizeHostname(safeValue.replace(/^https?:\/\//i, '').split('/')[0].split(':')[0]);
  }
}

function resolveRequestOrigin(req) {
  const explicitOrigin = String(process.env.APP_PASSKEY_ORIGIN || process.env.WEBAUTHN_ORIGIN || '').trim();
  if (explicitOrigin) {
    try {
      const url = new URL(explicitOrigin);
      return url.origin;
    } catch (_error) {
      return '';
    }
  }

  const host = getRequestHost(req);
  if (!host) return '';
  const protocol = getRequestProtocol(req);
  return `${protocol}://${host}`;
}

function buildPasskeyContext(req) {
  const origin = resolveRequestOrigin(req);
  if (!origin) {
    return {
      runtimeAvailable: PASSKEY_RUNTIME_AVAILABLE,
      available: false,
      origin: '',
      rpID: '',
      rpName: PASSKEY_RP_NAME,
      secureContext: false,
      disabledReason: 'origin',
      disabledMessage: 'Não consegui descobrir o endereço seguro do app para preparar esse desbloqueio agora.'
    };
  }

  let url = null;
  try {
    url = new URL(origin);
  } catch (_error) {
    return {
      runtimeAvailable: PASSKEY_RUNTIME_AVAILABLE,
      available: false,
      origin: '',
      rpID: '',
      rpName: PASSKEY_RP_NAME,
      secureContext: false,
      disabledReason: 'origin',
      disabledMessage: 'O endereço do app não ficou pronto para usar o desbloqueio pelo aparelho.'
    };
  }

  const envRpId = normalizePasskeyRpId(process.env.APP_PASSKEY_RP_ID || process.env.WEBAUTHN_RP_ID || '');
  const rpID = envRpId || normalizeHostname(url.hostname);
  const secureContext = url.protocol === 'https:' || isLoopbackHostname(url.hostname);

  let disabledReason = '';
  let disabledMessage = '';

  if (!PASSKEY_RUNTIME_AVAILABLE) {
    disabledReason = 'runtime';
    disabledMessage = 'Esse servidor ainda não está com a pecinha do desbloqueio pelo aparelho instalada.';
  } else if (!secureContext) {
    disabledReason = 'secure-context';
    disabledMessage = 'Para usar desbloqueio pelo aparelho, o app precisa abrir em um endereço seguro (HTTPS).';
  } else if (!rpID) {
    disabledReason = 'rp-id';
    disabledMessage = 'Não consegui preparar o endereço de confiança desse desbloqueio agora.';
  }

  return {
    runtimeAvailable: PASSKEY_RUNTIME_AVAILABLE,
    available: PASSKEY_RUNTIME_AVAILABLE && secureContext && !!rpID,
    origin: url.origin,
    rpID,
    rpName: PASSKEY_RP_NAME,
    secureContext,
    disabledReason,
    disabledMessage
  };
}

function buildPasskeyUserHandle(userId, pepper = '') {
  const safeUserId = String(Number(userId || 0) || 0);
  const secret = String(pepper || 'acerttapay-passkey-handle');
  return bufferToBase64Url(crypto.createHmac('sha256', secret).update(safeUserId).digest());
}

function normalizePasskeyLabel(value, fallback = 'Este aparelho') {
  const safe = String(value || '').replace(/\s+/g, ' ').trim();
  if (!safe) return fallback;
  return safe.slice(0, 60);
}

async function generatePasskeyRegistrationOptions({ rpName, rpID, userID, userName, userDisplayName, excludeCredentials = [] }) {
  const api = getPasskeyServerApi();
  if (!api?.generateRegistrationOptions) {
    throw new Error('O desbloqueio pelo aparelho ainda não está disponível neste servidor.');
  }

  return api.generateRegistrationOptions({
    rpName,
    rpID,
    userID,
    userName,
    userDisplayName,
    timeout: 60000,
    attestationType: 'none',
    residentKey: 'preferred',
    userVerification: 'required',
    supportedAlgorithmIDs: PASSKEY_SUPPORTED_ALGORITHM_IDS,
    excludeCredentials: excludeCredentials.map((entry) => ({
      id: String(entry.id || '').trim(),
      transports: Array.isArray(entry.transports) ? entry.transports.filter(Boolean) : undefined
    }))
  });
}

function extractRegistrationCredential(registrationInfo = {}, response = null) {
  const credential = registrationInfo.credential || {};
  const candidateId = credential.id || registrationInfo.credentialID || response?.id || '';
  const publicKey = credential.publicKey || registrationInfo.credentialPublicKey || null;
  const counter = credential.counter ?? registrationInfo.counter ?? 0;
  const transports = credential.transports || registrationInfo.transports || response?.response?.transports || [];
  const deviceType = registrationInfo.credentialDeviceType || credential.deviceType || '';
  const backedUp = registrationInfo.credentialBackedUp ?? credential.backedUp ?? false;
  const aaguid = credential.aaguid || registrationInfo.aaguid || '';

  return {
    id: String(candidateId || '').trim(),
    publicKey: bufferToBase64Url(publicKey || Buffer.alloc(0)),
    counter: Number(counter || 0) || 0,
    transports: Array.isArray(transports) ? transports.filter(Boolean) : [],
    deviceType: String(deviceType || '').trim(),
    backedUp: backedUp ? 1 : 0,
    aaguid: String(aaguid || '').trim()
  };
}

async function verifyPasskeyRegistrationResponse({ response, expectedChallenge, expectedOrigin, expectedRPID }) {
  const api = getPasskeyServerApi();
  if (!api?.verifyRegistrationResponse) {
    throw new Error('O desbloqueio pelo aparelho ainda não está disponível neste servidor.');
  }

  const verification = await api.verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin,
    expectedRPID,
    requireUserVerification: true
  });

  return {
    verified: !!verification?.verified,
    credential: verification?.verified ? extractRegistrationCredential(verification.registrationInfo, response) : null
  };
}

async function generatePasskeyAuthenticationOptions({ rpID, allowCredentials = [] }) {
  const api = getPasskeyServerApi();
  if (!api?.generateAuthenticationOptions) {
    throw new Error('O desbloqueio pelo aparelho ainda não está disponível neste servidor.');
  }

  return api.generateAuthenticationOptions({
    rpID,
    timeout: 60000,
    allowCredentials: allowCredentials.map((entry) => ({
      id: String(entry.id || '').trim(),
      transports: Array.isArray(entry.transports) ? entry.transports.filter(Boolean) : undefined
    })),
    userVerification: 'required'
  });
}

function buildVerificationCredential(passkey) {
  return {
    id: String(passkey?.id || '').trim(),
    publicKey: base64UrlToBuffer(passkey?.public_key || passkey?.publicKey || ''),
    counter: Number(passkey?.counter || 0) || 0,
    transports: Array.isArray(passkey?.transports)
      ? passkey.transports.filter(Boolean)
      : String(passkey?.transports || '').trim()
        ? JSON.parse(String(passkey.transports))
        : []
  };
}

async function verifyPasskeyAuthenticationResponse({ response, expectedChallenge, expectedOrigin, expectedRPID, passkey }) {
  const api = getPasskeyServerApi();
  if (!api?.verifyAuthenticationResponse) {
    throw new Error('O desbloqueio pelo aparelho ainda não está disponível neste servidor.');
  }

  const credential = buildVerificationCredential(passkey);
  let verification = null;

  try {
    verification = await api.verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin,
      expectedRPID,
      requireUserVerification: true,
      credential
    });
  } catch (primaryError) {
    const legacyAuthenticator = {
      credentialID: base64UrlToBuffer(credential.id),
      credentialPublicKey: credential.publicKey,
      counter: credential.counter,
      transports: credential.transports
    };

    verification = await api.verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin,
      expectedRPID,
      requireUserVerification: true,
      authenticator: legacyAuthenticator
    }).catch(() => {
      throw primaryError;
    });
  }

  const newCounter = Number(
    verification?.authenticationInfo?.newCounter
    ?? verification?.authenticationInfo?.counter
    ?? verification?.authenticationInfo?.credential?.counter
    ?? credential.counter
    ?? 0
  ) || 0;

  return {
    verified: !!verification?.verified,
    newCounter
  };
}

module.exports = {
  PASSKEY_MAX_CREDENTIALS_PER_USER,
  PASSKEY_CHALLENGE_MAX_AGE_MS,
  PASSKEY_RP_NAME,
  PASSKEY_SUPPORTED_ALGORITHM_IDS,
  PASSKEY_RUNTIME_AVAILABLE,
  bufferToBase64Url,
  base64UrlToBuffer,
  buildPasskeyContext,
  buildPasskeyUserHandle,
  normalizePasskeyLabel,
  generatePasskeyRegistrationOptions,
  verifyPasskeyRegistrationResponse,
  generatePasskeyAuthenticationOptions,
  verifyPasskeyAuthenticationResponse
};
