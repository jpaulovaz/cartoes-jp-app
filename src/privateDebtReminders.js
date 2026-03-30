const PRIVATE_DEBT_STATUS_OPEN = 'open';
const PRIVATE_DEBT_STATUS_SETTLED = 'settled';
const PRIVATE_DEBT_STATUS_CANCELLED = 'cancelled';

const PRIVATE_DEBT_STATUSES = [
  PRIVATE_DEBT_STATUS_OPEN,
  PRIVATE_DEBT_STATUS_SETTLED,
  PRIVATE_DEBT_STATUS_CANCELLED
];

const PRIVATE_DEBT_ARCHIVABLE_STATUSES = [
  PRIVATE_DEBT_STATUS_SETTLED,
  PRIVATE_DEBT_STATUS_CANCELLED
];

function compactSpaces(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function clampText(value = '', max = 255) {
  const compacted = compactSpaces(value);
  if (!compacted) return '';
  return compacted.slice(0, Math.max(1, Number(max || 0) || 255));
}

function normalizePrivateDebtStatus(value = PRIVATE_DEBT_STATUS_OPEN) {
  const normalized = compactSpaces(value).toLowerCase();
  return PRIVATE_DEBT_STATUSES.includes(normalized) ? normalized : PRIVATE_DEBT_STATUS_OPEN;
}

function sanitizePrivateDebtDescription(value = '', max = 120) {
  return clampText(value, max);
}

function sanitizePrivateDebtNote(value = '', max = 400) {
  const sanitized = clampText(value, max);
  return sanitized || null;
}

function canArchivePrivateDebtStatus(value = PRIVATE_DEBT_STATUS_OPEN) {
  return PRIVATE_DEBT_ARCHIVABLE_STATUSES.includes(normalizePrivateDebtStatus(value));
}

function normalizePrivateDebtIsoDate(value = null) {
  const raw = compactSpaces(value);
  if (!raw) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function normalizePrivateDebtPaymentDate(value = null) {
  return normalizePrivateDebtIsoDate(value);
}

function normalizePrivateDebtPromisedPaymentDate(value = null) {
  return normalizePrivateDebtIsoDate(value);
}

function normalizeBooleanFlag(value) {
  return Number(value || 0) > 0;
}

function buildPrivateDebtPersonSnapshots(person = {}) {
  return {
    personId: Number(person?.id || 0) || null,
    linkedUserIdSnapshot: Number(person?.linked_user_id || person?.linkedUserId || 0) || null,
    personNameSnapshot: clampText(person?.name || person?.deleted_label || 'Contato sem nome', 120) || 'Contato sem nome',
    personEmailSnapshot: clampText(person?.email || '', 160) || null,
    personPhoneSnapshot: clampText(person?.phone || '', 40) || null
  };
}

function mapPrivateDebtReminderRow(row = {}) {
  const amountCents = Math.max(0, Number(row?.amount_cents || row?.amountCents || 0));
  const status = normalizePrivateDebtStatus(row?.status);
  const isArchived = normalizeBooleanFlag(row?.is_archived ?? row?.isArchived);
  const personId = Number(row?.person_id || row?.personId || 0) || null;
  const linkedUserIdSnapshot = Number(row?.linked_user_id_snapshot || row?.linkedUserIdSnapshot || 0) || null;
  const currentPersonName = clampText(row?.current_person_name || row?.currentPersonName || '', 120) || null;
  const currentPersonStatus = clampText(row?.current_person_status || row?.currentPersonStatus || '', 40) || null;
  const currentPersonActive = normalizeBooleanFlag(row?.current_person_active ?? row?.currentPersonActive ?? 1);

  return {
    ...row,
    kind: 'private_reminder',
    id: Number(row?.id || 0) || null,
    owner_user_id: Number(row?.owner_user_id || row?.ownerUserId || 0) || null,
    person_id: personId,
    linked_user_id_snapshot: linkedUserIdSnapshot,
    person_name_snapshot: clampText(row?.person_name_snapshot || row?.personNameSnapshot || '', 120) || currentPersonName || 'Contato sem nome',
    person_email_snapshot: clampText(row?.person_email_snapshot || row?.personEmailSnapshot || '', 160) || null,
    person_phone_snapshot: clampText(row?.person_phone_snapshot || row?.personPhoneSnapshot || '', 40) || null,
    current_person_name: currentPersonName,
    current_person_status: currentPersonStatus,
    current_person_active: currentPersonActive,
    description_snapshot: sanitizePrivateDebtDescription(row?.description_snapshot || row?.descriptionSnapshot || '', 120),
    amount_cents: amountCents,
    request_note: sanitizePrivateDebtNote(row?.request_note || row?.requestNote || '', 400),
    settlement_note: sanitizePrivateDebtNote(row?.settlement_note || row?.settlementNote || '', 400),
    promised_payment_date: normalizePrivateDebtPromisedPaymentDate(row?.promised_payment_date || row?.promisedPaymentDate || null),
    payment_date: normalizePrivateDebtPaymentDate(row?.payment_date || row?.paymentDate || null),
    status,
    is_archivable: canArchivePrivateDebtStatus(status),
    is_archived: isArchived ? 1 : 0,
    archived_at: row?.archived_at || row?.archivedAt || null,
    restored_at: row?.restored_at || row?.restoredAt || null,
    created_at: row?.created_at || row?.createdAt || null,
    updated_at: row?.updated_at || row?.updatedAt || null,
    settled_at: row?.settled_at || row?.settledAt || null,
    cancelled_at: row?.cancelled_at || row?.cancelledAt || null,
    is_open: status === PRIVATE_DEBT_STATUS_OPEN,
    is_settled: status === PRIVATE_DEBT_STATUS_SETTLED,
    is_cancelled: status === PRIVATE_DEBT_STATUS_CANCELLED,
    is_contact_detached: !personId,
    display_name: clampText(row?.person_name_snapshot || row?.personNameSnapshot || currentPersonName || 'Contato sem nome', 120) || 'Contato sem nome'
  };
}

module.exports = {
  PRIVATE_DEBT_STATUS_OPEN,
  PRIVATE_DEBT_STATUS_SETTLED,
  PRIVATE_DEBT_STATUS_CANCELLED,
  PRIVATE_DEBT_STATUSES,
  PRIVATE_DEBT_ARCHIVABLE_STATUSES,
  normalizePrivateDebtStatus,
  canArchivePrivateDebtStatus,
  sanitizePrivateDebtDescription,
  sanitizePrivateDebtNote,
  normalizePrivateDebtPaymentDate,
  normalizePrivateDebtPromisedPaymentDate,
  buildPrivateDebtPersonSnapshots,
  mapPrivateDebtReminderRow
};
