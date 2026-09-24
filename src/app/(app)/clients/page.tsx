import { getDb } from "@/db";
import { accessiblePractices, requireSession } from "@/lib/auth";
import { arAging, headlineKpis } from "@/server/analytics";
import { switchPracticeAction } from "@/app/(app)/practice-actions";
import { Badge, Card, Empty, Money, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

/**
 * Every practice the user works for, side by side: what a billing company
 * checks each morning to see which client needs attention. Figures are for
 * the trailing 90 days except receivables, which are as of now.
 */
export default async function ClientsPage() {
  const s = await requireSession();
  const db = await getDb();
  const practices = await accessiblePractices(db, s.userId);
  const rows = await Promise.all(
    practices.map(async (p) => {
      const [k, aging] = await Promise.all([headlineKpis(db, p.id, 3), arAging(db, p.id)]);
      const over90 = aging.totals.b91_120 + aging.totals.b120p;
      return { p, k, over90, arTotal: aging.totals.total };
    }),
  );
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + f(r), 0);

  return (
    <>
      <PageHeader title="All clients" subtitle={`${practices.length} practices · last 90 days; receivables as of now`} />
      {rows.length < 2 ? (
        <Card><Empty>You have access to one practice. When you are given access to more, they appear here side by side.</Empty></Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Practice</th>
                  <th className="text-right">Charges</th>
                  <th className="text-right">Collected</th>
                  <th className="text-right">Net collection</th>
                  <th className="text-right">Clean claims</th>
                  <th className="text-right">Denial rate</th>
                  <th className="text-right">Days in A/R</th>
                  <th className="text-right">Insurance A/R</th>
                  <th className="text-right">A/R over 90</th>
                  <th className="text-right">Open denials</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map(({ p, k, over90, arTotal }) => {
                  const risky = arTotal > 0 && over90 / arTotal > 0.2;
                  return (
                    <tr key={p.id} className={p.id === s.practiceId ? "bg-brand-50/40" : ""}>
                      <td>
                        <div className="font-medium">{p.name}</div>
                        <div className="text-xs capitalize text-slate-500">{p.role.replace("_", " ")}</div>
                      </td>
                      <td className="text-right"><Money cents={k.chargesCents} /></td>
                      <td className="text-right"><Money cents={k.insurancePaidCents + k.patientPaidCents} /></td>
                      <td className="text-right tabular-nums">{pct(k.netCollectionRate)}</td>
                      <td className="text-right tabular-nums">{pct(k.cleanClaimRate)}</td>
                      <td className={`text-right tabular-nums ${k.denialRate > 0.1 ? "font-semibold text-red-700" : ""}`}>{pct(k.denialRate)}</td>
                      <td className="text-right tabular-nums">{k.daysInAr.toFixed(0)}</td>
                      <td className="text-right"><Money cents={k.insuranceArCents} /></td>
                      <td className="text-right">
                        <Money cents={over90} className={risky ? "font-semibold text-red-700" : ""} />
                        {risky && <div><Badge tone="red">{pct(over90 / arTotal)} of A/R</Badge></div>}
                      </td>
                      <td className="text-right tabular-nums">{k.openDenials}</td>
                      <td className="text-right">
                        {p.id === s.practiceId ? (
                          <span className="text-xs text-slate-400">Current</span>
                        ) : (
                          <form action={switchPracticeAction}>
                            <input type="hidden" name="practiceId" value={p.id} />
                            <button className="text-xs font-semibold text-brand-700 hover:underline">Open</button>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td>All clients</td>
                  <td className="text-right"><Money cents={sum((r) => r.k.chargesCents)} /></td>
                  <td className="text-right"><Money cents={sum((r) => r.k.insurancePaidCents + r.k.patientPaidCents)} /></td>
                  <td colSpan={4} />
                  <td className="text-right"><Money cents={sum((r) => r.k.insuranceArCents)} /></td>
                  <td className="text-right"><Money cents={sum((r) => r.over90)} /></td>
                  <td className="text-right tabular-nums">{sum((r) => r.k.openDenials)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
