const { createSharedPurchaseProjectionRepository } = require('../repositories/sharedPurchaseProjection.repository');
const { computeDueDate } = require('../dueDate');

const SHARED_PURCHASE_PROJECTION_FEATURE_FLAG = 'ENABLE_SHARED_PURCHASE_PROJECTIONS';
const SHARED_PURCHASE_PROJECTION_KIND = 'shared_received';
const SHARED_PURCHASE_PROJECTION_ID_PREFIX = 'shared-request:';

function parseBooleanFlag(value, defaultValue = true) {
  if (value === undefined || value === null || value === '') return !!defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (['0', 'false', 'off', 'no', 'nao', 'não', 'disabled'].includes(normalized)) return false;
  if (['1', 'true', 'on', 'yes', 'sim', 'enabled'].includes(normalized)) return true;
  return !!defaultValue;
}

function isSharedPurchaseProjectionEnabled(env = process.env) {
  return parseBooleanFlag(env?.[SHARED_PURCHASE_PROJECTION_FEATURE_FLAG], true);
}

function isSharedPurchaseProjectionId(value) {
  return String(value || '').startsWith(SHARED_PURCHASE_PROJECTION_ID_PREFIX);
}

function toPositiveInt(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.round(numeric));
}

function sanitizeText(value, fallback = '') {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text || fallback;
}

function buildVirtualCardName(row = {}) {
  const requesterName = sanitizeText(row.requester_name, row.requester_email || 'amigo');
  const cardName = sanitizeText(row.card_name_snapshot || row.source_card_name, 'cartão compartilhado');
  return `Compartilhado por ${requesterName} - ${cardName}`;
}

function buildSharedCardLabel(row = {}) {
  const requesterName = sanitizeText(row.requester_name, row.requester_email || 'Amigo');
  const cardName = sanitizeText(row.card_name_snapshot || row.source_card_name, 'cartão');
  return `${requesterName} - ${cardName}`;
}

function buildInheritedDueDate(row = {}, period = {}) {
  const dueDay = Number(row.source_card_due_day || 0);
  const month = Number(period.month || 0);
  const year = Number(period.year || 0);
  if (!dueDay || !month || !year) return null;
  try {
    return computeDueDate({
      year,
      month,
      dueDay,
      holidayScope: row.source_card_holiday_scope || 'BR'
    });
  } catch (error) {
    return null;
  }
}

function buildActionsUrl(row = {}) {
  const requestId = Number(row.request_id || 0);
  return requestId ? `/shared-debts?request=${requestId}#request-${requestId}` : '/shared-debts#received';
}

function buildStatusMeta({ amountCents, confirmedPaidCents, pendingReportedCents, rawStatus } = {}) {
  const amount = toPositiveInt(amountCents);
  const confirmed = Math.min(amount, toPositiveInt(confirmedPaidCents));
  const pending = Math.min(Math.max(0, amount - confirmed), toPositiveInt(pendingReportedCents));
  const status = String(rawStatus || '').trim().toLowerCase();

  if (status === 'settled' || (amount > 0 && confirmed >= amount)) {
    return { statusKey: 'settled', statusLabel: 'Quitada', statusTone: 'success' };
  }
  if (pending > 0) {
    return { statusKey: 'awaiting_confirmation', statusLabel: 'Aguardando confirmação', statusTone: 'warning' };
  }
  if (confirmed > 0) {
    return { statusKey: 'partial', statusLabel: 'Parcial', statusTone: 'info' };
  }
  return { statusKey: 'accepted', statusLabel: 'Aceita', statusTone: 'neutral' };
}

function getProjectionPeriod(row = {}) {
  return {
    month: Number(row.projection_month || row.source_due_month || 0),
    year: Number(row.projection_year || row.source_due_year || 0)
  };
}

