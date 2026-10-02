import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { coverageGaps, currentBreak, currentEntry, recentHandovers, teamBoard, TIME_OFF_KINDS, upcomingTimeOff } from "@/server/shifts";
import { offerableShifts, swapsFor } from "@/server/shift-swaps";
import {
  cancelSwapAction, clockAction, handoverAction, removeTimeOffAction, requestSwapAction, requestTimeOffAction, respondSwapAction, timeZoneAction,
} from "@/app/(app)/shift-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { fmtDate, fmtDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Shifts and time off" };
export const dynamic = "force-dynamic";

const ZONES = Intl.supportedValuesOf("timeZone");
const day = (v: string) => fmtDate(`${v}T00:00:00`);
const hours = (from: Date, to: Date) => ((to.getTime() - from.getTime()) / 3_600_000).toFixed(1);
const SWAP_STATUS: Record<string, { tone: "slate" | "amber" | "green" | "red"; label: string }> = {
  requested: { tone: "amber", label: "waiting for the teammate" }, accepted: { tone: "amber", label: "waiting for approval" }, approved: { tone: "green", label: "approved" },
  declined: { tone: "slate", label: "declined" }, denied: { tone: "red", label: "denied" }, cancelled: { tone: "slate", label: "withdrawn" },
};

/** Who is working now across time zones, clocking in, breaks, handovers, time-off requests and shift swaps. */
export default async function ShiftsPage() {
  const s = await requireSession();
  const db = await getDb();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const board = await teamBoard(db, s.practiceId, now);
  const [entry, handovers, gaps, off, offerable, swaps] = await Promise.all([
    currentEntry(db, s.userId), recentHandovers(db, s.practiceId, 24, now), coverageGaps(db, s.practiceId, now), upcomingTimeOff(db, board.map((b) => b.id), today),
    offerableShifts(db, s.userId, now), swapsFor(db, s.practiceId, s.userId),
  ]);
  const onBreak = entry ? !!(await currentBreak(db, entry.id)) : false;
  const admin = s.role === "admin";
  const me = board.find((b) => b.id === s.userId);
  const myTz = me?.tz ?? s.timeZone;
  const mine = off.filter((o) => o.o.userId === s.userId);
  const mySwaps = swaps.filter((x) => x.requesterId === s.userId || x.takerId === s.userId);
  const onNow = board.filter((b) => b.onShift && b.hasSchedule);
  return (
    <>
      <PageHeader
        title="Shifts and time off"
        subtitle={`${onNow.length} of ${board.filter((b) => b.hasSchedule).length} people with set hours are on shift now. Times are shown in each person's own time zone.`}
        actions={admin ? <><Link href="/work/shifts/manage" className="btn btn-secondary">Manage shifts</Link><Link href="/reports/team-hours" className="btn btn-secondary">Hours, output and pay</Link></> : undefined}
      />

      {(gaps.uncovered.length > 0 || gaps.stranded.length > 0) && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {gaps.uncovered.length > 0 && <p>Nobody available today for: {gaps.uncovered.map((u) => u.name).join(", ")}. Add someone to the rule on <Link href="/work" className="font-semibold underline">Work queues</Link>.</p>}
          {gaps.stranded.length > 0 && <p>{gaps.stranded.length} task{gaps.stranded.length === 1 ? "" : "s"} due by tomorrow belong to someone who is off: {gaps.stranded.slice(0, 4).map((x) => `${x.title} (${x.owner})`).join("; ")}. Reassign on <Link href="/tasks" className="font-semibold underline">Tasks</Link>.</p>}
        </div>
      )}

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card title="Your shift">
          <div className="space-y-3 text-sm">
            <p>
              {me ? <>Your time: <span className="font-semibold">{me.localTime}</span> ({me.tz}){me.holidayToday ? `, ${me.holidayToday}` : ""}. </> : null}
              {entry ? <>Clocked in since {fmtDateTime(entry.clockIn, myTz)} ({hours(entry.clockIn, now)} hours){onBreak ? ", on a break" : ""}.</> : "Not clocked in."}
              {entry?.offNetwork && <> <Badge tone="amber">not on an office network</Badge></>}
            </p>
            <div className="flex flex-wrap items-end gap-2">
              {entry && (
                <ActionForm action={clockAction}>
                  <input type="hidden" name="to" value={onBreak ? "back" : "break"} />
                  <SubmitButton className="btn btn-secondary" pendingLabel="...">{onBreak ? "End break" : "Start break"}</SubmitButton>
                </ActionForm>
              )}
              <ActionForm action={clockAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="to" value={entry ? "out" : "in"} />
                {entry && <label className="block"><span className="label">Note (optional)</span><input name="note" className="input" maxLength={200} /></label>}
                <SubmitButton pendingLabel="...">{entry ? "Clock out" : "Clock in"}</SubmitButton>
              </ActionForm>
            </div>
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
                <div className="font-medium">{name} <span className="font-normal text-slate-500 dark:text-slate-400">{fmtDateTime(h.createdAt, myTz)}{tz ? ` (their time zone: ${tz})` : ""}</span></div>
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
                <td data-label="Status">{b.holidayToday ? <Badge tone="amber">holiday: {b.holidayToday}</Badge> : b.offToday ? <Badge tone="amber">off today</Badge> : !b.hasSchedule ? <Badge>no set hours</Badge> : b.onShift ? <Badge tone="green">on shift</Badge> : <Badge>off shift</Badge>}</td>
                <td data-label="Next shift">{b.nextStart && !b.onShift ? fmtDateTime(b.nextStart, myTz) : "-"}</td>
                <td data-label="Clocked in">{b.clockedInSince ? <>{hours(b.clockedInSince, now)} h{b.onBreak ? ", on a break" : ""}{b.offNetwork && <> <Badge tone="amber">off network</Badge></>}</> : "-"}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Your time off">
          <ActionForm action={requestTimeOffAction} className="mb-4 grid gap-2 text-sm sm:grid-cols-2">
            <label className="block"><span className="label">First day off (your date)</span><input type="date" name="startsOn" defaultValue={today} className="input" required /></label>
            <label className="block"><span className="label">Last day off</span><input type="date" name="endsOn" defaultValue={today} className="input" required /></label>
            <label className="block"><span className="label">Kind</span><select name="kind" className="input">{Object.entries(TIME_OFF_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className="block"><span className="label">Note</span><input name="note" className="input" maxLength={200} /></label>
            <div><SubmitButton pendingLabel="Sending...">Ask for time off</SubmitButton></div>
          </ActionForm>
          {mine.length === 0 ? <Empty>No time off coming up.</Empty> : (
            <ul className="space-y-1 text-sm">
              {mine.map(({ o }) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>{TIME_OFF_KINDS[o.kind] ?? o.kind}, {day(o.startsOn)}{o.endsOn !== o.startsOn ? ` to ${day(o.endsOn)}` : ""} <Badge tone={o.status === "approved" ? "green" : "amber"}>{o.status === "approved" ? "approved" : "waiting for approval"}</Badge></span>
                  {(o.status === "requested" || admin) && <ActionForm action={removeTimeOffAction.bind(null, o.id)}><SubmitButton className="btn btn-secondary" pendingLabel="...">Cancel</SubmitButton></ActionForm>}
                </li>
              ))}
            </ul>
          )}
          <h3 className="mt-5 text-sm font-semibold">The team&apos;s time off</h3>
          {off.filter((o) => o.o.status === "approved").length === 0 ? <p className="text-sm text-slate-500 dark:text-slate-400">None coming up.</p> : (
            <ul className="mt-1 space-y-1 text-sm">{off.filter((o) => o.o.status === "approved").map(({ o, name }) => <li key={o.id}>{name}: {TIME_OFF_KINDS[o.kind] ?? o.kind}, {day(o.startsOn)}{o.endsOn !== o.startsOn ? ` to ${day(o.endsOn)}` : ""}</li>)}</ul>
          )}
        </Card>

        <Card title="Shift swaps">
          {offerable.length > 0 ? (
            <ActionForm action={requestSwapAction} className="mb-4 grid gap-2 text-sm sm:grid-cols-2">
              <label className="block sm:col-span-2"><span className="label">Your shift</span>
                <select name="startsAt" className="input">{offerable.map((o) => <option key={o.startsAt.toISOString()} value={o.startsAt.toISOString()}>{fmtDateTime(o.startsAt, myTz)} to {fmtDateTime(o.endsAt, myTz)}</option>)}</select>
              </label>
              <label className="block"><span className="label">Ask</span><select name="takerId" className="input">{board.filter((b) => b.id !== s.userId).map((b) => <option key={b.id} value={b.id}>{b.name} ({b.tz})</option>)}</select></label>
              <label className="block"><span className="label">Note</span><input name="note" className="input" maxLength={300} /></label>
              <div><SubmitButton pendingLabel="Sending...">Ask to swap</SubmitButton></div>
            </ActionForm>
          ) : <p className="mb-4 text-sm text-slate-600 dark:text-slate-300">You have no upcoming shifts to offer. Shifts come from the weekly hours an administrator sets.</p>}
          {mySwaps.length === 0 ? <Empty>No swaps.</Empty> : (
            <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-700">
              {mySwaps.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>{x.requesterId === s.userId ? `You asked ${x.taker}` : `${x.requester} asked you`}: {fmtDateTime(x.startsAt, myTz)} to {fmtDateTime(x.endsAt, myTz)}{x.note ? ` (${x.note})` : ""} <Badge tone={SWAP_STATUS[x.status]?.tone ?? "slate"}>{SWAP_STATUS[x.status]?.label ?? x.status}</Badge></span>
                  <span className="flex gap-2">
                    {x.status === "requested" && x.takerId === s.userId && <>
                      <ActionForm action={respondSwapAction.bind(null, x.id, true)}><SubmitButton className="btn btn-secondary" pendingLabel="...">Accept</SubmitButton></ActionForm>
                      <ActionForm action={respondSwapAction.bind(null, x.id, false)}><SubmitButton className="btn btn-secondary" pendingLabel="...">Decline</SubmitButton></ActionForm>
                    </>}
                    {(x.status === "requested" || x.status === "accepted") && x.requesterId === s.userId && <ActionForm action={cancelSwapAction.bind(null, x.id)}><SubmitButton className="btn btn-secondary" pendingLabel="...">Withdraw</SubmitButton></ActionForm>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
