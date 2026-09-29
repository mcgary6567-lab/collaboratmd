/**
 * Business days for federal deadlines: weekdays that are not federal
 * holidays (5 U.S.C. 6103). A holiday on a Saturday is observed the Friday
 * before, on a Sunday the Monday after.
 */
const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d, 12));

/** The nth weekday (0 Sunday) of a month; n = -1 for the last. */
function nthWeekday(year: number, month: number, weekday: number, n: number) {
  if (n > 0) {
    const first = utc(year, month, 1);
    return utc(year, month, 1 + ((weekday - first.getUTCDay() + 7) % 7) + (n - 1) * 7);
  }
  const last = utc(year, month + 1, 0);
  return utc(year, month, last.getUTCDate() - ((last.getUTCDay() - weekday + 7) % 7));
}

function observed(d: Date) {
  const day = d.getUTCDay();
  return day === 6 ? utc(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - 1) : day === 0 ? utc(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) : d;
}

const cache = new Map<number, Set<string>>();

/** Federal holidays as observed in a year. */
export function federalHolidays(year: number): Set<string> {
  const hit = cache.get(year);
  if (hit) return hit;
  const days = [
    observed(utc(year, 0, 1)), // New Year's Day
    nthWeekday(year, 0, 1, 3), // Birthday of Martin Luther King, Jr.
    nthWeekday(year, 1, 1, 3), // Washington's Birthday
    nthWeekday(year, 4, 1, -1), // Memorial Day
    observed(utc(year, 5, 19)), // Juneteenth
    observed(utc(year, 6, 4)), // Independence Day
    nthWeekday(year, 8, 1, 1), // Labor Day
    nthWeekday(year, 9, 1, 2), // Columbus Day
    observed(utc(year, 10, 11)), // Veterans Day
    nthWeekday(year, 10, 4, 4), // Thanksgiving Day
    observed(utc(year, 11, 25)), // Christmas Day
  ].map(iso);
  // New Year's Day of the next year observed on this year's December 31.
  const nextNewYear = observed(utc(year + 1, 0, 1));
  if (nextNewYear.getUTCFullYear() === year) days.push(iso(nextNewYear));
  const set = new Set(days);
  cache.set(year, set);
  return set;
}

export function isBusinessDay(day: string) {
  const d = new Date(`${day}T12:00:00Z`);
  const w = d.getUTCDay();
  return w !== 0 && w !== 6 && !federalHolidays(d.getUTCFullYear()).has(day);
}

/** The date n business days after a day (the day itself not counted). */
export function addBusinessDays(day: string, n: number) {
  let d = new Date(`${day}T12:00:00Z`);
  let left = n;
  while (left > 0) {
    d = new Date(d.getTime() + 86_400_000);
    if (isBusinessDay(iso(d))) left--;
  }
  return iso(d);
}

/** Business days from one day to another (0 when the second is not later). */
export function businessDaysBetween(from: string, to: string) {
  let n = 0;
  let d = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  while (d < end) {
    d = new Date(d.getTime() + 86_400_000);
    if (isBusinessDay(iso(d))) n++;
  }
  return n;
}