function normalizeProjectionRow(row = {}, reportedCents = 0) {
  const requestId = Number(row.request_id || 0);
  const amountCents = toPositiveInt(row.amount_cents);
  const confirmedPaidCents = Math.min(amountCents, toPositiveInt(row.amount_paid_cents || (row.status === 'settled' ? amountCents : 0)));
  const remainingAfterConfirmed = Math.max(0, amountCents - confirmedPaidCents);
  const pendingReportedCents = Math.min(remainingAfterConfirmed, toPositiveInt(reportedCents));
  const openCents = Math.max(0, remainingAfterConfirmed - pendingReportedCents);
  const remainingCents = remainingAfterConfirmed;
  const period = getProjectionPeriod(row);
  const statusMeta = buildStatusMeta({
    amountCents,
    confirmedPaidCents,
    pendingReportedCents,
    rawStatus: row.status
  });
  const requesterName = sanitizeText(row.requester_name, row.requester_email || 'Amigo');
  const cardName = sanitizeText(row.card_name_snapshot || row.source_card_name, 'Cartão compartilhado');
  const categoryName = sanitizeText(row.category_name, 'Compartilhadas');
  const inheritedDueDate = buildInheritedDueDate(row, period);
  const sharedCardLabel = buildSharedCardLabel(row);

  return {
    id: `${SHARED_PURCHASE_PROJECTION_ID_PREFIX}${requestId}`,
    sourceRequestId: requestId,
    kind: SHARED_PURCHASE_PROJECTION_KIND,
    isReadOnly: true,
    requesterUserId: Number(row.requester_user_id || 0),
    receiverUserId: Number(row.receiver_user_id || 0),
    sourceTransactionId: Number(row.source_transaction_id || 0) || null,
    sourceAllocationId: Number(row.source_allocation_id || 0) || null,
    sourcePersonId: Number(row.source_person_id || 0) || null,
    month: period.month,
    year: period.year,
    date: row.display_date || row.source_txn_date_snapshot || row.source_txn_date || row.created_at || null,
    description: sanitizeText(row.description_snapshot || row.source_description, 'Compra compartilhada'),
    amountCents,
    totalCents: amountCents,
    confirmedPaidCents,
    paidCents: confirmedPaidCents,
    pendingReportedCents,
    openCents,
    remainingCents,
    status: statusMeta.statusKey,
    statusLabel: statusMeta.statusLabel,
    statusTone: statusMeta.statusTone,
    rawStatus: row.status || '',
    virtualCardName: buildVirtualCardName(row),
    sharedCardLabel,
    ledgerCardName: sharedCardLabel,
    summaryCardName: sharedCardLabel,
    cardName,
    cardNumber: sanitizeText(row.source_card_number, ''),
    sourceCardId: Number(row.shared_card_id || 0) || null,
    sourceCardDueDay: Number(row.source_card_due_day || 0) || null,
    sourceCardCloseDay: Number(row.source_card_close_day || 0) || null,
    sourceCardHolidayScope: row.source_card_holiday_scope || 'BR',
    inheritedDueDate,
    inheritedDueLabel: inheritedDueDate || '',
    categoryId: Number(row.category_id || 0) || null,
    purchaseCategoryId: Number(row.category_id || 0) || null,
    categoryName,
    purchaseCategoryName: categoryName,
    originLabel: 'Compra compartilhada recebida',
    badgeLabel: 'Compartilhada',
    readOnlyLabel: 'Consulta',
    requesterName,
    requesterEmail: row.requester_email || '',
    receiverName: sanitizeText(row.receiver_name, row.receiver_email || ''),
    receiverEmail: row.receiver_email || '',
    actionsUrl: buildActionsUrl(row),
    sourceTxnDateSnapshot: row.source_txn_date_snapshot || null,
    sourceDueMonth: Number(row.source_due_month || 0) || null,
    sourceDueYear: Number(row.source_due_year || 0) || null,
    requestNote: row.request_note || '',
    paymentNote: row.payment_note || '',
    paymentMarkedAt: row.payment_marked_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    respondedAt: row.responded_at || null,
    resolvedAt: row.resolved_at || null
  };
}

function buildReportedIntentMap(intentRows = []) {
  const map = new Map();
  (Array.isArray(intentRows) ? intentRows : []).forEach((row) => {
    const requesterId = Number(row.requester_user_id || 0);
    const receiverId = Number(row.receiver_user_id || 0);
    const month = Number(row.month || 0);
    const year = Number(row.year || 0);
    if (!requesterId || !receiverId || !month || !year) return;
    const key = `${requesterId}:${receiverId}:${year}:${String(month).padStart(2, '0')}`;
    const amount = toPositiveInt(row.amount_cents);
    if (!amount) return;
    map.set(key, (map.get(key) || 0) + amount);
  });
  return map;
}

