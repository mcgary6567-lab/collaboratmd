"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { CAN_ADJUST, requireRole } from "@/lib/auth";
import type { FormResult } from "@/components/action-form";
import { saveEnrollment } from "@/server/enrollment";

export async function saveEnrollmentAction(providerId: string, payerId: string, _prev: FormResult, formData: FormData): Promise<FormResult> {
  const s = await requireRole(CAN_ADJUST);
  const f = (k: string) => String(formData.get(k) ?? "") || null;
  try {
    const db = await getDb();
    await saveEnrollment(db, s.practiceId, {
      providerId,
      payerId,
      status: f("status") ?? "not_started",
      payerProviderId: f("payerProviderId"),
      submittedOn: f("submittedOn"),
      effectiveOn: f("effectiveOn"),
      revalidationDue: f("revalidationDue"),
      notes: f("notes"),
    }, s.userId);
    revalidatePath("/settings/enrollment");
    return { ok: true, message: "Saved" };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not save" };
  }
}
