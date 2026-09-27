"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { requireRole } from "@/lib/auth";
import type { FormResult } from "@/components/action-form";
import { cancelClosure, scheduleClosure } from "@/server/offboarding";
import { notify } from "@/server/notifications";

export async function scheduleClosureAction(_prev: FormResult, fd: FormData): Promise<FormResult> {
  const s = await requireRole(["admin"]);
  try {
    const db = await getDb();
    const when = await scheduleClosure(db, s.practiceId, { confirmName: String(fd.get("confirmName") ?? ""), userId: s.userId });
    await notify(db, s.practiceId, { kind: "closure", title: `This practice will be closed and its data deleted on ${when.toUTCString().slice(0, 16)}`, body: "Export your data before then. An administrator can cancel under Settings > Close account.", href: "/settings/close" });
    revalidatePath("/", "layout");
    return { ok: true, message: `Scheduled for ${when.toUTCString().slice(0, 16)}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not schedule it" };
  }
}

export async function cancelClosureAction(_prev: FormResult): Promise<FormResult> {
  const s = await requireRole(["admin"]);
  await cancelClosure(await getDb(), s.practiceId, s.userId);
  revalidatePath("/", "layout");
  return { ok: true, message: "Closure cancelled; nothing will be deleted" };
}
