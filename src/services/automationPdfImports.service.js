const { createAutomationPdfImportsRepository } = require('../repositories/automationPdfImports.repository');
const { createStatementPdfService } = require('./statementPdf.service');
const { AutomationApiError, normalizeAutomationPhone } = require('./automationApi.service');

const MONTH_NAMES = {
  janeiro: 1,
  jan: 1,
  fevereiro: 2,
  fev: 2,
  marco: 3,
  março: 3,
  mar: 3,
  abril: 4,
  abr: 4,
  maio: 5,
  mai: 5,
  junho: 6,
  jun: 6,
  julho: 7,
  jul: 7,
  agosto: 8,
  ago: 8,
  setembro: 9,
  set: 9,
  outubro: 10,
  out: 10,
  novembro: 11,
  nov: 11,
  dezembro: 12,
  dez: 12
};

const MONTH_LABELS = [
  '', 'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'
];

function makeResult(payload = {}, statusCode = 200) {
  return { statusCode, ...payload };
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function currentSaoPauloPeriod() {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  const [year, month] = today.split('-').map(Number);
  return { month, year };
}

function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseMonth(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return 0;
  const numeric = toInt(raw, 0);
  if (numeric >= 1 && numeric <= 12) return numeric;
  const normalized = normalizeText(raw);
  return MONTH_NAMES[normalized] || 0;
}

function parseYear(value) {
  const year = toInt(value, 0);
  return year >= 2000 && year <= 2100 ? year : 0;
}

function resolvePeriod(input = {}, fallback = {}) {
  const current = currentSaoPauloPeriod();
  const rawPeriod = String(input.period || input.competence || input.competencia || input.reference || '').trim();
  const isoMatch = rawPeriod.match(/^(\d{4})[-/](\d{1,2})$/);
  if (isoMatch) {
    return {
      month: parseMonth(isoMatch[2]) || Number(fallback.month || 0) || 0,
      year: parseYear(isoMatch[1]) || Number(fallback.year || 0) || 0
    };
  }
  const brMatch = rawPeriod.match(/^(\d{1,2})[-/](\d{4})$/);
  if (brMatch) {
    return {
      month: parseMonth(brMatch[1]) || Number(fallback.month || 0) || 0,
      year: parseYear(brMatch[2]) || Number(fallback.year || 0) || 0
    };
  }
  const normalizedPeriod = normalizeText(rawPeriod);
  if (['este mes', 'mes atual', 'atual'].includes(normalizedPeriod)) return current;
  if (['mes passado', 'anterior'].includes(normalizedPeriod)) {
    const date = new Date(Date.UTC(current.year, current.month - 2, 1));
    return { month: date.getUTCMonth() + 1, year: date.getUTCFullYear() };
  }
  if (['proximo mes', 'próximo mês'].includes(normalizedPeriod)) {
    const date = new Date(Date.UTC(current.year, current.month, 1));
    return { month: date.getUTCMonth() + 1, year: date.getUTCFullYear() };
  }
  const month = parseMonth(input.month || input.mes || input.statement_month || fallback.month || 0);
  const year = parseYear(input.year || input.ano || input.statement_year || fallback.year || 0);
  return { month, year };
}

function periodLabel(month, year) {
  const m = Number(month || 0);
  return `${MONTH_LABELS[m] || String(m).padStart(2, '0')}/${year}`;
}

function stripDataUrl(raw) {
  return String(raw || '').replace(/^data:[^;]+;base64,/i, '').replace(/\s+/g, '').trim();
}

function fileFromPayload(payload = {}) {
  const base64 = stripDataUrl(payload.file_base64 || payload.base64 || payload.pdf_base64 || payload.file?.base64 || '');
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
    originalname: String(payload.filename || payload.original_filename || payload.file_name || payload.file?.filename || 'fatura.pdf').trim() || 'fatura.pdf',
    mimetype: String(payload.mime_type || payload.mimetype || payload.file?.mime_type || 'application/pdf').trim() || 'application/pdf',
    size: buffer.length
  };
}

