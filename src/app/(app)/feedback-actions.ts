"use server";

import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { siteOrigin } from "@/lib/origin";
import { submitFeedback } from "@/server/feedback";

export async function submitFeedbackAction(input: { page: string; message: string; userAgent: string; viewport: string }): Promise<{ ok: boolean; message: string }> {
  const s = await requireSession();
  try {
    await submitFeedback(await getDb(), { practiceId: s.practiceId, userId: s.userId, ...input, origin: await siteOrigin().catch(() => "") });
    return { ok: true, message: "Thank you. The team has it and will follow up." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not send it" };
  }
}
