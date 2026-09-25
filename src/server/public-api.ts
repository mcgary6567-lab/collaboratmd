/**
 * The public REST API's data layer (routes live in app/api/v1). Responses
 * use fixed, documented shapes built here, so an internal column never
 * leaks by accident, and every query is scoped to the calling key's practice.
 */
import { and, asc, desc, eq, gte, ilike, inArray, or, type SQL } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { createPatient } from "./patients";
import { createEncounterWithClaim } from "./encounters";
import { computeFinancials } from "./claims";
import { standardCharges } from "./fees";
import { patientBalanceCents } from "./billing";

const { patients, patientInsurances, payers, claims, encounters, charges, ledgerEntries, denials, claimEvents, providers } = schema;

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const notFound = (what: string) => new ApiError(404, "not_found", `${what} not found`);

export function page(params: URLSearchParams) {
  const limit = Math.min(200, Math.max(1, Number(params.get("limit")) || 50));
  const offset = Math.max(0, Math.min(1_000_000, Number(params.get("offset")) || 0));
  return { limit, offset };
}
function paged<T>(rows: T[], limit: number, offset: number) {
  const has_more = rows.length > limit;
  return { data: rows.slice(0, limit), has_more, next_offset: has_more ? offset + limit : null };
}

/* ------------------------------ Shapes ------------------------------ */

type PatientRow = typeof patients.$inferSelect;
type ClaimRow = typeof claims.$inferSelect;

export const patientShape = (p: PatientRow) => ({
  id: p.id, mrn: p.mrn, first_name: p.firstName, last_name: p.lastName, dob: p.dob, sex: p.sex,
  phone: p.phone, email: p.email, address: { line1: p.address1, city: p.city, state: p.state, zip: p.zip },
  created_at: p.createdAt.toISOString(),
});

export const claimShape = (c: ClaimRow, extra: { patient?: PatientRow; payerName?: string; dateOfService?: string } = {}) => ({
  id: c.id, control_number: c.controlNumber, payer_claim_number: c.payerClaimNumber, status: c.status,
  frequency_code: c.frequencyCode, payer_sequence: c.payerSequence === "S" ? "secondary" : "primary",
  total_cents: c.totalCents, patient_id: c.patientId, payer_id: c.payerId,
  ...(extra.payerName ? { payer_name: extra.payerName } : {}),
  ...(extra.dateOfService ? { date_of_service: extra.dateOfService } : {}),
  submitted_at: c.submittedAt?.toISOString() ?? null, timely_filing_deadline: c.timelyFilingDeadline,
  created_at: c.createdAt.toISOString(), updated_at: c.updatedAt.toISOString(),
});

/* ------------------------------ Patients ------------------------------ */

export async function listPatients(db: Db, practiceId: string, params: URLSearchParams) {
  const { limit, offset } = page(params);
  const where: SQL[] = [eq(patients.practiceId, practiceId)];
  const q = params.get("q")?.trim();
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push(or(ilike(patients.lastName, like), ilike(patients.firstName, like), ilike(patients.mrn, like))!);
  }
  const rows = await db.select().from(patients).where(and(...where)).orderBy(asc(patients.lastName), asc(patients.firstName), asc(patients.id)).limit(limit + 1).offset(offset);
  return paged(rows.map(patientShape), limit, offset);
}

export async function getPatient(db: Db, practiceId: string, id: string) {
  if (!UUID.test(id)) throw notFound("Patient");
  const [p] = await db.select().from(patients).where(and(eq(patients.id, id), eq(patients.practiceId, practiceId))).limit(1);
  if (!p) throw notFound("Patient");
  const ins = await db
    .select({ i: patientInsurances, payerName: payers.name, payerCode: payers.payerId })
    .from(patientInsurances)
    .innerJoin(payers, eq(payers.id, patientInsurances.payerId))
    .where(eq(patientInsurances.patientId, p.id))
    .orderBy(asc(patientInsurances.rank));
  return {
    ...patientShape(p),
    balance_cents: await patientBalanceCents(db, p.id),
    insurances: ins.map(({ i, payerName, payerCode }) => ({ rank: i.rank, payer_id: i.payerId, payer_name: payerName, payer_code: payerCode, member_id: i.memberId, group_number: i.groupNumber, relationship: i.relationship, active: i.active })),
  };
}

