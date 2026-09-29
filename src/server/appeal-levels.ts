/**
 * Appeal levels. An appeal the payer turns down can go to the next level, each
 * with its own deadline counted from the last decision. Medicare's five levels
 * and time limits are set in regulation (42 CFR 405 subpart I); for other
 * payers the usual path is shown, and the plan or contract decides.
 */
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";

const { appealLevels, denials, claims, payers, claimEvents, auditLog } = schema;

export type LevelSpec = { level: number; name: string; days: number };

export const MEDICARE_LEVELS: LevelSpec[] = [
  { level: 1, name: "Redetermination (by the Medicare contractor)", days: 120 },
  { level: 2, name: "Reconsideration (by a Qualified Independent Contractor)", days: 180 },
  { level: 3, name: "Hearing before an administrative law judge", days: 60 },
  { level: 4, name: "Review by the Medicare Appeals Council", days: 60 },
  { level: 5, name: "Judicial review in federal district court", days: 60 },
];

export const OTHER_LEVELS: LevelSpec[] = [
  { level: 1, name: "First-level appeal", days: 60 },
  { level: 2, name: "Second-level appeal", days: 60 },
  { level: 3, name: "External review", days: 120 },
];

export type Decision = "overturned" | "partial" | "upheld";

const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);

async function specsFor(db: Db, denialId: string) {
  const [row] = await db.select({ denial: denials, payerType: payers.type, appealDays: payers.appealDays }).from(denials)
    .innerJoin(claims, eq(claims.id, denials.claimId)).innerJoin(payers, eq(payers.id, claims.payerId)).where(eq(denials.id, denialId)).limit(1);
  if (!row) throw new Error("Denial not found");
  const specs = row.payerType === "medicare" ? MEDICARE_LEVELS : OTHER_LEVELS.map((s) => (s.level === 1 ? { ...s, days: row.appealDays } : s));
  return { denial: row.denial, specs, medicare: row.payerType === "medicare" };
}

/** The denial's appeal levels, starting the first one if there is none yet. */
export async function appealLevelsFor(db: Db, practiceId: string, denialId: string) {
  const existing = await db.select().from(appealLevels).where(and(eq(appealLevels.denialId, denialId), eq(appealLevels.practiceId, practiceId))).orderBy(asc(appealLevels.level));
  if (existing.length) return existing;
  const { denial, specs } = await specsFor(db, denialId);
  if (denial.practiceId !== practiceId) throw new Error("Denial not found");
  const [first] = await db.insert(appealLevels).values({ practiceId, denialId, level: 1, name: specs[0].name, dueOn: denial.appealDeadline ?? addDays(today(), specs[0].days) }).returning();
  return [first];
}

/** Marks the current level filed when the appeal letter goes out. */
export async function levelFiled(db: Db, practiceId: string, denialId: string, letterId: string, filedOn = today()) {
  const levels = await appealLevelsFor(db, practiceId, denialId);
  const current = levels.find((l) => !l.decision);
  if (current && !current.filedOn) await db.update(appealLevels).set({ filedOn, letterId }).where(eq(appealLevels.id, current.id));
}

/**
 * Records the payer's decision on a level. Overturned closes the denial; a
 * denial upheld (or only partly overturned) opens the next level, due the
 * number of days after this decision that the level allows.
 */
export async function recordAppealDecision(db: Db, practiceId: string, levelId: string, decision: Decision, decidedOn: string, userId?: string) {
  if (!["overturned", "partial", "upheld"].includes(decision)) throw new Error("Choose the payer's decision");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(decidedOn) || decidedOn > today()) throw new Error("Enter the date of the decision letter");
  const [level] = await db.select().from(appealLevels).where(and(eq(appealLevels.id, levelId), eq(appealLevels.practiceId, practiceId))).limit(1);
  if (!level) throw new Error("Appeal level not found");
  if (level.decision) throw new Error("This level already has a decision");
  await db.update(appealLevels).set({ decision, decidedOn }).where(eq(appealLevels.id, level.id));
  const { denial, specs } = await specsFor(db, level.denialId);
  const next = specs.find((s) => s.level === level.level + 1);
  let nextLevel: typeof appealLevels.$inferSelect | null = null;
  if (decision === "overturned") {
    await db.update(denials).set({ status: "resolved", resolvedAt: new Date() }).where(eq(denials.id, denial.id));
  } else if (next) {
    const dueOn = addDays(decidedOn, next.days);
    [nextLevel] = await db.insert(appealLevels).values({ practiceId, denialId: denial.id, level: next.level, name: next.name, dueOn }).returning();
    await db.update(denials).set({ status: "in_progress", appealDeadline: dueOn }).where(eq(denials.id, denial.id));
  } else {
    await db.update(denials).set({ status: "in_progress" }).where(eq(denials.id, denial.id));
  }
  const words = { overturned: "overturned the denial", partial: "partly overturned the denial", upheld: "upheld the denial" }[decision];
  await db.insert(claimEvents).values({ claimId: denial.claimId, status: decision === "overturned" ? "appeal_won" : "appeal_lost", source: "user", message: `Appeal level ${level.level} (${level.name}): the payer ${words}${nextLevel ? `. Next: ${nextLevel.name}, due ${nextLevel.dueOn}` : ""}` });
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "appeal_decision", entity: "denial", entityId: denial.id, details: { level: level.level, decision, decidedOn } });
  return { next: nextLevel };
}
