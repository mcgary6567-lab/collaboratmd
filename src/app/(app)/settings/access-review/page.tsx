import Link from "next/link";
import { getDb } from "@/db";
import { requireRole } from "@/lib/auth";
import { accessAnomalies, chartsOpenedBy, LIMITS } from "@/server/access-anomalies";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { fmtDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** Who opened how many charts in the last day, against their usual. Administrators only. */
export default async function AccessReviewPage({ searchParams }: { searchParams: Promise<{ user?: string }> }) {
  const { user } = await searchParams;
  const s = await requireRole(["admin"]);
  const db = await getDb();
  const people = await accessAnomalies(db, s.practiceId);
  const chosen = user && /^[0-9a-f-]{36}$/i.test(user) ? people.find((p) => p.userId === user) : undefined;
  const charts = chosen ? await chartsOpenedBy(db, s.practiceId, chosen.userId) : [];
  return (
    <>
      <PageHeader title="Chart access review" subtitle="Charts each person opened in the last 24 hours, against their usual. Flags are prompts to look, not findings." actions={<Link href="/settings" className="btn btn-secondary">Back to settings</Link>} />
      <Card title="Last 24 hours">
        <p className="mb-3 text-xs text-slate-500">
          Flagged when someone opens {LIMITS.chartsPerDay} or more charts in a day, or at least {LIMITS.minForMultiple} and more than {LIMITS.multiple} times their usual, or {LIMITS.unrelatedPerDay} or more charts of patients with no appointment within 30 days, no claim or payment in six months, and not new. Administrators get a notification for each flag. Busy days (a payer audit, a statement run) will flag honest work; ask before assuming.
        </p>
        {people.length === 0 ? <Empty>No charts opened in the last 24 hours.</Empty> : (
          <div tabIndex={0} role="region" aria-label="Table (scrolls sideways)" className="overflow-x-auto">
            <table className="table text-sm">
              <thead><tr><th>Person</th><th className="text-right">Charts</th><th className="text-right">Usual a day</th><th className="text-right">No current business</th><th>Flag</th><th /></tr></thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.userId}>
                    <td>{p.name}</td>
                    <td className="text-right tabular-nums">{p.charts}</td>
                    <td className="text-right tabular-nums">{p.usualPerDay}</td>
                    <td className="text-right tabular-nums">{p.unrelated}</td>
                    <td>{p.flagged ? <Badge tone="amber">{p.why.join("; ")}</Badge> : <span className="text-slate-500">none</span>}</td>
                    <td><Link href={`/settings/access-review?user=${p.userId}`} className="text-brand-700 hover:underline">Charts</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {chosen && (
        <Card title={`Charts ${chosen.name} opened in the last 24 hours`} className="mt-6">
          {charts.length === 0 ? <Empty>None.</Empty> : (
            <ul className="divide-y divide-slate-100 text-sm">
              {charts.map((c) => (
                <li key={c.patientId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span><Link href={`/patients/${c.patientId}/access`} className="font-medium text-brand-700 hover:underline">{c.name}</Link> <span className="text-slate-500">· MRN {c.mrn}</span></span>
                  <span className="text-xs text-slate-500">{c.times} time{c.times === 1 ? "" : "s"}, last {fmtDateTime(c.lastAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </>
  );
}