type Json = Record<string, unknown>;
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function createPatientFromApi(db: Db, practiceId: string, body: Json) {
  const first = str(body.first_name, 80);
  const last = str(body.last_name, 80);
  const dob = str(body.dob, 10);
  const sex = str(body.sex, 1).toUpperCase() || "U";
  if (!first || !last) throw new ApiError(422, "invalid_request", "first_name and last_name are required");
  if (!DATE.test(dob) || Number.isNaN(Date.parse(dob))) throw new ApiError(422, "invalid_request", "dob must be a date like 1980-04-01");
  if (!["M", "F", "U"].includes(sex)) throw new ApiError(422, "invalid_request", "sex must be M, F or U");
  const ins = (body.insurance ?? {}) as Json;
  const payerRef = str(ins.payer_id, 60) || str(ins.payer_code, 60);
  const [payer] = payerRef
    ? await db.select().from(payers).where(and(eq(payers.practiceId, practiceId), UUID.test(payerRef) ? eq(payers.id, payerRef) : eq(payers.payerId, payerRef))).limit(1)
    : [];
  if (!payer) throw new ApiError(422, "invalid_request", "insurance.payer_id (or payer_code) must name one of the practice's payers");
  const memberId = str(ins.member_id, 40);
  if (!memberId) throw new ApiError(422, "invalid_request", "insurance.member_id is required");
  const relationship = str(ins.relationship, 10) || "self";
  if (!["self", "spouse", "child", "other"].includes(relationship)) throw new ApiError(422, "invalid_request", "insurance.relationship must be self, spouse, child or other");
  const address = (body.address ?? {}) as Json;
  const p = await createPatient(db, practiceId, {
    firstName: first, lastName: last, dob, sex, phone: str(body.phone, 30) || undefined, email: str(body.email, 200) || undefined,
    address1: str(address.line1) || undefined, city: str(address.city, 80) || undefined, state: str(address.state, 2).toUpperCase() || undefined, zip: str(address.zip, 10) || undefined,
    payerId: payer.id, memberId, groupNumber: str(ins.group_number, 40) || undefined, relationship,
    copayCents: Number.isInteger(ins.copay_cents) ? Math.max(0, Number(ins.copay_cents)) : 0,
  });
  return getPatient(db, practiceId, p.id);
}

/* ------------------------------ Claims ------------------------------ */

export async function listClaims(db: Db, practiceId: string, params: URLSearchParams) {
  const { limit, offset } = page(params);
  const where: SQL[] = [eq(claims.practiceId, practiceId)];
  const status = params.get("status");
  if (status) where.push(inArray(claims.status, status.split(",").map((s) => s.trim()).slice(0, 10)));
  const since = params.get("updated_since");
  if (since) {
    if (Number.isNaN(Date.parse(since))) throw new ApiError(422, "invalid_request", "updated_since must be an ISO date or timestamp");
    where.push(gte(claims.updatedAt, new Date(since)));
  }
  const patientId = params.get("patient_id");
  if (patientId && UUID.test(patientId)) where.push(eq(claims.patientId, patientId));
  const rows = await db
    .select({ c: claims, payerName: payers.name, dos: encounters.dateOfService })
    .from(claims)
    .innerJoin(payers, eq(payers.id, claims.payerId))
    .innerJoin(encounters, eq(encounters.id, claims.encounterId))
    .where(and(...where))
    .orderBy(desc(claims.updatedAt), desc(claims.id))
    .limit(limit + 1)
    .offset(offset);
  return paged(rows.map((r) => claimShape(r.c, { payerName: r.payerName, dateOfService: r.dos })), limit, offset);
}

