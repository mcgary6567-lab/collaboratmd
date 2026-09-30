/**
 * Cost to collect: what the billing operation cost in a month as a share of
 * the cash it collected (one of HFMA's MAP Keys for the revenue cycle). The
 * practice enters its monthly costs by category; collection agency
 * commissions come from the agency recoveries already posted. Collections are
 * insurance and patient payments posted in the month, less refunds.
 */
import { and, asc, between, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";

const { billingCosts, auditLog } = schema;

export const COST_CATEGORIES: Record<string, string> = {
  staff: "Billing staff pay and benefits",
  billing_service: "Outside billing company or coders",
  software: "Billing software",
  clearinghouse: "Clearinghouse",
  card_fees: "Card processing fees",
  postage: "Statements and postage",
  eligibility: "Eligibility and estimate services",
  other: "Other",
};
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function saveCosts(db: Db, practiceId: string, month: string, values: Record<string, number>, userId?: string) {
  if (!MONTH.test(month)) throw new Error("Choose the month");
  const entries = Object.entries(values).filter(([k]) => COST_CATEGORIES[k]);
  for (const [, v] of entries) if (!Number.isInteger(v) || v < 0 || v > 100_000_000) throw new Error("Enter each cost in dollars");
  for (const [category, cents] of entries) {
    if (cents === 0) {
      await db.delete(billingCosts).where(and(eq(billingCosts.practiceId, practiceId), eq(billingCosts.month, month), eq(billingCosts.category, category)));
      continue;
    }
    await db.insert(billingCosts).values({ practiceId, month, category, cents, createdBy: userId ?? null })
      .onConflictDoUpdate({ target: [billingCosts.practiceId, billingCosts.month, billingCosts.category], set: { cents, createdBy: userId ?? null, updatedAt: new Date() } });
  }
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "billing_costs_saved", entity: "practice", entityId: practiceId, details: { month, total: entries.reduce((a, [, v]) => a + v, 0) } });
}

/** The months from `from` to `to` (YYYY-MM), inclusive. */
export function monthsBetween(from: string, to: string) {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  while ((y < ty || (y === ty && m <= tm)) && out.length < 60) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

export async function costToCollect(db: Db, practiceId: string, from: string, to: string) {
  if (!MONTH.test(from) || !MONTH.test(to) || from > to) throw new Error("Choose the months");
  const months = monthsBetween(from, to);
  const start = `${from}-01`;
  const [ty, tm] = to.split("-").map(Number);
  const end = tm === 12 ? `${ty + 1}-01-01` : `${ty}-${String(tm + 1).padStart(2, "0")}-01`;
  const [costs, { rows: cash }, { rows: agency }] = await Promise.all([
    db.select().from(billingCosts).where(and(eq(billingCosts.practiceId, practiceId), between(billingCosts.month, from, to))).orderBy(asc(billingCosts.month)),
    db.execute<{ month: string; cents: string }>(sql`
      SELECT to_char(posted_at, 'YYYY-MM') AS month,
        (COALESCE(sum(amount_cents) FILTER (WHERE type IN ('insurance_payment', 'patient_payment')), 0) - COALESCE(sum(amount_cents) FILTER (WHERE type = 'refund'), 0))::text AS cents
      FROM ledger_entries WHERE practice_id = ${practiceId} AND posted_at >= ${start} AND posted_at < ${end} GROUP BY 1`),
    db.execute<{ month: string; cents: string }>(sql`
      SELECT to_char(received_on, 'YYYY-MM') AS month, sum(commission_cents)::text AS cents
      FROM agency_recoveries WHERE practice_id = ${practiceId} AND received_on >= ${start} AND received_on < ${end} GROUP BY 1`),
  ]);
  const collected = new Map(cash.map((r) => [r.month, Number(r.cents)]));
  const commissions = new Map(agency.map((r) => [r.month, Number(r.cents)]));
  const rows = months.map((month) => {
    const byCategory: Record<string, number> = {};
    for (const c of costs.filter((x) => x.month === month)) byCategory[c.category] = c.cents;
    const agencyCents = commissions.get(month) ?? 0;
    const costCents = Object.values(byCategory).reduce((a, v) => a + v, 0) + agencyCents;
    const collectedCents = collected.get(month) ?? 0;
    return { month, byCategory, agencyCents, costCents, collectedCents, entered: Object.keys(byCategory).length > 0, pct: collectedCents > 0 && costCents > 0 ? costCents / collectedCents : null };
  });
  const entered = rows.filter((r) => r.entered);
  const cost = entered.reduce((a, r) => a + r.costCents, 0);
  const coll = entered.reduce((a, r) => a + r.collectedCents, 0);
  return { rows, overall: coll > 0 && cost > 0 ? cost / coll : null, monthsEntered: entered.length };
}
