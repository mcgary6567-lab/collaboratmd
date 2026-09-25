"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { CAN_ADJUST, requireRole } from "@/lib/auth";
import type { FormResult } from "@/components/action-form";
import { autoMatch, importDeposits, matchDeposit, setDepositStatus } from "@/server/deposits";

const PATH = "/remittance/deposits";
const fail = (e: unknown): FormResult => ({ ok: false, message: e instanceof Error ? e.message : "Something went wrong" });

export async function importDepositsAction(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const s = await requireRole(CAN_ADJUST);
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose the CSV file exported from your bank" };
  if (file.size > 5_000_000) return { ok: false, message: "That file is over 5 MB; export a shorter date range" };
  try {
    const db = await getDb();
    const r = await importDeposits(db, s.practiceId, await file.text(), s.userId);
    revalidatePath(PATH);
    return { ok: true, message: `${r.added} deposits added, ${r.matched} matched to ERAs${r.duplicates ? `, ${r.duplicates} already imported` : ""}${r.skipped ? `, ${r.skipped} rows skipped (withdrawals or unreadable)` : ""}` };
  } catch (e) {
    return fail(e);
  }
}

export async function autoMatchAction(_prev: FormResult): Promise<FormResult> {
  const s = await requireRole(CAN_ADJUST);
  const db = await getDb();
  const n = await autoMatch(db, s.practiceId);
  revalidatePath(PATH);
  return { ok: true, message: n ? `${n} more deposits matched` : "No further matches found" };
}

export async function matchDepositAction(depositId: string, _prev: FormResult, formData: FormData): Promise<FormResult> {
  const s = await requireRole(CAN_ADJUST);
  const remittanceId = String(formData.get("remittanceId") ?? "");
  if (!remittanceId) return { ok: false, message: "Pick an ERA" };
  try {
    const db = await getDb();
    await matchDeposit(db, s.practiceId, depositId, remittanceId, s.userId);
    revalidatePath(PATH);
    return { ok: true, message: "Matched" };
  } catch (e) {
    return fail(e);
  }
}

export async function depositStatusAction(depositId: string, status: "unmatched" | "ignored", _prev: FormResult): Promise<FormResult> {
  const s = await requireRole(CAN_ADJUST);
  try {
    const db = await getDb();
    await setDepositStatus(db, s.practiceId, depositId, status, s.userId);
    revalidatePath(PATH);
    return { ok: true, message: status === "ignored" ? "Marked not an insurance payment" : "Unmatched" };
  } catch (e) {
    return fail(e);
  }
}
