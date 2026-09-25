"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { CAN_ADJUST, requireRole, requireSession } from "@/lib/auth";
import type { FormResult } from "@/components/action-form";
import { importCodeSet, isPlatformOperator, type CodeSet } from "@/server/code-sets";
import { adoptSuggestion, dismissSuggestion } from "@/server/rule-suggestions";

export async function importCodeSetAction(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const s = await requireSession();
  if (!isPlatformOperator(s.email)) return { ok: false, message: "Only the platform operator can load national code sets" };
  const set = String(formData.get("set") ?? "") as CodeSet;
  if (!["ncci_ptp", "ncci_mue", "coverage"].includes(set)) return { ok: false, message: "Choose which code set this file is" };
  const file = formData.get("file");
  if (!(file instanceof File) || !file.size) return { ok: false, message: "Choose the file" };
  if (file.size > 4_000_000) return { ok: false, message: "Files over 4 MB go through the command-line importer (see below)" };
  try {
    const r = await importCodeSet(await getDb(), set, await file.text(), String(formData.get("label") ?? file.name), s.email);
    revalidatePath("/settings/code-sets");
    return { ok: true, message: `Loaded ${r.added.toLocaleString("en-US")} rows${r.skipped ? `, skipped ${r.skipped.toLocaleString("en-US")} unreadable` : ""}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not load the file" };
  }
}

export async function adoptSuggestionAction(key: string, _prev: FormResult): Promise<FormResult> {
  const s = await requireRole(CAN_ADJUST);
  try {
    await adoptSuggestion(await getDb(), s.practiceId, key, s.userId);
    revalidatePath("/settings/payer-edits");
    return { ok: true, message: "Rule added; claims are checked against it from now on" };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not add the rule" };
  }
}

export async function dismissSuggestionAction(key: string, _prev: FormResult): Promise<FormResult> {
  const s = await requireRole(CAN_ADJUST);
  await dismissSuggestion(await getDb(), s.practiceId, key, s.userId);
  revalidatePath("/settings/payer-edits");
  return { ok: true, message: "Dismissed" };
}
