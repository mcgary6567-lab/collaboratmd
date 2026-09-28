/**
 * Whether a text reached the phone. A text is "sent" when Twilio accepts it;
 * Twilio then reports, at the StatusCallback given with each message, whether
 * the carrier delivered it. A reminder that did not arrive shows on the
 * schedule ("call the patient"), and a waitlist offer that did not arrive is
 * counted as not made.
 *
 * The message log keeps "undelivered" rather than "failed" for these, so the
 * daily reminders do not try the same dead number again every day.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { markOfferUndelivered } from "./waitlist";

const { smsMessages, messageLog } = schema;
const FINAL = ["delivered", "undelivered", "failed"];

export async function recordDelivery(db: Db, practiceId: string, report: { sid: string; status: string; errorCode?: string | null }, now = new Date()) {
  if (!/^(SM|MM)[0-9a-f]{32}$/i.test(report.sid) || !FINAL.includes(report.status)) return { updated: 0 };
  const failed = report.status !== "delivered";
  const inbox = await db.update(smsMessages).set({ status: failed ? "undelivered" : "delivered" }).where(and(eq(smsMessages.practiceId, practiceId), eq(smsMessages.twilioSid, report.sid))).returning();
  let logged: (typeof messageLog.$inferSelect)[] = [];
  if (failed) {
    logged = await db.update(messageLog)
      .set({ status: "undelivered" })
      .where(and(eq(messageLog.practiceId, practiceId), eq(messageLog.channel, "sms"), eq(messageLog.detail, `sid ${report.sid}`)))
      .returning();
    for (const m of logged) if (m.kind === "waitlist_offer" && m.entityId && m.patientId) await markOfferUndelivered(db, m.entityId, m.patientId, now);
  }
  return { updated: inbox.length + logged.length };
}

/** Appointments whose reminder text did not arrive, for the schedule. */
export async function undeliveredReminders(db: Db, practiceId: string, appointmentIds: string[]) {
  if (!appointmentIds.length) return new Set<string>();
  const rows = await db.select({ id: messageLog.entityId }).from(messageLog).where(and(
    eq(messageLog.practiceId, practiceId), eq(messageLog.status, "undelivered"),
    inArray(messageLog.kind, ["appointment_reminder", "appointment_reminder_today"]), inArray(messageLog.entityId, appointmentIds),
  ));
  return new Set(rows.map((r) => r.id!).filter(Boolean));
}
