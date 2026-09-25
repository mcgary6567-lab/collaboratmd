"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { CAN_WRITE, requireRole } from "@/lib/auth";
import type { FormResult } from "@/components/action-form";
import { editClaim, type ClaimEdit } from "@/server/claim-edit";

export async function editClaimAction(claimId: string, _prev: FormResult, formData: FormData): Promise<FormResult> {
  const s = await requireRole(CAN_WRITE);
  try {
    const edit = JSON.parse(String(formData.get("payload") ?? "{}")) as ClaimEdit;
    const db = await getDb();
    await editClaim(db, s.practiceId, claimId, edit, s.userId);
  } catch (e) {
    return { ok: false, message: e instanceof SyntaxError ? "The form could not be read" : e instanceof Error ? e.message : "Something went wrong" };
  }
  revalidatePath(`/claims/${claimId}`);
  revalidatePath("/claims");
  redirect(`/claims/${claimId}`);
}
