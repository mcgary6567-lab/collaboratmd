import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { lagReport } from "@/server/revenue-reports";
import { Card, Empty, PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Charge and submission lag" };
export const dynamic = "force-dynamic";

const isDay = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
const days = (v: number | null) => (v === null ? "-" : `${v} d`);

/** Days from visit to charge, and charge to claim, per provider. */
export default async function LagPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const s = await requireSession();
  const q = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const to = isDay(q.to) ? q.to! : today;
  const from = isDay(q.from) ? q.from! : new Date(new Date(`${to}T12:00:00Z`).getTime() - 90 * 86_400_000).toISOString().slice(0, 10);
  const rows = await lagReport(await getDb(), s.practiceId, from, to);
  return (
    <>
      <PageHeader title="Charge and submission lag" subtitle={`Visits ${fmtDate(from)} to ${fmtDate(to)}: days from the visit to its charges, and from charges to the claim going out`} actions={<Link href="/billing/missed-charges" className="btn btn-secondary">Missed charges</Link>} />
      <form className="mb-6 flex flex-wrap items-end gap-3 text-sm" action="/reports/lag">
        <label className="block"><span className="label">From</span><input type="date" name="from" defaultValue={from} className="input" /></label>
        <label className="block"><span className="label">To</span><input type="date" name="to" defaultValue={to} className="input" /></label>
        <button className="btn btn-secondary">Show</button>
      </form>
      <Card>
        {rows.length === 0 ? <Empty>No visits in this period.</Empty> : (
          <div tabIndex={0} role="region" aria-label="Lag by provider" className="overflow-x-auto">
            <table className="table table-stack">
              <thead><tr><th>Provider</th><th className="text-right">Visits</th><th className="text-right">Charge lag (avg)</th><th className="text-right">Median</th><th className="text-right">Over 7 days</th><th className="text-right">Submission lag (avg)</th><th className="text-right">Median</th><th className="text-right">Not sent yet</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.providerId}>
                  <td data-label="Provider">{r.name}</td>
                  <td data-label="Visits" className="text-right tabular-nums">{r.visits}</td>
                  <td data-label="Charge lag (avg)" className={`text-right tabular-nums ${(r.chargeAvg ?? 0) > 3 ? "font-semibold text-amber-800" : ""}`}>{days(r.chargeAvg)}</td>
                  <td data-label="Charge lag median" className="text-right tabular-nums">{days(r.chargeMedian)}</td>
                  <td data-label="Over 7 days" className="text-right tabular-nums">{r.chargeLate}</td>
                  <td data-label="Submission lag (avg)" className={`text-right tabular-nums ${(r.submitAvg ?? 0) > 3 ? "font-semibold text-amber-800" : ""}`}>{days(r.submitAvg)}</td>
                  <td data-label="Submission lag median" className="text-right tabular-nums">{days(r.submitMedian)}</td>
                  <td data-label="Not sent yet" className="text-right tabular-nums">{r.unsent}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Charges within a day or two of the visit, and claims out within a day or two of the charges, are good practice. Visits seen but never charged are on Missed charges.</p>
      </Card>
    </>
  );
}
