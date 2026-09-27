"use server";

import { headers } from "next/headers";
import { getDb } from "@/db";
import { clientIp } from "@/lib/ip";
import { ipHash } from "@/server/legal";
import { requestBooking } from "@/server/booking";
import { hit, waitMessage } from "@/server/throttle";

export type BookState = { done?: boolean; error?: string } | undefined;

export async function requestBookingAction(practiceId: string, providerId: string, startsAt: string, _prev: BookState, fd: FormData): Promise<BookState> {
  if (String(fd.get("website") ?? "")) return { done: true };
  if (!/^[0-9a-f-]{36}$/i.test(practiceId) || !/^[0-9a-f-]{36}$/i.test(providerId)) return { error: "This booking link is not valid" };
  const db = await getDb();
  const ip = clientIp(await headers());
  const t = await hit(db, "booking", ip);
  if (!t.ok) return { error: waitMessage(t.retryAfterSec) };
  const f = (k: string) => String(fd.get(k) ?? "");
  try {
    await requestBooking(db, practiceId, {
      providerId, startsAt, firstName: f("firstName"), lastName: f("lastName"), dob: f("dob"), phone: f("phone"), email: f("email"),
      reason: f("reason"), payerName: f("payerName"), memberId: f("memberId"), smsConsent: fd.get("smsConsent") === "on",
    }, { ipHash: ipHash(ip) });
    return { done: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not send the request" };
  }
}
