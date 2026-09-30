/**
 * Who pays a patient's bill.
 *
 *  - Qualified Medicare Beneficiaries (dual eligibles in the QMB program) may
 *    not be billed Medicare deductibles, coinsurance or copays (Social
 *    Security Act 1902(n)(3)(B)); Medicaid pays them or they are written
 *    off. Marked on the patient's Medicare policy, that cost-sharing leaves
 *    statements, reminders, card charges and collections, and can be written
 *    off in one step.
 *  - Family accounts: a guarantor (a parent, for a minor) is responsible for
 *    the bill. Statements go to the guarantor, the family's balances are shown
 *    together, and one payment is spread across the family's balances.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { buildStatementDetail, isQmb, patientBalanceCents } from "./billing";
import { normalizeMethod } from "@/lib/utils";
import { isAdult } from "./account-review";

const { patients, patientInsurances, payers, ledgerEntries, auditLog } = schema;

/* ------------------------------ QMB ------------------------------ */

export async function setQmb(db: Db, practiceId: string, insuranceId: string, input: { qmb: boolean; verifiedOn?: string }, userId?: string) {
  const [row] = await db.select({ ins: patientInsurances, payerType: payers.type, practiceId: patients.practiceId }).from(patientInsurances)
    .innerJoin(payers, eq(payers.id, patientInsurances.payerId)).innerJoin(patients, eq(patients.id, patientInsurances.patientId))
    .where(eq(patientInsurances.id, insuranceId)).limit(1);
  if (!row || row.practiceId !== practiceId) throw new Error("Insurance not found");
  if (row.payerType !== "medicare") throw new Error("QMB status belongs on the patient's Medicare policy");
  const verifiedOn = input.qmb ? (input.verifiedOn && /^\d{4}-\d{2}-\d{2}$/.test(input.verifiedOn) ? input.verifiedOn : new Date().toISOString().slice(0, 10)) : null;
  await db.update(patientInsurances).set({ qmb: input.qmb, qmbVerifiedOn: verifiedOn }).where(eq(patientInsurances.id, insuranceId));
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "qmb_status_set", entity: "patient", entityId: row.ins.patientId, details: { qmb: input.qmb, verifiedOn } });
}

/** The patient's Medicare cost-sharing that may not be billed to them, by claim. */
export async function qmbProtected(db: Db, patientId: string) {
  const d = await buildStatementDetail(db, patientId);
  return d.qmbProtectedCents ?? 0;
}

/** What the patient can be billed: the balance less protected QMB cost-sharing. */
export async function billableBalanceCents(db: Db, patientId: string) {
  const [balance, protectedCents] = await Promise.all([patientBalanceCents(db, patientId), qmbProtected(db, patientId)]);
  return Math.max(0, balance - protectedCents);
}

/**
 * Writes off the Medicare cost-sharing a QMB patient cannot be billed, claim by
 * claim, as a discount (after Medicaid has paid what it will as secondary).
 */
export async function writeOffQmbCostSharing(db: Db, practiceId: string, patientId: string, userId?: string) {
  const [p] = await db.select({ id: patients.id }).from(patients).where(and(eq(patients.id, patientId), eq(patients.practiceId, practiceId))).limit(1);
  if (!p) throw new Error("Patient not found");
  const { rows } = await db.execute<{ claim_id: string; owed: string }>(sql`
    SELECT le.claim_id, (sum(le.amount_cents) FILTER (WHERE le.type = 'transfer_to_patient')
      - COALESCE(sum(le.amount_cents) FILTER (WHERE le.type IN ('patient_payment', 'discount', 'bad_debt')), 0)
      + COALESCE(sum(le.amount_cents) FILTER (WHERE le.type = 'refund'), 0))::text AS owed
    FROM ledger_entries le JOIN claims c ON c.id = le.claim_id JOIN payers py ON py.id = c.payer_id
    WHERE le.patient_id = ${patientId} AND py.type = 'medicare'
    GROUP BY le.claim_id`);
  if (!(await isQmb(db, patientId))) throw new Error("The patient is not marked as a Qualified Medicare Beneficiary");
  const due = rows.filter((r) => Number(r.owed) > 0);
  if (due.length) {
    await db.insert(ledgerEntries).values(due.map((r) => ({
      practiceId, patientId, claimId: r.claim_id, type: "discount", amountCents: Number(r.owed),
      note: "QMB: Medicare cost-sharing may not be billed to a Qualified Medicare Beneficiary", postedBy: userId ?? null,
    })));
  }
  const cents = due.reduce((a, r) => a + Number(r.owed), 0);
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "qmb_written_off", entity: "patient", entityId: patientId, details: { claims: due.length, cents } });
  return { claims: due.length, cents };
}

/** Patients in the practice marked as Qualified Medicare Beneficiaries. */
export async function qmbPatientIds(db: Db, practiceId: string) {
  const rows = await db.select({ id: patients.id }).from(patientInsurances).innerJoin(payers, eq(payers.id, patientInsurances.payerId)).innerJoin(patients, eq(patients.id, patientInsurances.patientId))
    .where(and(eq(patients.practiceId, practiceId), eq(patientInsurances.active, true), eq(patientInsurances.qmb, true), eq(payers.type, "medicare")));
  return new Set(rows.map((r) => r.id));
}

