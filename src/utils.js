const dayjs = require("dayjs");

function formatBRLFromCents(cents) {
  const v = (cents || 0) / 100;
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function parseMonthYear(qMonth, qYear) {
  const month = Number(qMonth);
  const year = Number(qYear);
  if (!month || month < 1 || month > 12) return null;
  if (!year || year < 2000 || year > 2100) return null;
  return { month, year };
}

function toISOFromBRDate(brDate) {
  if (!brDate) return null;
  const m = String(brDate).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  const d = dayjs(iso);
  return d.isValid() ? d.format("YYYY-MM-DD") : null;
}

function centsFromPtBrMoney(str) {
  const s = (str || "").toString().trim();
  if (!s) return 0;

  const digitsOnly = s.replace(/\D/g, "");
  if (!digitsOnly) return 0;

  const cents = Number(digitsOnly);
  return Number.isFinite(cents) ? cents : 0;
}

module.exports = { formatBRLFromCents, parseMonthYear, toISOFromBRDate, centsFromPtBrMoney };
