/**
 * Clocked time after the fact: corrections and weekly timesheets.
 *
 *  - An administrator corrects a person's entries and breaks (or adds a
 *    missing entry, or removes a wrong one), always with a reason; the person
 *    can ask for a correction, which an administrator approves. Nobody
 *    corrects or approves their own time. Every change is in the audit log
 *    with the times before and after.
 *  - Each week (Monday to Sunday in the person's time zone) the person submits
 *    their timesheet and an administrator approves it. An approved week is
 *    locked: correcting it means reopening it first. Correcting a submitted
 *    week sends it back to the person to submit again.
 *  - The pay worksheet shows how many of a person's weeks are approved, so
 *    unchecked hours do not go to payroll unnoticed.
 */
import { and, asc, desc, eq, gte, inArray, isNull, lt, ne } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { localClock, MAX_ENTRY_HOURS, zonedMoment } from "./shifts";
import { practiceTimeZone, validTimeZone } from "./practice-time";
import { assignableUsers } from "./work";
import { notify } from "./notifications";

const { timeEntries, timeBreaks, timeCorrections, timesheets, users, auditLog } = schema;
const DAY = 86_400_000;
const HOUR = 3_600_000;
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** The Monday of the week a local date falls in. */
export function weekStartOf(localDate: string) {
  const d = new Date(`${localDate}T00:00:00Z`);
  return addDays(localDate, -((d.getUTCDay() + 6) % 7));
}

/** "2026-10-01T21:30" in a time zone, as a moment. */
export function parseLocal(value: string, tz: string) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(value.trim());
  if (!m) throw new Error("Enter the date and time");
  return zonedMoment(m[1], m[2], tz);
}

/** A moment as "2026-10-01T21:30" in a time zone, for a date-and-time field. */
export function toLocalInput(at: Date, tz: string) {
  const c = localClock(at, tz);
  return `${c.date}T${c.time}`;
}

