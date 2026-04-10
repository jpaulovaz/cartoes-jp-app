const axios = require('axios');
const { createSocialShareRepository } = require('../repositories/socialShare.repository');

function maskPhoneForLog(rawPhone) {
  const digits = String(rawPhone || '').replace(/\D/g, '');
  if (!digits) return 'sem-telefone';
  if (digits.length <= 4) return digits;
  return `${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

function findEvolutionMissingRecipient(payload, depth = 0) {
  if (!payload || depth > 8) return null;

  if (Array.isArray(payload)) {
    for (const entry of payload) {
      const found = findEvolutionMissingRecipient(entry, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (typeof payload !== 'object') return null;

  if (payload.exists === false && (payload.number || payload.jid)) {
    return payload;
  }

  for (const value of Object.values(payload)) {
    const found = findEvolutionMissingRecipient(value, depth + 1);
    if (found) return found;
  }

  return null;
}

function getEvolutionRecipientIssueMessage(error) {
  const payload = error && error.response && error.response.data;
  const missingRecipient = findEvolutionMissingRecipient(payload);
  if (!missingRecipient) return '';
  return 'Esse número não apareceu no WhatsApp. Confere se o DDI e o celular estão certinhos?';
}

function summarizeAxiosError(error) {
  if (!error) return 'Erro desconhecido.';

  if (error.evolutionDebugSummary) {
    return error.evolutionDebugSummary;
  }

  const status = error.response && error.response.status;
  const payload = error.response && error.response.data;
  if (typeof payload === 'string' && payload.trim()) {
    return status ? `HTTP ${status}: ${payload.trim().slice(0, 400)}` : payload.trim().slice(0, 400);
  }
  if (payload && typeof payload === 'object') {
    try {
      const compact = JSON.stringify(payload).slice(0, 400);
      return status ? `HTTP ${status}: ${compact}` : compact;
    } catch (_) {
      // segue para a próxima alternativa
    }
  }

  if (error.message) {
    return status ? `HTTP ${status}: ${error.message}` : error.message;
  }
  return status ? `HTTP ${status}` : 'Erro desconhecido.';
}

function normalizeEvolutionMediaBase64(rawBase64) {
  return String(rawBase64 || '')
    .replace(/^data:[^;]+;base64,/i, '')
    .replace(/\s+/g, '')
    .trim();
}

function shouldRetryEvolutionMediaAsLegacy(error) {
  if (!(error && error.response && [400, 404, 415, 422].includes(error.response.status))) {
    return false;
  }

  const summary = summarizeAxiosError(error).toLowerCase();
  if (!summary) return false;

  if (summary.includes('requires property "mediatype"') || summary.includes("requires property 'mediatype'")) {
    return false;
  }

  return summary.includes('mediamessage') || summary.includes('media type');
}

async function postToEvolution(endpoint, headers, payload) {
  return axios.post(endpoint, payload, {
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...headers
    },
    timeout: 30000,
    maxBodyLength: Infinity,
    maxContentLength: Infinity
  });
}

async function sendEvolutionMediaWithFallback(apiUrl, apiKey, instance, cleanNumber, message, base64Data) {
  const endpoint = `${String(apiUrl || '').trim().replace(/\/$/, '')}/message/sendMedia/${String(instance || '').trim()}`;
  const headers = { apikey: String(apiKey || '').trim() };
  const fileName = `AcerttaPay_${new Date().toISOString().slice(0, 10)}.png`;
  const safeCaption = String(message || '').trim();
  const normalizedBase64 = normalizeEvolutionMediaBase64(base64Data);

  const v2Payload = {
    number: cleanNumber,
    mediatype: 'image',
    mimetype: 'image/png',
    media: normalizedBase64,
    fileName,
    filename: fileName,
    caption: safeCaption || ' ',
    delay: 1200,
    linkPreview: false
  };

  try {
    return await postToEvolution(endpoint, headers, v2Payload);
  } catch (v2Error) {
    if (!shouldRetryEvolutionMediaAsLegacy(v2Error)) {
      throw v2Error;
    }

    const v1Payload = {
      number: cleanNumber,
      mediaMessage: {
        mediatype: 'image',
        mediaType: 'image',
        mimetype: 'image/png',
        fileName,
        filename: fileName,
        caption: safeCaption || ' ',
        media: normalizedBase64
      },
      options: {
        delay: 1200,
        presence: 'composing',
        linkPreview: false
      }
    };

    try {
      return await postToEvolution(endpoint, headers, v1Payload);
    } catch (legacyError) {
      legacyError.evolutionDebugSummary = [
        'Envio em schema v2 falhou.',
        summarizeAxiosError(v2Error),
        'Fallback legado também falhou.',
        summarizeAxiosError(legacyError)
      ].join(' ');
      throw legacyError;
    }
  }
}

async function sendEvolutionTextWithFallback(apiUrl, apiKey, instance, cleanNumber, message) {
  const safeMessage = String(message || '').trim();
  if (!safeMessage) return null;

  const endpoint = `${String(apiUrl || '').trim().replace(/\/$/, '')}/message/sendText/${String(instance || '').trim()}`;
  const headers = { apikey: String(apiKey || '').trim() };

  const v2Payload = {
    number: cleanNumber,
    text: safeMessage,
    delay: 2200,
    linkPreview: false
  };

  try {
    return await axios.post(endpoint, v2Payload, { headers, timeout: 30000 });
  } catch (v2Error) {
    const status = v2Error.response && v2Error.response.status;
    const canRetryAsV1 = Boolean(v2Error.response) && [400, 404, 415, 422].includes(status);
    if (!canRetryAsV1) {
      throw v2Error;
    }

    const v1Payload = {
      number: cleanNumber,
      textMessage: {
        text: safeMessage
      },
      options: {
        delay: 2200,
        presence: 'composing',
        linkPreview: false
      }
    };

    return axios.post(endpoint, v1Payload, { headers, timeout: 30000 });
  }
}

function createSocialShareService(deps = {}) {
  const repository = deps.repository || createSocialShareRepository(deps);

  async function getSharePage({ userId, params, query }) {
    const parsed = repository.parseMonthYear(params.month, params.year);
    const personId = Number(params.personId);
    if (!parsed) return { badRequest: 'Os dados dessa chamada vieram tortos.' };

    const { month, year } = parsed;
    const itemOrder = repository.parseChronologicalOrder(query.order) || 'oldest';
    const exportData = repository.getPersonStatementExportData(userId, month, year, personId, itemOrder);
    if (!exportData) return { badRequest: 'Não achei essa pessoa por aqui.' };

    const shareContext = await repository.buildSharePixContext({
      userId,
      month,
      year,
      person: exportData.person,
      totalCents: exportData.total,
      paidCents: exportData.paid_cents,
      remainingCents: exportData.remaining_cents
    });

    return {
      viewModel: { month, year, itemOrder, shareContext, ...exportData }
    };
  }

  async function getWhatsappPage({ userId, params, query }) {
    const parsed = repository.parseMonthYear(params.month, params.year);
    const personId = Number(params.personId);
    if (!parsed) return { badRequest: 'Os dados dessa chamada vieram tortos.' };

    if (!repository.isAdminUser(userId)) {
      const fallbackOrder = repository.parseChronologicalOrder(query.order);
      const fallbackSuffix = fallbackOrder ? `?order=${fallbackOrder}` : '';
      return {
        redirectTo: `/share/${params.year}/${params.month}/${personId}${fallbackSuffix}`,
        flash: { type: 'error', message: 'O envio via WhatsApp está disponível apenas para administradores.' }
      };
    }

    const { month, year } = parsed;
    const itemOrder = repository.parseChronologicalOrder(query.order) || 'oldest';
    const exportData = repository.getPersonStatementExportData(userId, month, year, personId, itemOrder);
    if (!exportData) return { badRequest: 'Não achei essa pessoa por aqui.' };

    const decoratedPerson = repository.decoratePersonPhoneForView(exportData.person, { fallbackCountry: repository.DEFAULT_PHONE_COUNTRY });
    const shareContext = await repository.buildSharePixContext({
      userId,
      month,
      year,
      person: decoratedPerson,
      totalCents: exportData.total,
      paidCents: exportData.paid_cents,
      remainingCents: exportData.remaining_cents
    });

    return {
      viewModel: { month, year, itemOrder, shareContext, ...exportData, person: decoratedPerson }
    };
  }

  async function sendWhatsappAutomation({ userId, body = {} }) {
    if (!repository.isAdminUser(userId)) {
      return { status: 403, body: { error: 'Esse atalho de envio no WhatsApp é só para administradores.' } };
    }

    try {
      const { personPhone, personPhoneCountry, message, followUpMessage, pixPayload, autoSecondMessage, imageBase64 } = body;

      const apiUrl = repository.getSettingText('EVOLUTION_API_URL');
      const apiKey = repository.getSettingText('EVOLUTION_API_KEY');
      const instance = repository.getSettingText('EVOLUTION_INSTANCE_NAME');

      if (!apiUrl || !apiKey || !instance) {
        return { status: 400, body: { error: 'O envio automático no WhatsApp ainda não foi configurado.' } };
      }

      const normalizedRecipient = repository.normalizePhoneForWhatsapp(personPhone, {
        fallbackCountry: personPhoneCountry || repository.DEFAULT_PHONE_COUNTRY
      });
      if (!normalizedRecipient.ok || !normalizedRecipient.number) {
        return { status: 400, body: { error: normalizedRecipient.reason || 'Essa pessoa ainda não tem um telefone válido para envio.' } };
      }

      const cleanNumber = normalizedRecipient.number;
      const base64Data = String(imageBase64 || '').includes(',')
        ? String(imageBase64 || '').split(',')[1]
        : String(imageBase64 || '').trim();
      if (!base64Data) {
        return { status: 400, body: { error: 'Não consegui montar a imagem do resumo para enviar.' } };
      }

      await sendEvolutionMediaWithFallback(apiUrl, apiKey, instance, cleanNumber, message, base64Data);

      const automationSecondMessage = String(autoSecondMessage || '').trim();
      const pixCopyPaste = String(pixPayload || '').trim();
      const fallbackText = String(followUpMessage || '').trim();
      if (automationSecondMessage) {
        await sendEvolutionTextWithFallback(apiUrl, apiKey, instance, cleanNumber, automationSecondMessage);
      } else if (pixCopyPaste) {
        await sendEvolutionTextWithFallback(apiUrl, apiKey, instance, cleanNumber, pixCopyPaste);
      } else if (fallbackText) {
        await sendEvolutionTextWithFallback(apiUrl, apiKey, instance, cleanNumber, fallbackText);
      }

      return { status: 200, body: { success: true } };
    } catch (e) {
      const recipientIssueMessage = getEvolutionRecipientIssueMessage(e);
      const summarized = summarizeAxiosError(e);
      console.error('[whatsapp/send-automation] Falha no envio', {
        userId,
        phone: maskPhoneForLog(body && body.personPhone),
        messageLength: body && body.message ? String(body.message).length : 0,
        hasImage: Boolean(body && body.imageBase64),
        hasPixPayload: Boolean(body && String(body.pixPayload || '').trim()),
        details: summarized,
        recipientIssueMessage: recipientIssueMessage || null
      });

      if (recipientIssueMessage) {
        return { status: 400, body: { error: recipientIssueMessage } };
      }

      const status = e && e.response && e.response.status ? 502 : 500;
      return { status, body: { error: `Não consegui enviar esse resumo no WhatsApp agora. ${summarized}`.trim() } };
    }
  }

  return {
    getSharePage,
    getWhatsappPage,
    sendWhatsappAutomation,
    sendEvolutionMediaWithFallback,
    sendEvolutionTextWithFallback
  };
}

module.exports = {
  createSocialShareService
};
