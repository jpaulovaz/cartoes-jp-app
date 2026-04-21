const { createSocialShareService } = require('../services/socialShare.service');

function createSocialShareController(deps = {}) {
  const service = deps.service || createSocialShareService(deps);
  const { safeRenderView, formatBRLFromCents, setFlash } = deps;

  function applyFlash(req, flash) {
    if (flash) setFlash(req, flash.type, flash.message);
  }

  return {
    async renderSharePage(req, res) {
      const result = await service.getSharePage({
        userId: req.user.id,
        params: req.params,
        query: req.query
      });
      if (result.badRequest) return res.status(400).send(result.badRequest);
      return safeRenderView(res, 'share', { ...result.viewModel, formatBRLFromCents });
    },

    async renderWhatsappPage(req, res) {
      const result = await service.getWhatsappPage({
        userId: req.user.id,
        params: req.params,
        query: req.query
      });
      if (result.badRequest) return res.status(400).send(result.badRequest);
      if (result.redirectTo) {
        applyFlash(req, result.flash);
        return res.redirect(result.redirectTo);
      }
      return safeRenderView(res, 'whatsapp', { ...result.viewModel, formatBRLFromCents });
    },

    async sendWhatsappAutomation(req, res) {
      const result = await service.sendWhatsappAutomation({
        userId: req.user.id,
        body: req.body
      });
      return res.status(result.status || 200).json(result.body);
    }
  };
}

module.exports = {
  createSocialShareController
};
