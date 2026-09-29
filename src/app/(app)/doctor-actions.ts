"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { requireRole } from "@/lib/auth";
import type { FormResult } from "@/components/action-form";
import { runDoctor } from "@/server/doctor";

export async function runDoctorAction(_prev: FormResult): Promise<FormResult> {
  const s = await requireRole(["admin"]);
  try {
    const r = await runDoctor(await getDb(), s.practiceId, { userId: s.userId });
    revalidatePath("/settings/connections/doctor");
    const failing = r.filter((x) => x.status === "fail").length;
    const passing = r.filter((x) => x.status === "pass").length;
    return { ok: failing === 0, message: `${passing} passed, ${failing} failed, ${r.length - passing - failing} warnings or skipped` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not run the checks" };
  }
}

/** Runs one check (for example the text registration status) now. */
export async function runOneCheckAction(checkId: string, _prev: FormResult): Promise<FormResult> {
  const s = await requireRole(["admin"]);
  const [r] = await runDoctor(await getDb(), s.practiceId, { userId: s.userId, only: checkId });
  revalidatePath("/settings/texting");
  revalidatePath("/settings/connections/doctor");
  return r ? { ok: r.status !== "fail", message: r.detail } : { ok: false, message: "No such check" };
}
