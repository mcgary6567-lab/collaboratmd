/**
 * Daily targets per person: claims sent, payments and adjustments posted,
 * tasks done. Each person sees today's progress on their dashboard (today in
 * their own time zone); the hours report compares a period's work with the
 * target times the days they worked. Targets are the practice's to set: work
 * differs in difficulty, so they suit people doing the same kind of work.
 */
import { and, eq, gte, inArray, lt, ne } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { localClock, workedSpans, zonedMoment } from "./shifts";
import { personTz } from "./timesheets";
import { practiceTimeZone, validTimeZone } from "./practice-time";
import { assignableUsers } from "./work";

const { staffTargets, tasks, ledgerEntries, auditLog, users } = schema;
const DAY = 86_400_000;
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

export const METRICS: Record<string, string> = { claims: "Claims sent", postings: "Payments and adjustments posted", tasks: "Tasks done" };
type Done = { claims: number; postings: number; tasks: number };
const doneOf = (d: Done, metric: string) => (metric === "claims" ? d.claims : metric === "postings" ? d.postings : d.tasks);

/** Sets a person's targets; an empty value removes that target. */
export async function saveTargets(db: Db, practiceId: string, userId: string, values: Record<string, number | null>, by: string) {
  const [u] = await db.select({ practiceId: users.practiceId }).from(users).where(eq(users.id, userId)).limit(1);
  if (!u) throw new Error("Person not found");
  for (const [metric, perDay] of Object.entries(values)) {
    if (!METRICS[metric]) continue;
    if (perDay === null) {
      await db.delete(staffTargets).where(and(eq(staffTargets.userId, userId), eq(staffTargets.metric, metric)));
      continue;
    }
    if (!Number.isInteger(perDay) || perDay < 1 || perDay > 10_000) throw new Error(`${METRICS[metric]}: a whole number from 1 a day`);
    const set = { practiceId: u.practiceId, perDay, updatedBy: by, updatedAt: new Date() };
    await db.insert(staffTargets).values({ userId, metric, ...set }).onConflictDoUpdate({ target: [staffTargets.userId, staffTargets.metric], set });
  }
  await db.insert(auditLog).values({ practiceId, userId: by, action: "staff_targets_saved", entity: "user", entityId: userId, details: values });
}

export async function targetsFor(db: Db, userIds: string[]) {
  return userIds.length ? db.select().from(staffTargets).where(inArray(staffTargets.userId, userIds)) : [];
}

/** What each person did between two moments here: claims sent, payments and adjustments posted, tasks done. */
export async function workDone(db: Db, practiceId: string, userIds: string[], start: Date, end: Date) {
  if (!userIds.length) return [];
  const [sent, posted, done] = await Promise.all([
    db.selectDistinct({ userId: auditLog.userId, id: auditLog.entityId }).from(auditLog).where(and(eq(auditLog.practiceId, practiceId), eq(auditLog.action, "submit_claim"), inArray(auditLog.userId, userIds), gte(auditLog.at, start), lt(auditLog.at, end))),
    db.select({ userId: ledgerEntries.postedBy }).from(ledgerEntries).where(and(eq(ledgerEntries.practiceId, practiceId), inArray(ledgerEntries.postedBy, userIds), ne(ledgerEntries.type, "charge"), gte(ledgerEntries.postedAt, start), lt(ledgerEntries.postedAt, end))),
    db.select({ userId: tasks.assigneeId }).from(tasks).where(and(eq(tasks.practiceId, practiceId), inArray(tasks.assigneeId, userIds), eq(tasks.status, "done"), gte(tasks.completedAt, start), lt(tasks.completedAt, end))),
  ]);
  const count = (rows: { userId: string | null }[], id: string) => rows.filter((r) => r.userId === id).length;
  return userIds.map((id) => ({ userId: id, claims: count(sent, id), postings: count(posted, id), tasks: count(done, id) }));
}

/** Today's progress for one person, in their own day. */
export async function todayProgress(db: Db, practiceId: string, userId: string, now = new Date()) {
  const targets = await targetsFor(db, [userId]);
  if (!targets.length) return [];
  const { tz } = await personTz(db, userId);
  const today = localClock(now, tz).date;
  const [done] = await workDone(db, practiceId, [userId], zonedMoment(today, "00:00", tz), zonedMoment(addDays(today, 1), "00:00", tz));
  return targets.map((t) => ({ metric: t.metric, label: METRICS[t.metric] ?? t.metric, target: t.perDay, done: doneOf(done, t.metric) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * For a period: each person with targets, the days they worked (local days
 * with clocked time) and, per metric, what they did against the target times
 * those days.
 */
export async function targetAttainment(db: Db, practiceId: string, from: string, to: string, now = new Date()) {
  const team = (await assignableUsers(db, practiceId, { includeDisabled: true })).map((u) => u.id);
  if (!team.length) return [];
  const targets = await db.select().from(staffTargets).innerJoin(users, eq(users.id, staffTargets.userId)).where(inArray(staffTargets.userId, team));
  const ids = [...new Set(targets.map((t) => t.staff_targets.userId))];
  if (!ids.length) return [];
  const practiceTz = await practiceTimeZone(db, practiceId);
  const start = new Date(Date.parse(`${from}T00:00:00Z`) - DAY), end = new Date(Date.parse(`${to}T00:00:00Z`) + 2 * DAY);
  const spans = await workedSpans(db, practiceId, ids, start, end, now);
  const out = [];
  for (const id of ids) {
    const mine = targets.filter((t) => t.staff_targets.userId === id);
    const tzRaw = mine[0].users.timeZone;
    const tz = tzRaw && validTimeZone(tzRaw) ? tzRaw : practiceTz;
    const a = zonedMoment(from, "00:00", tz), b = zonedMoment(addDays(to, 1), "00:00", tz);
    // Every local day with clocked time counts, both days of a shift past midnight included.
    const dates = new Set<string>();
    for (const s of spans.filter((x) => x.userId === id && x.end > a && x.start < b)) {
      const last = localClock(new Date(Math.min(s.end.getTime(), b.getTime()) - 1), tz).date;
      for (let d = localClock(s.start < a ? a : s.start, tz).date; d <= last; d = addDays(d, 1)) dates.add(d);
    }
    const days = dates.size;
    const [done] = await workDone(db, practiceId, [id], a, b);
    out.push({
      userId: id, name: mine[0].users.name, days,
      metrics: mine.map((t) => {
        const goal = t.staff_targets.perDay * days;
        const did = doneOf(done, t.staff_targets.metric);
        return { metric: t.staff_targets.metric, label: METRICS[t.staff_targets.metric] ?? t.staff_targets.metric, perDay: t.staff_targets.perDay, goal, done: did, pct: goal ? did / goal : null };
      }),
    });
  }
  return out.sort((x, y) => x.name.localeCompare(y.name));
}
