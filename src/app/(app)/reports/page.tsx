import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { arAging, payerPerformance, providerProductivity, denialReasons } from "@/server/analytics";
import { Card, PageHeader, Money, Empty } from "@/components/ui";
import { PrintButton } from "@/components/action-form";
import { compactMoney, pct } from "@/components/kpi";
import { AgingChart, PayerMixChart } from "@/components/charts";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const s = await requireSession();
  const db = await getDb();
  const [ar, payers, providers, denials] = await Promise.all([
    arAging(db, s.practiceId),
    payerPerformance(db, s.practiceId, 20),
    providerProductivity(db, s.practiceId, 25),
    denialReasons(db, s.practiceId, 12),
  ]);
  const share = (part: number, whole: number) => (whole ? pct(part / whole, 1) : "-");

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle="Accounts receivable, payer performance and provider productivity"
        actions={
          <span className="no-print flex flex-wrap gap-2">
            <a href="/reports/builder" className="btn btn-primary text-xs">Report builder</a>
            <a href="/reports/forecast" className="btn btn-secondary text-xs">Cash forecast</a>
            <a href="/reports/payer-alerts" className="btn btn-secondary text-xs">Payer alerts</a>
            <a href="/api/export/ar-aging" className="btn btn-secondary text-xs">A/R aging CSV</a>
            <a href="/api/export/payer-performance" className="btn btn-secondary text-xs">Payer performance CSV</a>
            <PrintButton label="Print or save as PDF" />
          </span>
        }
      />

      <div className="grid gap-6 xl:grid-cols-3">
        <Card title="Insurance A/R aging by payer" className="xl:col-span-2">
          {ar.rows.length === 0 ? (
            <Empty>No outstanding insurance balances.</Empty>
          ) : (
            <table className="table">
              <thead>
                <tr><th>Payer</th><th className="text-right">0-30</th><th className="text-right">31-60</th><th className="text-right">61-90</th><th className="text-right">91-120</th><th className="text-right">120+</th><th className="text-right">Total</th><th className="text-right">% &gt;90</th></tr>
              </thead>
              <tbody>
                {ar.rows.map((r) => (
                  <tr key={r.key}>
                    <td className="font-medium">{r.label}</td>
                    <td className="text-right tabular-nums">{compactMoney(r.b0_30)}</td>
                    <td className="text-right tabular-nums">{compactMoney(r.b31_60)}</td>
                    <td className="text-right tabular-nums">{compactMoney(r.b61_90)}</td>
                    <td className="text-right tabular-nums text-amber-700">{compactMoney(r.b91_120)}</td>
                    <td className="text-right tabular-nums text-red-700">{compactMoney(r.b120p)}</td>
                    <td className="text-right font-semibold tabular-nums">{compactMoney(r.total)}</td>
                    <td className="text-right tabular-nums text-slate-500">{share(r.b91_120 + r.b120p, r.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td>Total</td>
                  <td className="text-right tabular-nums">{compactMoney(ar.totals.b0_30)}</td>
                  <td className="text-right tabular-nums">{compactMoney(ar.totals.b31_60)}</td>
                  <td className="text-right tabular-nums">{compactMoney(ar.totals.b61_90)}</td>
                  <td className="text-right tabular-nums">{compactMoney(ar.totals.b91_120)}</td>
                  <td className="text-right tabular-nums">{compactMoney(ar.totals.b120p)}</td>
                  <td className="text-right tabular-nums"><Money cents={ar.totals.total} /></td>
                  <td className="text-right tabular-nums text-slate-500">{share(ar.totals.b91_120 + ar.totals.b120p, ar.totals.total)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </Card>
        <Card title="Aging distribution">
          <AgingChart aging={ar.totals} />
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card title="Payer mix">
          <PayerMixChart data={payers} />
        </Card>
        <Card title="Payer reimbursement" className="xl:col-span-2">
          <table className="table">
            <thead>
              <tr><th>Payer</th><th>Type</th><th className="text-right">Claims</th><th className="text-right">Billed</th><th className="text-right">Collected</th><th className="text-right">Denied</th><th className="text-right">Realization</th></tr>
            </thead>
            <tbody>
              {payers.map((r) => (
                <tr key={r.payer}>
                  <td className="font-medium">{r.payer}</td>
                  <td className="capitalize text-slate-500">{r.type}</td>
                  <td className="text-right tabular-nums">{r.claims.toLocaleString()}</td>
                  <td className="text-right tabular-nums">{compactMoney(r.billedCents)}</td>
                  <td className="text-right tabular-nums text-green-700">{compactMoney(r.paidCents)}</td>
                  <td className="text-right tabular-nums text-rose-700">{r.denied.toLocaleString()}</td>
                  <td className="text-right tabular-nums">{share(r.paidCents, r.billedCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card title="Provider productivity">
          <table className="table">
            <thead><tr><th>Provider</th><th>Specialty</th><th className="text-right">Claims</th><th className="text-right">Billed</th><th className="text-right">Denied</th></tr></thead>
            <tbody>
              {providers.map((p) => (
                <tr key={p.name}>
                  <td className="font-medium">{p.name}</td>
                  <td className="text-slate-500">{p.specialty}</td>
                  <td className="text-right tabular-nums">{p.claims.toLocaleString()}</td>
                  <td className="text-right tabular-nums">{compactMoney(p.billedCents)}</td>
                  <td className="text-right tabular-nums text-rose-700">{p.denied.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Denial reasons">
          <table className="table">
            <thead><tr><th>CARC</th><th>Category</th><th className="text-right">Claims</th><th className="text-right">At risk</th></tr></thead>
            <tbody>
              {denials.map((d) => (
                <tr key={d.carc}>
                  <td className="font-mono font-semibold">{d.carc}</td>
                  <td className="capitalize text-slate-500">{d.category.replace(/_/g, " ")}</td>
                  <td className="text-right tabular-nums">{d.count.toLocaleString()}</td>
                  <td className="text-right font-semibold tabular-nums">{compactMoney(d.amountCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </>
  );
}
