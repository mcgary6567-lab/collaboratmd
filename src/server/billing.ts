import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import type { EstimateLine, StatementVisit } from "@/db/schema";
import { buildSchedule, allocatePayment, addDays, GRACE_DAYS, DEFAULT_AFTER_MISSED } from "@/lib/billing/plans";
import { estimateInsured, estimateSelfPay } from "@/lib/billing/estimate";
import { contractRates, standardCharges } from "./fees";
import { runEligibility } from "./patients";

const {
  patients, patientInsurances, payers, ledgerEntries, claims, encounters, providers, charges, cptCodes, practices,
  discountPolicies, paymentPlans, paymentPlanInstallments, statements, estimates, eligibilityChecks,
} = schema;

const today = () => new Date().toISOString().slice(0, 10);

/* ------------------------------------------------------------------ */
/* Balances                                                             */
/* ------------------------------------------------------------------ */

/**
 * What the patient owes: responsibility transferred to them, less what they
 * paid and any discount granted, plus refunds sent back. Computed from the
 * ledger every time rather than stored, so it cannot drift from the entries
 * that justify it.
 */
export const patientBalanceSql = sql`
  COALESCE(SUM(amount_cents) FILTER (WHERE type = 'transfer_to_patient'), 0)
  - COALESCE(SUM(amount_cents) FILTER (WHERE type = 'patient_payment'), 0)
  - COALESCE(SUM(amount_cents) FILTER (WHERE type = 'discount'), 0)
  + COALESCE(SUM(amount_cents) FILTER (WHERE type = 'refund'), 0)`;

export async function patientBalanceCents(db: Db, patientId: string): Promise<number> {
  const r = await db.execute<{ bal: string }>(sql`SELECT (${patientBalanceSql})::bigint AS bal FROM ledger_entries WHERE patient_id = ${patientId}`);
  return Number(r.rows[0]?.bal ?? 0);
}

export async function patientsWithBalances(db: Db, practiceId: string, minCents = 1, limit = 100) {
  const r = await db.execute<{ patient_id: string; balance: string; first_name: string; last_name: string; mrn: string; last_statement: string | null }>(sql`
    SELECT b.patient_id, b.balance, p.first_name, p.last_name, p.mrn,
           (SELECT max(statement_date)::text FROM statements s WHERE s.patient_id = b.patient_id AND s.status <> 'void') AS last_statement
    FROM (
      SELECT patient_id, (${patientBalanceSql})::bigint AS balance
      FROM ledger_entries WHERE practice_id = ${practiceId}
      GROUP BY patient_id
    ) b
    JOIN patients p ON p.id = b.patient_id
    WHERE b.balance >= ${minCents}
    ORDER BY b.balance DESC
    LIMIT ${limit}
  `);
  return r.rows.map((x) => ({
    patientId: x.patient_id, balanceCents: Number(x.balance), firstName: x.first_name, lastName: x.last_name, mrn: x.mrn,
    lastStatement: x.last_statement,
  }));
}

/** Everything patients owe across the practice, and how many accounts carry it. */
export async function totalPatientBalances(db: Db, practiceId: string) {
  const r = await db.execute<{ total: string; accounts: string }>(sql`
    SELECT COALESCE(sum(balance), 0)::bigint AS total, count(*)::int AS accounts
    FROM (
      SELECT (${patientBalanceSql}) AS balance
      FROM ledger_entries WHERE practice_id = ${practiceId}
      GROUP BY patient_id
    ) b
    WHERE balance > 0
  `);
  return { totalCents: Number(r.rows[0]?.total ?? 0), accounts: Number(r.rows[0]?.accounts ?? 0) };
}

/* ------------------------------------------------------------------ */
/* Discounts                                                            */
/* ------------------------------------------------------------------ */

const DEFAULT_POLICIES = [
  { name: "Self-pay discount", kind: "self_pay", percent: 30 },
  { name: "Prompt-pay discount", kind: "prompt_pay", percent: 10 },
  { name: "Financial hardship", kind: "hardship", percent: 50 },
];

