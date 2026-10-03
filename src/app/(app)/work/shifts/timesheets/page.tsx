import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { requireRole } from "@/lib/auth";
import { assignableUsers } from "@/server/work";
import { localClock } from "@/server/shifts";
import { correctionRequests, personTz, sheetsAwaiting, toLocalInput, weekOf, weekStartOf } from "@/server/timesheets";
import {
  addEntryAction, approveWeekAction, breakAction, correctEntryAction, decideCorrectionAction, deleteEntryAction, reopenWeekAction,
} from "@/app/(app)/timesheet-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { when } from "../my-timesheet";

export const metadata: Metadata = { title: "Timesheets" };
export const dynamic = "force-dynamic";

const isDay = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Administrators: corrections and timesheets to approve, and one person's week to correct. */
export default async function TimesheetsPage({ searchParams }: { searchParams: Promise<{ user?: string; week?: string }> }) {
  const s = await requireRole(["admin"]);
  const q = await searchParams;
  const db = await getDb();
  const now = new Date();
  // People since deactivated stay in the list, so their last weeks can be corrected and approved for final pay.
  const [team, active, corrections, awaiting] = await Promise.all([assignableUsers(db, s.practiceId, { includeDisabled: true }), assignableUsers(db, s.practiceId), correctionRequests(db, s.practiceId), sheetsAwaiting(db, s.practiceId)]);
  const current = new Set(active.map((u) => u.id));
  const person = team.find((t) => t.id === q.user) ?? active.find((t) => t.id !== s.userId) ?? team[0];
  const tz = person ? (await personTz(db, person.id)).tz : s.timeZone ?? "UTC";
  const week = weekStartOf(isDay(q.week) ? q.week! : localClock(now, tz).date);
  const w = person ? await weekOf(db, person.id, week, now) : null;
  const own = person?.id === s.userId;
  const tzOf = new Map<string, string>();
  for (const id of new Set(corrections.map((c) => c.c.userId))) tzOf.set(id, (await personTz(db, id)).tz);
  const link = (userId: string, wk: string) => `/work/shifts/timesheets?user=${userId}&week=${wk}`;
  return (
    <>
      <PageHeader title="Timesheets" subtitle="Approve corrections and weekly timesheets, and correct anyone's clocked time with a reason." actions={<><Link href="/work/shifts/manage" className="btn btn-secondary">Manage shifts</Link><Link href="/reports/team-hours" className="btn btn-secondary">Hours, output and pay</Link></>} />

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card title={`Corrections to approve (${corrections.length})`}>
          {corrections.length === 0 ? <Empty>No corrections waiting.</Empty> : (
            <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-700">
              {corrections.map(({ c, name }) => {
                const ctz = tzOf.get(c.userId) ?? tz;
                return (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>{name}: {c.entryId ? "change an entry to" : "add"} {when(c.clockIn, ctz)} to {when(c.clockOut, ctz)} (their time). {c.reason}</span>
                    {c.userId === s.userId ? <span className="text-xs text-slate-500 dark:text-slate-400">Another administrator decides your own.</span> : (
                      <span className="flex gap-2">
                        <ActionForm action={decideCorrectionAction.bind(null, c.id, true)}><SubmitButton pendingLabel="...">Approve</SubmitButton></ActionForm>
                        <ActionForm action={decideCorrectionAction.bind(null, c.id, false)}><SubmitButton className="btn btn-secondary" pendingLabel="...">Deny</SubmitButton></ActionForm>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <Card title={`Timesheets to approve (${awaiting.length})`}>
          {awaiting.length === 0 ? <Empty>No timesheets waiting.</Empty> : (
            <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-700">
              {awaiting.map(({ s: sheet, name }) => (
                <li key={sheet.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span><Link href={link(sheet.userId, sheet.weekStart)} className="font-medium underline">{name}, week of {sheet.weekStart}</Link>: {sheet.hours.toFixed(2)} hours{sheet.note ? ` (${sheet.note})` : ""}</span>
                  {sheet.userId === s.userId ? <span className="text-xs text-slate-500 dark:text-slate-400">Another administrator approves your own.</span> : (
                    <ActionForm action={approveWeekAction.bind(null, sheet.id)}><SubmitButton pendingLabel="...">Approve</SubmitButton></ActionForm>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="A person's week">
        <form action="/work/shifts/timesheets" className="mb-4 flex flex-wrap items-end gap-3 text-sm">
          <label className="block"><span className="label">Person</span><select name="user" defaultValue={person?.id} className="input">{team.map((t) => <option key={t.id} value={t.id}>{t.name}{current.has(t.id) ? "" : " (deactivated)"}</option>)}</select></label>
          <label className="block"><span className="label">Week of</span><input type="date" name="week" defaultValue={week} className="input" /></label>
          <button className="btn btn-secondary">Show</button>
          {person && <><Link href={link(person.id, addDays(week, -7))} className="btn btn-secondary">Previous week</Link><Link href={link(person.id, addDays(week, 7))} className="btn btn-secondary">Next week</Link></>}
        </form>
        {!person || !w ? <Empty>No team members yet.</Empty> : (
          <div className="space-y-4 text-sm">
            <p>
              <span className="font-medium">{person.name}</span>, week of {week}, in their time zone ({w.tz}): {w.hours.toFixed(2)} hours worked.{" "}
              {w.sheet ? <Badge tone={w.sheet.status === "approved" ? "green" : "amber"}>{w.sheet.status}</Badge> : <Badge>not submitted</Badge>}
            </p>
            {w.sheet && !own && (
              <div className="flex flex-wrap items-end gap-2">
                {w.sheet.status === "submitted" && <ActionForm action={approveWeekAction.bind(null, w.sheet.id)}><SubmitButton pendingLabel="...">Approve the week</SubmitButton></ActionForm>}
                <ActionForm action={reopenWeekAction.bind(null, w.sheet.id)} className="flex flex-wrap items-end gap-2">
                  <label className="block"><span className="label">Reason to reopen</span><input name="reason" className="input" maxLength={300} required /></label>
                  <SubmitButton className="btn btn-secondary" pendingLabel="...">Reopen</SubmitButton>
                </ActionForm>
              </div>
            )}
            {own ? <p className="text-slate-600 dark:text-slate-300">Another administrator corrects your own time.</p> : w.sheet?.status === "approved" ? <p className="text-slate-600 dark:text-slate-300">This week is approved and locked. Reopen it to correct it.</p> : (
              <>
                {w.rows.length === 0 && <Empty>No time clocked this week.</Empty>}
                {w.rows.map((r) => (
                  <details key={r.entry.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                    <summary className="cursor-pointer">
                      {when(r.entry.clockIn, w.tz)} to {r.entry.clockOut ? when(r.entry.clockOut, w.tz) : "now (clocked in)"}: {r.hours.toFixed(2)} h
                      {r.breaks.length > 0 && `, ${r.breaks.length} break${r.breaks.length === 1 ? "" : "s"}`}
                      {r.entry.offNetwork && <> <Badge tone="amber">off network</Badge></>}
                      {r.entry.note && <span className="text-slate-500 dark:text-slate-400"> ({r.entry.note})</span>}
                    </summary>
                    <ActionForm action={correctEntryAction.bind(null, r.entry.id)} className="mt-3 grid gap-2 sm:grid-cols-3">
                      <label className="block"><span className="label">Clock-in</span><input type="datetime-local" name="clockIn" defaultValue={toLocalInput(r.entry.clockIn, w.tz)} className="input" required /></label>
                      <label className="block"><span className="label">Clock-out</span><input type="datetime-local" name="clockOut" defaultValue={r.entry.clockOut ? toLocalInput(r.entry.clockOut, w.tz) : ""} className="input" required /></label>
                      <label className="block"><span className="label">Reason</span><input name="reason" className="input" maxLength={300} required /></label>
                      <div><SubmitButton className="btn btn-secondary" pendingLabel="Saving...">Correct the entry</SubmitButton></div>
                    </ActionForm>
                    {r.breaks.map((b) => (
                      <ActionForm key={b.id} action={breakAction.bind(null, r.entry.id, b.id)} className="mt-3 grid gap-2 sm:grid-cols-4">
                        <label className="block"><span className="label">Break start</span><input type="datetime-local" name="startsAt" defaultValue={toLocalInput(b.startsAt, w.tz)} className="input" /></label>
                        <label className="block"><span className="label">Break end</span><input type="datetime-local" name="endsAt" defaultValue={b.endsAt ? toLocalInput(b.endsAt, w.tz) : ""} className="input" /></label>
                        <label className="block"><span className="label">Reason</span><input name="reason" className="input" maxLength={300} required /></label>
                        <label className="flex items-center gap-2 self-end"><input type="checkbox" name="remove" value="1" /> Remove the break</label>
                        <div><SubmitButton className="btn btn-secondary" pendingLabel="Saving...">Save the break</SubmitButton></div>
                      </ActionForm>
                    ))}
                    {r.entry.clockOut && (
                      <ActionForm action={breakAction.bind(null, r.entry.id, null)} className="mt-3 grid gap-2 sm:grid-cols-3">
                        <label className="block"><span className="label">New break start</span><input type="datetime-local" name="startsAt" defaultValue={toLocalInput(r.entry.clockIn, w.tz)} className="input" required /></label>
                        <label className="block"><span className="label">New break end</span><input type="datetime-local" name="endsAt" defaultValue={toLocalInput(r.entry.clockIn, w.tz)} className="input" required /></label>
                        <label className="block"><span className="label">Reason</span><input name="reason" className="input" maxLength={300} required /></label>
                        <div><SubmitButton className="btn btn-secondary" pendingLabel="Adding...">Add a break</SubmitButton></div>
                      </ActionForm>
                    )}
                    <ActionForm action={deleteEntryAction.bind(null, r.entry.id)} className="mt-3 flex flex-wrap items-end gap-2">
                      <label className="block"><span className="label">Reason to remove</span><input name="reason" className="input" maxLength={300} required /></label>
                      <SubmitButton className="btn btn-secondary" pendingLabel="...">Remove the entry</SubmitButton>
                    </ActionForm>
                  </details>
                ))}
                <h3 className="font-semibold">Add a missing entry</h3>
                <ActionForm action={addEntryAction.bind(null, person.id)} className="grid gap-2 sm:grid-cols-3">
                  <label className="block"><span className="label">Clock-in (their time)</span><input type="datetime-local" name="clockIn" defaultValue={`${week}T09:00`} className="input" required /></label>
                  <label className="block"><span className="label">Clock-out (their time)</span><input type="datetime-local" name="clockOut" defaultValue={`${week}T17:00`} className="input" required /></label>
                  <label className="block"><span className="label">Reason</span><input name="reason" className="input" maxLength={300} required /></label>
                  <div><SubmitButton className="btn btn-secondary" pendingLabel="Adding...">Add the entry</SubmitButton></div>
                </ActionForm>
              </>
            )}
            <p className="text-xs text-slate-500 dark:text-slate-400">Times are in the person&apos;s own time zone. Every correction is kept in the audit log with the times before and after and the reason, and the person is told. Correcting a submitted week sends it back to them to submit again.</p>
          </div>
        )}
      </Card>
    </>
  );
}
