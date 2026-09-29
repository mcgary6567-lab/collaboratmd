import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { warningOutcomes } from "@/server/warning-outcomes";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Warnings that became denials" };
export const dynamic = "force-dynamic";

const isDay = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;

/** Scrub warnings claims were sent with, and how often those claims were denied. */
export default async function WarningsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const s = await requireSession();
  const q = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const to = isDay(q.to) ? q.to! : today;
  const from = isDay(q.from) ? q.from! : new Date(new Date(`${to}T12:00:00Z`).getTime() - 180 * 86_400_000).toISOString().slice(0, 10);
  const r = await warningOutcomes(await getDb(), s.practiceId, from, to);
  return (
    <>
      <PageHeader title="Warnings that became denials" subtitle={`Claims sent ${fmtDate(from)} to ${fmtDate(to)} with a scrub warning, and how often they were denied (all claims: ${pct(r.baseline)} of ${r.claims.toLocaleString("en-US")})`} actions={<Link href="/settings/payer-edits" className="btn btn-secondary">Payer edits</Link>} />
      <form className="mb-6 flex flex-wrap items-end gap-3 text-sm" action="/reports/warnings">
        <label className="block"><span className="label">From</span><input type="date" name="from" defaultValue={from} className="input" /></label>
        <label className="block"><span className="label">To</span><input type="date" name="to" defaultValue={to} className="input" /></label>
        <button className="btn btn-secondary">Show</button>
      </form>
      <Card>
        {r.outcomes.length === 0 ? <Empty>No claims were sent with warnings in this period.</Empty> : (
          <div tabIndex={0} role="region" aria-label="Warnings and denials" className="overflow-x-auto">
            <table className="table table-stack">
              <thead><tr><th>Warning</th><th>Payer</th><th className="text-right">Claims sent with it</th><th className="text-right">Denied</th><th className="text-right">Rate</th><th>Most common denial</th><th /></tr></thead>
              <tbody>{r.outcomes.map((o) => (
                <tr key={`${o.rule}-${o.payerId}`}>
                  <td data-label="Warning" className="font-mono text-xs">{o.rule}</td>
                  <td data-label="Payer">{o.payerName}</td>
                  <td data-label="Claims sent with it" className="text-right tabular-nums">{o.sent}</td>
                  <td data-label="Denied" className="text-right tabular-nums">{o.denied}</td>
                  <td data-label="Rate" className={`text-right tabular-nums ${o.suggest ? "font-semibold text-red-700" : ""}`}>{pct(o.rate)}</td>
                  <td data-label="Most common denial">{/* A front-end rejection carries its 277CA status code (category:status:entity) rather than a CARC. */}
                    {o.topCarc ? (o.topCarc.includes(":") ? `Rejected, status ${o.topCarc}` : `CARC ${o.topCarc}`) : "-"}</td>
                  <td data-label="Suggestion">{o.suggest ? <Badge tone="red">Block for this payer</Badge> : null}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">&quot;Block for this payer&quot; is suggested when at least 10 claims went out with the warning and 30% or more were denied, at least twice the practice&apos;s overall rate. Add a payer edit that blocks the matching problem, or turn on strict scrubbing (Settings, Policies) to block every warning.</p>
      </Card>
    </>
  );
}
