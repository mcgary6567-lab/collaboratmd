"use server";

import { headers } from "next/headers";
import { getDb } from "@/db";
import { clientIp } from "@/lib/ip";
import { patientLang } from "@/lib/i18n/patient-server";
import { bookingError } from "@/lib/i18n/booking";
import { ipHash } from "@/server/legal";
import { requestBooking, requestWaitlist } from "@/server/booking";
import { hit, waitMessage } from "@/server/throttle";

export type BookState = { done?: boolean; error?: string } | undefined;

export async function requestBookingAction(practiceId: string, providerId: string, startsAt: string, _prev: BookState, fd: FormData): Promise<BookState> {
  const lang = await patientLang();
  if (String(fd.get("website") ?? "")) return { done: true };
  if (!/^[0-9a-f-]{36}$/i.test(practiceId) || !/^[0-9a-f-]{36}$/i.test(providerId)) return { error: bookingError(lang, "This booking link is not valid") };
  const db = await getDb();
  const ip = clientIp(await headers());
  const t = await hit(db, "booking", ip);
  if (!t.ok) return { error: waitMessage(t.retryAfterSec) };
  const f = (k: string) => String(fd.get(k) ?? "");
  try {
    await requestBooking(db, practiceId, {
      providerId, startsAt, firstName: f("firstName"), lastName: f("lastName"), dob: f("dob"), phone: f("phone"), email: f("email"),
      reason: f("reason"), payerName: f("payerName"), memberId: f("memberId"), smsConsent: fd.get("smsConsent") === "on", language: lang,
    }, { ipHash: ipHash(ip) });
    return { done: true };
  } catch (e) {
    return { error: bookingError(lang, e instanceof Error ? e.message : "Could not send the request") };
  }
}

/** Hours offered on the form: any, mornings, afternoons (clock hours at the practice). */
const WINDOWS: Record<string, [number | null, number | null]> = { any: [null, null], morning: [null, 12], afternoon: [12, null] };

export async function requestWaitlistAction(practiceId: string, _prev: BookState, fd: FormData): Promise<BookState> {
  const lang = await patientLang();
  if (String(fd.get("website") ?? "")) return { done: true };
  const providerId = String(fd.get("providerId") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(practiceId) || (providerId && !/^[0-9a-f-]{36}$/i.test(providerId))) return { error: bookingError(lang, "This booking link is not valid") };
  const db = await getDb();
  const ip = clientIp(await headers());
  const t = await hit(db, "booking", ip);
  if (!t.ok) return { error: waitMessage(t.retryAfterSec) };
  const f = (k: string) => String(fd.get(k) ?? "");
  const [fromHour, untilHour] = WINDOWS[f("hours")] ?? WINDOWS.any;
  try {
    await requestWaitlist(db, practiceId, {
      providerId: providerId || null, fromHour, untilHour, firstName: f("firstName"), lastName: f("lastName"), dob: f("dob"), phone: f("phone"), email: f("email"),
      reason: f("reason"), smsConsent: fd.get("smsConsent") === "on", language: lang,
    }, { ipHash: ipHash(ip) });
    return { done: true };
  } catch (e) {
    return { error: bookingError(lang, e instanceof Error ? e.message : "Could not send the request") };
  }
}
