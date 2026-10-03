/**
 * Leave balances: an allowance of days a year per person and kind of time off
 * (vacation, sick, other), given all at once in January or a twelfth at the
 * start of each month, plus days carried over into the year.
 *
 * A day of leave is one of the person's working days: a weekday they have a
 * shift (Monday to Friday for someone with no set hours) that is not a
 * holiday in their calendar. A morning or an afternoon off is half a day;
 * set hours are their share of that day's shift (of 8 hours with no set
 * hours). A request over the balance is still sent; the
 * person is told, and the administrator sees it before deciding.
 */
import { and, eq, gte, inArray, lte, or } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { dayShift, localClock, partWindow, TIME_OFF_KINDS, type Shift } from "./shifts";
import { holidaysBetween, type Holiday } from "./holidays";
import { practiceTimeZone, validTimeZone } from "./practice-time";

const { staffLeave, staffTimeOff, staffShifts, users, auditLog } = schema;
export const LEAVE_KINDS = ["vacation", "sick", "other"] as const;
const DAY = 86_400_000;

/** Working days between two local dates (inclusive). */
export function leaveDays(startsOn: string, endsOn: string, workWeekdays: Set<number>, holidays: Holiday[]) {
  const off = new Set(holidays.map((h) => h.date));
  let n = 0;
  for (let t = Date.parse(`${startsOn}T00:00:00Z`); t <= Date.parse(`${endsOn}T00:00:00Z`); t += DAY) {
    const d = new Date(t);
    if (workWeekdays.has(d.getUTCDay()) && !off.has(d.toISOString().slice(0, 10))) n++;
  }
  return n;
}

type Request = { startsOn: string; endsOn: string; part?: string | null; fromTime?: string | null; toTime?: string | null };

/** Days a request takes, between `first` and `last` (inclusive), in the person's working days. */
export function requestDays(o: Request, shifts: Shift[], tz: string, holidays: Holiday[], first = o.startsOn, last = o.endsOn) {
  const weekdays = new Set(shifts.length ? shifts.map((x) => x.weekday) : [1, 2, 3, 4, 5]);
  const part = o.part || "full";
  if (part === "full") return leaveDays(o.startsOn > first ? o.startsOn : first, o.endsOn < last ? o.endsOn : last, weekdays, holidays);
  if (o.startsOn < first || o.startsOn > last) return 0;
  if (!weekdays.has(new Date(`${o.startsOn}T00:00:00Z`).getUTCDay()) || holidays.some((h) => h.date === o.startsOn)) return 0;
  if (part !== "hours") return 0.5;
  const w = partWindow({ startsOn: o.startsOn, part, fromTime: o.fromTime ?? null, toTime: o.toTime ?? null }, shifts, tz);
  const day = dayShift(shifts, o.startsOn, tz);
  const share = day
    ? Math.max(0, Math.min(w.endsAt.getTime(), day.endsAt.getTime()) - Math.max(w.startsAt.getTime(), day.startsAt.getTime())) / (day.endsAt.getTime() - day.startsAt.getTime())
    : (w.endsAt.getTime() - w.startsAt.getTime()) / (8 * 3_600_000);
  return Math.round(Math.min(1, share) * 100) / 100;
}

/** Days earned so far this year: all of them up front, or a twelfth at the start of each month. */
export function earned(daysPerYear: number, accrual: string, month: number) {
  return accrual === "monthly" ? Math.round((daysPerYear * month * 100) / 12) / 100 : daysPerYear;
}

export async function saveLeave(db: Db, practiceId: string, userId: string, kind: string, input: { daysPerYear: number | null; accrual: string; carryOver: number }, by: string, now = new Date()) {
  if (!(LEAVE_KINDS as readonly string[]).includes(kind)) throw new Error("Choose the kind of leave");
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u) throw new Error("Person not found");
  if (input.daysPerYear === null) {
    await db.delete(staffLeave).where(and(eq(staffLeave.userId, userId), eq(staffLeave.kind, kind)));
  } else {
    if (!(input.daysPerYear >= 0 && input.daysPerYear <= 366)) throw new Error("Days a year is 0 to 366");
    if (input.accrual !== "upfront" && input.accrual !== "monthly") throw new Error("Choose how the days are given");
    if (!(input.carryOver >= 0 && input.carryOver <= 366)) throw new Error("Days carried over is 0 to 366");
    const tz = u.timeZone && validTimeZone(u.timeZone) ? u.timeZone : await practiceTimeZone(db, u.practiceId);
    const year = Number(localClock(now, tz).date.slice(0, 4));
    const values = { practiceId: u.practiceId, daysPerYear: input.daysPerYear, accrual: input.accrual, carryOver: input.carryOver, year, updatedBy: by, updatedAt: now };
    await db.insert(staffLeave).values({ userId, kind, ...values }).onConflictDoUpdate({ target: [staffLeave.userId, staffLeave.kind], set: values });
  }
  await db.insert(auditLog).values({ practiceId, userId: by, action: "staff_leave_saved", entity: "user", entityId: userId, details: { kind, ...input } });
}

