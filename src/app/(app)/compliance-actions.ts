"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { requireRole } from "@/lib/auth";
import type { FormResult } from "@/components/action-form";
import { recordAccessReview, saveVendor } from "@/server/compliance";

const PATH = "/settings/compliance";

export async function accessReviewAction(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const s = await requireRole(["admin"]);
  const r = await recordAccessReview(await getDb(), s.practiceId, String(formData.get("notes") ?? ""), s.userId);
  revalidatePath(PATH);
  return { ok: true, message: `Access review recorded for ${r.usersReviewed} users` };
}

export async function saveVendorAction(id: string | null, _prev: FormResult, formData: FormData): Promise<FormResult> {
  const s = await requireRole(["admin"]);
  const f = (k: string) => String(formData.get(k) ?? "");
  try {
    await saveVendor(await getDb(), s.practiceId, { id, vendor: f("vendor"), service: f("service"), handlesPhi: formData.get("handlesPhi") === "on", baaStatus: f("baaStatus"), signedOn: f("signedOn") || null, notes: f("notes") || null }, s.userId);
    revalidatePath(PATH);
    return { ok: true, message: "Saved" };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not save" };
  }
}