/* ------------------------------ Family accounts ------------------------------ */

/** Sets (or clears, with null) who is responsible for this patient's bill. */
export async function setGuarantor(db: Db, practiceId: string, patientId: string, guarantorMrn: string | null, userId?: string) {
  const [p] = await db.select().from(patients).where(and(eq(patients.id, patientId), eq(patients.practiceId, practiceId))).limit(1);
  if (!p) throw new Error("Patient not found");
  let guarantorId: string | null = null;
  if (guarantorMrn?.trim()) {
    const [g] = await db.select().from(patients).where(and(eq(patients.practiceId, practiceId), eq(patients.mrn, guarantorMrn.trim()))).limit(1);
    if (!g) throw new Error(`No patient with MRN ${guarantorMrn.trim()}; register the guarantor as a patient record first`);
    if (g.id === p.id) throw new Error("A patient cannot be their own guarantor");
    if (g.guarantorId) throw new Error(`${g.firstName} ${g.lastName} has a guarantor of their own; choose the person responsible for the family`);
    const [dependent] = await db.select({ id: patients.id }).from(patients).where(eq(patients.guarantorId, p.id)).limit(1);
    if (dependent) throw new Error("This patient is the guarantor for others, so cannot have a guarantor");
    guarantorId = g.id;
  }
  await db.update(patients).set({ guarantorId }).where(eq(patients.id, p.id));
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "guarantor_set", entity: "patient", entityId: p.id, details: { guarantorId } });
}

export type FamilyMember = { id: string; name: string; mrn: string; dob: string; guarantor: boolean; balanceCents: number };

/** The family a patient belongs to: the guarantor and everyone they are responsible for, with what each can be billed. */
export async function familyOf(db: Db, practiceId: string, patientId: string): Promise<{ guarantorId: string; members: FamilyMember[] } | null> {
  const [p] = await db.select().from(patients).where(and(eq(patients.id, patientId), eq(patients.practiceId, practiceId))).limit(1);
  if (!p) return null;
  const guarantorId = p.guarantorId ?? p.id;
  const people = await db.select().from(patients)
    .where(and(eq(patients.practiceId, practiceId), sql`(${patients.id} = ${guarantorId} OR ${patients.guarantorId} = ${guarantorId})`))
    .orderBy(asc(patients.dob));
  if (people.length < 2) return null;
  const members = await Promise.all(people.map(async (m) => ({ id: m.id, name: `${m.firstName} ${m.lastName}`, mrn: m.mrn, dob: m.dob, guarantor: m.id === guarantorId, balanceCents: await billableBalanceCents(db, m.id) })));
  members.sort((a, b) => Number(b.guarantor) - Number(a.guarantor));
  return { guarantorId, members };
}

/**
 * One payment for the family, applied to each member's balance in turn
 * (oldest date of birth first, so a parent's own balance before the
 * children's); anything left is a credit on the guarantor's account.
 */
export async function familyPayment(db: Db, practiceId: string, patientId: string, amountCents: number, method: string, userId?: string) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error("Enter the amount");
  const fam = await familyOf(db, practiceId, patientId);
  if (!fam) throw new Error("This patient has no family account; set a guarantor first");
  let left = amountCents;
  const applied: { patientId: string; cents: number }[] = [];
  const ordered = [...fam.members].sort((a, b) => a.dob.localeCompare(b.dob));
  for (const m of ordered) {
    if (left <= 0) break;
    const cents = Math.min(left, m.balanceCents);
    if (cents <= 0) continue;
    applied.push({ patientId: m.id, cents });
    left -= cents;
  }
  if (left > 0) applied.push({ patientId: fam.guarantorId, cents: left });
  await db.insert(ledgerEntries).values(applied.map((a) => ({
    practiceId, patientId: a.patientId, type: "patient_payment", amountCents: a.cents, paymentMethod: normalizeMethod(method),
    note: `Family payment (${method})`, postedBy: userId ?? null,
  })));
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "family_payment", entity: "patient", entityId: fam.guarantorId, details: { amountCents, applied } });
  return applied;
}

/**
 * Who a patient's statement is addressed to: the guarantor when there is one,
 * unless the patient is now an adult and has not agreed to that
 * (server/account-review.ts), so a parent is not sent an adult child's bills.
 */
export async function billTo(db: Db, patientId: string, now = new Date()) {
  const [p] = await db.select().from(patients).where(eq(patients.id, patientId)).limit(1);
  if (!p?.guarantorId) return null;
  if (!p.guarantorAdultConsentOn && isAdult(p.dob, now.toISOString().slice(0, 10))) return null;
  const [g] = await db.select().from(patients).where(eq(patients.id, p.guarantorId)).limit(1);
  return g ?? null;
}
