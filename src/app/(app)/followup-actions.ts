"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { CAN_WRITE, requireRole } from "@/lib/auth";
import type { FormResult } from "@/components/action-form";
import { checkClaimStatus, runFollowUp } from "@/server/followup";
import { assertOwned } from "@/server/tenancy";

const LABELS: Record<string, string> = {
  wait: "still in process", post_era: "paid, remittance to post", work_denial: "decided without payment",
  send_info: "waiting on information", fix_and_resubmit: "to fix and resubmit", call_payer: "to call the payer",
};

export async function runFollowUpAction(_prev: FormResult): Promise<FormResult> {
  const s = await requireRole(CAN_WRITE);
  try {
    const db = await getDb();
    const r = await runFollowUp(db, s.practiceId);
    revalidatePath("/claims/follow-up");
    if (!r.checked) return { ok: true, message: "Nothing due: every unpaid claim was checked in the last week" };
    const parts = Object.entries(r.tally).map(([k, v]) => `${v} ${LABELS[k] ?? k}`);
    return { ok: true, message: `Asked payers about ${r.checked} claims: ${parts.join(", ")}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Something went wrong" };
  }
}

export async function checkStatusAction(claimId: string): Promise<void> {
  const s = await requireRole(CAN_WRITE);
  const db = await getDb();
  await assertOwned(db, s.practiceId, "claim", claimId);
  await checkClaimStatus(db, claimId);
  revalidatePath("/claims/follow-up");
  revalidatePath(`/claims/${claimId}`);
}
