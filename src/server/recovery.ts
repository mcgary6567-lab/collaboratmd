/**
 * Revenue recovery: money a practice earned but has not collected, and money
 * it holds that belongs to someone else.
 *
 *  - Missed charges: visits that happened but were never billed.
 *  - Underpayment disputes: a letter to the payer listing each claim paid
 *    below contract, and what the dispute recovered.
 *  - Credit balances: patient credits and insurance overpayments, refunded
 *    through request, approval and issue, with a ledger entry when issued.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { patientBalanceSql } from "./billing";
import { contractRates } from "./fees";
import { getPolicies } from "./policies";

const { chargeReviewDismissals, refunds, underpayments, ledgerEntries, auditLog, claims, payers, patients, practices, patientInsurances, encounters, charges } = schema;
type Row = Record<string, string | null>;

/* ------------------------------ Missed charges ------------------------------ */

export type MissedCharge = { kind: "appointment" | "encounter"; id: string; date: string; patientId: string; patientName: string; providerId: string; providerName: string; detail: string; estimateCents: number };

/** Completed visits with no charges, and charges that never became a claim. Looks back 60 days. */
export async function missedCharges(db: Db, practiceId: string, now = new Date()): Promise<MissedCharge[]> {
  const since = new Date(now.getTime() - 60 * 86_400_000);
  const until = new Date(now.getTime() - 86_400_000);
  const [{ rows: appts }, { rows: encs }, { rows: avg }] = await Promise.all([
    db.execute<Row>(sql`
      SELECT a.id, a.starts_at::date::text AS date, a.type, a.patient_id, pt.last_name || ', ' || pt.first_name AS patient, a.provider_id, pr.last_name || ', ' || pr.first_name AS provider
      FROM appointments a JOIN patients pt ON pt.id = a.patient_id JOIN providers pr ON pr.id = a.provider_id
      WHERE a.practice_id = ${practiceId} AND a.status IN ('completed', 'checked_in') AND a.starts_at >= ${since} AND a.starts_at < ${until}
        AND NOT EXISTS (SELECT 1 FROM encounters e WHERE e.appointment_id = a.id)
        AND NOT EXISTS (SELECT 1 FROM encounters e WHERE e.patient_id = a.patient_id AND e.date_of_service = a.starts_at::date)
        AND NOT EXISTS (SELECT 1 FROM charge_review_dismissals d WHERE d.appointment_id = a.id)
      ORDER BY a.starts_at LIMIT 500`),
    db.execute<Row>(sql`
      SELECT e.id, e.date_of_service::text AS date, e.patient_id, pt.last_name || ', ' || pt.first_name AS patient, e.provider_id, pr.last_name || ', ' || pr.first_name AS provider,
             (SELECT COALESCE(sum(ch.charge_cents * ch.units), 0) FROM charges ch WHERE ch.encounter_id = e.id)::text AS cents
      FROM encounters e JOIN patients pt ON pt.id = e.patient_id JOIN providers pr ON pr.id = e.provider_id
      WHERE e.practice_id = ${practiceId} AND e.created_at >= ${since} AND e.created_at < ${until}
        AND NOT EXISTS (SELECT 1 FROM claims c WHERE c.encounter_id = e.id)
      ORDER BY e.date_of_service LIMIT 500`),
    db.execute<Row>(sql`
      SELECT e.provider_id, (avg(c.total_cents))::bigint::text AS cents
      FROM claims c JOIN encounters e ON e.id = c.encounter_id
      WHERE c.practice_id = ${practiceId} AND c.created_at >= ${new Date(now.getTime() - 90 * 86_400_000)} AND c.frequency_code = '1' AND c.payer_sequence = 'P'
      GROUP BY 1`),
  ]);
  const avgBy = new Map(avg.map((r) => [r.provider_id, Number(r.cents)]));
  return [
    ...appts.map((a) => ({ kind: "appointment" as const, id: a.id!, date: a.date!, patientId: a.patient_id!, patientName: a.patient!, providerId: a.provider_id!, providerName: a.provider!, detail: `${(a.type ?? "visit").replace(/_/g, " ")} was seen but no charges were entered`, estimateCents: avgBy.get(a.provider_id) ?? 0 })),
    ...encs.map((e) => ({ kind: "encounter" as const, id: e.id!, date: e.date!, patientId: e.patient_id!, patientName: e.patient!, providerId: e.provider_id!, providerName: e.provider!, detail: "Charges entered but no claim was created", estimateCents: Number(e.cents) })),
  ].sort((a, b) => a.date.localeCompare(b.date));
}

