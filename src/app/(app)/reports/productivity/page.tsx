import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { requireRole } from "@/lib/auth";
import { EM_ESTABLISHED, EM_NEW, levelShift, productivity, sampleVisits } from "@/server/productivity";
import { Card, Empty, PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Productivity" };
export const dynamic = "force-dynamic";

const isDay = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

function MixRow({ label, mix, codes }: { label: string; mix: { total: number; pct: number[] }; codes: string[] }) {
  return (
    <tr>
      <td data-label="Who">{label}</td>
      <td data-label="Visits" className="text-right tabular-nums">{mix.total}</td>
      {codes.map((c, i) => <td key={c} data-label={c} className="text-right tabular-nums">{mix.total ? `${mix.pct[i]}%` : "-"}</td>)}
    </tr>
  );
}

/** Work RVUs per provider and each provider's E/M level mix against the practice's, with a random sample for chart review. */
export default async function ProductivityPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; sample?: string }> }) {
  const s = await requireRole(["admin"]);
  const q = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const from = isDay(q.from) ? q.from! : new Date(new Date(`${today}T12:00:00Z`).getTime() - 90 * 86_400_000).toISOString().slice(0, 10);
  const to = isDay(q.to) ? q.to! : today;
  const db = await getDb();
  const report = await productivity(db, s.practiceId, from, to);
  const sampleFor = report.providers.find((p) => p.id === q.sample);
  const sample = sampleFor ? await sampleVisits(db, s.practiceId, sampleFor.id, from, to) : [];
  const qs = (extra: string) => `/reports/productivity?from=${from}&to=${to}${extra}`;

  return (
    <>
      <PageHeader title="Productivity and coding profile" subtitle={`${fmtDate(from)} to ${fmtDate(to)} · work RVUs from the Medicare fee schedule, and each provider's E/M level mix`} />
      <form className="mb-6 flex flex-wrap items-end gap-3 text-sm" action="/reports/productivity">
        <label className="block"><span className="label">From</span><input type="date" name="from" defaultValue={from} className="input" /></label>
        <label className="block"><span className="label">To</span><input type="date" name="to" defaultValue={to} className="input" /></label>
        <button className="btn btn-secondary">Show</button>
      </form>
      {!report.rvusLoaded && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Work RVUs need the Medicare fee schedule&apos;s RVU file loaded (Settings, Code sets). Visits and the E/M mix are shown without it.</p>
      )}
      <Card title="Work RVUs by provider" className="mb-6">
        {report.providers.length === 0 ? <Empty>No visits in this period.</Empty> : (
          <div tabIndex={0} role="region" aria-label="Work RVUs by provider" className="overflow-x-auto">
            <table className="table table-stack">
              <thead><tr><th>Provider</th><th className="text-right">Visits</th><th className="text-right">Work RVUs</th><th className="text-right">Per visit</th><th className="text-right">Lines without an RVU</th><th /></tr></thead>
              <tbody>{report.providers.map((p) => (
                <tr key={p.id}>
                  <td data-label="Provider">{p.name}</td>
                  <td data-label="Visits" className="text-right tabular-nums">{p.visits}</td>
                  <td data-label="Work RVUs" className="text-right font-semibold tabular-nums">{p.wrvu.toFixed(2)}</td>
                  <td data-label="Per visit" className="text-right tabular-nums">{p.visits ? (p.wrvu / p.visits).toFixed(2) : "-"}</td>
                  <td data-label="Lines without an RVU" className="text-right tabular-nums">{p.unpriced}</td>
                  <td data-label="Review"><Link href={qs(`&sample=${p.id}`)} className="text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300">Sample 10 visits</Link></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Established patient visits (99211-99215)">
          <div tabIndex={0} role="region" aria-label="Established patient E/M mix" className="overflow-x-auto">
            <table className="table table-stack text-sm">
              <thead><tr><th>Provider</th><th className="text-right">Visits</th>{EM_ESTABLISHED.map((c) => <th key={c} className="text-right">{c}</th>)}</tr></thead>
              <tbody>
                <MixRow label="Whole practice" mix={report.practice.establishedMix} codes={EM_ESTABLISHED} />
                {report.providers.map((p) => {
                  const shift = levelShift(p.establishedMix, report.practice.establishedMix);
                  return <MixRow key={p.id} label={`${p.name}${shift !== null && Math.abs(shift) >= 0.5 ? ` (${shift > 0 ? "+" : ""}${shift} levels)` : ""}`} mix={p.establishedMix} codes={EM_ESTABLISHED} />;
                })}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="New patient visits (99202-99205)">
          <div tabIndex={0} role="region" aria-label="New patient E/M mix" className="overflow-x-auto">
            <table className="table table-stack text-sm">
              <thead><tr><th>Provider</th><th className="text-right">Visits</th>{EM_NEW.map((c) => <th key={c} className="text-right">{c}</th>)}</tr></thead>
              <tbody>
                <MixRow label="Whole practice" mix={report.practice.newMix} codes={EM_NEW} />
                {report.providers.map((p) => <MixRow key={p.id} label={p.name} mix={p.newMix} codes={EM_NEW} />)}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
      <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">A provider half a level or more from the practice&apos;s established-visit average is marked. A different mix can have good reasons (specialty, sicker patients); it is a prompt to review a sample of charts, not a finding.</p>

      {sampleFor && (
        <Card title={`Random sample: ${sampleFor.name}`} className="mt-6">
          {sample.length === 0 ? <Empty>No E/M visits for this provider in the period.</Empty> : (
            <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-700">
              {sample.map((v) => (
                <li key={v.encounterId} className="flex flex-wrap justify-between gap-2 py-2">
                  <span>{fmtDate(v.dateOfService)} · {v.patient} · <span className="font-mono">{v.cpt}</span></span>
                  {v.claimId ? <Link href={`/claims/${v.claimId}`} className="font-mono text-brand-700 hover:underline dark:text-brand-300">{v.controlNumber}</Link> : <span className="text-slate-500">no claim</span>}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Compare each visit&apos;s documentation with its level. A new sample is drawn each time the page loads.</p>
        </Card>
      )}
    </>
  );
}
