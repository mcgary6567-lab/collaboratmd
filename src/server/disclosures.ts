/**
 * HIPAA privacy requests and the disclosure log.
 *
 *  - Disclosures (45 CFR 164.528): every time a patient's information leaves
 *    the practice, with the date, the recipient, what was sent and why. Those
 *    for treatment, payment or health care operations, to the patient, or with
 *    the patient's written authorization are logged but left out of the
 *    accounting a patient can ask for; the rest (public health, oversight
 *    agencies, law enforcement, court orders, workers' compensation and so on)
 *    are in it, for six years.
 *  - Access requests (164.524): a patient asking for a copy of their records
 *    has an answer due in 30 days, extendable once by 30 days with a written
 *    reason; a request for an accounting of disclosures is due in 60 days,
 *    extendable once by 30. The fee for a copy is limited to a reasonable,
 *    cost-based amount; the first accounting in 12 months is free.
 *
 * Payer records requests (ADRs, audits) are for payment, so sending them is
 * logged here automatically but not included in the accounting.
 */
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { notify } from "./notifications";

const { disclosures, accessRequests, patients, auditLog } = schema;

export const PURPOSES: Record<string, { label: string; accountable: boolean }> = {
  treatment: { label: "Treatment", accountable: false },
  payment: { label: "Payment (claims, payer reviews and audits)", accountable: false },
  operations: { label: "Health care operations", accountable: false },
  to_patient: { label: "To the patient or their personal representative", accountable: false },
  authorized: { label: "With the patient's written authorization", accountable: false },
  public_health: { label: "Public health reporting", accountable: true },
  health_oversight: { label: "Health oversight agency (for example OIG, a state board)", accountable: true },
  law_enforcement: { label: "Law enforcement", accountable: true },
  judicial: { label: "Court order or subpoena", accountable: true },
  workers_comp: { label: "Workers' compensation", accountable: true },
  abuse_report: { label: "Report of abuse, neglect or domestic violence", accountable: true },
  required_by_law: { label: "Otherwise required by law", accountable: true },
  research: { label: "Research without authorization (waiver)", accountable: true },
  decedent: { label: "Coroner, medical examiner or funeral director", accountable: true },
  other: { label: "Other", accountable: true },
};

export const ACCOUNTING_YEARS = 6;
const isDay = (v: string | null | undefined) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

async function patientIn(db: Db, practiceId: string, patientId: string) {
  const [p] = await db.select({ id: patients.id }).from(patients).where(and(eq(patients.id, patientId), eq(patients.practiceId, practiceId))).limit(1);
  if (!p) throw new Error("Patient not found");
}

export async function patientByMrn(db: Db, practiceId: string, mrn: string) {
  const [p] = await db.select({ id: patients.id }).from(patients).where(and(eq(patients.practiceId, practiceId), eq(patients.mrn, mrn.trim()))).limit(1);
  if (!p) throw new Error(`No patient with MRN ${mrn.trim()} in this practice`);
  return p.id;
}

export async function recordDisclosure(db: Db, practiceId: string, input: { patientId: string; disclosedOn: string; recipient: string; recipientAddress?: string; purpose: string; description: string; source?: string; sourceId?: string }, userId?: string) {
  await patientIn(db, practiceId, input.patientId);
  if (!PURPOSES[input.purpose]) throw new Error("Choose the purpose of the disclosure");
  if (!isDay(input.disclosedOn)) throw new Error("Enter the date it was disclosed");
  const recipient = input.recipient.trim().slice(0, 200);
  const description = input.description.trim().slice(0, 1000);
  if (!recipient) throw new Error("Enter who received it");
  if (!description) throw new Error("Describe what was disclosed (for example: office notes, 3/2026 to 6/2026)");
  if (input.sourceId) {
    const [already] = await db.select({ id: disclosures.id }).from(disclosures).where(and(eq(disclosures.source, input.source ?? "manual"), eq(disclosures.sourceId, input.sourceId))).limit(1);
    if (already) return already;
  }
  const [row] = await db.insert(disclosures).values({
    practiceId, patientId: input.patientId, disclosedOn: input.disclosedOn, recipient, recipientAddress: input.recipientAddress?.trim().slice(0, 300) || null,
    purpose: input.purpose, description, source: input.source ?? "manual", sourceId: input.sourceId ?? null, createdBy: userId ?? null,
  }).returning();
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "disclosure_recorded", entity: "patient", entityId: input.patientId, details: { disclosureId: row.id, purpose: input.purpose } });
  return row;
}

