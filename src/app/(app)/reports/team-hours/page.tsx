import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { requireRole } from "@/lib/auth";
import { hoursAndOutput, MAX_ENTRY_HOURS } from "@/server/shifts";
import { payWorksheet } from "@/server/pay";
import { targetAttainment } from "@/server/targets";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Hours, output and pay" };
export const dynamic = "force-dynamic";

const isDay = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
const rate = (v: number | null) => (v === null ? "-" : v.toFixed(1));
const money = (cents: number, currency: string) => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

/** Hours clocked by each person, what they got done per hour, and the pay worksheet for the period. */
export default async function TeamHoursPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const s = await requireRole(["admin"]);
  const q = await searchParams;
  const to = isDay(q.to) ? q.to! : new Date().toISOString().slice(0, 10);
  const from = isDay(q.from) ? q.from! : new Date(Date.parse(`${to}T12:00:00Z`) - 6 * 86_400_000).toISOString().slice(0, 10);
  const db = await getDb();
  const [rows, pay, goals] = await Promise.all([hoursAndOutput(db, s.practiceId, from, to), payWorksheet(db, s.practiceId, from, to), targetAttainment(db, s.practiceId, from, to)]);
  const total = rows.reduce((a, r) => a + r.hours, 0);
  const totals = new Map<string, number>();
  for (const p of pay) if (p.grossCents !== null && p.currency) totals.set(p.currency, (totals.get(p.currency) ?? 0) + p.grossCents);
  const wholeWeeks = weekday(from) === 1 && weekday(to) === 0;
  return (
    <>
      <PageHeader title="Hours, output and pay" subtitle={`${fmtDate(`${from}T00:00:00`)} to ${fmtDate(`${to}T00:00:00`)}: ${total.toFixed(1)} hours worked across the team`} actions={<Link href="/work/shifts" className="btn btn-secondary">Shifts and time off</Link>} />
      <form className="mb-6 flex flex-wrap items-end gap-3 text-sm" action="/reports/team-hours">
        <label className="block"><span className="label">From</span><input type="date" name="from" defaultValue={from} className="input" /></label>
        <label className="block"><span className="label">To</span><input type="date" name="to" defaultValue={to} className="input" /></label>
        <button className="btn btn-secondary">Show</button>
      </form>
      <Card title="By person" className="mb-6">
        {rows.length === 0 ? <Empty>No team members yet.</Empty> : (
          <div tabIndex={0} role="region" aria-label="Hours and output by person" className="overflow-x-auto">
            <table className="table table-stack text-sm">
              <thead><tr><th>Person</th><th className="text-right">Hours</th><th className="text-right">Tasks done</th><th className="text-right">Claims sent</th><th className="text-right">Payments and adjustments posted</th><th className="text-right">Tasks per hour</th><th className="text-right">Claims per hour</th><th className="text-right">Postings per hour</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.userId}>
                  <td data-label="Person">{r.name}{r.offNetwork > 0 && <> <Badge tone="amber">{r.offNetwork} off-network clock-in{r.offNetwork === 1 ? "" : "s"}</Badge></>}</td>
                  <td data-label="Hours" className="text-right tabular-nums">{r.hours.toFixed(1)}</td>
                  <td data-label="Tasks done" className="text-right tabular-nums">{r.tasks}</td>
                  <td data-label="Claims sent" className="text-right tabular-nums">{r.claims}</td>
                  <td data-label="Postings" className="text-right tabular-nums">{r.postings}</td>
                  <td data-label="Tasks per hour" className="text-right tabular-nums">{rate(r.tasksPerHour)}</td>
                  <td data-label="Claims per hour" className="text-right tabular-nums">{rate(r.claimsPerHour)}</td>
                  <td data-label="Postings per hour" className="text-right tabular-nums">{rate(r.postingsPerHour)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Card>
      {goals.length > 0 && (
        <Card title="Against daily targets" className="mb-6">
          <div tabIndex={0} role="region" aria-label="Against daily targets" className="overflow-x-auto">
            <table className="table table-stack text-sm">
              <thead><tr><th>Person</th><th className="text-right">Days worked</th><th>Target</th><th className="text-right">Done</th><th className="text-right">Of target</th></tr></thead>
              <tbody>{goals.flatMap((g) => g.metrics.map((m, i) => (
                <tr key={`${g.userId}:${m.metric}`}>
                  <td data-label="Person">{i === 0 ? g.name : ""}</td>
                  <td data-label="Days worked" className="text-right tabular-nums">{i === 0 ? g.days : ""}</td>
                  <td data-label="Target">{m.label}: {m.perDay} a day ({m.goal})</td>
                  <td data-label="Done" className="text-right tabular-nums">{m.done}</td>
                  <td data-label="Of target" className="text-right">{m.pct === null ? "-" : <Badge tone={m.pct >= 1 ? "green" : m.pct >= 0.8 ? "amber" : "red"}>{Math.round(m.pct * 100)}%</Badge>}</td>
                </tr>
              )))}</tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Each target times the days the person clocked time in the period. Set targets on Manage shifts.</p>
        </Card>
      )}
      <Card title="Pay worksheet" actions={<a href={`/api/export/payroll?from=${from}&to=${to}`} download className="btn btn-secondary">Download CSV</a>}>
        {!wholeWeeks && <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900">Weekly overtime counts Monday-to-Sunday weeks. This period does not start on a Monday and end on a Sunday, so a part week can show less weekly overtime than the full week has.</p>}
        {pay.length === 0 ? <Empty>No hours worked and no pay rates set. Set rates on <Link href="/work/shifts/manage" className="underline">Manage shifts</Link>.</Empty> : (
          <div tabIndex={0} role="region" aria-label="Pay worksheet" className="overflow-x-auto">
            <table className="table table-stack text-sm">
              <thead><tr><th>Person</th><th>Time zone</th><th className="text-right">Hours</th><th className="text-right">Regular</th><th className="text-right">Overtime</th><th className="text-right">Night</th><th className="text-right">Holiday</th><th className="text-right">Rate</th><th className="text-right">Gross</th><th>Weeks approved</th></tr></thead>
              <tbody>{pay.map((p) => (
                <tr key={p.userId}>
                  <td data-label="Person">{p.name}</td>
                  <td data-label="Time zone">{p.tz}</td>
                  <td data-label="Hours" className="text-right tabular-nums">{p.total.toFixed(2)}</td>
                  <td data-label="Regular" className="text-right tabular-nums">{p.regular.toFixed(2)}</td>
                  <td data-label="Overtime" className="text-right tabular-nums">{p.overtime.toFixed(2)}</td>
                  <td data-label="Night" className="text-right tabular-nums">{p.nightHours.toFixed(2)}</td>
                  <td data-label="Holiday" className="text-right tabular-nums">{p.holidayHours.toFixed(2)}</td>
                  <td data-label="Rate" className="text-right tabular-nums">{p.pay ? `${money(p.pay.rateCents, p.pay.currency)}${p.pay.otMultiplier !== 1 ? `, overtime ×${p.pay.otMultiplier}` : ""}` : "not set"}</td>
                  <td data-label="Gross" className="text-right tabular-nums">{p.grossCents !== null && p.currency ? money(p.grossCents, p.currency) : "-"}</td>
                  <td data-label="Weeks approved">{p.weeks.length === 0 ? "-" : <Badge tone={p.approvedWeeks === p.weeks.length ? "green" : "amber"}>{p.approvedWeeks} of {p.weeks.length}</Badge>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        {totals.size > 0 && <p className="mt-3 text-sm font-medium">Total gross: {[...totals].map(([c, v]) => money(v, c)).join(" + ")}</p>}
        {pay.some((p) => p.approvedWeeks < p.weeks.length) && <p className="mt-2 text-sm text-amber-800 dark:text-amber-300">Some weeks are not approved yet. Approve them on <Link href="/work/shifts/timesheets" className="underline">Timesheets</Link> before running payroll.</p>}
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">A worksheet for payroll, not payroll: no taxes, deductions, benefits or payments. Hours are clocked time less breaks, split by day in each person&apos;s own time zone. Overtime follows each person&apos;s weekly and daily thresholds; with both, each week counts whichever gives more, so no hour counts twice. Night hours fall in the person&apos;s night window and earn the night differential; holiday hours are worked on a holiday in their calendar and earn the holiday multiplier (the night differential on a holiday is figured on the holiday rate). Premiums are on the base rate and not compounded with overtime.</p>
      </Card>
      <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">Hours come from clocking in and out on Shifts and time off, less breaks; an entry left open counts at most {MAX_ENTRY_HOURS} hours. Per-hour figures need at least half an hour clocked. Work differs in difficulty (an appeal takes longer than a posting), so compare people doing the same kind of work.</p>
    </>
  );
}