function sanitizeJob(job) {
  if (!job) return null;
  return {
    id: Number(job.id || 0),
    card_id: Number(job.cardId || job.card_id || 0),
    card_name: job.cardName || job.card_name || 'Cartão',
    month: Number(job.month || 0),
    year: Number(job.year || 0),
    status: job.status,
    status_label: job.statusLabel || job.status_label || job.status,
    original_filename: job.originalFilename || job.original_filename || 'fatura.pdf',
    row_count: Number(job.rowCount || job.row_count || 0),
    total_cents: Number(job.totalCents || job.total_cents || 0),
    warning_message: job.warningMessage || job.warning_message || null,
    error_message: job.errorMessage || job.error_message || null,
    can_review: !!job.canReview,
    can_download: !!job.canDownload,
    can_retry: !!job.canRetry,
    can_delete: !!job.canDelete,
    review_url: job.canReview ? `/import/pdf/jobs/${job.id}/review` : null,
    download_url: job.canDownload ? `/import/pdf/jobs/${job.id}/download` : null,
    created_at: job.createdAt || job.created_at || null,
    updated_at: job.updatedAt || job.updated_at || null,
    finished_at: job.finishedAt || job.finished_at || null
  };
}

function cardOptionsText(cards = []) {
  if (!Array.isArray(cards) || !cards.length) return 'Nenhum cartão ativo encontrado.';
  return cards.map((card, index) => `${index + 1}. ${card.name || card.label || `Cartão #${card.id}`}`).join('\n');
}

function buildNeedDetailsText({ missing = [], cards = [], filename = 'fatura.pdf', known = {} } = {}) {
  const missingText = missing.join(', ');
  const cardBlock = missing.includes('card') ? `\n\n💳 *Cartões disponíveis*\n${cardOptionsText(cards)}` : '';
  const knownBits = [];
  if (known.card_name) knownBits.push(`cartão: ${known.card_name}`);
  if (known.month && known.year) knownBits.push(`mês: ${periodLabel(known.month, known.year)}`);
  const knownText = knownBits.length ? `\n\nJá entendi ${knownBits.join(' · ')}.` : '';
  return `📄 Recebi *${filename}*, mas preciso fechar ${missingText} antes de colocar a fatura na fila.${knownText}${cardBlock}\n\nMe responde assim: *Nubank junho/2026*. Prometo não fazer leitura de bola de cristal com fatura. 🔮`;
}

function validatePdfFile(file, repository) {
  if (!file || !Buffer.isBuffer(file.buffer) || !file.buffer.length) {
    throw new AutomationApiError('Não recebi o PDF da fatura. Me manda o arquivo em PDF, por favor.', {
      code: 'PDF_FILE_REQUIRED',
      statusCode: 400
    });
  }
  const maxBytes = repository.getMaxFileBytes();
  if (file.buffer.length > maxBytes) {
    throw new AutomationApiError(`Esse PDF passou do limite de ${Math.round(maxBytes / 1024 / 1024)} MB. Manda uma versão menor para eu conseguir analisar.`, {
      code: 'PDF_TOO_LARGE',
      statusCode: 413
    });
  }
  const filename = String(file.originalname || '').trim();
  const mime = String(file.mimetype || '').toLowerCase();
  const looksPdf = /\.pdf$/i.test(filename) || mime.includes('pdf') || file.buffer.slice(0, 4).toString('utf8') === '%PDF';
  if (!looksPdf) {
    throw new AutomationApiError('Esse arquivo não parece ser um PDF de fatura. Me manda o PDF certinho para eu colocar na fila.', {
      code: 'INVALID_PDF_FILE',
      statusCode: 400
    });
  }
}

function createAutomationPdfImportsService(deps = {}) {
  const repository = deps.pdfImportsAutomationRepository || createAutomationPdfImportsRepository();
  const statementPdfService = deps.statementPdfService || createStatementPdfService(deps);

  function assertApiEnabled() {
    if (!repository.getBooleanSetting('AUTOMATION_API_ENABLED', false)) {
      throw new AutomationApiError('A API de automações está desligada no AcerttaPay.', {
        code: 'AUTOMATION_DISABLED',
        statusCode: 503
      });
    }
  }

  function handleServiceError(error) {
    if (error instanceof AutomationApiError) {
      return makeResult({
        ok: false,
        code: error.code || 'PDF_IMPORT_VALIDATION_ERROR',
        message: error.message,
        details: error.details || null,
        whatsapp: { text: error.message }
      }, error.statusCode || 400);
    }
    return makeResult({
      ok: false,
      code: error.code || 'PDF_IMPORT_INTERNAL_ERROR',
      message: error.message || 'A importação da fatura tropeçou por aqui. Tenta de novo em instantes.',
      whatsapp: { text: 'A importação da fatura tropeçou por aqui. Tenta de novo em instantes.' }
    }, error.statusCode || 500);
  }

  function resolveAuthorizedPhone(phone) {
    const normalized = normalizeAutomationPhone(phone);
    if (!normalized.ok) {
      throw new AutomationApiError(normalized.reason || 'Telefone inválido.', { code: 'INVALID_PHONE', statusCode: 400 });
    }
    const authorization = repository.getAuthorizationByPhone(normalized.e164, normalized.whatsappNumber);
    if (!authorization || Number(authorization.enabled || 0) === 0 || String(authorization.user_status || 'active') === 'deleted') {
      throw new AutomationApiError('Esse número ainda não está liberado no AcerttaPay. Ative o WhatsApp nas Configurações do app.', {
        code: 'NOT_AUTHORIZED',
        statusCode: 403
      });
    }
    const user = repository.getUserById(authorization.user_id);
    if (!user) throw new AutomationApiError('Não encontrei esse usuário no AcerttaPay.', { code: 'USER_NOT_FOUND', statusCode: 404 });
    repository.touchAuthorization(authorization.id);
    return { user, phone: normalized, authorization };
  }

  function withHandling(payload, meta, operation, fn) {
    let resolved = null;
    try {
      assertApiEnabled();
      repository.cleanupExpiredStaging();
      resolved = resolveAuthorizedPhone(payload.phone || payload.user_phone || payload.number);
      const result = fn(resolved);
      repository.logRequest({
        userId: resolved.user.id,
        phoneE164: resolved.phone.e164,
        channel: payload.source?.channel || payload.channel || 'whatsapp',
        operation,
        statusCode: result.statusCode,
        resultCode: result.code,
        sourceMessageId: payload.source?.message_id || payload.message_id || null,
        ipAddress: meta?.ipAddress || null
      });
      return result;
    } catch (error) {
      const result = handleServiceError(error);
      repository.logRequest({
        userId: resolved?.user?.id || null,
        phoneE164: resolved?.phone?.e164 || null,
        channel: payload.source?.channel || payload.channel || 'whatsapp',
        operation,
        statusCode: result.statusCode,
        resultCode: result.code,
        sourceMessageId: payload.source?.message_id || payload.message_id || null,
        ipAddress: meta?.ipAddress || null
      });
      return result;
    }
  }

  function executeIdempotentWrite({ userId, channel = 'whatsapp', idempotencyKey, operation, hashPayload, fn }) {
    const key = String(idempotencyKey || '').trim();
    if (!key) {
      throw new AutomationApiError('Idempotency-Key é obrigatório para importar PDF pelo WhatsApp.', {
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
      throw new AutomationApiError('Essa importação já está em processamento. Não repeti a ação.', {
        code: 'IDEMPOTENCY_IN_PROGRESS',
        statusCode: 409
      });
    }
    try {
      const response = fn();
      repository.finishIdempotency({ channel, idempotencyKey: key, response, status: response.ok ? 'success' : 'completed' });
      return response;
    } catch (error) {
      const response = handleServiceError(error);
      repository.finishIdempotency({ channel, idempotencyKey: key, response, status: 'error' });
      throw error;
    }
  }

  function resolveDetails(userId, input = {}, fallback = {}) {
    const activeCards = repository.getActiveCards(userId);
    const cardId = toInt(input.card_id || input.cardId || fallback.card_id || fallback.cardId || 0, 0);
    let card = cardId ? repository.getActiveCardById(userId, cardId) : null;
    let cardAmbiguous = false;
    let cardMatches = [];
    const cardHint = String(input.card_hint || input.cardHint || input.card || input.cartao || input.card_name || fallback.card_hint || fallback.cardHint || '').trim();
    if (!card && cardHint) {
      const match = repository.findCardByHint(userId, cardHint);
      card = match.card;
      cardAmbiguous = match.ambiguous;
      cardMatches = match.matches || [];
    }
    if (!card && !cardHint && activeCards.length === 1) {
      card = activeCards[0];
    }

    const period = resolvePeriod(input, fallback);
    const missing = [];
    if (!card) missing.push('card');
    if (!period.month || period.month < 1 || period.month > 12) missing.push('month');
    if (!period.year || period.year < 2000 || period.year > 2100) missing.push('year');

    return {
      card,
      cardAmbiguous,
      cardMatches,
      activeCards,
      cardHint,
      month: period.month,
      year: period.year,
      missing
    };
  }

  function buildJobCreatedResponse({ job, source = 'whatsapp' }) {
    const cleanJob = sanitizeJob(job);
    const reviewHint = cleanJob.can_review ? `\n\n🔎 Revisão: ${cleanJob.review_url}` : '\n\nAssim que a leitura terminar, revisa tudo no app antes de importar. Nada entra sozinho, fatura aqui passa pelo seu olhar de dono. 👀';
    return makeResult({
      ok: true,
      code: 'PDF_IMPORT_JOB_CREATED',
      job: cleanJob,
      whatsapp: {
        text: `📄 Fatura recebida!\n\nColoquei *${cleanJob.original_filename}* na fila de leitura.\n💳 Cartão: *${cleanJob.card_name}*\n🗓️ Competência: *${periodLabel(cleanJob.month, cleanJob.year)}*\n🔖 Job: *#${cleanJob.id}*\n\nStatus agora: *${cleanJob.status_label}*.${reviewHint}`
      },
      source
    }, 200);
  }

  function createNeedDetailsResponse({ resolved, payload, file, details, staging, statusCode = 202 }) {
    const known = {
      card_name: details.card?.name || null,
      month: details.month || null,
      year: details.year || null
    };
    const conversation = repository.createConversationState({
      userId: resolved.user.id,
      phoneE164: resolved.phone.e164,
      channel: payload.source?.channel || payload.channel || 'whatsapp',
      state: 'awaiting_pdf_import_details',
      ttlMinutes: repository.getStagingTtlMinutes(),
      payload: {
        kind: 'pdf_import',
        staging_id: staging.id,
        filename: staging.original_filename,
        cards: details.activeCards.map((card) => ({ id: Number(card.id || 0), label: card.name || `Cartão #${card.id}` })),
        missing: details.missing,
        known,
        card_hint: details.cardHint || null
      }
    });
    return makeResult({
      ok: false,
      code: 'NEEDS_PDF_IMPORT_DETAILS',
      message: 'Preciso de cartão, mês e ano para importar essa fatura.',
      staging: {
        id: staging.id,
        filename: staging.original_filename,
        expires_at: staging.expires_at
      },
      missing: details.missing,
      cards: details.activeCards.map((card) => ({ id: Number(card.id || 0), label: card.name || `Cartão #${card.id}` })),
      conversation: {
        id: Number(conversation.id || 0),
        state: conversation.state,
        expires_at: conversation.expires_at
      },
      whatsapp: {
        text: buildNeedDetailsText({ missing: details.missing, cards: details.activeCards, filename: file.originalname, known })
      }
    }, statusCode);
  }

  function createPdfImportJob(payload = {}, meta = {}, explicitFile = null) {
    const file = explicitFile || fileFromPayload(payload);
    const channel = payload.source?.channel || payload.channel || 'whatsapp';
    const sourceMessageId = payload.source?.message_id || payload.message_id || null;
    const idempotencyKey = String(meta.idempotencyKey || payload.idempotency_key || '').trim();

    return withHandling(payload, meta, 'imports.pdf.create_job', (resolved) => executeIdempotentWrite({
      userId: resolved.user.id,
      channel,
      idempotencyKey,
      operation: 'imports.pdf.create_job',
      hashPayload: {
        phone: resolved.phone.e164,
        sourceMessageId,
        filename: file?.originalname || payload.filename || null,
        size: file?.size || payload.file_size || null,
        card_id: payload.card_id || payload.cardId || null,
        card_hint: payload.card_hint || payload.cardHint || null,
        month: payload.month || null,
        year: payload.year || null
      },
      fn: () => {
        validatePdfFile(file, repository);
        const feature = statementPdfService.buildFeatureState();
        if (!feature.enabled) {
          throw new AutomationApiError('A importação por PDF está desligada no admin do AcerttaPay.', {
            code: 'PDF_IMPORT_DISABLED',
            statusCode: 503
          });
        }
        if (!feature.providersReady) {
          throw new AutomationApiError('Nenhum provedor de IA para PDF está pronto no admin. Liga as chaves antes de mandar fatura por WhatsApp.', {
            code: 'PDF_IMPORT_PROVIDER_NOT_READY',
            statusCode: 503
          });
        }
        const details = resolveDetails(resolved.user.id, payload, {});
        if (details.cardAmbiguous) {
          details.missing = Array.from(new Set(['card', ...details.missing]));
        }
        if (details.missing.length) {
          const staging = repository.getOpenStagingByMessage(resolved.user.id, sourceMessageId) || repository.createStaging({
            userId: resolved.user.id,
            phoneE164: resolved.phone.e164,
            whatsappNumber: resolved.phone.whatsappNumber,
            channel,
            file,
            sourceMessageId,
            sourceMeta: payload.source || {},
            cardHint: details.cardHint || null,
            month: details.month || null,
            year: details.year || null
          });
          return createNeedDetailsResponse({ resolved, payload, file, details, staging });
        }

        const enqueueResult = repository.enqueuePdfImportJob(resolved.user.id, {
          cardId: details.card.id,
          month: details.month,
          year: details.year,
          file
        }, statementPdfService);
        const job = enqueueResult.jobs?.[0];
        if (!job) {
          throw new AutomationApiError('Não consegui criar o job dessa fatura agora.', {
            code: 'PDF_IMPORT_JOB_NOT_CREATED',
            statusCode: 500
          });
        }
        repository.createLocalNotification({
          userId: resolved.user.id,
          title: 'PDF recebido pelo WhatsApp',
          body: `${file.originalname || 'Fatura'} entrou na fila de importação do ${details.card.name} (${periodLabel(details.month, details.year)}).`,
          href: `/import`,
          relatedType: 'statement_import_job',
          relatedId: job.id
        });
        return buildJobCreatedResponse({ job });
      }
    }));
  }

  function createStatusText(job) {
    const cleanJob = sanitizeJob(job);
    if (!cleanJob) return 'Não achei esse job de importação por aqui.';
    const base = `📄 *Importação #${cleanJob.id}*\n\nArquivo: *${cleanJob.original_filename}*\n💳 Cartão: *${cleanJob.card_name}*\n🗓️ Competência: *${periodLabel(cleanJob.month, cleanJob.year)}*\n📌 Status: *${cleanJob.status_label}*`;
    if (cleanJob.status === 'review_ready' || cleanJob.status === 'review_warn') {
      const warn = cleanJob.warning_message ? `\n\n⚠️ ${cleanJob.warning_message}` : '';
      return `${base}\n\n✅ A revisão já está pronta no app.\nLinhas encontradas: *${cleanJob.row_count}*\n\nAbra: ${cleanJob.review_url}${warn}\n\nNada foi importado ainda. A fatura só entra depois da sua revisão.`;
    }
    if (cleanJob.status === 'failed') {
      return `${base}\n\n⚠️ Não consegui finalizar essa leitura.\n${cleanJob.error_message || 'Tenta reenviar o PDF ou revisar pelo app.'}`;
    }
    if (cleanJob.status === 'cancelled') {
      return `${base}\n\nImportação cancelada. Sem bagunça na fatura.`;
    }
    return `${base}\n\nAinda estou trabalhando nessa leitura. Assim que ficar pronta, você revisa no app antes de importar.`;
  }

  function getJobStatus(payload = {}, meta = {}) {
    return withHandling(payload, meta, 'imports.pdf.status', (resolved) => {
      const jobId = toInt(payload.job_id || payload.jobId || payload.id || 0, 0);
      if (!jobId) throw new AutomationApiError('Me diga o número do job. Exemplo: status da importação #12.', { code: 'PDF_IMPORT_JOB_ID_REQUIRED', statusCode: 400 });
      const job = repository.findJobByIdForUser(resolved.user.id, jobId);
      if (!job) throw new AutomationApiError('Não achei essa importação na sua conta.', { code: 'PDF_IMPORT_JOB_NOT_FOUND', statusCode: 404 });
      return makeResult({
        ok: true,
        code: 'PDF_IMPORT_JOB_STATUS',
        job: sanitizeJob(job),
        whatsapp: { text: createStatusText(job) }
      });
    });
  }

  function cancelJob(payload = {}, meta = {}) {
    const channel = payload.source?.channel || payload.channel || 'whatsapp';
    const idempotencyKey = String(meta.idempotencyKey || payload.idempotency_key || '').trim();
    return withHandling(payload, meta, 'imports.pdf.cancel', (resolved) => executeIdempotentWrite({
      userId: resolved.user.id,
      channel,
      idempotencyKey,
      operation: 'imports.pdf.cancel',
      hashPayload: { job_id: payload.job_id || payload.jobId || payload.id || null },
      fn: () => {
        const jobId = toInt(payload.job_id || payload.jobId || payload.id || 0, 0);
        if (!jobId) throw new AutomationApiError('Me diga qual importação quer cancelar. Exemplo: cancelar importação #12.', { code: 'PDF_IMPORT_JOB_ID_REQUIRED', statusCode: 400 });
        try {
          const job = repository.cancelJob(resolved.user.id, jobId);
          if (!job) throw new AutomationApiError('Não achei essa importação na sua conta.', { code: 'PDF_IMPORT_JOB_NOT_FOUND', statusCode: 404 });
          return makeResult({
            ok: true,
            code: 'PDF_IMPORT_JOB_CANCELLED',
            job: sanitizeJob(job),
            whatsapp: { text: `🧹 Importação #${job.id} cancelada.\n\nArquivo: *${job.originalFilename || job.original_filename || 'fatura.pdf'}*\nNada foi lançado no AcerttaPay.` }
          });
        } catch (error) {
          if (error instanceof AutomationApiError) throw error;
          throw new AutomationApiError(error.message || 'Não consegui cancelar essa importação agora.', {
            code: error.code || 'PDF_IMPORT_CANCEL_FAILED',
            statusCode: error.code === 'PDF_IMPORT_RUNNING' ? 409 : 400
          });
        }
      }
    }));
  }

  function listRecentJobs(payload = {}, meta = {}) {
    return withHandling(payload, meta, 'imports.pdf.list_jobs', (resolved) => {
      const jobs = repository.listJobsForUser(resolved.user.id, { limit: Math.max(1, Math.min(10, toInt(payload.limit || 5, 5))) });
      const cleanJobs = jobs.map(sanitizeJob);
      const lines = cleanJobs.length
        ? cleanJobs.map((job) => `#${job.id} · ${job.original_filename} · ${job.card_name} · ${periodLabel(job.month, job.year)} · ${job.status_label}`).join('\n')
        : 'Nenhuma importação de PDF recente por aqui.';
      return makeResult({
        ok: true,
        code: 'PDF_IMPORT_JOBS_LISTED',
        jobs: cleanJobs,
        whatsapp: {
          text: `📚 *Importações recentes*\n\n${lines}\n\nPara acompanhar, mande: *status da importação #número*.`
        }
      });
    });
  }

  function handleConversationReply(payload = {}, meta = {}) {
    const channel = payload.source?.channel || payload.channel || 'whatsapp';
    const idempotencyKey = String(meta.idempotencyKey || payload.idempotency_key || '').trim();
    return withHandling(payload, meta, 'imports.pdf.conversation_reply', (resolved) => executeIdempotentWrite({
      userId: resolved.user.id,
      channel,
      idempotencyKey,
      operation: 'imports.pdf.conversation_reply',
      hashPayload: {
        phone: resolved.phone.e164,
        reply: payload.reply || null,
        raw_text: payload.source?.raw_text || payload.message_text || payload.text || ''
      },
      fn: () => {
        const conversation = repository.getOpenConversationForUser(resolved.user.id, resolved.phone.e164);
        if (!conversation || conversation.state !== 'awaiting_pdf_import_details') {
          throw new AutomationApiError('Não encontrei uma fatura esperando cartão/mês/ano por aqui.', {
            code: 'PDF_IMPORT_CONVERSATION_NOT_FOUND',
            statusCode: 404
          });
        }
        const conversationPayload = repository.getConversationPayload(conversation) || {};
        const stagingId = Number(conversationPayload.staging_id || payload.staging_id || 0);
        const staging = repository.getStagingByIdForUser(resolved.user.id, stagingId);
        if (!staging || staging.status !== 'waiting_details') {
          repository.resolveConversationState(conversation.id);
          throw new AutomationApiError('Esse PDF não está mais disponível para completar. Me manda a fatura de novo.', {
            code: 'PDF_IMPORT_STAGING_EXPIRED',
            statusCode: 410
          });
        }
        if (new Date(staging.expires_at).getTime() <= Date.now()) {
          repository.cancelStaging(resolved.user.id, staging.id);
          repository.resolveConversationState(conversation.id);
          throw new AutomationApiError('Esse PDF expirou antes de receber os dados. Me manda a fatura de novo para eu recomeçar.', {
            code: 'PDF_IMPORT_STAGING_EXPIRED',
            statusCode: 410
          });
        }
        const rawText = payload.source?.raw_text || payload.message_text || payload.text || '';
        const reply = payload.reply || {};
        const normalized = normalizeText(rawText || reply.intent || '');
        if (['cancelar', 'cancela', 'nao', 'não', 'deixa pra la', 'deixa para la'].some((token) => normalized.includes(normalizeText(token)))) {
          repository.cancelStaging(resolved.user.id, staging.id);
          repository.resolveConversationState(conversation.id);
          return makeResult({
            ok: true,
            code: 'PDF_IMPORT_STAGING_CANCELLED',
            whatsapp: { text: 'Fechado, cancelei essa importação de PDF. Nada foi lançado nem colocado na fila.' }
          });
        }

        const details = resolveDetails(resolved.user.id, reply, {
          card_hint: staging.card_hint || conversationPayload.card_hint || null,
          month: staging.month || conversationPayload.known?.month || null,
          year: staging.year || conversationPayload.known?.year || null
        });
        if (details.cardAmbiguous) details.missing = Array.from(new Set(['card', ...details.missing]));
        if (details.missing.length) {
          const updated = repository.updateConversationState(conversation.id, {
            state: 'awaiting_pdf_import_details',
            ttlMinutes: repository.getStagingTtlMinutes(),
            payload: {
              ...conversationPayload,
              missing: details.missing,
              known: {
                card_name: details.card?.name || null,
                month: details.month || null,
                year: details.year || null
              },
              card_hint: details.cardHint || conversationPayload.card_hint || null
            }
          });
          return makeResult({
            ok: false,
            code: 'NEEDS_PDF_IMPORT_DETAILS',
            conversation: { id: Number(updated?.id || conversation.id), state: 'awaiting_pdf_import_details', expires_at: updated?.expires_at || conversation.expires_at },
            missing: details.missing,
            cards: details.activeCards.map((card) => ({ id: Number(card.id || 0), label: card.name || `Cartão #${card.id}` })),
            whatsapp: {
              text: buildNeedDetailsText({
                missing: details.missing,
                cards: details.activeCards,
                filename: staging.original_filename,
                known: {
                  card_name: details.card?.name || null,
                  month: details.month || null,
                  year: details.year || null
                }
              })
            }
          }, 202);
        }

        const file = repository.loadStagingFile(staging);
        validatePdfFile(file, repository);
        const enqueueResult = repository.enqueuePdfImportJob(resolved.user.id, {
          cardId: details.card.id,
          month: details.month,
          year: details.year,
          file
        }, statementPdfService);
        const job = enqueueResult.jobs?.[0];
        if (!job) throw new AutomationApiError('Não consegui criar o job dessa fatura agora.', { code: 'PDF_IMPORT_JOB_NOT_CREATED', statusCode: 500 });
        repository.markStagingConsumed(resolved.user.id, staging.id, job.id);
        repository.resolveConversationState(conversation.id);
        repository.createLocalNotification({
          userId: resolved.user.id,
          title: 'PDF recebido pelo WhatsApp',
          body: `${file.originalname || 'Fatura'} entrou na fila de importação do ${details.card.name} (${periodLabel(details.month, details.year)}).`,
          href: `/import`,
          relatedType: 'statement_import_job',
          relatedId: job.id
        });
        return buildJobCreatedResponse({ job });
      }
    }));
  }

  return {
    createPdfImportJob,
    getJobStatus,
    cancelJob,
    listRecentJobs,
    handleConversationReply
  };
}

module.exports = {
  createAutomationPdfImportsService
};
