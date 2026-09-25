"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireRole } from "@/lib/auth";
import type { FormResult } from "@/components/action-form";
import type { AutomationSettings } from "@/db/schema";
import { runDailyForPractice } from "@/server/automation";
import { siteOrigin } from "@/lib/origin";

const KEYS: (keyof AutomationSettings)[] = ["appointmentReminders", "balanceReminders", "weeklyReport", "claimFollowUp", "autopay", "denialAgent"];

export async function saveAutomationAction(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const s = await requireRole(["admin"]);
  const settings = Object.fromEntries(KEYS.map((k) => [k, formData.get(k) === "on"])) as AutomationSettings;
  const db = await getDb();
  await db.update(schema.practices).set({ automation: settings }).where(eq(schema.practices.id, s.practiceId));
  await db.insert(schema.auditLog).values({ practiceId: s.practiceId, userId: s.userId, action: "automation_settings", entity: "practice", entityId: s.practiceId, details: settings });
  revalidatePath("/settings/automation");
  return { ok: true, message: "Saved. The daily job uses these from its next run." };
}

/** Runs today's job for this practice now, instead of waiting for the schedule. */
export async function runNowAction(_prev: FormResult): Promise<FormResult> {
  const s = await requireRole(["admin"]);
  try {
    const db = await getDb();
    const summary = await runDailyForPractice(db, s.practiceId, await siteOrigin());
    revalidatePath("/settings/automation");
    return { ok: true, message: `Ran: ${Object.keys(summary).join(", ")}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Something went wrong" };
  }
}
