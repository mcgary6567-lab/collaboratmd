/**
 * Biller shifts, for a team that works in more than one time zone (an
 * offshore billing team, an overnight shift).
 *
 *  - Each person has a time zone and weekly working hours in it. A shift that
 *    ends before it starts (22:00 to 06:00) runs past midnight. Someone with no
 *    hours set is treated as always available, so nothing changes until a
 *    schedule is entered.
 *  - Time off is a range of dates in the person's own time zone. Work queue
 *    rules skip people who are off; recording time off moves their open queue
 *    tasks due in that time to the others on the same rule.
 *  - Clocking in and out records hours worked, for output per hour.
 *  - A handover note at the end of a shift is shown to the next shift.
 *
 * Shifts belong to the person, not to one practice: a billing company's
 * billers work across its client practices, and the same hours apply in each.
 */
import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { practiceClock, practiceTimeZone, validTimeZone } from "./practice-time";
import { assignableUsers } from "./work";

const { staffShifts, staffTimeOff, timeEntries, shiftHandovers, users, tasks, workRules, auditLog } = schema;

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const TIME_OFF_KINDS: Record<string, string> = { vacation: "Vacation", sick: "Sick", holiday: "Holiday", other: "Other" };
/** An entry left open longer than this was probably a missed clock-out; it counts this long at most. */
export const MAX_ENTRY_HOURS = 16;

export type Shift = { weekday: number; startsAt: string; endsAt: string };
export type TimeOff = { startsOn: string; endsOn: string };

const HM = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const minutesOf = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));

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

export const isOffOn = (timeOff: TimeOff[], localDate: string) => timeOff.some((t) => t.startsOn <= localDate && localDate <= t.endsOn);

/** The real moment a local date and time in a time zone happens (daylight saving included). */
export function zonedMoment(date: string, hm: string, tz: string) {
  const guess = Date.parse(`${date}T${hm}:00Z`);
  const offset = practiceClock(new Date(guess), tz).getTime() - guess;
  let at = guess - offset;
  const again = practiceClock(new Date(at), tz).getTime() - at;
  if (again !== offset) at = guess - again;
  return new Date(at);
}

/** When the person's next shift starts, skipping days off; null with no schedule in the next 14 days. */
export function nextShiftStart(shifts: Shift[], timeOff: TimeOff[], at: Date, tz: string) {
  if (!shifts.length) return null;
  const today = localClock(at, tz).date;
  for (let k = 0; k < 14; k++) {
    const date = new Date(Date.parse(`${today}T00:00:00Z`) + k * 86_400_000).toISOString().slice(0, 10);
    if (isOffOn(timeOff, date)) continue;
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    const starts = shifts.filter((s) => s.weekday === weekday).map((s) => zonedMoment(date, s.startsAt, tz)).filter((d) => d.getTime() > at.getTime()).sort((a, b) => a.getTime() - b.getTime());
    if (starts.length) return starts[0];
  }
  return null;
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

/** Records time off and moves the person's open queue tasks due in that time to others on the same rule. */
export async function addTimeOff(db: Db, practiceId: string, input: { userId: string; startsOn: string; endsOn: string; kind: string; note?: string }, by?: string, now = new Date()) {
  const u = await ownUser(db, input.userId);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startsOn) || !/^\d{4}-\d{2}-\d{2}$/.test(input.endsOn) || input.endsOn < input.startsOn) throw new Error("Enter the first and last day off");
  if (!TIME_OFF_KINDS[input.kind]) throw new Error("Choose the kind of time off");
  const [row] = await db.insert(staffTimeOff).values({ practiceId: u.practiceId, userId: u.id, startsOn: input.startsOn, endsOn: input.endsOn, kind: input.kind, note: input.note?.trim().slice(0, 200) || null, createdBy: by ?? null }).returning();
  await db.insert(auditLog).values({ practiceId, userId: by ?? null, action: "staff_time_off_added", entity: "user", entityId: u.id, details: { startsOn: input.startsOn, endsOn: input.endsOn, kind: input.kind } });
  const moved = await reassignDuringTimeOff(db, u.id, input.startsOn, input.endsOn, now);
  return { timeOff: row, moved };
}

/** Time off that has not ended, for a set of people. */
export async function upcomingTimeOff(db: Db, userIds: string[], today: string) {
  if (!userIds.length) return [];
  return db.select({ o: staffTimeOff, name: users.name }).from(staffTimeOff).innerJoin(users, eq(users.id, staffTimeOff.userId))
    .where(and(inArray(staffTimeOff.userId, userIds), gte(staffTimeOff.endsOn, today))).orderBy(staffTimeOff.startsOn).limit(100);
}

