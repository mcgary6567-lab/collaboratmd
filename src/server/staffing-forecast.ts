/**
 * Staffing forecast for a week: how much queue work to expect each day, the
 * hours it should take, and the hours on the schedule.
 *
 *  - Expected work: tasks the work queue rules created on the same weekday,
 *    averaged over the last eight weeks (days in the viewer's time zone).
 *  - Hours needed: that, divided by the team's own pace over the same eight
 *    weeks (queue tasks finished per hour clocked). With under 8 hours clocked
 *    there is no pace yet, so only the expected work is shown.
 *  - Hours scheduled: everyone's shifts that day (Team week), after days off,
 *    holidays, part days, swaps and open shifts.
 *
 * A day whose scheduled hours fall short of the hours needed is flagged. It is
 * an estimate from history: a payer's batch of denials or a new client
 * practice will not be in it.
 */
import { and, eq, gte, inArray, isNotNull, lt } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { localClock, workedSpans, zonedMoment } from "./shifts";
import type { Span } from "./shift-week";
import { assignableUsers } from "./work";

const { tasks } = schema;
const DAY = 86_400_000;
const WEEKS = 8;
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** Hours of the spans that fall on a local date in `tz`. */
export function hoursOnDate(spans: Span[], date: string, tz: string) {
  const a = zonedMoment(date, "00:00", tz).getTime(), b = zonedMoment(addDays(date, 1), "00:00", tz).getTime();
  return spans.reduce((sum, s) => sum + Math.max(0, Math.min(b, s.endsAt.getTime()) - Math.max(a, s.startsAt.getTime())), 0) / 3_600_000;
}

export async function staffingForecast(db: Db, practiceId: string, weekStart: string, tz: string, scheduled: Span[][], now = new Date()) {
  const since = new Date(now.getTime() - WEEKS * 7 * DAY);
  const team = (await assignableUsers(db, practiceId, { includeDisabled: true })).map((u) => u.id);
  const [created, finished, spans] = await Promise.all([
    db.select({ at: tasks.createdAt }).from(tasks).where(and(eq(tasks.practiceId, practiceId), isNotNull(tasks.ruleId), gte(tasks.createdAt, since), lt(tasks.createdAt, now))),
    team.length ? db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.practiceId, practiceId), isNotNull(tasks.ruleId), eq(tasks.status, "done"), inArray(tasks.assigneeId, team), gte(tasks.completedAt, since), lt(tasks.completedAt, now))) : [],
    workedSpans(db, practiceId, team, since, now, now),
  ]);
  const perWeekday = Array(7).fill(0) as number[];
  for (const t of created) perWeekday[new Date(`${localClock(t.at, tz).date}T00:00:00Z`).getUTCDay()]++;
  const hoursWorked = spans.reduce((a, s) => a + (s.end.getTime() - s.start.getTime()), 0) / 3_600_000;
  const pace = hoursWorked >= 8 && finished.length ? finished.length / hoursWorked : null;
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart, i);
    const expected = Math.round((perWeekday[new Date(`${date}T00:00:00Z`).getUTCDay()] / WEEKS) * 10) / 10;
    const needed = pace ? Math.round((expected / pace) * 10) / 10 : null;
    const hours = Math.round(scheduled.reduce((sum, p) => sum + hoursOnDate(p, date, tz), 0) * 10) / 10;
    return { date, expected, needed, scheduled: hours, short: needed !== null && needed > hours };
  });
  return { days, pace, weeks: WEEKS, tasksSeen: created.length };
}
