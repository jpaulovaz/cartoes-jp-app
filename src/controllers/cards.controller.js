const { createCardsService } = require('../services/cards.service');

function createCardsController(deps = {}) {
  const service = deps.service || createCardsService(deps);
  const { safeRenderView, setFlash } = deps;

  return {
    renderCardsPage(req, res) {
      const result = service.getCardsPage(req.user.id);
      return safeRenderView(res, 'cards', { cards: result.cards });
    },

    saveCard(req, res) {
      const result = service.saveCard(req.user.id, req.body);
      if (result.flash) setFlash(req, result.flash.type, result.flash.message);
      return res.redirect(result.redirectTo || '/cards');
    },

    updateCard(req, res) {
      const result = service.updateCard(req.user.id, req.params.id, req.body);
      if (result.flash) setFlash(req, result.flash.type, result.flash.message);
      return res.redirect(result.redirectTo || '/cards');
    },

    toggleCard(req, res) {
      const result = service.toggleCard(req.user.id, req.params.id);
      if (result.flash) setFlash(req, result.flash.type, result.flash.message);
      return res.redirect(result.redirectTo || '/cards');
    },

    deleteCard(req, res) {
      const result = service.deleteCard(req.user.id, req.params.id);
      if (result.flash) setFlash(req, result.flash.type, result.flash.message);
      return res.redirect(result.redirectTo || '/cards');
    }
  };
}

module.exports = {
  createCardsController
};