export async function removeTimeOff(db: Db, practiceId: string, id: string, by?: string) {
  const [row] = await db.delete(staffTimeOff).where(eq(staffTimeOff.id, id)).returning();
  if (!row) throw new Error("Not found");
  await db.insert(auditLog).values({ practiceId, userId: by ?? null, action: "staff_time_off_removed", entity: "user", entityId: row.userId, details: { startsOn: row.startsOn, endsOn: row.endsOn } });
}

type Availability = { tz: string; hasSchedule: boolean; onShift: boolean; offToday: boolean; localTime: string; localDate: string; nextStart: Date | null; timeOff: TimeOff[] };

/** Where each person stands at a moment: on shift, off today, and when they are next on. */
export async function availability(db: Db, userIds: string[], at = new Date(), fallbackTz?: string) {
  const out = new Map<string, Availability>();
  if (!userIds.length) return out;
  const [people, shifts, off] = await Promise.all([
    db.select({ id: users.id, tz: users.timeZone, practiceId: users.practiceId }).from(users).where(inArray(users.id, userIds)),
    db.select().from(staffShifts).where(inArray(staffShifts.userId, userIds)),
    db.select().from(staffTimeOff).where(and(inArray(staffTimeOff.userId, userIds), gte(staffTimeOff.endsOn, new Date(at.getTime() - 2 * 86_400_000).toISOString().slice(0, 10)))),
  ]);
  for (const p of people) {
    const tz = p.tz && validTimeZone(p.tz) ? p.tz : fallbackTz ?? (await practiceTimeZone(db, p.practiceId));
    const mine = shifts.filter((s) => s.userId === p.id);
    const myOff = off.filter((o) => o.userId === p.id);
    const local = localClock(at, tz);
    const offToday = isOffOn(myOff, local.date);
    out.set(p.id, {
      tz, hasSchedule: mine.length > 0, offToday, localTime: local.time, localDate: local.date, timeOff: myOff,
      onShift: !offToday && (mine.length === 0 || isOnShift(mine, at, tz)),
      nextStart: nextShiftStart(mine, myOff, at, tz),
    });
  }
  return out;
}

/** Who can take new work: not off today (their own date). With nobody available, everyone stays in the rotation. */
export function pickAssignee(assigneeIds: string[], nextIndex: number, avail: Map<string, Availability>) {
  const n = assigneeIds.length;
  for (let k = 0; k < n; k++) {
    const id = assigneeIds[(nextIndex + k) % n];
    const a = avail.get(id);
    if (!a || !a.offToday) return { assigneeId: id, next: nextIndex + k + 1 };
  }
  return { assigneeId: assigneeIds[nextIndex % n], next: nextIndex + 1 };
}

/** Moves a person's open queue tasks due in their time off to others on the same rule who are not off then. */
export async function reassignDuringTimeOff(db: Db, userId: string, startsOn: string, endsOn: string, now = new Date()) {
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
    await db.update(tasks).set({ assigneeId: to, note: [t.note, `Moved from ${me?.name ?? "a teammate"} (time off ${startsOn} to ${endsOn})`].filter(Boolean).join("\n") }).where(eq(tasks.id, t.id));
    moved++;
  }
  return moved;
}

/* ------------------------------ Clock and handover ------------------------------ */

export async function currentEntry(db: Db, userId: string) {
  const [e] = await db.select().from(timeEntries).where(and(eq(timeEntries.userId, userId), isNull(timeEntries.clockOut))).limit(1);
  return e ?? null;
}

export async function clockIn(db: Db, practiceId: string, userId: string, at = new Date()) {
  if (await currentEntry(db, userId)) throw new Error("You are already clocked in");
  const [row] = await db.insert(timeEntries).values({ practiceId, userId, clockIn: at }).returning();
  return row;
}

