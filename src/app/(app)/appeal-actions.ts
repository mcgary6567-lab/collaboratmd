"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { CAN_ADJUST, requireRole } from "@/lib/auth";
import type { FormResult } from "@/components/action-form";
import { draftAppeal, markAppealSent, saveAppeal } from "@/server/appeals";
import { recordAppealDecision, type Decision } from "@/server/appeal-levels";

const fail = (e: unknown): FormResult => ({ ok: false, message: e instanceof Error ? e.message : "Something went wrong" });

export async function draftAppealAction(denialId: string, _prev: FormResult): Promise<FormResult> {
  const s = await requireRole(CAN_ADJUST);
  try {
    const db = await getDb();
    const letter = await draftAppeal(db, s.practiceId, denialId, s.userId);
    revalidatePath(`/denials/${denialId}/appeal`);
    return { ok: true, message: letter.source === "ai" ? "Drafted with AI from the denial codes. Review every line before sending." : "Drafted from the template for this denial reason. Fill in the bracketed parts." };
  } catch (e) {
    return fail(e);
  }
}

export async function saveAppealAction(denialId: string, letterId: string, _prev: FormResult, formData: FormData): Promise<FormResult> {
  const s = await requireRole(CAN_ADJUST);
  try {
    const db = await getDb();
    await saveAppeal(db, s.practiceId, letterId, String(formData.get("body") ?? ""));
    revalidatePath(`/denials/${denialId}/appeal`);
    return { ok: true, message: "Saved" };
  } catch (e) {
    return fail(e);
  }
}

export async function markSentAction(denialId: string, letterId: string, _prev: FormResult): Promise<FormResult> {
  const s = await requireRole(CAN_ADJUST);
  try {
    const db = await getDb();
    await markAppealSent(db, s.practiceId, letterId, s.userId);
    revalidatePath(`/denials/${denialId}/appeal`);
    revalidatePath("/denials");
    return { ok: true, message: "Marked sent; the denial is now appealed" };
  } catch (e) {
    return fail(e);
  }
}

export async function appealDecisionAction(levelId: string, denialId: string, _prev: FormResult, fd: FormData): Promise<FormResult> {
  const s = await requireRole(CAN_ADJUST);
  try {
    const r = await recordAppealDecision(await getDb(), s.practiceId, levelId, String(fd.get("decision") ?? "") as Decision, String(fd.get("decidedOn") ?? ""), s.userId);
    revalidatePath(`/denials/${denialId}/appeal`);
    revalidatePath("/denials");
    return { ok: true, message: r.next ? `Recorded. Next: ${r.next.name}, due ${r.next.dueOn}.` : "Recorded." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not record it" };
  }
}
