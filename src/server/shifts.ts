/**
 * Biller shifts, for a team that works in more than one time zone (an
 * offshore billing team, an overnight shift).
 *
 *  - Each person has a time zone and weekly working hours in it. A shift that
 *    ends before it starts (22:00 to 06:00) runs past midnight. Someone with no
 *    hours set is treated as always available, so nothing changes until a
 *    schedule is entered. One-off changes (from an approved swap) add or
 *    cancel hours on top of the weekly ones (server/shift-swaps.ts).
 *  - Time off is requested and approved, as a range of dates in the person's
 *    own time zone; holidays in the person's calendar count the same
 *    (server/holidays.ts). Work queue rules skip people who are off. Approving
 *    time off moves their open queue tasks due in that time to the others on
 *    the same rule; cancelling it moves them back.
 *  - Due dates from work queues count the assignee's working days.
 *  - Clocking in and out, with unpaid breaks, records hours worked; a clock-in
 *    from outside the practice's office networks is flagged or refused.
 *  - A handover note at the end of a shift is shown to the next shift.
 *
 * Shifts belong to the person, not to one practice: a billing company's
 * billers work across its client practices, and the same hours apply in each.
 */
import { and, desc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { practiceClock, practiceTimeZone, validTimeZone } from "./practice-time";
import { assignableUsers } from "./work";
import { CALENDARS, holidaysBetween, type Holiday } from "./holidays";
import { notify } from "./notifications";
import { ipAllowed, parseCidr } from "@/lib/ip";

const { staffShifts, staffTimeOff, timeEntries, timeBreaks, shiftHandovers, shiftChanges, clockSettings, users, tasks, workRules, auditLog } = schema;

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const TIME_OFF_KINDS: Record<string, string> = { vacation: "Vacation", sick: "Sick", holiday: "Holiday", other: "Other" };
/** An entry left open longer than this was probably a missed clock-out; it counts this long at most. */
export const MAX_ENTRY_HOURS = 16;

export type Shift = { weekday: number; startsAt: string; endsAt: string };
export type TimeOff = { startsOn: string; endsOn: string };
export type Change = { kind: string; startsAt: Date; endsAt: Date };

const HM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY = 86_400_000;
export const minutesOf = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** The person's local date, weekday and minute of the day at a moment. */
export function localClock(at: Date, tz: string) {
  const c = practiceClock(at, tz);
  return { date: c.toISOString().slice(0, 10), weekday: c.getUTCDay(), minutes: c.getUTCHours() * 60 + c.getUTCMinutes(), time: c.toISOString().slice(11, 16) };
}

/** Whether a moment falls in one of the weekly shifts, in the person's time zone. */
export function isOnShift(shifts: Shift[], at: Date, tz: string) {
  const { weekday, minutes } = localClock(at, tz);
  return shifts.some((s) => {
    const start = minutesOf(s.startsAt), end = minutesOf(s.endsAt);
    if (start < end) return s.weekday === weekday && minutes >= start && minutes < end;
    // Past midnight: the evening part on its own day, the morning part on the next.
    return (s.weekday === weekday && minutes >= start) || ((s.weekday + 1) % 7 === weekday && minutes < end);
  });
}

const inWindow = (changes: Change[], kind: string, at: Date) => changes.some((c) => c.kind === kind && c.startsAt.getTime() <= at.getTime() && at.getTime() < c.endsAt.getTime());

/** Weekly hours, less cancelled windows, plus extra windows. */
export function isWorking(shifts: Shift[], changes: Change[], at: Date, tz: string) {
  return (isOnShift(shifts, at, tz) && !inWindow(changes, "cancel", at)) || inWindow(changes, "extra", at);
}

export const isOffOn = (timeOff: TimeOff[], localDate: string, holidays: Holiday[] = []) =>
  timeOff.some((t) => t.startsOn <= localDate && localDate <= t.endsOn) || holidays.some((h) => h.date === localDate);

/** The real moment a local date and time in a time zone happens (daylight saving included). */
export function zonedMoment(date: string, hm: string, tz: string) {
  const guess = Date.parse(`${date}T${hm}:00Z`);
  const offset = practiceClock(new Date(guess), tz).getTime() - guess;
  let at = guess - offset;
  const again = practiceClock(new Date(at), tz).getTime() - at;
  if (again !== offset) at = guess - again;
  return new Date(at);
}

/** The weekly shifts that start in the next `days` days, as real moments, skipping days off and cancelled hours. */
export function shiftOccurrences(shifts: Shift[], at: Date, tz: string, days = 14, timeOff: TimeOff[] = [], holidays: Holiday[] = [], changes: Change[] = []) {
  const today = localClock(at, tz).date;
  const out: { startsAt: Date; endsAt: Date }[] = [];
  for (let k = -1; k < days; k++) {
    const date = addDays(today, k);
    if (isOffOn(timeOff, date, holidays)) continue;
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    for (const s of shifts.filter((x) => x.weekday === weekday)) {
      const startsAt = zonedMoment(date, s.startsAt, tz);
      const endsAt = zonedMoment(minutesOf(s.endsAt) > minutesOf(s.startsAt) ? date : addDays(date, 1), s.endsAt, tz);
      if (endsAt.getTime() <= at.getTime()) continue;
      if (changes.some((c) => c.kind === "cancel" && c.startsAt.getTime() <= startsAt.getTime() && c.endsAt.getTime() >= endsAt.getTime())) continue;
      out.push({ startsAt, endsAt });
    }
  }
  return out.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

/** When the person's next shift starts, skipping days off; null with no schedule in the next 14 days. */
export function nextShiftStart(shifts: Shift[], timeOff: TimeOff[], at: Date, tz: string, holidays: Holiday[] = [], changes: Change[] = []) {
  const weekly = shiftOccurrences(shifts, at, tz, 14, timeOff, holidays, changes).map((o) => o.startsAt).filter((d) => d.getTime() > at.getTime());
  const extra = changes.filter((c) => c.kind === "extra" && c.startsAt.getTime() > at.getTime()).map((c) => c.startsAt);
  const all = [...weekly, ...extra].sort((a, b) => a.getTime() - b.getTime());
  return all[0] ?? null;
}

/**
 * A due date `slaDays` working days out: days the person has a shift and is
 * not off, counted from tomorrow in their time zone. Without weekly hours it
 * is calendar days, as before.
 */
export function workingDueDate(shifts: Shift[], timeOff: TimeOff[], holidays: Holiday[], at: Date, tz: string, slaDays: number) {
  if (!shifts.length) return new Date(at.getTime() + slaDays * DAY).toISOString().slice(0, 10);
  const workdays = new Set(shifts.map((s) => s.weekday));
  let date = localClock(at, tz).date;
  let left = slaDays;
  for (let guard = 0; left > 0 && guard < 120; guard++) {
    date = addDays(date, 1);
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (workdays.has(weekday) && !isOffOn(timeOff, date, holidays)) left--;
  }
  return date;
}

/* ------------------------------ Schedules and time off ------------------------------ */

async function ownUser(db: Db, userId: string) {
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u) throw new Error("Person not found");
  return u;
}

export async function setTimeZone(db: Db, practiceId: string, userId: string, tz: string, by?: string) {
  const u = await ownUser(db, userId);
  const value = tz.trim() || null;
  if (value && !validTimeZone(value)) throw new Error("Choose a time zone from the list");
  await db.update(users).set({ timeZone: value }).where(eq(users.id, u.id));
  await db.insert(auditLog).values({ practiceId, userId: by ?? null, action: "staff_time_zone_set", entity: "user", entityId: u.id, details: { timeZone: value } });
}

export async function setHolidayCalendar(db: Db, practiceId: string, userId: string, calendar: string, by?: string) {
  const u = await ownUser(db, userId);
  const value = calendar.trim() || null;
  if (value && !CALENDARS[value]) throw new Error("Choose a holiday calendar");
  await db.update(users).set({ holidayCalendar: value }).where(eq(users.id, u.id));
  await db.insert(auditLog).values({ practiceId, userId: by ?? null, action: "staff_holiday_calendar_set", entity: "user", entityId: u.id, details: { calendar: value } });
}

/** Replaces a person's weekly hours. */
export async function saveShifts(db: Db, practiceId: string, userId: string, shifts: Shift[], by?: string) {
  const u = await ownUser(db, userId);
  for (const s of shifts) {
    if (!Number.isInteger(s.weekday) || s.weekday < 0 || s.weekday > 6) throw new Error("Choose the day");
    if (!HM.test(s.startsAt) || !HM.test(s.endsAt)) throw new Error("Enter times as HH:MM, for example 21:30");
    if (s.startsAt === s.endsAt) throw new Error(`${WEEKDAYS[s.weekday]}: the shift starts and ends at the same time`);
  }
  if (shifts.filter((s, i) => shifts.findIndex((x) => x.weekday === s.weekday) !== i).length > 2) throw new Error("At most three shifts a day");
  await db.delete(staffShifts).where(eq(staffShifts.userId, u.id));
  if (shifts.length) await db.insert(staffShifts).values(shifts.map((s) => ({ practiceId: u.practiceId, userId: u.id, ...s })));
  await db.insert(auditLog).values({ practiceId, userId: by ?? null, action: "staff_shifts_saved", entity: "user", entityId: u.id, details: { shifts: shifts.length } });
}

function checkTimeOff(input: { startsOn: string; endsOn: string; kind: string }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startsOn) || !/^\d{4}-\d{2}-\d{2}$/.test(input.endsOn) || input.endsOn < input.startsOn) throw new Error("Enter the first and last day off");
  if (!TIME_OFF_KINDS[input.kind]) throw new Error("Choose the kind of time off");
}

