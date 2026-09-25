/**
 * Searchable, sortable, paged lists. The demo practice has over 100,000
 * claims and 15,000 patients, so filtering, sorting and paging happen in
 * SQL; the page receives one screen of rows and the total.
 */
import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";

const { claims, patients, payers, encounters, denials } = schema;

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export const CLAIM_STATUS_GROUPS: Record<string, string[]> = {
  open: ["draft", "scrub_errors", "ready", "submitted", "accepted", "pending", "rejected", "denied", "partially_paid", "billed_secondary"],
  needs_work: ["scrub_errors", "rejected", "denied"],
};

export interface ClaimQuery {
  q?: string;
  status?: string;
  payerId?: string;
  from?: string;
  to?: string;
  sort?: string;
  dir?: string;
  offset: number;
  limit: number;
}

export async function searchClaims(db: Db, practiceId: string, p: ClaimQuery) {
  const where: SQL[] = [eq(claims.practiceId, practiceId)];
  if (p.status) where.push(CLAIM_STATUS_GROUPS[p.status] ? inArray(claims.status, CLAIM_STATUS_GROUPS[p.status]) : eq(claims.status, p.status));
  if (p.payerId && /^[0-9a-f-]{36}$/i.test(p.payerId)) where.push(eq(claims.payerId, p.payerId));
  if (p.from && /^\d{4}-\d{2}-\d{2}$/.test(p.from)) where.push(gte(encounters.dateOfService, p.from));
  if (p.to && /^\d{4}-\d{2}-\d{2}$/.test(p.to)) where.push(lte(encounters.dateOfService, p.to));
  const q = p.q?.trim();
  if (q) {
    const like = `${escapeLike(q)}%`;
    where.push(or(
      ilike(claims.controlNumber, like), ilike(claims.payerClaimNumber, like), ilike(patients.lastName, like), ilike(patients.mrn, like),
      sql`lower(${patients.lastName} || ', ' || ${patients.firstName}) LIKE lower(${like})`,
    )!);
  }
  const cond = and(...where);
  const dir = p.dir === "asc" ? asc : desc;
  const order = {
    dos: [dir(encounters.dateOfService)], amount: [dir(claims.totalCents)], status: [dir(claims.status)],
    patient: [dir(patients.lastName), dir(patients.firstName)], payer: [dir(payers.name)], tf: [dir(claims.timelyFilingDeadline)],
    claim: [dir(claims.controlNumber)],
  }[p.sort ?? ""] ?? [desc(claims.createdAt)];

  const base = db.select({ n: sql<number>`count(*)::int` }).from(claims)
    .innerJoin(patients, eq(patients.id, claims.patientId))
    .innerJoin(payers, eq(payers.id, claims.payerId))
    .innerJoin(encounters, eq(encounters.id, claims.encounterId))
    .where(cond);
  const [[{ n }], rows] = await Promise.all([
    base,
    db.select({ claim: claims, patient: patients, payer: payers, encounter: encounters }).from(claims)
      .innerJoin(patients, eq(patients.id, claims.patientId))
      .innerJoin(payers, eq(payers.id, claims.payerId))
      .innerJoin(encounters, eq(encounters.id, claims.encounterId))
      .where(cond)
      .orderBy(...order, desc(claims.id))
      .limit(p.limit)
      .offset(p.offset),
  ]);
  return { rows, total: Number(n) };
}

export async function searchPatients(db: Db, practiceId: string, p: { q?: string; sort?: string; dir?: string; offset: number; limit: number }) {
  const where: SQL[] = [eq(patients.practiceId, practiceId)];
  const q = p.q?.trim();
  if (q) {
    const like = `${escapeLike(q)}%`;
    where.push(or(
      ilike(patients.lastName, like), ilike(patients.firstName, like), ilike(patients.mrn, like), ilike(patients.phone, `%${escapeLike(q)}%`),
      sql`lower(${patients.lastName} || ', ' || ${patients.firstName}) LIKE lower(${like})`,
      sql`lower(${patients.firstName} || ' ' || ${patients.lastName}) LIKE lower(${like})`,
    )!);
  }
  const cond = and(...where);
  const dir = p.dir === "asc" ? asc : desc;
  const order = { name: [dir(patients.lastName), dir(patients.firstName)], mrn: [dir(patients.mrn)], dob: [dir(patients.dob)], created: [dir(patients.createdAt)] }[p.sort ?? ""]
    ?? [asc(patients.lastName), asc(patients.firstName)];
  const [[{ n }], rows] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(patients).where(cond),
    db.select().from(patients).where(cond).orderBy(...order, asc(patients.id)).limit(p.limit).offset(p.offset),
  ]);
  return { rows, total: Number(n) };
}

export async function searchDenials(db: Db, practiceId: string, p: { q?: string; status?: string; category?: string; sort?: string; dir?: string; offset: number; limit: number }) {
  const where: SQL[] = [eq(denials.practiceId, practiceId)];
  if (p.status === "open") where.push(inArray(denials.status, ["open", "in_progress", "appealed"]));
  else if (p.status) where.push(eq(denials.status, p.status));
  if (p.category) where.push(eq(denials.category, p.category));
  const q = p.q?.trim();
  if (q) {
    const like = `${escapeLike(q)}%`;
    where.push(or(ilike(claims.controlNumber, like), ilike(patients.lastName, like), ilike(denials.carc, like), ilike(payers.name, like))!);
  }
  const cond = and(...where);
  const dir = p.dir === "asc" ? asc : desc;
  const order = { amount: [dir(denials.amountCents)], deadline: [dir(denials.appealDeadline)], created: [dir(denials.createdAt)], carc: [dir(denials.carc)] }[p.sort ?? ""]
    ?? [sql`${denials.appealDeadline} ASC NULLS LAST`];
  const from = () => db.select({ denial: denials, claim: claims, patient: patients, payer: payers }).from(denials)
    .innerJoin(claims, eq(claims.id, denials.claimId))
    .innerJoin(patients, eq(patients.id, claims.patientId))
    .innerJoin(payers, eq(payers.id, claims.payerId));
  const [[{ n }], rows] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(denials)
      .innerJoin(claims, eq(claims.id, denials.claimId))
      .innerJoin(patients, eq(patients.id, claims.patientId))
      .innerJoin(payers, eq(payers.id, claims.payerId))
      .where(cond),
    from().where(cond).orderBy(...order, desc(denials.id)).limit(p.limit).offset(p.offset),
  ]);
  return { rows, total: Number(n) };
}
