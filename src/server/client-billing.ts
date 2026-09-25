/**
 * Invoicing client practices for billing services: a percent of what was
 * collected each month (insurance, and patient payments if the agreement
 * includes them), with an optional monthly minimum.
 *
 * Collections are net: insurance payments less recoupments, patient payments
 * less refunds. The invoice stores the figures it was built from, so it stays
 * the same if the ledger changes later.
 */
import { and, desc, eq, ne, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { periodBounds } from "./accounting";

const { clientAgreements, clientInvoices, auditLog } = schema;

export async function getAgreement(db: Db, practiceId: string) {
  const [row] = await db.select().from(clientAgreements).where(eq(clientAgreements.practiceId, practiceId)).limit(1);
  return row ?? null;
}

export async function saveAgreement(db: Db, practiceId: string, input: { issuerName: string; issuerAddress: string; ratePct: number; minimumCents: number; includePatient: boolean; termsDays: number }, userId?: string) {
  const issuerName = input.issuerName.trim().slice(0, 120);
  if (!issuerName) throw new Error("Enter your company's name as it should appear on invoices");
  if (!Number.isFinite(input.ratePct) || input.ratePct <= 0 || input.ratePct > 50) throw new Error("Enter the percent of collections (for example 6.5)");
  if (!Number.isInteger(input.minimumCents) || input.minimumCents < 0) throw new Error("Enter a monthly minimum, or 0");
  if (![0, 7, 10, 15, 30, 45, 60].includes(input.termsDays)) throw new Error("Choose payment terms");
  const values = { issuerName, issuerAddress: input.issuerAddress.trim().slice(0, 300) || null, rateBps: Math.round(input.ratePct * 100), minimumCents: input.minimumCents, includePatient: input.includePatient, termsDays: input.termsDays, updatedBy: userId ?? null, updatedAt: new Date() };
  await db.insert(clientAgreements).values({ practiceId, ...values }).onConflictDoUpdate({ target: clientAgreements.practiceId, set: values });
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "client_agreement_saved", entity: "practice", entityId: practiceId, details: { rateBps: values.rateBps, minimumCents: values.minimumCents } });
}

export async function collectionsFor(db: Db, practiceId: string, period: string) {
  const { start, end } = periodBounds(period);
  const { rows } = await db.execute<{ ins: string; pat: string }>(sql`
    SELECT
      (COALESCE(sum(amount_cents) FILTER (WHERE type = 'insurance_payment'), 0) - COALESCE(sum(amount_cents) FILTER (WHERE type = 'reversal'), 0))::text AS ins,
      (COALESCE(sum(amount_cents) FILTER (WHERE type = 'patient_payment'), 0) - COALESCE(sum(amount_cents) FILTER (WHERE type = 'refund'), 0))::text AS pat
    FROM ledger_entries WHERE practice_id = ${practiceId} AND posted_at >= ${start} AND posted_at < ${end}`);
  return { insuranceCents: Number(rows[0]?.ins ?? 0), patientCents: Number(rows[0]?.pat ?? 0) };
}

/** The fee: the rate on the collections the agreement covers, but never below the minimum. */
export function invoiceFee(insuranceCents: number, patientCents: number, rateBps: number, minimumCents: number, includePatient: boolean) {
  const base = Math.max(0, insuranceCents + (includePatient ? patientCents : 0));
  return { baseCents: base, feeCents: Math.max(minimumCents, Math.round((base * rateBps) / 10_000)) };
}

export async function createInvoice(db: Db, practiceId: string, period: string, userId?: string, now = new Date()) {
  const agreement = await getAgreement(db, practiceId);
  if (!agreement) throw new Error("Set up the billing agreement for this client first");
  const { end } = periodBounds(period);
  if (end > now) throw new Error("Invoice a month once it has ended");
  const [dupe] = await db.select({ id: clientInvoices.id }).from(clientInvoices).where(and(eq(clientInvoices.practiceId, practiceId), eq(clientInvoices.period, period), ne(clientInvoices.status, "void"))).limit(1);
  if (dupe) throw new Error("This month is already invoiced; void that invoice first to redo it");
  const c = await collectionsFor(db, practiceId, period);
  const { baseCents, feeCents } = invoiceFee(c.insuranceCents, c.patientCents, agreement.rateBps, agreement.minimumCents, agreement.includePatient);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(clientInvoices).where(eq(clientInvoices.practiceId, practiceId));
  const due = new Date(now.getTime() + agreement.termsDays * 86_400_000).toISOString().slice(0, 10);
  const [row] = await db.insert(clientInvoices).values({
    practiceId, number: `${period.replace("-", "")}-${String(Number(n) + 1).padStart(3, "0")}`, period, insuranceCents: c.insuranceCents, patientCents: c.patientCents,
    baseCents, rateBps: agreement.rateBps, feeCents, dueDate: due, issuer: { name: agreement.issuerName, address: agreement.issuerAddress }, createdBy: userId ?? null,
  }).returning();
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "client_invoice_created", entity: "client_invoice", entityId: row.id, details: { period, feeCents } });
  return row;
}

export async function setInvoiceStatus(db: Db, practiceId: string, id: string, status: "sent" | "paid" | "void", userId?: string) {
  const [inv] = await db.select().from(clientInvoices).where(and(eq(clientInvoices.id, id), eq(clientInvoices.practiceId, practiceId))).limit(1);
  if (!inv) throw new Error("Invoice not found");
  const allowed: Record<string, string[]> = { draft: ["sent", "void"], sent: ["paid", "void"], paid: [], void: [] };
  if (!allowed[inv.status].includes(status)) throw new Error(`A ${inv.status} invoice cannot be marked ${status}`);
  await db.update(clientInvoices).set({ status, ...(status === "sent" ? { sentAt: new Date() } : {}), ...(status === "paid" ? { paidAt: new Date() } : {}) }).where(eq(clientInvoices.id, id));
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: `client_invoice_${status}`, entity: "client_invoice", entityId: id });
}

export async function listInvoices(db: Db, practiceId: string) {
  return db.select().from(clientInvoices).where(eq(clientInvoices.practiceId, practiceId)).orderBy(desc(clientInvoices.period), desc(clientInvoices.createdAt)).limit(36);
}

export async function getInvoice(db: Db, id: string) {
  const [row] = await db.select({ inv: clientInvoices, practiceName: schema.practices.name, practice: schema.practices }).from(clientInvoices).innerJoin(schema.practices, eq(schema.practices.id, clientInvoices.practiceId)).where(eq(clientInvoices.id, id)).limit(1);
  return row ?? null;
}

/** The last full month, as YYYY-MM. */
export function lastMonth(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return d.toISOString().slice(0, 7);
}
