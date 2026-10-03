import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { localClock } from "@/server/shifts";
import { practiceTimeZone } from "@/server/practice-time";
import { teamWeek } from "@/server/shift-week";
import { personTz, weekStartOf } from "@/server/timesheets";
import { Card, Empty, PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Team week" };
export const dynamic = "force-dynamic";

const isDay = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Shade for a count of people on: none stands out. */
const shade = (n: number, max: number) =>
  n === 0 ? "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200"
    : n / Math.max(max, 1) < 0.34 ? "bg-green-50 text-slate-900 dark:bg-slate-800 dark:text-slate-100"
      : n / Math.max(max, 1) < 0.67 ? "bg-green-100 text-slate-900 dark:bg-slate-700 dark:text-slate-100"
        : "bg-green-200 text-slate-900 dark:bg-slate-600 dark:text-white";

/** Everyone's shifts on one week in your time zone, and how many people are on each hour. */
export default async function TeamWeekPage({ searchParams }: { searchParams: Promise<{ week?: string; tz?: string }> }) {
  const s = await requireSession();
  const q = await searchParams;
  const db = await getDb();
  const mine = (await personTz(db, s.userId)).tz;
  const practiceTz = await practiceTimeZone(db, s.practiceId);
  const tz = q.tz === "practice" ? practiceTz : mine;
  const week = weekStartOf(isDay(q.week) ? q.week! : localClock(new Date(), tz).date);
  const w = await teamWeek(db, s.practiceId, week, tz);
  const max = Math.max(0, ...w.grid.flat());
  const gaps = w.grid.flat().filter((n) => n === 0).length;
  const link = (wk: string) => `/work/shifts/week?week=${wk}${q.tz === "practice" ? "&tz=practice" : ""}`;
  return (
    <>
      <PageHeader
        title="Team week"
        subtitle={`Week of ${fmtDate(`${week}T00:00:00`)}, in ${tz}. ${w.scheduled} of ${w.people.length} people have set hours${w.scheduled ? `; ${gaps} of 168 hours have nobody on` : ""}.`}
        actions={<Link href="/work/shifts" className="btn btn-secondary">Shifts and time off</Link>}
      />
      <div className="mb-6 flex flex-wrap items-end gap-2 text-sm">
        <Link href={link(addDays(week, -7))} className="btn btn-secondary">Previous week</Link>
        <Link href={link(addDays(week, 7))} className="btn btn-secondary">Next week</Link>
        {mine !== practiceTz && (q.tz === "practice"
          ? <Link href={`/work/shifts/week?week=${week}`} className="btn btn-secondary">Show in my time ({mine})</Link>
          : <Link href={`/work/shifts/week?week=${week}&tz=practice`} className="btn btn-secondary">Show in the practice&apos;s time ({practiceTz})</Link>)}
      </div>

      <Card title="Shifts" className="mb-6">
        {w.people.length === 0 ? <Empty>No team members yet.</Empty> : (
          <div tabIndex={0} role="region" aria-label="Shifts by person and day" className="overflow-x-auto">
            <table className="table text-sm">
              <thead><tr><th>Person</th>{DAY_NAMES.map((d, i) => <th key={d}>{d} {addDays(week, i).slice(5)}</th>)}<th className="text-right">Hours</th></tr></thead>
              <tbody>{w.people.map((p) => (
                <tr key={p.id}>
                  <td className="whitespace-nowrap">{p.name}<div className="text-xs text-slate-500 dark:text-slate-400">{p.tz}</div></td>
                  {p.days.map((pieces, i) => <td key={i} className="whitespace-nowrap tabular-nums">{!p.hasSchedule ? <span className="text-slate-500 dark:text-slate-400">any time</span> : pieces.length ? pieces.join(", ") : <span className="text-slate-500 dark:text-slate-400">off</span>}</td>)}
                  <td className="text-right tabular-nums">{p.hasSchedule ? p.hours.toFixed(1) : "-"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Weekly hours less approved time off and holidays, with approved swaps. Someone with no set hours counts as available any time and is left out of the counts below.</p>
      </Card>

      <Card title="People on, hour by hour">
        {w.scheduled === 0 ? <Empty>Nobody has set hours yet. Administrators set them on Manage shifts.</Empty> : (
          <div tabIndex={0} role="region" aria-label="People on each hour" className="overflow-x-auto">
            <table className="text-xs tabular-nums">
              <thead><tr><th className="px-1 text-left font-medium">Hour</th>{DAY_NAMES.map((d) => <th key={d} className="px-1 font-medium">{d}</th>)}</tr></thead>
              <tbody>{Array.from({ length: 24 }, (_, h) => (
                <tr key={h}>
                  <th className="px-1 text-left font-normal">{String(h).padStart(2, "0")}:00</th>
                  {w.grid.map((day, d) => <td key={d} className={`h-6 w-12 border border-white text-center dark:border-slate-900 ${shade(day[h], max)}`}>{day[h]}</td>)}
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Each cell counts people on for at least half of that hour. Red cells have nobody on.</p>
      </Card>
    </>
  );
}