/** An administrator records time off: approved at once, and the person's open queue tasks in that time move to teammates. */
export async function addTimeOff(db: Db, practiceId: string, input: { userId: string; startsOn: string; endsOn: string; kind: string; note?: string }, by?: string, now = new Date()) {
  const u = await ownUser(db, input.userId);
  checkTimeOff(input);
  const [row] = await db.insert(staffTimeOff).values({ practiceId: u.practiceId, userId: u.id, startsOn: input.startsOn, endsOn: input.endsOn, kind: input.kind, note: input.note?.trim().slice(0, 200) || null, createdBy: by ?? null, status: "approved", decidedBy: by ?? null, decidedAt: now }).returning();
  await db.insert(auditLog).values({ practiceId, userId: by ?? null, action: "staff_time_off_added", entity: "user", entityId: u.id, details: { startsOn: input.startsOn, endsOn: input.endsOn, kind: input.kind } });
  const moved = await reassignDuringTimeOff(db, u.id, row.id, input.startsOn, input.endsOn, now);
  return { timeOff: row, moved };
}

/** A person asks for time off; administrators are notified to approve or deny it. */
export async function requestTimeOff(db: Db, practiceId: string, userId: string, input: { startsOn: string; endsOn: string; kind: string; note?: string }) {
  const u = await ownUser(db, userId);
  checkTimeOff(input);
  const [row] = await db.insert(staffTimeOff).values({ practiceId: u.practiceId, userId: u.id, startsOn: input.startsOn, endsOn: input.endsOn, kind: input.kind, note: input.note?.trim().slice(0, 200) || null, createdBy: u.id, status: "requested" }).returning();
  await db.insert(auditLog).values({ practiceId, userId: u.id, action: "staff_time_off_requested", entity: "user", entityId: u.id, details: { startsOn: input.startsOn, endsOn: input.endsOn, kind: input.kind } });
  await notify(db, practiceId, { kind: "time_off", title: `${u.name} asked for time off, ${input.startsOn} to ${input.endsOn}`, body: input.note?.trim() || TIME_OFF_KINDS[input.kind], href: "/work/shifts/manage", dedupeKey: `time-off:${row.id}` });
  return row;
}

