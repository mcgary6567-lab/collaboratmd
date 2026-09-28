/** Backup restore tests, recorded by platform operators as evidence that backups work (docs/08-restore-drill.md). */
import { desc } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";

const { restoreTests } = schema;

export type RestoreTestInput = { testedAt: string; target: string; minutes?: number | null; result: "passed" | "failed"; notes?: string | null };

export async function recordRestoreTest(db: Db, input: RestoreTestInput, recordedBy: string) {
  const testedAt = new Date(input.testedAt);
  if (Number.isNaN(testedAt.getTime()) || testedAt > new Date()) throw new Error("Enter when the test ran");
  if (!["passed", "failed"].includes(input.result)) throw new Error("Choose the result");
  const target = input.target.trim().slice(0, 120);
  if (!target) throw new Error("Say what was restored (for example: production as of 1 hour earlier, to branch drill-2026-10-03)");
  const minutes = input.minutes === null || input.minutes === undefined || Number.isNaN(input.minutes) ? null : Math.max(0, Math.round(input.minutes));
  const [row] = await db.insert(restoreTests).values({ testedAt, target, minutes, result: input.result, notes: input.notes?.trim().slice(0, 500) || null, recordedBy }).returning();
  return row;
}

export async function listRestoreTests(db: Db, limit = 20) {
  return db.select().from(restoreTests).orderBy(desc(restoreTests.testedAt)).limit(limit);
}

export async function lastRestoreTest(db: Db) {
  const [r] = await listRestoreTests(db, 1);
  return r ?? null;
}
