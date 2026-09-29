"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { CAN_ADJUST, requireRole } from "@/lib/auth";
import type { FormResult } from "@/components/action-form";
import { backfillRemittanceLines } from "@/server/remittance-lines";

/** Reads the service lines of remittances posted before lines were kept (500 at a time). */
export async function backfillLinesAction(_prev: FormResult): Promise<FormResult> {
  const s = await requireRole(CAN_ADJUST);
  try {
    const r = await backfillRemittanceLines(await getDb(), s.practiceId);
    revalidatePath("/reports/fee-check");
    return { ok: true, message: r.remittances ? `Read ${r.lines.toLocaleString("en-US")} lines from ${r.remittances} remittances${r.remittances === 500 ? "; run again for more" : ""}` : "Every posted remittance has been read" };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not read the remittances" };
  }
}
