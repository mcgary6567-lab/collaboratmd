import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { contractComparison, whatIf } from "@/server/revenue-reports";
import { Card, Empty, PageHeader } from "@/components/ui";
import { fmtDate, money } from "@/lib/utils";

export const metadata: Metadata = { title: "Contract comparison" };
export const dynamic = "force-dynamic";

const isDay = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Each payer's allowed amounts against Medicare's fee schedule, and a what-if at a proposed percent of Medicare. */
export default async function ContractsReportPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; pct?: string }> }) {
  const s = await requireSession();
  const q = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const to = isDay(q.to) ? q.to! : today;
  const from = isDay(q.from) ? q.from! : `${Number(to.slice(0, 4)) - 1}${to.slice(4)}`;
  const pct = Math.min(500, Math.max(1, Number(q.pct) || 120));
  const r = await contractComparison(await getDb(), s.practiceId, from, to);
  return (
    <>
      <PageHeader title="Contract comparison" subtitle={`What each payer allowed, ${fmtDate(from)} to ${fmtDate(to)}, against Medicare's fee schedule for the same claims`} />
      <form className="mb-6 flex flex-wrap items-end gap-3 text-sm" action="/reports/contracts">
        <label className="block"><span className="label">From</span><input type="date" name="from" defaultValue={from} className="input" /></label>
        <label className="block"><span className="label">To</span><input type="date" name="to" defaultValue={to} className="input" /></label>
        <label className="block"><span className="label">What if a payer paid % of Medicare</span><input name="pct" type="number" min={1} max={500} defaultValue={pct} className="input w-28" /></label>
        <button className="btn btn-secondary">Show</button>
      </form>
      <Card>
        {!r.ready ? <Empty action={<Link href="/settings/profile" className="btn btn-primary">Practice profile</Link>}>{r.reason}</Empty>
          : r.payers.length === 0 ? <Empty>No paid claims in this period with every line priced by the Medicare fee schedule. Load the fee schedule files (Settings, Code sets) if they are not loaded.</Empty> : (
          <div tabIndex={0} role="region" aria-label="Contract comparison" className="overflow-x-auto">
            <table className="table table-stack">
              <thead><tr><th>Payer</th><th className="text-right">Claims</th><th className="text-right">Allowed</th><th className="text-right">Medicare would allow</th><th className="text-right">% of Medicare</th><th className="text-right">At {pct}%</th><th className="text-right">Difference</th></tr></thead>
              <tbody>{r.payers.map((p) => {
                const w = whatIf(p, pct);
                return (
                  <tr key={p.payerId}>
                    <td data-label="Payer">{p.name}</td>
                    <td data-label="Claims" className="text-right tabular-nums">{p.claims}</td>
                    <td data-label="Allowed" className="text-right tabular-nums">{money(p.allowedCents)}</td>
                    <td data-label="Medicare would allow" className="text-right tabular-nums">{money(p.medicareCents)}</td>
                    <td data-label="% of Medicare" className="text-right font-semibold tabular-nums">{p.percentOfMedicare === null ? "-" : `${p.percentOfMedicare}%`}</td>
                    <td data-label={`At ${pct}%`} className="text-right tabular-nums">{money(w.projectedCents)}</td>
                    <td data-label="Difference" className={`text-right font-semibold tabular-nums ${w.differenceCents > 0 ? "text-green-700" : "text-slate-600"}`}>{w.differenceCents > 0 ? "+" : ""}{money(w.differenceCents)}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Allowed is what the payer paid plus the patient&apos;s share. Only claims whose every line Medicare prices are counted; Medicare&apos;s multiple-procedure reduction is not applied, so claims with several surgical codes read slightly high on the Medicare side. Medicare itself and self-pay are left out.</p>
      </Card>
    </>
  );
}