export async function personTz(db: Db, userId: string) {
  const [u] = await db.select({ tz: users.timeZone, practiceId: users.practiceId, name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
  if (!u) throw new Error("Person not found");
  return { tz: u.tz && validTimeZone(u.tz) ? u.tz : await practiceTimeZone(db, u.practiceId), practiceId: u.practiceId, name: u.name };
}

const weekOfMoment = (at: Date, tz: string) => weekStartOf(localClock(at, tz).date);

/** The real moments a local week starts and ends. */
export function weekBounds(weekStart: string, tz: string) {
  return { start: zonedMoment(weekStart, "00:00", tz), end: zonedMoment(addDays(weekStart, 7), "00:00", tz) };
}

async function sheetFor(db: Db, userId: string, weekStart: string) {
  const [s] = await db.select().from(timesheets).where(and(eq(timesheets.userId, userId), eq(timesheets.weekStart, weekStart))).limit(1);
  return s ?? null;
}

/**
 * Before a change to the person's time in the weeks of these moments: refuses
 * an approved week, and sends a submitted one back to the person.
 */
async function touchWeeks(db: Db, practiceId: string, userId: string, tz: string, moments: Date[]) {
  const weeks = [...new Set(moments.map((m) => weekOfMoment(m, tz)))];
  for (const w of weeks) {
    const s = await sheetFor(db, userId, w);
    if (s?.status === "approved") throw new Error(`The timesheet for the week of ${w} is approved. Reopen it first.`);
  }
  for (const w of weeks) {
    const s = await sheetFor(db, userId, w);
    if (s?.status === "submitted") {
      await db.delete(timesheets).where(eq(timesheets.id, s.id));
      await notify(db, practiceId, { userId, kind: "timesheet", title: `Your time for the week of ${w} was corrected: check it and submit it again`, href: "/work/shifts", dedupeKey: `sheet-back:${s.id}` });
    }
  }
}

async function onTeam(db: Db, practiceId: string, userId: string) {
  // People since deactivated included: their last weeks still get corrected and approved for final pay.
  if (!(await assignableUsers(db, practiceId, { includeDisabled: true })).some((u) => u.id === userId)) throw new Error("That person is not on this practice's team");
}

function checkSpan(clockIn: Date, clockOut: Date, now: Date) {
  if (!(clockOut.getTime() > clockIn.getTime())) throw new Error("The clock-out must be after the clock-in");
  if (clockOut.getTime() - clockIn.getTime() > 24 * HOUR) throw new Error("An entry can be at most 24 hours; split a longer one");
  if (clockOut.getTime() > now.getTime() + 5 * 60_000) throw new Error("The clock-out cannot be in the future");
}

async function checkNoOverlap(db: Db, userId: string, clockIn: Date, clockOut: Date, now: Date, exceptId?: string) {
  const others = await db.select().from(timeEntries).where(and(eq(timeEntries.userId, userId), lt(timeEntries.clockIn, clockOut), exceptId ? ne(timeEntries.id, exceptId) : undefined));
  if (others.some((e) => (e.clockOut ?? now).getTime() > clockIn.getTime())) throw new Error("These times overlap another entry");
}

const reasonOf = (reason: string) => {
  const r = reason.trim().slice(0, 300);
  if (r.length < 3) throw new Error("Give the reason for the correction");
  return r;
};

const notSelf = (by: string, userId: string) => {
  if (by === userId) throw new Error("Another administrator corrects or approves your own time");
};

async function entryRow(db: Db, entryId: string) {
  const [e] = await db.select().from(timeEntries).where(eq(timeEntries.id, entryId)).limit(1);
  if (!e) throw new Error("Entry not found");
  return e;
}

const iso = (d: Date | null) => d?.toISOString() ?? null;

/* ------------------------------ Corrections by an administrator ------------------------------ */

/** Changes an entry's clock-in and clock-out. Breaks must stay inside the new times. */
export async function correctEntry(db: Db, practiceId: string, by: string, entryId: string, times: { clockIn: Date; clockOut: Date }, reason: string, now = new Date()) {
  const e = await entryRow(db, entryId);
  notSelf(by, e.userId);
  await onTeam(db, practiceId, e.userId);
  const why = reasonOf(reason);
  checkSpan(times.clockIn, times.clockOut, now);
  await checkNoOverlap(db, e.userId, times.clockIn, times.clockOut, now, e.id);
  const breaks = await db.select().from(timeBreaks).where(eq(timeBreaks.entryId, e.id));
  if (breaks.some((b) => b.startsAt < times.clockIn || (b.endsAt ?? b.startsAt) > times.clockOut)) throw new Error("A break falls outside the new times: correct or remove the break first");
  const { tz } = await personTz(db, e.userId);
  await touchWeeks(db, practiceId, e.userId, tz, [e.clockIn, times.clockIn]);
  await db.update(timeEntries).set({ clockIn: times.clockIn, clockOut: times.clockOut }).where(eq(timeEntries.id, e.id));
  // Closing an entry that was still open closes its open break too.
  await db.update(timeBreaks).set({ endsAt: times.clockOut }).where(and(eq(timeBreaks.entryId, e.id), isNull(timeBreaks.endsAt)));
  await db.insert(auditLog).values({ practiceId, userId: by, action: "time_entry_corrected", entity: "user", entityId: e.userId, details: { entryId: e.id, before: { clockIn: iso(e.clockIn), clockOut: iso(e.clockOut) }, after: { clockIn: iso(times.clockIn), clockOut: iso(times.clockOut) }, reason: why } });
  await notify(db, practiceId, { userId: e.userId, kind: "timesheet", title: "An administrator corrected one of your time entries", body: why, href: "/work/shifts", dedupeKey: `entry-corrected:${e.id}:${now.getTime()}` });
}

/** Adds an entry someone forgot to clock. */
export async function addEntry(db: Db, practiceId: string, by: string, userId: string, times: { clockIn: Date; clockOut: Date }, reason: string, now = new Date()) {
  notSelf(by, userId);
  await onTeam(db, practiceId, userId);
  const why = reasonOf(reason);
  checkSpan(times.clockIn, times.clockOut, now);
  await checkNoOverlap(db, userId, times.clockIn, times.clockOut, now);
  const { tz } = await personTz(db, userId);
  await touchWeeks(db, practiceId, userId, tz, [times.clockIn]);
  const [row] = await db.insert(timeEntries).values({ practiceId, userId, clockIn: times.clockIn, clockOut: times.clockOut, note: `Added by an administrator: ${why}`.slice(0, 200) }).returning();
  await db.insert(auditLog).values({ practiceId, userId: by, action: "time_entry_added", entity: "user", entityId: userId, details: { entryId: row.id, clockIn: iso(times.clockIn), clockOut: iso(times.clockOut), reason: why } });
  return row;
}

export async function deleteEntry(db: Db, practiceId: string, by: string, entryId: string, reason: string) {
  const e = await entryRow(db, entryId);
  notSelf(by, e.userId);
  await onTeam(db, practiceId, e.userId);
  const why = reasonOf(reason);
  const { tz } = await personTz(db, e.userId);
  await touchWeeks(db, practiceId, e.userId, tz, [e.clockIn]);
  await db.update(timeCorrections).set({ entryId: null }).where(eq(timeCorrections.entryId, e.id));
  await db.delete(timeEntries).where(eq(timeEntries.id, e.id));
  await db.insert(auditLog).values({ practiceId, userId: by, action: "time_entry_removed", entity: "user", entityId: e.userId, details: { entryId: e.id, clockIn: iso(e.clockIn), clockOut: iso(e.clockOut), reason: why } });
}

/** Adds, changes or (with `times` null) removes a break. */
export async function correctBreak(db: Db, practiceId: string, by: string, target: { breakId?: string; entryId?: string }, times: { startsAt: Date; endsAt: Date } | null, reason: string) {
  const b = target.breakId ? (await db.select().from(timeBreaks).where(eq(timeBreaks.id, target.breakId)).limit(1))[0] : undefined;
  if (target.breakId && !b) throw new Error("Break not found");
  const e = await entryRow(db, b?.entryId ?? target.entryId ?? "");
  notSelf(by, e.userId);
  await onTeam(db, practiceId, e.userId);
  const why = reasonOf(reason);
  if (times) {
    if (!(times.endsAt > times.startsAt)) throw new Error("The break must end after it starts");
    if (times.startsAt < e.clockIn || (e.clockOut && times.endsAt > e.clockOut)) throw new Error("The break must be inside the entry's times");
    const others = await db.select().from(timeBreaks).where(eq(timeBreaks.entryId, e.id));
    if (others.some((x) => x.id !== b?.id && x.startsAt < times.endsAt && (x.endsAt ?? times.endsAt) > times.startsAt)) throw new Error("This overlaps another break");
  } else if (!b) throw new Error("Break not found");
  const { tz } = await personTz(db, e.userId);
  await touchWeeks(db, practiceId, e.userId, tz, [e.clockIn]);
  if (!times) await db.delete(timeBreaks).where(eq(timeBreaks.id, b!.id));
  else if (b) await db.update(timeBreaks).set(times).where(eq(timeBreaks.id, b.id));
  else await db.insert(timeBreaks).values({ entryId: e.id, ...times });
  await db.insert(auditLog).values({ practiceId, userId: by, action: !times ? "time_break_removed" : b ? "time_break_corrected" : "time_break_added", entity: "user", entityId: e.userId, details: { entryId: e.id, before: b ? { startsAt: iso(b.startsAt), endsAt: iso(b.endsAt) } : null, after: times ? { startsAt: iso(times.startsAt), endsAt: iso(times.endsAt) } : null, reason: why } });
}

/* ------------------------------ Corrections the person asks for ------------------------------ */

export async function requestCorrection(db: Db, practiceId: string, userId: string, input: { entryId?: string | null; clockIn: Date; clockOut: Date; reason: string }, now = new Date()) {
  const why = reasonOf(input.reason);
  const e = input.entryId ? await entryRow(db, input.entryId) : null;
  if (e && e.userId !== userId) throw new Error("Choose one of your own entries");
  checkSpan(input.clockIn, input.clockOut, now);
  const { tz, name } = await personTz(db, userId);
  for (const w of new Set([input.clockIn, ...(e ? [e.clockIn] : [])].map((m) => weekOfMoment(m, tz)))) {
    if ((await sheetFor(db, userId, w))?.status === "approved") throw new Error(`The timesheet for the week of ${w} is approved. Ask an administrator to reopen it.`);
  }
  const [row] = await db.insert(timeCorrections).values({ practiceId, userId, entryId: input.entryId || null, clockIn: input.clockIn, clockOut: input.clockOut, reason: why }).returning();
  await notify(db, practiceId, { kind: "timesheet", title: `${name} asked for a time correction`, body: why, href: "/work/shifts/timesheets", dedupeKey: `correction:${row.id}` });
  await db.insert(auditLog).values({ practiceId, userId, action: "time_correction_requested", entity: "user", entityId: userId, details: { correctionId: row.id, entryId: input.entryId || null } });
  return row;
}

/** Approving applies the correction: changes the entry, or adds the missing one. */
export async function decideCorrection(db: Db, practiceId: string, id: string, by: string, approve: boolean, now = new Date()) {
  const [c] = await db.select().from(timeCorrections).where(and(eq(timeCorrections.id, id), eq(timeCorrections.practiceId, practiceId))).limit(1);
  if (!c) throw new Error("Not found");
  if (c.status !== "requested") throw new Error("This request was already decided");
  notSelf(by, c.userId);
  if (approve) {
    const reason = `Asked for by the person: ${c.reason}`;
    if (c.entryId) await correctEntry(db, practiceId, by, c.entryId, { clockIn: c.clockIn, clockOut: c.clockOut }, reason, now);
    else await addEntry(db, practiceId, by, c.userId, { clockIn: c.clockIn, clockOut: c.clockOut }, reason, now);
  }
  await db.update(timeCorrections).set({ status: approve ? "approved" : "denied", decidedBy: by, decidedAt: now }).where(eq(timeCorrections.id, id));
  await notify(db, practiceId, { userId: c.userId, kind: "timesheet", title: `Your time correction was ${approve ? "approved" : "denied"}`, href: "/work/shifts", dedupeKey: `correction-decided:${id}` });
  await db.insert(auditLog).values({ practiceId, userId: by, action: approve ? "time_correction_approved" : "time_correction_denied", entity: "user", entityId: c.userId, details: { correctionId: id } });
}

export async function cancelCorrection(db: Db, practiceId: string, id: string, userId: string) {
  const [c] = await db.select().from(timeCorrections).where(and(eq(timeCorrections.id, id), eq(timeCorrections.practiceId, practiceId))).limit(1);
  if (!c || c.userId !== userId) throw new Error("Not found");
  if (c.status !== "requested") throw new Error("This request was already decided");
  await db.update(timeCorrections).set({ status: "cancelled" }).where(eq(timeCorrections.id, id));
}

export async function correctionRequests(db: Db, practiceId: string, userId?: string) {
  return db.select({ c: timeCorrections, name: users.name, tz: users.timeZone }).from(timeCorrections).innerJoin(users, eq(users.id, timeCorrections.userId))
    .where(and(eq(timeCorrections.practiceId, practiceId), userId ? eq(timeCorrections.userId, userId) : eq(timeCorrections.status, "requested")))
    .orderBy(desc(timeCorrections.createdAt)).limit(50);
}

/* ------------------------------ The week ------------------------------ */

/** A person's entries in a local week, with breaks and hours worked, and the week's timesheet. */
export async function weekOf(db: Db, userId: string, weekStart: string, now = new Date()) {
  const { tz } = await personTz(db, userId);
  const { start, end } = weekBounds(weekStart, tz);
  const entries = await db.select().from(timeEntries).where(and(eq(timeEntries.userId, userId), gte(timeEntries.clockIn, start), lt(timeEntries.clockIn, end))).orderBy(asc(timeEntries.clockIn));
  const breaks = entries.length ? await db.select().from(timeBreaks).where(inArray(timeBreaks.entryId, entries.map((e) => e.id))).orderBy(asc(timeBreaks.startsAt)) : [];
  const rows = entries.map((e) => {
    const stop = new Date(Math.min((e.clockOut ?? now).getTime(), e.clockIn.getTime() + MAX_ENTRY_HOURS * HOUR));
    const mine = breaks.filter((b) => b.entryId === e.id);
    const breakMs = mine.reduce((a, b) => a + Math.max(0, Math.min((b.endsAt ?? stop).getTime(), stop.getTime()) - b.startsAt.getTime()), 0);
    return { entry: e, breaks: mine, hours: Math.max(0, stop.getTime() - e.clockIn.getTime() - breakMs) / HOUR, open: !e.clockOut };
  });
  return { tz, weekStart, start, end, rows, hours: rows.reduce((a, r) => a + r.hours, 0), sheet: await sheetFor(db, userId, weekStart) };
}

/** The person submits their week; an open entry in it has to be closed first. */
export async function submitWeek(db: Db, practiceId: string, userId: string, weekStart: string, note: string, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart) || weekStartOf(weekStart) !== weekStart) throw new Error("Choose a week");
  const w = await weekOf(db, userId, weekStart, now);
  if (w.start.getTime() > now.getTime()) throw new Error("This week has not started");
  if (w.sheet) throw new Error(w.sheet.status === "approved" ? "This week is already approved" : "This week is already submitted");
  if (w.rows.some((r) => r.open)) throw new Error("Clock out first: an entry in this week is still open");
  const [row] = await db.insert(timesheets).values({ practiceId, userId, weekStart, hours: Math.round(w.hours * 100) / 100, note: note.trim().slice(0, 300) || null, submittedAt: now }).returning();
  const { name } = await personTz(db, userId);
  await notify(db, practiceId, { kind: "timesheet", title: `${name} submitted the timesheet for the week of ${weekStart} (${w.hours.toFixed(2)} hours)`, href: "/work/shifts/timesheets", dedupeKey: `sheet:${row.id}` });
  await db.insert(auditLog).values({ practiceId, userId, action: "timesheet_submitted", entity: "user", entityId: userId, details: { weekStart, hours: row.hours } });
  return row;
}

