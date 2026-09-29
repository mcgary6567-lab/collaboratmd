import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { qualityReport } from "@/server/quality";
import { Card, Empty, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Quality report" };
export const dynamic = "force-dynamic";

const pct = (v: number | null) => (v === null ? "-" : `${Math.round(v * 1000) / 10}%`);

/** Each measure over a year: visits that qualified, how many reported it, and the share that met it. */
export default async function QualityReportPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const s = await requireSession();
  const year = Number((await searchParams).year) || new Date().getUTCFullYear();
  const rows = await qualityReport(await getDb(), s.practiceId, `${year}-01-01`, `${year}-12-31`);
  return (
    <>
      <PageHeader title="Quality report" subtitle={`MIPS measures reported on claims, ${year}. Performance counts met against met plus not met; exclusions are left out.`} actions={<><Link href={`/reports/quality?year=${year - 1}`} className="btn btn-secondary">{year - 1}</Link><Link href="/settings/quality" className="btn btn-secondary">Measures</Link></>} />
      <Card>
        {rows.length === 0 ? <Empty action={<Link href="/settings/quality" className="btn btn-primary">Add a measure</Link>}>No quality measures set up.</Empty> : (
          <div tabIndex={0} role="region" aria-label="Quality measures" className="overflow-x-auto">
            <table className="table table-stack">
              <thead><tr><th>Measure</th><th className="text-right">Qualifying visits</th><th className="text-right">Reported</th><th className="text-right">Reporting rate</th><th className="text-right">Met</th><th className="text-right">Not met</th><th className="text-right">Excluded</th><th className="text-right">Performance</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.measure.id}>
                  <td data-label="Measure">#{r.measure.number} {r.measure.title}</td>
                  <td data-label="Qualifying visits" className="text-right tabular-nums">{r.eligible}</td>
                  <td data-label="Reported" className="text-right tabular-nums">{r.reported}</td>
                  <td data-label="Reporting rate" className="text-right tabular-nums">{pct(r.reportingRate)}</td>
                  <td data-label="Met" className="text-right tabular-nums">{r.met}</td>
                  <td data-label="Not met" className="text-right tabular-nums">{r.notMet}</td>
                  <td data-label="Excluded" className="text-right tabular-nums">{r.excluded}</td>
                  <td data-label="Performance" className="text-right font-semibold tabular-nums">{pct(r.performanceRate)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-slate-500">MIPS sets a minimum share of qualifying visits each measure must be reported for; check this year&apos;s threshold with CMS.</p>
      </Card>
    </>
  );
}
