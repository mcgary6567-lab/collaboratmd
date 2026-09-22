import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";

const { claims, payers, patients, denials } = schema;

/**
 * Denial worklist.
 *
 * Practice-scale data has tens of thousands of denials, so the page shows a
 * bounded slice while the totals come from an aggregate over the whole set.
 */
export async function listDenials(db: Db, practiceId: string, status?: string, limit = 100) {
  const where = status ? and(eq(denials.practiceId, practiceId), eq(denials.status, status)) : eq(denials.practiceId, practiceId);

  const [rows, totals, byCategory] = await Promise.all([
    db
      .select({ denial: denials, claim: claims, patient: patients, payer: payers })
      .from(denials)
      .innerJoin(claims, eq(claims.id, denials.claimId))
      .innerJoin(patients, eq(patients.id, claims.patientId))
      .innerJoin(payers, eq(payers.id, claims.payerId))
      .where(where)
      // Nearest appeal deadline first, then largest dollars.
      .orderBy(sql`${denials.appealDeadline} ASC NULLS LAST`, desc(denials.amountCents))
      .limit(limit),
    db
      .select({ n: sql<number>`count(*)`, amount: sql<number>`coalesce(sum(${denials.amountCents}),0)` })
      .from(denials)
      .where(where),
    db
      .select({ category: denials.category, n: sql<number>`count(*)` })
      .from(denials)
      .where(where)
      .groupBy(denials.category)
      .orderBy(desc(sql`count(*)`))
      .limit(8),
  ]);

  return {
    rows,
    total: Number(totals[0]?.n ?? 0),
    totalCents: Number(totals[0]?.amount ?? 0),
    categories: byCategory.map((c) => ({ category: String(c.category), count: Number(c.n) })),
    truncated: Number(totals[0]?.n ?? 0) > rows.length,
  };
}

export async function updateDenialStatus(db: Db, id: string, status: string) {
  await db
    .update(denials)
    .set({ status, resolvedAt: ["resolved", "written_off"].includes(status) ? new Date() : null })
    .where(eq(denials.id, id));
}
