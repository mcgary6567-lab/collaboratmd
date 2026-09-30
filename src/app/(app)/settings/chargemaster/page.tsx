import type { Metadata } from "next";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { chargemasterStats, listChargemaster } from "@/server/chargemaster";
import { importChargemasterAction, reviewChargemasterAction } from "@/app/(app)/finance-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Empty, Money, PageHeader } from "@/components/ui";
import { US_STATES } from "@/lib/us";
import { fmtDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Chargemaster" };
export const dynamic = "force-dynamic";

/** The facility chargemaster: revenue codes, procedure codes and gross charges for UB-04 lines, and the standard charges file. */
export default async function ChargemasterPage() {
  const s = await requireSession();
  const db = await getDb();
  const [items, stats] = await Promise.all([listChargemaster(db, s.practiceId), chargemasterStats(db, s.practiceId)]);
  const admin = s.role === "admin";
  return (
    <>
      <PageHeader title="Chargemaster" subtitle={`${stats.items} active item${stats.items === 1 ? "" : "s"} for facility (UB-04) claims${stats.unreviewed ? `; ${stats.unreviewed} not reviewed in the last year` : ""}`} />
      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card title="Load or update items">
          <ActionForm action={importChargemasterAction} className="space-y-3 text-sm">
            <p className="text-slate-600 dark:text-slate-300">A CSV with item code, description, revenue code and charge columns, and optionally HCPCS, modifiers, cash price and setting (inpatient, outpatient or both). Items with the same code are updated.</p>
            <input type="file" name="file" accept=".csv,text/csv" className="block text-sm" aria-label="Chargemaster CSV" disabled={!admin} />
            {admin && <SubmitButton pendingLabel="Loading...">Load</SubmitButton>}
          </ActionForm>
          {admin && items.length > 0 && (
            <ActionForm action={reviewChargemasterAction} className="mt-4"><SubmitButton className="btn btn-secondary" pendingLabel="...">Mark all prices reviewed today</SubmitButton></ActionForm>
          )}
        </Card>
        <Card title="Standard charges file (price transparency)">
          <form action="/api/chargemaster/transparency" method="get" className="grid gap-3 text-sm sm:grid-cols-2">
            <label className="block sm:col-span-2"><span className="label">Location name</span><input name="location" className="input" required maxLength={120} /></label>
            <label className="block"><span className="label">License number</span><input name="license" className="input" required maxLength={40} /></label>
            <label className="block"><span className="label">License state</span><select name="state" className="input">{US_STATES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></label>
            <div className="sm:col-span-2"><button className="btn btn-secondary" disabled={!items.length}>Download CSV</button></div>
          </form>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Hospitals must publish their standard charges (45 CFR 180.50). The file is laid out after CMS&apos;s version 2 CSV template: gross charge, cash price, each payer&apos;s contracted rate from its fee schedule, and the minimum and maximum. Check it against CMS&apos;s current template before posting it on your website.</p>
        </Card>
      </div>
      <Card title="Items">
        {items.length === 0 ? <Empty>No items yet. Load your chargemaster from a spreadsheet.</Empty> : (
          <div tabIndex={0} role="region" aria-label="Chargemaster items" className="overflow-x-auto">
            <table className="table table-stack">
              <thead><tr><th>Item</th><th>Description</th><th>Revenue code</th><th>HCPCS</th><th className="text-right">Charge</th><th className="text-right">Cash price</th><th>Reviewed</th></tr></thead>
              <tbody>{items.map((i) => (
                <tr key={i.id}>
                  <td data-label="Item" className="font-mono text-xs">{i.itemCode}</td>
                  <td data-label="Description">{i.description}{!i.active && <> <Badge>inactive</Badge></>}</td>
                  <td data-label="Revenue code" className="font-mono">{i.revenueCode}</td>
                  <td data-label="HCPCS" className="font-mono">{i.hcpcs ?? "-"}{i.modifiers ? ` ${i.modifiers}` : ""}</td>
                  <td data-label="Charge" className="text-right tabular-nums"><Money cents={i.priceCents} /></td>
                  <td data-label="Cash price" className="text-right tabular-nums">{i.cashPriceCents === null ? "-" : <Money cents={i.cashPriceCents} />}</td>
                  <td data-label="Reviewed">{i.reviewedOn ? fmtDate(`${i.reviewedOn}T00:00:00`) : <Badge tone="amber">never</Badge>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
