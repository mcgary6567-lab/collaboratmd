/**
 * HIPAA privacy complaints. A covered entity must have a process for
 * individuals to complain about its privacy practices, and must document
 * every complaint received and its disposition (45 CFR 164.530(d)), keeping
 * that documentation for six years (164.530(j)); it may not retaliate against
 * anyone who complains (164.530(g)). Complaints here are never deleted.
 *
 * HIPAA sets no deadline for answering; the log flags complaints open longer
 * than the practice's 30-day target.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";

const { privacyComplaints, patients, auditLog } = schema;

export const CHANNELS: Record<string, string> = {
  phone: "Phone", email: "Email", letter: "Letter", in_person: "In person", portal: "Patient portal", ocr: "From HHS Office for Civil Rights",
};
export const CATEGORIES: Record<string, string> = {
  improper_disclosure: "Information shared with someone who should not have it",
  access: "Denied or delayed access to records",
  minimum_necessary: "More information used or shared than needed",
  safeguards: "Records left unsecured, lost or stolen",
  amendment: "Request to correct records refused",
  communications: "Contacted in a way the patient asked us not to",
  notice: "Notice of privacy practices not given",
  other: "Other",
};
export const FINDINGS: Record<string, string> = {
  substantiated: "Substantiated: a privacy rule was not followed",
  not_substantiated: "Not substantiated",
  inconclusive: "Inconclusive",
};
export const TARGET_DAYS = 30;

const isDay = (v: string | undefined | null) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

export async function logComplaint(db: Db, practiceId: string, input: { receivedOn: string; channel: string; complainant: string; patientMrn?: string; category: string; description: string }, userId?: string) {
  if (!isDay(input.receivedOn)) throw new Error("Enter the date the complaint was received");
  if (!CHANNELS[input.channel]) throw new Error("Choose how the complaint came in");
  if (!CATEGORIES[input.category]) throw new Error("Choose what the complaint is about");
  const complainant = input.complainant.trim().slice(0, 120);
  const description = input.description.trim().slice(0, 4000);
  if (!complainant) throw new Error("Enter who complained (the patient, a family member, or \"anonymous\")");
  if (!description) throw new Error("Describe the complaint");
  let patientId: string | null = null;
  if (input.patientMrn?.trim()) {
    const [p] = await db.select({ id: patients.id }).from(patients).where(and(eq(patients.practiceId, practiceId), eq(patients.mrn, input.patientMrn.trim()))).limit(1);
    if (!p) throw new Error(`No patient with MRN ${input.patientMrn.trim()}`);
    patientId = p.id;
  }
  const [row] = await db.insert(privacyComplaints).values({ practiceId, receivedOn: input.receivedOn, channel: input.channel, complainant, patientId, category: input.category, description, createdBy: userId ?? null }).returning();
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "privacy_complaint_logged", entity: "privacy_complaint", entityId: row.id, details: { category: input.category } });
  return row;
}

async function ownComplaint(db: Db, practiceId: string, id: string) {
  const [c] = await db.select().from(privacyComplaints).where(and(eq(privacyComplaints.id, id), eq(privacyComplaints.practiceId, practiceId))).limit(1);
  if (!c) throw new Error("Complaint not found");
  return c;
}

/** Records the investigation as it goes. */
export async function updateInvestigation(db: Db, practiceId: string, id: string, input: { investigation?: string; finding?: string; mitigation?: string; sanctions?: string }, userId?: string) {
  const c = await ownComplaint(db, practiceId, id);
  if (c.status === "closed") throw new Error("The complaint is closed");
  if (input.finding && !FINDINGS[input.finding]) throw new Error("Choose the finding");
  const text = (v: string | undefined, prev: string | null) => (v === undefined ? prev : v.trim().slice(0, 4000) || null);
  await db.update(privacyComplaints).set({
    investigation: text(input.investigation, c.investigation), finding: input.finding || c.finding,
    mitigation: text(input.mitigation, c.mitigation), sanctions: text(input.sanctions, c.sanctions),
  }).where(eq(privacyComplaints.id, id));
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "privacy_complaint_updated", entity: "privacy_complaint", entityId: id, details: { finding: input.finding ?? null } });
}

/** Closes the complaint once it is investigated and the complainant has been answered. */
export async function closeComplaint(db: Db, practiceId: string, id: string, respondedOn: string, userId?: string) {
  const c = await ownComplaint(db, practiceId, id);
  if (c.status === "closed") throw new Error("The complaint is already closed");
  if (!c.investigation || !c.finding) throw new Error("Record the investigation and the finding before closing");
  if (c.finding === "substantiated" && !c.mitigation) throw new Error("A substantiated complaint needs the steps taken to mitigate it");
  if (!isDay(respondedOn)) throw new Error("Enter the date the complainant was answered");
  if (respondedOn < c.receivedOn) throw new Error("The answer cannot be dated before the complaint");
  await db.update(privacyComplaints).set({ status: "closed", respondedOn, closedAt: new Date() }).where(eq(privacyComplaints.id, id));
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "privacy_complaint_closed", entity: "privacy_complaint", entityId: id, details: { finding: c.finding, respondedOn } });
}

export async function listComplaints(db: Db, practiceId: string, now = new Date()) {
  const rows = await db.select({ c: privacyComplaints, firstName: patients.firstName, lastName: patients.lastName }).from(privacyComplaints)
    .leftJoin(patients, eq(patients.id, privacyComplaints.patientId))
    .where(eq(privacyComplaints.practiceId, practiceId))
    .orderBy(sql`${privacyComplaints.status} = 'closed'`, desc(privacyComplaints.receivedOn)).limit(500);
  const today = now.toISOString().slice(0, 10);
  return rows.map((r) => {
    const days = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${r.c.receivedOn}T00:00:00Z`)) / 86_400_000);
    return { ...r, patient: r.lastName ? `${r.lastName}, ${r.firstName}` : null, daysOpen: days, overdue: r.c.status === "open" && days > TARGET_DAYS };
  });
}
