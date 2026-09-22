import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import {
  headlineKpis, monthlyTrend, arAging, claimsByStatus, payerPerformance,
  providerProductivity, denialReasons, timelyFilingRisk,
} from "@/server/analytics";
import { Card, PageHeader, StatusBadge, Money, Empty } from "@/components/ui";
import { Kpi, compactMoney, pct } from "@/components/kpi";
import { RevenueTrend, AgingChart, DenialReasonChart, PayerMixChart, MiniBar } from "@/components/charts";
import { CARC } from "@/lib/codes/carc";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  const s = await requireSession();
  if (s.role !== "admin") redirect("/dashboard");
  const db = await getDb();

  const [k, trend, aging, statuses, payers, providers, denials, filing] = await Promise.all([
    headlineKpis(db, s.practiceId),
    monthlyTrend(db, s.practiceId),
    arAging(db, s.practiceId),
    claimsByStatus(db, s.practiceId),
    payerPerformance(db, s.practiceId),
    providerProductivity(db, s.practiceId),
    denialReasons(db, s.practiceId),
    timelyFilingRisk(db, s.practiceId),
  ]);

  const over90 = aging.totals.b91_120 + aging.totals.b120p;
  const over90Share = aging.totals.total ? over90 / aging.totals.total : 0;
  const maxProviderBilled = Math.max(...providers.map((p) => p.billedCents), 1);
  const maxPayerBilled = Math.max(...payers.map((p) => p.billedCents), 1);

  return (
    <>
      <PageHeader
        title="Practice analytics"
        subtitle={`${k.providerCount} providers · ${k.patientCount.toLocaleString()} patients · ${k.claimCount.toLocaleString()} claims · trailing 12 months`}
        actions={<Link href="/dashboard" className="btn btn-secondary">My work</Link>}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-7">
        <Kpi label="Charges" value={compactMoney(k.chargesCents)} hint="Billed, 12 months" />
        <Kpi
          label="Collections"
          value={compactMoney(k.insurancePaidCents + k.patientPaidCents)}
          tone="good"
          hint={`Ins ${compactMoney(k.insurancePaidCents)} · Pt ${compactMoney(k.patientPaidCents)}`}
        />
        <Kpi
          label="Net collection"
          value={pct(k.netCollectionRate)}
          tone={k.netCollectionRate >= 0.95 ? "good" : k.netCollectionRate >= 0.9 ? "warn" : "bad"}
          target="Target ≥ 95%"
        />
        <Kpi
          label="Days in A/R"
          value={String(k.daysInAr)}
          tone={k.daysInAr <= 40 ? "good" : k.daysInAr <= 55 ? "warn" : "bad"}
          target="Target < 40 days"
        />
        <Kpi
          label="Clean claim rate"
          value={pct(k.cleanClaimRate)}
          tone={k.cleanClaimRate >= 0.95 ? "good" : "warn"}
          target="Target ≥ 95%"
        />
        <Kpi
          label="Denial rate"
          value={pct(k.denialRate)}
          tone={k.denialRate <= 0.05 ? "good" : k.denialRate <= 0.1 ? "warn" : "bad"}
          hint={`${k.openDenials.toLocaleString()} open · ${compactMoney(k.openDenialCents)}`}
          target="Target < 5%"
        />
        <Kpi
          label="A/R over 90 days"
          value={pct(over90Share)}
          tone={over90Share <= 0.15 ? "good" : over90Share <= 0.25 ? "warn" : "bad"}
          hint={compactMoney(over90)}
          target="Target < 15%"
        />
      </div>

      {(filing.overdue > 0 || filing.within14 > 0) && (
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="font-semibold">Timely filing</span>
          <span>{filing.overdue.toLocaleString()} claims past deadline</span>
          <span>{filing.within14.toLocaleString()} due within 14 days</span>
          <span className="font-semibold">{compactMoney(filing.atRiskCents)} at risk</span>
          <Link href="/claims" className="ml-auto text-xs font-semibold underline">Work the queue</Link>
        </div>
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card title="Charges, collections and adjustments" className="xl:col-span-2">
          <RevenueTrend data={trend} />
        </Card>
        <Card title="Payer mix by billed charges">
          <PayerMixChart data={payers} />
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card title="Insurance A/R aging">
          <AgingChart aging={aging.totals} />
        </Card>
        <Card title="Denials by reason code" className="xl:col-span-2">
          <DenialReasonChart data={denials} />
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card title="Payer performance">
          <table className="table">
            <thead>
              <tr><th>Payer</th><th className="text-right">Claims</th><th className="text-right">Billed</th><th className="text-right">Collected</th><th className="w-28">Realisation</th></tr>
            </thead>
            <tbody>
              {payers.map((p) => {
                const rate = p.billedCents ? p.paidCents / p.billedCents : 0;
                return (
                  <tr key={p.payer}>
                    <td>
                      <div className="font-medium">{p.payer}</div>
                      <div className="text-xs capitalize text-slate-400">{p.type}</div>
                    </td>
                    <td className="text-right tabular-nums">{p.claims.toLocaleString()}</td>
                    <td className="text-right tabular-nums">{compactMoney(p.billedCents)}</td>
                    <td className="text-right tabular-nums text-emerald-700">{compactMoney(p.paidCents)}</td>
                    <td>
                      <div className="mb-1 text-right text-xs tabular-nums text-slate-500">{pct(rate, 0)}</div>
                      <MiniBar value={p.billedCents} max={maxPayerBilled} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>

        <Card title="Top providers by billed charges">
          <table className="table">
            <thead>
              <tr><th>Provider</th><th className="text-right">Claims</th><th className="text-right">Billed</th><th className="text-right">Denied</th><th className="w-24">Share</th></tr>
            </thead>
            <tbody>
              {providers.map((p) => (
                <tr key={p.name}>
                  <td>
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-slate-400">{p.specialty}</div>
                  </td>
                  <td className="text-right tabular-nums">{p.claims.toLocaleString()}</td>
                  <td className="text-right tabular-nums">{compactMoney(p.billedCents)}</td>
                  <td className="text-right tabular-nums text-rose-700">{p.denied.toLocaleString()}</td>
                  <td><MiniBar value={p.billedCents} max={maxProviderBilled} tone="#0ea5e9" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card title="Claims by status">
          {statuses.length === 0 ? <Empty>No claims yet.</Empty> : (
            <ul className="space-y-2">
              {statuses.map((s2) => (
                <li key={s2.status} className="flex items-center justify-between text-sm">
                  <Link href={`/claims?status=${s2.status}`}><StatusBadge status={s2.status} /></Link>
                  <span className="tabular-nums text-slate-500">
                    {s2.count.toLocaleString()} · {compactMoney(s2.totalCents)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="A/R aging by payer" className="xl:col-span-2">
          <table className="table">
            <thead>
              <tr><th>Payer</th><th className="text-right">0-30</th><th className="text-right">31-60</th><th className="text-right">61-90</th><th className="text-right">91-120</th><th className="text-right">120+</th><th className="text-right">Total</th></tr>
            </thead>
            <tbody>
              {aging.rows.slice(0, 10).map((r) => (
                <tr key={r.key}>
                  <td className="font-medium">{r.label}</td>
                  <td className="text-right tabular-nums">{compactMoney(r.b0_30)}</td>
                  <td className="text-right tabular-nums">{compactMoney(r.b31_60)}</td>
                  <td className="text-right tabular-nums">{compactMoney(r.b61_90)}</td>
                  <td className="text-right tabular-nums text-amber-700">{compactMoney(r.b91_120)}</td>
                  <td className="text-right tabular-nums text-red-700">{compactMoney(r.b120p)}</td>
                  <td className="text-right font-semibold tabular-nums">{compactMoney(r.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td>Total</td>
                <td className="text-right tabular-nums">{compactMoney(aging.totals.b0_30)}</td>
                <td className="text-right tabular-nums">{compactMoney(aging.totals.b31_60)}</td>
                <td className="text-right tabular-nums">{compactMoney(aging.totals.b61_90)}</td>
                <td className="text-right tabular-nums">{compactMoney(aging.totals.b91_120)}</td>
                <td className="text-right tabular-nums">{compactMoney(aging.totals.b120p)}</td>
                <td className="text-right tabular-nums"><Money cents={aging.totals.total} /></td>
              </tr>
            </tfoot>
          </table>
        </Card>
      </div>

      <Card title="Largest denial reasons" className="mt-6">
        <table className="table">
          <thead>
            <tr><th>Code</th><th>Meaning</th><th>Category</th><th className="text-right">Claims</th><th className="text-right">At risk</th></tr>
          </thead>
          <tbody>
            {denials.map((d) => (
              <tr key={d.carc}>
                <td className="font-mono font-semibold">{d.carc}</td>
                <td className="max-w-md text-slate-600">{CARC[d.carc]?.description ?? "See remittance detail"}</td>
                <td className="capitalize text-slate-500">{d.category.replace(/_/g, " ")}</td>
                <td className="text-right tabular-nums">{d.count.toLocaleString()}</td>
                <td className="text-right font-semibold tabular-nums">{compactMoney(d.amountCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
