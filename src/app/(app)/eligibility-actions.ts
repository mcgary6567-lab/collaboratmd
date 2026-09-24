"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { CAN_WRITE, requireRole } from "@/lib/auth";
import type { FormResult } from "@/components/action-form";
import { verifySchedule } from "@/server/patients";

/** Runs a 270/271 for everyone on a day's schedule not already verified for that date. */
export async function verifyScheduleAction(dateIso: string, _prev: FormResult): Promise<FormResult> {
  const s = await requireRole(CAN_WRITE);
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) throw new Error("Invalid date");
    const db = await getDb();
    const r = await verifySchedule(db, s.practiceId, new Date(dateIso + "T12:00:00"));
    revalidatePath("/scheduling");
    const parts = [
      `${r.checked} checked`,
      `${r.active} active`,
      r.inactive ? `${r.inactive} not covered` : "",
      r.errors ? `${r.errors} payer errors` : "",
      r.noInsurance ? `${r.noInsurance} without insurance` : "",
      r.skipped ? `${r.skipped} already verified` : "",
    ].filter(Boolean);
    const problems = r.problems.length ? ` Needs attention: ${r.problems.map((p) => `${p.name} (${p.message})`).join("; ")}.` : "";
    return { ok: r.problems.length === 0, message: `${parts.join(", ")}.${problems}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Something went wrong" };
  }
}
