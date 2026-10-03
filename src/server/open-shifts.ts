/**
 * Open shifts: an administrator posts hours nobody covers (the red hours on
 * Team week), anyone on the team can claim them, and an administrator (not
 * the one claiming) confirms. Confirmed hours become extra hours on the
 * person's schedule, as real moments, the same way a swap's do, so they show
 * on Team week, count for coverage and get clock reminders.
 */
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { availability, minutesOf, shiftOccurrences, subtractWindows, zonedMoment } from "./shifts";
import { assignableUsers } from "./work";
import { notify } from "./notifications";

const { openShifts, shiftChanges, users, auditLog } = schema;
const HM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const when = (d: Date, tz: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(d);

async function row(db: Db, practiceId: string, id: string) {
  const [s] = await db.select().from(openShifts).where(and(eq(openShifts.id, id), eq(openShifts.practiceId, practiceId))).limit(1);
  if (!s) throw new Error("Open shift not found");
  return s;
}

/** Posts hours on a date, in the time zone given (the administrator's own); 21:00 to 06:00 runs past midnight. */
export async function postOpenShift(db: Db, practiceId: string, by: string, input: { date: string; from: string; to: string; note?: string }, tz: string, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error("Enter the date");
  if (!HM.test(input.from) || !HM.test(input.to) || input.from === input.to) throw new Error("Enter the hours, for example 21:00 to 06:00");
  const startsAt = zonedMoment(input.date, input.from, tz);
  const endsAt = zonedMoment(minutesOf(input.to) > minutesOf(input.from) ? input.date : addDays(input.date, 1), input.to, tz);
  if (startsAt.getTime() <= now.getTime()) throw new Error("The shift has to start in the future");
  const [s] = await db.insert(openShifts).values({ practiceId, startsAt, endsAt, note: input.note?.trim().slice(0, 300) || null, createdBy: by }).returning();
  for (const u of await assignableUsers(db, practiceId)) {
    if (u.id === by) continue;
    await notify(db, practiceId, { userId: u.id, kind: "open_shift", title: `Open shift: ${when(startsAt, tz)}, anyone can claim it`, body: s.note ?? undefined, href: "/work/shifts/week", dedupeKey: `open-shift:${s.id}:${u.id}` });
  }
  await db.insert(auditLog).values({ practiceId, userId: by, action: "open_shift_posted", entity: "practice", entityId: practiceId, details: { openShiftId: s.id, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() } });
  return s;
}

/** Someone on the team claims an open shift that does not clash with their own hours. */
export async function claimOpenShift(db: Db, practiceId: string, id: string, userId: string, now = new Date()) {
  const s = await row(db, practiceId, id);
  if (s.status !== "open") throw new Error("Someone has already claimed this shift");
  if (s.startsAt.getTime() <= now.getTime()) throw new Error("This shift has started");
  if (!(await assignableUsers(db, practiceId)).some((u) => u.id === userId)) throw new Error("Only people on this practice's team can claim it");
  const a = (await availability(db, [userId], now)).get(userId);
  if (a) {
    const mine = subtractWindows([
      ...shiftOccurrences(a.shifts, now, a.tz, 21, a.timeOff, a.holidays, a.changes),
      ...a.changes.filter((c) => c.kind === "extra").map((c) => ({ startsAt: c.startsAt, endsAt: c.endsAt })),
    ], a.changes.filter((c) => c.kind === "cancel"));
    if (mine.some((m) => m.startsAt < s.endsAt && m.endsAt > s.startsAt)) throw new Error("You already work some of those hours");
  }
  await db.update(openShifts).set({ status: "claimed", claimedBy: userId, claimedAt: now }).where(eq(openShifts.id, id));
  const [me] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
  await notify(db, practiceId, { kind: "open_shift", title: `${me?.name ?? "Someone"} claimed an open shift: confirm it`, href: "/work/shifts/week", dedupeKey: `open-shift-claim:${id}:${userId}` });
}

/** An administrator, not the one who claimed it, confirms (the hours go on their schedule) or turns down the claim. */
export async function decideOpenShift(db: Db, practiceId: string, id: string, by: string, approve: boolean, now = new Date()) {
  const s = await row(db, practiceId, id);
  if (s.status !== "claimed" || !s.claimedBy) throw new Error("Nobody has claimed this shift");
  if (s.claimedBy === by) throw new Error("Another administrator confirms a shift you claimed");
  if (approve) {
    const [u] = await db.select({ practiceId: users.practiceId }).from(users).where(eq(users.id, s.claimedBy)).limit(1);
    await db.insert(shiftChanges).values({ practiceId: u?.practiceId ?? practiceId, userId: s.claimedBy, kind: "extra", startsAt: s.startsAt, endsAt: s.endsAt, openShiftId: s.id });
    await db.update(openShifts).set({ status: "filled", decidedBy: by }).where(eq(openShifts.id, id));
  } else {
    await db.update(openShifts).set({ status: "open", claimedBy: null, claimedAt: null }).where(eq(openShifts.id, id));
  }
  await notify(db, practiceId, { userId: s.claimedBy, kind: "open_shift", title: approve ? "The shift you claimed is confirmed: it is on your schedule" : "Your claim on an open shift was turned down", href: "/work/shifts/week", dedupeKey: `open-shift-decided:${id}:${now.getTime()}` });
  await db.insert(auditLog).values({ practiceId, userId: by, action: approve ? "open_shift_filled" : "open_shift_claim_declined", entity: "user", entityId: s.claimedBy, details: { openShiftId: id } });
}

/** The person who claimed withdraws before it is confirmed. */
export async function unclaimOpenShift(db: Db, practiceId: string, id: string, userId: string) {
  const s = await row(db, practiceId, id);
  if (s.status !== "claimed" || s.claimedBy !== userId) throw new Error("You have not claimed this shift");
  await db.update(openShifts).set({ status: "open", claimedBy: null, claimedAt: null }).where(eq(openShifts.id, id));
}

/** An administrator takes it down; a confirmed one comes off the person's schedule. */
export async function cancelOpenShift(db: Db, practiceId: string, id: string, by: string) {
  const s = await row(db, practiceId, id);
  if (s.status === "cancelled") return;
  await db.delete(shiftChanges).where(eq(shiftChanges.openShiftId, id));
  await db.update(openShifts).set({ status: "cancelled", decidedBy: by }).where(eq(openShifts.id, id));
  if (s.claimedBy) await notify(db, practiceId, { userId: s.claimedBy, kind: "open_shift", title: "An open shift you claimed was cancelled", href: "/work/shifts/week", dedupeKey: `open-shift-cancelled:${id}` });
  await db.insert(auditLog).values({ practiceId, userId: by, action: "open_shift_cancelled", entity: "practice", entityId: practiceId, details: { openShiftId: id, was: s.status } });
}

/** Open shifts that have not ended, with who claimed them. */
export async function upcomingOpenShifts(db: Db, practiceId: string, now = new Date()) {
  const rows = await db.select().from(openShifts)
    .where(and(eq(openShifts.practiceId, practiceId), gt(openShifts.endsAt, now), inArray(openShifts.status, ["open", "claimed", "filled"])))
    .orderBy(asc(openShifts.startsAt)).limit(100);
  const ids = [...new Set(rows.map((r) => r.claimedBy).filter(Boolean) as string[])];
  const names = new Map((ids.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids)) : []).map((u) => [u.id, u.name]));
  return rows.map((r) => ({ ...r, claimer: r.claimedBy ? names.get(r.claimedBy) ?? "" : null }));
}
