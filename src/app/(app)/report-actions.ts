"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { CAN_ADJUST, requireRole } from "@/lib/auth";
import type { FormResult } from "@/components/action-form";
import { deleteReport, saveReport } from "@/server/report-builder";

export async function saveReportAction(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const s = await requireRole(CAN_ADJUST);
  const f = (k: string) => String(formData.get(k) ?? "");
  let id: string;
  try {
    const row = await saveReport(await getDb(), s.practiceId, {
      id: f("id") || null,
      name: f("name"),
      dataset: f("dataset"),
      config: { columns: formData.getAll("col").map(String), group: f("group") || null, range: f("range"), payerId: f("payer") || null, providerId: f("provider") || null, status: f("status") || null },
      schedule: f("schedule"),
      recipients: f("recipients").split(/[,;\s]+/),
    }, s.userId);
    id = row.id;
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not save" };
  }
  revalidatePath("/reports/builder");
  redirect(`/reports/builder?id=${id}&saved=1`);
}

export async function deleteReportAction(id: string, _prev: FormResult): Promise<FormResult> {
  const s = await requireRole(CAN_ADJUST);
  await deleteReport(await getDb(), s.practiceId, id, s.userId);
  revalidatePath("/reports/builder");
  redirect("/reports/builder");
}