/** A practice starts with the three policies most practices publish. */
export async function ensureDefaultPolicies(db: Db, practiceId: string) {
  const existing = await db.select({ id: discountPolicies.id }).from(discountPolicies).where(eq(discountPolicies.practiceId, practiceId)).limit(1);
  if (existing.length) return;
  await db.insert(discountPolicies).values(DEFAULT_POLICIES.map((p) => ({ ...p, practiceId })));
}

export async function listPolicies(db: Db, practiceId: string, activeOnly = false) {
  return db
    .select()
    .from(discountPolicies)
    .where(activeOnly ? and(eq(discountPolicies.practiceId, practiceId), eq(discountPolicies.active, true)) : eq(discountPolicies.practiceId, practiceId))
    .orderBy(asc(discountPolicies.name));
}

export async function createPolicy(db: Db, practiceId: string, input: { name: string; kind: string; percent: number }) {
  if (!input.name.trim()) throw new Error("A policy needs a name");
  if (!(input.percent > 0 && input.percent <= 100)) throw new Error("Percent must be between 0 and 100");
  const [p] = await db.insert(discountPolicies).values({ practiceId, name: input.name.trim(), kind: input.kind, percent: input.percent }).returning();
  return p;
}

export async function setPolicyActive(db: Db, practiceId: string, id: string, active: boolean) {
  await db.update(discountPolicies).set({ active }).where(and(eq(discountPolicies.id, id), eq(discountPolicies.practiceId, practiceId)));
}

/**
 * Discounts the patient's current balance by a policy's percentage and posts
 * it as a ledger entry, so the reduction is on the record with its reason.
 */
export async function applyDiscount(db: Db, practiceId: string, patientId: string, policyId: string, userId?: string) {
  const [policy] = await db
    .select()
    .from(discountPolicies)
    .where(and(eq(discountPolicies.id, policyId), eq(discountPolicies.practiceId, practiceId), eq(discountPolicies.active, true)))
    .limit(1);
  if (!policy) throw new Error("Discount policy not found or inactive");
  await assertPatient(db, practiceId, patientId);
  const balance = await patientBalanceCents(db, patientId);
  if (balance <= 0) throw new Error("There is no patient balance to discount");
  const amount = Math.round((balance * policy.percent) / 100);
  const [entry] = await db
    .insert(ledgerEntries)
    .values({ practiceId, patientId, type: "discount", amountCents: amount, note: `${policy.name} (${policy.percent}%)`, postedBy: userId ?? null })
    .returning();
  await db.insert(schema.auditLog).values({ practiceId, userId: userId ?? null, action: "apply_discount", entity: "patient", entityId: patientId, details: { policyId, amountCents: amount } });
  return entry;
}

async function assertPatient(db: Db, practiceId: string, patientId: string) {
  const [p] = await db.select({ id: patients.id }).from(patients).where(and(eq(patients.id, patientId), eq(patients.practiceId, practiceId))).limit(1);
  if (!p) throw new Error("Patient not found");
}

/* ------------------------------------------------------------------ */
/* Payment plans                                                        */
/* ------------------------------------------------------------------ */

export interface NewPlanInput {
  totalCents: number;
  installmentCount: number;
  frequency: "monthly" | "biweekly";
  startDate: string;
  note?: string;
}

export async function createPaymentPlan(db: Db, practiceId: string, patientId: string, input: NewPlanInput, userId?: string) {
  await assertPatient(db, practiceId, patientId);
  const balance = await patientBalanceCents(db, patientId);
  if (input.totalCents > balance) throw new Error(`The plan total exceeds the patient balance of $${(balance / 100).toFixed(2)}`);
  const [active] = await db
    .select({ id: paymentPlans.id })
    .from(paymentPlans)
    .where(and(eq(paymentPlans.patientId, patientId), eq(paymentPlans.status, "active")))
    .limit(1);
  if (active) throw new Error("This patient already has an active payment plan");

  const schedule = buildSchedule(input.totalCents, input.installmentCount, input.startDate, input.frequency);
  const [plan] = await db
    .insert(paymentPlans)
    .values({
      practiceId, patientId, totalCents: input.totalCents, installmentCount: input.installmentCount,
      frequency: input.frequency, startDate: input.startDate, note: input.note || null, createdBy: userId ?? null,
    })
    .returning();
  await db.insert(paymentPlanInstallments).values(schedule.map((s) => ({ planId: plan.id, seq: s.seq, dueDate: s.dueDate, amountCents: s.amountCents })));
  await db.insert(schema.auditLog).values({ practiceId, userId: userId ?? null, action: "create_payment_plan", entity: "payment_plan", entityId: plan.id, details: { totalCents: input.totalCents, installments: input.installmentCount } });
  return plan;
}

