"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { CAN_WRITE, requireRole } from "@/lib/auth";
import type { FormResult } from "@/components/action-form";
import { reportMeasure, saveMeasure, setMeasureActive } from "@/server/quality";

export async function saveMeasureAction(id: string | null, _prev: FormResult, fd: FormData): Promise<FormResult> {
  const s = await requireRole(["admin"]);
  const f = (k: string) => String(fd.get(k) ?? "");
  const n = (k: string) => (f(k).trim() === "" ? null : Number(f(k)));
  try {
    await saveMeasure(await getDb(), s.practiceId, id, { number: f("number"), title: f("title"), eligibleCodes: f("eligibleCodes"), dxPrefixes: f("dxPrefixes"), minAge: n("minAge"), maxAge: n("maxAge"), codes: f("codes") }, s.userId);
    revalidatePath("/settings/quality");
    return { ok: true, message: "Saved. Qualifying claims now show it." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not save" };
  }
}

export async function measureActiveAction(id: string, active: boolean): Promise<void> {
  const s = await requireRole(["admin"]);
  await setMeasureActive(await getDb(), s.practiceId, id, active);
  revalidatePath("/settings/quality");
}

export async function reportMeasureAction(claimId: string, measureId: string, code: string, _prev: FormResult): Promise<FormResult> {
  const s = await requireRole(CAN_WRITE);
  try {
    await reportMeasure(await getDb(), s.practiceId, claimId, measureId, code, s.userId);
    revalidatePath(`/claims/${claimId}`);
    return { ok: true, message: `Added ${code} at $0.00` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not add the code" };
  }
}
