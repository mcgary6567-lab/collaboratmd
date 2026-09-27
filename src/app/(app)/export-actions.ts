"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { requireRole } from "@/lib/auth";
import type { FormResult } from "@/components/action-form";
import { queueExport, runExport } from "@/server/export-jobs";

export async function prepareExportAction(_prev: FormResult): Promise<FormResult> {
  const s = await requireRole(["admin"]);
  try {
    const db = await getDb();
    const job = await queueExport(db, s.practiceId, s.userId);
    // The zip is built after this response, so the page does not wait on it.
    after(async () => {
      await runExport(await getDb(), job.id).catch((e) => console.error("background export failed", e instanceof Error ? e.message : e));
    });
    revalidatePath("/settings/data-export");
    return { ok: true, message: "Preparing the export. You'll get a notification when it's ready; it usually takes a few minutes." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not start the export" };
  }
}
