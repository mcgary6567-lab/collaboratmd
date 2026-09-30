import type { Metadata } from "next";
import { getDb } from "@/db";
import { requireRole } from "@/lib/auth";
import { compensation, PLAN_KINDS } from "@/server/compensation";
import { listProviders } from "@/server/encounters";
import { savePlanAction } from "@/app/(app)/finance-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, Empty, Money, PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Provider compensation" };
export const dynamic = "force-dynamic";

const isDay = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

function planText(p: { kind: string; baseCents: number; collectionsPct: number | null; perRvuCents: number | null; threshold: number | null }) {
  const base = `$${(p.baseCents / 100).toLocaleString("en-US")}`;
  const per = `$${((p.perRvuCents ?? 0) / 100).toFixed(2)}`;
  switch (p.kind) {
    case "collections": return `${p.collectionsPct}% of collections`;
    case "wrvu": return `${per} per work RVU`;
    case "base_bonus_collections": return `${base} plus ${p.collectionsPct}% of collections over $${(p.threshold ?? 0).toLocaleString("en-US")}`;
    case "base_bonus_wrvu": return `${base} plus ${per} per work RVU over ${p.threshold}`;
    default: return p.kind;
  }
}

/** What each provider earns for the period under their plan: a worksheet to check against each agreement, not payroll. Administrators only. */
export default async function CompensationPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const s = await requireRole(["admin"]);
  const q = await searchParams;
  const now = new Date();
  const firstOfLastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 10);
  const endOfLastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)).toISOString().slice(0, 10);
  const from = isDay(q.from) ? q.from! : firstOfLastMonth;
  const to = isDay(q.to) ? q.to! : endOfLastMonth;
  const db = await getDb();
  const [rows, providers] = await Promise.all([compensation(db, s.practiceId, from, to), listProviders(db, s.practiceId)]);
  return (
    <>
      <PageHeader title="Provider compensation" subtitle={`${fmtDate(`${from}T00:00:00`)} to ${fmtDate(`${to}T00:00:00`)}: pay under each provider's plan, from collections on their claims and their work RVUs`} />
      <form className="mb-6 flex flex-wrap items-end gap-3 text-sm" action="/reports/compensation">
        <label className="block"><span className="label">From</span><input type="date" name="from" defaultValue={from} className="input" /></label>
        <label className="block"><span className="label">To</span><input type="date" name="to" defaultValue={to} className="input" /></label>
        <button className="btn btn-secondary">Show</button>
      </form>
      <Card title="Worksheet" className="mb-6">
        {rows.length === 0 ? <Empty>No collections, work RVUs or plans in this period.</Empty> : (
          <div tabIndex={0} role="region" aria-label="Compensation worksheet" className="overflow-x-auto">
            <table className="table table-stack">
              <thead><tr><th>Provider</th><th>Plan</th><th className="text-right">Collections</th><th className="text-right">Work RVUs</th><th className="text-right">Pay</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.providerId}>
                  <td data-label="Provider">{r.provider}{r.credential ? `, ${r.credential}` : ""}</td>
                  <td data-label="Plan" className="text-sm">{r.plan ? planText(r.plan) : <span className="text-slate-500">No plan</span>}</td>
                  <td data-label="Collections" className="text-right tabular-nums"><Money cents={r.collectionsCents} /></td>
                  <td data-label="Work RVUs" className="text-right tabular-nums">{r.wrvu.toFixed(2)}</td>
                  <td data-label="Pay" className="text-right font-semibold tabular-nums">{r.payCents === null ? "-" : <Money cents={r.payCents} />}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Collections are insurance and patient payments posted in the period on each provider&apos;s claims, less refunds and recoupments. Work RVUs need the Medicare fee schedule file (Settings, Code sets). Check each figure against the employment agreement; this is a worksheet, not payroll.</p>
      </Card>
      <Card title="Set a plan">
        <ActionForm action={savePlanAction} className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <label className="block"><span className="label">Provider</span><select name="providerId" className="input" required>{providers.map((p) => <option key={p.id} value={p.id}>{p.firstName} {p.lastName}</option>)}</select></label>
          <label className="block lg:col-span-3"><span className="label">How they are paid</span><select name="kind" className="input">{Object.entries(PLAN_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="block"><span className="label">Percentage of collections</span><input name="pct" inputMode="decimal" className="input" placeholder="35" /></label>
          <label className="block"><span className="label">Amount per work RVU ($)</span><input name="perRvu" inputMode="decimal" className="input" placeholder="50.00" /></label>
          <label className="block"><span className="label">Base for the period ($)</span><input name="base" inputMode="decimal" className="input" placeholder="15000" /></label>
          <label className="block"><span className="label">Threshold (dollars or work RVUs)</span><input name="threshold" inputMode="decimal" className="input" /></label>
          <label className="block"><span className="label">Starts</span><input name="effectiveFrom" type="date" defaultValue={firstOfLastMonth} className="input" required /></label>
          <label className="block sm:col-span-2 lg:col-span-3"><span className="label">Notes</span><input name="notes" className="input" maxLength={500} /></label>
          <div className="sm:col-span-2 lg:col-span-4"><SubmitButton pendingLabel="Saving...">Save plan</SubmitButton></div>
        </ActionForm>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">A new plan replaces the provider&apos;s earlier one from its start date. The base is per period shown, so run the worksheet for the same length of period the base is written for.</p>
      </Card>
    </>
  );
}
