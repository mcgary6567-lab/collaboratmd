"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { CAN_ADJUST, requireRole } from "@/lib/auth";
import type { FormResult } from "@/components/action-form";
import { pollRemittances } from "@/server/era-poll";

export async function pollNowAction(_prev: FormResult): Promise<FormResult> {
  const s = await requireRole(CAN_ADJUST);
  try {
    const r = await pollRemittances(await getDb(), s.practiceId, { userId: s.userId });
    revalidatePath("/remittance");
    return { ok: true, message: r.imported ? `Posted ${r.imported} remittance${r.imported === 1 ? "" : "s"} ($${(r.paidCents / 100).toFixed(2)})` : r.seen ? `Checked ${r.seen} new transaction${r.seen === 1 ? "" : "s"}; no remittances for this practice` : "Nothing new from Stedi" };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not reach Stedi" };
  }
}
