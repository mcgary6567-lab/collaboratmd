"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { CAN_WRITE, requireRole } from "@/lib/auth";
import type { FormResult } from "@/components/action-form";
import { assertOwned } from "@/server/tenancy";
import { MSP_QUESTIONS, MSP_TYPE_LABEL, recordMspScreening } from "@/server/msp";

export async function mspScreeningAction(patientId: string, _prev: FormResult, fd: FormData): Promise<FormResult> {
  const s = await requireRole(CAN_WRITE);
  const db = await getDb();
  try {
    await assertOwned(db, s.practiceId, "patient", patientId);
    const r = await recordMspScreening(db, s.practiceId, patientId, Object.fromEntries(MSP_QUESTIONS.map((q) => [q.key, fd.get(q.key) === "yes"])), s.userId);
    revalidatePath(`/patients/${patientId}`);
    return { ok: true, message: r.medicarePrimary ? "Medicare pays first." : `Medicare pays second (${MSP_TYPE_LABEL[r.mspType ?? ""]}). Bill the other plan first.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not save" };
  }
}