/** Approves or denies a request; approving moves the person's open queue tasks in that time to teammates. */
export async function decideTimeOff(db: Db, practiceId: string, id: string, approve: boolean, by: string, now = new Date()) {
  const [row] = await db.select().from(staffTimeOff).where(eq(staffTimeOff.id, id)).limit(1);
  if (!row) throw new Error("Not found");
  if (row.status !== "requested") throw new Error("This request was already decided");
  if (row.userId === by) throw new Error("Someone else approves your own time off");
  await db.update(staffTimeOff).set({ status: approve ? "approved" : "denied", decidedBy: by, decidedAt: now }).where(eq(staffTimeOff.id, id));
  await db.insert(auditLog).values({ practiceId, userId: by, action: approve ? "staff_time_off_approved" : "staff_time_off_denied", entity: "user", entityId: row.userId, details: { startsOn: row.startsOn, endsOn: row.endsOn } });
  await notify(db, practiceId, { userId: row.userId, kind: "time_off", title: `Your time off ${row.startsOn} to ${row.endsOn} was ${approve ? "approved" : "denied"}`, href: "/work/shifts", dedupeKey: `time-off-decided:${id}` });
  return approve ? reassignDuringTimeOff(db, row.userId, row.id, row.startsOn, row.endsOn, now) : 0;
}

