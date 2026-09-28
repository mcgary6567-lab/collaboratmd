"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { requireRole } from "@/lib/auth";
import type { FormResult } from "@/components/action-form";
import { accessAnomalies, LIMITS, reviewFlag, saveAccessLimits, type AccessLimits } from "@/server/access-anomalies";

const PATH = "/settings/access-review";

export async function saveAccessLimitsAction(_prev: FormResult, fd: FormData): Promise<FormResult> {
  const s = await requireRole(["admin"]);
  try {
    const input = Object.fromEntries((Object.keys(LIMITS) as (keyof AccessLimits)[]).map((k) => [k, Number(fd.get(k))]));
    await saveAccessLimits(await getDb(), s.practiceId, input, s.userId);
    revalidatePath(PATH);
    return { ok: true, message: "Saved. Tonight's check and this page use the new limits." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not save" };
  }
}

/** Records what the administrator found for one person's flag today. */
export async function reviewFlagAction(userId: string, _prev: FormResult, fd: FormData): Promise<FormResult> {
  const s = await requireRole(["admin"]);
  try {
    const db = await getDb();
    const now = new Date();
    const flag = (await accessAnomalies(db, s.practiceId, now)).find((a) => a.userId === userId);
    await reviewFlag(db, s.practiceId, s.userId, { userId, day: now.toISOString().slice(0, 10), why: flag?.why ?? [] }, String(fd.get("note") ?? ""));
    revalidatePath(PATH);
    return { ok: true, message: "Review recorded" };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not record the review" };
  }
}
