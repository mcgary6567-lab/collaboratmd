import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { requireRole } from "@/lib/auth";
import { clockNetworks, teamBoard, TIME_OFF_KINDS, upcomingTimeOff, WEEKDAYS } from "@/server/shifts";
import { swapsFor } from "@/server/shift-swaps";
import { addedHolidays, builtInHolidays, CALENDARS, COMPANY } from "@/server/holidays";
import { CURRENCIES, payFor } from "@/server/pay";
import {
  addHolidayAction, clockNetworksAction, decideSwapAction, decideTimeOffAction, holidayCalendarAction, payAction, removeHolidayAction, removeTimeOffAction,
  shiftsAction, timeOffAction, timeZoneAction,
} from "@/app/(app)/shift-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { fmtDate, fmtDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Manage shifts" };
export const dynamic = "force-dynamic";

const ZONES = Intl.supportedValuesOf("timeZone");
const day = (v: string) => fmtDate(`${v}T00:00:00`);
const calName = (c: string) => (c === COMPANY ? "Company-wide" : CALENDARS[c] ?? c);

/** Administrators: approvals, each person's hours, time zone, holiday calendar and pay, holidays and the office networks for clocking in. */
export default async function ManageShiftsPage() {
  const s = await requireRole(["admin"]);
  const db = await getDb();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const board = await teamBoard(db, s.practiceId, now);
  const ids = board.map((b) => b.id);
  const [off, swaps, added, net, pays] = await Promise.all([
    upcomingTimeOff(db, ids, today), swapsFor(db, s.practiceId, s.userId), addedHolidays(db, s.practiceId, today), clockNetworks(db, s.practiceId), payFor(db, ids),
  ]);
  const pending = off.filter((o) => o.o.status === "requested");
  const approved = off.filter((o) => o.o.status === "approved");
  const awaiting = swaps.filter((x) => x.status === "accepted");
  const horizon = new Date(now.getTime() + 120 * 86_400_000).toISOString().slice(0, 10);
  const year = now.getUTCFullYear();
  const used = [...new Set(board.map((b) => b.calendar).filter((c): c is string => !!c && !!CALENDARS[c]))];
  const builtIn = used.map((c) => ({ c, list: [...builtInHolidays(c, year), ...builtInHolidays(c, year + 1)].filter((h) => h.date >= today && h.date <= horizon) }));
  return (
    <>
      <PageHeader
        title="Manage shifts"
        subtitle="Approve time off and swaps, and set each person's hours, time zone, holiday calendar and pay."
        actions={<><Link href="/work/shifts" className="btn btn-secondary">Shifts and time off</Link><Link href="/reports/team-hours" className="btn btn-secondary">Hours, output and pay</Link></>}
      />

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card title={`Time off to approve (${pending.length})`}>
          {pending.length === 0 ? <Empty>No requests waiting.</Empty> : (
            <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-700">
              {pending.map(({ o, name }) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>{name}: {TIME_OFF_KINDS[o.kind] ?? o.kind}, {day(o.startsOn)}{o.endsOn !== o.startsOn ? ` to ${day(o.endsOn)}` : ""}{o.note ? ` (${o.note})` : ""}</span>
                  {o.userId === s.userId ? <span className="text-xs text-slate-500 dark:text-slate-400">Another administrator decides your own request.</span> : (
                    <span className="flex gap-2">
                      <ActionForm action={decideTimeOffAction.bind(null, o.id, true)}><SubmitButton pendingLabel="...">Approve</SubmitButton></ActionForm>
                      <ActionForm action={decideTimeOffAction.bind(null, o.id, false)}><SubmitButton className="btn btn-secondary" pendingLabel="...">Deny</SubmitButton></ActionForm>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Approving moves the person&apos;s open queue tasks due in that time to others on the same rule. Cancelling approved time off moves the tasks that are still open back.</p>
        </Card>
        <Card title={`Shift swaps to approve (${awaiting.length})`}>
          {awaiting.length === 0 ? <Empty>No swaps waiting.</Empty> : (
            <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-700">
              {awaiting.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>{x.taker} takes {x.requester}&apos;s shift {fmtDateTime(x.startsAt, s.timeZone)} to {fmtDateTime(x.endsAt, s.timeZone)} (your time){x.note ? ` (${x.note})` : ""}</span>
                  {x.requesterId === s.userId || x.takerId === s.userId ? <span className="text-xs text-slate-500 dark:text-slate-400">Another administrator approves a swap you are in.</span> : (
                    <span className="flex gap-2">
                      <ActionForm action={decideSwapAction.bind(null, x.id, true)}><SubmitButton pendingLabel="...">Approve</SubmitButton></ActionForm>
                      <ActionForm action={decideSwapAction.bind(null, x.id, false)}><SubmitButton className="btn btn-secondary" pendingLabel="...">Deny</SubmitButton></ActionForm>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Time off" className="mb-6">
        <ActionForm action={timeOffAction} className="mb-4 grid gap-2 text-sm sm:grid-cols-3">
          <label className="block"><span className="label">Person</span><select name="userId" className="input">{board.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
          <label className="block"><span className="label">First day off (their date)</span><input type="date" name="startsOn" defaultValue={today} className="input" required /></label>
          <label className="block"><span className="label">Last day off</span><input type="date" name="endsOn" defaultValue={today} className="input" required /></label>
          <label className="block"><span className="label">Kind</span><select name="kind" className="input">{Object.entries(TIME_OFF_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="block sm:col-span-2"><span className="label">Note</span><input name="note" className="input" maxLength={200} /></label>
          <div><SubmitButton pendingLabel="Saving...">Save approved time off</SubmitButton></div>
        </ActionForm>
        {approved.length === 0 ? <Empty>No approved time off coming up.</Empty> : (
          <ul className="space-y-1 text-sm">
            {approved.map(({ o, name }) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>{name}: {TIME_OFF_KINDS[o.kind] ?? o.kind}, {day(o.startsOn)}{o.endsOn !== o.startsOn ? ` to ${day(o.endsOn)}` : ""}{o.note ? ` (${o.note})` : ""}</span>
                <ActionForm action={removeTimeOffAction.bind(null, o.id)}><SubmitButton className="btn btn-secondary" pendingLabel="...">Cancel</SubmitButton></ActionForm>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Each person" className="mb-6">
        <div className="space-y-4">
          {board.map((b) => {
            const pay = pays.find((p) => p.userId === b.id);
            return (
              <details key={b.id} className="text-sm">
                <summary className="cursor-pointer">
                  <span className="font-medium">{b.name}</span>{" "}
                  <span className="text-slate-500 dark:text-slate-400">
                    {b.shifts.length ? b.shifts.map((x) => `${WEEKDAYS[x.weekday].slice(0, 3)} ${x.startsAt}-${x.endsAt}`).join(", ") : "no set hours"} · {b.tz} · {b.calendar ? calName(b.calendar) : "company holidays only"}
                    {pay ? ` · ${(pay.rateCents / 100).toFixed(2)} ${pay.currency}/hour` : " · no pay rate"}
                  </span>
                </summary>
                <div className="mt-2 grid gap-4 lg:grid-cols-2">
                  <div className="space-y-2">
                    <ActionForm action={timeZoneAction.bind(null, b.id)} className="flex flex-wrap items-end gap-2">
                      <label className="block"><span className="label">Time zone</span>
                        <select name="timeZone" defaultValue={b.tz} className="input">{ZONES.map((z) => <option key={z} value={z}>{z}</option>)}</select>
                      </label>
                      <SubmitButton className="btn btn-secondary" pendingLabel="...">Save</SubmitButton>
                    </ActionForm>
                    <ActionForm action={holidayCalendarAction.bind(null, b.id)} className="flex flex-wrap items-end gap-2">
                      <label className="block"><span className="label">Holiday calendar</span>
                        <select name="calendar" defaultValue={b.calendar ?? ""} className="input"><option value="">None (company holidays only)</option>{Object.entries(CALENDARS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                      </label>
                      <SubmitButton className="btn btn-secondary" pendingLabel="...">Save</SubmitButton>
                    </ActionForm>
                    <ActionForm action={payAction.bind(null, b.id)} className="grid gap-2 sm:grid-cols-3">
                      <label className="block"><span className="label">Hourly rate</span><input name="rate" inputMode="decimal" defaultValue={pay ? (pay.rateCents / 100).toFixed(2) : ""} className="input" required /></label>
                      <label className="block"><span className="label">Currency</span><select name="currency" defaultValue={pay?.currency ?? "USD"} className="input">{Object.entries(CURRENCIES).map(([k, v]) => <option key={k} value={k}>{k} ({v})</option>)}</select></label>
                      <label className="block"><span className="label">Overtime pay ×</span><input name="multiplier" inputMode="decimal" defaultValue={pay?.otMultiplier ?? 1.5} className="input" /></label>
                      <label className="block"><span className="label">Overtime after hours a week</span><input name="weekly" inputMode="decimal" defaultValue={pay ? pay.weeklyOtHours ?? "" : 40} className="input" /></label>
                      <label className="block"><span className="label">Overtime after hours a day</span><input name="daily" inputMode="decimal" defaultValue={pay?.dailyOtHours ?? ""} className="input" /></label>
                      <div className="self-end"><SubmitButton className="btn btn-secondary" pendingLabel="...">Save pay</SubmitButton></div>
                    </ActionForm>
                  </div>
                  <ActionForm action={shiftsAction.bind(null, b.id)} className="grid gap-2 sm:grid-cols-[7rem_1fr_1fr]">
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
                </div>
              </details>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Enter hours in the person&apos;s own time zone. A shift that ends before it starts (21:00 to 06:00) runs past midnight. Leave every day empty for someone always available. Leave an overtime box empty for no overtime of that kind; local labor law decides the right numbers.</p>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Holidays">
          <ActionForm action={addHolidayAction} className="mb-4 grid gap-2 text-sm sm:grid-cols-2">
            <label className="block"><span className="label">Calendar</span><select name="calendar" className="input"><option value={COMPANY}>Company-wide (everyone)</option>{Object.entries(CALENDARS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className="block"><span className="label">Date</span><input type="date" name="onDate" defaultValue={today} className="input" required /></label>
            <label className="block sm:col-span-2"><span className="label">Name</span><input name="name" className="input" maxLength={80} required placeholder="Eid al-Fitr" /></label>
            <div><SubmitButton pendingLabel="Adding...">Add holiday</SubmitButton></div>
          </ActionForm>
          {added.length === 0 ? <p className="text-sm text-slate-500 dark:text-slate-400">No added holidays coming up.</p> : (
            <ul className="mb-4 space-y-1 text-sm">
              {added.map((h) => (
                <li key={h.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>{day(h.onDate)}: {h.name} <Badge>{calName(h.calendar)}</Badge></span>
                  <ActionForm action={removeHolidayAction.bind(null, h.id)}><SubmitButton className="btn btn-secondary" pendingLabel="...">Remove</SubmitButton></ActionForm>
                </li>
              ))}
            </ul>
          )}
          {builtIn.map(({ c, list }) => (
            <div key={c} className="mt-3 text-sm">
              <h3 className="font-semibold">{calName(c)}, built in, next 120 days</h3>
              {list.length === 0 ? <p className="text-slate-500 dark:text-slate-400">None.</p> : <ul>{list.map((h) => <li key={h.date}>{day(h.date)}: {h.name}</li>)}</ul>}
            </div>
          ))}
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Built-in calendars hold the holidays that can be computed: fixed dates, rules like &quot;last Monday of May&quot;, and dates from Easter. Holidays set by the moon or by proclamation (Eid, Diwali, Chinese New Year and others) change every year: add them here once they are announced. A holiday counts as a day off for queue assignment and due dates.</p>
        </Card>
        <Card title="Office networks for clocking in">
          <ActionForm action={clockNetworksAction} className="space-y-2 text-sm">
            <label className="block"><span className="label">IP addresses or ranges, one per line</span><textarea name="networks" rows={4} defaultValue={net.networks.join("\n")} className="input font-mono" placeholder={"203.0.113.10\n198.51.100.0/24"} /></label>
            <label className="block"><span className="label">When someone clocks in from elsewhere</span>
              <select name="mode" defaultValue={net.mode} className="input"><option value="flag">Allow it and flag the entry</option><option value="require">Refuse it</option></select>
            </label>
            <SubmitButton pendingLabel="Saving...">Save</SubmitButton>
          </ActionForm>
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Leave the list empty to allow clocking in from anywhere. This checks the network address the request comes from, not a location: a VPN can hide it. Flagged entries show on the team board and in Hours, output and pay.</p>
        </Card>
      </div>
    </>
  );
}