/** Cancels time off (an administrator, or the person for their own pending request); moved tasks still open go back. */
export async function removeTimeOff(db: Db, practiceId: string, id: string, by: string, isAdmin: boolean) {
  const [row] = await db.select().from(staffTimeOff).where(eq(staffTimeOff.id, id)).limit(1);
  if (!row) throw new Error("Not found");
  if (!isAdmin && !(row.userId === by && row.status === "requested")) throw new Error("Ask an administrator to cancel approved time off");
  const back = await db.select().from(tasks).where(and(eq(tasks.movedFor, row.id), eq(tasks.status, "open")));
  for (const t of back) {
    await db.update(tasks).set({ assigneeId: t.movedFrom, movedFrom: null, movedFor: null, note: [t.note, "Moved back: the time off was cancelled"].filter(Boolean).join("\n") }).where(eq(tasks.id, t.id));
  }
  await db.update(tasks).set({ movedFor: null }).where(eq(tasks.movedFor, row.id));
  await db.delete(staffTimeOff).where(eq(staffTimeOff.id, id));
  await db.insert(auditLog).values({ practiceId, userId: by, action: "staff_time_off_removed", entity: "user", entityId: row.userId, details: { startsOn: row.startsOn, endsOn: row.endsOn, movedBack: back.length } });
  return { movedBack: back.length };
}

/** Time off that has not ended, for a set of people, with its status. */
export async function upcomingTimeOff(db: Db, userIds: string[], today: string) {
  if (!userIds.length) return [];
  return db.select({ o: staffTimeOff, name: users.name }).from(staffTimeOff).innerJoin(users, eq(users.id, staffTimeOff.userId))
    .where(and(inArray(staffTimeOff.userId, userIds), gte(staffTimeOff.endsOn, today), or(eq(staffTimeOff.status, "approved"), eq(staffTimeOff.status, "requested")))).orderBy(staffTimeOff.startsOn).limit(100);
}

export type Availability = {
  tz: string; hasSchedule: boolean; onShift: boolean; offToday: boolean; holidayToday: string | null; localTime: string; localDate: string; nextStart: Date | null;
  timeOff: TimeOff[]; holidays: Holiday[]; shifts: Shift[]; changes: Change[]; calendar: string | null;
};