/**
 * Marks installments past their grace period as missed, and a plan with too
 * many missed as defaulted. Run whenever plans are read, so the state shown is
 * never stale and no scheduler is needed.
 */
export async function refreshPlanStatuses(db: Db, practiceId: string, asOf = today()) {
  const cutoff = addDays(asOf, -GRACE_DAYS);
  await db.execute(sql`
    UPDATE payment_plan_installments i SET status = 'missed'
    FROM payment_plans p
    WHERE p.id = i.plan_id AND p.practice_id = ${practiceId} AND p.status = 'active'
      AND i.status IN ('scheduled', 'partial') AND i.due_date < ${cutoff}::date
  `);
  await db.execute(sql`
    UPDATE payment_plans p SET status = 'defaulted'
    WHERE p.practice_id = ${practiceId} AND p.status = 'active'
      AND (SELECT count(*) FROM payment_plan_installments i WHERE i.plan_id = p.id AND i.status = 'missed') >= ${DEFAULT_AFTER_MISSED}
  `);
}

export async function getPlan(db: Db, practiceId: string, planId: string) {
  const [plan] = await db.select().from(paymentPlans).where(and(eq(paymentPlans.id, planId), eq(paymentPlans.practiceId, practiceId))).limit(1);
  if (!plan) return null;
  const installments = await db.select().from(paymentPlanInstallments).where(eq(paymentPlanInstallments.planId, planId)).orderBy(asc(paymentPlanInstallments.seq));
  return { plan, installments };
}

export async function plansForPatient(db: Db, practiceId: string, patientId: string) {
  await refreshPlanStatuses(db, practiceId);
  const plans = await db.select().from(paymentPlans).where(and(eq(paymentPlans.patientId, patientId), eq(paymentPlans.practiceId, practiceId))).orderBy(desc(paymentPlans.createdAt));
  if (!plans.length) return [];
  const inst = await db.select().from(paymentPlanInstallments).where(inArray(paymentPlanInstallments.planId, plans.map((p) => p.id))).orderBy(asc(paymentPlanInstallments.seq));
  return plans.map((plan) => ({ plan, installments: inst.filter((i) => i.planId === plan.id) }));
}

export async function listPlans(db: Db, practiceId: string, status?: string) {
  await refreshPlanStatuses(db, practiceId);
  const r = await db.execute<Record<string, string>>(sql`
    SELECT p.id, p.status, p.total_cents, p.installment_count, p.frequency, p.start_date::text,
           pt.id AS patient_id, pt.first_name, pt.last_name, pt.mrn,
           COALESCE((SELECT sum(paid_cents) FROM payment_plan_installments i WHERE i.plan_id = p.id), 0)::bigint AS paid,
           (SELECT min(due_date)::text FROM payment_plan_installments i WHERE i.plan_id = p.id AND i.status IN ('scheduled','partial','missed')) AS next_due,
           (SELECT count(*) FROM payment_plan_installments i WHERE i.plan_id = p.id AND i.status = 'missed')::int AS missed
    FROM payment_plans p JOIN patients pt ON pt.id = p.patient_id
    WHERE p.practice_id = ${practiceId} ${status ? sql`AND p.status = ${status}` : sql``}
    ORDER BY p.created_at DESC LIMIT 200
  `);
  return r.rows.map((x) => ({
    id: x.id, status: x.status, totalCents: Number(x.total_cents), installmentCount: Number(x.installment_count), frequency: x.frequency,
    startDate: x.start_date, patientId: x.patient_id, firstName: x.first_name, lastName: x.last_name, mrn: x.mrn,
    paidCents: Number(x.paid), nextDue: x.next_due, missed: Number(x.missed),
  }));
}