export async function dismissMissedCharge(db: Db, practiceId: string, appointmentId: string, reason: string, userId?: string) {
  const why = reason.trim().slice(0, 200);
  if (!why) throw new Error("Say why the visit is not billable (for example: no-charge follow-up, billed elsewhere)");
  const [a] = await db.select({ id: schema.appointments.id }).from(schema.appointments).where(and(eq(schema.appointments.id, appointmentId), eq(schema.appointments.practiceId, practiceId))).limit(1);
  if (!a) throw new Error("Appointment not found");
  await db.insert(chargeReviewDismissals).values({ appointmentId, practiceId, reason: why, dismissedBy: userId ?? null }).onConflictDoNothing();
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "missed_charge_dismissed", entity: "appointment", entityId: appointmentId, details: { reason: why } });
}

/* ------------------------------ Underpayment disputes ------------------------------ */

export type DisputeLine = { cpt: string; units: number; contractCents: number | null };
export type DisputeClaim = { underpaymentId: string; controlNumber: string; payerClaimNumber: string | null; patientName: string; memberId: string; dateOfService: string; expectedCents: number; allowedCents: number; varianceCents: number; lines: DisputeLine[] };

/** Claims per letter. Payers' dispute units work claim by claim; a letter listing hundreds gets set aside. */
export const LETTER_MAX = 50;

/** Open underpayments by payer, across all of them (not just a page of rows). */
export async function disputeGroups(db: Db, practiceId: string) {
  const { rows } = await db.execute<Row>(sql`
    SELECT u.payer_id, py.name, count(*)::text AS n, sum(u.variance_cents)::text AS cents
    FROM underpayments u JOIN payers py ON py.id = u.payer_id
    WHERE u.practice_id = ${practiceId} AND u.status = 'open'
    GROUP BY u.payer_id, py.name ORDER BY sum(u.variance_cents) DESC`);
  return rows.map((r) => ({ payerId: r.payer_id!, name: r.name!, count: Number(r.n), cents: Number(r.cents) }));
}

/** The next letter for a payer: its largest open underpayments, up to LETTER_MAX. */
export async function disputeData(db: Db, practiceId: string, payerId: string) {
  const [payer] = await db.select().from(payers).where(and(eq(payers.id, payerId), eq(payers.practiceId, practiceId))).limit(1);
  if (!payer) throw new Error("Payer not found");
  const [practice] = await db.select().from(practices).where(eq(practices.id, practiceId)).limit(1);
  const rows = await db
    .select({ u: underpayments, c: claims, p: patients, ins: patientInsurances, e: encounters })
    .from(underpayments)
    .innerJoin(claims, eq(claims.id, underpayments.claimId))
    .innerJoin(patients, eq(patients.id, claims.patientId))
    .innerJoin(patientInsurances, eq(patientInsurances.id, claims.patientInsuranceId))
    .innerJoin(encounters, eq(encounters.id, claims.encounterId))
    .where(and(eq(underpayments.practiceId, practiceId), eq(underpayments.payerId, payerId), eq(underpayments.status, "open")))
    .orderBy(desc(underpayments.varianceCents))
    .limit(LETTER_MAX);
  rows.sort((a, b) => a.e.dateOfService.localeCompare(b.e.dateOfService));
  const rates = await contractRates(db, practiceId, payerId);
  const lines = rows.length ? await db.select().from(charges).where(inArray(charges.encounterId, rows.map((r) => r.e.id))) : [];
  const claimsOut: DisputeClaim[] = rows.map((r) => ({
    underpaymentId: r.u.id, controlNumber: r.c.controlNumber, payerClaimNumber: r.c.payerClaimNumber, patientName: `${r.p.firstName} ${r.p.lastName}`, memberId: r.ins.memberId,
    dateOfService: r.e.dateOfService, expectedCents: r.u.expectedAllowedCents, allowedCents: r.u.actualAllowedCents, varianceCents: r.u.varianceCents,
    lines: lines.filter((l) => l.encounterId === r.e.id).map((l) => ({ cpt: l.cpt, units: l.units, contractCents: rates.get(l.cpt) ?? null })),
  }));
  return { payer, practice, claims: claimsOut, totalCents: claimsOut.reduce((a, c) => a + c.varianceCents, 0) };
}