/** Where each person stands at a moment: on shift, off today (time off or a holiday), and when they are next on. */
export async function availability(db: Db, userIds: string[], at = new Date(), fallbackTz?: string) {
  const out = new Map<string, Availability>();
  if (!userIds.length) return out;
  const from = new Date(at.getTime() - 2 * DAY).toISOString().slice(0, 10);
  const to = new Date(at.getTime() + 120 * DAY).toISOString().slice(0, 10);
  const [people, shifts, off, changes] = await Promise.all([
    db.select({ id: users.id, tz: users.timeZone, practiceId: users.practiceId, calendar: users.holidayCalendar }).from(users).where(inArray(users.id, userIds)),
    db.select().from(staffShifts).where(inArray(staffShifts.userId, userIds)),
    db.select().from(staffTimeOff).where(and(inArray(staffTimeOff.userId, userIds), eq(staffTimeOff.status, "approved"), gte(staffTimeOff.endsOn, from))),
    db.select().from(shiftChanges).where(and(inArray(shiftChanges.userId, userIds), gte(shiftChanges.endsAt, new Date(at.getTime() - DAY)))),
  ]);
  const holidays = await holidaysBetween(db, [...new Set(people.map((p) => p.practiceId))], people.map((p) => p.calendar ?? ""), from, to);
  for (const p of people) {
    const tz = p.tz && validTimeZone(p.tz) ? p.tz : fallbackTz ?? (await practiceTimeZone(db, p.practiceId));
    const mine = shifts.filter((s) => s.userId === p.id);
    const myOff = off.filter((o) => o.userId === p.id);
    const myChanges = changes.filter((c) => c.userId === p.id);
    const myHolidays = holidays.get(p.calendar ?? "") ?? [];
    const local = localClock(at, tz);
    const holidayToday = myHolidays.find((h) => h.date === local.date)?.name ?? null;
    const offToday = isOffOn(myOff, local.date, myHolidays);
    out.set(p.id, {
      tz, hasSchedule: mine.length > 0, offToday, holidayToday, localTime: local.time, localDate: local.date, timeOff: myOff, holidays: myHolidays, shifts: mine, changes: myChanges, calendar: p.calendar,
      onShift: !offToday && (mine.length === 0 || isWorking(mine, myChanges, at, tz)),
      nextStart: nextShiftStart(mine, myOff, at, tz, myHolidays, myChanges),
    });
  }
  return out;
}

/** Who can take new work: not off today (their own date). With nobody available, everyone stays in the rotation. */
export function pickAssignee(assigneeIds: string[], nextIndex: number, avail: Map<string, Pick<Availability, "offToday">>) {
  const n = assigneeIds.length;
  for (let k = 0; k < n; k++) {
    const id = assigneeIds[(nextIndex + k) % n];
    const a = avail.get(id);
    if (!a || !a.offToday) return { assigneeId: id, next: nextIndex + k + 1 };
  }
  return { assigneeId: assigneeIds[nextIndex % n], next: nextIndex + 1 };
}

/** A due date for a queue task: working days for someone with weekly hours, calendar days otherwise. */
export function dueDateFor(a: Availability | undefined, slaDays: number, at: Date) {
  if (!a) return new Date(at.getTime() + slaDays * DAY).toISOString().slice(0, 10);
  return workingDueDate(a.shifts, a.timeOff, a.holidays, at, a.tz, slaDays);
}

/** Moves a person's open queue tasks due in their time off to others on the same rule who are not off then. */
export async function reassignDuringTimeOff(db: Db, userId: string, timeOffId: string, startsOn: string, endsOn: string, now = new Date()) {
  const open = await db.select().from(tasks).where(and(eq(tasks.assigneeId, userId), eq(tasks.status, "open"), lte(tasks.dueDate, endsOn)));
  if (!open.length) return 0;
  const [me] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
  const ruleIds = [...new Set(open.map((t) => t.ruleId).filter(Boolean) as string[])];
  const rules = ruleIds.length ? await db.select().from(workRules).where(inArray(workRules.id, ruleIds)) : [];
  const others = [...new Set(rules.flatMap((r) => r.assigneeIds))].filter((id) => id !== userId);
  const avail = await availability(db, others, now);
  const offDuring = (id: string) => (avail.get(id)?.timeOff ?? []).some((t) => t.startsOn <= endsOn && t.endsOn >= startsOn);
  const turn = new Map<string, number>();
  let moved = 0;
  for (const t of open) {
    const rule = rules.find((r) => r.id === t.ruleId);
    const pool = (rule?.assigneeIds ?? []).filter((id) => id !== userId && !offDuring(id));
    if (!pool.length) continue;
    const i = turn.get(rule!.id) ?? 0;
    turn.set(rule!.id, i + 1);
    const to = pool[i % pool.length];
    await db.update(tasks).set({ assigneeId: to, movedFrom: userId, movedFor: timeOffId, note: [t.note, `Moved from ${me?.name ?? "a teammate"} (time off ${startsOn} to ${endsOn})`].filter(Boolean).join("\n") }).where(eq(tasks.id, t.id));
    moved++;
  }
  return moved;
}

