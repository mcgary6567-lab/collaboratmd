import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { coverageGaps, currentEntry, recentHandovers, teamBoard, TIME_OFF_KINDS, upcomingTimeOff, WEEKDAYS } from "@/server/shifts";
import { clockAction, handoverAction, removeTimeOffAction, shiftsAction, timeOffAction, timeZoneAction } from "@/app/(app)/shift-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { fmtDate, fmtDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Shifts and time off" };
export const dynamic = "force-dynamic";

const ZONES = Intl.supportedValuesOf("timeZone");
const day = (v: string) => fmtDate(`${v}T00:00:00`);
const hours = (from: Date, to: Date) => ((to.getTime() - from.getTime()) / 3_600_000).toFixed(1);

/** Who is working now across time zones, everyone's weekly hours and time off, clocking in and the handover between shifts. */
export default async function ShiftsPage() {
  const s = await requireSession();
  const db = await getDb();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const board = await teamBoard(db, s.practiceId, now);
  const [mine, handovers, gaps, off] = await Promise.all([
    currentEntry(db, s.userId), recentHandovers(db, s.practiceId, 24, now), coverageGaps(db, s.practiceId, now), upcomingTimeOff(db, board.map((b) => b.id), today),
  ]);
  const admin = s.role === "admin";
  const me = board.find((b) => b.id === s.userId);
  const onNow = board.filter((b) => b.onShift && b.hasSchedule);
  return (
    <>
      <PageHeader title="Shifts and time off" subtitle={`${onNow.length} of ${board.filter((b) => b.hasSchedule).length} people with set hours are on shift now. Times are shown in each person's own time zone.`} actions={<Link href="/reports/team-hours" className="btn btn-secondary">Hours and output</Link>} />

      {(gaps.uncovered.length > 0 || gaps.stranded.length > 0) && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {gaps.uncovered.length > 0 && <p>Nobody available today for: {gaps.uncovered.map((u) => u.name).join(", ")}. Add someone to the rule on <Link href="/work" className="font-semibold underline">Work queues</Link>.</p>}
          {gaps.stranded.length > 0 && <p>{gaps.stranded.length} task{gaps.stranded.length === 1 ? "" : "s"} due by tomorrow belong to someone who is off: {gaps.stranded.slice(0, 4).map((x) => `${x.title} (${x.owner})`).join("; ")}. Reassign on <Link href="/tasks" className="font-semibold underline">Tasks</Link>.</p>}
        </div>
      )}

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card title="Your shift">
          <div className="space-y-3 text-sm">
            <p>{me ? <>Your time: <span className="font-semibold">{me.localTime}</span> ({me.tz}). </> : null}{mine ? <>Clocked in since {fmtDateTime(mine.clockIn, me?.tz ?? s.timeZone)} ({hours(mine.clockIn, now)} hours).</> : "Not clocked in."}</p>
            <ActionForm action={clockAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="to" value={mine ? "out" : "in"} />
              {mine && <label className="block grow"><span className="label">Note (optional)</span><input name="note" className="input" maxLength={200} /></label>}
              <SubmitButton pendingLabel="...">{mine ? "Clock out" : "Clock in"}</SubmitButton>
            </ActionForm>
            <ActionForm action={timeZoneAction.bind(null, s.userId)} className="flex flex-wrap items-end gap-2">
              <label className="block"><span className="label">Your time zone</span>
                <select name="timeZone" defaultValue={me?.tz ?? ""} className="input"><option value="">The practice&apos;s</option>{ZONES.map((z) => <option key={z} value={z}>{z}</option>)}</select>
              </label>
              <SubmitButton className="btn btn-secondary" pendingLabel="...">Save</SubmitButton>
            </ActionForm>
          </div>
        </Card>
        <Card title="Handover to the next shift">
          <ActionForm action={handoverAction} className="space-y-2 text-sm">
            <label className="block"><span className="label">Done this shift</span><textarea name="done" rows={2} className="input" maxLength={2000} /></label>
            <label className="block"><span className="label">In progress (the next person picks up)</span><textarea name="inProgress" rows={2} className="input" maxLength={2000} /></label>
            <label className="block"><span className="label">Problems</span><textarea name="problems" rows={2} className="input" maxLength={2000} /></label>
            <SubmitButton pendingLabel="Saving...">Save handover</SubmitButton>
          </ActionForm>
        </Card>
      </div>

      <Card title="Handovers in the last 24 hours" className="mb-6">
        {handovers.length === 0 ? <Empty>No handover notes in the last 24 hours.</Empty> : (
          <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-700">
            {handovers.map(({ h, name, tz }) => (
              <li key={h.id} className="py-3">
                <div className="font-medium">{name} <span className="font-normal text-slate-500 dark:text-slate-400">{fmtDateTime(h.createdAt, s.timeZone)}{tz ? ` (their time zone: ${tz})` : ""}</span></div>
                {h.done && <p><span className="font-medium">Done:</span> {h.done}</p>}
                {h.inProgress && <p><span className="font-medium">In progress:</span> {h.inProgress}</p>}
                {h.problems && <p className="text-amber-800 dark:text-amber-300"><span className="font-medium">Problems:</span> {h.problems}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="The team now" className="mb-6">
        <div tabIndex={0} role="region" aria-label="The team now" className="overflow-x-auto">
          <table className="table table-stack text-sm">
            <thead><tr><th>Person</th><th>Their time</th><th>Status</th><th>Next shift (your time)</th><th>Clocked in</th></tr></thead>
            <tbody>{board.map((b) => (
              <tr key={b.id}>
                <td data-label="Person">{b.name}</td>
                <td data-label="Their time" className="tabular-nums">{b.localTime} <span className="text-slate-500 dark:text-slate-400">{b.tz}</span></td>
                <td data-label="Status">{b.offToday ? <Badge tone="amber">off today</Badge> : !b.hasSchedule ? <Badge>no set hours</Badge> : b.onShift ? <Badge tone="green">on shift</Badge> : <Badge>off shift</Badge>}</td>
                <td data-label="Next shift">{b.nextStart && !b.onShift ? fmtDateTime(b.nextStart, s.timeZone) : "-"}</td>
                <td data-label="Clocked in">{b.clockedInSince ? `${hours(b.clockedInSince, now)} h` : "-"}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Time off">
          {admin && (
            <ActionForm action={timeOffAction} className="mb-4 grid gap-2 text-sm sm:grid-cols-2">
              <label className="block"><span className="label">Person</span><select name="userId" className="input">{board.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
              <label className="block"><span className="label">Kind</span><select name="kind" className="input">{Object.entries(TIME_OFF_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label className="block"><span className="label">First day off (their date)</span><input type="date" name="startsOn" defaultValue={today} className="input" required /></label>
              <label className="block"><span className="label">Last day off</span><input type="date" name="endsOn" defaultValue={today} className="input" required /></label>
              <label className="block sm:col-span-2"><span className="label">Note</span><input name="note" className="input" maxLength={200} /></label>
              <div><SubmitButton pendingLabel="Saving...">Save time off</SubmitButton></div>
            </ActionForm>
          )}
          {off.length === 0 ? <Empty>No time off coming up.</Empty> : (
            <ul className="space-y-1 text-sm">
              {off.map(({ o, name }) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>{name}: {TIME_OFF_KINDS[o.kind] ?? o.kind}, {day(o.startsOn)}{o.endsOn !== o.startsOn ? ` to ${day(o.endsOn)}` : ""}{o.note ? ` (${o.note})` : ""}</span>
                  {admin && <ActionForm action={removeTimeOffAction.bind(null, o.id)}><SubmitButton className="btn btn-secondary" pendingLabel="...">Remove</SubmitButton></ActionForm>}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Work queue rules skip people who are off. Saving time off moves the person&apos;s open queue tasks due in that time to others on the same rule.</p>
        </Card>

        <Card title="Weekly hours">
          {!admin ? <p className="text-sm text-slate-600 dark:text-slate-300">Administrators set weekly hours.</p> : (
            <div className="space-y-4">
              {board.map((b) => (
                <details key={b.id} className="text-sm">
                  <summary className="cursor-pointer"><span className="font-medium">{b.name}</span> <span className="text-slate-500 dark:text-slate-400">{b.shifts.length ? b.shifts.map((x) => `${WEEKDAYS[x.weekday].slice(0, 3)} ${x.startsAt}-${x.endsAt}`).join(", ") : "no set hours"} · {b.tz}</span></summary>
                  <ActionForm action={timeZoneAction.bind(null, b.id)} className="mt-2 flex flex-wrap items-end gap-2">
                    <label className="block"><span className="label">Time zone</span>
                      <select name="timeZone" defaultValue={b.tz} className="input">{ZONES.map((z) => <option key={z} value={z}>{z}</option>)}</select>
                    </label>
                    <SubmitButton className="btn btn-secondary" pendingLabel="...">Save</SubmitButton>
                  </ActionForm>
                  <ActionForm action={shiftsAction.bind(null, b.id)} className="mt-2 grid gap-2 sm:grid-cols-[7rem_1fr_1fr]">
                    {WEEKDAYS.map((w, i) => {
                      const sh = b.shifts.find((x) => x.weekday === i);
                      return (
                        <div key={w} className="contents">
                          <span className="self-center">{w}</span>
                          <label className="block"><span className="sr-only">{w} start</span><input name={`start-${i}`} type="time" defaultValue={sh?.startsAt ?? ""} className="input" /></label>
                          <label className="block"><span className="sr-only">{w} end</span><input name={`end-${i}`} type="time" defaultValue={sh?.endsAt ?? ""} className="input" /></label>
                        </div>
                      );
                    })}
                    <div className="sm:col-span-3"><SubmitButton className="btn btn-secondary" pendingLabel="Saving...">Save hours</SubmitButton></div>
                  </ActionForm>
                </details>
              ))}
              <p className="text-xs text-slate-500 dark:text-slate-400">Enter hours in the person&apos;s own time zone. A shift that ends before it starts (21:00 to 06:00) runs past midnight. Leave every day empty for someone always available.</p>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
