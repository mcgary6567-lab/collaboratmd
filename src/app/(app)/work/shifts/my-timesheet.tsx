import type { Db } from "@/db";
import { correctionRequests, personTz, toLocalInput, weekOf, weekStartOf } from "@/server/timesheets";
import { localClock } from "@/server/shifts";
import { cancelCorrectionAction, reopenWeekAction, requestCorrectionAction, submitWeekAction } from "@/app/(app)/timesheet-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card } from "@/components/ui";

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** "Mon Oct 5, 21:00" in a time zone. */
export const when = (d: Date, tz: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);

const STATUS: Record<string, { tone: "amber" | "green" | "slate" | "red"; label: string }> = {
  requested: { tone: "amber", label: "waiting" }, approved: { tone: "green", label: "approved" }, denied: { tone: "red", label: "denied" }, cancelled: { tone: "slate", label: "withdrawn" },
};

/** The person's own time this week and last: entries, submitting the week, and asking for corrections. */
export async function MyTimesheet({ db, practiceId, userId }: { db: Db; practiceId: string; userId: string }) {
  const now = new Date();
  const { tz } = await personTz(db, userId);
  const thisWeek = weekStartOf(localClock(now, tz).date);
  const weeks = await Promise.all([addDays(thisWeek, -7), thisWeek].map((w) => weekOf(db, userId, w, now)));
  const requests = (await correctionRequests(db, practiceId, userId)).slice(0, 10);
  const entries = weeks.flatMap((w) => w.rows);
  return (
    <Card title="Your timesheet" className="mb-6">
      <div className="grid gap-6 lg:grid-cols-2">
        {weeks.map((w) => (
          <div key={w.weekStart} className="text-sm">
            <h3 className="font-semibold">Week of {w.weekStart} <span className="font-normal text-slate-500 dark:text-slate-400">({w.hours.toFixed(2)} hours)</span>{" "}
              {w.sheet ? <Badge tone={w.sheet.status === "approved" ? "green" : "amber"}>{w.sheet.status === "approved" ? "approved" : "submitted"}</Badge> : <Badge>not submitted</Badge>}
            </h3>
            {w.rows.length === 0 ? <p className="text-slate-500 dark:text-slate-400">No time clocked.</p> : (
              <ul className="mt-1 space-y-1">
                {w.rows.map((r) => (
                  <li key={r.entry.id}>
                    {when(r.entry.clockIn, tz)} to {r.entry.clockOut ? when(r.entry.clockOut, tz) : "now (clocked in)"}: {r.hours.toFixed(2)} h
                    {r.breaks.length > 0 && <span className="text-slate-500 dark:text-slate-400"> ({r.breaks.length} break{r.breaks.length === 1 ? "" : "s"})</span>}
                    {r.entry.offNetwork && <> <Badge tone="amber">off network</Badge></>}
                  </li>
                ))}
              </ul>
            )}
            {!w.sheet && w.rows.length > 0 && (
              <ActionForm action={submitWeekAction.bind(null, w.weekStart)} className="mt-2 flex flex-wrap items-end gap-2">
                <label className="block"><span className="label">Note (optional)</span><input name="note" className="input" maxLength={300} /></label>
                <SubmitButton className="btn btn-secondary" pendingLabel="...">Submit the week</SubmitButton>
              </ActionForm>
            )}
            {w.sheet?.status === "submitted" && (
              <ActionForm action={reopenWeekAction.bind(null, w.sheet.id)} className="mt-2"><SubmitButton className="btn btn-secondary" pendingLabel="...">Withdraw to change</SubmitButton></ActionForm>
            )}
          </div>
        ))}
      </div>
      <h3 className="mt-6 text-sm font-semibold">Ask for a correction</h3>
      <ActionForm action={requestCorrectionAction} className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
        <label className="block sm:col-span-2"><span className="label">Entry</span>
          <select name="entryId" className="input">
            <option value="">A shift I did not clock (add it)</option>
            {entries.filter((r) => !r.open).map((r) => <option key={r.entry.id} value={r.entry.id}>{when(r.entry.clockIn, tz)} to {when(r.entry.clockOut!, tz)}</option>)}
          </select>
        </label>
        <label className="block"><span className="label">Clock-in (your time)</span><input type="datetime-local" name="clockIn" defaultValue={toLocalInput(now, tz)} className="input" required /></label>
        <label className="block"><span className="label">Clock-out (your time)</span><input type="datetime-local" name="clockOut" defaultValue={toLocalInput(now, tz)} className="input" required /></label>
        <label className="block sm:col-span-2"><span className="label">Reason</span><input name="reason" className="input" maxLength={300} required /></label>
        <div><SubmitButton pendingLabel="Sending...">Ask for the correction</SubmitButton></div>
      </ActionForm>
      {requests.length > 0 && (
        <ul className="mt-4 space-y-1 text-sm">
          {requests.map(({ c }) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2">
              <span>{c.entryId ? "Change to" : "Add"} {when(c.clockIn, tz)} to {when(c.clockOut, tz)}: {c.reason} <Badge tone={STATUS[c.status]?.tone ?? "slate"}>{STATUS[c.status]?.label ?? c.status}</Badge></span>
              {c.status === "requested" && <ActionForm action={cancelCorrectionAction.bind(null, c.id)}><SubmitButton className="btn btn-secondary" pendingLabel="...">Withdraw</SubmitButton></ActionForm>}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Submit each week once it is over; an administrator approves it for payroll. Once approved, a week is locked: ask an administrator to reopen it.</p>
    </Card>
  );
}
