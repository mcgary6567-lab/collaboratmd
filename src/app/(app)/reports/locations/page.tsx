import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { locationSummary } from "@/server/location-report";
import { Card, Empty, PageHeader } from "@/components/ui";
import { money } from "@/lib/utils";

export const metadata: Metadata = { title: "Locations report" };

export const dynamic = "force-dynamic";

const iso = (d: Date) => d.toISOString().slice(0, 10);

export default async function LocationReportPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const sp = await searchParams;
  const s = await requireSession();
  const today = new Date();
  const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.to ?? "") ? sp.to! : iso(today);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? "") ? sp.from! : iso(new Date(today.getTime() - 90 * 86_400_000));
  const rows = await locationSummary(await getDb(), s.practiceId, from, to);
  const pct = (v: number | null) => (v === null ? "-" : `${(v * 100).toFixed(1)}%`);
  return (
    <>
      <PageHeader title="By location" subtitle="Volume, collections, open balances and denials for each place you see patients, by date of service" actions={<Link href="/settings/locations" className="btn btn-secondary">Locations</Link>} />
      <Card>
        <form action="/reports/locations" className="mb-4 flex flex-wrap items-end gap-3 text-sm">
          <label className="block"><span className="label">Visits from</span><input type="date" name="from" defaultValue={from} className="input" /></label>
          <label className="block"><span className="label">to</span><input type="date" name="to" defaultValue={to} className="input" /></label>
          <button className="btn btn-secondary">Show</button>
        </form>
        {rows.length === 0 ? <Empty>No claims for visits in this period.</Empty> : (
          <div tabIndex={0} role="region" aria-label="Table (scrolls sideways)" className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Location</th><th className="text-right">Visits</th><th className="text-right">Claims</th><th className="text-right">Charges</th><th className="text-right">Insurance paid</th><th className="text-right">Patient paid</th><th className="text-right">Adjusted</th><th className="text-right">Still open</th><th className="text-right">Denial rate</th><th className="text-right">Collected per visit</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.locationId ?? "main"}>
                    <td className="font-medium">{r.name}</td>
                    <td className="text-right">{r.visits.toLocaleString()}</td>
                    <td className="text-right">{r.claims.toLocaleString()}</td>
                    <td className="text-right tabular-nums">{money(r.chargesCents)}</td>
                    <td className="text-right tabular-nums">{money(r.insurancePaidCents)}</td>
                    <td className="text-right tabular-nums">{money(r.patientPaidCents)}</td>
                    <td className="text-right tabular-nums">{money(r.adjustmentsCents)}</td>
                    <td className="text-right tabular-nums">{money(r.openCents)}</td>
                    <td className="text-right">{pct(r.denialRate)}</td>
                    <td className="text-right tabular-nums">{r.collectedPerVisitCents === null ? "-" : money(r.collectedPerVisitCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-slate-500">Original primary claims only (corrections and secondary claims are left out so nothing is counted twice). Visits without a location count under the main office.</p>
      </Card>
    </>
  );
}
