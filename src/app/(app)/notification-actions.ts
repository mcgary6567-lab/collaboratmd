"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireSession } from "@/lib/auth";
import type { FormResult } from "@/components/action-form";
import { markRead, setDigest } from "@/server/notifications";

export async function markAllReadAction(_prev: FormResult): Promise<FormResult> {
  const s = await requireSession();
  await markRead(await getDb(), s.practiceId, s.userId, s.role === "admin");
  revalidatePath("/", "layout");
  return { ok: true, message: "All caught up" };
}

export async function markOneReadAction(id: string): Promise<void> {
  const s = await requireSession();
  await markRead(await getDb(), s.practiceId, s.userId, s.role === "admin", [id]);
  revalidatePath("/", "layout");
}

export async function digestAction(_prev: FormResult): Promise<FormResult> {
  const s = await requireSession();
  const db = await getDb();
  const [u] = await db.select({ on: schema.users.emailDigest }).from(schema.users).where(eq(schema.users.id, s.userId));
  await setDigest(db, s.userId, !u?.on);
  revalidatePath("/notifications");
  return { ok: true, message: u?.on ? "Daily email turned off" : "You will get a daily email of anything new" };
}