export type Balance = { kind: string; label: string; daysPerYear: number; accrual: string; earned: number; carryOver: number; used: number; pending: number; balance: number };

/** Each person's balances this year (their own year, in their time zone), for the kinds with an allowance. */
export async function leaveBalances(db: Db, userIds: string[], now = new Date()) {
  const out = new Map<string, Balance[]>();
  if (!userIds.length) return out;
  const [policies, people, shifts] = await Promise.all([
    db.select().from(staffLeave).where(inArray(staffLeave.userId, userIds)),
    db.select({ id: users.id, tz: users.timeZone, practiceId: users.practiceId, calendar: users.holidayCalendar }).from(users).where(inArray(users.id, userIds)),
    db.select({ userId: staffShifts.userId, weekday: staffShifts.weekday, startsAt: staffShifts.startsAt, endsAt: staffShifts.endsAt }).from(staffShifts).where(inArray(staffShifts.userId, userIds)),
  ]);
  const withPolicy = people.filter((p) => policies.some((x) => x.userId === p.id));
  if (!withPolicy.length) return out;
  const year = now.getUTCFullYear();
  const from = `${year - 1}-01-01`, to = `${year + 1}-12-31`;
  const [off, holidays] = await Promise.all([
    db.select().from(staffTimeOff).where(and(inArray(staffTimeOff.userId, withPolicy.map((p) => p.id)), lte(staffTimeOff.startsOn, to), gte(staffTimeOff.endsOn, from), or(eq(staffTimeOff.status, "approved"), eq(staffTimeOff.status, "requested")))),
    holidaysBetween(db, [...new Set(withPolicy.map((p) => p.practiceId))], withPolicy.map((p) => p.calendar ?? ""), from, to),
  ]);
  for (const p of withPolicy) {
    const tz = p.tz && validTimeZone(p.tz) ? p.tz : await practiceTimeZone(db, p.practiceId);
    const today = localClock(now, tz).date;
    const y = Number(today.slice(0, 4)), month = Number(today.slice(5, 7));
    const first = `${y}-01-01`, last = `${y}-12-31`;
    const mine = shifts.filter((s) => s.userId === p.id);
    const hols = holidays.get(p.calendar ?? "") ?? [];
    const days = (o: Request) => requestDays(o, mine, tz, hols, first, last);
    out.set(p.id, policies.filter((x) => x.userId === p.id).map((x) => {
      const taken = off.filter((o) => o.userId === p.id && o.kind === x.kind && o.startsOn <= last && o.endsOn >= first);
      const used = Math.round(taken.filter((o) => o.status === "approved").reduce((a, o) => a + days(o), 0) * 100) / 100;
      const pending = Math.round(taken.filter((o) => o.status === "requested").reduce((a, o) => a + days(o), 0) * 100) / 100;
      const e = earned(x.daysPerYear, x.accrual, month);
      const carry = x.year === y ? x.carryOver : 0;
      return { kind: x.kind, label: TIME_OFF_KINDS[x.kind] ?? x.kind, daysPerYear: x.daysPerYear, accrual: x.accrual, earned: e, carryOver: carry, used, pending, balance: Math.round((e + carry - used) * 100) / 100 };
    }).sort((a, b) => a.kind.localeCompare(b.kind)));
  }
  return out;
}

/** How many working days a request takes, and the balance it would leave (null: no allowance for that kind). */
export async function leaveCheck(db: Db, userId: string, request: Request & { kind: string }, now = new Date(), excludeId?: string) {
  const b = (await leaveBalances(db, [userId], now)).get(userId)?.find((x) => x.kind === request.kind);
  const [p] = await db.select({ practiceId: users.practiceId, calendar: users.holidayCalendar, tz: users.timeZone }).from(users).where(eq(users.id, userId)).limit(1);
  const mine = await db.select({ weekday: staffShifts.weekday, startsAt: staffShifts.startsAt, endsAt: staffShifts.endsAt }).from(staffShifts).where(eq(staffShifts.userId, userId));
  const hols = p ? (await holidaysBetween(db, [p.practiceId], [p.calendar ?? ""], request.startsOn, request.endsOn)).get(p.calendar ?? "") ?? [] : [];
  const tz = p?.tz && validTimeZone(p.tz) ? p.tz : p ? await practiceTimeZone(db, p.practiceId) : "UTC";
  const days = requestDays(request, mine, tz, hols);
  if (!b) return { days, balance: null, after: null };
  // A request already counted as pending is not counted twice.
  let pending = b.pending;
  if (excludeId) {
    const [row] = await db.select().from(staffTimeOff).where(eq(staffTimeOff.id, excludeId)).limit(1);
    if (row?.status === "requested") pending -= days;
  }
  return { days, balance: b.balance, after: Math.round((b.balance - pending - days) * 100) / 100 };
}