/** The accounting a patient can ask for: accountable disclosures in the six years before the request. */
export async function accountingOfDisclosures(db: Db, practiceId: string, patientId: string, asOf = new Date().toISOString().slice(0, 10)) {
  await patientIn(db, practiceId, patientId);
  const from = `${Number(asOf.slice(0, 4)) - ACCOUNTING_YEARS}${asOf.slice(4)}`;
  const accountable = Object.entries(PURPOSES).filter(([, p]) => p.accountable).map(([k]) => k);
  const rows = await db.select().from(disclosures)
    .where(and(eq(disclosures.practiceId, practiceId), eq(disclosures.patientId, patientId), inArray(disclosures.purpose, accountable), gte(disclosures.disclosedOn, from), lte(disclosures.disclosedOn, asOf)))
    .orderBy(desc(disclosures.disclosedOn));
  return { from, to: asOf, rows };
}

export async function disclosuresFor(db: Db, practiceId: string, patientId?: string, limit = 100) {
  return db.select({ d: disclosures, firstName: patients.firstName, lastName: patients.lastName, mrn: patients.mrn }).from(disclosures)
    .innerJoin(patients, eq(patients.id, disclosures.patientId))
    .where(and(eq(disclosures.practiceId, practiceId), patientId ? eq(disclosures.patientId, patientId) : undefined))
    .orderBy(desc(disclosures.disclosedOn), desc(disclosures.createdAt)).limit(limit);
}

/* ------------------------------ Access requests ------------------------------ */

export const ACCESS_KINDS: Record<string, { label: string; days: number }> = {
  copy: { label: "Copy of their records", days: 30 },
  accounting: { label: "Accounting of disclosures", days: 60 },
};

export async function createAccessRequest(db: Db, practiceId: string, input: { patientId: string; kind: string; receivedOn: string; format?: string; deliverTo?: string; notes?: string }, userId?: string) {
  await patientIn(db, practiceId, input.patientId);
  const kind = ACCESS_KINDS[input.kind];
  if (!kind) throw new Error("Choose what the patient asked for");
  if (!isDay(input.receivedOn)) throw new Error("Enter the date the request arrived");
  const [row] = await db.insert(accessRequests).values({
    practiceId, patientId: input.patientId, kind: input.kind, receivedOn: input.receivedOn, dueOn: addDays(input.receivedOn, kind.days),
    format: input.format?.trim().slice(0, 80) || null, deliverTo: input.deliverTo?.trim().slice(0, 300) || null, notes: input.notes?.trim().slice(0, 1000) || null, createdBy: userId ?? null,
  }).returning();
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "access_request_created", entity: "patient", entityId: input.patientId, details: { requestId: row.id, kind: input.kind, dueOn: row.dueOn } });
  return row;
}

async function openRequest(db: Db, practiceId: string, id: string) {
  const [r] = await db.select().from(accessRequests).where(and(eq(accessRequests.id, id), eq(accessRequests.practiceId, practiceId))).limit(1);
  if (!r) throw new Error("Request not found");
  if (r.status !== "open") throw new Error("This request is already closed");
  return r;
}

/** One extension of 30 days, before the first deadline, with the reason given to the patient in writing. */
export async function extendAccessRequest(db: Db, practiceId: string, id: string, reason: string, today = new Date().toISOString().slice(0, 10), userId?: string) {
  const r = await openRequest(db, practiceId, id);
  if (r.extendedOn) throw new Error("A request can be extended only once");
  if (today > r.dueOn) throw new Error("The extension has to be given before the request is due");
  const why = reason.trim().slice(0, 500);
  if (!why) throw new Error("Give the reason for the delay; the patient must be told it in writing");
  const [row] = await db.update(accessRequests).set({ extendedOn: today, extensionReason: why, dueOn: addDays(r.dueOn, 30) }).where(eq(accessRequests.id, id)).returning();
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "access_request_extended", entity: "patient", entityId: r.patientId, details: { requestId: id, dueOn: row.dueOn } });
  return row;
}

