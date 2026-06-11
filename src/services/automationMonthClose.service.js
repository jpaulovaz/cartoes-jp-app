const crypto = require('crypto');
const { createAutomationMonthCloseRepository } = require('../repositories/automationMonthClose.repository');
const { AutomationApiError, normalizeAutomationPhone } = require('./automationApi.service');
const { formatBRLFromCents } = require('../utils');

const MONTH_NAMES = [
  '', 'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'
];

function makeResult(payload = {}, statusCode = 200) {
  return { statusCode, ...payload };
}

function requestHash(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload || {})).digest('hex');
}

function currentSaoPauloDate() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
}

function addMonths(year, month, delta) {
  const d = new Date(Date.UTC(Number(year || 0), Number(month || 1) - 1 + Number(delta || 0), 1));
  return { month: d.getUTCMonth() + 1, year: d.getUTCFullYear() };
}

function resolvePeriod(input = {}) {
  const today = currentSaoPauloDate();
  const [todayYear, todayMonth] = today.split('-').map(Number);
  const rawPeriod = String(input.period || input.when || '').trim().toLowerCase();
  if (['last_month', 'previous_month', 'mes_passado', 'mês passado'].includes(rawPeriod)) return addMonths(todayYear, todayMonth, -1);
  if (['next_month', 'proximo_mes', 'próximo mês'].includes(rawPeriod)) return addMonths(todayYear, todayMonth, 1);
  const month = Number(input.month || input.mes || input.due_month || 0);
  const year = Number(input.year || input.ano || input.due_year || 0);
  if (month >= 1 && month <= 12 && year >= 2000 && year <= 2100) return { month, year };
  return { month: todayMonth, year: todayYear };
}