const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The letter to the payer's provider relations or dispute unit. Plain text, for printing or pasting into a portal. */
export function disputeLetterText(d: Awaited<ReturnType<typeof disputeData>>, today = new Date()) {
  const date = today.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const body = d.claims.map((c, i) => [
    `${i + 1}. Claim ${c.controlNumber}${c.payerClaimNumber ? ` (payer claim ${c.payerClaimNumber})` : ""}, ${c.patientName}, member ID ${c.memberId}, date of service ${c.dateOfService}`,
    `   Allowed ${usd(c.allowedCents)}; contracted ${usd(c.expectedCents)}; underpaid ${usd(c.varianceCents)}.`,
    ...c.lines.map((l) => `   ${l.cpt} x${l.units}: contracted ${l.contractCents === null ? "rate not on file" : usd(l.contractCents * l.units)}`),
  ].join("\n")).join("\n\n");
  return `${d.practice.name}
${d.practice.address1}, ${d.practice.city}, ${d.practice.state} ${d.practice.zip}
NPI ${d.practice.npi} · Tax ID ${d.practice.taxId}

${date}

${d.payer.name}
Attn: Provider Disputes / Payment Reconsideration

Re: Request for payment reconsideration, ${d.claims.length} claim${d.claims.length === 1 ? "" : "s"} paid below the contracted rate (total ${usd(d.totalCents)})

The claims below were adjudicated at allowed amounts lower than the rates in our participating provider agreement with ${d.payer.name}. We ask that each be reprocessed at the contracted rate and the difference paid.

${body}

Please reprocess these claims and remit the difference of ${usd(d.totalCents)}, or tell us in writing which contract term you applied if you believe the payments are correct. A copy of the fee schedule page for each code is available on request.

Sincerely,

[Name, title]
${d.practice.name}${d.practice.phone ? `\n${d.practice.phone}` : ""}`;
}

export async function markDisputed(db: Db, practiceId: string, underpaymentIds: string[], userId?: string) {
  if (!underpaymentIds.length) return 0;
  const done = await db.update(underpayments).set({ status: "appealed", disputedAt: new Date() }).where(and(eq(underpayments.practiceId, practiceId), inArray(underpayments.id, underpaymentIds), eq(underpayments.status, "open"))).returning();
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "underpayment_disputed", entity: "underpayment", entityId: null, details: { count: done.length } });
  return done.length;
}

/** Records what the dispute brought in. The payment itself posts from the payer's 835 like any other. */
export async function recordRecovery(db: Db, practiceId: string, underpaymentId: string, recoveredCents: number, userId?: string) {
  if (!Number.isInteger(recoveredCents) || recoveredCents < 0) throw new Error("Enter the amount recovered");
  const [row] = await db.update(underpayments).set({ status: "recovered", recoveredCents, resolvedAt: new Date() }).where(and(eq(underpayments.id, underpaymentId), eq(underpayments.practiceId, practiceId))).returning();
  if (!row) throw new Error("Underpayment not found");
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "underpayment_recovered", entity: "underpayment", entityId: underpaymentId, details: { recoveredCents } });
}

/* ------------------------------ Credit balances and refunds ------------------------------ */

export type PatientCredit = { patientId: string; name: string; mrn: string; creditCents: number; pendingCents: number };
export type ClaimOverpayment = { claimId: string; controlNumber: string; patientId: string; patientName: string; payerId: string; payerName: string; payerType: string; overpaidCents: number; pendingCents: number; lastPaidOn: string | null; ageDays: number | null };

