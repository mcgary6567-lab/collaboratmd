import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { arAgingByPayer, payerMix } from "@/server/reports";
import { Card, PageHeader, Money, Empty } from "@/components/ui";
import { AgingChart } from "@/components/charts";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const s = await requireSession();
  const db = await getDb();
  const [ar, mix] = await Promise.all([arAgingByPayer(db, s.practiceId), payerMix(db, s.practiceId)]);
  const pct = (part: number, whole: number) => (whole ? ((part / whole) * 100).toFixed(1) + "%" : "-");
  return (
    <>
      <PageHeader title="Reports" subtitle="Accounts receivable aging and payer performance" />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Insurance AR aging by payer" className="lg:col-span-2">
          {ar.rows.length === 0 ? (
            <Empty>No outstanding insurance balances.</Empty>
          ) : (
            <table className="table">
              <thead><tr><th>Payer</th><th className="text-right">0-30</th><th className="text-right">31-60</th><th className="text-right">61-90</th><th className="text-right">91-120</th><th className="text-right">120+</th><th className="text-right">Total</th><th className="text-right">% &gt;90</th></tr></thead>
              <tbody>
                {ar.rows.map((r) => (
                  <tr key={r.key}>
                    <td className="font-medium">{r.label}</td>
                    <td className="text-right"><Money cents={r.b0_30} /></td>
                    <td className="text-right"><Money cents={r.b31_60} /></td>
                    <td className="text-right"><Money cents={r.b61_90} /></td>
                    <td className="text-right text-amber-700"><Money cents={r.b91_120} /></td>
                    <td className="text-right text-red-700"><Money cents={r.b120p} /></td>
                    <td className="text-right font-semibold"><Money cents={r.total} /></td>
                    <td className="text-right text-slate-500">{pct(r.b91_120 + r.b120p, r.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td>Total</td>
                  <td className="text-right"><Money cents={ar.totals.b0_30} /></td>
                  <td className="text-right"><Money cents={ar.totals.b31_60} /></td>
                  <td className="text-right"><Money cents={ar.totals.b61_90} /></td>
                  <td className="text-right"><Money cents={ar.totals.b91_120} /></td>
                  <td className="text-right"><Money cents={ar.totals.b120p} /></td>
                  <td className="text-right"><Money cents={ar.totals.total} /></td>
                  <td className="text-right text-slate-500">{pct(ar.totals.b91_120 + ar.totals.b120p, ar.totals.total)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </Card>
        <Card title="Aging distribution">
          <AgingChart aging={ar.totals} />
        </Card>
      </div>
      <Card title="Payer mix and reimbursement" className="mt-6">
        <table className="table">
          <thead><tr><th>Payer</th><th>Type</th><th className="text-right">Claims</th><th className="text-right">Charged</th><th className="text-right">Paid</th><th className="text-right">Collection %</th></tr></thead>
          <tbody>
            {mix.map((r) => (
              <tr key={r.payer}>
                <td className="font-medium">{r.payer}</td>
                <td className="capitalize text-slate-500">{r.type}</td>
                <td className="text-right">{r.claims}</td>
                <td className="text-right"><Money cents={r.charged} /></td>
                <td className="text-right"><Money cents={r.paid} /></td>
                <td className="text-right">{pct(r.paid, r.charged)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
