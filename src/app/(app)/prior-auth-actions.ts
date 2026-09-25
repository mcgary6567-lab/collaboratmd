"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { CAN_WRITE, requireRole } from "@/lib/auth";
import type { FormResult } from "@/components/action-form";
import { requestPriorAuth } from "@/server/prior-auth";

const LABEL: Record<string, string> = {
  approved: "Approved", partial: "Approved in part", denied: "Not approved", pended: "Pended for review; a follow-up task was created",
  not_required: "No authorization required", cancelled: "Cancelled", error: "Could not be processed",
};

export async function requestPriorAuthAction(patientId: string, _prev: FormResult, formData: FormData): Promise<FormResult> {
  const s = await requireRole(CAN_WRITE);
  const f = (k: string) => String(formData.get(k) ?? "");
  try {
    const r = await requestPriorAuth(await getDb(), s.practiceId, {
      patientId, providerId: f("providerId"), cpts: f("cpts").split(/[,\s]+/), diagnoses: f("diagnoses").split(/[,\s]+/),
      units: Number(f("units")) || 1, serviceFrom: f("serviceFrom"), serviceTo: f("serviceTo") || f("serviceFrom"), placeOfService: f("pos") || "11",
    }, s.userId);
    revalidatePath(`/patients/${patientId}`);
    const ok = ["approved", "partial", "not_required", "pended"].includes(r.status);
    return { ok, message: `${LABEL[r.status] ?? r.status}${r.authNumber ? ` · ${r.status === "approved" || r.status === "partial" ? "authorization" : "reference"} ${r.authNumber}` : ""}${r.status === "error" && r.message ? `: ${r.message}` : ""}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Something went wrong" };
  }
}
