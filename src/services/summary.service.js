const { createSummaryRepository } = require('../repositories/summary.repository');

function createSummaryService(deps = {}) {
  const repository = deps.repository || createSummaryRepository(deps);

  function parseParams(params = {}) {
    const parsed = repository.parseMonthYear(params.month, params.year);
    if (!parsed) {
      return { badRequest: 'Esse mês/ano veio estranho por aqui.' };
    }
    return parsed;
  }

  function getAnalyticsPage(userId, params = {}) {
    const parsed = parseParams(params);
    if (parsed.badRequest) return parsed;
    return {
      viewModel: repository.buildMonthlyReviewViewModel(userId, parsed.month, parsed.year)
    };
  }

  function getSummaryPage(userId, params = {}) {
    const parsed = parseParams(params);
    if (parsed.badRequest) return parsed;
    return {
      viewModel: repository.buildMonthlyReviewViewModel(userId, parsed.month, parsed.year)
    };
  }

  function confirmMerchantSuggestion(userId, params = {}, body = {}) {
    const parsed = parseParams(params);
    if (parsed.badRequest) return parsed;
    const { month, year } = parsed;
    const normalizedPattern = repository.buildMerchantPatternFromDescription(body.pattern || body.sample_description || '');
    const merchantLabel = repository.humanizeMerchantLabel(body.label || body.preview_label || '');
    const searchTerm = repository.normalizeMerchantText(body.search_term || normalizedPattern).split(' ').slice(0, 3).join(' ');
    const sourceSample = String(body.sample_description || '').trim();

    if (!normalizedPattern || !merchantLabel) {
      return {
        redirectTo: `/analytics/${year}/${month}`,
        flash: { type: 'error', message: 'A sugestão veio meio sem molho. Tenta de novo que a gente organiza.' }
      };
    }

    try {
      repository.upsertMerchantLearningFeedback(userId, {
        normalizedPattern,
        merchantLabel,
        searchTerm,
        sourceSample,
        status: 'confirmed'
      });
      return {
        redirectTo: `/analytics/${year}/${month}`,
        flash: { type: 'success', message: `Fechou! Agora "${merchantLabel}" entra no radar desse jeitinho.` }
      };
    } catch (error) {
      return {
        redirectTo: `/analytics/${year}/${month}`,
        flash: { type: 'error', message: repository.getFriendlyErrorDetails(error, { defaultMessage: 'Não consegui salvar essa confirmação agora.' }).message }
      };
    }
  }

  function dismissMerchantSuggestion(userId, params = {}, body = {}) {
    const parsed = parseParams(params);
    if (parsed.badRequest) return parsed;
    const { month, year } = parsed;
    const normalizedPattern = repository.buildMerchantPatternFromDescription(body.pattern || body.sample_description || '');
    const merchantLabel = repository.humanizeMerchantLabel(body.label || body.preview_label || 'Agrupamento adiado');
    const searchTerm = repository.normalizeMerchantText(body.search_term || normalizedPattern).split(' ').slice(0, 3).join(' ');
    const sourceSample = String(body.sample_description || '').trim();

    if (!normalizedPattern) {
      return {
        redirectTo: `/analytics/${year}/${month}`,
        flash: { type: 'error', message: 'Essa sugestão escapou sem pista suficiente para ser adiada.' }
      };
    }

    try {
      repository.upsertMerchantLearningFeedback(userId, {
        normalizedPattern,
        merchantLabel,
        searchTerm,
        sourceSample,
        status: 'dismissed'
      });
      return {
        redirectTo: `/analytics/${year}/${month}`,
        flash: { type: 'success', message: 'Sugestão guardada na geladeira. A gente não insiste nela por enquanto.' }
      };
    } catch (error) {
      return {
        redirectTo: `/analytics/${year}/${month}`,
        flash: { type: 'error', message: repository.getFriendlyErrorDetails(error, { defaultMessage: 'Não consegui guardar essa decisão agora.' }).message }
      };
    }
  }

  function pauseMerchantLearning(userId, params = {}, body = {}) {
    const parsed = parseParams(params);
    if (parsed.badRequest) return parsed;
    const { month, year } = parsed;
    const normalizedPattern = repository.normalizeMerchantText(body.pattern || '');
    const merchantLabel = repository.humanizeMerchantLabel(body.label || 'Agrupamento pausado');
    const searchTerm = repository.normalizeMerchantText(body.search_term || normalizedPattern).split(' ').slice(0, 3).join(' ');
    const sourceSample = String(body.source_sample || '').trim();

    if (!normalizedPattern) {
      return {
        redirectTo: `/analytics/${year}/${month}`,
        flash: { type: 'error', message: 'Faltou a pista principal desse agrupamento para pausar com segurança.' }
      };
    }

    try {
      repository.upsertMerchantLearningFeedback(userId, {
        normalizedPattern,
        merchantLabel,
        searchTerm,
        sourceSample,
        status: 'dismissed'
      });
      return {
        redirectTo: `/analytics/${year}/${month}`,
        flash: { type: 'success', message: `Beleza! Dei uma pausa no agrupamento de "${merchantLabel}".` }
      };
    } catch (error) {
      return {
        redirectTo: `/analytics/${year}/${month}`,
        flash: { type: 'error', message: repository.getFriendlyErrorDetails(error, { defaultMessage: 'Não consegui pausar esse agrupamento agora.' }).message }
      };
    }
  }

  function resumeMerchantLearning(userId, params = {}, body = {}) {
    const parsed = parseParams(params);
    if (parsed.badRequest) return parsed;
    const { month, year } = parsed;
    const normalizedPattern = repository.normalizeMerchantText(body.pattern || '');
    const merchantLabel = repository.humanizeMerchantLabel(body.label || body.preview_label || 'Agrupamento retomado');
    const searchTerm = repository.normalizeMerchantText(body.search_term || normalizedPattern).split(' ').slice(0, 3).join(' ');
    const sourceSample = String(body.source_sample || '').trim();

    if (!normalizedPattern) {
      return {
        redirectTo: `/analytics/${year}/${month}`,
        flash: { type: 'error', message: 'Esse agrupamento veio sem rastro suficiente para voltar ao jogo.' }
      };
    }

    try {
      repository.upsertMerchantLearningFeedback(userId, {
        normalizedPattern,
        merchantLabel,
        searchTerm,
        sourceSample,
        status: 'confirmed'
      });
      return {
        redirectTo: `/analytics/${year}/${month}`,
        flash: { type: 'success', message: `Pronto! "${merchantLabel}" voltou para a memória ativa.` }
      };
    } catch (error) {
      return {
        redirectTo: `/analytics/${year}/${month}`,
        flash: { type: 'error', message: repository.getFriendlyErrorDetails(error, { defaultMessage: 'Não consegui reativar esse agrupamento agora.' }).message }
      };
    }
  }

  function saveCardStatements(userId, params = {}, body = {}) {
    const parsed = parseParams(params);
    if (parsed.badRequest) return parsed;
    const { month, year } = parsed;
    if (repository.isMonthClosed(userId, month, year)) {
      return {
        redirectTo: `/summary/${year}/${month}`,
        flash: { type: 'error', message: repository.getMonthLockMessage(month, year) }
      };
    }

    const cardIds = Array.isArray(body.card_id) ? body.card_id : [body.card_id];
    const paid = Array.isArray(body.paid) ? body.paid : [body.paid];
    const overrideDue = Array.isArray(body.override_due) ? body.override_due : [body.override_due];
    const entries = cardIds.map((card_id, index) => ({ card_id, paid: paid[index], override_due: overrideDue[index] }));

    repository.upsertCardStatementsForMonth(userId, month, year, entries);
    return { redirectTo: `/summary/${year}/${month}` };
  }

  function saveCardStatementsAsync(userId, params = {}, body = {}) {
    const parsed = parseParams(params);
    if (parsed.badRequest) return parsed;
    const { month, year } = parsed;
    if (repository.isMonthClosed(userId, month, year)) {
      return {
        status: 423,
        body: { ok: false, error: repository.getMonthLockMessage(month, year) }
      };
    }

    repository.upsertCardStatementsForMonth(userId, month, year, [{
      card_id: body.card_id,
      paid: body.paid,
      override_due: body.override_due
    }]);

    return { body: { ok: true } };
  }

  function savePersonPayments(userId, params = {}, body = {}) {
    const parsed = parseParams(params);
    if (parsed.badRequest) return parsed;
    const { month, year } = parsed;
    if (repository.isMonthClosed(userId, month, year)) {
      return {
        redirectTo: `/summary/${year}/${month}`,
        flash: { type: 'error', message: repository.getMonthLockMessage(month, year) }
      };
    }

    const personIds = Array.isArray(body.person_id) ? body.person_id : [body.person_id];
    const paid = Array.isArray(body.paid) ? body.paid : [body.paid];
    const entries = personIds.map((person_id, index) => ({ person_id, paid: paid[index] }));

    repository.upsertPersonPaymentsForMonth(userId, month, year, entries);
    return { redirectTo: `/summary/${year}/${month}` };
  }

  function savePersonPaymentsAsync(userId, params = {}, body = {}) {
    const parsed = parseParams(params);
    if (parsed.badRequest) return parsed;
    const { month, year } = parsed;
    if (repository.isMonthClosed(userId, month, year)) {
      return {
        status: 423,
        body: { ok: false, error: repository.getMonthLockMessage(month, year) }
      };
    }

    repository.upsertPersonPaymentsForMonth(userId, month, year, [{ person_id: body.person_id, paid: body.paid }]);
    return { body: { ok: true } };
  }

  return {
    getAnalyticsPage,
    getSummaryPage,
    confirmMerchantSuggestion,
    dismissMerchantSuggestion,
    pauseMerchantLearning,
    resumeMerchantLearning,
    saveCardStatements,
    saveCardStatementsAsync,
    savePersonPayments,
    savePersonPaymentsAsync
  };
}

module.exports = {
  createSummaryService
};
