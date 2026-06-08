const dayjs = require('dayjs');
const { formatBRLFromCents } = require('../utils');
const { createAutomationApiRepository } = require('../repositories/automationApi.repository');

class PurchaseCreationError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'PurchaseCreationError';
    this.code = options.code || 'VALIDATION_ERROR';
    this.statusCode = options.statusCode || 400;
    this.details = options.details || null;
  }
}

function normalizeDayNumber(value) {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 31) return null;
  return parsed;
}

function monthLabel(month, year) {
  return `${String(Number(month || 0)).padStart(2, '0')}/${Number(year || 0)}`;
}

function getInstallmentMonths(startYear, startMonth, installments) {
  const months = [];
  let currentYear = Number(startYear);
  let currentMonth = Number(startMonth);

  for (let i = 0; i < installments; i += 1) {
    months.push({ year: currentYear, month: currentMonth, index: i + 1 });
    currentMonth += 1;
    if (currentMonth > 12) {
      currentMonth = 1;
      currentYear += 1;
    }
  }

  return months;
}

function suggestFirstDueMonth(purchaseDate, closeDay, dueDay) {
  const purchase = dayjs(purchaseDate);
  if (!purchase.isValid()) return null;

  const normalizedCloseDay = normalizeDayNumber(closeDay);
  const normalizedDueDay = normalizeDayNumber(dueDay);
  let target = purchase.startOf('month');

  if (normalizedCloseDay && normalizedDueDay && normalizedCloseDay > normalizedDueDay) {
    target = target.add(1, 'month');
  }

  if (normalizedCloseDay) {
    const effectiveCloseDay = Math.min(normalizedCloseDay, purchase.daysInMonth());
    if (purchase.date() >= effectiveCloseDay) {
      target = target.add(1, 'month');
    }
  }

  return target.format('YYYY-MM');
}

function resolveFirstDueMonth({ firstDue, purchaseDate, closeDay, dueDay }) {
  const provided = String(firstDue || '').trim();
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(provided)) return provided;
  return suggestFirstDueMonth(purchaseDate, closeDay, dueDay);
}

function normalizePositiveInteger(value, fallback = 1) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
}

function parseBooleanLike(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ['1', 'true', 'on', 'yes', 'sim', 'recorrente', 'mensal'].includes(normalized);
}

function normalizeAmountCents(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  const raw = String(value || '').trim();
  if (!raw) return 0;
  if (/^-?\d+$/.test(raw)) return Number(raw);
  const digits = raw.replace(/\D/g, '');
  return digits ? Number(digits) : 0;
}

