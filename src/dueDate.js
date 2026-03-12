const Holidays = require("date-holidays");

function ymd(d) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function computeDueDate({ year, month, dueDay, holidayScope = "BR" }) {
  if (!dueDay) return null;

  const hd = new Holidays(holidayScope || "BR");
  let d = new Date(Date.UTC(year, month - 1, dueDay));

  while (true) {
    const dow = d.getUTCDay();
    const isWeekend = dow === 0 || dow === 6;
    const isHoliday = !!hd.isHoliday(new Date(d));
    if (!isWeekend && !isHoliday) break;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return ymd(d);
}

module.exports = { computeDueDate };
