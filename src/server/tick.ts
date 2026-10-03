/**
 * The every-five-minutes run. Vercel's plan runs the daily job once a day
 * (13:00 UTC); what needs to happen at a practice's own hour, or within
 * minutes, runs here instead:
 *
 * - waitlist offers nobody has taken go to the next people on the list
 *   (server/waitlist.ts advanceOffers);
 * - the morning-of reminder goes out at 7:00 on the practice's clock, and
 *   tomorrow's reminders at 10:00 (both only when switched on in Automation);
 * - staff who have not clocked in for a shift, or forgot to clock out, are
 *   reminded (server/clock-alerts.ts).
 *
 * It is started from outside, by the live-check workflow on GitHub, with the
 * same CRON_SECRET as the daily job. Everything it does is also safe to repeat
 * (each reminder is sent once; the daily job still sends any this missed), so
 * a late or doubled tick does no harm. Each run is recorded as a heartbeat,
 * which the status page shows and the daily job checks.
 */
import { and, isNull, lt } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import type { AutomationSettings } from "@/db/schema";
import { appointmentReminders, sameDayReminders } from "./automation";
import { advanceOffers, MAX_ROUNDS, ROUND_MINUTES } from "./waitlist";
import { practiceClock } from "./practice-time";
import { alertOperators } from "./ops-alerts";
import { beat, lastBeat } from "./heartbeats";
import { clockAlerts } from "./clock-alerts";

export { beat, lastBeat };

const { practices, slotOffers } = schema;

/** Hours on the practice's clock: the morning-of reminder, and tomorrow's reminders. */
export const REMINDER_HOURS = { sameDay: 7, dayBefore: 10 };
/** The daily job alerts when the last tick is older than this. */
export const TICK_STALE_MINUTES = 60;

type Send = (to: string, body: string) => Promise<{ ok: boolean; detail: string }>;

export async function runTick(db: Db, origin: string, now = new Date(), deps: { send?: Send } = {}) {
  await beat(db, "tick", now);
  const out: Record<string, Record<string, unknown>> = {};
  const add = (id: string, k: string, v: unknown) => ((out[id] ??= {})[k] = v);

  // Waitlist rounds: only practices with an offer waiting for its next round.
  const due = await db.selectDistinct({ id: slotOffers.practiceId }).from(slotOffers)
    .where(and(isNull(slotOffers.filledAt), lt(slotOffers.rounds, MAX_ROUNDS), lt(slotOffers.lastRoundAt, new Date(now.getTime() - ROUND_MINUTES * 60_000))));
  for (const { id } of due) add(id, "offers", await advanceOffers(db, id, { now, send: deps.send }).catch((e) => ({ error: e instanceof Error ? e.message : "failed" })));

  // Reminders at the practice's own hour.
  const all = await db.select({ id: practices.id, automation: practices.automation, timeZone: practices.timeZone }).from(practices);
  for (const p of all) {
    const s: AutomationSettings = p.automation ?? {};
    const hour = practiceClock(now, p.timeZone).getUTCHours();
    if (s.sameDayReminders && hour === REMINDER_HOURS.sameDay) add(p.id, "sameDay", await sameDayReminders(db, p.id, now, deps.send ? { sms: deps.send } : {}).catch((e) => ({ error: e instanceof Error ? e.message : "failed" })));
    if (s.appointmentReminders && hour === REMINDER_HOURS.dayBefore) add(p.id, "dayBefore", await appointmentReminders(db, p.id, origin, now).catch((e) => ({ error: e instanceof Error ? e.message : "failed" })));
  }

  // Clock reminders, recorded in the result only when one went out (or failed).
  const clock = await clockAlerts(db, now).catch((e) => ({ error: e instanceof Error ? e.message : "failed" }));
  if ("error" in clock || clock.late || clock.forgot) add("staff", "clock", clock);
  return out;
}

/**
 * From the daily job: if ticks were running and have stopped, say so. (Nothing
 * inside the site can notice its own silence any sooner; for that, give the
 * live-check workflow a heartbeat address, LIVE_HEARTBEAT_URL.)
 */
export async function checkTickStale(db: Db, now = new Date(), alert: typeof alertOperators = alertOperators) {
  const at = await lastBeat(db, "tick");
  if (!at) return { stale: false, never: true };
  const minutes = Math.round((now.getTime() - at.getTime()) / 60_000);
  if (minutes <= TICK_STALE_MINUTES) return { stale: false, minutes };
  await alert("Outside checks have stopped", `The last five-minute run (and outside check) was ${minutes} minutes ago, at ${at.toISOString()}. Waitlist rounds and reminders at each practice's hour wait for the daily job until it runs again. Check the "Live check" workflow on GitHub.`);
  return { stale: true, minutes };
}
