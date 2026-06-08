const { createPeopleService } = require('../services/people.service');

function createPeopleController(deps = {}) {
  const service = deps.service || createPeopleService(deps);
  const { safeRenderView, setFlash, profilePhotoUpload } = deps;

  function applyFlash(req, flash) {
    if (flash) setFlash(req, flash.type, flash.message);
  }

  function redirectWithResult(req, res, result, fallback = '/people') {
    applyFlash(req, result.flash);
    return res.redirect(result.redirectTo || fallback);
  }

  return {
    uploadProfilePhoto(req, res) {
      profilePhotoUpload.single('profile_photo')(req, res, async (error) => {
        const result = await service.uploadProfilePhoto({
          userId: req.user.id,
          req,
          file: req.file,
          error,
          currentUser: req.user
        });
        return redirectWithResult(req, res, result, '/settings#profile-photo');
      });
    },

    async useDefaultProfilePhoto(req, res) {
      const result = await service.useDefaultProfilePhoto({
        userId: req.user.id,
        req,
        currentUser: req.user
      });
      return redirectWithResult(req, res, result, '/settings#profile-photo');
    },

    async removeProfilePhoto(req, res) {
      const result = await service.removeProfilePhoto({
        userId: req.user.id,
        req,
        currentUser: req.user
      });
      return redirectWithResult(req, res, result, '/settings#profile-photo');
    },

    renderPeoplePage(req, res) {
      return safeRenderView(res, 'people', {
        ...service.getPeoplePageViewModel(req),
        title: 'Minha Rede'
      });
    },

    renderSettingsPage(req, res) {
      return safeRenderView(res, 'settings', {
        ...service.getPeoplePageViewModel(req),
        title: 'AcerttaPay | Configurações'
      });
    },

    redirectComprasComigo(req, res) {
      const result = service.redirectComprasComigo({
        userId: req.user.id,
        personId: Number(req.params.id || 0)
      });
      return redirectWithResult(req, res, result);
    },

    renderComprasComigoPage(req, res) {
      const result = service.getComprasComigoPage({
        userId: req.user.id,
        personId: Number(req.params.id || 0),
        params: req.params,
        query: req.query
      });
      if (result.badRequest) return res.status(400).send(result.badRequest);
      if (result.redirectTo) return redirectWithResult(req, res, result);
      return safeRenderView(res, 'people-compras-comigo', result.viewModel);
    },

    createComprasComigoChargeDraft(req, res) {
      const result = service.createComprasComigoChargeDraft({
        userId: req.user.id,
        personId: Number(req.params.id || 0),
        params: req.params,
        body: req.body
      });
      return redirectWithResult(req, res, result, `/people/${req.params.id}/compras-comigo/${req.params.year}/${req.params.month}`);
    },

    saveNotificationPreferences(req, res) {
      const result = service.saveNotificationPreferences({ userId: req.user.id, body: req.body, req });
      return redirectWithResult(req, res, result, '/settings#alerts');
    },

    enableWhatsappAutomation(req, res) {
      const result = service.enableWhatsappAutomation({ userId: req.user.id, req });
      return redirectWithResult(req, res, result, '/settings#whatsapp-automation');
    },

    disableWhatsappAutomation(req, res) {
      const result = service.disableWhatsappAutomation({ userId: req.user.id, req });
      return redirectWithResult(req, res, result, '/settings#whatsapp-automation');
    },

    savePerson(req, res) {
      const result = service.savePerson({ userId: req.user.id, body: req.body, req, currentUser: req.user });
      return redirectWithResult(req, res, result);
    },

    sendFriendRequest(req, res) {
      const result = service.sendFriendRequest({ userId: req.user.id, personId: Number(req.params.id) });
      return redirectWithResult(req, res, result);
    },

    cancelFriendRequest(req, res) {
      const result = service.cancelFriendRequest({ userId: req.user.id, requestId: Number(req.params.id) });
      return redirectWithResult(req, res, result);
    },

    respondFriendRequest(req, res) {
      const result = service.respondFriendRequest({
        userId: req.user.id,
        requestId: Number(req.params.id),
        action: String(req.body.action || '').trim().toLowerCase()
      });
      return redirectWithResult(req, res, result);
    },

    unfriend(req, res) {
      const result = service.unfriend({ userId: req.user.id, personId: Number(req.params.id) });
      return redirectWithResult(req, res, result);
    },

    togglePerson(req, res) {
      const result = service.togglePerson({ userId: req.user.id, personId: Number(req.params.id) });
      return redirectWithResult(req, res, result);
    },

    deletePerson(req, res) {
      const result = service.deletePerson({ userId: req.user.id, personId: Number(req.params.id) });
      return redirectWithResult(req, res, result);
    },

    setOwner(req, res) {
      const result = service.setOwner();
      return redirectWithResult(req, res, result);
    }
  };
}

module.exports = {
  createPeopleController
};
