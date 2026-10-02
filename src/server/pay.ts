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
 */
import { eq, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { assignableUsers } from "./work";
import { localClock, workedSpans, zonedMoment } from "./shifts";
import { practiceTimeZone, validTimeZone } from "./practice-time";

const { staffPay, users, auditLog } = schema;

export const CURRENCIES: Record<string, string> = { USD: "US dollar", PHP: "Philippine peso", PKR: "Pakistani rupee", INR: "Indian rupee", EUR: "Euro", GBP: "British pound", CAD: "Canadian dollar" };

export type PayInput = { rateCents: number; currency: string; weeklyOtHours: number | null; dailyOtHours: number | null; multiplier: number };

export async function savePay(db: Db, practiceId: string, userId: string, input: PayInput, by?: string) {
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u) throw new Error("Person not found");
  if (!Number.isInteger(input.rateCents) || input.rateCents <= 0) throw new Error("Enter the hourly rate");
  if (!CURRENCIES[input.currency]) throw new Error("Choose the currency");
  for (const [v, label] of [[input.weeklyOtHours, "Weekly"], [input.dailyOtHours, "Daily"]] as const) {
    if (v !== null && !(v > 0 && v <= 168)) throw new Error(`${label} overtime starts after 1 to 168 hours`);
  }
  if (!(input.multiplier >= 1 && input.multiplier <= 3)) throw new Error("The overtime multiplier is 1 to 3");
  const values = { practiceId: u.practiceId, rateCents: input.rateCents, currency: input.currency, weeklyOtHours: input.weeklyOtHours, dailyOtHours: input.dailyOtHours, otMultiplier: input.multiplier, updatedBy: by ?? null, updatedAt: new Date() };
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

/** Hours, overtime and gross pay per person for local dates `from` to `to`. */
export async function payWorksheet(db: Db, practiceId: string, from: string, to: string, now = new Date()) {
  const team = await assignableUsers(db, practiceId);
  if (!team.length) return [];
  const ids = team.map((t) => t.id);
  const [pays, people] = await Promise.all([
    db.select().from(staffPay).where(inArray(staffPay.userId, ids)),
    db.select({ id: users.id, tz: users.timeZone }).from(users).where(inArray(users.id, ids)),
  ]);
  const practiceTz = await practiceTimeZone(db, practiceId);
  const rows = [];
  for (const t of team) {
    const tzRaw = people.find((p) => p.id === t.id)?.tz;
    const tz = tzRaw && validTimeZone(tzRaw) ? tzRaw : practiceTz;
    const start = zonedMoment(from, "00:00", tz), end = zonedMoment(addDays(to, 1), "00:00", tz);
    const spans = await workedSpans(db, practiceId, [t.id], start, end, now);
    const byDay = new Map<string, number>();
    for (const s of spans) {
      let cur = s.start;
      while (cur < s.end) {
        const date = localClock(cur, tz).date;
        const midnight = zonedMoment(addDays(date, 1), "00:00", tz);
        const segEnd = midnight < s.end ? midnight : s.end;
        byDay.set(date, (byDay.get(date) ?? 0) + (segEnd.getTime() - cur.getTime()) / 3_600_000);
        cur = segEnd;
      }
    }
    const pay = pays.find((p) => p.userId === t.id) ?? null;
    const split = splitOvertime(byDay, pay?.weeklyOtHours ?? null, pay?.dailyOtHours ?? null);
    const gross = pay ? Math.round(split.regular * pay.rateCents + split.overtime * pay.rateCents * pay.otMultiplier) : null;
    if (split.total > 0 || pay) rows.push({ userId: t.id, name: t.name, tz, ...split, pay, grossCents: gross, currency: pay?.currency ?? null });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export async function payFor(db: Db, userIds: string[]) {
  return userIds.length ? db.select().from(staffPay).where(inArray(staffPay.userId, userIds)) : [];
}
