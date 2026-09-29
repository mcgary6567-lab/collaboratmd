/**
 * Refund demands: a payer's letter saying it overpaid a claim and wants the
 * money back, by a date, or it will take it from a future payment (offset,
 * or recoupment). The practice either agrees (and refunds, or lets the offset
 * happen) or disputes it in writing before the deadline. For Medicare, a
 * redetermination filed within 30 days of the demand letter stops
 * recoupment, which otherwise starts around day 41; commercial deadlines come
 * from the contract or state law, so the dates are entered from the letter.
 *
 * A takeback on a later 835 (PLB WO/72) for the claim marks its demand as
 * offset, so the same money is not refunded twice.
 */
import { and, asc, eq, inArray, lte } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { notify } from "./notifications";
import { requestRefund } from "./recovery";

const { payerRefundDemands, claims, payers, patients, patientInsurances, practices, encounters, auditLog } = schema;

const isDay = (v: string | null | undefined) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
const addDays = (iso: string, d: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);

export async function createRefundDemand(db: Db, practiceId: string, input: { claimControlNumber: string; amountCents: number; receivedOn: string; disputeBy?: string; offsetOn?: string; reference?: string; notes?: string }, userId?: string) {
  const [claim] = await db.select().from(claims).where(and(eq(claims.practiceId, practiceId), eq(claims.controlNumber, input.claimControlNumber.trim().toUpperCase()))).limit(1);
  if (!claim) throw new Error(`No claim ${input.claimControlNumber} in this practice`);
  if (!Number.isInteger(input.amountCents) || input.amountCents < 1) throw new Error("Enter the amount the payer asks for");
  if (!isDay(input.receivedOn)) throw new Error("Enter the date the letter arrived");
  const disputeBy = isDay(input.disputeBy) ? input.disputeBy! : addDays(input.receivedOn, 30);
  const [row] = await db.insert(payerRefundDemands).values({
    practiceId, claimId: claim.id, payerId: claim.payerId, amountCents: input.amountCents, receivedOn: input.receivedOn, disputeBy, offsetOn: isDay(input.offsetOn) ? input.offsetOn! : null,
    reference: input.reference?.trim().slice(0, 80) || null, notes: input.notes?.trim().slice(0, 1000) || null, createdBy: userId ?? null,
  }).returning();
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "refund_demand_received", entity: "claim", entityId: claim.id, details: { demandId: row.id, amountCents: input.amountCents } });
  return row;
}

async function own(db: Db, practiceId: string, id: string) {
  const [row] = await db.select().from(payerRefundDemands).where(and(eq(payerRefundDemands.id, id), eq(payerRefundDemands.practiceId, practiceId))).limit(1);
  if (!row) throw new Error("Refund demand not found");
  return row;
}

/**
 * Agrees with the demand: requests the refund to the payer when the claim is
 * overpaid on the books, or leaves it to the payer's offset otherwise.
 */
export async function agreeRefundDemand(db: Db, practiceId: string, id: string, userId?: string) {
  const d = await own(db, practiceId, id);
  if (d.status !== "open" && d.status !== "disputed") throw new Error(`This demand is already ${d.status}`);
  let refundId: string | null = null;
  let note: string;
  try {
    const refund = await requestRefund(db, practiceId, { payee: "payer", claimId: d.claimId, amountCents: d.amountCents, reason: `Payer refund demand${d.reference ? ` ${d.reference}` : ""}` }, userId);
    refundId = refund.id;
    note = "Refund requested; it goes through approval like any other.";
  } catch (e) {
    note = `No refund was requested (${e instanceof Error ? e.message : "not overpaid on the books"}). The payer will take it from a later payment; its takeback posts to the claim when the 835 arrives.`;
  }
  await db.update(payerRefundDemands).set({ status: "agreed", refundId }).where(eq(payerRefundDemands.id, id));
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "refund_demand_agreed", entity: "claim", entityId: d.claimId, details: { demandId: id, refundId } });
  return { refundId, note };
}

export async function disputeRefundDemand(db: Db, practiceId: string, id: string, reason: string, userId?: string) {
  const d = await own(db, practiceId, id);
  if (d.status !== "open") throw new Error(`This demand is already ${d.status}`);
  const why = reason.trim().slice(0, 1000);
  if (!why) throw new Error("Say why the payment was correct");
  await db.update(payerRefundDemands).set({ status: "disputed", notes: [d.notes, `Disputed: ${why}`].filter(Boolean).join("\n") }).where(eq(payerRefundDemands.id, id));
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "refund_demand_disputed", entity: "claim", entityId: d.claimId, details: { demandId: id } });
  return disputeLetter(db, practiceId, id, why);
}

