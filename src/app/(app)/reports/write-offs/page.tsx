import type { Metadata } from "next";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { writeOffAnalysis } from "@/server/write-offs";
import { Badge, Card, Empty, Money, PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Write-off analysis" };
export const dynamic = "force-dynamic";

const isDay = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

function Breakdown({ title, rows, empty }: { title: string; rows: { key: string; label?: string; cents: number }[]; empty: string }) {
  const total = rows.reduce((a, r) => a + r.cents, 0);
  return (
    <Card title={title}>
      {rows.length === 0 ? <Empty>{empty}</Empty> : (
        <ul className="space-y-2 text-sm">
          {rows.map((r) => (
            <li key={r.key}>
              <div className="flex justify-between gap-3"><span>{r.label ?? r.key}</span><span className="tabular-nums"><Money cents={r.cents} /></span></div>
              <div className="mt-1 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-1.5 rounded-full bg-red-500" style={{ width: `${total ? Math.max(2, (r.cents / total) * 100) : 0}%` }} /></div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Every dollar taken off A/R without being collected, by why. */
export default async function WriteOffsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const s = await requireSession();
  const q = await searchParams;
  const to = isDay(q.to) ? q.to! : new Date().toISOString().slice(0, 10);
  const from = isDay(q.from) ? q.from! : new Date(Date.parse(`${to}T12:00:00Z`) - 365 * 86_400_000).toISOString().slice(0, 10);
  const r = await writeOffAnalysis(await getDb(), s.practiceId, from, to);
  const avoidable = r.byKind.find((k) => k.key === "avoidable")?.cents ?? 0;
  return (
    <>
      <PageHeader title="Write-off analysis" subtitle={`Posted ${fmtDate(`${from}T00:00:00`)} to ${fmtDate(`${to}T00:00:00`)}: contractual, avoidable, policy and bad debt`} />
      <form className="mb-6 flex flex-wrap items-end gap-3 text-sm" action="/reports/write-offs">
        <label className="block"><span className="label">From</span><input type="date" name="from" defaultValue={from} className="input" /></label>
        <label className="block"><span className="label">To</span><input type="date" name="to" defaultValue={to} className="input" /></label>
        <button className="btn btn-secondary">Show</button>
      </form>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {r.byKind.map((k) => (
          <div key={k.key} className={`rounded-xl border p-4 ${k.key === "avoidable" ? "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30" : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"}`}>
            <div className={`text-xs font-semibold uppercase tracking-wide ${k.key === "avoidable" ? "text-red-900 dark:text-red-200" : "text-slate-600 dark:text-slate-400"}`}>{k.label}</div>
            <div className="mt-1 text-2xl font-bold tabular-nums"><Money cents={k.cents} /></div>
          </div>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Write-offs by reason">
          {r.byCategory.length === 0 ? <Empty>No write-offs in this period.</Empty> : (
            <ul className="space-y-2 text-sm">
              {r.byCategory.map((c) => (
                <li key={c.key} className="flex justify-between gap-3">
                  <span>{c.label} {c.kind === "avoidable" ? <Badge tone="red">avoidable</Badge> : c.kind === "policy" ? <Badge>policy</Badge> : <Badge tone="green">no loss</Badge>}</span>
                  <span className="tabular-nums"><Money cents={c.cents} /></span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Avoidable write-offs by month">
          {r.avoidableByMonth.length === 0 ? <Empty>None in this period.</Empty> : (
            <div tabIndex={0} role="region" aria-label="Avoidable write-offs by month" className="overflow-x-auto">
              <table className="table"><thead><tr><th>Month</th><th className="text-right">Written off</th></tr></thead>
                <tbody>{r.avoidableByMonth.map((m) => <tr key={m.month}><td>{m.month}</td><td className="text-right tabular-nums"><Money cents={m.cents} /></td></tr>)}</tbody></table>
            </div>
          )}
        </Card>
        <Breakdown title="Avoidable, by payer" rows={r.avoidableByPayer} empty="None in this period." />
        <Breakdown title="Avoidable, by who posted it" rows={r.avoidableByPerson} empty="None in this period." />
      </div>
      <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
        Avoidable write-offs ({avoidable ? <Money cents={avoidable} /> : "$0.00"} here) come from a process the practice controls: filing late, no authorization, coverage not checked, coding errors, unsupported necessity.
        Write-offs record their reason when posted; older ones are sorted by the claim&apos;s last denial or their note. Contractual adjustments are the payer&apos;s contract working as agreed.
      </p>
    </>
  );
}
