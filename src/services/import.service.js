const { createImportRepository } = require('../repositories/import.repository');

function createImportService(deps = {}) {
  const repository = deps.repository || createImportRepository(deps);

  function getImportPage(userId, context = {}) {
    return {
      cards: repository.getActiveCards(userId),
      error: null,
      formSeed: context.formSeed || null,
      importReport: context.importReport || null,
      importPreview: context.preview || null
    };
  }

  function getCardsForUser(userId) {
    return repository.getActiveCards(userId);
  }

  function createImportPreview(userId, body = {}, file, req) {
    repository.clearImportPreview(req);

    const cardId = Number(body.card_id);
    const month = Number(body.month);
    const year = Number(body.year);
    const formSeed = { cardId, month, year };

    if (!file) throw new Error('Envie um arquivo CSV.');
    if (!cardId) throw new Error('Selecione o cartao.');
    if (!month || month < 1 || month > 12) throw new Error('Mes invalido.');
    if (!year || year < 2000 || year > 2100) throw new Error('Ano invalido.');

    const card = repository.findActiveCardById(userId, cardId);
    if (!card) throw new Error('Cartao invalido ou desativado.');

    const txns = repository.parseCsvByCardName(card.name, file.buffer);
    const preview = repository.buildImportPreviewData({
      userId,
      cardId,
      cardName: card.name,
      month,
      year,
      originalFilename: file.originalname,
      txns
    });

    repository.setImportPreview(req, preview);
    repository.setImportFormSeed(req, formSeed);

    return {
      redirectTo: '/import',
      flash: {
        type: 'info',
        message: `Analisei ${repository.formatCountLabel(preview.summary.parsedCount, 'compra', 'compras')} de ${preview.periodLabel}. Agora e so revisar e confirmar.`
      }
    };
  }

  function confirmImportPreview(userId, preview, body = {}, req) {
    const previewId = String(body.preview_id || '').trim();

    if (!preview || !previewId || preview.id !== previewId) {
      repository.clearImportPreview(req);
      return {
        redirectTo: '/import',
        flash: {
          type: 'error',
          message: 'A revisao dessa fatura nao esta mais disponivel. Manda o CSV de novo e a gente refaz o pente-fino.'
        }
      };
    }

    try {
      const card = repository.findActiveCardById(userId, preview.cardId);
      if (!card) throw new Error('Esse cartao nao esta mais disponivel para receber a importacao.');

      const selection = repository.resolveImportPreviewSelection(preview, body);
      const importedItems = Array.isArray(selection?.importedItems) ? selection.importedItems : [];
      const overwriteActions = Array.isArray(selection?.overwriteActions) ? selection.overwriteActions : [];
      if (!importedItems.length && !overwriteActions.length) {
        return {
          redirectTo: '/import',
          flash: {
            type: 'info',
            message: 'Nenhuma compra ficou marcada para entrar ou sobrescrever. Ajuste a revisao e confirme de novo.'
          }
        };
      }

      const itemMap = new Map((preview.items || []).map((item) => [item.id, item]));
      const candidateMap = new Map((preview.appDuplicateCandidates || []).map((candidate) => [candidate.id, candidate]));
      const preparedOverwriteActions = overwriteActions.map((action) => {
        const candidate = candidateMap.get(action.candidateId);
        if (!candidate) {
          throw new Error('Uma das suspeitas revisadas nao existe mais. Refaz a analise do CSV para seguir.');
        }
        const item = itemMap.get(action.itemId);
        if (!item) {
          throw new Error('Nao consegui localizar uma das linhas do CSV que voce revisou. Refaz a analise para seguir.');
        }

        const eligibleMatches = (candidate.existingMatches || []).filter((match) => Number(match.overwriteEligible || 0) || match.overwriteEligible === true);
        if (!eligibleMatches.length) {
          throw new Error('Essa suspeita nao tem mais um lancamento manual elegivel para sobrescrita.');
        }

        let targetTransactionId = Number(action.targetTransactionId || 0);
        if (!targetTransactionId && eligibleMatches.length === 1) {
          targetTransactionId = Number(eligibleMatches[0].id || 0);
        }
        if (!targetTransactionId) {
          throw new Error('Escolha qual lancamento manual voce quer sobrescrever antes de confirmar.');
        }

        const previewTargetMatch = eligibleMatches.find((match) => Number(match.id || 0) === targetTransactionId);
        if (!previewTargetMatch) {
          throw new Error('O alvo escolhido para sobrescrita nao bate mais com a revisao. Refaz a analise para seguir.');
        }

        return {
          candidate,
          item,
          targetTransactionId,
          previewTargetMatch
        };
      });

      const targetIds = preparedOverwriteActions.map((action) => Number(action.targetTransactionId || 0)).filter(Boolean);
      if (new Set(targetIds).size !== targetIds.length) {
        throw new Error('O mesmo lancamento manual foi escolhido mais de uma vez. Cada sobrescrita precisa de um alvo proprio.');
      }

      const persistResult = repository.persistImportConfirmation(userId, preview, {
        importedItems,
        overwriteActions: preparedOverwriteActions
      });

      const overwrittenRows = persistResult.overwrittenIds.length
        ? repository.getTransactionScopeRowsByIds(userId, persistResult.overwrittenIds)
        : [];

      if (overwrittenRows.length) {
        repository.syncEqualAllocationsForEditedTransactions(userId, overwrittenRows);
        repository.queueSharedDebtDraftsForTransactions(userId, overwrittenRows);
      }

      const feedback = repository.buildImportConfirmationMessage(preview, importedItems.length, persistResult.overwrittenIds.length);
      repository.clearImportPreview(req);
      repository.setImportFormSeed(req, preview.formSeed || null);
      return {
        redirectTo: `/month/${preview.year}/${preview.month}`,
        flash: feedback
      };
    } catch (error) {
      return {
        redirectTo: '/import',
        flash: {
          type: 'error',
          message: error.message || 'Nao consegui confirmar essa importacao agora.'
        }
      };
    }
  }

  function cancelImportPreview(preview, body = {}, req) {
    const previewId = String(body.preview_id || '').trim();

    if (!preview || !previewId || preview.id !== previewId) {
      repository.clearImportPreview(req);
      return { redirectTo: '/import' };
    }

    repository.setImportFormSeed(req, preview.formSeed || null);
    repository.clearImportPreview(req);
    return {
      redirectTo: '/import',
      flash: {
        type: 'info',
        message: 'Fechei essa previa. O formulario continua preenchido para você ajustar o que quiser.'
      }
    };
  }

  return {
    getImportPage,
    getCardsForUser,
    createImportPreview,
    confirmImportPreview,
    cancelImportPreview
  };
}

module.exports = {
  createImportService
};
