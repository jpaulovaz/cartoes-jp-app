const { createAutomationApiService } = require('../services/automationApi.service');

function createAutomationApiController(deps = {}) {
  const service = deps.service || createAutomationApiService(deps);

  async function sendResult(res, result) {
    try {
      const resolved = await Promise.resolve(result);
      const statusCode = Number(resolved?.statusCode || 200) || 200;
      const payload = { ...(resolved || {}) };
      delete payload.statusCode;
      return res.status(statusCode).json(payload);
    } catch (error) {
      const response = service.handleServiceError
        ? service.handleServiceError(error)
        : { ok: false, statusCode: 500, code: 'INTERNAL_ERROR', message: 'Algo tropeçou por aqui. Tenta de novo que eu seguro as pontas deste lado.' };
      try {
        if (service.recordUnhandledControllerError) {
          service.recordUnhandledControllerError(res.req || {}, error, response, metaFromRequest(res.req || {}));
        }
      } catch (logError) {
        // Observabilidade nunca deve impedir uma resposta JSON ao N8N.
      }
      const statusCode = Number(response?.statusCode || 500) || 500;
      const payload = { ...(response || {}) };
      delete payload.statusCode;
      return res.status(statusCode).json(payload);
    }
  }

  function metaFromRequest(req) {
    return {
      idempotencyKey: req.get('Idempotency-Key') || req.get('X-Idempotency-Key') || '',
      ipAddress: String(req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '')
    };
  }

  function observeRequest(req, res, next) {
    const originalJson = res.json.bind(res);
    res.json = (payload) => {
      try {
        service.recordAutomationHttpEvent(req, payload || {}, res.statusCode || 200);
      } catch (error) {
        // Observabilidade não pode derrubar a resposta da automação.
      }
      return originalJson(payload);
    };
    return next();
  }

  function authenticate(req, res, next) {
    const auth = service.verifyAutomationRequest(req);
    if (!auth.ok) {
      return res.status(auth.statusCode || 401).json({
        ok: false,
        code: auth.code || 'UNAUTHORIZED',
        message: auth.message || 'Requisição não autorizada.'
      });
    }
    return next();
  }

  function enforceUserPreferences(req, res, next) {
    const auth = service.verifyWorkflowUserPreference(req);
    if (!auth.ok) {
      return res.status(auth.statusCode || 403).json({
        ok: false,
        code: auth.code || 'AUTOMATION_USER_WORKFLOW_DISABLED',
        message: auth.message || 'Essa função está desligada para este usuário.'
      });
    }
    return next();
  }

  return {
    observeRequest,
    authenticate,
    enforceUserPreferences,

    health(req, res) {
      return res.json({ ok: true, service: 'automation-api', version: 'v1' });
    },

    resolveWhatsapp(req, res) {
      return sendResult(res, service.resolveWhatsapp(req.body || {}, metaFromRequest(req)));
    },

    routerContext(req, res) {
      return sendResult(res, service.buildRouterContext(req.body || {}, metaFromRequest(req)));
    },

    routerCapabilities(req, res) {
      return sendResult(res, service.buildRouterCapabilities(req.body || {}, metaFromRequest(req)));
    },

    routerIntentLog(req, res) {
      return sendResult(res, service.recordRouterIntent(req.body || {}, metaFromRequest(req)));
    },

    createPurchase(req, res) {
      return sendResult(res, service.createPurchaseFromAutomation(req.body || {}, metaFromRequest(req)));
    },

    listRecentPurchases(req, res) {
      return sendResult(res, service.listRecentPurchases(req.body || {}, metaFromRequest(req)));
    },

    preparePurchaseEdit(req, res) {
      return sendResult(res, service.preparePurchaseEdit({
        ...(req.body || {}),
        purchaseId: req.params.id,
        purchase_id: req.params.id
      }, metaFromRequest(req)));
    },

    confirmPurchaseEdit(req, res) {
      return sendResult(res, service.confirmPurchaseEdit({
        ...(req.body || {}),
        purchaseId: req.params.id,
        purchase_id: req.params.id
      }, metaFromRequest(req)));
    },

    preparePurchaseDelete(req, res) {
      return sendResult(res, service.preparePurchaseDelete({
        ...(req.body || {}),
        purchaseId: req.params.id,
        purchase_id: req.params.id
      }, metaFromRequest(req)));
    },

    confirmPurchaseDelete(req, res) {
      return sendResult(res, service.confirmPurchaseDelete({
        ...(req.body || {}),
        purchaseId: req.params.id,
        purchase_id: req.params.id
      }, metaFromRequest(req)));
    },

    reopenPurchaseParticipants(req, res) {
      return sendResult(res, service.reopenParticipantsForPurchase({
        ...(req.body || {}),
        purchaseId: req.params.id,
        purchase_id: req.params.id
      }, metaFromRequest(req)));
    },

    getSplitOptions(req, res) {
      return sendResult(res, service.getSplitOptionsForPurchase({
        ...(req.body || {}),
        ...(req.query || {}),
        purchaseId: req.params.id,
        purchase_id: req.params.id
      }, metaFromRequest(req)));
    },

    splitPurchase(req, res) {
      return sendResult(res, service.splitPurchaseFromAutomation({
        ...(req.body || {}),
        purchaseId: req.params.id,
        purchase_id: req.params.id
      }, metaFromRequest(req)));
    },

    conversationReply(req, res) {
      return sendResult(res, service.handleConversationReply(req.body || {}, metaFromRequest(req)));
    }
  };
}

module.exports = {
  createAutomationApiController
};
