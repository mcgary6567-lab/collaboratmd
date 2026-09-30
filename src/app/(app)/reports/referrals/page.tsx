import type { Metadata } from "next";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { referralReport } from "@/server/referrals";
import { Card, Empty, Money, PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Referral sources" };
export const dynamic = "force-dynamic";

const isDay = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Where new patients came from, and what they have been worth since. */
export default async function ReferralsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const s = await requireSession();
  const q = await searchParams;
  const to = isDay(q.to) ? q.to! : new Date().toISOString().slice(0, 10);
  const from = isDay(q.from) ? q.from! : new Date(Date.parse(`${to}T12:00:00Z`) - 365 * 86_400_000).toISOString().slice(0, 10);
  const r = await referralReport(await getDb(), s.practiceId, from, to);
  return (
    <>
      <PageHeader title="Referral sources" subtitle={`${r.total} new patient${r.total === 1 ? "" : "s"} registered ${fmtDate(`${from}T00:00:00`)} to ${fmtDate(`${to}T00:00:00`)}; source recorded for ${Math.round(r.recordedShare * 100)}%`} />
      <form className="mb-6 flex flex-wrap items-end gap-3 text-sm" action="/reports/referrals">
        <label className="block"><span className="label">Registered from</span><input type="date" name="from" defaultValue={from} className="input" /></label>
        <label className="block"><span className="label">To</span><input type="date" name="to" defaultValue={to} className="input" /></label>
        <button className="btn btn-secondary">Show</button>
      </form>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="By source" className="lg:col-span-2">
          {r.sources.length === 0 ? <Empty>No new patients in this period.</Empty> : (
            <div tabIndex={0} role="region" aria-label="By source" className="overflow-x-auto">
              <table className="table table-stack text-sm">
                <thead><tr><th>Source</th><th className="text-right">New patients</th><th className="text-right">Seen</th><th className="text-right">Billed</th><th className="text-right">Collected</th></tr></thead>
                <tbody>{r.sources.map((x) => (
                  <tr key={x.source ?? "none"}>
                    <td data-label="Source">{x.label}</td>
                    <td data-label="New patients" className="text-right tabular-nums">{x.patients}</td>
                    <td data-label="Seen" className="text-right tabular-nums">{x.seen}</td>
                    <td data-label="Billed" className="text-right tabular-nums"><Money cents={x.chargesCents} /></td>
                    <td data-label="Collected" className="text-right tabular-nums"><Money cents={x.collectedCents} /></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title="Referring physicians">
          {r.doctors.length === 0 ? <Empty>No physician referrals named in this period.</Empty> : (
            <ul className="space-y-1 text-sm">{r.doctors.map((d) => <li key={d.name} className="flex justify-between gap-3"><span>{d.name}</span><span className="tabular-nums">{d.patients}</span></li>)}</ul>
          )}
        </Card>
      </div>
      <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">Ask &quot;how did you hear about us?&quot; when registering a patient; it can be added or changed later on the patient&apos;s page. Billed and collected are everything for these patients since they registered.</p>
    </>
  );
}