export async function completeAccessRequest(db: Db, practiceId: string, id: string, input: { completedOn: string; feeCents: number; sentTo?: string; description?: string }, userId?: string) {
  const r = await openRequest(db, practiceId, id);
  if (!isDay(input.completedOn)) throw new Error("Enter the date it was provided");
  if (!Number.isInteger(input.feeCents) || input.feeCents < 0 || input.feeCents > 100_000) throw new Error("Enter the fee charged (a reasonable, cost-based amount; $0 if none)");
  if (r.kind === "accounting" && input.feeCents > 0) {
    const since = addDays(input.completedOn, -365);
    const earlier = await db.select({ id: accessRequests.id }).from(accessRequests)
      .where(and(eq(accessRequests.patientId, r.patientId), eq(accessRequests.kind, "accounting"), eq(accessRequests.status, "completed"), gte(accessRequests.completedOn, since))).limit(1);
    if (!earlier.length) throw new Error("The first accounting in any 12 months is free");
  }
  const [row] = await db.update(accessRequests).set({ status: "completed", completedOn: input.completedOn, feeCents: input.feeCents }).where(eq(accessRequests.id, id)).returning();
  if (r.kind === "copy") {
    await recordDisclosure(db, practiceId, { patientId: r.patientId, disclosedOn: input.completedOn, recipient: input.sentTo?.trim() || r.deliverTo || "The patient", purpose: "to_patient", description: input.description?.trim() || `Copy of records (${r.format ?? "as requested"})`, source: "access_request", sourceId: id }, userId);
  }
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "access_request_completed", entity: "patient", entityId: r.patientId, details: { requestId: id, feeCents: input.feeCents, late: input.completedOn > r.dueOn } });
  return row;
}

export async function denyAccessRequest(db: Db, practiceId: string, id: string, reason: string, userId?: string) {
  const r = await openRequest(db, practiceId, id);
  const why = reason.trim().slice(0, 500);
  if (!why) throw new Error("Give the reason for the denial; the patient must be told it in writing, with how to have it reviewed");
  const [row] = await db.update(accessRequests).set({ status: "denied", denialReason: why, completedOn: new Date().toISOString().slice(0, 10) }).where(eq(accessRequests.id, id)).returning();
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "access_request_denied", entity: "patient", entityId: r.patientId, details: { requestId: id } });
  return row;
}

export async function listAccessRequests(db: Db, practiceId: string, status: "open" | "closed" = "open") {
  return db.select({ r: accessRequests, firstName: patients.firstName, lastName: patients.lastName, mrn: patients.mrn }).from(accessRequests)
    .innerJoin(patients, eq(patients.id, accessRequests.patientId))
    .where(and(eq(accessRequests.practiceId, practiceId), status === "open" ? eq(accessRequests.status, "open") : inArray(accessRequests.status, ["completed", "denied"])))
    .orderBy(status === "open" ? accessRequests.dueOn : desc(accessRequests.completedOn)).limit(200);
}

/** Reminders for patient requests due within 7 days or overdue (once a day at most, per request). */
export async function accessRequestAlerts(db: Db, practiceId: string, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const soon = addDays(today, 7);
  const open = await db.select({ r: accessRequests, firstName: patients.firstName, lastName: patients.lastName }).from(accessRequests)
    .innerJoin(patients, eq(patients.id, accessRequests.patientId))
    .where(and(eq(accessRequests.practiceId, practiceId), eq(accessRequests.status, "open"), lte(accessRequests.dueOn, soon)));
  for (const { r, firstName, lastName } of open) {
    const late = r.dueOn < today;
    await notify(db, practiceId, {
      kind: "access_request", title: `${late ? "Overdue" : "Due soon"}: ${ACCESS_KINDS[r.kind]?.label ?? "records request"} for ${firstName} ${lastName}, due ${r.dueOn}`,
      body: late ? "HIPAA gives 30 days (60 for an accounting), with one 30-day extension given in writing before the due date." : `Provide it, extend it once with a written reason, or deny it in writing by ${r.dueOn}.`,
      href: "/privacy-requests", dedupeKey: `access_request:${r.id}:${today}`,
    });
  }
  return open.length;
}