export async function creditBalances(db: Db, practiceId: string, now = new Date()) {
  const [{ rows: pc }, { rows: co }] = await Promise.all([
    db.execute<Row>(sql`
      SELECT b.patient_id, p.first_name, p.last_name, p.mrn, (-b.balance)::text AS credit,
        (SELECT COALESCE(sum(r.amount_cents), 0) FROM refunds r WHERE r.patient_id = b.patient_id AND r.payee = 'patient' AND r.status IN ('requested', 'approved'))::text AS pending
      FROM (SELECT patient_id, (${patientBalanceSql})::bigint AS balance FROM ledger_entries WHERE practice_id = ${practiceId} GROUP BY patient_id) b
      JOIN patients p ON p.id = b.patient_id
      WHERE b.balance <= -100
      ORDER BY b.balance LIMIT 500`),
    db.execute<Row>(sql`
      SELECT x.* FROM (
        SELECT c.id, c.control_number, c.patient_id, pt.first_name || ' ' || pt.last_name AS patient, c.payer_id, py.name AS payer, py.type AS payer_type,
          (COALESCE(sum(l.amount_cents) FILTER (WHERE l.type = 'charge'), 0)
            - COALESCE(sum(l.amount_cents) FILTER (WHERE l.type = 'insurance_payment'), 0)
            + COALESCE(sum(l.amount_cents) FILTER (WHERE l.type = 'reversal'), 0)
            - COALESCE(sum(l.amount_cents) FILTER (WHERE l.type IN ('adjustment', 'write_off')), 0)
            - COALESCE(sum(l.amount_cents) FILTER (WHERE l.type = 'transfer_to_patient'), 0))::bigint AS balance,
          max(l.posted_at) FILTER (WHERE l.type = 'insurance_payment')::date::text AS last_paid,
          (SELECT COALESCE(sum(r.amount_cents), 0) FROM refunds r WHERE r.claim_id = c.id AND r.payee = 'payer' AND r.status IN ('requested', 'approved'))::text AS pending
        FROM claims c JOIN ledger_entries l ON l.claim_id = c.id JOIN patients pt ON pt.id = c.patient_id JOIN payers py ON py.id = c.payer_id
        WHERE c.practice_id = ${practiceId}
        GROUP BY c.id, pt.first_name, pt.last_name, py.name, py.type
      ) x WHERE x.balance <= -100 ORDER BY x.balance LIMIT 500`),
  ]);
  const patientsOut: PatientCredit[] = pc.map((r) => ({ patientId: r.patient_id!, name: `${r.last_name}, ${r.first_name}`, mrn: r.mrn!, creditCents: Number(r.credit), pendingCents: Number(r.pending) }));
  const claimsOut: ClaimOverpayment[] = co.map((r) => ({
    claimId: r.id!, controlNumber: r.control_number!, patientId: r.patient_id!, patientName: r.patient!, payerId: r.payer_id!, payerName: r.payer!, payerType: r.payer_type!,
    overpaidCents: -Number(r.balance), pendingCents: Number(r.pending), lastPaidOn: r.last_paid,
    ageDays: r.last_paid ? Math.floor((now.getTime() - Date.parse(r.last_paid)) / 86_400_000) : null,
  }));
  return { patients: patientsOut, claims: claimsOut };
}

