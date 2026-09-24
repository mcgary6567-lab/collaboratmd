"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN_ADJUST, CAN_WRITE, requireRole, requireSession } from "@/lib/auth";
import {
  contractFromPercent, ensureSchedule, saveScheduleItems, scanUnderpayments, setUnderpaymentStatus,
} from "@/server/fees";

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
  const db = await getDb();
  const schedule = payerId
    ? await contractFromPercent(db, s.practiceId, payerId, percent)
    : await ensureSchedule(db, s.practiceId, null);
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
