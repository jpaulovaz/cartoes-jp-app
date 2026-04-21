const { createCardsRepository } = require('../repositories/cards.repository');

function createCardsService(deps = {}) {
  const repository = deps.repository || createCardsRepository(deps);

  function getCardsPage(userId) {
    return { cards: repository.getCards(userId) };
  }

  function saveCard(userId, body = {}) {
    const editId = Number(body.edit_id || 0) || null;
    const name = String(body.name || '').trim();
    const dueDay = repository.normalizeDayNumber(body.due_day);
    const closeDay = repository.normalizeDayNumber(body.close_day);
    const brand = repository.normalizeCardBrand(body.brand) || null;

    if (!name) {
      return {
        redirectTo: '/cards',
        flash: { type: 'error', message: 'Me conta o nome do cartão antes de salvar.' }
      };
    }

    if (editId) {
      const existingCard = repository.findCardById(userId, editId);
      if (!existingCard) {
        return {
          redirectTo: '/cards',
          flash: { type: 'error', message: 'Não achei esse cartão por aqui.' }
        };
      }

      if (repository.findCardByNameForUser(userId, name, editId)) {
        return {
          redirectTo: '/cards',
          flash: { type: 'error', message: 'Esse nome já está na carteira. Se quiser diferenciar, dá para usar um apelido.' }
        };
      }

      repository.updateCard(userId, editId, { name, dueDay, closeDay, brand });
      return {
        redirectTo: '/cards',
        flash: { type: 'success', message: `${name} ficou atualizado direitinho.` }
      };
    }

    if (repository.findCardByNameForUser(userId, name)) {
      return {
        redirectTo: '/cards',
        flash: { type: 'error', message: 'Esse cartão já está na carteira. Se quiser diferenciar, dá para usar um apelido.' }
      };
    }

    repository.createCard(userId, { name, dueDay, closeDay, brand });
    return {
      redirectTo: '/cards',
      flash: { type: 'success', message: `${name} entrou na carteira direitinho.` }
    };
  }

  function updateCard(userId, cardIdRaw, body = {}) {
    const cardId = Number(cardIdRaw);
    const currentCard = repository.findCardById(userId, cardId);

    if (!currentCard) {
      return {
        redirectTo: '/cards',
        flash: { type: 'error', message: 'Não achei esse cartão por aqui.' }
      };
    }

    const name = String(body.name || currentCard.name || '').trim() || currentCard.name;
    if (repository.findCardByNameForUser(userId, name, cardId)) {
      return {
        redirectTo: '/cards',
        flash: { type: 'error', message: 'Esse nome já está na carteira. Se quiser diferenciar, dá para usar um apelido.' }
      };
    }

    repository.updateCard(userId, cardId, {
      name,
      dueDay: repository.normalizeDayNumber(body.due_day),
      closeDay: repository.normalizeDayNumber(body.close_day),
      brand: repository.normalizeCardBrand(body.brand) || null
    });

    return {
      redirectTo: '/cards',
      flash: { type: 'success', message: `${name} ficou atualizado direitinho.` }
    };
  }

  function toggleCard(userId, cardIdRaw) {
    const cardId = Number(cardIdRaw);
    const card = repository.findCardToggleState(userId, cardId);

    if (!card) {
      return {
        redirectTo: '/cards',
        flash: { type: 'error', message: 'Cartão não encontrado.' }
      };
    }

    repository.toggleCard(userId, cardId);
    const becameActive = card.active !== 1;
    return {
      redirectTo: '/cards',
      flash: {
        type: 'success',
        message: becameActive
          ? `${card.name} foi reativado e voltou a aparecer nos novos lançamentos.`
          : `${card.name} foi desativado e ficará oculto em novos lançamentos/importações, sem afetar o histórico.`
      }
    };
  }

  function deleteCard(userId, cardIdRaw) {
    const cardId = Number(cardIdRaw);
    const card = repository.findCardById(userId, cardId);

    if (!card) {
      return {
        redirectTo: '/cards',
        flash: { type: 'error', message: 'Cartão não encontrado.' }
      };
    }

    const usage = repository.getCardUsage(userId, cardId);
    if (usage.has_transactions || usage.has_statements) {
      return {
        redirectTo: '/cards',
        flash: {
          type: 'info',
          message: `Não foi possível excluir ${card.name} porque já existe histórico vinculado. Use Desativar para ocultar o cartão sem perder dados passados.`
        }
      };
    }

    repository.deleteCard(userId, cardId);
    return {
      redirectTo: '/cards',
      flash: { type: 'success', message: `${card.name} foi excluído com sucesso.` }
    };
  }

  return {
    getCardsPage,
    saveCard,
    updateCard,
    toggleCard,
    deleteCard
  };
}

module.exports = {
  createCardsService
};
