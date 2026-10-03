/**
 * The pay worksheet: hours worked (less unpaid breaks) per person in a
 * period, split into regular and overtime by each person's rules, and gross
 * pay at their hourly rate in their own currency. It is a worksheet for
 * payroll, not payroll: no taxes, deductions or payments.
 *
 * Overtime follows the person's settings: hours over a weekly threshold
 * (a Monday-to-Sunday week in their own time zone), hours over a daily
 * threshold, or both; with both, each week counts whichever gives more
 * overtime, so no hour is counted twice. Labor law differs by country and
 * state; the thresholds and multiplier are the practice's to set.
 *
 * Premiums on top: a night differential (a percentage of the hourly rate for
 * hours in a local window, 22:00 to 06:00 by default, as the Philippines
 * requires) and a holiday multiplier for hours worked on a holiday in the
 * person's calendar (2 for double pay). On a holiday the night differential
 * is figured on the holiday rate. Overtime hours get the overtime multiplier
 * on the base rate; premiums are not compounded with overtime.
 */
import { eq, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { localClock, minutesOf, peopleForPeriod, workedSpans, zonedMoment } from "./shifts";
import { holidaysBetween } from "./holidays";
import { approvedWeeks, weekStartOf } from "./timesheets";
import { practiceTimeZone, validTimeZone } from "./practice-time";

const { staffPay, users, auditLog } = schema;

export const CURRENCIES: Record<string, string> = { USD: "US dollar", PHP: "Philippine peso", PKR: "Pakistani rupee", INR: "Indian rupee", EUR: "Euro", GBP: "British pound", CAD: "Canadian dollar" };

export type PayInput = {
  rateCents: number; currency: string; weeklyOtHours: number | null; dailyOtHours: number | null; multiplier: number;
  nightPct?: number | null; nightStart?: string; nightEnd?: string; holidayMultiplier?: number | null;
};
const HM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export async function savePay(db: Db, practiceId: string, userId: string, input: PayInput, by?: string) {
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u) throw new Error("Person not found");
  if (!Number.isInteger(input.rateCents) || input.rateCents <= 0) throw new Error("Enter the hourly rate");
  if (!CURRENCIES[input.currency]) throw new Error("Choose the currency");
  for (const [v, label] of [[input.weeklyOtHours, "Weekly"], [input.dailyOtHours, "Daily"]] as const) {
    if (v !== null && !(v > 0 && v <= 168)) throw new Error(`${label} overtime starts after 1 to 168 hours`);
  }
  if (!(input.multiplier >= 1 && input.multiplier <= 3)) throw new Error("The overtime multiplier is 1 to 3");
  const nightPct = input.nightPct ?? null, holidayMultiplier = input.holidayMultiplier ?? null;
  const nightStart = input.nightStart || "22:00", nightEnd = input.nightEnd || "06:00";
  if (nightPct !== null && !(nightPct > 0 && nightPct <= 100)) throw new Error("The night differential is 1 to 100 percent");
  if (!HM.test(nightStart) || !HM.test(nightEnd) || nightStart === nightEnd) throw new Error("Enter the night hours as HH:MM, for example 22:00 to 06:00");
  if (holidayMultiplier !== null && !(holidayMultiplier >= 1 && holidayMultiplier <= 4)) throw new Error("The holiday multiplier is 1 to 4");
  const values = { practiceId: u.practiceId, rateCents: input.rateCents, currency: input.currency, weeklyOtHours: input.weeklyOtHours, dailyOtHours: input.dailyOtHours, otMultiplier: input.multiplier, nightPct, nightStart, nightEnd, holidayMultiplier, updatedBy: by ?? null, updatedAt: new Date() };
  await db.insert(staffPay).values({ userId: u.id, ...values }).onConflictDoUpdate({ target: staffPay.userId, set: values });
  await db.insert(auditLog).values({ practiceId, userId: by ?? null, action: "staff_pay_saved", entity: "user", entityId: u.id, details: { currency: input.currency } });
}

/** The Monday of the week a local date falls in. */
const weekOf = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Regular and overtime hours from hours per local day, under weekly and daily thresholds. */
export function splitOvertime(byDay: Map<string, number>, weekly: number | null, daily: number | null) {
  const weeks = new Map<string, number[]>();
  for (const [date, h] of byDay) weeks.set(weekOf(date), [...(weeks.get(weekOf(date)) ?? []), h]);
  let total = 0, overtime = 0;
  for (const hours of weeks.values()) {
    const sum = hours.reduce((a, h) => a + h, 0);
    const weeklyOt = weekly !== null ? Math.max(0, sum - weekly) : 0;
    const dailyOt = daily !== null ? hours.reduce((a, h) => a + Math.max(0, h - daily), 0) : 0;
    total += sum;
    overtime += Math.max(weeklyOt, dailyOt);
  }
  return { total, overtime, regular: total - overtime };
}