export async function requestRefund(db: Db, practiceId: string, input: { payee: "patient" | "payer"; patientId?: string; claimId?: string; amountCents: number; reason: string }, userId?: string) {
  if (!Number.isInteger(input.amountCents) || input.amountCents < 100) throw new Error("Enter at least $1.00");
  const reason = input.reason.trim().slice(0, 300);
  if (!reason) throw new Error("Say why the money is being returned");
  const credits = await creditBalances(db, practiceId);
  if (input.payee === "patient") {
    const c = credits.patients.find((p) => p.patientId === input.patientId);
    if (!c) throw new Error("This patient has no credit balance");
    if (input.amountCents > c.creditCents - c.pendingCents) throw new Error(`Only ${usd(c.creditCents - c.pendingCents)} of credit is available to refund`);
    const [row] = await db.insert(refunds).values({ practiceId, patientId: c.patientId, payee: "patient", amountCents: input.amountCents, reason, requestedBy: userId ?? null }).returning();
    return row;
  }
  const o = credits.claims.find((x) => x.claimId === input.claimId);
  if (!o) throw new Error("This claim has no insurance overpayment");
  if (input.amountCents > o.overpaidCents - o.pendingCents) throw new Error(`Only ${usd(o.overpaidCents - o.pendingCents)} is overpaid on this claim`);
  const [row] = await db.insert(refunds).values({ practiceId, patientId: o.patientId, claimId: o.claimId, payerId: o.payerId, payee: "payer", amountCents: input.amountCents, reason, requestedBy: userId ?? null }).returning();
  return row;
}

async function ownRefund(db: Db, practiceId: string, id: string) {
  const [r] = await db.select().from(refunds).where(and(eq(refunds.id, id), eq(refunds.practiceId, practiceId))).limit(1);
  if (!r) throw new Error("Refund not found");
  return r;
}

export async function approveRefund(db: Db, practiceId: string, id: string, userId: string) {
  const r = await ownRefund(db, practiceId, id);
  if (r.status !== "requested") throw new Error(`This refund is already ${r.status}`);
  if (r.requestedBy === userId && (await getPolicies(db, practiceId)).refundDualControl) throw new Error("Practice policy: someone other than the person who requested a refund must approve it");
  await db.update(refunds).set({ status: "approved", approvedBy: userId, approvedAt: new Date() }).where(eq(refunds.id, id));
  await db.insert(auditLog).values({ practiceId, userId, action: "refund_approved", entity: "refund", entityId: id, details: { amountCents: r.amountCents, sameAsRequester: r.requestedBy === userId } });
}

/** Issuing posts the ledger entry: a patient refund as "refund", an insurance refund as a reversal on the claim. */
export async function issueRefund(db: Db, practiceId: string, id: string, input: { method: string; reference: string }, userId?: string) {
  const r = await ownRefund(db, practiceId, id);
  if (r.status !== "approved") throw new Error("Approve the refund before issuing it");
  const reference = input.reference.trim().slice(0, 60);
  if (!reference) throw new Error("Enter the check number or refund reference");
  const [entry] = await db.insert(ledgerEntries).values({
    practiceId, patientId: r.patientId, claimId: r.payee === "payer" ? r.claimId : null,
    type: r.payee === "patient" ? "refund" : "reversal", amountCents: r.amountCents,
    note: `${r.payee === "patient" ? "Refund to patient" : "Refund to payer"} (${input.method || "check"} ${reference}): ${r.reason}`, postedBy: userId ?? null,
  }).returning();
  await db.update(refunds).set({ status: "issued", method: input.method.slice(0, 40) || "check", reference, ledgerEntryId: entry.id, issuedBy: userId ?? null, issuedAt: new Date() }).where(eq(refunds.id, id));
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "refund_issued", entity: "refund", entityId: id, details: { amountCents: r.amountCents, payee: r.payee } });
}

export async function cancelRefund(db: Db, practiceId: string, id: string, userId?: string) {
  const r = await ownRefund(db, practiceId, id);
  if (r.status === "issued") throw new Error("An issued refund cannot be cancelled; post a correction instead");
  await db.update(refunds).set({ status: "cancelled" }).where(eq(refunds.id, id));
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "refund_cancelled", entity: "refund", entityId: id });
}

export async function listRefunds(db: Db, practiceId: string) {
  return db
    .select({ refund: refunds, patientFirst: patients.firstName, patientLast: patients.lastName, payerName: payers.name, controlNumber: claims.controlNumber })
    .from(refunds)
    .innerJoin(patients, eq(patients.id, refunds.patientId))
    .leftJoin(payers, eq(payers.id, refunds.payerId))
    .leftJoin(claims, eq(claims.id, refunds.claimId))
    .where(eq(refunds.practiceId, practiceId))
    .orderBy(desc(refunds.createdAt))
    .limit(200);
}