export async function clockOut(db: Db, userId: string, at = new Date(), note?: string) {
  const e = await currentEntry(db, userId);
  if (!e) throw new Error("You are not clocked in");
  // A forgotten clock-out counts at most MAX_ENTRY_HOURS.
  const out = new Date(Math.min(at.getTime(), e.clockIn.getTime() + MAX_ENTRY_HOURS * 3_600_000));
  await db.update(timeEntries).set({ clockOut: out, note: note?.trim().slice(0, 200) || null }).where(eq(timeEntries.id, e.id));
  return { hours: (out.getTime() - e.clockIn.getTime()) / 3_600_000, capped: out.getTime() < at.getTime() };
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
  const [avail, shifts, entries] = await Promise.all([
    availability(db, team.map((t) => t.id), at),
    team.length ? db.select().from(staffShifts).where(inArray(staffShifts.userId, team.map((t) => t.id))) : Promise.resolve([]),
    team.length ? db.select().from(timeEntries).where(and(inArray(timeEntries.userId, team.map((t) => t.id)), isNull(timeEntries.clockOut))) : Promise.resolve([]),
  ]);
  return team.map((t) => ({ ...t, ...avail.get(t.id)!, shifts: shifts.filter((s) => s.userId === t.id).sort((a, b) => a.weekday - b.weekday || a.startsAt.localeCompare(b.startsAt)), clockedInSince: entries.find((e) => e.userId === t.id)?.clockIn ?? null }));
}

/** Gaps: queues with nobody available today, and open tasks due by tomorrow whose owner is off. */
export async function coverageGaps(db: Db, practiceId: string, now = new Date()) {
  const rules = (await db.select().from(workRules).where(and(eq(workRules.practiceId, practiceId), eq(workRules.active, true))));
  const ids = [...new Set(rules.flatMap((r) => r.assigneeIds))];
  const tomorrow = new Date(now.getTime() + 86_400_000).toISOString().slice(0, 10);
  const due = await db.select({ t: tasks, name: users.name }).from(tasks).innerJoin(users, eq(users.id, tasks.assigneeId))
    .where(and(eq(tasks.practiceId, practiceId), eq(tasks.status, "open"), lte(tasks.dueDate, tomorrow)));
  const avail = await availability(db, [...new Set([...ids, ...due.map((d) => d.t.assigneeId!)])], now);
  const uncovered = rules.filter((r) => r.assigneeIds.length > 0 && r.assigneeIds.every((id) => avail.get(id)?.offToday)).map((r) => ({ ruleId: r.id, name: r.name }));
  const stranded = due.filter((d) => avail.get(d.t.assigneeId!)?.offToday).map((d) => ({ taskId: d.t.id, title: d.t.title, dueDate: d.t.dueDate, owner: d.name }));
  return { uncovered, stranded };
}

/** Hours clocked and output per person in a period, and output per hour. */
export async function hoursAndOutput(db: Db, practiceId: string, from: string, to: string, now = new Date()) {
  const start = new Date(`${from}T00:00:00Z`), end = new Date(Date.parse(`${to}T00:00:00Z`) + 86_400_000);
  const team = await assignableUsers(db, practiceId);
  if (!team.length) return [];
  const ids = team.map((t) => t.id);
  const { rows } = await db.execute<Record<string, string | null>>(sql`
    SELECT u.id,
      (SELECT COALESCE(sum(extract(epoch FROM (LEAST(COALESCE(e.clock_out, ${now}), e.clock_in + interval '${sql.raw(String(MAX_ENTRY_HOURS))} hours', ${end}) - GREATEST(e.clock_in, ${start}))) / 3600), 0)
         FROM time_entries e WHERE e.user_id = u.id AND e.practice_id = ${practiceId} AND e.clock_in < ${end} AND COALESCE(e.clock_out, ${now}) > ${start})::text AS hours,
      (SELECT count(*) FROM tasks t WHERE t.assignee_id = u.id AND t.practice_id = ${practiceId} AND t.status = 'done' AND t.completed_at >= ${start} AND t.completed_at < ${end})::text AS tasks,
      (SELECT count(*) FROM ledger_entries l WHERE l.posted_by = u.id AND l.practice_id = ${practiceId} AND l.posted_at >= ${start} AND l.posted_at < ${end})::text AS postings,
      (SELECT count(*) FROM audit_log a WHERE a.user_id = u.id AND a.practice_id = ${practiceId} AND a.action = 'submit_claim' AND a.at >= ${start} AND a.at < ${end})::text AS claims
    FROM users u WHERE u.id IN (SELECT jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)::uuid)`);
  return team.map((t) => {
    const r = rows.find((x) => x.id === t.id);
    const hours = Math.max(0, Number(r?.hours ?? 0));
    const n = (k: string) => Number(r?.[k] ?? 0);
    const per = (v: number) => (hours >= 0.5 ? v / hours : null);
    return { userId: t.id, name: t.name, role: t.role, hours, tasks: n("tasks"), postings: n("postings"), claims: n("claims"), tasksPerHour: per(n("tasks")), claimsPerHour: per(n("claims")), postingsPerHour: per(n("postings")) };
  }).sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name));
}