/* ------------------------------ Clock, breaks and handover ------------------------------ */

export async function clockNetworks(db: Db, practiceId: string) {
  const [row] = await db.select().from(clockSettings).where(eq(clockSettings.practiceId, practiceId)).limit(1);
  return { networks: row?.networks ?? [], mode: (row?.mode ?? "flag") as "flag" | "require" };
}

export async function saveClockNetworks(db: Db, practiceId: string, networks: string[], mode: string, by?: string) {
  const list = networks.map((n) => n.trim()).filter(Boolean);
  for (const n of list) if (!parseCidr(n)) throw new Error(`${n} is not an IP address or range (for example 203.0.113.0/24)`);
  if (mode !== "flag" && mode !== "require") throw new Error("Choose whether to flag or refuse");
  await db.insert(clockSettings).values({ practiceId, networks: list, mode, updatedBy: by ?? null })
    .onConflictDoUpdate({ target: clockSettings.practiceId, set: { networks: list, mode, updatedBy: by ?? null, updatedAt: new Date() } });
  await db.insert(auditLog).values({ practiceId, userId: by ?? null, action: "clock_networks_saved", entity: "practice", entityId: practiceId, details: { networks: list.length, mode } });
}

export async function currentEntry(db: Db, userId: string) {
  const [e] = await db.select().from(timeEntries).where(and(eq(timeEntries.userId, userId), isNull(timeEntries.clockOut))).limit(1);
  return e ?? null;
}

export async function currentBreak(db: Db, entryId: string) {
  const [b] = await db.select().from(timeBreaks).where(and(eq(timeBreaks.entryId, entryId), isNull(timeBreaks.endsAt))).limit(1);
  return b ?? null;
}

/** Clocks in; outside the office networks it is flagged, or refused when the practice requires them. */
export async function clockIn(db: Db, practiceId: string, userId: string, at = new Date(), ip: string | null = null) {
  if (await currentEntry(db, userId)) throw new Error("You are already clocked in");
  const net = await clockNetworks(db, practiceId);
  const offNetwork = net.networks.length > 0 && !ipAllowed(ip, net.networks);
  if (offNetwork && net.mode === "require") throw new Error("Clock in from an office network. Your address is not on the practice's list.");
  const [row] = await db.insert(timeEntries).values({ practiceId, userId, clockIn: at, ip, offNetwork }).returning();
  return row;
}

export async function startBreak(db: Db, userId: string, at = new Date()) {
  const e = await currentEntry(db, userId);
  if (!e) throw new Error("Clock in first");
  if (await currentBreak(db, e.id)) throw new Error("You are already on a break");
  await db.insert(timeBreaks).values({ entryId: e.id, startsAt: at });
}

export async function endBreak(db: Db, userId: string, at = new Date()) {
  const e = await currentEntry(db, userId);
  const b = e ? await currentBreak(db, e.id) : null;
  if (!b) throw new Error("You are not on a break");
  await db.update(timeBreaks).set({ endsAt: at }).where(eq(timeBreaks.id, b.id));
  return (at.getTime() - b.startsAt.getTime()) / 60_000;
}

export async function clockOut(db: Db, userId: string, at = new Date(), note?: string) {
  const e = await currentEntry(db, userId);
  if (!e) throw new Error("You are not clocked in");
  // A forgotten clock-out counts at most MAX_ENTRY_HOURS.
  const out = new Date(Math.min(at.getTime(), e.clockIn.getTime() + MAX_ENTRY_HOURS * 3_600_000));
  const b = await currentBreak(db, e.id);
  if (b) await db.update(timeBreaks).set({ endsAt: out }).where(eq(timeBreaks.id, b.id));
  await db.update(timeEntries).set({ clockOut: out, note: note?.trim().slice(0, 200) || null }).where(eq(timeEntries.id, e.id));
  const breaks = await db.select().from(timeBreaks).where(eq(timeBreaks.entryId, e.id));
  const breakMs = breaks.reduce((a, x) => a + ((x.endsAt ?? out).getTime() - x.startsAt.getTime()), 0);
  return { hours: (out.getTime() - e.clockIn.getTime() - breakMs) / 3_600_000, breakMinutes: Math.round(breakMs / 60_000), capped: out.getTime() < at.getTime() };
}

