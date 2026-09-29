"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN_ADJUST, CAN_WRITE, requireRole, requireSession } from "@/lib/auth";
import {
  contractFromMedicare, contractFromPercent, ensureSchedule, saveScheduleItems, scanUnderpayments, setUnderpaymentStatus,
} from "@/server/fees";
import { importContractCsv, saveContractRules } from "@/server/contracts";
import { importPracticeCodes, removePracticeCode } from "@/server/code-catalog";
import type { FormResult } from "@/components/action-form";

/** Pricing changes what the practice bills, so only an administrator may make them. */
async function requireAdmin() {
  const s = await requireSession();
  if (s.role !== "admin") throw new Error("Only an administrator can change fee schedules");
  return s;
}

export async function createContractAction(formData: FormData): Promise<void> {
  const s = await requireAdmin();
  const payerId = String(formData.get("payerId") ?? "");
  const percent = Number(formData.get("percent") ?? 0);
  const basis = String(formData.get("basis") ?? "charges");
  const db = await getDb();
  let schedule: { id: string };
  try {
    schedule = !payerId
      ? await ensureSchedule(db, s.practiceId, null)
      : basis === "medicare"
        ? (await contractFromMedicare(db, s.practiceId, payerId, percent)).schedule
        : await contractFromPercent(db, s.practiceId, payerId, percent);
  } catch (e) {
    redirect(`/settings/fees?error=${encodeURIComponent(e instanceof Error ? e.message : "Could not create the contract")}`);
  }
  revalidatePath("/settings/fees");
  redirect(`/settings/fees/${schedule.id}`);
}

export async function saveScheduleAction(scheduleId: string, formData: FormData): Promise<void> {
  const s = await requireAdmin();
  const db = await getDb();
  const [schedule] = await db
    .select()
    .from(schema.feeSchedules)
    .where(and(eq(schema.feeSchedules.id, scheduleId), eq(schema.feeSchedules.practiceId, s.practiceId)))
    .limit(1);
  if (!schedule) throw new Error("Schedule not found");

  const items: { cpt: string; amountCents: number | null }[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("amt_")) continue;
    const raw = String(value).trim();
    items.push({ cpt: key.slice(4), amountCents: raw === "" ? null : Math.round(parseFloat(raw) * 100) });
  }
  await saveScheduleItems(db, scheduleId, items);
  await db.insert(schema.auditLog).values({
    practiceId: s.practiceId, userId: s.userId, action: "save_fee_schedule", entity: "fee_schedule", entityId: scheduleId,
    details: { items: items.filter((i) => i.amountCents !== null).length },
  });
  revalidatePath(`/settings/fees/${scheduleId}`);
  revalidatePath("/settings/fees");
}

export async function scanUnderpaymentsAction(): Promise<void> {
  const s = await requireRole(CAN_WRITE);
  const db = await getDb();
  await scanUnderpayments(db, s.practiceId);
  revalidatePath("/underpayments");
}

export async function underpaymentStatusAction(id: string, status: string): Promise<void> {
  const s = await requireRole(CAN_ADJUST);
  const db = await getDb();
  await setUnderpaymentStatus(db, s.practiceId, id, status);
  revalidatePath("/underpayments");
}

export async function saveContractTermsAction(scheduleId: string, _prev: FormResult, formData: FormData): Promise<FormResult> {
  try {
    const s = await requireAdmin();
    await saveContractRules(await getDb(), s.practiceId, scheduleId, { mpprPercent: String(formData.get("mpprPercent") ?? ""), modifiers: String(formData.get("modifiers") ?? "") }, s.userId);
    revalidatePath(`/settings/fees/${scheduleId}`);
    return { ok: true, message: "Contract terms saved. Underpayment checks use them from now on." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not save" };
  }
}

export async function importContractAction(scheduleId: string, _prev: FormResult, formData: FormData): Promise<FormResult> {
  try {
    const s = await requireAdmin();
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose the contract spreadsheet (CSV) first" };
    if (file.size > 3_000_000) return { ok: false, message: "That file is larger than 3 MB; split it or remove unused columns" };
    const r = await importContractCsv(await getDb(), s.practiceId, scheduleId, await file.text(), { replace: formData.get("replace") === "on", userId: s.userId });
    revalidatePath(`/settings/fees/${scheduleId}`);
    return { ok: true, message: `${r.imported} rates loaded (${r.mppr} subject to the multiple-procedure reduction)${r.problems.length ? `. Skipped ${r.problems.length}: ${r.problems.slice(0, 3).join("; ")}${r.problems.length > 3 ? "..." : ""}` : ""}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not import" };
  }
}

export async function importPracticeCodesAction(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const s = await requireRole(["admin"]);
  const file = formData.get("file");
  if (!(file instanceof File) || !file.size) return { ok: false, message: "Choose a CSV file" };
  if (file.size > 2_000_000) return { ok: false, message: "The file is over 2 MB; split it into smaller files" };
  try {
    const r = await importPracticeCodes(await getDb(), s.practiceId, await file.text());
    revalidatePath("/settings/fees");
    const extra = r.problems.length ? ` ${r.problems.length} row${r.problems.length === 1 ? "" : "s"} skipped: ${r.problems.slice(0, 3).join("; ")}` : "";
    return { ok: true, message: `Added or updated ${r.added} codes${r.fees ? `, ${r.fees} with fees on standard charges` : ""}.${extra}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not read the file" };
  }
}

export async function removePracticeCodeAction(code: string, _prev: FormResult): Promise<FormResult> {
  const s = await requireRole(["admin"]);
  await removePracticeCode(await getDb(), s.practiceId, code);
  revalidatePath("/settings/fees");
  return { ok: true, message: `Removed ${code}` };
}
