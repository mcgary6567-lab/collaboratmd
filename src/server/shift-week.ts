/**
 * The team's week on one grid, in the viewer's time zone: each person's
 * shifts (weekly hours less days off and holidays, with swapped hours) and,
 * for every hour of the week, how many people are on. An hour nobody covers
 * stands out, so gaps in the US business day are visible at a glance.
 */
import type { Db } from "@/db";
import { availability, localClock, shiftOccurrences, subtractWindows, zonedMoment } from "./shifts";
import { assignableUsers } from "./work";

const DAY = 86_400_000;
const HOUR = 3_600_000;
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

export type Span = { startsAt: Date; endsAt: Date };

/** The hours of a week (7 x 24, in `tz`) and how many of the spans cover at least half of each. */
export function coverageGrid(weekStart: string, tz: string, people: Span[][]) {
  const grid: number[][] = [];
  for (let d = 0; d < 7; d++) {
    const date = addDays(weekStart, d);
    const row: number[] = [];
    for (let h = 0; h < 24; h++) {
      const a = zonedMoment(date, `${String(h).padStart(2, "0")}:00`, tz).getTime();
      const b = h === 23 ? zonedMoment(addDays(date, 1), "00:00", tz).getTime() : zonedMoment(date, `${String(h + 1).padStart(2, "0")}:00`, tz).getTime();
      const half = (b - a) / 2;
      row.push(people.filter((spans) => spans.reduce((sum, s) => sum + Math.max(0, Math.min(b, s.endsAt.getTime()) - Math.max(a, s.startsAt.getTime())), 0) >= half).length);
    }
    grid.push(row);
  }
  return grid;
}

/** A span's pieces on each local day of the week, as "HH:MM-HH:MM" in `tz`. */
export function dayPieces(weekStart: string, tz: string, spans: Span[]) {
  const days: string[][] = Array.from({ length: 7 }, () => []);
  for (let d = 0; d < 7; d++) {
    const a = zonedMoment(addDays(weekStart, d), "00:00", tz), b = zonedMoment(addDays(weekStart, d + 1), "00:00", tz);
    for (const s of spans) {
      const x = s.startsAt > a ? s.startsAt : a, y = s.endsAt < b ? s.endsAt : b;
      if (y.getTime() - x.getTime() < 60_000) continue;
      days[d].push(`${localClock(x, tz).time}-${y.getTime() === b.getTime() ? "24:00" : localClock(y, tz).time}`);
    }
  }
  return days;
}

/** Each person's shifts in a local week of the viewer, and the hour-by-hour count. */
export async function teamWeek(db: Db, practiceId: string, weekStart: string, tz: string) {
  const start = zonedMoment(weekStart, "00:00", tz), end = zonedMoment(addDays(weekStart, 7), "00:00", tz);
  const team = await assignableUsers(db, practiceId);
  const avail = await availability(db, team.map((t) => t.id), start);
  const people = team.map((t) => {
    const a = avail.get(t.id)!;
    const spans: Span[] = subtractWindows([
      ...shiftOccurrences(a.shifts, start, a.tz, 9, a.timeOff, a.holidays, a.changes),
      ...a.changes.filter((c) => c.kind === "extra").map((c) => ({ startsAt: c.startsAt, endsAt: c.endsAt })),
    ], a.changes.filter((c) => c.kind === "cancel")).filter((s) => s.startsAt < end && s.endsAt > start);
    const off = a.timeOff.filter((o) => o.startsOn <= addDays(weekStart, 7) && o.endsOn >= addDays(weekStart, -1));
    const holidays = a.holidays.filter((h) => h.date >= addDays(weekStart, -1) && h.date <= addDays(weekStart, 7));
    return { id: t.id, name: t.name, tz: a.tz, hasSchedule: a.hasSchedule, spans, days: dayPieces(weekStart, tz, spans), hours: spans.reduce((sum, s) => sum + (Math.min(end.getTime(), s.endsAt.getTime()) - Math.max(start.getTime(), s.startsAt.getTime())), 0) / HOUR, off, holidays };
  });
  const scheduled = people.filter((p) => p.hasSchedule);
  return { start, end, people, grid: coverageGrid(weekStart, tz, scheduled.map((p) => p.spans)), scheduled: scheduled.length };
}
