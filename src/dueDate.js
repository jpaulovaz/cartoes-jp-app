const Holidays = require("date-holidays");

const BUSINESS_HOLIDAY_TYPES = new Set(["public", "bank"]);

function ymd(d) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function getHolidayDatesForYear(hd, year, cache) {
  if (cache.has(year)) return cache.get(year);

  const dates = new Set(
    (hd.getHolidays(year) || [])
      .filter((holiday) => BUSINESS_HOLIDAY_TYPES.has(String(holiday?.type || "").toLowerCase()))
      .map((holiday) => String(holiday?.date || "").slice(0, 10))
      .filter(Boolean)
  );

  cache.set(year, dates);
  return dates;
}

function computeDueDate({ year, month, dueDay, holidayScope = "BR" }) {
  if (!dueDay) return null;

  const hd = new Holidays(holidayScope || "BR");
  const holidayCache = new Map();
  let d = new Date(Date.UTC(year, month - 1, dueDay));

  while (true) {
    const dow = d.getUTCDay();
    const isWeekend = dow === 0 || dow === 6;
    const dateKey = ymd(d);
    const holidayDates = getHolidayDatesForYear(hd, d.getUTCFullYear(), holidayCache);
    const isHoliday = holidayDates.has(dateKey);

    if (!isWeekend && !isHoliday) break;
    d.setUTCDate(d.getUTCDate() + 1);
  }

  return ymd(d);
}

module.exports = { computeDueDate };