function groupRowsBySettlementKey(rows = []) {
  const groups = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const period = getProjectionPeriod(row);
    const requesterId = Number(row.requester_user_id || 0);
    const receiverId = Number(row.receiver_user_id || 0);
    if (!requesterId || !receiverId || !period.month || !period.year) return;
    const key = `${requesterId}:${receiverId}:${period.year}:${String(period.month).padStart(2, '0')}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });
  return groups;
}

function allocateReportedCentsForRows(rows = [], totalReportedCents = 0) {
  const result = new Map();
  const normalizedRows = Array.isArray(rows) ? rows : [];
  let remainingReported = toPositiveInt(totalReportedCents);

  normalizedRows.forEach((row) => {
    const requestId = Number(row.request_id || 0);
    if (!requestId) return;
    const amount = toPositiveInt(row.amount_cents);
    const confirmed = Math.min(amount, toPositiveInt(row.amount_paid_cents || (row.status === 'settled' ? amount : 0)));
    const remainingAfterConfirmed = Math.max(0, amount - confirmed);
    const legacyPending = row.status === 'accepted' && row.payment_marked_at
      ? remainingAfterConfirmed
      : 0;
    const safeLegacyPending = Math.min(remainingAfterConfirmed, toPositiveInt(legacyPending));
    result.set(requestId, safeLegacyPending);
  });

  normalizedRows.forEach((row) => {
    if (!remainingReported) return;
    const requestId = Number(row.request_id || 0);
    if (!requestId) return;
    const amount = toPositiveInt(row.amount_cents);
    const confirmed = Math.min(amount, toPositiveInt(row.amount_paid_cents || (row.status === 'settled' ? amount : 0)));
    const alreadyPending = toPositiveInt(result.get(requestId) || 0);
    const available = Math.max(0, amount - confirmed - alreadyPending);
    if (!available) return;
    const applied = Math.min(available, remainingReported);
    result.set(requestId, alreadyPending + applied);
    remainingReported -= applied;
  });

  return result;
}

function sortProjections(rows = []) {
  return rows.slice().sort((a, b) => {
    const aDate = String(a.date || '');
    const bDate = String(b.date || '');
    if (aDate !== bDate) return aDate.localeCompare(bDate);
    return Number(a.sourceRequestId || 0) - Number(b.sourceRequestId || 0);
  });
}

function summarizeProjections(rows = []) {
  const items = Array.isArray(rows) ? rows : [];
  const totals = items.reduce((acc, item) => {
    acc.count += 1;
    acc.totalCents += toPositiveInt(item.amountCents);
    acc.confirmedPaidCents += toPositiveInt(item.confirmedPaidCents);
    acc.pendingReportedCents += toPositiveInt(item.pendingReportedCents);
    acc.openCents += toPositiveInt(item.openCents);
    acc.remainingCents += toPositiveInt(item.remainingCents);
    return acc;
  }, {
    count: 0,
    totalCents: 0,
    confirmedPaidCents: 0,
    pendingReportedCents: 0,
    openCents: 0,
    remainingCents: 0
  });

  const byRequesterMap = new Map();
  const byCategoryMap = new Map();

  items.forEach((item) => {
    const requesterKey = String(item.requesterUserId || item.requesterName || 'requester');
    if (!byRequesterMap.has(requesterKey)) {
      byRequesterMap.set(requesterKey, {
        requesterUserId: item.requesterUserId || null,
        requesterName: item.requesterName || 'Amigo',
        totalCents: 0,
        confirmedPaidCents: 0,
        pendingReportedCents: 0,
        openCents: 0,
        count: 0
      });
    }
    const requesterBucket = byRequesterMap.get(requesterKey);
    requesterBucket.totalCents += toPositiveInt(item.amountCents);
    requesterBucket.confirmedPaidCents += toPositiveInt(item.confirmedPaidCents);
    requesterBucket.pendingReportedCents += toPositiveInt(item.pendingReportedCents);
    requesterBucket.openCents += toPositiveInt(item.openCents);
    requesterBucket.count += 1;

    const categoryKey = item.categoryName || 'Compartilhadas';
    if (!byCategoryMap.has(categoryKey)) {
      byCategoryMap.set(categoryKey, {
        categoryName: categoryKey,
        totalCents: 0,
        count: 0
      });
    }
    const categoryBucket = byCategoryMap.get(categoryKey);
    categoryBucket.totalCents += toPositiveInt(item.amountCents);
    categoryBucket.count += 1;
  });

  return {
    ...totals,
    hasItems: totals.count > 0,
    byRequester: Array.from(byRequesterMap.values()).sort((a, b) => b.totalCents - a.totalCents),
    byCategory: Array.from(byCategoryMap.values()).sort((a, b) => b.totalCents - a.totalCents),
    rows: items
  };
}

function createSharedPurchaseProjectionService(deps = {}) {
  const repository = deps.repository || createSharedPurchaseProjectionRepository(deps);
  const featureEnv = deps.env || process.env;

  function isEnabled() {
    if (typeof deps.isEnabled === 'function') return !!deps.isEnabled();
    return isSharedPurchaseProjectionEnabled(featureEnv);
  }

  function getAcceptedSharedPurchaseProjections(userId, month, year, options = {}) {
    if (!isEnabled() && !options.ignoreFeatureFlag) return [];

    const rows = repository.getAcceptedProjectionRows(userId, month, year);
    if (!rows.length) return [];

    const reportedIntentRows = repository.getReportedPaymentIntentRows(userId, month, year);
    const reportedBySettlementKey = buildReportedIntentMap(reportedIntentRows);
    const rowsBySettlementKey = groupRowsBySettlementKey(rows);
    const pendingByRequestId = new Map();

    rowsBySettlementKey.forEach((groupRows, key) => {
      const pendingMap = allocateReportedCentsForRows(groupRows, reportedBySettlementKey.get(key) || 0);
      pendingMap.forEach((value, requestId) => pendingByRequestId.set(requestId, value));
    });

    return sortProjections(rows.map((row) => normalizeProjectionRow(row, pendingByRequestId.get(Number(row.request_id || 0)) || 0)));
  }

  function getAcceptedSharedPurchaseProjectionPeriods(userId, options = {}) {
    if (!isEnabled() && !options.ignoreFeatureFlag) return [];
    if (!repository || typeof repository.getAcceptedProjectionPeriods !== 'function') return [];

    return repository.getAcceptedProjectionPeriods(userId)
      .map((row) => ({
        month: Number(row.month || 0),
        year: Number(row.year || 0),
        count: toPositiveInt(row.count),
        totalCents: toPositiveInt(row.total_cents)
      }))
      .filter((row) => row.month >= 1 && row.month <= 12 && row.year > 0)
      .sort((a, b) => {
        if (b.year !== a.year) return b.year - a.year;
        return b.month - a.month;
      });
  }

  function getAcceptedSharedPurchaseProjectionSummary(userId, month, year, options = {}) {
    const rows = getAcceptedSharedPurchaseProjections(userId, month, year, options);
    return {
      enabled: isEnabled() || !!options.ignoreFeatureFlag,
      month: Number(month || 0),
      year: Number(year || 0),
      ...summarizeProjections(rows)
    };
  }

  return {
    isEnabled,
    getAcceptedSharedPurchaseProjections,
    getAcceptedSharedPurchaseProjectionPeriods,
    getAcceptedSharedPurchaseProjectionSummary
  };
}

module.exports = {
  SHARED_PURCHASE_PROJECTION_FEATURE_FLAG,
  SHARED_PURCHASE_PROJECTION_ID_PREFIX,
  SHARED_PURCHASE_PROJECTION_KIND,
  createSharedPurchaseProjectionService,
  isSharedPurchaseProjectionEnabled,
  isSharedPurchaseProjectionId,
  normalizeProjectionRow,
  summarizeProjections
};