export async function getClaim(db: Db, practiceId: string, id: string) {
  if (!UUID.test(id)) throw notFound("Claim");
  const [row] = await db
    .select({ c: claims, payerName: payers.name, enc: encounters })
    .from(claims)
    .innerJoin(payers, eq(payers.id, claims.payerId))
    .innerJoin(encounters, eq(encounters.id, claims.encounterId))
    .where(and(eq(claims.id, id), eq(claims.practiceId, practiceId)))
    .limit(1);
  if (!row) throw notFound("Claim");
  const ledgerClaimId = row.c.payerSequence === "S" && row.c.primaryClaimId ? row.c.primaryClaimId : row.c.id;
  const [lines, entries, events, dens] = await Promise.all([
    db.select().from(charges).where(eq(charges.encounterId, row.enc.id)).orderBy(asc(charges.lineNumber)),
    db.select({ type: ledgerEntries.type, amountCents: ledgerEntries.amountCents }).from(ledgerEntries).where(eq(ledgerEntries.claimId, ledgerClaimId)),
    db.select().from(claimEvents).where(eq(claimEvents.claimId, row.c.id)).orderBy(desc(claimEvents.at)).limit(50),
    db.select().from(denials).where(eq(denials.claimId, row.c.id)),
  ]);
  const f = computeFinancials(entries);
  return {
    ...claimShape(row.c, { payerName: row.payerName, dateOfService: row.enc.dateOfService }),
    diagnoses: row.enc.diagnoses,
    place_of_service: row.enc.placeOfService,
    provider_id: row.enc.providerId,
    lines: lines.map((l) => ({ line: l.lineNumber, cpt: l.cpt, modifiers: l.modifiers, units: l.units, charge_cents: l.chargeCents, dx_pointers: l.dxPointers })),
    scrub_findings: row.c.scrubResults,
    financials: {
      charges_cents: f.chargesCents, insurance_paid_cents: f.insurancePaidCents, adjustments_cents: f.adjustmentsCents,
      patient_responsibility_cents: f.patientRespCents, patient_paid_cents: f.patientPaidCents,
      insurance_balance_cents: f.insuranceBalanceCents, patient_balance_cents: f.patientBalanceCents,
    },
    denials: dens.map(denialShape),
    events: events.map((e) => ({ status: e.status, source: e.source, message: e.message, at: e.at.toISOString() })),
  };
}

/* ------------------------------ Encounters ------------------------------ */

