/**
 * Deductible and out-of-pocket left, kept current between coverage checks.
 *
 * A coverage check (271) says how much of the deductible and out-of-pocket
 * maximum was left on the day it ran. Claims the payer processed after that
 * applied more: the deductible (PR 1) and the patient's share (PR 1, 2 and 3)
 * on each 835 line. Subtracting those gives an estimate of what is left now.
 * In a new calendar year the amounts start over from the plan's yearly
 * figures (most plans run on the calendar year; plans that do not are
 * corrected by the next coverage check).
 */
import { desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";

const { eligibilityChecks } = schema;

export type BenefitsToDate = {
  checkedOn: string;
  newPlanYear: boolean;
  deductibleRemainingCents: number | null;
  oopRemainingCents: number | null;
  appliedDeductibleCents: number;
  appliedOopCents: number;
};

export async function benefitsToDate(db: Db, patientInsuranceId: string, asOf = new Date().toISOString().slice(0, 10)): Promise<BenefitsToDate | null> {
  const [check] = await db.select().from(eligibilityChecks).where(eq(eligibilityChecks.patientInsuranceId, patientInsuranceId)).orderBy(desc(eligibilityChecks.checkedAt)).limit(1);
  if (!check || check.status !== "active") return null;
  const checkedOn = check.checkedAt.toISOString().slice(0, 10);
  const year = asOf.slice(0, 4);
  const newPlanYear = checkedOn.slice(0, 4) < year;
  // From the check (same year) or from January 1 (a new plan year), through the date asked about.
  const from = newPlanYear ? `${year}-01-01` : checkedOn;
  const { rows } = await db.execute<{ deductible: string; oop: string }>(sql`
    SELECT COALESCE(sum((a->>'amountCents')::int) FILTER (WHERE a->>'reason' = '1'), 0)::text AS deductible,
      COALESCE(sum((a->>'amountCents')::int) FILTER (WHERE a->>'reason' IN ('1', '2', '3')), 0)::text AS oop
    FROM remittance_lines rl
    JOIN claims c ON c.id = rl.claim_id
    CROSS JOIN LATERAL jsonb_array_elements(rl.adjustments) a
    WHERE c.patient_insurance_id = ${patientInsuranceId} AND a->>'group' = 'PR'
      AND rl.payment_date ${newPlanYear ? sql`>=` : sql`>`} ${from} AND rl.payment_date <= ${asOf}`);
  const appliedDeductibleCents = Number(rows[0]?.deductible ?? 0);
  const appliedOopCents = Number(rows[0]?.oop ?? 0);
  const startDeductible = newPlanYear ? check.deductibleCents : check.deductibleRemainingCents;
  const startOop = newPlanYear ? check.oopMaxCents : check.oopRemainingCents;
  return {
    checkedOn, newPlanYear, appliedDeductibleCents, appliedOopCents,
    deductibleRemainingCents: startDeductible === null ? null : Math.max(0, startDeductible - appliedDeductibleCents),
    oopRemainingCents: startOop === null ? null : Math.max(0, startOop - appliedOopCents),
  };
}
