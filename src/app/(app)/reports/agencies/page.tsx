import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { CAN_ADJUST, requireSession } from "@/lib/auth";
import { agencyPerformance, listCollections } from "@/server/collections";
import { agencyRecoveryAction, commissionAction } from "@/app/(app)/finance-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, Empty, Money, PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Collection agencies" };
export const dynamic = "force-dynamic";

const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;

/** What each agency recovered, what it kept, and payments to post as they arrive. */
export default async function AgenciesPage() {
  const s = await requireSession();
  const db = await getDb();
  const [perf, all] = await Promise.all([agencyPerformance(db, s.practiceId), listCollections(db, s.practiceId)]);
  const open = all.filter((r) => r.collection.stage === "agency" && !r.collection.closedAt);
  const canAdjust = (CAN_ADJUST as readonly string[]).includes(s.role);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <PageHeader title="Collection agencies" subtitle="Accounts placed with each agency, what it recovered, its commission, and what reached the practice" actions={<Link href="/billing/collections" className="btn btn-secondary">Collections</Link>} />
      <Card title="Results by agency" className="mb-6">
        {perf.length === 0 ? <Empty>No accounts placed with an agency yet.</Empty> : (
          <div tabIndex={0} role="region" aria-label="Agency results" className="overflow-x-auto">
            <table className="table table-stack">
              <thead><tr><th>Agency</th><th className="text-right">Accounts</th><th className="text-right">Placed</th><th className="text-right">Recovered</th><th className="text-right">Rate</th><th className="text-right">Commission</th><th className="text-right">To the practice</th><th className="text-right">Median days to first payment</th></tr></thead>
              <tbody>{perf.map((a) => (
                <tr key={a.agency}>
                  <td data-label="Agency">{a.agency}</td>
                  <td data-label="Accounts" className="text-right tabular-nums">{a.accounts}</td>
                  <td data-label="Placed" className="text-right tabular-nums"><Money cents={a.placedCents} /></td>
                  <td data-label="Recovered" className="text-right tabular-nums"><Money cents={a.grossCents} /></td>
                  <td data-label="Rate" className="text-right tabular-nums">{pct(a.recoveryRate)}</td>
                  <td data-label="Commission" className="text-right tabular-nums"><Money cents={a.commissionCents} /></td>
                  <td data-label="To the practice" className="text-right tabular-nums"><Money cents={a.netCents} /></td>
                  <td data-label="Median days to first payment" className="text-right tabular-nums">{a.medianDaysToFirst ?? "-"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title={`Open with an agency (${open.length})`}>
        {open.length === 0 ? <Empty>No accounts are with an agency.</Empty> : (
          <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-700">
            {open.map(({ collection: c, patient: p }) => (
              <li key={c.id} className="py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/patients/${p.id}`} className="font-semibold text-brand-700 hover:underline">{p.lastName}, {p.firstName}</Link>
                  <span>{c.agency}</span><span className="text-slate-500">placed {c.placedAt ? fmtDate(c.placedAt) : "-"}</span><Money cents={c.amountCents} />
                  <span className="text-xs text-slate-500">commission {c.commissionPct === null ? "not set" : `${c.commissionPct}%`}</span>
                </div>
                {canAdjust && (
                  <div className="mt-2 flex flex-wrap items-end gap-3">
                    <ActionForm action={agencyRecoveryAction.bind(null, c.id)} className="flex flex-wrap items-end gap-2">
                      <label className="block"><span className="label">Received</span><input name="receivedOn" type="date" defaultValue={today} className="input" /></label>
                      <label className="block"><span className="label">Collected ($)</span><input name="gross" inputMode="decimal" className="input w-28" required /></label>
                      <label className="block"><span className="label">Commission ($, blank for the rate)</span><input name="commission" inputMode="decimal" className="input w-28" /></label>
                      <label className="block"><span className="label">Reference</span><input name="reference" className="input w-32" maxLength={80} /></label>
                      <SubmitButton pendingLabel="Posting...">Post recovery</SubmitButton>
                    </ActionForm>
                    <ActionForm action={commissionAction.bind(null, c.id)} className="flex items-end gap-2">
                      <label className="block"><span className="label">Rate (%)</span><input name="pct" inputMode="decimal" defaultValue={c.commissionPct ?? ""} className="input w-20" /></label>
                      <SubmitButton className="btn btn-secondary" pendingLabel="...">Save</SubmitButton>
                    </ActionForm>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">The patient is credited with everything they paid the agency; the agency&apos;s commission goes to the accounting journal as collection agency fees, so cash matches the agency&apos;s check.</p>
      </Card>
    </>
  );
}