/**
 * Takes a payment against a plan: one ledger entry for the money, then the
 * amount is spread across installments oldest first. Anything beyond what the
 * plan still needs stays on the ledger as ordinary account credit.
 */
export async function recordPlanPayment(db: Db, practiceId: string, planId: string, amountCents: number, method: string, userId?: string) {
  if (!(Number.isInteger(amountCents) && amountCents > 0)) throw new Error("Enter a payment amount");
  const found = await getPlan(db, practiceId, planId);
  if (!found) throw new Error("Payment plan not found");
  if (!["active", "defaulted"].includes(found.plan.status)) throw new Error(`This plan is ${found.plan.status}`);

  await db.insert(ledgerEntries).values({
    practiceId, patientId: found.plan.patientId, type: "patient_payment", amountCents,
    note: `Payment plan payment (${method})`, postedBy: userId ?? null,
  });

  const { allocations, leftoverCents } = allocatePayment(found.installments, amountCents);
  const now = new Date();
  for (const a of allocations) {
    await db.update(paymentPlanInstallments).set({ paidCents: a.paidCents, status: a.status, paidAt: a.status === "paid" ? now : null }).where(eq(paymentPlanInstallments.id, a.id));
  }
  const after = await getPlan(db, practiceId, planId);
  const complete = after!.installments.every((i) => i.status === "paid");
  const recovered = found.plan.status === "defaulted" && !after!.installments.some((i) => i.status === "missed");
  if (complete) await db.update(paymentPlans).set({ status: "completed" }).where(eq(paymentPlans.id, planId));
  else if (recovered) await db.update(paymentPlans).set({ status: "active" }).where(eq(paymentPlans.id, planId));
  return { allocations, leftoverCents, completed: complete };
}

export async function cancelPlan(db: Db, practiceId: string, planId: string) {
  await db.update(paymentPlans).set({ status: "cancelled" }).where(and(eq(paymentPlans.id, planId), eq(paymentPlans.practiceId, practiceId), eq(paymentPlans.status, "active")));
}

/* ------------------------------------------------------------------ */
/* Statements                                                           */
/* ------------------------------------------------------------------ */

async function nextNumber(db: Db, practiceId: string, table: "statements" | "estimates", prefix: string) {
  const ymd = today().replace(/-/g, "");
  const r = await db.execute<{ n: string }>(
    table === "statements"
      ? sql`SELECT count(*)::int AS n FROM statements WHERE practice_id = ${practiceId} AND statement_number LIKE ${`${prefix}${ymd}-%`}`
      : sql`SELECT count(*)::int AS n FROM estimates WHERE practice_id = ${practiceId} AND estimate_number LIKE ${`${prefix}${ymd}-%`}`,
  );
  return `${prefix}${ymd}-${String(Number(r.rows[0]?.n ?? 0) + 1).padStart(4, "0")}`;
}

/**
 * Builds a statement in the spirit of HFMA's Patient Friendly Billing
 * guidance: an account summary first, then each visit that contributes to the
 * balance, showing what was billed, what insurance paid and adjusted, and what
 * is left for the patient, in plain terms.
 */
