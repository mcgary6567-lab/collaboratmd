/**
 * Reminders about the clock, from the five-minute run (server/tick.ts):
 *
 *  - a shift started LATE_MINUTES ago and the person has not clocked in:
 *    they are reminded; at ADMIN_LATE_MINUTES their administrators are told;
 *  - a person is still clocked in FORGOT_MINUTES after their shift ended (or,
 *    with no set hours, after FORGOT_OPEN_HOURS): they are reminded, before
 *    the entry runs to the 16-hour cap.
 *
 * Only people with weekly hours or one-off extra hours get the first kind.
 * Days off and holidays have no shift, so no reminder. Each reminder is sent
 * once (a dedupe key per shift or entry), so a late or doubled tick is fine.
 */
import { and, gte, inArray, isNull } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { availability, shiftOccurrences } from "./shifts";
import { notify } from "./notifications";

const { staffShifts, shiftChanges, timeEntries, users } = schema;
export const LATE_MINUTES = 15;
export const ADMIN_LATE_MINUTES = 30;
export const FORGOT_MINUTES = 60;
export const FORGOT_OPEN_HOURS = 12;
const MIN = 60_000;
const HOUR = 3_600_000;

const hhmm = (at: Date, tz: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(at);

export async function clockAlerts(db: Db, now = new Date()) {
  const scheduled = await db.selectDistinct({ id: staffShifts.userId }).from(staffShifts);
  const extra = await db.selectDistinct({ id: shiftChanges.userId }).from(shiftChanges).where(gte(shiftChanges.endsAt, new Date(now.getTime() - 20 * HOUR)));
  const open = await db.select().from(timeEntries).where(isNull(timeEntries.clockOut));
  const ids = [...new Set([...scheduled, ...extra].map((r) => r.id).concat(open.map((e) => e.userId)))];
  if (!ids.length) return { late: 0, forgot: 0 };
  const [avail, recent, people] = await Promise.all([
    availability(db, ids, now),
    db.select().from(timeEntries).where(and(inArray(timeEntries.userId, ids), gte(timeEntries.clockIn, new Date(now.getTime() - 20 * HOUR)))),
    db.select({ id: users.id, practiceId: users.practiceId, name: users.name }).from(users).where(inArray(users.id, ids)),
  ]);
  let late = 0, forgot = 0;
  for (const p of people) {
    const a = avail.get(p.id);
    if (!a) continue;
    const since = new Date(now.getTime() - 20 * HOUR);
    const occ = [
      ...shiftOccurrences(a.shifts, since, a.tz, 2, a.timeOff, a.holidays, a.changes),
      ...a.changes.filter((c) => c.kind === "extra").map((c) => ({ startsAt: c.startsAt, endsAt: c.endsAt })),
    ];
    const mine = recent.filter((e) => e.userId === p.id);
    const entry = open.find((e) => e.userId === p.id);

    // Late: a shift under way, started a while ago, with no clock-in from shortly before it on.
    for (const o of occ) {
      const after = now.getTime() - o.startsAt.getTime();
      if (after < LATE_MINUTES * MIN || after > 3 * HOUR || o.endsAt.getTime() <= now.getTime()) continue;
      if (entry || mine.some((e) => e.clockIn.getTime() >= o.startsAt.getTime() - 2 * HOUR)) continue;
      const key = `${p.id}:${o.startsAt.toISOString()}`;
      await notify(db, p.practiceId, { userId: p.id, kind: "clock", title: `Your shift started at ${hhmm(o.startsAt, a.tz)} and you have not clocked in`, href: "/work/shifts", dedupeKey: `late:${key}` });
      if (after >= ADMIN_LATE_MINUTES * MIN) await notify(db, p.practiceId, { kind: "clock", title: `${p.name} has not clocked in for the shift that started at ${hhmm(o.startsAt, a.tz)} (their time)`, href: "/work/shifts", dedupeKey: `late-admin:${key}` });
      late++;
    }

    // Forgot to clock out: the shift this entry belongs to ended a while ago.
    if (entry) {
      const shift = occ.filter((o) => Math.abs(o.startsAt.getTime() - entry.clockIn.getTime()) <= 3 * HOUR).sort((x, y) => y.endsAt.getTime() - x.endsAt.getTime())[0];
      const overdue = shift ? now.getTime() - shift.endsAt.getTime() >= FORGOT_MINUTES * MIN : now.getTime() - entry.clockIn.getTime() >= FORGOT_OPEN_HOURS * HOUR;
      if (overdue) {
        await notify(db, p.practiceId, { userId: p.id, kind: "clock", title: shift ? `Your shift ended at ${hhmm(shift.endsAt, a.tz)} and you are still clocked in` : "You have been clocked in for over 12 hours", body: "Clock out, or ask for a correction if you stopped earlier.", href: "/work/shifts", dedupeKey: `forgot:${entry.id}` });
        forgot++;
      }
    }
  }
  return { late, forgot };
}