export async function closeRefundDemand(db: Db, practiceId: string, id: string, outcome: string, userId?: string) {
  const d = await own(db, practiceId, id);
  const text = outcome.trim().slice(0, 300);
  if (!text) throw new Error("Record the outcome");
  await db.update(payerRefundDemands).set({ status: "closed", notes: [d.notes, `Closed: ${text}`].filter(Boolean).join("\n") }).where(eq(payerRefundDemands.id, id));
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "refund_demand_closed", entity: "claim", entityId: d.claimId, details: { demandId: id, outcome: text } });
}

/** The letter disputing a refund demand. */
export async function disputeLetter(db: Db, practiceId: string, id: string, reason: string) {
  const [row] = await db.select({ d: payerRefundDemands, claim: claims, payer: payers, patient: patients, ins: patientInsurances, practice: practices, dos: encounters.dateOfService })
    .from(payerRefundDemands).innerJoin(claims, eq(claims.id, payerRefundDemands.claimId)).innerJoin(payers, eq(payers.id, payerRefundDemands.payerId))
    .innerJoin(patients, eq(patients.id, claims.patientId)).innerJoin(patientInsurances, eq(patientInsurances.id, claims.patientInsuranceId))
    .innerJoin(practices, eq(practices.id, claims.practiceId)).innerJoin(encounters, eq(encounters.id, claims.encounterId))
    .where(and(eq(payerRefundDemands.id, id), eq(payerRefundDemands.practiceId, practiceId))).limit(1);
  if (!row) throw new Error("Refund demand not found");
  const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const date = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  return `${row.practice.name}
${row.practice.address1}, ${row.practice.city}, ${row.practice.state} ${row.practice.zip}
NPI ${row.practice.npi} · Tax ID ${row.practice.taxId}

${date}

${row.payer.name}
Attn: Overpayment Recovery / Provider Disputes

Re: Dispute of refund request${row.d.reference ? ` ${row.d.reference}` : ""} dated ${row.d.receivedOn}
Patient: ${row.patient.firstName} ${row.patient.lastName}, member ID ${row.ins.memberId}
Claim: ${row.claim.controlNumber}${row.claim.payerClaimNumber ? ` (payer claim ${row.claim.payerClaimNumber})` : ""}, date of service ${row.dos}
Amount requested: ${usd(row.d.amountCents)}

We dispute this refund request. ${reason}

Please withdraw the request and do not offset this amount from future payments while the dispute is reviewed. Supporting documentation is enclosed or available on request.

Sincerely,

[Name, title]
${row.practice.name}${row.practice.phone ? `\n${row.practice.phone}` : ""}`;
}

export async function listRefundDemands(db: Db, practiceId: string) {
  return db.select({ d: payerRefundDemands, controlNumber: claims.controlNumber, payerName: payers.name, patientFirst: patients.firstName, patientLast: patients.lastName })
    .from(payerRefundDemands).innerJoin(claims, eq(claims.id, payerRefundDemands.claimId)).innerJoin(payers, eq(payers.id, payerRefundDemands.payerId)).innerJoin(patients, eq(patients.id, claims.patientId))
    .where(eq(payerRefundDemands.practiceId, practiceId)).orderBy(asc(payerRefundDemands.disputeBy)).limit(300);
}

/** A takeback for a claim settles its open demand: the payer took the money itself. */
export async function markDemandOffset(db: Db, claimId: string, amountCents: number) {
  const rows = await db.select().from(payerRefundDemands).where(and(eq(payerRefundDemands.claimId, claimId), inArray(payerRefundDemands.status, ["open", "agreed"])));
  const match = rows.find((r) => r.amountCents === amountCents) ?? rows[0];
  if (match) await db.update(payerRefundDemands).set({ status: "offset" }).where(eq(payerRefundDemands.id, match.id));
  return match ?? null;
}

/** Daily: open demands whose dispute date is within 5 days or past. */
export async function refundDemandAlerts(db: Db, practiceId: string, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const rows = await db.select().from(payerRefundDemands).where(and(eq(payerRefundDemands.practiceId, practiceId), eq(payerRefundDemands.status, "open"), lte(payerRefundDemands.disputeBy, addDays(today, 5))));
  for (const d of rows) {
    await notify(db, practiceId, {
      kind: "refund_demand", href: "/refund-demands", dedupeKey: `demand:${d.id}:${d.disputeBy! < today ? "late" : "soon"}`,
      title: d.disputeBy! < today ? `The date to dispute a payer's refund demand passed (${d.disputeBy})` : `Decide on a payer's refund demand by ${d.disputeBy}`,
      body: "Agree (and refund, or let the payer offset it) or dispute it in writing before the payer takes it from a later payment.",
    });
  }
  return { dueSoon: rows.length };
}
