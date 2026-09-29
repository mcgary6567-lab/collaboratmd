/**
 * Prompt-pay interest. Most states require commercial insurers to pay a clean
 * claim within a set number of days and to add interest when they are late.
 * The days and rate differ by state and change, so the practice enters its
 * own state's statute (with the citation); nothing is assumed here.
 *
 * Counted from the day the claim was submitted to the first insurance payment
 * posted, as simple interest on what was paid. The statute may count from the
 * payer's receipt, treat electronic and paper claims differently, or exempt
 * self-funded (ERISA) plans, which are not subject to state law: check before
 * asking. Medicare and Medicaid pay their own interest and are left out.
 */
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { isUsState } from "@/lib/us";

const { promptPayRules, promptPayRequests, payers, practices, auditLog } = schema;

export async function savePromptPayRule(db: Db, practiceId: string, input: { state: string; days: number; annualRatePct: number; citation?: string }, userId?: string) {
  const state = input.state.trim().toUpperCase();
  if (!isUsState(state)) throw new Error("Choose the state");
  if (!Number.isInteger(input.days) || input.days < 1 || input.days > 365) throw new Error("Enter the number of days the statute allows, 1 to 365");
  if (!(input.annualRatePct > 0 && input.annualRatePct <= 50)) throw new Error("Enter the yearly interest rate as a percent, for example 12");
  const citation = input.citation?.trim().slice(0, 200) || null;
  await db.insert(promptPayRules).values({ practiceId, state, days: input.days, annualRatePct: input.annualRatePct, citation })
    .onConflictDoUpdate({ target: [promptPayRules.practiceId, promptPayRules.state], set: { days: input.days, annualRatePct: input.annualRatePct, citation } });
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "prompt_pay_rule_saved", entity: "practice", entityId: practiceId, details: { state, days: input.days, rate: input.annualRatePct } });
}

export async function deletePromptPayRule(db: Db, practiceId: string, state: string) {
  await db.delete(promptPayRules).where(and(eq(promptPayRules.practiceId, practiceId), eq(promptPayRules.state, state)));
}

export async function listPromptPayRules(db: Db, practiceId: string) {
  return db.select().from(promptPayRules).where(eq(promptPayRules.practiceId, practiceId)).orderBy(promptPayRules.state);
}

/** Pure: simple interest on a late payment. */
export function promptPayInterest(paidCents: number, daysLate: number, annualRatePct: number) {
  return daysLate > 0 && paidCents > 0 ? Math.round((paidCents * annualRatePct * daysLate) / (100 * 365)) : 0;
}

export type LatePayment = {
  claimId: string; controlNumber: string; payerId: string; payerName: string; patientName: string; memberId: string; payerClaimNumber: string | null;
  submittedOn: string; paidOn: string; paidCents: number; daysToPay: number; daysLate: number; interestCents: number; state: string; citation: string | null; requestedOn: string | null;
};

/** Commercial claims paid in the last year later than the practice's state allows, with the interest owed. */
export async function latePayments(db: Db, practiceId: string, now = new Date()): Promise<LatePayment[]> {
  const [practice] = await db.select().from(practices).where(eq(practices.id, practiceId)).limit(1);
  if (!practice) return [];
  const [rule] = await db.select().from(promptPayRules).where(and(eq(promptPayRules.practiceId, practiceId), eq(promptPayRules.state, practice.state))).limit(1);
  if (!rule) return [];
  const since = new Date(now.getTime() - 365 * 86_400_000).toISOString().slice(0, 10);
  const { rows } = await db.execute<Record<string, string | null>>(sql`
    WITH paid AS (
      SELECT claim_id, min(posted_at)::date AS first_paid,
        (COALESCE(sum(amount_cents) FILTER (WHERE type = 'insurance_payment'), 0) - COALESCE(sum(amount_cents) FILTER (WHERE type = 'reversal'), 0))::bigint AS paid_cents
      FROM ledger_entries WHERE practice_id = ${practiceId} AND claim_id IS NOT NULL AND type IN ('insurance_payment', 'reversal')
      GROUP BY claim_id
    )
    SELECT c.id, c.control_number, c.payer_id, py.name AS payer, pt.first_name || ' ' || pt.last_name AS patient, pi.member_id, c.payer_claim_number,
      c.submitted_at::date::text AS submitted, paid.first_paid::text AS paid_on, paid.paid_cents::text AS paid_cents,
      (paid.first_paid - c.submitted_at::date)::text AS days, r.requested_on::text AS requested
    FROM claims c
    JOIN paid ON paid.claim_id = c.id
    JOIN payers py ON py.id = c.payer_id
    JOIN patients pt ON pt.id = c.patient_id
    JOIN patient_insurances pi ON pi.id = c.patient_insurance_id
    LEFT JOIN prompt_pay_requests r ON r.claim_id = c.id
    WHERE c.practice_id = ${practiceId} AND py.type = 'commercial' AND c.submitted_at IS NOT NULL
      AND paid.first_paid >= ${since} AND paid.paid_cents > 0
      AND (paid.first_paid - c.submitted_at::date) > ${rule.days}
    ORDER BY paid.first_paid DESC LIMIT 500`);
  return rows.map((r) => {
    const daysToPay = Number(r.days);
    const daysLate = daysToPay - rule.days;
    const paidCents = Number(r.paid_cents);
    return {
      claimId: r.id!, controlNumber: r.control_number!, payerId: r.payer_id!, payerName: r.payer!, patientName: r.patient!, memberId: r.member_id!, payerClaimNumber: r.payer_claim_number,
      submittedOn: r.submitted!, paidOn: r.paid_on!, paidCents, daysToPay, daysLate, interestCents: promptPayInterest(paidCents, daysLate, rule.annualRatePct),
      state: rule.state, citation: rule.citation, requestedOn: r.requested,
    };
  });
}

