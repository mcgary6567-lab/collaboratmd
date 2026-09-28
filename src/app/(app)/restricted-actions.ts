"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { requireRole, requireSession } from "@/lib/auth";
import type { FormResult } from "@/components/action-form";
import { breakGlass, setRestricted } from "@/server/restricted";

/** Opens a restricted record after recording why. `back` must be a path inside the app. */
export async function breakGlassAction(patientId: string, back: string, _prev: FormResult, fd: FormData): Promise<FormResult> {
  const s = await requireSession();
  try {
    await breakGlass(await getDb(), s, patientId, String(fd.get("reason") ?? ""));
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not open the record" };
  }
  redirect(/^\/(patients|claims|statements|estimates)\/[0-9a-f-]{36}(\/[a-z-]+)?$/i.test(back) ? back : "/patients");
}

export async function setRestrictedAction(patientId: string, restricted: boolean): Promise<void> {
  const s = await requireRole(["admin"]);
  await setRestricted(await getDb(), s.practiceId, patientId, restricted, s.userId);
  revalidatePath(`/patients/${patientId}`);
}
