/**
 * Public holiday calendars for billing teams: the United States, the
 * Philippines, Pakistan and India. Only the holidays a calendar can compute
 * are built in: fixed dates, rules such as "last Monday of August", and the
 * dates that follow Easter. Holidays set each year by the moon or by
 * government proclamation (Eid al-Fitr and Eid al-Adha, Ashura, Diwali,
 * Holi, the Philippines' special non-working days) are added by an
 * administrator once announced, as are company holidays, and count the same.
 *
 * A person on a holiday in their calendar counts as off that day (their own
 * date): work queue rules skip them and the coverage alerts notice.
 */
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";

const { staffHolidays, auditLog } = schema;

export const CALENDARS: Record<string, string> = {
  US: "United States (federal)",
  PH: "Philippines (regular holidays)",
  PK: "Pakistan (fixed-date holidays)",
  IN: "India (national holidays)",
};
export const COMPANY = "COMPANY";

export type Holiday = { date: string; name: string };

const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);

/** The nth weekday (0 Sunday) of a month; n = -1 for the last. */
export function nthWeekday(year: number, month: number, weekday: number, n: number) {
  if (n > 0) {
    const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    return iso(year, month, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7);
  }
  const lastDay = new Date(Date.UTC(year, month, 0));
  const back = (lastDay.getUTCDay() - weekday + 7) % 7;
  return iso(year, month, lastDay.getUTCDate() - back);
}

/** Western Easter Sunday (the anonymous Gregorian algorithm). */
export function easter(year: number) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(year, month, day);
}

const shift = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** A US federal holiday on a Saturday is observed on the Friday before, on a Sunday the Monday after. */
function observedUs(date: string, name: string): Holiday {
  const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (wd === 6) return { date: shift(date, -1), name: `${name} (observed)` };
  if (wd === 0) return { date: shift(date, 1), name: `${name} (observed)` };
  return { date, name };
}

/** The built-in holidays of a calendar in a year. */
export function builtInHolidays(calendar: string, year: number): Holiday[] {
  switch (calendar) {
    case "US": return [
      observedUs(iso(year, 1, 1), "New Year's Day"),
      { date: nthWeekday(year, 1, 1, 3), name: "Martin Luther King Jr. Day" },
      { date: nthWeekday(year, 2, 1, 3), name: "Washington's Birthday" },
      { date: nthWeekday(year, 5, 1, -1), name: "Memorial Day" },
      observedUs(iso(year, 6, 19), "Juneteenth"),
      observedUs(iso(year, 7, 4), "Independence Day"),
      { date: nthWeekday(year, 9, 1, 1), name: "Labor Day" },
      { date: nthWeekday(year, 10, 1, 2), name: "Columbus Day" },
      observedUs(iso(year, 11, 11), "Veterans Day"),
      { date: nthWeekday(year, 11, 4, 4), name: "Thanksgiving Day" },
      observedUs(iso(year, 12, 25), "Christmas Day"),
    ];
    case "PH": {
      const e = easter(year);
      return [
        { date: iso(year, 1, 1), name: "New Year's Day" },
        { date: shift(e, -3), name: "Maundy Thursday" },
        { date: shift(e, -2), name: "Good Friday" },
        { date: iso(year, 4, 9), name: "Araw ng Kagitingan" },
        { date: iso(year, 5, 1), name: "Labor Day" },
        { date: iso(year, 6, 12), name: "Independence Day" },
        { date: nthWeekday(year, 8, 1, -1), name: "National Heroes Day" },
        { date: iso(year, 11, 30), name: "Bonifacio Day" },
        { date: iso(year, 12, 25), name: "Christmas Day" },
        { date: iso(year, 12, 30), name: "Rizal Day" },
      ];
    }
    case "PK": return [
      { date: iso(year, 2, 5), name: "Kashmir Solidarity Day" },
      { date: iso(year, 3, 23), name: "Pakistan Day" },
      { date: iso(year, 5, 1), name: "Labour Day" },
      { date: iso(year, 8, 14), name: "Independence Day" },
      { date: iso(year, 11, 9), name: "Iqbal Day" },
      { date: iso(year, 12, 25), name: "Quaid-e-Azam Day" },
    ];
    case "IN": return [
      { date: iso(year, 1, 26), name: "Republic Day" },
      { date: iso(year, 8, 15), name: "Independence Day" },
      { date: iso(year, 10, 2), name: "Gandhi Jayanti" },
    ];
    default: return [];
  }
}

/** Holidays for the calendars between two dates: built-in, plus the dates added for the calendar and company-wide. */
export async function holidaysBetween(db: Db, practiceIds: string[], calendars: string[], from: string, to: string) {
  const out = new Map<string, Holiday[]>();
  const years: number[] = [];
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) years.push(y);
  const added = practiceIds.length ? await db.select().from(staffHolidays)
    .where(and(inArray(staffHolidays.practiceId, practiceIds), gte(staffHolidays.onDate, from), lte(staffHolidays.onDate, to))) : [];
  for (const cal of new Set(calendars)) {
    const list = years.flatMap((y) => builtInHolidays(cal, y)).filter((h) => h.date >= from && h.date <= to);
    for (const a of added.filter((x) => x.calendar === cal || x.calendar === COMPANY)) list.push({ date: a.onDate, name: a.name });
    out.set(cal, list.sort((a, b) => a.date.localeCompare(b.date)));
  }
  // People with no calendar still get company holidays.
  out.set("", added.filter((x) => x.calendar === COMPANY).map((a) => ({ date: a.onDate, name: a.name })));
  return out;
}

export async function addHoliday(db: Db, practiceId: string, input: { calendar: string; onDate: string; name: string }, by?: string) {
  if (!CALENDARS[input.calendar] && input.calendar !== COMPANY) throw new Error("Choose the calendar");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.onDate)) throw new Error("Enter the date");
  const name = input.name.trim().slice(0, 80);
  if (!name) throw new Error("Name the holiday");
  const [row] = await db.insert(staffHolidays).values({ practiceId, calendar: input.calendar, onDate: input.onDate, name, createdBy: by ?? null })
    .onConflictDoUpdate({ target: [staffHolidays.practiceId, staffHolidays.calendar, staffHolidays.onDate], set: { name } }).returning();
  await db.insert(auditLog).values({ practiceId, userId: by ?? null, action: "staff_holiday_added", entity: "practice", entityId: practiceId, details: { calendar: input.calendar, onDate: input.onDate, name } });
  return row;
}

export async function removeHoliday(db: Db, practiceId: string, id: string, by?: string) {
  const [row] = await db.delete(staffHolidays).where(and(eq(staffHolidays.id, id), eq(staffHolidays.practiceId, practiceId))).returning();
  if (!row) throw new Error("Not found");
  await db.insert(auditLog).values({ practiceId, userId: by ?? null, action: "staff_holiday_removed", entity: "practice", entityId: practiceId, details: { calendar: row.calendar, onDate: row.onDate } });
}

export async function addedHolidays(db: Db, practiceId: string, from: string) {
  return db.select().from(staffHolidays).where(and(eq(staffHolidays.practiceId, practiceId), gte(staffHolidays.onDate, from))).orderBy(asc(staffHolidays.onDate)).limit(200);
}
