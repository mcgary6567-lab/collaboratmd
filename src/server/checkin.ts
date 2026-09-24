/**
 * Digital check-in.
 *
 * Staff create a link for an appointment and send it to the patient. The link
 * carries a random token; only its SHA-256 is stored. Opening it reveals the
 * practice name and nothing else until the patient confirms their date of
 * birth, and five wrong answers lock the link. The patient then confirms
 * contact details and insurance, accepts the practice's notices, and sees the
 * copay they can expect. What they submit waits for staff review; nothing is
 * written into the chart until someone applies it.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import type { CheckinConsents, CheckinDemographics, CheckinInsurance } from "@/db/schema";
import { runEligibility } from "./patients";

const { checkinLinks, checkinSubmissions, appointments, patients, patientInsurances, payers, practices, eligibilityChecks } = schema;

export const MAX_ATTEMPTS = 5;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newToken(): string {
  return randomBytes(24).toString("base64url");
}

/** Same date, however the patient typed it: 1980-02-29, 02/29/1980 or 2/29/1980. */
export function normalizeDob(input: string): string | null {
  const v = input.trim();
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
}

/* ----------------------------- Staff side ----------------------------- */

export async function createCheckinLink(db: Db, practiceId: string, appointmentId: string, userId?: string) {
  const [appt] = await db
    .select()
    .from(appointments)
    .where(and(eq(appointments.id, appointmentId), eq(appointments.practiceId, practiceId)))
    .limit(1);
  if (!appt) throw new Error("Appointment not found");
  if (["cancelled", "completed", "no_show"].includes(appt.status)) throw new Error(`The appointment is ${appt.status.replace("_", " ")}`);
  // Usable until the end of the visit day, and never for less than an hour.
  const expiresAt = new Date(Math.max(appt.startsAt.getTime() + 12 * 3_600_000, Date.now() + 3_600_000));
  if (appt.startsAt.getTime() + 12 * 3_600_000 < Date.now()) throw new Error("The appointment has already passed");

  // One live link per appointment: sending a new one retires the old.
  await db
    .update(checkinLinks)
    .set({ revokedAt: new Date() })
    .where(and(eq(checkinLinks.appointmentId, appointmentId), isNull(checkinLinks.completedAt), isNull(checkinLinks.revokedAt)));
  const token = newToken();
  const [link] = await db
    .insert(checkinLinks)
    .values({ practiceId, appointmentId, patientId: appt.patientId, tokenHash: hashToken(token), expiresAt, createdBy: userId ?? null })
    .returning();
  await db.insert(schema.auditLog).values({ practiceId, userId: userId ?? null, action: "create_checkin_link", entity: "appointment", entityId: appointmentId });
  const [patient] = await db.select({ email: patients.email, firstName: patients.firstName }).from(patients).where(eq(patients.id, appt.patientId)).limit(1);
  return { link, token, path: `/check-in/${token}`, patient };
}

/** The latest link and submission for each appointment, for the schedule. */
export async function checkinStatus(db: Db, appointmentIds: string[]) {
  const out = new Map<string, { link?: typeof checkinLinks.$inferSelect; submission?: typeof checkinSubmissions.$inferSelect }>();
  if (!appointmentIds.length) return out;
  const links = await db.select().from(checkinLinks).where(inArray(checkinLinks.appointmentId, appointmentIds)).orderBy(asc(checkinLinks.createdAt));
  for (const l of links) out.set(l.appointmentId, { ...out.get(l.appointmentId), link: l });
  const subs = await db.select().from(checkinSubmissions).where(inArray(checkinSubmissions.appointmentId, appointmentIds)).orderBy(asc(checkinSubmissions.createdAt));
  for (const s of subs) out.set(s.appointmentId, { ...out.get(s.appointmentId), submission: s });
  return out;
}

/* ---------------------------- Patient side ---------------------------- */

export type LinkState =
  | { state: "invalid" }
  | { state: "expired" | "locked" | "completed"; practiceName: string }
  | { state: "open"; link: typeof checkinLinks.$inferSelect; practiceName: string; practicePhone: string | null };

