import Link from "next/link";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { cashForecast, WEEKS } from "@/server/forecast";
import { ForecastChart } from "@/components/charts";
import { Card, Empty, Money, PageHeader, Stat } from "@/components/ui";
import { fmtDate, money } from "@/lib/utils";

export const dynamic = "force-dynamic";

const short = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export default async function ForecastPage() {
  const s = await requireSession();
  const f = await cashForecast(await getDb(), s.practiceId);
  const sum = (xs: number[]) => xs.reduce((a, x) => a + x, 0);
  const next4 = sum(f.total.slice(0, 4));
  const last4 = sum(f.recentActual.slice(-4).map((w) => w.insurance + w.patient));
  const chart = [
    ...f.recentActual.map((w) => ({ week: short(w.weekStart), insurance: w.insurance / 100, patient: w.patient / 100, forecast: false })),
    ...f.weekStarts.map((w, i) => ({ week: short(w), insurance: (f.insurance[i] + f.scheduled[i]) / 100, patient: f.patient[i] / 100, forecast: true })),
  ];

  return (
    <>
      <PageHeader
        title="Cash forecast"
        subtitle={`Expected collections for the next ${WEEKS} weeks, projected from your own payment history`}
        actions={<Link href="/reports" className="btn btn-secondary">Reports</Link>}
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <Stat label="Next 4 weeks" value={money(next4)} hint={`Last 4 weeks collected ${money(last4)}`} />
        <Stat label={`Next ${WEEKS} weeks`} value={money(sum(f.total))} hint={`${money(sum(f.insurance))} from claims sent, ${money(sum(f.scheduled))} from scheduled visits, ${money(sum(f.patient))} patient`} />
        <Stat label="Claims in flight" value={f.payers.reduce((a, p) => a + p.openClaims, 0).toLocaleString("en-US")} hint={`${money(f.payers.reduce((a, p) => a + p.openCents, 0))} billed, awaiting payment`} />
        <Stat label="Needs follow-up" value={money(f.stale.cents)} hint={`${f.stale.claims} claims older than any claim this payer has paid`} tone={f.stale.claims ? "bad" : "good"} />
      </div>

      <Card title="Weekly collections" className="mb-6">
        <ForecastChart data={chart} />
        <p className="mt-2 text-xs text-slate-500">Dark bars are what posted in the last eight weeks; light bars are the forecast (insurance includes claims from scheduled visits).</p>
      </Card>

      <Card title="By payer" className="mb-6">
        {f.payers.length === 0 ? (
          <Empty>No claims are awaiting payment.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Payer</th><th className="text-right">Claims</th><th className="text-right">Billed</th><th className="text-right">Typical days to pay</th><th className="text-right">Paid of billed</th>
                  {f.weekStarts.slice(0, 4).map((w) => <th key={w} className="text-right">Wk of {short(w)}</th>)}
                  <th className="text-right">{WEEKS} weeks</th>
                </tr>
              </thead>
              <tbody>
                {f.payers.map((p) => (
                  <tr key={p.payerId}>
                    <td>{p.payerName}{!p.ownHistory && <span className="block text-xs text-slate-500">Too few paid claims; uses practice-wide history</span>}</td>
                    <td className="text-right">{p.openClaims.toLocaleString("en-US")}</td>
                    <td className="text-right"><Money cents={p.openCents} /></td>
                    <td className="text-right">{p.medianLagDays ?? "n/a"}</td>
                    <td className="text-right">{(p.paidRatio * 100).toFixed(0)}%</td>
                    {p.weeks.slice(0, 4).map((c, i) => <td key={i} className="text-right"><Money cents={c} /></td>)}
                    <td className="text-right font-semibold"><Money cents={p.expectedCents} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="How this is calculated">
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
          <li>Every claim submitted or ready to send is projected from the same payer&apos;s claims over the past year: how often it paid, how much of the billed amount it paid, and how many days payment took.</li>
          <li>A claim already N days old is projected only from past claims that took longer than N days, so older claims are not expected sooner than the history supports.</li>
          <li>
            Scheduled visits: {f.visits.upcoming.toLocaleString("en-US")} appointments on the calendar in the next {WEEKS} weeks, times the {(f.visits.keptRate * 100).toFixed(0)}% of appointments kept over the last 90 days,
            times what a visit with that provider has collected from insurance (about {money(f.visits.perVisitCents)} across the practice), spread by how long visits take to be paid.
          </li>
          <li>Patient payments are the average weekly patient collections of the last twelve weeks.</li>
          <li>Visits already seen but not yet billed are not included. See <Link href="/billing/missed-charges" className="text-brand-700 hover:underline">missed charges</Link>.</li>
          <li>This is an estimate from history, not a promise. A payer that changes how fast it pays shows up on <Link href="/reports/payer-alerts" className="text-brand-700 hover:underline">payer alerts</Link>. As of {fmtDate(new Date())}.</li>
        </ul>
      </Card>
    </>
  );
}
