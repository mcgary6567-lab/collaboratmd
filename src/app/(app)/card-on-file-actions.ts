"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { CAN_WRITE, requireRole } from "@/lib/auth";
import type { FormResult } from "@/components/action-form";
import { assertOwned } from "@/server/tenancy";
import { revokeCardOnFile } from "@/server/card-on-file";

export async function revokeCardOnFileAction(patientId: string, _prev: FormResult): Promise<FormResult> {
  const s = await requireRole(CAN_WRITE);
  try {
    const db = await getDb();
    await assertOwned(db, s.practiceId, "patient", patientId);
    await revokeCardOnFile(db, s.practiceId, patientId, s.userId);
    revalidatePath(`/patients/${patientId}`);
    return { ok: true, message: "Stopped. Nothing more will be charged to this card for balances; any pending charge was cancelled." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not stop it" };
  }
}
