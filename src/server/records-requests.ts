/**
 * Payer requests for medical records: a Medicare contractor's additional
 * documentation request (ADR), a Recovery Audit Contractor or Targeted Probe
 * and Educate review, or a commercial audit. Missing the due date means the
 * claim is denied (or the payment taken back) for lack of documentation, so
 * each request is tracked to a due date, and the claim is held from appeals
 * and write-offs until the records have gone.
 */
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { notify } from "./notifications";
import { recordDisclosure } from "./disclosures";

const { recordsRequests, claims, patients, payers, auditLog } = schema;

export const REQUEST_KINDS: Record<string, { label: string; days: number }> = {
  adr: { label: "Medicare additional documentation request (ADR)", days: 45 },
  rac: { label: "Recovery Audit Contractor (RAC) review", days: 45 },
  tpe: { label: "Targeted Probe and Educate (TPE) review", days: 45 },
  commercial_audit: { label: "Commercial payer audit or records request", days: 30 },
  other: { label: "Other records request", days: 30 },
};

const isDay = (v: string | null | undefined) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

export async function createRecordsRequest(db: Db, practiceId: string, input: { kind: string; claimControlNumber?: string; reference?: string; receivedOn: string; dueOn?: string; notes?: string }, userId?: string) {
  const kind = REQUEST_KINDS[input.kind];
  if (!kind) throw new Error("Choose what kind of request this is");
  if (!isDay(input.receivedOn)) throw new Error("Enter the date the request arrived");
  const dueOn = input.dueOn?.trim() ? input.dueOn : addDays(input.receivedOn, kind.days);
  if (!isDay(dueOn) || dueOn < input.receivedOn) throw new Error("The due date must be on or after the date it arrived");
  let claim: typeof claims.$inferSelect | null = null;
  if (input.claimControlNumber?.trim()) {
    [claim] = await db.select().from(claims).where(and(eq(claims.practiceId, practiceId), eq(claims.controlNumber, input.claimControlNumber.trim().toUpperCase()))).limit(1);
    if (!claim) throw new Error(`No claim ${input.claimControlNumber} in this practice`);
  }
  const [row] = await db.insert(recordsRequests).values({
    practiceId, kind: input.kind, claimId: claim?.id ?? null, patientId: claim?.patientId ?? null, payerId: claim?.payerId ?? null,
    reference: input.reference?.trim().slice(0, 80) || null, receivedOn: input.receivedOn, dueOn, notes: input.notes?.trim().slice(0, 1000) || null, createdBy: userId ?? null,
  }).returning();
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "records_request_created", entity: "records_request", entityId: row.id, details: { kind: input.kind, claimId: claim?.id ?? null, dueOn } });
  return row;
}

export async function markRecordsSent(db: Db, practiceId: string, id: string, input: { sentOn: string; sentVia: string }, userId?: string) {
  if (!isDay(input.sentOn)) throw new Error("Enter the date the records were sent");
  const via = input.sentVia.trim().slice(0, 80);
  if (!via) throw new Error("Say how they were sent (esMD, the payer's portal, fax, mail with tracking)");
  const [row] = await db.update(recordsRequests).set({ status: "sent", sentOn: input.sentOn, sentVia: via }).where(and(eq(recordsRequests.id, id), eq(recordsRequests.practiceId, practiceId))).returning();
  if (!row) throw new Error("Request not found");
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "records_sent", entity: "records_request", entityId: id, details: { sentOn: input.sentOn, via } });
  // In the disclosure log (for payment, so not in the patient's accounting).
  if (row.patientId) {
    const [payer] = row.payerId ? await db.select({ name: payers.name }).from(payers).where(eq(payers.id, row.payerId)).limit(1) : [];
    await recordDisclosure(db, practiceId, {
      patientId: row.patientId, disclosedOn: input.sentOn, recipient: payer?.name ?? "The payer", purpose: "payment",
      description: `Medical records for a ${REQUEST_KINDS[row.kind]?.label ?? "records request"}${row.reference ? ` (${row.reference})` : ""}, sent by ${via}`, source: "records_request", sourceId: id,
    }, userId);
  }
  return row;
}

export async function closeRecordsRequest(db: Db, practiceId: string, id: string, outcome: string, userId?: string) {
  const text = outcome.trim().slice(0, 300);
  if (!text) throw new Error("Record the outcome (for example: payment upheld, or $120 taken back)");
  const [row] = await db.update(recordsRequests).set({ status: "closed", outcome: text }).where(and(eq(recordsRequests.id, id), eq(recordsRequests.practiceId, practiceId))).returning();
  if (!row) throw new Error("Request not found");
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "records_request_closed", entity: "records_request", entityId: id, details: { outcome: text } });
}

export async function listRecordsRequests(db: Db, practiceId: string) {
  return db.select({ r: recordsRequests, controlNumber: claims.controlNumber, patientFirst: patients.firstName, patientLast: patients.lastName, payerName: payers.name })
    .from(recordsRequests)
    .leftJoin(claims, eq(claims.id, recordsRequests.claimId))
    .leftJoin(patients, eq(patients.id, recordsRequests.patientId))
    .leftJoin(payers, eq(payers.id, recordsRequests.payerId))
    .where(eq(recordsRequests.practiceId, practiceId))
    .orderBy(sql`CASE ${recordsRequests.status} WHEN 'open' THEN 0 WHEN 'sent' THEN 1 ELSE 2 END`, asc(recordsRequests.dueOn))
    .limit(300);
}

/** The open request on a claim, if any: its records have not been sent yet. */
export async function openRequestFor(db: Db, claimId: string) {
  const [row] = await db.select().from(recordsRequests).where(and(eq(recordsRequests.claimId, claimId), eq(recordsRequests.status, "open"))).orderBy(asc(recordsRequests.dueOn)).limit(1);
  return row ?? null;
}

/** Stops an appeal or a write-off on a claim whose records the payer is still waiting for. */
export async function assertNoOpenRequest(db: Db, claimId: string, what: string) {
  const open = await openRequestFor(db, claimId);
  if (open) throw new Error(`The payer is waiting for this claim's medical records (due ${open.dueOn}). Send them and mark the request sent before you ${what}.`);
}

/** Daily: a notice for each open request due within 7 days or late. */
export async function recordsRequestAlerts(db: Db, practiceId: string, now = new Date()) {
  const soon = addDays(now.toISOString().slice(0, 10), 7);
  const rows = await db.select().from(recordsRequests).where(and(eq(recordsRequests.practiceId, practiceId), inArray(recordsRequests.status, ["open"]), lte(recordsRequests.dueOn, soon)));
  const today = now.toISOString().slice(0, 10);
  for (const r of rows) {
    const late = r.dueOn < today;
    await notify(db, practiceId, {
      kind: "records_request", href: "/records-requests", dedupeKey: `records:${r.id}:${late ? "late" : "soon"}`,
      title: late ? `Medical records for a ${REQUEST_KINDS[r.kind]?.label ?? "records request"} were due ${r.dueOn}` : `Medical records due ${r.dueOn} (${REQUEST_KINDS[r.kind]?.label ?? "records request"})`,
      body: "Without them the claim is denied or the payment taken back. Send the records and mark the request sent.",
    });
  }
  return { dueSoon: rows.length };
}