export async function buildStatementDetail(db: Db, patientId: string) {
  const rows = await db
    .select({
      claimId: ledgerEntries.claimId, type: ledgerEntries.type, amountCents: ledgerEntries.amountCents,
      dos: encounters.dateOfService, encounterId: encounters.id, provFirst: providers.firstName, provLast: providers.lastName,
    })
    .from(ledgerEntries)
    .leftJoin(claims, eq(claims.id, ledgerEntries.claimId))
    .leftJoin(encounters, eq(encounters.id, claims.encounterId))
    .leftJoin(providers, eq(providers.id, encounters.providerId))
    .where(eq(ledgerEntries.patientId, patientId));

  const visits = new Map<string, StatementVisit & { encounterId: string | null }>();
  let unappliedPaymentsCents = 0;
  let discountsCents = 0;
  for (const r of rows) {
    if (!r.claimId) {
      if (r.type === "patient_payment") unappliedPaymentsCents += r.amountCents;
      else if (r.type === "discount") discountsCents += r.amountCents;
      else if (r.type === "refund") unappliedPaymentsCents -= r.amountCents;
      continue;
    }
    let v = visits.get(r.claimId);
    if (!v) {
      v = {
        claimId: r.claimId, encounterId: r.encounterId, dateOfService: r.dos,
        provider: r.provLast ? `Dr. ${r.provFirst} ${r.provLast}` : null, services: [],
        chargesCents: 0, insurancePaidCents: 0, adjustmentsCents: 0, patientPaidCents: 0, youOweCents: 0,
      };
      visits.set(r.claimId, v);
    }
    switch (r.type) {
      case "charge": v.chargesCents += r.amountCents; break;
      case "insurance_payment": v.insurancePaidCents += r.amountCents; break;
      case "adjustment": case "write_off": v.adjustmentsCents += r.amountCents; break;
      case "transfer_to_patient": v.youOweCents += r.amountCents; break;
      case "patient_payment": v.patientPaidCents += r.amountCents; v.youOweCents -= r.amountCents; break;
      case "discount": v.adjustmentsCents += r.amountCents; v.youOweCents -= r.amountCents; break;
      case "refund": v.youOweCents += r.amountCents; break;
    }
  }

  const owing = [...visits.values()].filter((v) => v.youOweCents > 0);
  const encIds = owing.map((v) => v.encounterId).filter(Boolean) as string[];
  if (encIds.length) {
    const lines = await db
      .select({ encounterId: charges.encounterId, cpt: charges.cpt, description: cptCodes.description, lineDesc: charges.description })
      .from(charges)
      .leftJoin(cptCodes, eq(cptCodes.code, charges.cpt))
      .where(inArray(charges.encounterId, encIds))
      .orderBy(asc(charges.lineNumber));
    for (const v of owing) {
      v.services = lines.filter((l) => l.encounterId === v.encounterId).map((l) => ({ cpt: l.cpt, description: l.description ?? l.lineDesc ?? l.cpt }));
    }
  }
  owing.sort((a, b) => (a.dateOfService ?? "").localeCompare(b.dateOfService ?? ""));

  const visitsOut: StatementVisit[] = owing.map(({ encounterId: _e, ...v }) => v);
  const sum = (k: keyof StatementVisit) => visitsOut.reduce((a, v) => a + (v[k] as number), 0);
  // The amount due is the whole account balance, including any visit that was
  // overpaid at claim level and so is not itemized above.
  const allOwed = [...visits.values()].reduce((a, v) => a + v.youOweCents, 0);
  const amountDue = Math.max(allOwed - unappliedPaymentsCents - discountsCents, 0);
  return {
    visits: visitsOut,
    unappliedPaymentsCents,
    discountsCents,
    totals: {
      chargesCents: sum("chargesCents"),
      insurancePaidCents: sum("insurancePaidCents"),
      adjustmentsCents: sum("adjustmentsCents") + discountsCents,
      patientPaidCents: sum("patientPaidCents") + unappliedPaymentsCents,
      amountDueCents: amountDue,
    },
  };
}

export async function generateStatement(db: Db, practiceId: string, patientId: string, userId?: string) {
  await assertPatient(db, practiceId, patientId);
  const d = await buildStatementDetail(db, patientId);
  if (d.totals.amountDueCents <= 0) throw new Error("This patient has no balance to bill");
  const statementDate = today();
  const [st] = await db
    .insert(statements)
    .values({
      practiceId, patientId,
      statementNumber: await nextNumber(db, practiceId, "statements", "S"),
      statementDate, dueDate: addDays(statementDate, 30),
      chargesCents: d.totals.chargesCents, insurancePaidCents: d.totals.insurancePaidCents,
      adjustmentsCents: d.totals.adjustmentsCents, patientPaidCents: d.totals.patientPaidCents,
      amountDueCents: d.totals.amountDueCents,
      detail: { visits: d.visits, unappliedPaymentsCents: d.unappliedPaymentsCents, discountsCents: d.discountsCents },
      createdBy: userId ?? null,
    })
    .returning();
  return st;
}