async function sheetRow(db: Db, practiceId: string, id: string) {
  const [s] = await db.select().from(timesheets).where(eq(timesheets.id, id)).limit(1);
  if (!s) throw new Error("Timesheet not found");
  await onTeam(db, practiceId, s.userId);
  return s;
}

export async function approveWeek(db: Db, practiceId: string, id: string, by: string, now = new Date()) {
  const s = await sheetRow(db, practiceId, id);
  notSelf(by, s.userId);
  if (s.status !== "submitted") throw new Error("Only a submitted timesheet can be approved");
  await db.update(timesheets).set({ status: "approved", approvedBy: by, approvedAt: now }).where(eq(timesheets.id, id));
  await notify(db, practiceId, { userId: s.userId, kind: "timesheet", title: `Your timesheet for the week of ${s.weekStart} was approved`, href: "/work/shifts", dedupeKey: `sheet-approved:${id}` });
  await db.insert(auditLog).values({ practiceId, userId: by, action: "timesheet_approved", entity: "user", entityId: s.userId, details: { weekStart: s.weekStart, hours: s.hours } });
}

/** An administrator reopens a week (approved or submitted); the person withdraws their own submitted week. */
export async function reopenWeek(db: Db, practiceId: string, id: string, by: string, isAdmin: boolean, reason: string) {
  const s = await sheetRow(db, practiceId, id);
  if (isAdmin && by !== s.userId) {
    const why = reasonOf(reason);
    await db.delete(timesheets).where(eq(timesheets.id, id));
    await notify(db, practiceId, { userId: s.userId, kind: "timesheet", title: `Your timesheet for the week of ${s.weekStart} was reopened`, body: why, href: "/work/shifts", dedupeKey: `sheet-reopened:${id}` });
    await db.insert(auditLog).values({ practiceId, userId: by, action: "timesheet_reopened", entity: "user", entityId: s.userId, details: { weekStart: s.weekStart, was: s.status, reason: why } });
    return;
  }
  if (s.userId !== by || s.status !== "submitted") throw new Error(s.userId === by ? "Ask another administrator to reopen your approved week" : "Not allowed");
  await db.delete(timesheets).where(eq(timesheets.id, id));
  await db.insert(auditLog).values({ practiceId, userId: by, action: "timesheet_withdrawn", entity: "user", entityId: s.userId, details: { weekStart: s.weekStart } });
}

