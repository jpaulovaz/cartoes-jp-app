function createFinancesRepository(deps = {}) {
  const {
    db,
    serializeFinanceForApi,
    isMonthClosed,
    normalizeFinanceType,
    normalizeFinanceAmountMode,
    sanitizeFinanceDescription,
    sanitizeVariableFinanceItems,
    normalizeFinanceDayOfMonth,
    normalizeFinanceScheduleKind,
    sumFinanceItemCents,
    createMonthlyFinanceCarryKey,
    getFriendlyErrorMessage,
    getFriendlyErrorDetails,
    getFinanceByIdForUser,
    getFinanceItemsByFinanceId,
    normalizePositiveInteger,
    normalizeFinancePaidFlag,
    buildExpensePaymentProgress,
    normalizeMonthlyFinanceCarryKey,
    syncFutureLegacyFixedFinanceScheduleFromRow,
    getMonthLockMessage,
    nowIso
  } = deps;

  function createFinanceRow({ userId, month, year, type, description, totalCents, amountMode, carryKey, dayOfMonth, scheduleKind, nowIsoValue, items }) {
    const insertFinance = db.prepare(`
      INSERT INTO monthly_finances (user_id, month, year, type, description, formula, amount_cents, amount_mode, carry_key, day_of_month, schedule_kind, created_at)
      VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?)
    `);
    const insertItem = db.prepare(`
      INSERT INTO monthly_finance_items (finance_id, user_id, item_date, item_source, amount_cents, is_paid, paid_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    return db.transaction(() => {
      const result = insertFinance.run(userId, month, year, type, description, totalCents, amountMode, carryKey, dayOfMonth, scheduleKind, nowIsoValue);
      const createdFinanceId = Number(result.lastInsertRowid);
      if (amountMode === 'variable') {
        for (const item of items) {
          const itemIsPaid = normalizeFinancePaidFlag(item?.is_paid);
          insertItem.run(createdFinanceId, userId, item.item_date, item.item_source, item.amount_cents, itemIsPaid, itemIsPaid ? nowIsoValue : null, nowIsoValue, nowIsoValue);
        }
      }
      return createdFinanceId;
    })();
  }

  function updateVariableFinanceItems({ userId, id, description, items, totalCents, nowIsoValue, currentItems }) {
    const currentItemsById = new Map(currentItems.map((item) => [Number(item.id || 0), item]));
    const updateFinance = db.prepare(`
      UPDATE monthly_finances
      SET description = ?, formula = '', amount_cents = ?, amount_mode = 'variable'
      WHERE id = ? AND user_id = ?
    `);
    const updateItem = db.prepare(`
      UPDATE monthly_finance_items
      SET item_date = ?, item_source = ?, amount_cents = ?, is_paid = ?, paid_at = ?, updated_at = ?
      WHERE id = ? AND finance_id = ? AND user_id = ?
    `);
    const insertItem = db.prepare(`
      INSERT INTO monthly_finance_items (finance_id, user_id, item_date, item_source, amount_cents, is_paid, paid_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const deleteItem = db.prepare(`
      DELETE FROM monthly_finance_items
      WHERE finance_id = ? AND user_id = ? AND id = ?
    `);

    return db.transaction(() => {
      updateFinance.run(description, totalCents, id, userId);
      const retainedIds = new Set();
      for (const item of items) {
        const itemId = normalizePositiveInteger(item?.id);
        const nextPaid = normalizeFinancePaidFlag(item?.is_paid);
        if (itemId && currentItemsById.has(itemId)) {
          const currentItem = currentItemsById.get(itemId);
          const currentPaid = normalizeFinancePaidFlag(currentItem?.is_paid);
          const paidAt = nextPaid ? (currentPaid ? (currentItem?.paid_at || nowIsoValue) : nowIsoValue) : null;
          updateItem.run(item.item_date, item.item_source, item.amount_cents, nextPaid, paidAt, nowIsoValue, itemId, id, userId);
          retainedIds.add(itemId);
        } else {
          insertItem.run(id, userId, item.item_date, item.item_source, item.amount_cents, nextPaid, nextPaid ? nowIsoValue : null, nowIsoValue, nowIsoValue);
        }
      }
      for (const currentItem of currentItems) {
        const currentId = Number(currentItem.id || 0);
        if (!currentId || retainedIds.has(currentId)) continue;
        deleteItem.run(id, userId, currentId);
      }
    })();
  }

  function updateFixedFinanceRow({ userId, id, description, dayOfMonth, scheduleKind, nextCarryKey }) {
    return db.prepare(`
      UPDATE monthly_finances
      SET description = ?, day_of_month = ?, schedule_kind = ?, carry_key = CASE
        WHEN ? IS NOT NULL AND TRIM(?) <> '' AND (carry_key IS NULL OR TRIM(carry_key) = '') THEN ?
        ELSE carry_key
      END
      WHERE id = ? AND user_id = ?
    `).run(description, dayOfMonth, scheduleKind, nextCarryKey || null, nextCarryKey || '', nextCarryKey || null, id, userId);
  }

  function updateFinancePaymentToggle(userId, id, nextPaid, paidAt) {
    return db.prepare(`
      UPDATE monthly_finances
      SET is_paid = ?, paid_at = ?
      WHERE id = ? AND user_id = ?
    `).run(nextPaid, paidAt, id, userId);
  }

  function getFinanceItemToggleState(userId, itemId) {
    return db.prepare(`
      SELECT fi.id, fi.finance_id, fi.user_id, fi.is_paid, fi.paid_at,
             mf.month, mf.year, mf.type, mf.amount_mode
      FROM monthly_finance_items fi
      JOIN monthly_finances mf ON mf.id = fi.finance_id AND mf.user_id = fi.user_id
      WHERE fi.id = ? AND fi.user_id = ?
      LIMIT 1
    `).get(itemId, userId);
  }

  function updateFinanceItemPaymentToggle(userId, itemId, nextPaid, paidAt) {
    return db.prepare(`
      UPDATE monthly_finance_items
      SET is_paid = ?, paid_at = ?, updated_at = ?
      WHERE id = ? AND user_id = ?
    `).run(nextPaid, paidAt, nowIso(), itemId, userId);
  }

  function updateFinanceDescription(userId, id, value) {
    return db.prepare('UPDATE monthly_finances SET description = ? WHERE id = ? AND user_id = ?').run(value, id, userId);
  }

  function updateFinanceFormulaAndValue(userId, id, formula, parsedAmountCents) {
    return db.prepare('UPDATE monthly_finances SET formula = ?, amount_cents = ? WHERE id = ? AND user_id = ?').run(formula, parsedAmountCents, id, userId);
  }

  function deleteFinanceRow(userId, financeIdRaw, row) {
    const carryKey = normalizeMonthlyFinanceCarryKey(row.carry_key);
    const deletedAt = nowIso();
    return db.transaction(() => {
      if (carryKey) {
        db.prepare(`
          INSERT OR IGNORE INTO monthly_finance_carry_exceptions (user_id, carry_key, month, year, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(userId, carryKey, Number(row.month), Number(row.year), deletedAt);
      }
      db.prepare('DELETE FROM monthly_finance_items WHERE finance_id = ? AND user_id = ?').run(financeIdRaw, userId);
      db.prepare('DELETE FROM monthly_finances WHERE id = ? AND user_id = ?').run(financeIdRaw, userId);
    })();
  }

  function saveFinanceNotes(userId, year, month, type, content) {
    const column = type === 'math' ? 'content_math' : 'content_text';
    const existing = db.prepare('SELECT 1 FROM scratchpad WHERE user_id = ? AND month = ? AND year = ?').get(userId, month, year);
    if (existing) {
      return db.prepare(`UPDATE scratchpad SET ${column} = ? WHERE user_id = ? AND month = ? AND year = ?`).run(content, userId, month, year);
    }
    const mathVal = type === 'math' ? content : '';
    const textVal = type === 'text' ? content : '';
    return db.prepare('INSERT INTO scratchpad (user_id, month, year, content_math, content_text) VALUES (?, ?, ?, ?, ?)').run(userId, month, year, mathVal, textVal);
  }

  function toggleMonthClose(userId, body = {}) {
    const { month, year, status } = body;
    if (status === 'close') {
      return db.prepare('INSERT OR IGNORE INTO closed_months (user_id, month, year) VALUES (?, ?, ?)').run(userId, month, year);
    }
    return db.prepare('DELETE FROM closed_months WHERE user_id = ? AND month = ? AND year = ?').run(userId, month, year);
  }

  return {
    db,
    serializeFinanceForApi,
    isMonthClosed,
    normalizeFinanceType,
    normalizeFinanceAmountMode,
    sanitizeFinanceDescription,
    sanitizeVariableFinanceItems,
    normalizeFinanceDayOfMonth,
    normalizeFinanceScheduleKind,
    sumFinanceItemCents,
    createMonthlyFinanceCarryKey,
    getFriendlyErrorMessage,
    getFriendlyErrorDetails,
    getFinanceByIdForUser,
    getFinanceItemsByFinanceId,
    normalizePositiveInteger,
    normalizeFinancePaidFlag,
    buildExpensePaymentProgress,
    normalizeMonthlyFinanceCarryKey,
    syncFutureLegacyFixedFinanceScheduleFromRow,
    getMonthLockMessage,
    nowIso,
    createFinanceRow,
    updateVariableFinanceItems,
    updateFixedFinanceRow,
    updateFinancePaymentToggle,
    getFinanceItemToggleState,
    updateFinanceItemPaymentToggle,
    updateFinanceDescription,
    updateFinanceFormulaAndValue,
    deleteFinanceRow,
    saveFinanceNotes,
    toggleMonthClose
  };
}

module.exports = {
  createFinancesRepository
};
