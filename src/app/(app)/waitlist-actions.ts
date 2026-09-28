"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { requireRole } from "@/lib/auth";
import type { FormResult } from "@/components/action-form";
import { addToWaitlist, offerSlot, OFFER_TO, MIN_NOTICE_HOURS, removeFromWaitlist } from "@/server/waitlist";

const CAN = ["admin", "biller", "front_desk"] as const;

export async function addToWaitlistAction(patientId: string, _prev: FormResult, fd: FormData): Promise<FormResult> {
  const s = await requireRole([...CAN]);
  try {
    await addToWaitlist(await getDb(), s.practiceId, patientId, { providerId: String(fd.get("providerId") ?? "") || null, note: String(fd.get("note") ?? "") }, s.userId);
    revalidatePath(`/patients/${patientId}`);
    revalidatePath("/scheduling");
    return { ok: true, message: "Added to the waitlist" };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not add to the waitlist" };
  }
}

export async function removeFromWaitlistAction(entryId: string, patientId: string): Promise<void> {
  const s = await requireRole([...CAN]);
  await removeFromWaitlist(await getDb(), s.practiceId, entryId, s.userId);
  revalidatePath(`/patients/${patientId}`);
  revalidatePath("/scheduling");
}

const OFFER_MESSAGES: Record<string, string> = {
  already_offered: "This time was already offered",
  too_soon: `Too soon to offer: less than ${MIN_NOTICE_HOURS} hours away`,
  no_one: "Nobody on the waitlist can take it (they need texting consent and to be free then)",
  not_sent: "No text could be sent. Check that texting is connected under Integrations.",
  not_cancelled: "Only a cancelled appointment's time can be offered",
};

export async function offerSlotAction(appointmentId: string, _prev: FormResult, _fd: FormData): Promise<FormResult> {
  const s = await requireRole([...CAN]);
  const r = await offerSlot(await getDb(), s.practiceId, appointmentId, { userId: s.userId });
  revalidatePath("/scheduling");
  if (r.status === "offered") return { ok: true, message: `Texted to ${r.sent} ${r.sent === 1 ? "person" : "people"} on the waitlist (up to ${OFFER_TO}); the first to reply B gets it` };
  return { ok: false, message: OFFER_MESSAGES[r.status] };
}
