/**
 * Referrals from the patient's primary care physician, which HMO plans
 * require before a specialist visit. Each referral has a number, a date range
 * and usually a number of visits. The number goes on the claim (REF*9F, box 23
 * on paper); visits are counted from the patient's encounters with claims to
 * that payer inside the range. A payer marked as requiring referrals gets a
 * scrub warning, and a schedule-check warning, when none covers the visit.
 */
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import type { ScrubFinding } from "@/lib/scrub/rules";

const { patientReferrals, patients, payers, auditLog } = schema;

const isDay = (v: string | undefined | null) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

export async function addReferral(db: Db, practiceId: string, input: { patientId: string; payerId: string; referralNumber: string; referringName?: string; referringNpi?: string; visitsAllowed?: number | null; startsOn: string; endsOn: string; notes?: string }, userId?: string) {
  const [p] = await db.select({ id: patients.id }).from(patients).where(and(eq(patients.id, input.patientId), eq(patients.practiceId, practiceId))).limit(1);
  if (!p) throw new Error("Patient not found");
  const [payer] = await db.select({ id: payers.id }).from(payers).where(and(eq(payers.id, input.payerId), eq(payers.practiceId, practiceId))).limit(1);
  if (!payer) throw new Error("Choose the plan that requires the referral");
  const number = input.referralNumber.trim().slice(0, 50);
  if (!number) throw new Error("Enter the referral number");
  if (input.referringNpi && !/^\d{10}$/.test(input.referringNpi.trim())) throw new Error("The referring physician's NPI is 10 digits");
  if (!isDay(input.startsOn) || !isDay(input.endsOn) || input.endsOn < input.startsOn) throw new Error("Enter the dates the referral is good for");
  if (input.visitsAllowed !== null && input.visitsAllowed !== undefined && (!Number.isInteger(input.visitsAllowed) || input.visitsAllowed < 1 || input.visitsAllowed > 999)) throw new Error("Visits allowed is a whole number");
  const [row] = await db.insert(patientReferrals).values({
    practiceId, patientId: input.patientId, payerId: input.payerId, referralNumber: number, referringName: input.referringName?.trim().slice(0, 120) || null,
    referringNpi: input.referringNpi?.trim() || null, visitsAllowed: input.visitsAllowed ?? null, startsOn: input.startsOn, endsOn: input.endsOn, notes: input.notes?.trim().slice(0, 500) || null, createdBy: userId ?? null,
  }).returning();
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "referral_added", entity: "patient", entityId: input.patientId, details: { referralId: row.id, payerId: input.payerId } });
  return row;
}

/** Visits counted against a referral: the patient's encounters billed to its payer inside its dates (other than one being excluded). */
async function visitsUsed(db: Db, r: { patientId: string; payerId: string; startsOn: string; endsOn: string }, excludeEncounterId?: string) {
  const [{ n }] = (await db.execute<{ n: string }>(sql`
    SELECT count(DISTINCT e.id)::text AS n FROM encounters e JOIN claims c ON c.encounter_id = e.id
    WHERE e.patient_id = ${r.patientId} AND c.payer_id = ${r.payerId} AND c.status NOT IN ('void', 'voided')
      AND e.date_of_service BETWEEN ${r.startsOn} AND ${r.endsOn} ${excludeEncounterId ? sql`AND e.id <> ${excludeEncounterId}` : sql``}`)).rows;
  return Number(n);
}

/** The patient's referrals with visits used and left. */
export async function referralsFor(db: Db, patientId: string) {
  const rows = await db.select({ r: patientReferrals, payer: payers.name }).from(patientReferrals).innerJoin(payers, eq(payers.id, patientReferrals.payerId))
    .where(eq(patientReferrals.patientId, patientId)).orderBy(desc(patientReferrals.endsOn));
  return Promise.all(rows.map(async (x) => {
    const used = await visitsUsed(db, x.r);
    return { ...x, used, left: x.r.visitsAllowed === null ? null : x.r.visitsAllowed - used };
  }));
}

/** The referral that covers a visit: the payer's, in date, with a visit left (counting the others). */
export async function referralFor(db: Db, c: { patientId: string; payerId: string; dateOfService: string; encounterId?: string }) {
  const rows = await db.select().from(patientReferrals)
    .where(and(eq(patientReferrals.patientId, c.patientId), eq(patientReferrals.payerId, c.payerId), lte(patientReferrals.startsOn, c.dateOfService), gte(patientReferrals.endsOn, c.dateOfService)))
    .orderBy(asc(patientReferrals.endsOn));
  for (const r of rows) {
    if (r.visitsAllowed === null || (await visitsUsed(db, r, c.encounterId)) < r.visitsAllowed) return r;
  }
  return null;
}

/** Scrub: a payer that requires referrals, and none covers this visit. */
export async function referralFindings(db: Db, c: { patientId: string; payerId: string; requiresReferral: boolean; dateOfService: string; encounterId: string }): Promise<ScrubFinding[]> {
  if (!c.requiresReferral) return [];
  if (await referralFor(db, c)) return [];
  const [any] = await db.select({ id: patientReferrals.id }).from(patientReferrals)
    .where(and(eq(patientReferrals.patientId, c.patientId), eq(patientReferrals.payerId, c.payerId), lte(patientReferrals.startsOn, c.dateOfService), gte(patientReferrals.endsOn, c.dateOfService))).limit(1);
  return [{
    rule: "REFERRAL_MISSING", severity: "warning", field: "referral",
    message: any ? "This plan requires a referral, and the patient's referral for this date has no visits left. Ask the primary care physician for a new one." : "This plan requires a referral from the primary care physician, and none on file covers this date. Add it on the patient's page; without it the plan denies the claim.",
  }];
}

/** Referrals ending within `days`, or with one visit or none left, for the follow-up list. */
export async function referralsRunningOut(db: Db, practiceId: string, days = 14, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const until = new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10);
  const rows = await db.select({ r: patientReferrals, payer: payers.name, firstName: patients.firstName, lastName: patients.lastName }).from(patientReferrals)
    .innerJoin(payers, eq(payers.id, patientReferrals.payerId)).innerJoin(patients, eq(patients.id, patientReferrals.patientId))
    .where(and(eq(patientReferrals.practiceId, practiceId), gte(patientReferrals.endsOn, today))).orderBy(asc(patientReferrals.endsOn)).limit(500);
  const out = [];
  for (const x of rows) {
    const used = await visitsUsed(db, x.r);
    const left = x.r.visitsAllowed === null ? null : x.r.visitsAllowed - used;
    if (x.r.endsOn <= until || (left !== null && left <= 1)) out.push({ ...x, used, left });
  }
  return out;
}
