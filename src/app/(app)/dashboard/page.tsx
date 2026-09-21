import Link from "next/link";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { dashboardKpis } from "@/server/reports";
import { Card, PageHeader, Stat, StatusBadge, PatientLink, Money } from "@/components/ui";
import { TrendChart, AgingChart } from "@/components/charts";
import { money, fmtDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const s = await requireSession();
  const db = await getDb();
  const k = await dashboardKpis(db, s.practiceId);
  const pct = (v: number) => (v * 100).toFixed(1) + "%";
  const statuses = Object.entries(k.byStatus).sort((a, b) => b[1].n - a[1].n);

  return (
    <>
      <PageHeader title="Revenue cycle dashboard" subtitle="Live financial performance across the practice" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 xl:grid-cols-7">
        <Stat label="Charges (90d)" value={money(k.charges90)} />
        <Stat label="Collections (90d)" value={money(k.insPaid90 + k.patPaid90)} hint={`Insurance ${money(k.insPaid90)} / Patient ${money(k.patPaid90)}`} tone="good" />
        <Stat label="Insurance AR" value={money(k.insuranceAr)} hint={`>90 days: ${money(k.aging.b91_120 + k.aging.b120p)}`} />
        <Stat label="Patient AR" value={money(k.patientAr)} />
        <Stat label="Days in AR" value={String(k.daysInAr)} hint="Target < 40" tone={k.daysInAr > 40 ? "bad" : "good"} />
        <Stat label="Clean claim rate" value={pct(k.cleanClaimRate)} hint="First-pass acceptance" tone={k.cleanClaimRate >= 0.95 ? "good" : "neutral"} />
        <Stat label="Denial rate" value={pct(k.denialRate)} hint={`${k.openDenials} open / ${money(k.deniedCents)}`} tone={k.denialRate > 0.1 ? "bad" : "good"} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Charges vs payments (6 months)">
          <TrendChart data={k.months} />
        </Card>
        <Card title="Insurance AR aging">
          <AgingChart aging={k.aging} />
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card title="Claims by status">
          <ul className="space-y-2">
            {statuses.map(([status, v]) => (
              <li key={status} className="flex items-center justify-between text-sm">
                <Link href={`/claims?status=${status}`}>
                  <StatusBadge status={status} />
                </Link>
                <span className="text-slate-500">
                  {v.n} · <Money cents={v.total} />
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-4 text-xs text-slate-500">Net collection rate (90d): {pct(k.netCollectionRate)}</div>
        </Card>
        <Card title="Recent claim activity" className="lg:col-span-2">
          <table className="table">
            <thead>
              <tr>
                <th>Claim</th>
                <th>Patient</th>
                <th>Payer</th>
                <th>Status</th>
                <th className="text-right">Billed</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {k.recent.map((r) => (
                <tr key={r.claim.id}>
                  <td>
                    <Link href={`/claims/${r.claim.id}`} className="font-mono text-brand-700 hover:underline">
                      {r.claim.controlNumber}
                    </Link>
                  </td>
                  <td>
                    <PatientLink id={r.patient.id} first={r.patient.firstName} last={r.patient.lastName} />
                  </td>
                  <td>{r.payer.name}</td>
                  <td>
                    <StatusBadge status={r.claim.status} />
                  </td>
                  <td className="text-right">
                    <Money cents={r.claim.totalCents} />
                  </td>
                  <td className="text-slate-500">{fmtDate(r.claim.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </>
  );
}