/** Minutes of a local stretch of one day (from minute `a` to `b`) that fall in the night window. */
export function nightMinutes(a: number, b: number, nightStart: string, nightEnd: string) {
  const ns = minutesOf(nightStart), ne = minutesOf(nightEnd);
  const windows = ns < ne ? [[ns, ne]] : [[0, ne], [ns, 1440]];
  return windows.reduce((sum, [x, y]) => sum + Math.max(0, Math.min(b, y) - Math.max(a, x)), 0);
}

/** Gross pay in minor units from the hours and the person's pay settings. */
export function grossPay(h: { regular: number; overtime: number; holidayHours: number; nightHours: number; nightHolidayHours: number }, pay: { rateCents: number; otMultiplier: number; nightPct: number | null; holidayMultiplier: number | null }) {
  const hm = pay.holidayMultiplier ?? 1, np = (pay.nightPct ?? 0) / 100;
  const base = h.regular * pay.rateCents + h.overtime * pay.rateCents * pay.otMultiplier;
  const holiday = h.holidayHours * pay.rateCents * (hm - 1);
  const night = (h.nightHours - h.nightHolidayHours) * pay.rateCents * np + h.nightHolidayHours * pay.rateCents * hm * np;
  return Math.round(base + holiday + night);
}

/** Hours, overtime, premiums and gross pay per person for local dates `from` to `to`. */
export async function payWorksheet(db: Db, practiceId: string, from: string, to: string, now = new Date()) {
  // Everyone with time here in the period, including people since deactivated (a day either side for time zones).
  const team = await peopleForPeriod(db, practiceId, new Date(Date.parse(`${from}T00:00:00Z`) - 86_400_000), new Date(Date.parse(`${to}T00:00:00Z`) + 2 * 86_400_000));
  if (!team.length) return [];
  const ids = team.map((t) => t.id);
  const [pays, people] = await Promise.all([
    db.select().from(staffPay).where(inArray(staffPay.userId, ids)),
    db.select({ id: users.id, tz: users.timeZone }).from(users).where(inArray(users.id, ids)),
  ]);
  const practiceTz = await practiceTimeZone(db, practiceId);
  const calendars = await db.select({ id: users.id, calendar: users.holidayCalendar, practiceId: users.practiceId }).from(users).where(inArray(users.id, ids));
  const holidays = await holidaysBetween(db, [...new Set(calendars.map((c) => c.practiceId))], calendars.map((c) => c.calendar ?? ""), addDays(from, -1), addDays(to, 1));
  const rows = [];
  for (const t of team) {
    const tzRaw = people.find((p) => p.id === t.id)?.tz;
    const tz = tzRaw && validTimeZone(tzRaw) ? tzRaw : practiceTz;
    const start = zonedMoment(from, "00:00", tz), end = zonedMoment(addDays(to, 1), "00:00", tz);
    const spans = await workedSpans(db, practiceId, [t.id], start, end, now);
    const pay = pays.find((p) => p.userId === t.id) ?? null;
    const hols = new Set((holidays.get(calendars.find((c) => c.id === t.id)?.calendar ?? "") ?? []).map((h) => h.date));
    const byDay = new Map<string, number>();
    let holidayHours = 0, nightHours = 0, nightHolidayHours = 0;
    for (const s of spans) {
      let cur = s.start;
      while (cur < s.end) {
        const local = localClock(cur, tz);
        const midnight = zonedMoment(addDays(local.date, 1), "00:00", tz);
        const segEnd = midnight < s.end ? midnight : s.end;
        const hours = (segEnd.getTime() - cur.getTime()) / 3_600_000;
        byDay.set(local.date, (byDay.get(local.date) ?? 0) + hours);
        const night = nightMinutes(local.minutes, local.minutes + hours * 60, pay?.nightStart ?? "22:00", pay?.nightEnd ?? "06:00") / 60;
        nightHours += night;
        if (hols.has(local.date)) { holidayHours += hours; nightHolidayHours += night; }
        cur = segEnd;
      }
    }
    const split = splitOvertime(byDay, pay?.weeklyOtHours ?? null, pay?.dailyOtHours ?? null);
    const hours = { ...split, holidayHours, nightHours, nightHolidayHours };
    const gross = pay ? grossPay(hours, pay) : null;
    const weeks = [...new Set([...byDay.keys()].map(weekStartOf))];
    if (split.total > 0 || (pay && t.active)) rows.push({ userId: t.id, name: t.name, tz, ...hours, weeks, approvedWeeks: 0, pay, grossCents: gross, currency: pay?.currency ?? null });
  }
  const approved = await approvedWeeks(db, rows.map((r) => r.userId), [...new Set(rows.flatMap((r) => r.weeks))]);
  for (const r of rows) r.approvedWeeks = r.weeks.filter((w) => approved.some((a) => a.userId === r.userId && a.weekStart === w)).length;
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export async function payFor(db: Db, userIds: string[]) {
  return userIds.length ? db.select().from(staffPay).where(inArray(staffPay.userId, userIds)) : [];
}
