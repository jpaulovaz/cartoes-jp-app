function createImportRepository(deps = {}) {
  const {
    db,
    getActiveCards,
    parseCsvByCardName,
    buildImportPreviewData,
    clearImportPreview,
    setImportPreview,
    setImportFormSeed,
    formatCountLabel,
    resolveImportPreviewSelection,
    nowIso,
    getImportOverwriteTargetRow,
    buildImportExistingMatchVersion,
    buildImportOverwriteAuditSnapshot,
    buildImportOverwriteDescription,
    buildImportInstallmentExecutionPlan,
    isMonthClosed,
    getMonthLockMessage,
    getTransactionScopeRowsByIds,
    syncEqualAllocationsForEditedTransactions,
    queueSharedDebtDraftsForTransactions,
    buildImportConfirmationMessage
  } = deps;

  function findActiveCardById(userId, cardId) {
    return db.prepare('SELECT id, name FROM cards WHERE id = ? AND user_id = ? AND COALESCE(active, 1) = 1').get(cardId, userId);
  }

  function persistImportConfirmation(userId, preview, payload = {}) {
    const persist = db.transaction((transactionPayload) => {
      const now = nowIso();
      let importId = null;
      let createdTransactionCount = 0;
      let importedCurrentCount = 0;
      let futureCreatedCount = 0;
      let blockedFutureExpansionCount = 0;

      const ensureImportRecord = () => {
        if (importId) return importId;
        const info = db.prepare(`
          INSERT INTO imports(user_id, card_id, month, year, created_at, original_filename)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(userId, preview.cardId, preview.month, preview.year, now, preview.originalFilename || 'fatura.csv');
        importId = Number(info.lastInsertRowid || 0) || null;
        return importId;
      };

      const insertTransaction = db.prepare(`
        INSERT INTO transactions(
          user_id, import_id, card_id, txn_date, description, amount_cents, card_number, raw_json,
          due_month, due_year, parent_txn_id, purchase_category_id, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const insertImportedTransaction = (row = {}) => {
        const ensuredImportId = ensureImportRecord();
        const info = insertTransaction.run(
          userId,
          ensuredImportId,
          preview.cardId,
          row.isoDate || null,
          row.description,
          row.amountCents,
          row.cardNumber || null,
          JSON.stringify(row.raw || {}),
          row.dueMonth || null,
          row.dueYear || null,
          row.parentTxnId || null,
          row.purchaseCategoryId || null,
          now
        );
        createdTransactionCount += 1;
        return Number(info.lastInsertRowid || 0) || null;
      };

      const candidateByItemId = new Map((preview.appDuplicateCandidates || []).map((candidate) => [String(candidate.itemId || ''), candidate]));

      (transactionPayload.importedItems || []).forEach((item) => {
        const duplicateCandidate = candidateByItemId.get(String(item.id || '')) || null;
        const installmentPlan = typeof buildImportInstallmentExecutionPlan === 'function'
          ? buildImportInstallmentExecutionPlan({
              userId,
              cardId: preview.cardId,
              previewMonth: preview.month,
              previewYear: preview.year,
              item,
              suppressFutureExpansion: !!duplicateCandidate
            })
          : null;

        if (!installmentPlan) {
          insertImportedTransaction({
            isoDate: item.isoDate || null,
            description: item.description,
            amountCents: item.amountCents,
            cardNumber: item.cardNumber || null,
            raw: item.raw || {}
          });
          importedCurrentCount += 1;
          return;
        }

        const currentTxnId = insertImportedTransaction({
          isoDate: item.isoDate || null,
          description: installmentPlan.currentDescription,
          amountCents: item.amountCents,
          cardNumber: item.cardNumber || null,
          raw: installmentPlan.currentRaw || item.raw || {},
          dueMonth: preview.month,
          dueYear: preview.year,
          parentTxnId: installmentPlan.currentInsertParentTxnId || null
        });
        importedCurrentCount += 1;

        if (installmentPlan.hasConflict) {
          blockedFutureExpansionCount += 1;
          return;
        }

        const rootParentTxnId = installmentPlan.currentInsertParentTxnId || currentTxnId || null;
        (installmentPlan.futureRowsToCreate || []).forEach((futureRow) => {
          insertImportedTransaction({
            ...futureRow,
            parentTxnId: rootParentTxnId
          });
          futureCreatedCount += 1;
        });
      });

      const updateTransaction = db.prepare(`
        UPDATE transactions
        SET txn_date = ?, description = ?, amount_cents = ?, card_number = ?, raw_json = ?, parent_txn_id = ?
        WHERE id = ? AND user_id = ?
      `);
      const insertOverwriteEvent = db.prepare(`
        INSERT INTO import_overwrite_events (
          user_id, transaction_id, import_id, card_id, month, year,
          original_filename, preview_item_id, before_snapshot_json, after_snapshot_json, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const overwrittenIds = [];
      (transactionPayload.overwriteActions || []).forEach((action) => {
        const currentTarget = getImportOverwriteTargetRow(userId, action.targetTransactionId);
        if (!currentTarget) {
          throw new Error('Um dos lancamentos escolhidos para sobrescrita nao existe mais. Refaz a revisao para seguir.');
        }
        if (Number(currentTarget.import_id || 0) > 0) {
          throw new Error('Um dos lancamentos escolhidos deixou de ser manual. Refaz a revisao antes de confirmar.');
        }

        const currentMonth = Number(currentTarget.month || 0);
        const currentYear = Number(currentTarget.year || 0);
        if (Number(currentTarget.card_id || 0) !== Number(preview.cardId || 0)
          || currentMonth !== Number(preview.month || 0)
          || currentYear !== Number(preview.year || 0)) {
          throw new Error('Uma das coincidencias mudou de contexto depois da revisao. Refaça a analise do CSV para continuar.');
        }
        if (isMonthClosed(userId, currentMonth, currentYear)) {
          throw new Error(getMonthLockMessage(currentMonth, currentYear));
        }

        const currentVersion = buildImportExistingMatchVersion({
          id: currentTarget.id,
          import_id: currentTarget.import_id,
          card_id: currentTarget.card_id,
          month: currentTarget.month,
          year: currentTarget.year,
          txn_date: currentTarget.txn_date,
          description: currentTarget.description,
          amount_cents: currentTarget.amount_cents,
          card_number: currentTarget.card_number,
          parent_txn_id: currentTarget.parent_txn_id,
          recurring_rule_id: currentTarget.recurring_rule_id
        });
        if (currentVersion !== action.previewTargetMatch.version) {
          throw new Error('Uma das coincidencias mudou depois da revisao. Refaz a analise do CSV para evitar sobrescrever o item errado.');
        }
        if (Number(currentTarget.amount_cents || 0) !== Number(action.item.amountCents || 0)) {
          throw new Error('O valor do alvo mudou depois da revisao. Refaz a analise do CSV antes de sobrescrever.');
        }

        const installmentPlan = typeof buildImportInstallmentExecutionPlan === 'function'
          ? buildImportInstallmentExecutionPlan({
              userId,
              cardId: preview.cardId,
              previewMonth: preview.month,
              previewYear: preview.year,
              item: action.item,
              overwriteTargetRow: currentTarget
            })
          : null;

        const previewItemSnapshot = {
          id: action.item.id,
          txn_date: action.item.isoDate || null,
          description: action.item.description,
          amount_cents: Number(action.item.amountCents || 0),
          card_number: action.item.cardNumber || null,
          raw: action.item.raw || {}
        };
        const beforeSnapshot = buildImportOverwriteAuditSnapshot(userId, currentTarget, {
          preview_item: previewItemSnapshot,
          preview_id: preview.id,
          original_filename: preview.originalFilename || 'fatura.csv'
        });

        const nextDescription = installmentPlan
          ? installmentPlan.currentDescription
          : buildImportOverwriteDescription(userId, currentTarget, action.item.description, action.item);
        const nextRaw = installmentPlan ? (installmentPlan.currentRaw || action.item.raw || {}) : (action.item.raw || {});
        const nextParentTxnId = installmentPlan && installmentPlan.overwriteCurrentParentTxnId
          ? installmentPlan.overwriteCurrentParentTxnId
          : (Number(currentTarget.parent_txn_id || 0) || null);

        updateTransaction.run(
          action.item.isoDate || null,
          nextDescription,
          action.item.amountCents,
          action.item.cardNumber || null,
          JSON.stringify(nextRaw),
          nextParentTxnId,
          action.targetTransactionId,
          userId
        );

        if (installmentPlan && installmentPlan.hasConflict) {
          blockedFutureExpansionCount += 1;
        }
        if (installmentPlan && !installmentPlan.hasConflict && Array.isArray(installmentPlan.futureRowsToCreate) && installmentPlan.futureRowsToCreate.length > 0) {
          ensureImportRecord();
        }

        const refreshedTarget = getImportOverwriteTargetRow(userId, action.targetTransactionId);
        const afterSnapshot = buildImportOverwriteAuditSnapshot(userId, refreshedTarget, {
          preview_item: previewItemSnapshot,
          preview_id: preview.id,
          original_filename: preview.originalFilename || 'fatura.csv',
          import_id: importId
        });

        insertOverwriteEvent.run(
          userId,
          action.targetTransactionId,
          importId,
          preview.cardId,
          preview.month,
          preview.year,
          preview.originalFilename || 'fatura.csv',
          action.item.id,
          JSON.stringify(beforeSnapshot),
          JSON.stringify(afterSnapshot),
          now
        );
        overwrittenIds.push(action.targetTransactionId);

        if (installmentPlan && !installmentPlan.hasConflict) {
          const rootParentTxnId = installmentPlan.overwriteCurrentParentTxnId
            || Number(refreshedTarget?.parent_txn_id || 0)
            || Number(refreshedTarget?.id || 0)
            || Number(currentTarget.parent_txn_id || 0)
            || Number(currentTarget.id || 0)
            || null;
          (installmentPlan.futureRowsToCreate || []).forEach((futureRow) => {
            insertImportedTransaction({
              ...futureRow,
              parentTxnId: rootParentTxnId
            });
            futureCreatedCount += 1;
          });
        }
      });

      return {
        importId,
        overwrittenIds: Array.from(new Set(overwrittenIds)),
        createdTransactionCount,
        importedCurrentCount,
        futureCreatedCount,
        blockedFutureExpansionCount
      };
    });

    return persist(payload);
  }

  return {
    db,
    getActiveCards,
    parseCsvByCardName,
    buildImportPreviewData,
    clearImportPreview,
    setImportPreview,
    setImportFormSeed,
    formatCountLabel,
    resolveImportPreviewSelection,
    nowIso,
    getImportOverwriteTargetRow,
    buildImportExistingMatchVersion,
    buildImportOverwriteAuditSnapshot,
    buildImportOverwriteDescription,
    buildImportInstallmentExecutionPlan,
    isMonthClosed,
    getMonthLockMessage,
    getTransactionScopeRowsByIds,
    syncEqualAllocationsForEditedTransactions,
    queueSharedDebtDraftsForTransactions,
    buildImportConfirmationMessage,
    findActiveCardById,
    persistImportConfirmation
  };
}

module.exports = {
  createImportRepository
};
