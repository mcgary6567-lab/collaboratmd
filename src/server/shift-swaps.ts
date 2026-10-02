/**
 * Shift swaps. A biller offers one of their upcoming shifts to a teammate;
 * the teammate accepts; an administrator (not one of the two) approves. On
 * approval the shift's hours are cancelled for the first person and added for
 * the second, as real moments, so it works across time zones: a Manila night
 * shift taken by someone in Karachi covers the same hours on their clock.
 */
import { and, desc, eq, inArray, or } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { availability, shiftOccurrences } from "./shifts";
import { assignableUsers } from "./work";
import { notify } from "./notifications";

const { shiftSwaps, shiftChanges, users, auditLog } = schema;
const OPEN = ["requested", "accepted"];

/** A person's own upcoming shifts that can be offered: not already offered in an open swap. */
export async function offerableShifts(db: Db, userId: string, now = new Date(), days = 21) {
  const a = (await availability(db, [userId], now)).get(userId);
  if (!a) return [];
  const open = await db.select().from(shiftSwaps).where(and(eq(shiftSwaps.requesterId, userId), inArray(shiftSwaps.status, OPEN)));
  return shiftOccurrences(a.shifts, now, a.tz, days, a.timeOff, a.holidays, a.changes)
    .filter((o) => o.startsAt.getTime() > now.getTime() && !open.some((s) => s.startsAt.getTime() === o.startsAt.getTime()));
}

export async function requestSwap(db: Db, practiceId: string, requesterId: string, input: { startsAt: string; takerId: string; note?: string }, now = new Date()) {
  const start = new Date(input.startsAt);
  const shift = (await offerableShifts(db, requesterId, now)).find((o) => o.startsAt.getTime() === start.getTime());
  if (!shift) throw new Error("Choose one of your upcoming shifts");
  if (input.takerId === requesterId) throw new Error("Choose a teammate");
  const team = await assignableUsers(db, practiceId);
  if (!team.some((t) => t.id === input.takerId)) throw new Error("That person is not on this practice's team");
  const [row] = await db.insert(shiftSwaps).values({ practiceId, requesterId, takerId: input.takerId, startsAt: shift.startsAt, endsAt: shift.endsAt, note: input.note?.trim().slice(0, 300) || null }).returning();
  const [me] = await db.select({ name: users.name }).from(users).where(eq(users.id, requesterId)).limit(1);
  await notify(db, practiceId, { userId: input.takerId, kind: "shift_swap", title: `${me?.name ?? "A teammate"} asked you to take a shift`, body: input.note?.trim() || undefined, href: "/work/shifts", dedupeKey: `swap:${row.id}` });
  await db.insert(auditLog).values({ practiceId, userId: requesterId, action: "shift_swap_requested", entity: "user", entityId: input.takerId, details: { swapId: row.id, startsAt: shift.startsAt.toISOString() } });
  return row;
}

async function ownSwap(db: Db, practiceId: string, id: string) {
  const [s] = await db.select().from(shiftSwaps).where(and(eq(shiftSwaps.id, id), eq(shiftSwaps.practiceId, practiceId))).limit(1);
  if (!s) throw new Error("Swap not found");
  return s;
}

/** The teammate accepts or declines. */
export async function respondSwap(db: Db, practiceId: string, id: string, userId: string, accept: boolean) {
  const s = await ownSwap(db, practiceId, id);
  if (s.takerId !== userId) throw new Error("Only the person asked can answer");
  if (s.status !== "requested") throw new Error("This swap was already answered");
  await db.update(shiftSwaps).set({ status: accept ? "accepted" : "declined" }).where(eq(shiftSwaps.id, id));
  await notify(db, practiceId, { userId: s.requesterId, kind: "shift_swap", title: `Your shift swap was ${accept ? "accepted, and waits for approval" : "declined"}`, href: "/work/shifts", dedupeKey: `swap-answer:${id}` });
  if (accept) await notify(db, practiceId, { kind: "shift_swap", title: "A shift swap waits for approval", href: "/work/shifts/manage", dedupeKey: `swap-approve:${id}` });
}

/** An administrator, not one of the two, approves or denies an accepted swap. */
export async function decideSwap(db: Db, practiceId: string, id: string, by: string, approve: boolean, now = new Date()) {
  const s = await ownSwap(db, practiceId, id);
  if (s.status !== "accepted") throw new Error("Only an accepted swap can be decided");
  if (by === s.requesterId || by === s.takerId) throw new Error("Someone not in the swap approves it");
  await db.update(shiftSwaps).set({ status: approve ? "approved" : "denied", decidedBy: by, decidedAt: now }).where(eq(shiftSwaps.id, id));
  if (approve) {
    const [r] = await db.select({ practiceId: users.practiceId }).from(users).where(eq(users.id, s.requesterId)).limit(1);
    const [t] = await db.select({ practiceId: users.practiceId }).from(users).where(eq(users.id, s.takerId)).limit(1);
    await db.insert(shiftChanges).values([
      { practiceId: r?.practiceId ?? practiceId, userId: s.requesterId, kind: "cancel", startsAt: s.startsAt, endsAt: s.endsAt, swapId: s.id },
      { practiceId: t?.practiceId ?? practiceId, userId: s.takerId, kind: "extra", startsAt: s.startsAt, endsAt: s.endsAt, swapId: s.id },
    ]);
  }
  for (const userId of [s.requesterId, s.takerId]) await notify(db, practiceId, { userId, kind: "shift_swap", title: `A shift swap was ${approve ? "approved" : "denied"}`, href: "/work/shifts", dedupeKey: `swap-decided:${id}:${userId}` });
  await db.insert(auditLog).values({ practiceId, userId: by, action: approve ? "shift_swap_approved" : "shift_swap_denied", entity: "user", entityId: s.requesterId, details: { swapId: id, takerId: s.takerId } });
}

/** The person who asked withdraws a swap that is not decided yet. */
export async function cancelSwap(db: Db, practiceId: string, id: string, userId: string) {
  const s = await ownSwap(db, practiceId, id);
  if (s.requesterId !== userId) throw new Error("Only the person who asked can withdraw it");
  if (!OPEN.includes(s.status)) throw new Error("This swap is already decided");
  await db.update(shiftSwaps).set({ status: "cancelled" }).where(eq(shiftSwaps.id, id));
}

/** Swaps involving a person, and (for administrators) every swap waiting for approval. */
export async function swapsFor(db: Db, practiceId: string, userId: string) {
  const rows = await db.select().from(shiftSwaps)
    .where(and(eq(shiftSwaps.practiceId, practiceId), or(eq(shiftSwaps.requesterId, userId), eq(shiftSwaps.takerId, userId), eq(shiftSwaps.status, "accepted"))))
    .orderBy(desc(shiftSwaps.createdAt)).limit(100);
  const ids = [...new Set(rows.flatMap((r) => [r.requesterId, r.takerId]))];
  const names = new Map((ids.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids)) : []).map((u) => [u.id, u.name]));
  return rows.map((r) => ({ ...r, requester: names.get(r.requesterId) ?? "", taker: names.get(r.takerId) ?? "" }));
}
