/**
 * Practice policies: billing rules an administrator sets, and the checks that
 * enforce them. Each rule is applied where the thing it governs happens:
 *
 *  - writeOffLimitCents: assertWriteOffAllowed, called before any write-off
 *  - strictScrub: blocksSubmission, used by rescrubClaim and submitClaim
 *  - riskHoldScore: submitClaim, for claims sent by a non-administrator
 *  - statementMinCents / statementIntervalDays: the statement batch defaults
 *  - smallBalanceCents / smallBalanceAgeDays: adjustSmallBalances, run daily
 *  - exportsAdminOnly: the CSV export and accounting journal routes
 *  - refundDualControl: approveRefund
 */
import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import type { PracticePolicies } from "@/db/schema";
import { hasBlockingErrors, type ScrubFinding } from "@/lib/scrub/rules";
import { patientBalanceSql } from "./billing";

const { practices, ledgerEntries, auditLog } = schema;

export const DEFAULT_POLICIES: Required<{ [K in keyof PracticePolicies]: NonNullable<PracticePolicies[K]> | null }> = {
  writeOffLimitCents: null,
  strictScrub: false,
  riskHoldScore: null,
  statementMinCents: 500,
  statementIntervalDays: 25,
  smallBalanceCents: null,
  smallBalanceAgeDays: 90,
  exportsAdminOnly: false,
  refundDualControl: false,
};

export async function getPolicies(db: Db, practiceId: string): Promise<PracticePolicies> {
  const [p] = await db.select({ policies: practices.policies }).from(practices).where(eq(practices.id, practiceId)).limit(1);
  return p?.policies ?? {};
}

export function validatePolicies(input: PracticePolicies): PracticePolicies {
  const cents = (v: number | null | undefined, max: number, label: string) => {
    if (v === null || v === undefined) return null;
    if (!Number.isInteger(v) || v < 0 || v > max) throw new Error(`${label} must be between $0 and $${(max / 100).toLocaleString("en-US")}`);
    return v;
  };
  const days = (v: number | undefined, min: number, max: number, label: string, fallback: number) => {
    if (v === undefined || Number.isNaN(v)) return fallback;
    if (!Number.isInteger(v) || v < min || v > max) throw new Error(`${label} must be ${min} to ${max} days`);
    return v;
  };
  const risk = input.riskHoldScore ?? null;
  if (risk !== null && (!Number.isInteger(risk) || risk < 1 || risk > 100)) throw new Error("The risk hold score is 1 to 100");
  return {
    writeOffLimitCents: cents(input.writeOffLimitCents, 100_000_000, "The write-off limit"),
    strictScrub: !!input.strictScrub,
    riskHoldScore: risk,
    statementMinCents: cents(input.statementMinCents, 1_000_000, "The statement minimum") ?? 500,
    statementIntervalDays: days(input.statementIntervalDays, 7, 90, "Days between statements", 25),
    smallBalanceCents: cents(input.smallBalanceCents, 10_000, "The small balance threshold"),
    smallBalanceAgeDays: days(input.smallBalanceAgeDays, 30, 730, "The small balance age", 90),
    exportsAdminOnly: !!input.exportsAdminOnly,
    refundDualControl: !!input.refundDualControl,
  };
}

export async function savePolicies(db: Db, practiceId: string, input: PracticePolicies, userId?: string) {
  const stored = await getPolicies(db, practiceId);
  // Compare like with like: unset values read as their defaults.
  let before: PracticePolicies;
  try { before = validatePolicies(stored); } catch { before = stored; }
  const policies = validatePolicies(input);
  await db.update(practices).set({ policies }).where(eq(practices.id, practiceId));
  const changed = Object.keys(policies).filter((k) => JSON.stringify(policies[k as keyof PracticePolicies] ?? null) !== JSON.stringify(before[k as keyof PracticePolicies] ?? null));
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "policies_changed", entity: "practice", entityId: practiceId, details: { changed, policies } });
  return policies;
}

/** Whether scrub findings stop a claim: errors always, warnings too under strict scrubbing. */
export function blocksSubmission(findings: ScrubFinding[], policies: PracticePolicies | null | undefined) {
  return hasBlockingErrors(findings) || (!!policies?.strictScrub && findings.some((f) => f.severity === "warning"));
}

export async function assertWriteOffAllowed(db: Db, practiceId: string, role: string, cents: number) {
  if (role === "admin") return;
  const limit = (await getPolicies(db, practiceId)).writeOffLimitCents;
  if (limit !== null && limit !== undefined && cents > limit) {
    throw new Error(`Write-offs over $${(limit / 100).toFixed(2)} need an administrator (this one is $${(cents / 100).toFixed(2)})`);
  }
}

/**
 * Adjusts off patient balances too small to be worth billing: above zero,
 * below the threshold, with nothing posted for the patient in `ageDays`.
 * Posted as a discount with a note, like any other adjustment.
 */
export async function adjustSmallBalances(db: Db, practiceId: string, opts: { now?: Date; userId?: string; limit?: number } = {}) {
  const policies = await getPolicies(db, practiceId);
  const threshold = policies.smallBalanceCents;
  if (!threshold) return { adjusted: 0, cents: 0 };
  const since = new Date((opts.now ?? new Date()).getTime() - (policies.smallBalanceAgeDays ?? 90) * 86_400_000);
  const { rows } = await db.execute<{ patient_id: string; balance: string }>(sql`
    SELECT patient_id, (${patientBalanceSql})::bigint::text AS balance FROM ledger_entries
    WHERE practice_id = ${practiceId}
    GROUP BY patient_id
    HAVING (${patientBalanceSql}) > 0 AND (${patientBalanceSql}) < ${threshold} AND max(posted_at) < ${since}
    LIMIT ${opts.limit ?? 1000}`);
  let cents = 0;
  for (const r of rows) {
    const amount = Number(r.balance);
    await db.insert(ledgerEntries).values({ practiceId, patientId: r.patient_id, type: "discount", amountCents: amount, note: `Small balance adjustment (under $${(threshold / 100).toFixed(2)}, practice policy)`, postedBy: opts.userId ?? null });
    cents += amount;
  }
  if (rows.length) await db.insert(auditLog).values({ practiceId, userId: opts.userId ?? null, action: "small_balances_adjusted", entity: "practice", entityId: practiceId, details: { patients: rows.length, cents } });
  return { adjusted: rows.length, cents };
}