/** Late payments by payer, for the ones not yet asked about. */
export async function interestByPayer(db: Db, practiceId: string, now = new Date()) {
  const late = (await latePayments(db, practiceId, now)).filter((l) => !l.requestedOn && l.interestCents >= 100);
  const groups = new Map<string, { payerId: string; payerName: string; count: number; cents: number }>();
  for (const l of late) {
    const g = groups.get(l.payerId) ?? { payerId: l.payerId, payerName: l.payerName, count: 0, cents: 0 };
    g.count++;
    g.cents += l.interestCents;
    groups.set(l.payerId, g);
  }
  return [...groups.values()].sort((a, b) => b.cents - a.cents);
}

const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The letter asking one payer for the interest on its late claims not yet asked about. */
export async function interestLetter(db: Db, practiceId: string, payerId: string, now = new Date()) {
  const [payer] = await db.select().from(payers).where(and(eq(payers.id, payerId), eq(payers.practiceId, practiceId))).limit(1);
  if (!payer) throw new Error("Payer not found");
  const [practice] = await db.select().from(practices).where(eq(practices.id, practiceId)).limit(1);
  const claims = (await latePayments(db, practiceId, now)).filter((l) => l.payerId === payerId && !l.requestedOn && l.interestCents >= 100);
  const total = claims.reduce((a, c) => a + c.interestCents, 0);
  const date = now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const first = claims[0];
  const body = claims.map((c, i) => `${i + 1}. Claim ${c.controlNumber}${c.payerClaimNumber ? ` (payer claim ${c.payerClaimNumber})` : ""}, ${c.patientName}, member ID ${c.memberId}: submitted ${c.submittedOn}, paid ${c.paidOn} (${c.daysToPay} days, ${c.daysLate} past the limit); paid ${usd(c.paidCents)}; interest ${usd(c.interestCents)}.`).join("\n");
  const text = claims.length ? `${practice.name}
${practice.address1}, ${practice.city}, ${practice.state} ${practice.zip}
NPI ${practice.npi} · Tax ID ${practice.taxId}

${date}

${payer.name}
Attn: Claims Payment / Provider Disputes

Re: Interest due on late payment of clean claims under ${first.state} law${first.citation ? ` (${first.citation})` : ""}

The claims below were paid more than the ${first.daysToPay - first.daysLate} days that ${first.state} law allows for payment of a clean claim. The statute requires interest on each late payment. We calculated simple interest at the statutory rate on the amount paid, for each day past the limit:

${body}

Total interest due: ${usd(total)}.

Please remit the interest, or tell us in writing why a claim was not a clean claim or is not subject to this statute.

Sincerely,

[Name, title]
${practice.name}${practice.phone ? `\n${practice.phone}` : ""}` : "";
  return { payer, claims, total, text };
}

/** Records that the interest on these claims was asked for, so the next letter does not repeat them. */
export async function markInterestRequested(db: Db, practiceId: string, payerId: string, userId?: string, now = new Date()) {
  const { claims } = await interestLetter(db, practiceId, payerId, now);
  const today = now.toISOString().slice(0, 10);
  if (claims.length) await db.insert(promptPayRequests).values(claims.map((c) => ({ claimId: c.claimId, practiceId, daysLate: c.daysLate, interestCents: c.interestCents, requestedOn: today }))).onConflictDoNothing();
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "prompt_pay_requested", entity: "payer", entityId: payerId, details: { claims: claims.length, cents: claims.reduce((a, c) => a + c.interestCents, 0) } });
  return claims.length;
}