export type WorkedSpan = { userId: string; start: Date; end: Date };

/**
 * The time each person actually worked between two moments: clocked entries
 * (an open one runs to `now`, each capped at MAX_ENTRY_HOURS) less breaks,
 * as spans so they can be split by day for overtime.
 */
export async function workedSpans(db: Db, practiceId: string, userIds: string[], start: Date, end: Date, now = new Date()) {
  if (!userIds.length) return [];
  const entries = await db.select().from(timeEntries).where(and(eq(timeEntries.practiceId, practiceId), inArray(timeEntries.userId, userIds), lte(timeEntries.clockIn, end)));
  const breaks = entries.length ? await db.select().from(timeBreaks).where(inArray(timeBreaks.entryId, entries.map((e) => e.id))) : [];
  const spans: WorkedSpan[] = [];
  for (const e of entries) {
    const stop = new Date(Math.min((e.clockOut ?? now).getTime(), e.clockIn.getTime() + MAX_ENTRY_HOURS * 3_600_000));
    let pieces = [{ start: e.clockIn, end: stop }];
    for (const b of breaks.filter((x) => x.entryId === e.id)) {
      const bs = b.startsAt, be = b.endsAt ?? stop;
      pieces = pieces.flatMap((p) => {
        if (be <= p.start || bs >= p.end) return [p];
        return [{ start: p.start, end: bs }, { start: be, end: p.end }].filter((x) => x.end > x.start);
      });
    }
    for (const p of pieces) {
      const s = new Date(Math.max(p.start.getTime(), start.getTime())), t = new Date(Math.min(p.end.getTime(), end.getTime()));
      if (t > s) spans.push({ userId: e.userId, start: s, end: t });
    }
  }
  return spans;
}

export async function saveHandover(db: Db, practiceId: string, userId: string, input: { done?: string; inProgress?: string; problems?: string }) {
  const clean = (v?: string) => v?.trim().slice(0, 2000) || null;
  const values = { done: clean(input.done), inProgress: clean(input.inProgress), problems: clean(input.problems) };
  if (!values.done && !values.inProgress && !values.problems) throw new Error("Write at least one line for the next shift");
  const [row] = await db.insert(shiftHandovers).values({ practiceId, userId, ...values }).returning();
  return row;
}

export async function recentHandovers(db: Db, practiceId: string, hours = 24, now = new Date()) {
  return db.select({ h: shiftHandovers, name: users.name, tz: users.timeZone }).from(shiftHandovers).innerJoin(users, eq(users.id, shiftHandovers.userId))
    .where(and(eq(shiftHandovers.practiceId, practiceId), gte(shiftHandovers.createdAt, new Date(now.getTime() - hours * 3_600_000))))
    .orderBy(desc(shiftHandovers.createdAt)).limit(20);
}

/* ------------------------------ The team, coverage and output ------------------------------ */

export async function teamBoard(db: Db, practiceId: string, at = new Date()) {
  const team = await assignableUsers(db, practiceId);
  const ids = team.map((t) => t.id);
  const [avail, entries] = await Promise.all([
    availability(db, ids, at),
    ids.length ? db.select().from(timeEntries).where(and(inArray(timeEntries.userId, ids), isNull(timeEntries.clockOut))) : Promise.resolve([]),
  ]);
  const breaks = entries.length ? await db.select().from(timeBreaks).where(and(inArray(timeBreaks.entryId, entries.map((e) => e.id)), isNull(timeBreaks.endsAt))) : [];
  return team.map((t) => {
    const entry = entries.find((e) => e.userId === t.id);
    const a = avail.get(t.id)!;
    return { ...t, ...a, shifts: [...a.shifts].sort((x, y) => x.weekday - y.weekday || x.startsAt.localeCompare(y.startsAt)), clockedInSince: entry?.clockIn ?? null, offNetwork: entry?.offNetwork ?? false, onBreak: !!entry && breaks.some((b) => b.entryId === entry.id) };
  });
}