/**
 * Statements for every patient at or above a balance threshold, skipping
 * anyone billed within the last `skipDays` so a batch rerun does not send
 * duplicates.
 */
export async function generateStatementBatch(db: Db, practiceId: string, opts: { minBalanceCents?: number; skipDays?: number } = {}, userId?: string) {
  const min = opts.minBalanceCents ?? 500;
  const skipDays = opts.skipDays ?? 25;
  const cutoff = addDays(today(), -skipDays);
  const candidates = await patientsWithBalances(db, practiceId, min, 5_000);
  let generated = 0;
  let skipped = 0;
  for (const c of candidates) {
    if (c.lastStatement && c.lastStatement > cutoff) { skipped++; continue; }
    try {
      await generateStatement(db, practiceId, c.patientId, userId);
      generated++;
    } catch {
      skipped++;
    }
  }
  return { generated, skipped };
}

export async function getStatement(db: Db, practiceId: string, id: string) {
  const [row] = await db
    .select({ statement: statements, patient: patients, practice: practices })
    .from(statements)
    .innerJoin(patients, eq(patients.id, statements.patientId))
    .innerJoin(practices, eq(practices.id, statements.practiceId))
    .where(and(eq(statements.id, id), eq(statements.practiceId, practiceId)))
    .limit(1);
  return row ?? null;
}

export async function listStatements(db: Db, practiceId: string, patientId?: string, limit = 50) {
  return db
    .select({ statement: statements, patient: patients })
    .from(statements)
    .innerJoin(patients, eq(patients.id, statements.patientId))
    .where(patientId ? and(eq(statements.practiceId, practiceId), eq(statements.patientId, patientId)) : eq(statements.practiceId, practiceId))
    .orderBy(desc(statements.createdAt))
    .limit(limit);
}

export async function markStatementSent(db: Db, practiceId: string, id: string, channel: "print" | "email") {
  await db.update(statements).set({ status: "sent", channel, sentAt: new Date() }).where(and(eq(statements.id, id), eq(statements.practiceId, practiceId)));
}

export async function voidStatement(db: Db, practiceId: string, id: string) {
  await db.update(statements).set({ status: "void" }).where(and(eq(statements.id, id), eq(statements.practiceId, practiceId)));
}

/* ------------------------------------------------------------------ */
/* Estimates                                                            */
/* ------------------------------------------------------------------ */

export interface NewEstimateInput {
  patientId: string;
  /** Null for an uninsured or self-pay patient, which produces a good faith estimate. */
  patientInsuranceId: string | null;
  serviceDate: string | null;
  lines: { cpt: string; units: number }[];
}

/** Benefits older than this are re-verified before an estimate relies on them. */
const BENEFITS_MAX_AGE_DAYS = 7;