/** What the link may show before the patient has proved who they are: only the practice. */
export async function openLink(db: Db, token: string): Promise<LinkState> {
  if (!token || token.length < 20 || token.length > 64) return { state: "invalid" };
  const [row] = await db
    .select({ link: checkinLinks, practiceName: practices.name, practicePhone: practices.phone })
    .from(checkinLinks)
    .innerJoin(practices, eq(practices.id, checkinLinks.practiceId))
    .where(eq(checkinLinks.tokenHash, hashToken(token)))
    .limit(1);
  if (!row || row.link.revokedAt) return { state: "invalid" };
  if (row.link.completedAt) return { state: "completed", practiceName: row.practiceName };
  if (row.link.lockedAt) return { state: "locked", practiceName: row.practiceName };
  if (row.link.expiresAt.getTime() < Date.now()) return { state: "expired", practiceName: row.practiceName };
  return { state: "open", link: row.link, practiceName: row.practiceName, practicePhone: row.practicePhone };
}

export async function verifyDob(db: Db, token: string, dobInput: string): Promise<{ ok: true; linkId: string } | { ok: false; message: string }> {
  const opened = await openLink(db, token);
  if (opened.state !== "open") return { ok: false, message: "This check-in link can no longer be used. Please call the office." };
  const dob = normalizeDob(dobInput);
  const [patient] = await db.select({ dob: patients.dob }).from(patients).where(eq(patients.id, opened.link.patientId)).limit(1);
  if (opened.link.failedAttempts >= MAX_ATTEMPTS) return { ok: false, message: "This check-in link is locked. Please call the office." };
  if (dob && patient && dob === patient.dob) {
    await db.update(checkinLinks).set({ verifiedAt: new Date() }).where(eq(checkinLinks.id, opened.link.id));
    return { ok: true, linkId: opened.link.id };
  }
  // Incremented in the database, so simultaneous guesses cannot share one count.
  const [updated] = await db
    .update(checkinLinks)
    .set({ failedAttempts: sql`${checkinLinks.failedAttempts} + 1` })
    .where(eq(checkinLinks.id, opened.link.id))
    .returning();
  const attempts = updated.failedAttempts;
  const locked = attempts >= MAX_ATTEMPTS;
  if (locked) await db.update(checkinLinks).set({ lockedAt: new Date() }).where(eq(checkinLinks.id, opened.link.id));
  if (locked) return { ok: false, message: "That date of birth does not match our records. For your security this link is now locked; please call the office." };
  return { ok: false, message: `That date of birth does not match our records. ${MAX_ATTEMPTS - attempts} ${MAX_ATTEMPTS - attempts === 1 ? "try" : "tries"} left.` };
}

/** Everything the form shows, for a link the patient has verified. */
export async function loadCheckin(db: Db, linkId: string) {
  const [row] = await db
    .select({ link: checkinLinks, appt: appointments, patient: patients, practiceName: practices.name, practicePhone: practices.phone, providerLast: schema.providers.lastName, providerFirst: schema.providers.firstName })
    .from(checkinLinks)
    .innerJoin(appointments, eq(appointments.id, checkinLinks.appointmentId))
    .innerJoin(schema.providers, eq(schema.providers.id, appointments.providerId))
    .innerJoin(patients, eq(patients.id, checkinLinks.patientId))
    .innerJoin(practices, eq(practices.id, checkinLinks.practiceId))
    .where(eq(checkinLinks.id, linkId))
    .limit(1);
  if (!row) return null;
  const [ins] = await db
    .select({ ins: patientInsurances, payerName: payers.name })
    .from(patientInsurances)
    .innerJoin(payers, eq(payers.id, patientInsurances.payerId))
    .where(and(eq(patientInsurances.patientId, row.patient.id), eq(patientInsurances.active, true)))
    .orderBy(asc(patientInsurances.rank))
    .limit(1);
  const [check] = ins
    ? await db.select().from(eligibilityChecks).where(eq(eligibilityChecks.patientInsuranceId, ins.ins.id)).orderBy(desc(eligibilityChecks.checkedAt)).limit(1)
    : [];
  const copayCents = check?.status === "active" && check.copayCents !== null ? check.copayCents : ins?.ins.copayCents || null;
  return { ...row, insurance: ins ?? null, copayCents, coverageActive: check ? check.status === "active" : null };
}

