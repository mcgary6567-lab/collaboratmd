import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { requireRole } from "@/lib/auth";
import { hoursAndOutput, MAX_ENTRY_HOURS } from "@/server/shifts";
import { Card, Empty, PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Hours and output" };
export const dynamic = "force-dynamic";

const isDay = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
const rate = (v: number | null) => (v === null ? "-" : v.toFixed(1));

/** Hours clocked by each person and what they got done, per hour. */
export default async function TeamHoursPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const s = await requireRole(["admin"]);
  const q = await searchParams;
  const to = isDay(q.to) ? q.to! : new Date().toISOString().slice(0, 10);
  const from = isDay(q.from) ? q.from! : new Date(Date.parse(`${to}T12:00:00Z`) - 6 * 86_400_000).toISOString().slice(0, 10);
  const rows = await hoursAndOutput(await getDb(), s.practiceId, from, to);
  const total = rows.reduce((a, r) => a + r.hours, 0);
  return (
    <>
      <PageHeader title="Hours and output" subtitle={`${fmtDate(`${from}T00:00:00`)} to ${fmtDate(`${to}T00:00:00`)}: ${total.toFixed(1)} hours clocked across the team`} actions={<Link href="/work/shifts" className="btn btn-secondary">Shifts and time off</Link>} />
      <form className="mb-6 flex flex-wrap items-end gap-3 text-sm" action="/reports/team-hours">
        <label className="block"><span className="label">From</span><input type="date" name="from" defaultValue={from} className="input" /></label>
        <label className="block"><span className="label">To</span><input type="date" name="to" defaultValue={to} className="input" /></label>
        <button className="btn btn-secondary">Show</button>
      </form>
      <Card title="By person">
        {rows.length === 0 ? <Empty>No team members yet.</Empty> : (
          <div tabIndex={0} role="region" aria-label="Hours and output by person" className="overflow-x-auto">
            <table className="table table-stack text-sm">
              <thead><tr><th>Person</th><th className="text-right">Hours</th><th className="text-right">Tasks done</th><th className="text-right">Claims sent</th><th className="text-right">Payments and adjustments posted</th><th className="text-right">Tasks per hour</th><th className="text-right">Claims per hour</th><th className="text-right">Postings per hour</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.userId}>
                  <td data-label="Person">{r.name}</td>
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
      <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">Hours come from clocking in and out on Shifts and time off; an entry left open counts at most {MAX_ENTRY_HOURS} hours. Per-hour figures need at least half an hour clocked. Work differs in difficulty (an appeal takes longer than a posting), so compare people doing the same kind of work.</p>
    </>
  );
}
