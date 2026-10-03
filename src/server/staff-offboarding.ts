/**
 * When someone leaves a practice's team (deactivated there, or their access
 * from another practice removed), their work must not wait for them:
 *
 *  - they come off every work queue rule; a rule left with nobody is paused
 *    and the administrators are told;
 *  - their open tasks go to the others on the same rule (skipping anyone off
 *    today), or are left unassigned for an administrator to give out;
 *  - their open swaps and correction requests are withdrawn, a shift they
 *    claimed goes back to open, and (for their home practice) their time-off
 *    requests are declined;
 *  - an entry still clocked in is clocked out now.
 *
 * Their history stays: past tasks, hours, timesheets and pay.
 */
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { availability, MAX_ENTRY_HOURS } from "./shifts";
import { notify } from "./notifications";

const { workRules, tasks, staffTimeOff, shiftSwaps, timeCorrections, openShifts, timeEntries, timeBreaks, users, auditLog } = schema;

export async function offboard(db: Db, practiceId: string, userId: string, opts: { by?: string; home: boolean; now?: Date }) {
  const now = opts.now ?? new Date();
  const [person] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
  const name = person?.name ?? "A former team member";

  // Work queue rules.
  const rules = (await db.select().from(workRules).where(eq(workRules.practiceId, practiceId))).filter((r) => r.assigneeIds.includes(userId));
  const paused: string[] = [];
  for (const r of rules) {
    const left = r.assigneeIds.filter((id) => id !== userId);
    await db.update(workRules).set({ assigneeIds: left, nextIndex: left.length ? r.nextIndex % left.length : 0, ...(left.length ? {} : { active: false }) }).where(eq(workRules.id, r.id));
    if (!left.length) paused.push(r.name);
  }

  // Open tasks: to the others on the same rule, in turn, skipping anyone off today.
  const open = await db.select().from(tasks).where(and(eq(tasks.practiceId, practiceId), eq(tasks.assigneeId, userId), eq(tasks.status, "open")));
  const pools = new Map(rules.map((r) => [r.id, r.assigneeIds.filter((id) => id !== userId)]));
  const avail = await availability(db, [...new Set([...pools.values()].flat())], now);
  const turn = new Map<string, number>();
  let moved = 0, unassigned = 0;
  for (const t of open) {
    const pool = (t.ruleId ? pools.get(t.ruleId) : undefined) ?? [];
    const free = pool.filter((id) => !avail.get(id)?.offToday);
    const choices = free.length ? free : pool;
    const note = (to: string) => [t.note, `${to} (${name} left the team)`].filter(Boolean).join("\n");
    if (choices.length) {
      const i = turn.get(t.ruleId!) ?? 0;
      turn.set(t.ruleId!, i + 1);
      await db.update(tasks).set({ assigneeId: choices[i % choices.length], note: note("Reassigned") }).where(eq(tasks.id, t.id));
      moved++;
    } else {
      await db.update(tasks).set({ assigneeId: null, note: note("Unassigned") }).where(eq(tasks.id, t.id));
      unassigned++;
    }
  }

  // Requests that can no longer happen.
  const timeOff = opts.home
    ? (await db.update(staffTimeOff).set({ status: "denied", decidedBy: opts.by ?? null, decidedAt: now }).where(and(eq(staffTimeOff.userId, userId), eq(staffTimeOff.status, "requested"))).returning()).length
    : 0;
  const swaps = (await db.update(shiftSwaps).set({ status: "cancelled" })
    .where(and(eq(shiftSwaps.practiceId, practiceId), inArray(shiftSwaps.status, ["requested", "accepted"]), or(eq(shiftSwaps.requesterId, userId), eq(shiftSwaps.takerId, userId))))
    .returning()).length;
  await db.update(timeCorrections).set({ status: "cancelled" }).where(and(eq(timeCorrections.practiceId, practiceId), eq(timeCorrections.userId, userId), eq(timeCorrections.status, "requested")));
  await db.update(openShifts).set({ status: "open", claimedBy: null, claimedAt: null }).where(and(eq(openShifts.practiceId, practiceId), eq(openShifts.claimedBy, userId), eq(openShifts.status, "claimed")));

  // Still clocked in here: clock out now (at most the usual cap), closing an open break.
  const [entry] = await db.select().from(timeEntries).where(and(eq(timeEntries.practiceId, practiceId), eq(timeEntries.userId, userId), isNull(timeEntries.clockOut))).limit(1);
  if (entry) {
    const out = new Date(Math.min(now.getTime(), entry.clockIn.getTime() + MAX_ENTRY_HOURS * 3_600_000));
    await db.update(timeBreaks).set({ endsAt: out }).where(and(eq(timeBreaks.entryId, entry.id), isNull(timeBreaks.endsAt)));
    await db.update(timeEntries).set({ clockOut: out, note: [entry.note, "Clocked out when they left the team"].filter(Boolean).join(" ").slice(0, 200) }).where(eq(timeEntries.id, entry.id));
  }

  const summary = { rules: rules.length, paused: paused.length, moved, unassigned, timeOff, swaps, clockedOut: !!entry };
  await db.insert(auditLog).values({ practiceId, userId: opts.by ?? null, action: "user_offboarded", entity: "user", entityId: userId, details: summary });
  if (rules.length || open.length) {
    const parts = [
      moved ? `${moved} open task${moved === 1 ? "" : "s"} reassigned` : "",
      unassigned ? `${unassigned} left unassigned` : "",
      paused.length ? `paused (nobody left): ${paused.join(", ")}` : "",
    ].filter(Boolean);
    await notify(db, practiceId, { kind: "tasks", title: `${name} left the team: their work was handed over`, body: parts.join("; ") || "Taken off the work queues.", href: unassigned ? "/tasks" : "/work", dedupeKey: `offboard:${userId}:${now.getTime()}` });
  }
  return summary;
}