/** Gaps: queues with nobody available today, and open tasks due by tomorrow whose owner is off. */
export async function coverageGaps(db: Db, practiceId: string, now = new Date()) {
  const rules = await db.select().from(workRules).where(and(eq(workRules.practiceId, practiceId), eq(workRules.active, true)));
  const ids = [...new Set(rules.flatMap((r) => r.assigneeIds))];
  const tomorrow = new Date(now.getTime() + DAY).toISOString().slice(0, 10);
  const due = await db.select({ t: tasks, name: users.name }).from(tasks).innerJoin(users, eq(users.id, tasks.assigneeId))
    .where(and(eq(tasks.practiceId, practiceId), eq(tasks.status, "open"), lte(tasks.dueDate, tomorrow)));
  const avail = await availability(db, [...new Set([...ids, ...due.map((d) => d.t.assigneeId!)])], now);
  const uncovered = rules.filter((r) => r.assigneeIds.length > 0 && r.assigneeIds.every((id) => avail.get(id)?.offToday)).map((r) => ({ ruleId: r.id, name: r.name }));
  const stranded = due.filter((d) => avail.get(d.t.assigneeId!)?.offToday).map((d) => ({ taskId: d.t.id, title: d.t.title, dueDate: d.t.dueDate, owner: d.name }));
  return { uncovered, stranded };
}

/** Hours worked (less breaks) and output per person in a period, and output per hour. */
export async function hoursAndOutput(db: Db, practiceId: string, from: string, to: string, now = new Date()) {
  const start = new Date(`${from}T00:00:00Z`), end = new Date(Date.parse(`${to}T00:00:00Z`) + DAY);
  const team = await assignableUsers(db, practiceId);
  if (!team.length) return [];
  const ids = team.map((t) => t.id);
  const spans = await workedSpans(db, practiceId, ids, start, end, now);
  const [done, posted, sent, flagged] = await Promise.all([
    db.select({ userId: tasks.assigneeId }).from(tasks).where(and(eq(tasks.practiceId, practiceId), inArray(tasks.assigneeId, ids), eq(tasks.status, "done"), gte(tasks.completedAt, start), lte(tasks.completedAt, end))),
    db.select({ userId: schema.ledgerEntries.postedBy }).from(schema.ledgerEntries).where(and(eq(schema.ledgerEntries.practiceId, practiceId), inArray(schema.ledgerEntries.postedBy, ids), gte(schema.ledgerEntries.postedAt, start), lte(schema.ledgerEntries.postedAt, end))),
    db.select({ userId: auditLog.userId }).from(auditLog).where(and(eq(auditLog.practiceId, practiceId), eq(auditLog.action, "submit_claim"), inArray(auditLog.userId, ids), gte(auditLog.at, start), lte(auditLog.at, end))),
    db.select({ userId: timeEntries.userId }).from(timeEntries).where(and(inArray(timeEntries.userId, ids), eq(timeEntries.offNetwork, true), gte(timeEntries.clockIn, start), lte(timeEntries.clockIn, end))),
  ]);
  const count = (rows: { userId: string | null }[], id: string) => rows.filter((r) => r.userId === id).length;
  return team.map((t) => {
    const hours = spans.filter((s) => s.userId === t.id).reduce((a, s) => a + (s.end.getTime() - s.start.getTime()), 0) / 3_600_000;
    const n = { tasks: count(done, t.id), postings: count(posted, t.id), claims: count(sent, t.id), offNetwork: count(flagged, t.id) };
    const per = (v: number) => (hours >= 0.5 ? v / hours : null);
    return { userId: t.id, name: t.name, role: t.role, hours, ...n, tasksPerHour: per(n.tasks), claimsPerHour: per(n.claims), postingsPerHour: per(n.postings) };
  }).sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name));
}
