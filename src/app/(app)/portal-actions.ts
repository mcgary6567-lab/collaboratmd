"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN_WRITE, requireRole } from "@/lib/auth";
import { siteOrigin } from "@/lib/origin";
import { createPortalLink } from "@/server/portal";
import { messagePatient } from "@/server/messaging";
import { assertOwned } from "@/server/tenancy";
import type { LinkResult } from "./checkin-actions";

/** A fresh portal link for the patient, texted or emailed where possible, and shown to copy. */
export async function sendPortalLinkAction(patientId: string, purpose: "portal" | "pay", _prev: LinkResult): Promise<LinkResult> {
  const s = await requireRole(CAN_WRITE);
  try {
    const db = await getDb();
    const { path, patient } = await createPortalLink(db, s.practiceId, patientId, s.userId, purpose);
    const url = `${await siteOrigin()}${path}`;
    const [practice] = await db.select({ name: schema.practices.name }).from(schema.practices).where(eq(schema.practices.id, s.practiceId)).limit(1);
    const what = purpose === "pay" ? "view and pay your balance" : "see your account, statements and payments";
    const r = await messagePatient(db, patient, {
      kind: purpose === "pay" ? "pay_link" : "portal_link",
      sms: `${practice.name}: ${what} at ${url} . Reply STOP to opt out.`,
      email: { subject: `Your account with ${practice.name}`, text: `Hi ${patient.firstName},\n\nYou can ${what} here:\n\n${url}\n\nThe link asks for your date of birth and works for 30 days.\n\n${practice.name}` },
    });
    const sent = [r.sms === "sent" && "texted", r.email === "sent" && "emailed"].filter(Boolean).join(" and ");
    return { ok: true, url, message: sent ? `Link ${sent} to the patient.` : `Copy the link and send it to the patient (${r.reason?.toLowerCase() ?? "no channel available"}).` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Something went wrong" };
  }
}

/** Records (or withdraws) the patient's consent to receive texts. */
export async function smsConsentAction(patientId: string, consent: boolean): Promise<void> {
  const s = await requireRole(CAN_WRITE);
  const db = await getDb();
  await assertOwned(db, s.practiceId, "patient", patientId);
  await db.update(schema.patients).set({ smsConsentAt: consent ? new Date() : null }).where(and(eq(schema.patients.id, patientId), eq(schema.patients.practiceId, s.practiceId)));
  await db.insert(schema.auditLog).values({ practiceId: s.practiceId, userId: s.userId, action: consent ? "sms_consent_recorded" : "sms_consent_withdrawn", entity: "patient", entityId: patientId });
  revalidatePath(`/patients/${patientId}`);
}

export async function remindersOptOutAction(patientId: string, optOut: boolean): Promise<void> {
  const s = await requireRole(CAN_WRITE);
  const db = await getDb();
  await assertOwned(db, s.practiceId, "patient", patientId);
  await db.update(schema.patients).set({ remindersOptOut: optOut }).where(and(eq(schema.patients.id, patientId), eq(schema.patients.practiceId, s.practiceId)));
  revalidatePath(`/patients/${patientId}`);
}
