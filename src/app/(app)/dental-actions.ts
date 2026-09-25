"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { CAN_WRITE, requireRole } from "@/lib/auth";
import type { FormResult } from "@/components/action-form";
import { assertOwned } from "@/server/tenancy";
import { createDentalClaim } from "@/server/dental";
import { addAttachment, removeAttachment } from "@/server/attachments";

export async function createDentalAction(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const s = await requireRole(CAN_WRITE);
  const f = (k: string) => String(formData.get(k) ?? "").trim();
  const all = (k: string) => formData.getAll(k).map(String);
  const [cdt, tooth, surfaces, area, fee] = [all("cdt"), all("tooth"), all("surfaces"), all("area"), all("fee")];
  let claimId: string;
  try {
    const db = await getDb();
    const patientId = f("patientId");
    if (!patientId) return { ok: false, message: "Choose the patient" };
    await assertOwned(db, s.practiceId, "patient", patientId);
    const claim = await createDentalClaim(db, s.practiceId, {
      patientId, providerId: f("providerId"), dateOfService: f("dos"), placeOfService: f("pos") || "11",
      diagnoses: f("diagnoses").split(/[,\s]+/),
      lines: cdt.map((c, i) => ({ cdt: c, tooth: tooth[i], surfaces: surfaces[i], oralCavity: area[i], units: 1, chargeCents: Math.round(Number(String(fee[i] ?? "").replace(/[$,]/g, "")) * 100) || 0 })).filter((l) => l.cdt.trim()),
    }, s.userId);
    claimId = claim.id;
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not create the claim" };
  }
  redirect(`/claims/${claimId}`);
}

export async function addAttachmentAction(claimId: string, _prev: FormResult, formData: FormData): Promise<FormResult> {
  const s = await requireRole(CAN_WRITE);
  const file = formData.get("file");
  if (!(file instanceof File) || !file.size) return { ok: false, message: "Choose the file" };
  try {
    const r = await addAttachment(await getDb(), s.practiceId, claimId, { name: file.name, type: file.type, bytes: Buffer.from(await file.arrayBuffer()) }, { reportType: String(formData.get("reportType") ?? ""), transmission: String(formData.get("transmission") ?? "") }, s.userId);
    revalidatePath(`/claims/${claimId}`);
    return { ok: true, message: `Attached. Control number ${r.controlNumber} goes on the claim; quote it when sending the document.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not attach the file" };
  }
}

export async function removeAttachmentAction(id: string, claimId: string, _prev: FormResult): Promise<FormResult> {
  const s = await requireRole(CAN_WRITE);
  try {
    await removeAttachment(await getDb(), s.practiceId, id, s.userId);
    revalidatePath(`/claims/${claimId}`);
    return { ok: true, message: "Removed" };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not remove it" };
  }
}
