"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN_WRITE, requireRole } from "@/lib/auth";
import type { FormResult } from "@/components/action-form";
import { applyCheckin, createCheckinLink, dismissCheckin } from "@/server/checkin";
import { sendCheckinLink } from "@/server/notify";
import { siteOrigin } from "@/lib/origin";

export type LinkResult = (FormResult & { url?: string }) | undefined;

/** Creates a fresh check-in link for an appointment, emailing it when email is configured. */
export async function createCheckinLinkAction(appointmentId: string, _prev: LinkResult): Promise<LinkResult> {
  const s = await requireRole(CAN_WRITE);
  try {
    const db = await getDb();
    const created = await createCheckinLink(db, s.practiceId, appointmentId, s.userId);
    const url = `${await siteOrigin()}${created.path}`;
    let sent = false;
    if (created.patient?.email) {
      const [practice] = await db.select({ name: schema.practices.name }).from(schema.practices).where(eq(schema.practices.id, s.practiceId)).limit(1);
      const [appt] = await db.select({ startsAt: schema.appointments.startsAt }).from(schema.appointments).where(eq(schema.appointments.id, appointmentId)).limit(1);
      sent = await sendCheckinLink(created.patient.email, {
        firstName: created.patient.firstName, practiceName: practice.name, url,
        when: appt.startsAt.toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }),
      });
    }
    revalidatePath("/scheduling");
    return {
      ok: true,
      url,
      message: sent
        ? `Emailed to ${created.patient!.email}. Any earlier link for this visit no longer works.`
        : "Copy the link and send it to the patient by text or email. Any earlier link for this visit no longer works.",
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Something went wrong" };
  }
}

export async function applyCheckinAction(submissionId: string, _prev: FormResult): Promise<FormResult> {
  const s = await requireRole(CAN_WRITE);
  try {
    const db = await getDb();
    const notes = await applyCheckin(db, s.practiceId, submissionId, s.userId);
    revalidatePath("/check-ins");
    revalidatePath("/scheduling");
    return { ok: true, message: notes.length ? notes.join(". ") : "Nothing changed; marked reviewed" };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Something went wrong" };
  }
}

export async function dismissCheckinAction(submissionId: string): Promise<void> {
  const s = await requireRole(CAN_WRITE);
  const db = await getDb();
  await dismissCheckin(db, s.practiceId, submissionId, s.userId);
  revalidatePath("/check-ins");
}
