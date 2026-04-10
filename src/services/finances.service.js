const { createFinancesRepository } = require('../repositories/finances.repository');

function createFinancesService(deps = {}) {
  const repository = deps.repository || createFinancesRepository(deps);

  function financeDetails(userId, financeIdRaw) {
    const finance = repository.serializeFinanceForApi(userId, financeIdRaw);
    if (!finance) {
      return { status: 404, body: { error: 'Não achei esse item por aqui.' } };
    }

    return {
      status: 200,
      body: {
        success: true,
        finance,
        isClosed: repository.isMonthClosed(userId, Number(finance.month), Number(finance.year))
      }
    };
  }

  function addRow(userId, body = {}) {
    try {
      const month = Number(body.month);
      const year = Number(body.year);
      const type = repository.normalizeFinanceType(body.type);
      const amountMode = repository.normalizeFinanceAmountMode(body.amount_mode);
      const description = repository.sanitizeFinanceDescription(body.description);
      const items = amountMode === 'variable' ? repository.sanitizeVariableFinanceItems(body.items) : [];
      const dayOfMonth = amountMode === 'fixed' ? repository.normalizeFinanceDayOfMonth(body.day_of_month) : null;
      const scheduleKind = dayOfMonth ? repository.normalizeFinanceScheduleKind(body.schedule_kind, type) : null;

      if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2000) {
        return { status: 400, body: { error: 'Esse mês ou ano veio estranho por aqui.' } };
      }

      if (!type) {
        return { status: 400, body: { error: 'Esse tipo de lançamento não fez sentido por aqui.' } };
      }

      if (repository.isMonthClosed(userId, month, year)) {
        return { status: 423, body: { error: repository.getMonthLockMessage(month, year) } };
      }

      const nowIsoValue = new Date().toISOString();
      const totalCents = amountMode === 'variable' ? repository.sumFinanceItemCents(items) : 0;
      const carryKey = repository.createMonthlyFinanceCarryKey();
      const financeId = repository.createFinanceRow({
        userId,
        month,
        year,
        type,
        description,
        totalCents,
        amountMode,
        carryKey,
        dayOfMonth,
        scheduleKind,
        nowIsoValue,
        items
      });

      return { status: 200, body: { success: true, finance: repository.serializeFinanceForApi(userId, financeId) } };
    } catch (e) {
      const status = /certinhos|nome para esse item/i.test(String(e.message || '')) ? 400 : 500;
      return { status, body: { error: repository.getFriendlyErrorMessage(e, { defaultMessage: 'Não consegui salvar esse item agora.' }) } };
    }
  }

  function updateVariableFinance(userId, financeIdRaw, body = {}) {
    try {
      const id = Number(financeIdRaw);
      const finance = repository.getFinanceByIdForUser(userId, id);
      if (!finance) {
        return { status: 404, body: { error: 'Não achei esse item por aqui.' } };
      }
      if (finance.amount_mode !== 'variable') {
        return { status: 400, body: { error: 'Esse item não usa vários lançamentos.' } };
      }
      if (repository.isMonthClosed(userId, Number(finance.month), Number(finance.year))) {
        return { status: 423, body: { error: repository.getMonthLockMessage(Number(finance.month), Number(finance.year)) } };
      }

      const description = repository.sanitizeFinanceDescription(body.description);
      const items = repository.sanitizeVariableFinanceItems(body.items);
      const totalCents = repository.sumFinanceItemCents(items);
      const nowIsoValue = new Date().toISOString();
      const currentItems = repository.getFinanceItemsByFinanceId(userId, id);
      repository.updateVariableFinanceItems({
        userId,
        id,
        description,
        items,
        totalCents,
        nowIsoValue,
        currentItems
      });

      return {
        status: 200,
        body: {
          success: true,
          finance: repository.serializeFinanceForApi(userId, id),
          expenseProgress: repository.buildExpensePaymentProgress(userId, Number(finance.month), Number(finance.year))
        }
      };
    } catch (e) {
      const status = /certinhos|nome para esse item/i.test(String(e.message || '')) ? 400 : 500;
      return { status, body: { error: repository.getFriendlyErrorMessage(e, { defaultMessage: 'Não consegui salvar esses lançamentos agora.' }) } };
    }
  }

  function updateFixedFinance(userId, financeIdRaw, body = {}) {
    try {
      const id = Number(financeIdRaw);
      const finance = repository.getFinanceByIdForUser(userId, id);
      if (!finance) {
        return { status: 404, body: { error: 'Não achei esse item por aqui.' } };
      }
      if (finance.amount_mode !== 'fixed') {
        return { status: 400, body: { error: 'Esse item usa vários lançamentos.' } };
      }
      if (repository.isMonthClosed(userId, Number(finance.month), Number(finance.year))) {
        return { status: 423, body: { error: repository.getMonthLockMessage(Number(finance.month), Number(finance.year)) } };
      }

      const description = repository.sanitizeFinanceDescription(body.description);
      const dayOfMonth = repository.normalizeFinanceDayOfMonth(body.day_of_month);
      const scheduleKind = dayOfMonth ? repository.normalizeFinanceScheduleKind(body.schedule_kind, finance.type) : null;
      const currentCarryKey = repository.normalizeMonthlyFinanceCarryKey(finance.carry_key);
      const nextCarryKey = dayOfMonth && !currentCarryKey ? repository.createMonthlyFinanceCarryKey() : currentCarryKey;

      repository.updateFixedFinanceRow({ userId, id, description, dayOfMonth, scheduleKind, nextCarryKey });

      if (dayOfMonth) {
        repository.syncFutureLegacyFixedFinanceScheduleFromRow(userId, finance, {
          nextDayOfMonth: dayOfMonth,
          nextScheduleKind: scheduleKind,
          nextCarryKey
        });
      }

      return {
        status: 200,
        body: {
          success: true,
          finance: repository.serializeFinanceForApi(userId, id),
          expenseProgress: finance.type === 'expense' ? repository.buildExpensePaymentProgress(userId, Number(finance.month), Number(finance.year)) : null
        }
      };
    } catch (e) {
      const status = /nome para esse item/i.test(String(e.message || '')) ? 400 : 500;
      return { status, body: { error: repository.getFriendlyErrorMessage(e, { defaultMessage: 'Não consegui salvar a data desse item agora.' }) } };
    }
  }

  function toggleFinancePayment(userId, financeIdRaw, body = {}) {
    try {
      const id = Number(financeIdRaw);
      const finance = repository.getFinanceByIdForUser(userId, id);
      if (!finance) {
        return { status: 404, body: { error: 'Não achei esse item por aqui.' } };
      }
      if (finance.type !== 'expense' || finance.amount_mode !== 'fixed') {
        return { status: 400, body: { error: 'Esse controle rápido vale só para saídas de valor único.' } };
      }
      if (repository.isMonthClosed(userId, Number(finance.month), Number(finance.year))) {
        return { status: 423, body: { error: repository.getMonthLockMessage(Number(finance.month), Number(finance.year)) } };
      }

      const nextPaid = repository.normalizeFinancePaidFlag(body?.is_paid ?? body?.isPaid);
      const paidAt = nextPaid ? (repository.normalizeFinancePaidFlag(finance?.is_paid) ? (finance?.paid_at || repository.nowIso()) : repository.nowIso()) : null;
      repository.updateFinancePaymentToggle(userId, id, nextPaid, paidAt);

      return {
        status: 200,
        body: {
          success: true,
          finance: repository.serializeFinanceForApi(userId, id),
          expenseProgress: repository.buildExpensePaymentProgress(userId, Number(finance.month), Number(finance.year))
        }
      };
    } catch (e) {
      const details = repository.getFriendlyErrorDetails(e, { defaultMessage: 'Não consegui marcar essa conta agora.' });
      return { status: details.status, body: { error: details.message } };
    }
  }

  function toggleFinanceItemPayment(userId, itemIdRaw, body = {}) {
    try {
      const itemId = Number(itemIdRaw);
      const item = repository.getFinanceItemToggleState(userId, itemId);
      if (!item) {
        return { status: 404, body: { error: 'Não achei esse lançamento por aqui.' } };
      }
      if (item.type !== 'expense' || repository.normalizeFinanceAmountMode(item.amount_mode) !== 'variable') {
        return { status: 400, body: { error: 'Esse atalho vale só para lançamentos variáveis das saídas.' } };
      }
      if (repository.isMonthClosed(userId, Number(item.month), Number(item.year))) {
        return { status: 423, body: { error: repository.getMonthLockMessage(Number(item.month), Number(item.year)) } };
      }

      const nextPaid = repository.normalizeFinancePaidFlag(body?.is_paid ?? body?.isPaid);
      const paidAt = nextPaid ? (repository.normalizeFinancePaidFlag(item?.is_paid) ? (item?.paid_at || repository.nowIso()) : repository.nowIso()) : null;
      repository.updateFinanceItemPaymentToggle(userId, itemId, nextPaid, paidAt);

      return {
        status: 200,
        body: {
          success: true,
          finance: repository.serializeFinanceForApi(userId, Number(item.finance_id)),
          expenseProgress: repository.buildExpensePaymentProgress(userId, Number(item.month), Number(item.year))
        }
      };
    } catch (e) {
      const details = repository.getFriendlyErrorDetails(e, { defaultMessage: 'Não consegui marcar esse lançamento agora.' });
      return { status: details.status, body: { error: details.message } };
    }
  }

  function updateFinance(userId, financeIdRaw, body = {}) {
    try {
      const id = Number(financeIdRaw);
      const { field, value, formula, amount_cents } = body;
      const row = repository.getFinanceByIdForUser(userId, id);
      if (!row) {
        return { status: 404, body: { error: 'Linha não encontrada.' } };
      }
      if (repository.isMonthClosed(userId, Number(row.month), Number(row.year))) {
        return { status: 423, body: { error: repository.getMonthLockMessage(Number(row.month), Number(row.year)) } };
      }

      if (field === 'description') {
        repository.updateFinanceDescription(userId, id, repository.sanitizeFinanceDescription(value));
      } else if (field === 'formula_and_value') {
        if (row.amount_mode !== 'fixed') {
          return { status: 400, body: { error: 'Esse item usa vários lançamentos. Abra a lista dele para editar os lançamentos.' } };
        }
        const parsedAmountCents = Number.isFinite(Number(amount_cents)) ? Math.max(0, Math.round(Number(amount_cents))) : 0;
        repository.updateFinanceFormulaAndValue(userId, id, String(formula || '').trim(), parsedAmountCents);
      } else {
        return { status: 400, body: { error: 'Campo de atualização inválido.' } };
      }

      return { status: 200, body: { success: true, finance: repository.serializeFinanceForApi(userId, id) } };
    } catch (e) {
      const status = /nome para esse item/i.test(String(e.message || '')) ? 400 : 500;
      return { status, body: { error: repository.getFriendlyErrorMessage(e, { defaultMessage: 'Não consegui atualizar esse item agora.' }) } };
    }
  }

  function deleteFinance(userId, financeIdRaw) {
    const row = repository.getFinanceByIdForUser(userId, financeIdRaw);
    if (!row) {
      return { status: 404, body: { error: 'Linha não encontrada.' } };
    }
    if (repository.isMonthClosed(userId, Number(row.month), Number(row.year))) {
      return { status: 423, body: { error: repository.getMonthLockMessage(Number(row.month), Number(row.year)) } };
    }

    repository.deleteFinanceRow(userId, financeIdRaw, row);
    return { status: 200, body: { success: true } };
  }

  function saveFinanceNotes(userId, yearRaw, monthRaw, body = {}) {
    try {
      const year = Number(yearRaw);
      const month = Number(monthRaw);
      const { type, content } = body;
      if (repository.isMonthClosed(userId, month, year)) {
        return { status: 423, body: { error: repository.getMonthLockMessage(month, year) } };
      }
      repository.saveFinanceNotes(userId, year, month, type, content);
      return { status: 200, body: { success: true } };
    } catch (e) {
      const details = repository.getFriendlyErrorDetails(e, { defaultMessage: 'Não consegui salvar esse rascunho agora.' });
      return { status: details.status, body: { error: details.message } };
    }
  }

  function toggleMonthClose(userId, body = {}) {
    try {
      repository.toggleMonthClose(userId, body);
      return { status: 200, body: { success: true } };
    } catch (e) {
      const details = repository.getFriendlyErrorDetails(e, { defaultMessage: 'Não consegui mexer no cadeado desse mês agora.' });
      return { status: details.status, body: { error: details.message } };
    }
  }

  return {
    financeDetails,
    addRow,
    updateVariableFinance,
    updateFixedFinance,
    toggleFinancePayment,
    toggleFinanceItemPayment,
    updateFinance,
    deleteFinance,
    saveFinanceNotes,
    toggleMonthClose
  };
}

module.exports = {
  createFinancesService
};