export interface CheckinInput {
  demographics: CheckinDemographics;
  insurance: CheckinInsurance;
  consents: Omit<CheckinConsents, "signedAt">;
}

export function validateCheckin(input: CheckinInput): string | null {
  const c = input.consents;
  if (!c.privacyNotice || !c.financialPolicy || !c.assignmentOfBenefits) return "Please review and accept each notice to finish checking in";
  if (c.signature.trim().length < 3) return "Type your full name as your signature";
  if (input.demographics.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.demographics.email)) return "Enter a valid email address";
  if (input.demographics.zip && !/^\d{5}(-\d{4})?$/.test(input.demographics.zip)) return "Enter a 5-digit ZIP code";
  if (!input.insurance.sameAsOnFile && (!input.insurance.payerName.trim() || !input.insurance.memberId.trim())) {
    return "Enter the insurance company and member ID from your new card";
  }
  return null;
}

export async function submitCheckin(db: Db, linkId: string, input: CheckinInput) {
  const problem = validateCheckin(input);
  if (problem) throw new Error(problem);
  const [link] = await db.select().from(checkinLinks).where(eq(checkinLinks.id, linkId)).limit(1);
  if (!link || link.completedAt || link.revokedAt || link.lockedAt || !link.verifiedAt || link.expiresAt.getTime() < Date.now()) {
    throw new Error("This check-in link can no longer be used. Please call the office.");
  }
  const clean = (v: string) => v.trim().slice(0, 200);
  const [submission] = await db
    .insert(checkinSubmissions)
    .values({
      practiceId: link.practiceId, linkId, appointmentId: link.appointmentId, patientId: link.patientId,
      demographics: {
        phone: clean(input.demographics.phone), email: clean(input.demographics.email), address1: clean(input.demographics.address1),
        city: clean(input.demographics.city), state: clean(input.demographics.state).toUpperCase().slice(0, 2), zip: clean(input.demographics.zip),
      },
      insurance: {
        sameAsOnFile: input.insurance.sameAsOnFile, payerName: clean(input.insurance.payerName), memberId: clean(input.insurance.memberId),
        groupNumber: clean(input.insurance.groupNumber), relationship: clean(input.insurance.relationship) || "self",
      },
      consents: { ...input.consents, signature: clean(input.consents.signature), signedAt: new Date().toISOString() },
    })
    .returning();
  await db.update(checkinLinks).set({ completedAt: new Date() }).where(eq(checkinLinks.id, linkId));
  await db.insert(schema.auditLog).values({ practiceId: link.practiceId, userId: null, action: "patient_checkin", entity: "appointment", entityId: link.appointmentId, details: { submissionId: submission.id } });
  return submission;
}

/* ----------------------------- Review ----------------------------- */

export interface FieldChange { field: string; label: string; from: string; to: string }

const LABELS: Record<keyof CheckinDemographics, string> = { phone: "Phone", email: "Email", address1: "Address", city: "City", state: "State", zip: "ZIP" };

/** What the patient changed, ignoring blanks (a blank means "no answer", not "erase"). */
export function demographicChanges(current: Partial<Record<keyof CheckinDemographics, string | null>>, submitted: CheckinDemographics): FieldChange[] {
  const norm = (v: string | null | undefined) => (v ?? "").trim();
  return (Object.keys(LABELS) as (keyof CheckinDemographics)[])
    .filter((k) => norm(submitted[k]) !== "" && norm(submitted[k]).toLowerCase() !== norm(current[k]).toLowerCase())
    .map((k) => ({ field: k, label: LABELS[k], from: norm(current[k]), to: norm(submitted[k]) }));
}

