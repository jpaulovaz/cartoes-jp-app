const { createMonthlyEmailSummaryService } = require('../services/monthlyEmailSummary.service');

function createMonthlyEmailSummaryController(deps = {}) {
  const service = deps.service || createMonthlyEmailSummaryService(deps);

  function errorPayload(error) {
    const status = Number(error?.statusCode || error?.status || 500);
    const message = error?.publicMessage || error?.message || 'Nao consegui processar esse pedido agora.';
    return {
      status: status >= 400 && status <= 599 ? status : 500,
      body: {
        ok: false,
        success: false,
        code: error?.code || 'MONTHLY_SUMMARY_ERROR',
        message,
        error: message
      }
    };
  }

  return {
    async send(req, res) {
      try {
        const result = await service.sendMonthlySummaryEmail({
          user: req.user,
          params: req.params,
          body: req.body,
          req
        });
        return res.json(result);
      } catch (error) {
        const payload = errorPayload(error);
        return res.status(payload.status).json(payload.body);
      }
    }
  };
}

module.exports = {
  createMonthlyEmailSummaryController
};