/**
 * Before clocking in: an approved week takes no more time (an administrator
 * reopens it), and a submitted one goes back to the person to submit again.
 */
export async function weekOpenForClock(db: Db, userId: string, at = new Date()) {
  const { tz } = await personTz(db, userId);
  const s = await sheetFor(db, userId, weekOfMoment(at, tz));
  if (s?.status === "approved") throw new Error("This week's timesheet is already approved. Ask an administrator to reopen it before clocking in.");
  if (s?.status === "submitted") {
    await db.delete(timesheets).where(eq(timesheets.id, s.id));
    return { withdrawn: true };
  }
  return { withdrawn: false };
}

/** Submitted timesheets of the practice's team, waiting for approval. */
export async function sheetsAwaiting(db: Db, practiceId: string) {
  const ids = (await assignableUsers(db, practiceId, { includeDisabled: true })).map((u) => u.id);
  if (!ids.length) return [];
  return db.select({ s: timesheets, name: users.name }).from(timesheets).innerJoin(users, eq(users.id, timesheets.userId))
    .where(and(inArray(timesheets.userId, ids), eq(timesheets.status, "submitted"))).orderBy(asc(timesheets.weekStart)).limit(100);
}

/** Approved weeks per person among the given weeks. */
export async function approvedWeeks(db: Db, userIds: string[], weekStarts: string[]) {
  if (!userIds.length || !weekStarts.length) return [];
  return db.select({ userId: timesheets.userId, weekStart: timesheets.weekStart }).from(timesheets)
    .where(and(inArray(timesheets.userId, userIds), inArray(timesheets.weekStart, weekStarts), eq(timesheets.status, "approved")));
}

/** Recent weeks that are not submitted yet, for the person's reminder. */
export async function unsubmittedWeeks(db: Db, userId: string, now = new Date(), weeks = 4) {
  const { tz } = await personTz(db, userId);
  const thisWeek = weekStartOf(localClock(now, tz).date);
  const out: string[] = [];
  for (let k = 1; k <= weeks; k++) {
    const w = addDays(thisWeek, -7 * k);
    const { start, end } = weekBounds(w, tz);
    const [any] = await db.select({ id: timeEntries.id }).from(timeEntries).where(and(eq(timeEntries.userId, userId), gte(timeEntries.clockIn, start), lt(timeEntries.clockIn, end))).limit(1);
    if (any && !(await sheetFor(db, userId, w))) out.push(w);
  }
  return out;
}