export async function listCheckins(db: Db, practiceId: string, status = "pending") {
  const rows = await db
    .select({ submission: checkinSubmissions, patient: patients, appt: appointments })
    .from(checkinSubmissions)
    .innerJoin(patients, eq(patients.id, checkinSubmissions.patientId))
    .innerJoin(appointments, eq(appointments.id, checkinSubmissions.appointmentId))
    .where(and(eq(checkinSubmissions.practiceId, practiceId), eq(checkinSubmissions.status, status)))
    .orderBy(asc(appointments.startsAt))
    .limit(200);
  const out = [];
  for (const r of rows) {
    const [ins] = await db
      .select({ ins: patientInsurances, payerName: payers.name })
      .from(patientInsurances)
      .innerJoin(payers, eq(payers.id, patientInsurances.payerId))
      .where(and(eq(patientInsurances.patientId, r.patient.id), eq(patientInsurances.active, true)))
      .orderBy(asc(patientInsurances.rank))
      .limit(1);
    out.push({ ...r, insurance: ins ?? null, changes: demographicChanges(r.patient, r.submission.demographics) });
  }
  return out;
}

/**
 * Writes a reviewed check-in into the chart. Contact changes are applied as
 * submitted. A new card under the same payer updates the member and group
 * numbers and re-checks eligibility; a different insurance company cannot be
 * matched to a payer automatically, so it is left for staff to add.
 */
export async function applyCheckin(db: Db, practiceId: string, submissionId: string, userId?: string) {
  const [row] = await db
    .select({ submission: checkinSubmissions, patient: patients })
    .from(checkinSubmissions)
    .innerJoin(patients, eq(patients.id, checkinSubmissions.patientId))
    .where(and(eq(checkinSubmissions.id, submissionId), eq(checkinSubmissions.practiceId, practiceId)))
    .limit(1);
  if (!row) throw new Error("Check-in not found");
  if (row.submission.status !== "pending") throw new Error("This check-in was already reviewed");
  const changes = demographicChanges(row.patient, row.submission.demographics);
  if (changes.length) {
    await db.update(patients).set(Object.fromEntries(changes.map((c) => [c.field, c.to]))).where(eq(patients.id, row.patient.id));
  }
  const notes: string[] = changes.map((c) => `${c.label} updated`);
  const ins = row.submission.insurance;
  if (!ins.sameAsOnFile) {
    const [current] = await db
      .select({ ins: patientInsurances, payerName: payers.name })
      .from(patientInsurances)
      .innerJoin(payers, eq(payers.id, patientInsurances.payerId))
      .where(and(eq(patientInsurances.patientId, row.patient.id), eq(patientInsurances.active, true)))
      .orderBy(asc(patientInsurances.rank))
      .limit(1);
    const samePayer = current && current.payerName.toLowerCase().replace(/\W/g, "") === ins.payerName.toLowerCase().replace(/\W/g, "");
    if (samePayer) {
      await db.update(patientInsurances).set({ memberId: ins.memberId, groupNumber: ins.groupNumber || null }).where(eq(patientInsurances.id, current.ins.id));
      const check = await runEligibility(db, current.ins.id);
      notes.push(`Member ID updated; eligibility re-checked: ${check.status}`);
    } else {
      notes.push(`New insurance reported (${ins.payerName}, member ${ins.memberId}): add it on the patient's page`);
    }
  }
  await db.update(checkinSubmissions).set({ status: "applied", reviewedBy: userId ?? null, reviewedAt: new Date() }).where(eq(checkinSubmissions.id, submissionId));
  await db.insert(schema.auditLog).values({ practiceId, userId: userId ?? null, action: "apply_checkin", entity: "patient", entityId: row.patient.id, details: { submissionId, notes } });
  return notes;
}

export async function dismissCheckin(db: Db, practiceId: string, submissionId: string, userId?: string) {
  await db
    .update(checkinSubmissions)
    .set({ status: "dismissed", reviewedBy: userId ?? null, reviewedAt: new Date() })
    .where(and(eq(checkinSubmissions.id, submissionId), eq(checkinSubmissions.practiceId, practiceId), eq(checkinSubmissions.status, "pending")));
}
