"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { CAN_WRITE, requireRole } from "@/lib/auth";
import type { FormResult } from "@/components/action-form";
import { markMailed } from "@/server/paper-claim";

export async function markMailedAction(claimId: string, _prev: FormResult): Promise<FormResult> {
  const s = await requireRole(CAN_WRITE);
  try {
    await markMailed(await getDb(), s.practiceId, claimId, s.userId);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not save" };
  }
  revalidatePath(`/claims/${claimId}`);
  return { ok: true, message: "Marked as mailed. Follow-up and timely filing now count from today." };
}
