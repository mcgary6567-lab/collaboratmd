/**
 * Appointment times are kept as the practice's clock time written as UTC: a
 * 9:00 visit is stored as 09:00Z, the way the schedule enters and shows them
 * (the app server runs in UTC; see instrumentation.ts). Only "now" needs the
 * practice's time zone, to know what the clock at the practice reads: which
 * day is today, what is tomorrow, whether a visit has already happened.
 */
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";

export const DEFAULT_TIME_ZONE = "America/New_York";

export const US_TIME_ZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "America/Adak", "Pacific/Honolulu", "America/Puerto_Rico", "Pacific/Guam", "Pacific/Pago_Pago"];

/** What people call them. */
export const TIME_ZONE_NAMES: Record<string, string> = {
  "America/New_York": "Eastern Time", "America/Chicago": "Central Time", "America/Denver": "Mountain Time", "America/Phoenix": "Mountain Time, Arizona (no daylight saving)",
  "America/Los_Angeles": "Pacific Time", "America/Anchorage": "Alaska Time", "America/Adak": "Hawaii-Aleutian Time (Aleutian Islands)", "Pacific/Honolulu": "Hawaii Time",
  "America/Puerto_Rico": "Atlantic Time (Puerto Rico, U.S. Virgin Islands)", "Pacific/Guam": "Chamorro Time (Guam, Northern Mariana Islands)", "Pacific/Pago_Pago": "Samoa Time (American Samoa)",
};
export const timeZoneName = (tz: string) => TIME_ZONE_NAMES[tz] ?? tz.replace(/_/g, " ");

export function validTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** What the clock in `tz` reads at `now`, as a clock time (daylight saving included). */
export function practiceClock(now: Date, tz: string): Date {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute));
}

/** Midnight of a clock time's day. */
export function clockDay(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export async function practiceTimeZone(db: Db, practiceId: string) {
  const [p] = await db.select({ tz: schema.practices.timeZone }).from(schema.practices).where(eq(schema.practices.id, practiceId)).limit(1);
  return p?.tz && validTimeZone(p.tz) ? p.tz : DEFAULT_TIME_ZONE;
}

/** The practice's clock now. */
export async function practiceNow(db: Db, practiceId: string, now = new Date()) {
  return practiceClock(now, await practiceTimeZone(db, practiceId));
}
