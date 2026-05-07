let nodemailer = null;
let nodemailerLoadError = null;
try {
  nodemailer = require('nodemailer');
} catch (error) {
  nodemailer = null;
  nodemailerLoadError = error;
}

function getEmailRuntimeStatus() {
  return {
    available: !!nodemailer,
    module: 'nodemailer',
    loadErrorMessage: nodemailerLoadError?.message || null,
    loadErrorCode: nodemailerLoadError?.code || null,
    requireStack: Array.isArray(nodemailerLoadError?.requireStack) ? nodemailerLoadError.requireStack : []
  };
}

function logEmailRuntimeIssue(action = 'runtime-check', extra = {}) {
  const status = getEmailRuntimeStatus();
  console.warn('[email-runtime]', {
    action,
    available: status.available,
    module: status.module,
    message: status.loadErrorMessage || 'nodemailer não carregou neste boot.',
    code: status.loadErrorCode,
    requireStack: status.requireStack,
    ...extra
  });
  return status;
}

function normalizePort(value, fallback = 587) {
  const parsed = Number(String(value ?? '').trim());
  if (!Number.isFinite(parsed)) return fallback;
  const port = Math.trunc(parsed);
  if (port < 1 || port > 65535) return fallback;
  return port;
}

function normalizeBoolean(value, fallback = false) {
  if (value == null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on', 'sim', 's'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off', 'nao', 'não'].includes(normalized)) return false;
  return fallback;
}

function requireMailerRuntime() {
  if (!nodemailer) {
    const error = new Error('A pecinha de e-mail ainda não foi instalada neste servidor. Rode npm install para trazer o nodemailer para o baile.');
    error.code = 'EMAIL_RUNTIME_MISSING';
    throw error;
  }
}

function normalizeEmailAddress(value) {
  const safe = String(value || '').trim();
  return safe || '';
}

function formatAddress(name, email) {
  const safeEmail = normalizeEmailAddress(email);
  if (!safeEmail) return '';
  const safeName = String(name || '').trim().replace(/[\r\n]+/g, ' ');
  return safeName ? `"${safeName.replace(/"/g, '\\"')}" <${safeEmail}>` : safeEmail;
}


function normalizeAttachment(attachment = {}) {
  if (!attachment || typeof attachment !== 'object') return null;
  const filename = String(attachment.filename || '').trim().replace(/[\r\n]+/g, ' ');
  if (!filename) return null;

  const normalized = { filename };
  if (Buffer.isBuffer(attachment.content)) {
    normalized.content = attachment.content;
  } else if (attachment.content != null) {
    normalized.content = String(attachment.content);
  } else if (attachment.path) {
    normalized.path = String(attachment.path);
  } else {
    return null;
  }

  const contentType = String(attachment.contentType || '').trim();
  if (contentType) normalized.contentType = contentType;
  const encoding = String(attachment.encoding || '').trim();
  if (encoding) normalized.encoding = encoding;
  return normalized;
}

function normalizeAttachments(value) {
  if (!Array.isArray(value)) return undefined;
  const attachments = value.map(normalizeAttachment).filter(Boolean);
  return attachments.length ? attachments : undefined;
}

function buildTransportConfig(config = {}) {
  const host = String(config.host || '').trim();
  const port = normalizePort(config.port, normalizeBoolean(config.secure, false) ? 465 : 587);
  const secure = normalizeBoolean(config.secure, false);
  const requireTLS = normalizeBoolean(config.requireTLS, !secure);
  const user = String(config.user || '').trim();
  const pass = String(config.pass || '').trim();

  if (!host) {
    throw new Error('Falta definir o host SMTP antes de testar ou enviar e-mail.');
  }

  const transport = {
    host,
    port,
    secure,
    requireTLS,
    auth: user && pass ? { user, pass } : undefined,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
    tls: {
      minVersion: 'TLSv1.2',
      rejectUnauthorized: true
    }
  };

  return transport;
}

function buildDefaultMessageConfig(config = {}) {
  const fromEmail = normalizeEmailAddress(config.fromEmail);
  const fromName = String(config.fromName || '').trim();
  const replyTo = normalizeEmailAddress(config.replyTo);

  if (!fromEmail) {
    throw new Error('Falta definir o e-mail remetente antes de disparar o boas-vindas.');
  }

  return {
    from: formatAddress(fromName, fromEmail),
    replyTo: replyTo || undefined
  };
}

async function verifyEmailTransport(config = {}) {
  requireMailerRuntime();
  const transporter = nodemailer.createTransport(buildTransportConfig(config));
  await transporter.verify();
  return true;
}

async function sendEmail(config = {}, message = {}) {
  requireMailerRuntime();
  const transporter = nodemailer.createTransport(buildTransportConfig(config));
  const defaults = buildDefaultMessageConfig(config);
  const to = normalizeEmailAddress(message.to);
  if (!to) {
    throw new Error('Falta o e-mail de destino para enviar essa mensagem.');
  }

  const attachments = normalizeAttachments(message.attachments);

  const info = await transporter.sendMail({
    from: defaults.from,
    to,
    subject: String(message.subject || '').trim(),
    text: String(message.text || ''),
    html: String(message.html || ''),
    replyTo: normalizeEmailAddress(message.replyTo) || defaults.replyTo,
    headers: message.headers && typeof message.headers === 'object' ? message.headers : undefined,
    attachments
  });

  return {
    messageId: String(info?.messageId || '').trim(),
    accepted: Array.isArray(info?.accepted) ? info.accepted : [],
    rejected: Array.isArray(info?.rejected) ? info.rejected : [],
    envelope: info?.envelope || null,
    response: String(info?.response || '').trim()
  };
}

module.exports = {
  normalizePort,
  normalizeBoolean,
  formatAddress,
  getEmailRuntimeStatus,
  logEmailRuntimeIssue,
  verifyEmailTransport,
  sendEmail
};
