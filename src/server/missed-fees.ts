/**
 * Missed-appointment fees: a no-show, or a cancellation too close to the
 * visit, under a policy the patient agreed to in advance (at online check-in
 * or signed in the office). The fee is the patient's own charge: it is never
 * billed to insurance (Medicare does not pay for missed appointments), it is
 * charged once per appointment, and it can be waived with a reason. Some
 * states and payer contracts limit these fees, and Medicaid patients generally
 * may not be charged them, so the practice sets its own policy and
 * the app never charges a Medicaid patient.
 */
import { and, desc, eq, gte, inArray, isNull, like, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { getPolicies } from "./policies";

const { appointments, patients, practices, patientInsurances, payers, ledgerEntries, auditLog } = schema;

export type FeePolicy = { noShowCents: number; lateCancelCents: number; lateCancelHours: number };

export async function saveFeePolicy(db: Db, practiceId: string, input: FeePolicy, userId?: string) {
  for (const v of [input.noShowCents, input.lateCancelCents]) if (!Number.isInteger(v) || v < 0 || v > 50_000) throw new Error("Fees are $0 to $500");
  if (!Number.isInteger(input.lateCancelHours) || input.lateCancelHours < 1 || input.lateCancelHours > 72) throw new Error("Late cancellation is 1 to 72 hours before the visit");
  const stored = await getPolicies(db, practiceId);
  await db.update(practices).set({ policies: { ...stored, missedFees: input } }).where(eq(practices.id, practiceId));
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "policies_changed", entity: "practice", entityId: practiceId, details: { changed: ["missedFees"], missedFees: input } });
}

const noteFor = (kind: "no_show" | "late_cancel", appointmentId: string) => `${kind === "no_show" ? "Missed appointment" : "Late cancellation"} fee [appt ${appointmentId}]`;

async function onMedicaid(db: Db, patientId: string) {
  const [r] = await db.select({ id: patientInsurances.id }).from(patientInsurances).innerJoin(payers, eq(payers.id, patientInsurances.payerId))
    .where(and(eq(patientInsurances.patientId, patientId), eq(patientInsurances.active, true), eq(payers.type, "medicaid"))).limit(1);
  return !!r;
}

export type FeeCandidate = { appointmentId: string; patientId: string; patient: string; startsAt: Date; kind: "no_show" | "late_cancel"; feeCents: number; blocked: string | null };

/** No-shows and late cancellations in the last 60 days not yet charged or waived, with why any cannot be charged. */
export async function feeCandidates(db: Db, practiceId: string, now = new Date()): Promise<{ policy: FeePolicy | null; candidates: FeeCandidate[] }> {
  const policy = (await getPolicies(db, practiceId)).missedFees ?? null;
  if (!policy) return { policy: null, candidates: [] };
  const since = new Date(now.getTime() - 60 * 86_400_000);
  const rows = await db.select({ a: appointments, p: patients }).from(appointments).innerJoin(patients, eq(patients.id, appointments.patientId))
    .where(and(eq(appointments.practiceId, practiceId), gte(appointments.startsAt, since), inArray(appointments.status, ["no_show", "cancelled"]), isNull(patients.mergedInto)))
    .orderBy(desc(appointments.startsAt)).limit(300);
  const charged = new Set((await db.select({ note: ledgerEntries.note }).from(ledgerEntries)
    .where(and(eq(ledgerEntries.practiceId, practiceId), like(ledgerEntries.note, "%fee [appt %"))))
    .map((r) => /\[appt ([0-9a-f-]{36})\]/.exec(r.note ?? "")?.[1]).filter(Boolean) as string[]);
  const out: FeeCandidate[] = [];
  for (const { a, p } of rows) {
    if (charged.has(a.id)) continue;
    let kind: FeeCandidate["kind"];
    if (a.status === "no_show") kind = "no_show";
    else if (a.cancelledAt && a.startsAt.getTime() - a.cancelledAt.getTime() < policy.lateCancelHours * 3_600_000) kind = "late_cancel";
    else continue;
    const feeCents = kind === "no_show" ? policy.noShowCents : policy.lateCancelCents;
    if (!feeCents) continue;
    const blocked = !p.feePolicySignedOn || p.feePolicySignedOn > a.startsAt.toISOString().slice(0, 10) ? "The patient had not agreed to the fee policy before the visit"
      : (await onMedicaid(db, p.id)) ? "Medicaid patients are not charged missed-appointment fees" : null;
    out.push({ appointmentId: a.id, patientId: p.id, patient: `${p.lastName}, ${p.firstName}`, startsAt: a.startsAt, kind, feeCents, blocked });
  }
  return { policy, candidates: out };
}