export async function createEstimate(db: Db, practiceId: string, input: NewEstimateInput, userId?: string) {
  await assertPatient(db, practiceId, input.patientId);
  const lines = input.lines.filter((l) => l.cpt && l.units > 0);
  if (!lines.length) throw new Error("Add at least one service");

  const [codes, fees] = await Promise.all([db.select().from(cptCodes), standardCharges(db, practiceId)]);
  const descriptions = new Map(codes.map((c) => [c.code, c.description]));
  for (const l of lines) if (!fees.has(l.cpt)) throw new Error(`Unknown code ${l.cpt}`);

  const number = await nextNumber(db, practiceId, "estimates", "E");
  const validUntil = addDays(today(), 60);

  if (!input.patientInsuranceId) {
    await ensureDefaultPolicies(db, practiceId);
    const [policy] = await db.select().from(discountPolicies)
      .where(and(eq(discountPolicies.practiceId, practiceId), eq(discountPolicies.kind, "self_pay"), eq(discountPolicies.active, true))).limit(1);
    const pct = policy?.percent ?? 0;
    const estLines: EstimateLine[] = lines.map((l) => ({ cpt: l.cpt, description: descriptions.get(l.cpt) ?? l.cpt, units: l.units, chargeCents: fees.get(l.cpt)!, allowedCents: fees.get(l.cpt)! }));
    const e = estimateSelfPay(estLines, pct);
    const [est] = await db.insert(estimates).values({
      practiceId, patientId: input.patientId, patientInsuranceId: null, estimateNumber: number, kind: "good_faith",
      serviceDate: input.serviceDate, lines: estLines, totalChargeCents: e.totalChargeCents, allowedCents: e.totalChargeCents,
      insurancePaysCents: 0, patientOwesCents: e.patientOwesCents,
      basis: { selfPayDiscountPct: pct, discountCents: e.discountCents, policy: policy?.name ?? null },
      validUntil, createdBy: userId ?? null,
    }).returning();
    return est;
  }

  const [ins] = await db
    .select({ ins: patientInsurances, payer: payers })
    .from(patientInsurances)
    .innerJoin(payers, eq(payers.id, patientInsurances.payerId))
    .where(and(eq(patientInsurances.id, input.patientInsuranceId), eq(patientInsurances.patientId, input.patientId)))
    .limit(1);
  if (!ins) throw new Error("Insurance not found for this patient");

  // An estimate is only as good as the benefits behind it, so stale or
  // missing benefits are verified now rather than guessed.
  let [check] = await db.select().from(eligibilityChecks).where(eq(eligibilityChecks.patientInsuranceId, ins.ins.id)).orderBy(desc(eligibilityChecks.checkedAt)).limit(1);
  const stale = !check || Date.now() - new Date(check.checkedAt).getTime() > BENEFITS_MAX_AGE_DAYS * 86_400_000;
  if (stale) check = await runEligibility(db, ins.ins.id);
  if (check.status !== "active") throw new Error("Coverage is not active for this insurance. Estimate as self-pay instead.");

  const rates = await contractRates(db, practiceId, ins.payer.id);
  const estLines: EstimateLine[] = lines.map((l) => ({
    cpt: l.cpt, description: descriptions.get(l.cpt) ?? l.cpt, units: l.units,
    chargeCents: fees.get(l.cpt)!, allowedCents: rates.get(l.cpt) ?? fees.get(l.cpt)!,
  }));
  const uncontracted = estLines.filter((l) => !rates.has(l.cpt)).map((l) => l.cpt);
  const benefits = {
    copayCents: check.copayCents ?? ins.ins.copayCents,
    deductibleRemainingCents: check.deductibleRemainingCents ?? 0,
    coinsurancePct: check.coinsurancePct ?? 20,
    oopRemainingCents: check.oopRemainingCents,
  };
  const e = estimateInsured(estLines, benefits);
  const [est] = await db.insert(estimates).values({
    practiceId, patientId: input.patientId, patientInsuranceId: ins.ins.id, estimateNumber: number, kind: "insured",
    serviceDate: input.serviceDate, lines: estLines, totalChargeCents: e.totalChargeCents, allowedCents: e.allowedCents,
    insurancePaysCents: e.insurancePaysCents, patientOwesCents: e.patientOwesCents,
    basis: {
      payer: ins.payer.name, planName: check.planName, benefitsCheckedAt: check.checkedAt, ...benefits,
      copayApplied: e.copayCents, deductibleApplied: e.deductibleCents, coinsuranceApplied: e.coinsuranceCents,
      oopCapApplied: e.oopCapCents, uncontractedCodes: uncontracted,
    },
    validUntil, createdBy: userId ?? null,
  }).returning();
  return est;
}

export async function getEstimate(db: Db, practiceId: string, id: string) {
  const [row] = await db
    .select({ estimate: estimates, patient: patients, practice: practices })
    .from(estimates)
    .innerJoin(patients, eq(patients.id, estimates.patientId))
    .innerJoin(practices, eq(practices.id, estimates.practiceId))
    .where(and(eq(estimates.id, id), eq(estimates.practiceId, practiceId)))
    .limit(1);
  return row ?? null;
}

export async function listEstimates(db: Db, practiceId: string, patientId: string) {
  return db.select().from(estimates).where(and(eq(estimates.practiceId, practiceId), eq(estimates.patientId, patientId))).orderBy(desc(estimates.createdAt)).limit(20);
}