/** Charges from an outside system become an encounter and a scrubbed claim, as if entered on the charge screen. */
export async function createEncounterFromApi(db: Db, practiceId: string, body: Json) {
  const patientId = str(body.patient_id, 40);
  if (!UUID.test(patientId)) throw new ApiError(422, "invalid_request", "patient_id is required");
  const [patient] = await db.select({ id: patients.id }).from(patients).where(and(eq(patients.id, patientId), eq(patients.practiceId, practiceId))).limit(1);
  if (!patient) throw new ApiError(422, "invalid_request", "patient_id is not a patient of this practice");
  const providerRef = str(body.provider_npi, 10) || str(body.provider_id, 40);
  const [provider] = providerRef
    ? await db.select({ id: providers.id }).from(providers).where(and(eq(providers.practiceId, practiceId), UUID.test(providerRef) ? eq(providers.id, providerRef) : eq(providers.npi, providerRef))).limit(1)
    : [];
  if (!provider) throw new ApiError(422, "invalid_request", "provider_npi (or provider_id) must name one of the practice's providers");
  const dos = str(body.date_of_service, 10);
  if (!DATE.test(dos) || Number.isNaN(Date.parse(dos))) throw new ApiError(422, "invalid_request", "date_of_service must be a date like 2026-09-24");
  if (dos > new Date().toISOString().slice(0, 10)) throw new ApiError(422, "invalid_request", "date_of_service cannot be in the future");
  const diagnoses = Array.isArray(body.diagnoses) ? body.diagnoses.map((d) => str(d, 10).toUpperCase()).filter(Boolean).slice(0, 12) : [];
  if (!diagnoses.length) throw new ApiError(422, "invalid_request", "diagnoses must list at least one ICD-10-CM code");
  const rawLines = Array.isArray(body.lines) ? (body.lines as Json[]).slice(0, 50) : [];
  if (!rawLines.length) throw new ApiError(422, "invalid_request", "lines must list at least one procedure");
  const fees = await standardCharges(db, practiceId);
  const lines = rawLines.map((l, i) => {
    const cpt = str(l.cpt, 5).toUpperCase();
    if (!/^[0-9A-Z]{5}$/.test(cpt)) throw new ApiError(422, "invalid_request", `lines[${i}].cpt must be a 5-character CPT or HCPCS code`);
    const units = Number.isInteger(l.units) && Number(l.units) > 0 ? Math.min(Number(l.units), 99) : 1;
    const chargeCents = Number.isInteger(l.charge_cents) && Number(l.charge_cents) > 0 ? Number(l.charge_cents) : fees.get(cpt);
    if (!chargeCents) throw new ApiError(422, "invalid_request", `lines[${i}].charge_cents is required: ${cpt} is not on the fee schedule`);
    const pointers = Array.isArray(l.dx_pointers) ? l.dx_pointers.filter((p) => Number.isInteger(p) && Number(p) >= 1 && Number(p) <= diagnoses.length).slice(0, 4).map(Number) : [1];
    const modifiers = Array.isArray(l.modifiers) ? l.modifiers.map((m) => str(m, 2).toUpperCase()).filter(Boolean).slice(0, 4) : [];
    return { cpt, modifiers, units, chargeCents, dxPointers: pointers.length ? pointers : [1] };
  });
  const pos = str(body.place_of_service, 2) || "11";
  const { encounter, claim } = await createEncounterWithClaim(db, practiceId, { patientId, providerId: provider.id, dateOfService: dos, placeOfService: pos, diagnoses, lines });
  return { encounter_id: encounter.id, claim: await getClaim(db, practiceId, claim.id) };
}

/* ------------------------------ Denials and payments ------------------------------ */

type DenialRow = typeof denials.$inferSelect;
const denialShape = (d: DenialRow) => ({
  id: d.id, claim_id: d.claimId, category: d.category, carc: d.carc, rarc: d.rarc, amount_cents: d.amountCents,
  status: d.status, explanation: d.explanation, next_steps: d.nextSteps ?? [], appeal_deadline: d.appealDeadline, created_at: d.createdAt.toISOString(),
});

export async function listDenials(db: Db, practiceId: string, params: URLSearchParams) {
  const { limit, offset } = page(params);
  const where: SQL[] = [eq(denials.practiceId, practiceId)];
  const status = params.get("status");
  if (status) where.push(inArray(denials.status, status.split(",").map((s) => s.trim()).slice(0, 10)));
  const rows = await db.select().from(denials).where(and(...where)).orderBy(desc(denials.createdAt), desc(denials.id)).limit(limit + 1).offset(offset);
  return paged(rows.map(denialShape), limit, offset);
}

export async function listPayments(db: Db, practiceId: string, params: URLSearchParams) {
  const { limit, offset } = page(params);
  const where: SQL[] = [eq(ledgerEntries.practiceId, practiceId), inArray(ledgerEntries.type, ["insurance_payment", "patient_payment", "reversal", "refund"])];
  const since = params.get("since");
  if (since) {
    if (Number.isNaN(Date.parse(since))) throw new ApiError(422, "invalid_request", "since must be an ISO date or timestamp");
    where.push(gte(ledgerEntries.postedAt, new Date(since)));
  }
  const rows = await db.select().from(ledgerEntries).where(and(...where)).orderBy(desc(ledgerEntries.postedAt), desc(ledgerEntries.id)).limit(limit + 1).offset(offset);
  return paged(rows.map((e) => ({
    id: e.id, type: e.type, amount_cents: e.amountCents, patient_id: e.patientId, claim_id: e.claimId, remittance_id: e.remittanceId,
    note: e.note, posted_at: e.postedAt.toISOString(),
  })), limit, offset);
}

