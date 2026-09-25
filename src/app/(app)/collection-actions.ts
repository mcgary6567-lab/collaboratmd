"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { CAN_ADJUST, requireRole } from "@/lib/auth";
import { siteOrigin } from "@/lib/origin";
import type { FormResult } from "@/components/action-form";
import { closeCollection, placeWithAgency, sendFinalNotice } from "@/server/collections";

const PATH = "/billing/collections";
const fail = (e: unknown): FormResult => ({ ok: false, message: e instanceof Error ? e.message : "Something went wrong" });

export async function finalNoticeAction(patientId: string, _prev: FormResult): Promise<FormResult> {
  const s = await requireRole(CAN_ADJUST);
  try {
    const db = await getDb();
    // Without a site address there is no pay link to send; the notice is still recorded for printing.
    const origin = await siteOrigin().catch(() => undefined);
    const { delivery } = await sendFinalNotice(db, s.practiceId, patientId, { userId: s.userId, origin });
    revalidatePath(PATH);
    const sent = delivery && (delivery.email === "sent" || delivery.sms === "sent");
    return { ok: true, message: sent ? "Final notice sent. Print the letter to mail it as well." : `Final notice recorded${delivery?.reason ? ` (${delivery.reason})` : ""}. Print the letter and mail it.` };
  } catch (e) {
    return fail(e);
  }
}

export async function placeAction(collectionId: string, _prev: FormResult, formData: FormData): Promise<FormResult> {
  const s = await requireRole(CAN_ADJUST);
  try {
    const db = await getDb();
    await placeWithAgency(db, s.practiceId, collectionId, String(formData.get("agency") ?? ""), { userId: s.userId });
    revalidatePath(PATH);
    return { ok: true, message: "Placed with the agency and written off as bad debt" };
  } catch (e) {
    return fail(e);
  }
}

export async function closeAction(collectionId: string, _prev: FormResult, formData: FormData): Promise<FormResult> {
  const s = await requireRole(CAN_ADJUST);
  const outcome = formData.get("outcome") === "recalled" ? "recalled" : "settled";
  const recovered = Math.round(Number(String(formData.get("recovered") ?? "0").replace(/[$,]/g, "") || 0) * 100);
  if (!Number.isFinite(recovered)) return { ok: false, message: "Enter the amount recovered" };
  try {
    const db = await getDb();
    await closeCollection(db, s.practiceId, collectionId, outcome, recovered, { userId: s.userId, note: String(formData.get("note") ?? "") || undefined });
    revalidatePath(PATH);
    return { ok: true, message: outcome === "recalled" ? "Recalled; the unrecovered balance is back on the patient's account" : "Closed" };
  } catch (e) {
    return fail(e);
  }
}
