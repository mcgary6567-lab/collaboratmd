import type { Metadata } from "next";
import { getDb } from "@/db";
import { requireRole } from "@/lib/auth";
import { COST_CATEGORIES, costToCollect } from "@/server/cost-to-collect";
import { saveCostsAction } from "@/app/(app)/account-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, Money, PageHeader, Stat } from "@/components/ui";

export const metadata: Metadata = { title: "Cost to collect" };
export const dynamic = "force-dynamic";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const pct = (v: number | null) => (v === null ? "-" : `${Math.round(v * 1000) / 10}%`);
const monthLabel = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

/** What billing costs as a share of what it collects, month by month. */
export default async function CostToCollectPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; month?: string }> }) {
  const s = await requireRole(["admin"]);
  const q = await searchParams;
  const now = new Date();
  const thisMonth = now.toISOString().slice(0, 7);
  const to = q.to && MONTH.test(q.to) ? q.to : thisMonth;
  const [ty, tm] = to.split("-").map(Number);
  const back = new Date(Date.UTC(ty, tm - 12, 1)).toISOString().slice(0, 7);
  const from = q.from && MONTH.test(q.from) && q.from <= to ? q.from : back;
  const r = await costToCollect(await getDb(), s.practiceId, from, to);
  const editing = q.month && MONTH.test(q.month) ? q.month : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
  const current = r.rows.find((x) => x.month === editing)?.byCategory ?? {};
  return (
    <>
      <PageHeader title="Cost to collect" subtitle="What the billing operation costs as a share of the cash it collects" />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Cost to collect" value={pct(r.overall)} hint={r.monthsEntered ? `Over the ${r.monthsEntered} month${r.monthsEntered === 1 ? "" : "s"} with costs entered` : "Enter a month's costs to see it"} />
        <Stat label="Collected" value={`$${Math.round(r.rows.reduce((a, x) => a + x.collectedCents, 0) / 100).toLocaleString("en-US")}`} hint={`${monthLabel(from)} to ${monthLabel(to)}`} />
        <Stat label="Agency commissions" value={`$${Math.round(r.rows.reduce((a, x) => a + x.agencyCents, 0) / 100).toLocaleString("en-US")}`} hint="From recoveries posted, counted automatically" />
      </div>
      <form className="mb-6 flex flex-wrap items-end gap-3 text-sm" action="/reports/cost-to-collect">
        <label className="block"><span className="label">From month</span><input type="month" name="from" defaultValue={from} className="input" /></label>
        <label className="block"><span className="label">To month</span><input type="month" name="to" defaultValue={to} className="input" /></label>
        <button className="btn btn-secondary">Show</button>
      </form>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="By month" className="lg:col-span-2">
          <div tabIndex={0} role="region" aria-label="Cost to collect by month" className="overflow-x-auto">
            <table className="table table-stack text-sm">
              <thead><tr><th>Month</th><th className="text-right">Billing costs</th><th className="text-right">Collected</th><th className="text-right">Cost to collect</th></tr></thead>
              <tbody>{[...r.rows].reverse().map((x) => (
                <tr key={x.month}>
                  <td data-label="Month">{monthLabel(x.month)}</td>
                  <td data-label="Billing costs" className="text-right tabular-nums">{x.entered || x.agencyCents ? <Money cents={x.costCents} /> : <span className="text-slate-500 dark:text-slate-400">not entered</span>}</td>
                  <td data-label="Collected" className="text-right tabular-nums"><Money cents={x.collectedCents} /></td>
                  <td data-label="Cost to collect" className="text-right tabular-nums">{x.entered ? pct(x.pct) : "-"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Card>
        <Card title={`Costs for ${monthLabel(editing)}`}>
          <form className="mb-3 flex items-end gap-2 text-sm" action="/reports/cost-to-collect">
            <input type="hidden" name="from" value={from} /><input type="hidden" name="to" value={to} />
            <label className="block"><span className="label">Month</span><input type="month" name="month" defaultValue={editing} className="input" /></label>
            <button className="btn btn-secondary">Open</button>
          </form>
          <ActionForm action={saveCostsAction} className="space-y-2 text-sm">
            <input type="hidden" name="month" value={editing} />
            {Object.entries(COST_CATEGORIES).map(([k, label]) => (
              <label key={k} className="block"><span className="label">{label} ($)</span><input name={k} inputMode="decimal" defaultValue={current[k] ? (current[k] / 100).toFixed(2) : ""} className="input" /></label>
            ))}
            <SubmitButton pendingLabel="Saving...">Save costs</SubmitButton>
          </ActionForm>
        </Card>
      </div>
      <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">Cost to collect is one of HFMA&apos;s MAP Keys for the revenue cycle. Include what the billing operation costs (not the clinical staff), and compare it month to month: lower is better. Collected is insurance and patient payments posted in the month, less refunds.</p>
    </>
  );
}
