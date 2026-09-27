"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { CAN_WRITE, requireRole } from "@/lib/auth";
import type { FormResult } from "@/components/action-form";
import { confirmRequest, declineRequest, getBookingSettings, saveBookingSettings, saveProviderHours } from "@/server/booking";

const fail = (e: unknown, fallback: string): FormResult => ({ ok: false, message: e instanceof Error ? e.message : fallback });

export async function saveBookingSettingsAction(_prev: FormResult, fd: FormData): Promise<FormResult> {
  const s = await requireRole(["admin"]);
  try {
    await saveBookingSettings(await getDb(), s.practiceId, {
      enabled: fd.get("enabled") === "on", timeZone: String(fd.get("timeZone") ?? ""), slotMinutes: Number(fd.get("slotMinutes")),
      minNoticeHours: Number(fd.get("minNoticeHours")), horizonDays: Number(fd.get("horizonDays")), intro: String(fd.get("intro") ?? ""),
    }, s.userId);
    revalidatePath("/settings/booking");
    return { ok: true, message: "Saved" };
  } catch (e) {
    return fail(e, "Could not save");
  }
}

export async function saveProviderHoursAction(providerId: string, _prev: FormResult, fd: FormData): Promise<FormResult> {
  const s = await requireRole(["admin"]);
  try {
    const rows = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: String(fd.get(`start_${weekday}`) ?? ""), end: String(fd.get(`end_${weekday}`) ?? ""), locationId: String(fd.get(`loc_${weekday}`) ?? "") || null }));
    await saveProviderHours(await getDb(), s.practiceId, providerId, rows);
    revalidatePath("/settings/booking");
    return { ok: true, message: "Hours saved" };
  } catch (e) {
    return fail(e, "Could not save the hours");
  }
}

export async function confirmBookingAction(id: string, _prev: FormResult): Promise<FormResult> {
  const s = await requireRole(CAN_WRITE);
  let to: string;
  try {
    const db = await getDb();
    const r = await confirmRequest(db, s.practiceId, id, s.userId);
    const told = !!r.message && (r.message.sms === "sent" || r.message.email === "sent");
    const settings = await getBookingSettings(db, s.practiceId);
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: settings.timeZone }).format(r.startsAt);
    to = `/scheduling?date=${day}&booked=${r.matched ? "existing" : "new"}&told=${told ? 1 : 0}`;
  } catch (e) {
    return fail(e, "Could not book it");
  }
  // The request card goes away once booked, so the result shows on the day of the appointment instead.
  redirect(to);
}

export async function declineBookingAction(id: string, _prev: FormResult): Promise<FormResult> {
  const s = await requireRole(CAN_WRITE);
  try {
    await declineRequest(await getDb(), s.practiceId, id, s.userId);
  } catch (e) {
    return fail(e, "Could not decline it");
  }
  redirect("/scheduling?declined=1");
}