function periodLabel(month, year) {
  return `${MONTH_NAMES[Number(month || 0)] || String(month || '').padStart(2, '0')}/${year}`;
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

function isCancel(value) {
  const text = normalizeText(value);
  return /^(nao|não|n|cancelar|cancela|deixa|voltar|desistir)$/i.test(text)
    || text.includes('nao quero')
    || text.includes('não quero')
    || text.includes('deixa pra la')
    || text.includes('deixa para la');
}

function isStrongCloseConfirmation(value) {
  const text = normalizeText(value);
  return text === 'fechar mes' || text === 'fechar o mes' || text === 'fechar mês' || text === 'fechar o mês';
}

function isStrongReopenConfirmation(value) {
  const text = normalizeText(value);
  return text === 'reabrir mes' || text === 'reabrir o mes' || text === 'reabrir mês' || text === 'reabrir o mês';
}

function truncateRows(rows = [], limit = 5) {
  return (Array.isArray(rows) ? rows : []).slice(0, Math.max(0, Number(limit || 5) || 5));
}

function plural(count, singular, pluralText) {
  return Number(count || 0) === 1 ? singular : pluralText;
}

function createAutomationMonthCloseService(deps = {}) {
  const repository = deps.monthCloseAutomationRepository || createAutomationMonthCloseRepository();

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
        code: error.code || 'MONTH_CLOSE_VALIDATION_ERROR',
        message: error.message,
        details: error.details || null,
        whatsapp: { text: error.message }
      }, error.statusCode || 400);
    }
    return makeResult({
      ok: false,
      code: 'MONTH_CLOSE_INTERNAL_ERROR',
      message: 'A conferência do fechamento tropeçou por aqui. Tenta de novo em instantes.',
      whatsapp: { text: 'A conferência do fechamento tropeçou por aqui. Tenta de novo em instantes.' }
    }, 500);
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
      throw new AutomationApiError('Idempotency-Key é obrigatório para fechar ou reabrir mês pelo WhatsApp.', {
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        statusCode: 400
      });
    }
    const idempotency = repository.tryCreateIdempotency({
      userId,
      channel,
      idempotencyKey: key,
      operation,
      requestHash: requestHash(hashPayload || {})
    });
    if (!idempotency.created) {
      const cached = repository.safeJsonParse(idempotency.row?.response_json, null);
      if (cached) return makeResult({ ...cached, duplicate: true }, 200);
      throw new AutomationApiError('Essa confirmação já está em processamento. Não repeti a ação.', {
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

  function serializeReadiness(userId, month, year) {
    const isClosed = repository.isMonthClosed(userId, month, year);
    const cards = repository.getCardReadiness(userId, month, year);
    const people = repository.getPersonReadiness(userId, month, year);
    const monthlyFinances = repository.getOpenMonthlyFinances(userId, month, year);
    const drafts = repository.getDraftQueues(userId, month, year);
    const sharedDebts = repository.getSharedDebtPending(userId, month, year);
    const withoutParticipants = repository.getPurchasesWithoutParticipants(userId, month, year);
    const uncategorized = repository.getUncategorizedPurchases(userId, month, year);

    const cardBlockers = cards.filter((row) => Number(row.open_cents || 0) > 0);
    const personBlockers = people.filter((row) => String(row.profile_kind || '').toLowerCase() !== 'self' && Number(row.open_cents || 0) > 0);
    const financeBlockers = monthlyFinances.filter((row) => Number(row.open_cents || 0) > 0);
    const draftBlockers = drafts.filter((row) => Number(row.total_cents || 0) > 0);
    const debtBlockers = sharedDebts.filter((row) => Number(row.open_cents || 0) > 0);
    const participantBlockers = withoutParticipants;

    const critical = [];
    if (cardBlockers.length) critical.push({ type: 'cards_open', label: 'Cartões com fatura em aberto', count: cardBlockers.length, total_cents: cardBlockers.reduce((sum, row) => sum + Number(row.open_cents || 0), 0), items: cardBlockers });
    if (personBlockers.length) critical.push({ type: 'people_open', label: 'Pessoas com saldo em aberto', count: personBlockers.length, total_cents: personBlockers.reduce((sum, row) => sum + Number(row.open_cents || 0), 0), items: personBlockers });
    if (financeBlockers.length) critical.push({ type: 'monthly_finances_open', label: 'Finanças mensais não pagas', count: financeBlockers.length, total_cents: financeBlockers.reduce((sum, row) => sum + Number(row.open_cents || 0), 0), items: financeBlockers });
    if (draftBlockers.length) critical.push({ type: 'shared_debt_drafts', label: 'Cobranças em rascunho', count: draftBlockers.length, total_cents: draftBlockers.reduce((sum, row) => sum + Number(row.total_cents || 0), 0), items: draftBlockers });
    if (debtBlockers.length) critical.push({ type: 'shared_debts_pending', label: 'Cobranças pendentes na Central de Acertos', count: debtBlockers.length, total_cents: debtBlockers.reduce((sum, row) => sum + Number(row.open_cents || 0), 0), items: debtBlockers });
    if (participantBlockers.length) critical.push({ type: 'purchases_without_participants', label: 'Compras sem participantes', count: participantBlockers.length, total_cents: participantBlockers.reduce((sum, row) => sum + Number(row.amount_cents || 0), 0), items: participantBlockers });

    const warnings = [];
    if (uncategorized.length) warnings.push({ type: 'uncategorized_purchases', label: 'Compras sem categoria', count: uncategorized.length, total_cents: uncategorized.reduce((sum, row) => sum + Number(row.amount_cents || 0), 0), items: uncategorized });

    const totals = {
      cards_total_cents: cards.reduce((sum, row) => sum + Number(row.total_cents || 0), 0),
      cards_open_cents: cardBlockers.reduce((sum, row) => sum + Number(row.open_cents || 0), 0),
      people_open_cents: personBlockers.reduce((sum, row) => sum + Number(row.open_cents || 0), 0),
      monthly_finances_open_cents: financeBlockers.reduce((sum, row) => sum + Number(row.open_cents || 0), 0),
      shared_debts_open_cents: debtBlockers.reduce((sum, row) => sum + Number(row.open_cents || 0), 0),
      drafts_total_cents: draftBlockers.reduce((sum, row) => sum + Number(row.total_cents || 0), 0)
    };

    return {
      month: Number(month || 0),
      year: Number(year || 0),
      period_label: periodLabel(month, year),
      is_closed: isClosed,
      can_close: !isClosed && critical.length === 0,
      critical_blockers: critical,
      warnings,
      totals,
      checks: {
        cards,
        people,
        monthly_finances: monthlyFinances,
        draft_queues: drafts,
        shared_debts: sharedDebts,
        purchases_without_participants: withoutParticipants,
        uncategorized_purchases: uncategorized
      }
    };
  }

  function formatBlockerItems(blocker) {
    const rows = truncateRows(blocker.items || [], 4);
    if (!rows.length) return [];
    if (blocker.type === 'cards_open') return rows.map((row) => `• ${row.card_name}: *${formatBRLFromCents(row.open_cents)}* em aberto`);
    if (blocker.type === 'people_open') return rows.map((row) => `• ${row.person_name}: *${formatBRLFromCents(row.open_cents)}* em aberto`);
    if (blocker.type === 'monthly_finances_open') return rows.map((row) => `• #${row.id} — ${row.description}: *${formatBRLFromCents(row.open_cents)}*`);
    if (blocker.type === 'shared_debt_drafts') return rows.map((row) => `• Rascunho #${row.id} para ${row.receiver_name}: *${formatBRLFromCents(row.total_cents)}*`);
    if (blocker.type === 'shared_debts_pending') return rows.map((row) => `• #${row.id} com ${row.person_name}: *${formatBRLFromCents(row.open_cents)}* · ${row.direction === 'incoming' ? 'a pagar' : 'a receber'}`);
    if (blocker.type === 'purchases_without_participants') return rows.map((row) => `• #${row.id} — ${row.description}: *${formatBRLFromCents(row.amount_cents)}*`);
    return rows.map((row) => `• ${row.label || row.description || row.name || `#${row.id}`}`);
  }

  function buildReadinessText(readiness) {
    const label = readiness.period_label;
    const lines = [`🔎 *Conferência de fechamento — ${label}*`, ''];
    lines.push(readiness.is_closed ? '🔒 Esse mês já está *fechado*.' : '🔓 Esse mês ainda está *aberto*.');
    lines.push('');
    lines.push(`💳 Cartões em aberto: *${formatBRLFromCents(readiness.totals.cards_open_cents)}*`);
    lines.push(`👥 Pessoas em aberto: *${formatBRLFromCents(readiness.totals.people_open_cents)}*`);
    lines.push(`📒 Finanças mensais abertas: *${formatBRLFromCents(readiness.totals.monthly_finances_open_cents)}*`);
    lines.push(`🤝 Central de Acertos pendente: *${formatBRLFromCents(readiness.totals.shared_debts_open_cents + readiness.totals.drafts_total_cents)}*`);

    if (readiness.critical_blockers.length) {
      lines.push('', '⚠️ *Antes de fechar, resolve estes pontos:*');
      readiness.critical_blockers.slice(0, 6).forEach((blocker) => {
        lines.push('', `*${blocker.label}* — ${formatBRLFromCents(blocker.total_cents || 0)}`);
        lines.push(...formatBlockerItems(blocker));
        if (Number(blocker.count || 0) > 4) lines.push(`• ...e mais ${blocker.count - 4} ${plural(blocker.count - 4, 'item', 'itens')}`);
      });
      lines.push('', 'Ainda não fechei nada. Fechamento bom é fechamento sem pegadinha. 🔐');
      return lines.join('\n');
    }

    if (readiness.warnings.length) {
      lines.push('', '💡 *Avisos que não bloqueiam:*');
      readiness.warnings.slice(0, 3).forEach((warning) => lines.push(`• ${warning.label}: ${warning.count} ${plural(warning.count, 'item', 'itens')}`));
    }

    if (!readiness.is_closed) {
      lines.push('', '✅ Não encontrei bloqueadores críticos.');
      lines.push('Para fechar por aqui, me diga *fechar mês* depois da confirmação. Sem susto, sem clique sem querer.');
    }
    return lines.join('\n');
  }

  function publicReadiness(readiness) {
    return {
      month: readiness.month,
      year: readiness.year,
      period_label: readiness.period_label,
      is_closed: readiness.is_closed,
      can_close: readiness.can_close,
      blocker_count: readiness.critical_blockers.length,
      warning_count: readiness.warnings.length,
      totals: readiness.totals,
      critical_blockers: readiness.critical_blockers.map((blocker) => ({
        type: blocker.type,
        label: blocker.label,
        count: blocker.count,
        total_cents: blocker.total_cents,
        items: truncateRows(blocker.items, 8)
      })),
      warnings: readiness.warnings.map((warning) => ({
        type: warning.type,
        label: warning.label,
        count: warning.count,
        total_cents: warning.total_cents,
        items: truncateRows(warning.items, 8)
      }))
    };
  }

  function createConfirmationConversation({ resolved, action, period, readiness, source }) {
    return repository.createConversationState({
      userId: resolved.user.id,
      phoneE164: resolved.phone.e164,
      channel: source?.channel || 'whatsapp',
      state: 'awaiting_month_close_confirmation',
      relatedPurchaseId: null,
      payload: {
        domain: 'month_close',
        action,
        period,
        readiness: readiness ? publicReadiness(readiness) : null,
        source: source || {}
      }
    });
  }

  function getReadiness(payload = {}, meta = {}) {
    return withHandling(payload, meta, 'month_close.readiness', (resolved) => {
      const period = resolvePeriod(payload.period || payload.query || payload);
      const readiness = serializeReadiness(resolved.user.id, period.month, period.year);
      return makeResult({
        ok: true,
        code: readiness.is_closed ? 'MONTH_ALREADY_CLOSED' : readiness.can_close ? 'MONTH_READY_TO_CLOSE' : 'MONTH_CLOSE_HAS_BLOCKERS',
        readiness: publicReadiness(readiness),
        whatsapp: { text: buildReadinessText(readiness) }
      });
    });
  }

  function prepareClose(payload = {}, meta = {}) {
    return withHandling(payload, meta, 'month_close.prepare_close', (resolved) => {
      const period = resolvePeriod(payload.period || payload.query || payload);
      const readiness = serializeReadiness(resolved.user.id, period.month, period.year);
      if (readiness.is_closed) {
        return makeResult({
          ok: true,
          code: 'MONTH_ALREADY_CLOSED',
          readiness: publicReadiness(readiness),
          whatsapp: { text: `🔒 *${periodLabel(period.month, period.year)} já está fechado.*\n\nNão mexi em nada. Se precisar, posso te ajudar a reabrir com confirmação reforçada.` }
        });
      }
      if (!readiness.can_close) {
        return makeResult({
          ok: false,
          code: 'MONTH_CLOSE_BLOCKED',
          readiness: publicReadiness(readiness),
          whatsapp: { text: buildReadinessText(readiness) }
        }, 409);
      }
      const conversation = createConfirmationConversation({
        resolved,
        action: 'close',
        period,
        readiness,
        source: payload.source || { channel: payload.channel || 'whatsapp' }
      });
      return makeResult({
        ok: false,
        code: 'NEEDS_MONTH_CLOSE_CONFIRMATION',
        readiness: publicReadiness(readiness),
        conversation: { id: Number(conversation.id || 0), state: conversation.state, expires_at: conversation.expires_at },
        whatsapp: {
          text: [
            `✅ *${periodLabel(period.month, period.year)} passou na conferência.*`,
            '',
            'Posso fechar esse mês e bloquear novas edições nele.',
            '',
            'Para confirmar com segurança, responda exatamente:',
            '*fechar mês*',
            '',
            'Para desistir, responda *cancelar*.'
          ].join('\n')
        }
      }, 202);
    });
  }

  function applyClose(resolved, period, meta = {}, source = {}) {
    const readiness = serializeReadiness(resolved.user.id, period.month, period.year);
    if (readiness.is_closed) {
      return makeResult({
        ok: true,
        code: 'MONTH_ALREADY_CLOSED',
        readiness: publicReadiness(readiness),
        whatsapp: { text: `🔒 *${periodLabel(period.month, period.year)} já estava fechado.*\n\nMantive tudo do jeito que estava.` }
      });
    }
    if (!readiness.can_close) {
      throw new AutomationApiError(buildReadinessText(readiness), {
        code: 'MONTH_CLOSE_BLOCKED',
        statusCode: 409,
        details: { readiness: publicReadiness(readiness) }
      });
    }
    return executeIdempotentWrite({
      userId: resolved.user.id,
      channel: source.channel || 'whatsapp',
      idempotencyKey: meta.idempotencyKey,
      operation: 'month_close.close.confirm',
      hashPayload: { period, action: 'close' },
      fn: () => {
        repository.closeMonth(resolved.user.id, period.month, period.year);
        repository.insertAutomationMutationEvent({
          userId: resolved.user.id,
          phoneE164: resolved.phone.e164,
          operation: 'month_close.close',
          entityType: 'closed_month',
          entityId: null,
          before: { is_closed: false, month: period.month, year: period.year },
          after: { is_closed: true, month: period.month, year: period.year },
          sourceMessageId: source.message_id || null
        });
        return makeResult({
          ok: true,
          code: 'MONTH_CLOSED',
          readiness: publicReadiness({ ...readiness, is_closed: true, can_close: false }),
          whatsapp: {
            text: [
              `🔒 *Mês fechado!*`,
              '',
              `${periodLabel(period.month, period.year)} agora está protegido contra edições.`,
              '',
              'Fechamento feito sem atropelar pendência. Do jeito certo. ✅'
            ].join('\n')
          }
        });
      }
    });
  }

  function confirmClose(payload = {}, meta = {}) {
    return withHandling(payload, meta, 'month_close.confirm_close', (resolved) => {
      const confirmation = payload.confirmation_text || payload.confirmation || payload.reply?.raw_text || payload.source?.raw_text || payload.message || '';
      if (!isStrongCloseConfirmation(confirmation)) {
        throw new AutomationApiError('Para fechar por WhatsApp, responda exatamente *fechar mês*. É a trava anti-clique-sem-querer. 🔐', {
          code: 'STRONG_CONFIRMATION_REQUIRED',
          statusCode: 428
        });
      }
      const period = resolvePeriod(payload.period || payload.query || payload);
      return applyClose(resolved, period, meta, payload.source || { channel: payload.channel || 'whatsapp' });
    });
  }

  function prepareReopen(payload = {}, meta = {}) {
    return withHandling(payload, meta, 'month_close.prepare_reopen', (resolved) => {
      const period = resolvePeriod(payload.period || payload.query || payload);
      const isClosed = repository.isMonthClosed(resolved.user.id, period.month, period.year);
      if (!isClosed) {
        return makeResult({
          ok: true,
          code: 'MONTH_ALREADY_OPEN',
          whatsapp: { text: `🔓 *${periodLabel(period.month, period.year)} já está aberto.*\n\nNão precisei reabrir nada por aqui.` }
        });
      }
      const readiness = serializeReadiness(resolved.user.id, period.month, period.year);
      const conversation = createConfirmationConversation({
        resolved,
        action: 'reopen',
        period,
        readiness,
        source: payload.source || { channel: payload.channel || 'whatsapp' }
      });
      return makeResult({
        ok: false,
        code: 'NEEDS_MONTH_REOPEN_CONFIRMATION',
        readiness: publicReadiness(readiness),
        conversation: { id: Number(conversation.id || 0), state: conversation.state, expires_at: conversation.expires_at },
        whatsapp: {
          text: [
            `⚠️ *Reabrir ${periodLabel(period.month, period.year)}?*`,
            '',
            'Isso libera edições em um mês que já estava protegido.',
            '',
            'Para confirmar, responda exatamente:',
            '*reabrir mês*',
            '',
            'Para manter fechado, responda *cancelar*.'
          ].join('\n')
        }
      }, 202);
    });
  }

  function applyReopen(resolved, period, meta = {}, source = {}) {
    const isClosed = repository.isMonthClosed(resolved.user.id, period.month, period.year);
    if (!isClosed) {
      return makeResult({
        ok: true,
        code: 'MONTH_ALREADY_OPEN',
        whatsapp: { text: `🔓 *${periodLabel(period.month, period.year)} já estava aberto.*\n\nNada mudou por aqui.` }
      });
    }
    return executeIdempotentWrite({
      userId: resolved.user.id,
      channel: source.channel || 'whatsapp',
      idempotencyKey: meta.idempotencyKey,
      operation: 'month_close.reopen.confirm',
      hashPayload: { period, action: 'reopen' },
      fn: () => {
        repository.reopenMonth(resolved.user.id, period.month, period.year);
        repository.insertAutomationMutationEvent({
          userId: resolved.user.id,
          phoneE164: resolved.phone.e164,
          operation: 'month_close.reopen',
          entityType: 'closed_month',
          entityId: null,
          before: { is_closed: true, month: period.month, year: period.year },
          after: { is_closed: false, month: period.month, year: period.year },
          sourceMessageId: source.message_id || null
        });
        return makeResult({
          ok: true,
          code: 'MONTH_REOPENED',
          whatsapp: {
            text: [
              `🔓 *Mês reaberto!*`,
              '',
              `${periodLabel(period.month, period.year)} voltou a aceitar edições.`,
              '',
              'Reabri com cuidado. Agora é ajustar e fechar de novo quando estiver tudo redondo. 🛠️'
            ].join('\n')
          }
        });
      }
    });
  }

  function confirmReopen(payload = {}, meta = {}) {
    return withHandling(payload, meta, 'month_close.confirm_reopen', (resolved) => {
      const confirmation = payload.confirmation_text || payload.confirmation || payload.reply?.raw_text || payload.source?.raw_text || payload.message || '';
      if (!isStrongReopenConfirmation(confirmation)) {
        throw new AutomationApiError('Para reabrir por WhatsApp, responda exatamente *reabrir mês*. Reabertura mexe no cadeado do mês. 🔐', {
          code: 'STRONG_CONFIRMATION_REQUIRED',
          statusCode: 428
        });
      }
      const period = resolvePeriod(payload.period || payload.query || payload);
      return applyReopen(resolved, period, meta, payload.source || { channel: payload.channel || 'whatsapp' });
    });
  }

  function handleConversationReply(payload = {}, meta = {}) {
    return withHandling(payload, meta, 'month_close.conversation_reply', (resolved) => {
      const conversation = repository.getOpenConversationByPhone(resolved.phone.e164);
      if (!conversation || conversation.state !== 'awaiting_month_close_confirmation') {
        throw new AutomationApiError('Não achei uma confirmação pendente de fechamento mensal por aqui.', {
          code: 'NO_PENDING_MONTH_CLOSE_CONVERSATION',
          statusCode: 404
        });
      }
      const data = repository.getConversationPayload(conversation) || {};
      const action = data.action;
      const period = data.period || resolvePeriod(payload.period || payload.query || payload);
      const text = payload.reply?.raw_text || payload.raw_text || payload.source?.raw_text || payload.message || '';

      if (isCancel(text)) {
        repository.resolveConversationState(conversation.id);
        return makeResult({
          ok: true,
          code: 'MONTH_CLOSE_ACTION_CANCELLED',
          whatsapp: { text: 'Combinado, não mexi no cadeado do mês. Melhor cancelar do que fechar no susto. ✅' }
        });
      }

      if (action === 'close') {
        if (!isStrongCloseConfirmation(text)) {
          return makeResult({
            ok: false,
            code: 'NEEDS_MONTH_CLOSE_CONFIRMATION',
            whatsapp: { text: 'Para fechar com segurança, responda exatamente *fechar mês*. Para desistir, responda *cancelar*.' }
          }, 202);
        }
        const result = applyClose(resolved, period, meta, data.source || payload.source || { channel: 'whatsapp' });
        repository.resolveConversationState(conversation.id);
        return result;
      }

      if (action === 'reopen') {
        if (!isStrongReopenConfirmation(text)) {
          return makeResult({
            ok: false,
            code: 'NEEDS_MONTH_REOPEN_CONFIRMATION',
            whatsapp: { text: 'Para reabrir com segurança, responda exatamente *reabrir mês*. Para manter fechado, responda *cancelar*.' }
          }, 202);
        }
        const result = applyReopen(resolved, period, meta, data.source || payload.source || { channel: 'whatsapp' });
        repository.resolveConversationState(conversation.id);
        return result;
      }

      throw new AutomationApiError('Não reconheci essa confirmação de fechamento mensal.', {
        code: 'UNKNOWN_MONTH_CLOSE_ACTION',
        statusCode: 400
      });
    });
  }

  return {
    getReadiness,
    prepareClose,
    confirmClose,
    prepareReopen,
    confirmReopen,
    handleConversationReply
  };
}

module.exports = {
  createAutomationMonthCloseService
};
