"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { CAN_ADJUST, requireRole } from "@/lib/auth";
import type { FormResult } from "@/components/action-form";
import { sendBatchAppeal } from "@/server/batch-appeals";

export async function sendBatchAppealAction(payerId: string, carc: string, _prev: FormResult, fd: FormData): Promise<FormResult> {
  const s = await requireRole(CAN_ADJUST);
  try {
    const r = await sendBatchAppeal(await getDb(), s.practiceId, payerId, carc, String(fd.get("argument") ?? ""), s.userId);
    revalidatePath("/denials/batch");
    revalidatePath("/denials");
    return { ok: true, message: `${r.sent} denial${r.sent === 1 ? "" : "s"} marked appealed with this letter${r.held.length ? `; ${r.held.length} left out while the payer waits for their records (${r.held.join(", ")})` : ""}.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not record the appeal" };
  }
}
