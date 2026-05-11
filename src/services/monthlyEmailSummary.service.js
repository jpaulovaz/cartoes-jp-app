const { createMonthlyEmailSummaryRepository } = require('../repositories/monthlyEmailSummary.repository');
const { buildMonthlySummaryEmailTemplate } = require('../emailMonthlySummaryTemplates');

const MONTHLY_SUMMARY_KIND = 'monthly_finance_summary';
const SEND_COOLDOWN_MS = 15000;
const recentSendKeys = new Map();

function createPublicError(message, statusCode = 400, code = 'MONTHLY_SUMMARY_ERROR') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.publicMessage = message;
  return error;
}

function cleanupCooldown(now = Date.now()) {
  for (const [key, expiresAt] of recentSendKeys.entries()) {
    if (expiresAt <= now) recentSendKeys.delete(key);
  }
}

function assertCooldown(key) {
  const now = Date.now();
  cleanupCooldown(now);
  const expiresAt = recentSendKeys.get(key);
  if (expiresAt && expiresAt > now) {
    throw createPublicError('Esse resumo ja esta saindo do forno. Espera uns segundinhos antes de pedir outro igual.', 429, 'MONTHLY_SUMMARY_COOLDOWN');
  }
  recentSendKeys.set(key, now + SEND_COOLDOWN_MS);
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeSections(rawSections = {}) {
  const source = rawSections && typeof rawSections === 'object' ? rawSections : {};
  const sections = {
    overview: source.overview !== false,
    cards: source.cards !== false,
    analytics: source.analytics !== false,
    financeFlow: source.financeFlow !== false,
    people: source.people !== false
  };
  if (!Object.values(sections).some(Boolean)) sections.overview = true;
  sections.sharedAccepted = source.sharedAccepted !== false;
  return sections;
}

function normalizeAttachments(rawAttachments = {}) {
  const source = rawAttachments && typeof rawAttachments === 'object' ? rawAttachments : {};
  return {
    transactionsCsv: source.transactionsCsv !== false
  };
}

function validateSelfOnlyPayload(body = {}) {
  const source = body && typeof body === 'object' ? body : {};
  const recipientMode = String(source.recipientMode || 'self').trim().toLowerCase() || 'self';
  if (recipientMode !== 'self') {
    throw createPublicError('Por seguranca, essa primeira versao envia apenas para o seu proprio email de login.', 400, 'MONTHLY_SUMMARY_RECIPIENT_BLOCKED');
  }
  if (source.recipientEmail || source.to || source.cc || source.bcc) {
    throw createPublicError('Para proteger seus dados financeiros, ainda nao deixo mandar esse resumo para terceiros.', 400, 'MONTHLY_SUMMARY_EXTERNAL_RECIPIENT');
  }
}

function buildSafePayloadForAudit({ month, year, sections, attachments, csvMeta, template, urls, sendResult = null } = {}) {
  return {
    subject: template?.subject || '',
    preview: template?.preview || '',
    period: { month, year },
    sections,
    attachments: {
      transactionsCsv: !!attachments?.transactionsCsv,
      csvFilename: csvMeta?.filename || '',
      csvRowCount: Number(csvMeta?.rowCount || 0),
      csvByteLength: Number(csvMeta?.byteLength || 0)
    },
    urls,
    audit: template?.audit || null,
    accepted: sendResult?.accepted,
    rejected: sendResult?.rejected,
    response: sendResult?.response
  };
}

function createMonthlyEmailSummaryService(deps = {}) {
  const repository = deps.repository || createMonthlyEmailSummaryRepository(deps);

  async function sendMonthlySummaryEmail({ user = {}, params = {}, body = {}, req = null } = {}) {
    const parsed = repository.parseMonthYear(params.month, params.year);
    if (!parsed) {
      throw createPublicError('Esse mes/ano veio estranho por aqui.', 400, 'MONTHLY_SUMMARY_BAD_PERIOD');
    }

    validateSelfOnlyPayload(body);
    const { month, year } = parsed;
    const currentUser = user && typeof user === 'object' ? user : {};
    const userId = Number(currentUser.id || 0);
    if (!userId) {
      throw createPublicError('Sua sessao precisa estar ativa para enviar esse resumo.', 401, 'MONTHLY_SUMMARY_AUTH_REQUIRED');
    }

    const safeRecipientEmail = repository.normalizeEmail
      ? repository.normalizeEmail(currentUser.email)
      : normalizeEmail(currentUser.email);
    if (!safeRecipientEmail) {
      throw createPublicError('Sua conta ainda nao tem um email valido para receber esse resumo.', 400, 'MONTHLY_SUMMARY_MISSING_EMAIL');
    }

    const emailConfig = repository.getEmailRuntimeConfig ? repository.getEmailRuntimeConfig() : {};
    if (!repository.isEmailConfigured || !repository.isEmailConfigured(emailConfig)) {
      throw createPublicError('O correio do app ainda nao esta configurado. Peca para um admin revisar o email transacional em /admin.', 503, 'MONTHLY_SUMMARY_SMTP_NOT_CONFIGURED');
    }

    const sections = normalizeSections(body.sections);
    const attachments = normalizeAttachments(body.attachments);
    const cooldownKey = `${userId}:${year}:${month}`;
    assertCooldown(cooldownKey);

    const viewModel = repository.buildMonthlyReviewViewModel(userId, month, year);
    let csvExport = null;
    let csvMeta = null;
    const mailAttachments = [];

    if (attachments.transactionsCsv && repository.buildMonthTransactionsCsvExport) {
      csvExport = repository.buildMonthTransactionsCsvExport(userId, month, year);
      csvMeta = csvExport ? {
        filename: csvExport.filename,
        rowCount: Number(csvExport.rowCount || 0),
        byteLength: Number(csvExport.byteLength || 0),
        contentType: csvExport.contentType || 'text/csv; charset=utf-8'
      } : null;
      if (csvExport && csvExport.filename) {
        mailAttachments.push({
          filename: csvExport.filename,
          content: Buffer.from(String(csvExport.content || ''), 'utf8'),
          contentType: csvExport.contentType || 'text/csv; charset=utf-8'
        });
      }
    }

    const analyticsPath = `/analytics/${year}/${month}`;
    const urls = {
      appUrl: repository.buildAppUrl ? repository.buildAppUrl(req, '/geral') : '/geral',
      analyticsUrl: repository.buildAppUrl ? repository.buildAppUrl(req, analyticsPath) : analyticsPath
    };

    const template = buildMonthlySummaryEmailTemplate({
      viewModel,
      sections,
      attachments,
      recipientName: currentUser.name || safeRecipientEmail.split('@')[0],
      appUrl: urls.appUrl,
      analyticsUrl: urls.analyticsUrl,
      generatedAt: new Date(),
      csvMeta
    });

    const attemptNo = repository.getNextEmailAttemptNo
      ? repository.getNextEmailAttemptNo(MONTHLY_SUMMARY_KIND, userId)
      : 1;
    const eventId = repository.createEmailDeliveryEvent({
      kind: MONTHLY_SUMMARY_KIND,
      targetUserId: userId,
      recipientEmail: safeRecipientEmail,
      subject: template.subject,
      attemptNo,
      payload: buildSafePayloadForAudit({ month, year, sections, attachments, csvMeta, template, urls }),
      createdByUserId: userId
    });

    try {
      const sendResult = await repository.sendEmail(emailConfig, {
        to: safeRecipientEmail,
        subject: template.subject,
        html: template.html,
        text: template.text,
        attachments: mailAttachments,
        headers: {
          'X-AcerttaPay-Email-Kind': MONTHLY_SUMMARY_KIND,
          'X-AcerttaPay-Period': `${year}-${String(month).padStart(2, '0')}`
        }
      });

      repository.finalizeEmailDeliveryEvent(eventId, {
        status: 'sent',
        providerMessageId: sendResult.messageId,
        payload: buildSafePayloadForAudit({ month, year, sections, attachments, csvMeta, template, urls, sendResult })
      });

      return {
        ok: true,
        success: true,
        eventId,
        subject: template.subject,
        recipientEmail: safeRecipientEmail,
        message: 'Pronto! Seu resumo foi para seu email. Daqui a pouco ele aparece na caixa de entrada - e talvez na aba Promocoes, porque o email tambem gosta de passear.',
        csv: csvMeta ? { filename: csvMeta.filename, rowCount: csvMeta.rowCount } : null
      };
    } catch (error) {
      if (repository.logEmailFlowError) {
        repository.logEmailFlowError('monthly-summary-send', error, {
          targetUserId: userId,
          recipientEmail: safeRecipientEmail,
          subject: template.subject,
          month,
          year,
          ...(repository.buildEmailTransportLogContext ? repository.buildEmailTransportLogContext(emailConfig) : {})
        });
      }
      repository.finalizeEmailDeliveryEvent(eventId, {
        status: 'error',
        errorMessage: error?.message || 'Nao consegui mandar esse resumo agora.',
        payload: buildSafePayloadForAudit({ month, year, sections, attachments, csvMeta, template, urls })
      });
      throw createPublicError('Nao consegui mandar esse resumo agora. O correio do app tropecou; tenta de novo em instantes.', 502, 'MONTHLY_SUMMARY_SEND_FAILED');
    }
  }

  return {
    sendMonthlySummaryEmail
  };
}

module.exports = {
  MONTHLY_SUMMARY_KIND,
  createMonthlyEmailSummaryService
};
