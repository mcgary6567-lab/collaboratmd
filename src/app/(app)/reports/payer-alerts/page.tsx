import Link from "next/link";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { BASELINE_DAYS, MIN_CLAIMS, payerAlerts, RECENT_DAYS, type PayerAlert } from "@/server/payer-alerts";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

const NEXT_STEP: Record<PayerAlert["kind"], (a: PayerAlert) => { href: string; label: string }> = {
  denial_rate: (a) => ({ href: `/reports/builder?dataset=denials&run=1&group=carc&range=30d&payer=${a.payerId}`, label: "See denials by reason" }),
  new_reason: (a) => ({ href: `/reports/builder?dataset=denials&run=1&range=30d&payer=${a.payerId}`, label: "See these denials" }),
  slower: () => ({ href: "/claims/follow-up", label: "Open claim follow-up" }),
  paying_less: () => ({ href: "/underpayments", label: "Check underpayments" }),
};

export default async function PayerAlertsPage() {
  const s = await requireSession();
  const alerts = await payerAlerts(await getDb(), s.practiceId);
  const payers = new Set(alerts.map((a) => a.payerId)).size;

  return (
    <>
      <PageHeader
        title="Payer alerts"
        subtitle={`Payers whose last ${RECENT_DAYS} days look different from their previous ${BASELINE_DAYS}`}
        actions={<Link href="/reports" className="btn btn-secondary">Reports</Link>}
      />
      <Card>
        {alerts.length === 0 ? (
          <Empty>Every payer with enough recent claims is behaving as it did before. Recalculated from your own history each time this page opens.</Empty>
        ) : (
          <>
            <p className="mb-4 text-sm text-slate-600">{alerts.length} change{alerts.length === 1 ? "" : "s"} across {payers} payer{payers === 1 ? "" : "s"}. A sudden shift usually means a policy, fee schedule or system change at the payer; the earlier it is caught, the fewer claims it affects.</p>
            <ul className="space-y-3">
              {alerts.map((a, i) => {
                const next = NEXT_STEP[a.kind](a);
                return (
                  <li key={i} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-slate-200 p-4">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900">
                        {a.payerName}: {a.title} <Badge tone={a.severity === "high" ? "red" : "amber"}>{a.severity}</Badge>
                      </p>
                      <p className="mt-1 text-sm text-slate-600">{a.detail}</p>
                    </div>
                    <Link href={next.href} className="btn btn-secondary text-xs">{next.label}</Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        <p className="mt-4 text-xs text-slate-500">
          Rates are compared only when a payer adjudicated at least {MIN_CLAIMS} claims in both periods. Denial rate alerts need a rise of 5 points and 30%; slower payment, 5 more days and 25%; paying less, 5 points and 7%; a denial reason, at least 5 in the last {RECENT_DAYS} days and three times its earlier rate.
        </p>
      </Card>
    </>
  );
}