export async function chargeFee(db: Db, practiceId: string, appointmentId: string, userId?: string, now = new Date()) {
  const { candidates } = await feeCandidates(db, practiceId, now);
  const c = candidates.find((x) => x.appointmentId === appointmentId);
  if (!c) throw new Error("This appointment has no fee to charge (not missed, already charged, or outside the policy)");
  if (c.blocked) throw new Error(c.blocked);
  const [entry] = await db.insert(ledgerEntries).values({ practiceId, patientId: c.patientId, type: "patient_fee", amountCents: c.feeCents, note: noteFor(c.kind, appointmentId), postedBy: userId ?? null }).returning();
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "missed_fee_charged", entity: "patient", entityId: c.patientId, details: { appointmentId, kind: c.kind, cents: c.feeCents } });
  return entry;
}

/** Takes a fee off with a reason (a discount of the same amount); a fee is waived once. */
export async function waiveFee(db: Db, practiceId: string, feeEntryId: string, reason: string, userId?: string) {
  const [fee] = await db.select().from(ledgerEntries).where(and(eq(ledgerEntries.id, feeEntryId), eq(ledgerEntries.practiceId, practiceId), eq(ledgerEntries.type, "patient_fee"))).limit(1);
  if (!fee) throw new Error("Fee not found");
  const why = reason.trim().slice(0, 200);
  if (!why) throw new Error("Give the reason for waiving the fee");
  const appt = /\[appt ([0-9a-f-]{36})\]/.exec(fee.note ?? "")?.[1] ?? fee.id;
  const [already] = await db.select({ id: ledgerEntries.id }).from(ledgerEntries).where(and(eq(ledgerEntries.patientId, fee.patientId), eq(ledgerEntries.type, "discount"), like(ledgerEntries.note, `Fee waived [appt ${appt}]%`))).limit(1);
  if (already) throw new Error("This fee was already waived");
  await db.insert(ledgerEntries).values({ practiceId, patientId: fee.patientId, type: "discount", amountCents: fee.amountCents, note: `Fee waived [appt ${appt}]: ${why}`, postedBy: userId ?? null });
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "missed_fee_waived", entity: "patient", entityId: fee.patientId, details: { feeEntryId, reason: why } });
}

/** Fees charged in the last 90 days, and whether each was waived. */
export async function recentFees(db: Db, practiceId: string) {
  const { rows } = await db.execute<Record<string, string | null>>(sql`
    SELECT le.id, le.patient_id, le.amount_cents::text AS cents, le.note, le.posted_at::date::text AS on_date, p.last_name || ', ' || p.first_name AS patient,
      EXISTS (SELECT 1 FROM ledger_entries w WHERE w.patient_id = le.patient_id AND w.type = 'discount' AND w.note LIKE 'Fee waived [appt ' || substring(le.note from '\\[appt ([0-9a-f-]{36})\\]') || ']%') AS waived
    FROM ledger_entries le JOIN patients p ON p.id = le.patient_id
    WHERE le.practice_id = ${practiceId} AND le.type = 'patient_fee' AND le.posted_at >= now() - interval '90 days'
    ORDER BY le.posted_at DESC LIMIT 200`);
  return rows.map((r) => ({ id: r.id!, patientId: r.patient_id!, patient: r.patient!, cents: Number(r.cents), note: r.note!, on: r.on_date!, waived: r.waived === "true" || (r.waived as unknown) === true }));
}

/** Records that the patient signed the missed-appointment policy in the office. */
export async function recordFeePolicySigned(db: Db, practiceId: string, patientId: string, signedOn: string, userId?: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(signedOn)) throw new Error("Enter the date it was signed");
  const [p] = await db.update(patients).set({ feePolicySignedOn: signedOn }).where(and(eq(patients.id, patientId), eq(patients.practiceId, practiceId))).returning();
  if (!p) throw new Error("Patient not found");
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "fee_policy_signed", entity: "patient", entityId: patientId, details: { signedOn } });
}