function normalizeDescription(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

function buildEqualShareMap(totalCents, personIds) {
  const ids = Array.from(new Set((personIds || []).map(Number).filter(Boolean)));
  const shareMap = {};
  if (!ids.length) return shareMap;

  const numericTotal = Number(totalCents || 0);
  const share = Math.floor(numericTotal / ids.length);
  const remainder = numericTotal - (share * ids.length);

  ids.forEach((personId, index) => {
    const extra = index < Math.abs(remainder) ? Math.sign(remainder) : 0;
    shareMap[personId] = share + extra;
  });

  return shareMap;
}

function normalizeShareAmountInput(rawValue) {
  if (rawValue === null || rawValue === undefined) return null;
  if (typeof rawValue === 'number' && Number.isFinite(rawValue)) return Math.round(rawValue);
  const stringValue = String(rawValue).trim();
  if (!stringValue) return null;
  if (/^-?\d+$/.test(stringValue)) return Number(stringValue);
  const digits = stringValue.replace(/\D/g, '');
  return digits ? Number(digits) : null;
}

function formatInstallmentDescription(description, index, total) {
  return `${description} (${String(index).padStart(2, '0')}/${String(total).padStart(2, '0')})`;
}

function createPurchaseCreationService(deps = {}) {
  const repository = deps.repository || createAutomationApiRepository();

  function assertValidDate(date) {
    const value = String(date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !dayjs(value).isValid()) {
      throw new PurchaseCreationError('Me passa uma data válida para essa compra seguir no trilho.', {
        code: 'INVALID_DATE',
        statusCode: 400
      });
    }
    return value;
  }

  function normalizePurchasePayload(purchase = {}) {
    const date = assertValidDate(purchase.date || purchase.txn_date || purchase.purchase_date);
    const description = normalizeDescription(purchase.description || purchase.merchant || purchase.title);
    const amountCents = normalizeAmountCents(purchase.amount_cents ?? purchase.amountCents ?? purchase.amount);
    const installments = Math.min(120, normalizePositiveInteger(purchase.installments, 1));
    const isRecurring = parseBooleanLike(purchase.is_recurring ?? purchase.isRecurring ?? false);
    const purchaseCategoryId = Number(purchase.purchase_category_id || purchase.purchaseCategoryId || 0) || null;

    if (!description) {
      throw new PurchaseCreationError('Faltou a descrição da compra. Me conta onde foi esse gasto?', {
        code: 'MISSING_DESCRIPTION',
        statusCode: 400
      });
    }

    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      throw new PurchaseCreationError('Me conta um valor válido para salvar essa compra.', {
        code: 'INVALID_AMOUNT',
        statusCode: 400
      });
    }

    if (isRecurring && installments !== 1) {
      throw new PurchaseCreationError('Lançamento recorrente mensal funciona só com 1 parcela. Me confirma se é recorrente ou parcelado?', {
        code: 'AMBIGUOUS_RECURRING_INSTALLMENTS',
        statusCode: 400
      });
    }

    return {
      date,
      description,
      amountCents,
      installments,
      isRecurring,
      purchaseCategoryId,
      firstDue: purchase.first_due || purchase.firstDue || purchase.due_month || purchase.dueMonth || ''
    };
  }

  function validatePurchaseCategory(userId, purchaseCategoryId) {
    if (!purchaseCategoryId) return null;
    const category = repository.getPurchaseCategory(userId, purchaseCategoryId);
    if (!category) {
      throw new PurchaseCreationError('A categoria informada não existe para esse usuário.', {
        code: 'INVALID_PURCHASE_CATEGORY',
        statusCode: 400
      });
    }
    if (Number(category.active || 0) === 0) {
      throw new PurchaseCreationError('Essa categoria está desativada. Escolha outra para seguir.', {
        code: 'INACTIVE_PURCHASE_CATEGORY',
        statusCode: 400
      });
    }
    return Number(category.id || 0) || null;
  }

  function createAutomationPurchase({ userId, purchase, source = {}, cardId = null, assignToSelf = true }) {
    const safeUserId = Number(userId || 0);
    if (!safeUserId) {
      throw new PurchaseCreationError('Usuário inválido para criar compra.', {
        code: 'INVALID_USER',
        statusCode: 400
      });
    }

    const normalized = normalizePurchasePayload(purchase || {});
    const safeCardId = Number(cardId || purchase?.card_id || purchase?.cardId || 0);
    const card = repository.getActiveCardById(safeUserId, safeCardId);
    if (!card) {
      throw new PurchaseCreationError('Cartão não encontrado ou desativado.', {
        code: 'INVALID_CARD',
        statusCode: 400
      });
    }

    const purchaseCategoryId = validatePurchaseCategory(safeUserId, normalized.purchaseCategoryId);
    const resolvedFirstDue = resolveFirstDueMonth({
      firstDue: normalized.firstDue,
      purchaseDate: normalized.date,
      closeDay: card.close_day,
      dueDay: card.due_day
    });

    if (!resolvedFirstDue) {
      throw new PurchaseCreationError('Não consegui descobrir a fatura dessa compra.', {
        code: 'INVALID_DUE_MONTH',
        statusCode: 400
      });
    }

    const [startYear, startMonth] = resolvedFirstDue.split('-').map(Number);
    const installmentMonths = getInstallmentMonths(startYear, startMonth, normalized.installments);
    const locked = installmentMonths.find((item) => repository.isMonthClosed(safeUserId, item.month, item.year));
    if (locked) {
      throw new PurchaseCreationError(`Essa fatura já foi fechada (${monthLabel(locked.month, locked.year)}). Não mexi nela para não bagunçar o que já foi pago.`, {
        code: 'MONTH_CLOSED',
        statusCode: 423,
        details: { month: locked.month, year: locked.year }
      });
    }

    const selfPerson = assignToSelf ? repository.getSelfPerson(safeUserId) : null;
    if (assignToSelf && !selfPerson) {
      throw new PurchaseCreationError('Antes de lançar pelo WhatsApp, ajuste seu perfil em Minha Rede.', {
        code: 'SELF_PROFILE_REQUIRED',
        statusCode: 409
      });
    }

    const installmentValue = Math.floor(normalized.amountCents / normalized.installments);
    const remainder = normalized.amountCents % normalized.installments;
    const createdTxnIds = [];
    let recurringRuleId = null;
    let rootTransactionId = null;

    const rawJson = repository.safeJsonStringify({
      source: 'automation',
      channel: source.channel || 'whatsapp',
      instance: source.instance || null,
      message_id: source.message_id || source.messageId || null,
      raw_text: source.raw_text || source.rawText || null,
      created_by: 'automation_api_v1'
    }, '{}');

    repository.db.transaction(() => {
      if (normalized.isRecurring) {
        recurringRuleId = repository.insertRecurringRule({
          userId: safeUserId,
          cardId: Number(card.id || 0),
          description: normalized.description,
          amountCents: normalized.amountCents,
          purchaseCategoryId,
          date: normalized.date,
          startDueMonth: startMonth,
          startDueYear: startYear
        });
      }

      installmentMonths.forEach((installment) => {
        const currentAmount = installment.index === normalized.installments
          ? installmentValue + remainder
          : installmentValue;
        const finalDescription = normalized.installments > 1
          ? formatInstallmentDescription(normalized.description, installment.index, normalized.installments)
          : normalized.description;
        const transactionId = repository.insertTransaction({
          userId: safeUserId,
          cardId: Number(card.id || 0),
          date: normalized.date,
          description: finalDescription,
          amountCents: currentAmount,
          dueMonth: installment.month,
          dueYear: installment.year,
          parentTxnId: rootTransactionId && normalized.installments > 1 ? rootTransactionId : null,
          recurringRuleId: recurringRuleId || null,
          purchaseCategoryId,
          rawJson
        });

        if (!rootTransactionId) rootTransactionId = transactionId;
        createdTxnIds.push(transactionId);

        if (assignToSelf && selfPerson?.id) {
          repository.insertAllocation({
            userId: safeUserId,
            transactionId,
            personId: Number(selfPerson.id || 0),
            shareCents: currentAmount
          });
        }
      });
    })();

    const root = repository.getTransactionById(safeUserId, rootTransactionId);
    return {
      id: rootTransactionId,
      root_transaction_id: rootTransactionId,
      transaction_ids: createdTxnIds,
      description: normalized.description,
      amount_cents: normalized.amountCents,
      installments: normalized.installments,
      is_recurring: normalized.isRecurring,
      card_id: Number(card.id || 0),
      card_name: card.name,
      due_month: Number(root?.month || startMonth),
      due_year: Number(root?.year || startYear),
      purchase_category_id: purchaseCategoryId
    };
  }

  function getSplitOptions({ userId, purchaseId }) {
    const safeUserId = Number(userId || 0);
    const rows = repository.getPurchaseScopeRows(safeUserId, Number(purchaseId || 0));
    if (!rows.length) {
      throw new PurchaseCreationError('Não encontrei essa compra por aqui.', {
        code: 'PURCHASE_NOT_FOUND',
        statusCode: 404
      });
    }

    const root = rows[0];
    const options = repository.getSplitEligiblePeople(safeUserId);
    return {
      purchase_id: Number(purchaseId || 0),
      root_transaction_id: Number(root.parent_txn_id || root.id || 0),
      transaction_ids: rows.map((row) => Number(row.id || 0)),
      description: root.description,
      amount_cents: rows.reduce((sum, row) => sum + Math.max(0, Number(row.amount_cents || 0)), 0),
      installment_amount_cents: Number(root.amount_cents || 0),
      installments: rows.length,
      options
    };
  }

  function resolveParticipantIds({ userId, participants }) {
    const options = repository.getSplitEligiblePeople(userId);
    const byToken = new Map();
    options.forEach((option) => {
      byToken.set(String(option.id), option);
      byToken.set(String(option.person_id), option);
      byToken.set(String(option.label || '').trim().toLowerCase(), option);
      byToken.set(String(option.name || '').trim().toLowerCase(), option);
    });

    const raw = Array.isArray(participants) ? participants : [participants];
    const ids = [];
    raw.forEach((entry) => {
      const token = typeof entry === 'object' && entry !== null
        ? (entry.participant ?? entry.id ?? entry.person_id ?? entry.name ?? entry.label)
        : entry;
      const normalizedToken = String(token || '').trim();
      if (!normalizedToken) return;
      const lookupKey = normalizedToken.toLowerCase();
      const option = byToken.get(normalizedToken) || byToken.get(lookupKey);
      if (!option?.person_id) {
        throw new PurchaseCreationError(`Não encontrei ${normalizedToken} na lista de divisão dessa compra.`, {
          code: 'INVALID_PARTICIPANT',
          statusCode: 400
        });
      }
      ids.push(Number(option.person_id || 0));
    });

    return Array.from(new Set(ids.filter(Boolean)));
  }

  function buildExactShareMap({ userId, rows, shares }) {
    const baseAmount = Number(rows[0]?.amount_cents || 0);
    const differentAmount = rows.find((row) => Number(row.amount_cents || 0) !== baseAmount);
    if (differentAmount) {
      throw new PurchaseCreationError('Valores definidos só funcionam quando todas as parcelas têm o mesmo valor. Para essa compra, usa partes iguais ou ajusta pelo app.', {
        code: 'EXACT_SPLIT_UNSUPPORTED_FOR_INSTALLMENTS',
        statusCode: 400
      });
    }

    const shareRows = Array.isArray(shares) ? shares : [];
    if (!shareRows.length) {
      throw new PurchaseCreationError('Me passa os valores de cada participante para fechar essa divisão.', {
        code: 'MISSING_EXACT_SHARES',
        statusCode: 400
      });
    }

    const participantIds = resolveParticipantIds({
      userId,
      participants: shareRows.map((row) => row?.participant ?? row?.person_id ?? row?.id ?? row?.name)
    });
    const shareByPerson = new Map();

    shareRows.forEach((row) => {
      const ids = resolveParticipantIds({ userId, participants: [row?.participant ?? row?.person_id ?? row?.id ?? row?.name] });
      const personId = ids[0];
      const cents = normalizeShareAmountInput(row?.amount_cents ?? row?.amountCents ?? row?.amount ?? row?.value);
      if (!personId || cents === null || !Number.isFinite(cents)) {
        throw new PurchaseCreationError('Revise os valores definidos. Cada pessoa marcada precisa ter um valor válido.', {
          code: 'INVALID_EXACT_SHARE',
          statusCode: 400
        });
      }
      shareByPerson.set(personId, Math.abs(Math.round(cents)));
    });

    const map = {};
    participantIds.forEach((personId) => {
      if (!shareByPerson.has(personId)) {
        throw new PurchaseCreationError('Cada participante precisa ter um valor informado.', {
          code: 'MISSING_EXACT_SHARE',
          statusCode: 400
        });
      }
      map[personId] = baseAmount < 0 ? -shareByPerson.get(personId) : shareByPerson.get(personId);
    });

    const total = Object.values(map).reduce((sum, value) => sum + Math.abs(Number(value || 0)), 0);
    const targetAbs = Math.abs(baseAmount);
    if (total !== targetAbs) {
      const diff = Math.abs(targetAbs - total);
      throw new PurchaseCreationError(total < targetAbs
        ? `Ainda falta ${formatBRLFromCents(diff)} para fechar o total da compra.`
        : `Passou ${formatBRLFromCents(diff)} do total da compra. Dá uma aparada e tenta de novo.`, {
          code: 'SPLIT_TOTAL_MISMATCH',
          statusCode: 400,
          details: { expected_cents: targetAbs, provided_cents: total }
        });
    }

    return { participantIds, shareMap: map };
  }

  function queueSharedDebtDraftsForRows(userId, rows) {
    const cleanRows = Array.isArray(rows) ? rows.filter(Boolean) : [];
    const transactionIds = cleanRows.map((row) => Number(row.id || 0)).filter(Boolean);
    if (!transactionIds.length) {
      return { queueCount: 0, itemCount: 0, totalCents: 0, shareableCount: 0, createCount: 0 };
    }

    repository.clearDraftSharedDebtItemsForTransactions(userId, transactionIds);

    const queueGroups = new Map();
    cleanRows.forEach((row) => {
      const eligibleRows = repository.getSharedDebtEligibleAllocationRows(userId, row.id);
      eligibleRows.forEach((allocation) => {
        const receiverUserId = Number(allocation.receiver_user_id || 0);
        const sourceDueMonth = Number(row.month || row.due_month || 0);
        const sourceDueYear = Number(row.year || row.due_year || 0);
        const personId = Number(allocation.person_id || 0);
        const shareCents = Number(allocation.share_cents || 0);
        if (!receiverUserId || !sourceDueMonth || !sourceDueYear || !personId || shareCents <= 0) return;

        const key = `${receiverUserId}:${sourceDueYear}:${sourceDueMonth}`;
        if (!queueGroups.has(key)) {
          queueGroups.set(key, {
            receiverUserId,
            month: sourceDueMonth,
            year: sourceDueYear,
            receiverEmailSnapshot: allocation.person_email || allocation.receiver_user_email || null,
            receiverNameSnapshot: allocation.person_name || allocation.receiver_user_name || null,
            items: []
          });
        }

        queueGroups.get(key).items.push({
          requesterUserId: Number(userId || 0),
          receiverUserId,
          sourceTransactionId: Number(row.id || 0),
          sourceAllocationId: Number(allocation.allocation_id || 0) || null,
          sourcePersonId: personId,
          sourceDueMonth,
          sourceDueYear,
          sourceTxnDateSnapshot: row.txn_date || null,
          cardId: Number(row.card_id || 0) || null,
          cardNameSnapshot: row.card_name || null,
          descriptionSnapshot: row.description || '(sem descrição)',
          amountCents: shareCents,
          receiverEmailSnapshot: allocation.person_email || allocation.receiver_user_email || null,
          receiverNameSnapshot: allocation.person_name || allocation.receiver_user_name || null
        });
      });
    });

    const touchedQueueIds = new Set();
    let itemCount = 0;
    let totalCents = 0;

    repository.db.transaction(() => {
      queueGroups.forEach((group) => {
        const existing = repository.getDraftQueue({
          requesterUserId: userId,
          receiverUserId: group.receiverUserId,
          month: group.month,
          year: group.year
        });
        const queueId = Number(existing?.id || 0) || repository.createDraftQueue({
          requesterUserId: userId,
          receiverUserId: group.receiverUserId,
          month: group.month,
          year: group.year,
          receiverEmailSnapshot: group.receiverEmailSnapshot,
          receiverNameSnapshot: group.receiverNameSnapshot
        });
        touchedQueueIds.add(queueId);
        group.items.forEach((item) => {
          repository.upsertDraftQueueItem({ ...item, queueId });
          itemCount += 1;
          totalCents += Math.max(0, Number(item.amountCents || 0));
        });
        repository.refreshSharedDebtQueue(queueId);
      });
    })();

    return {
      queueCount: touchedQueueIds.size,
      itemCount,
      totalCents,
      shareableCount: touchedQueueIds.size,
      createCount: itemCount
    };
  }

  function applySplit({ userId, purchaseId, mode = 'equal', participants = [], shares = [] }) {
    const safeUserId = Number(userId || 0);
    const rows = repository.getPurchaseScopeRows(safeUserId, Number(purchaseId || 0));
    if (!rows.length) {
      throw new PurchaseCreationError('Não encontrei essa compra por aqui.', {
        code: 'PURCHASE_NOT_FOUND',
        statusCode: 404
      });
    }

    const locked = rows.find((row) => repository.isMonthClosed(safeUserId, row.month, row.year));
    if (locked) {
      throw new PurchaseCreationError(`Essa fatura já foi fechada (${monthLabel(locked.month, locked.year)}). Não mexi nela para não bagunçar o que já foi pago.`, {
        code: 'MONTH_CLOSED',
        statusCode: 423,
        details: { month: locked.month, year: locked.year }
      });
    }

    const normalizedMode = String(mode || 'equal').trim().toLowerCase() === 'exact' ? 'exact' : 'equal';
    let participantIds = [];
    let exactShareMap = null;

    if (normalizedMode === 'exact') {
      const exact = buildExactShareMap({ userId: safeUserId, rows, shares });
      participantIds = exact.participantIds;
      exactShareMap = exact.shareMap;
    } else {
      participantIds = resolveParticipantIds({ userId: safeUserId, participants });
    }

    if (!participantIds.length) {
      throw new PurchaseCreationError('Escolha pelo menos um participante para essa compra.', {
        code: 'MISSING_PARTICIPANTS',
        statusCode: 400
      });
    }

    repository.db.transaction(() => {
      rows.forEach((row) => {
        repository.deleteAllocationsForTransaction(safeUserId, row.id);
        const shareMap = normalizedMode === 'exact'
          ? exactShareMap
          : buildEqualShareMap(Number(row.amount_cents || 0), participantIds);
        participantIds.forEach((personId) => {
          repository.insertAllocation({
            userId: safeUserId,
            transactionId: Number(row.id || 0),
            personId,
            shareCents: Number(shareMap[personId] || 0)
          });
        });
      });
    })();

    const queueSummary = queueSharedDebtDraftsForRows(safeUserId, rows);
    return {
      purchase_id: Number(purchaseId || 0),
      transaction_ids: rows.map((row) => Number(row.id || 0)),
      mode: normalizedMode,
      participants: participantIds,
      affected_count: rows.length,
      queue_summary: queueSummary
    };
  }

  return {
    createAutomationPurchase,
    getSplitOptions,
    applySplit,
    queueSharedDebtDraftsForRows,
    normalizePurchasePayload,
    monthLabel
  };
}

module.exports = {
  PurchaseCreationError,
  createPurchaseCreationService
};
