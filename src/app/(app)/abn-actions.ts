"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { CAN_WRITE, requireRole } from "@/lib/auth";
import type { FormResult } from "@/components/action-form";
import { assertOwned } from "@/server/tenancy";
import { createAbn, parseAbnServices, recordAbnChoice } from "@/server/abn";

const fail = (e: unknown): FormResult => ({ ok: false, message: e instanceof Error ? e.message : "Something went wrong" });

export async function createAbnAction(patientId: string, _prev: FormResult, fd: FormData): Promise<FormResult> {
  const s = await requireRole(CAN_WRITE);
  try {
    const db = await getDb();
    await assertOwned(db, s.practiceId, "patient", patientId);
    await createAbn(db, s.practiceId, { patientId, serviceDate: String(fd.get("serviceDate") ?? ""), services: parseAbnServices(String(fd.get("services") ?? "")), reason: String(fd.get("reason") ?? "") }, s.userId);
    revalidatePath(`/patients/${patientId}`);
    return { ok: true, message: "Notice prepared. Copy its details onto form CMS-R-131, have the patient choose and sign, then record the choice here." };
  } catch (e) {
    return fail(e);
  }
}

export async function abnChoiceAction(id: string, patientId: string, _prev: FormResult, fd: FormData): Promise<FormResult> {
  const s = await requireRole(CAN_WRITE);
  try {
    await recordAbnChoice(await getDb(), s.practiceId, id, Number(fd.get("option")), String(fd.get("signedOn") ?? ""), s.userId);
    revalidatePath(`/patients/${patientId}`);
    return { ok: true, message: "Recorded. New claims for these services get GA with option 1; option 2 stops the claim line." };
  } catch (e) {
    return fail(e);
  }
}
