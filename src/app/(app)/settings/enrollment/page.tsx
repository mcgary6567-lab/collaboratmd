import Link from "next/link";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { enrollmentAlerts, enrollmentGrid, ENROLLMENT_STATUSES } from "@/server/enrollment";
import { saveEnrollmentAction, saveTransactionEnrollmentAction } from "@/app/(app)/enrollment-actions";
import { eraGaps, transactionGrid, TRANSACTIONS, TXN_STATUSES } from "@/server/transaction-enrollment";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Alert, Card, Empty, PageHeader } from "@/components/ui";
import { Pager, pageArgs, withParams, type Params } from "@/components/data-table";

export const dynamic = "force-dynamic";

const TONE: Record<string, string> = {
  approved: "bg-green-100 text-green-800",
  submitted: "bg-blue-100 text-blue-800",
  in_process: "bg-blue-100 text-blue-800",
  denied: "bg-red-100 text-red-800",
  terminated: "bg-red-100 text-red-800",
  not_started: "bg-slate-100 text-slate-600",
};

const BASE = "/settings/enrollment";

export default async function EnrollmentPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const s = await requireSession();
  const db = await getDb();
  const [grid, alerts, txn, gaps] = await Promise.all([enrollmentGrid(db, s.practiceId), enrollmentAlerts(db, s.practiceId), transactionGrid(db, s.practiceId), eraGaps(db, s.practiceId)]);
  const canEdit = ["admin", "biller"].includes(s.role);
  const editing = sp.provider && sp.payer ? { provider: grid.providers.find((p) => p.id === sp.provider), payer: grid.payers.find((p) => p.id === sp.payer) } : null;
  const current = editing?.provider && editing.payer ? grid.get(editing.provider.id, editing.payer.id) : null;
  const name = (id: string) => { const p = grid.providers.find((x) => x.id === id); return p ? `Dr. ${p.firstName} ${p.lastName}` : "Provider"; };
  const payerName = (id: string) => grid.payers.find((x) => x.id === id)?.name ?? "Payer";
  // Large groups have many providers: search and page the grid rather than render every row.
  const q = (sp.q ?? "").trim().toLowerCase();
  const filtered = q ? grid.providers.filter((p) => `${p.firstName} ${p.lastName} ${p.npi}`.toLowerCase().includes(q)) : grid.providers;
  const { page, pageSize, offset } = pageArgs(sp, 25);
  const shown = filtered.slice(offset, offset + pageSize);
  const cell = (providerId: string, payerId: string) => withParams(BASE, sp, { provider: providerId, payer: payerId });

  return (
    <>
      <PageHeader title="Payer enrollment" subtitle="Which payers each provider can bill, and which electronic transactions each payer has approved" actions={<Link href="/settings" className="btn btn-secondary">Settings</Link>} />
      {alerts.length > 0 && (
        <div className="mb-2">
          {alerts.map((a) => (
            <Alert key={`${a.enrollment.id}-${a.kind}`} kind={a.kind === "revalidation_due" ? "info" : "error"}>
              <Link className="font-semibold underline" href={cell(a.enrollment.providerId, a.enrollment.payerId)}>{name(a.enrollment.providerId)} · {payerName(a.enrollment.payerId)}</Link>: {a.message}
            </Alert>
          ))}
        </div>
      )}

      {editing?.provider && editing.payer && (
        <div className="mb-6">
          <Card title={`${name(editing.provider.id)} with ${editing.payer.name}`}>
            <ActionForm key={`${editing.provider.id}-${editing.payer.id}-${current?.updatedAt?.toISOString() ?? "new"}`} action={saveEnrollmentAction.bind(null, editing.provider.id, editing.payer.id)} className="grid gap-3 md:grid-cols-3">
              <label className="block text-sm"><span className="label">Status</span>
                <select name="status" className="input" defaultValue={current?.status ?? "not_started"} disabled={!canEdit}>
                  {ENROLLMENT_STATUSES.map((st) => <option key={st} value={st}>{st.replace(/_/g, " ")}</option>)}
                </select>
              </label>
              <label className="block text-sm"><span className="label">Payer&apos;s provider ID (PTAN, Medicaid ID...)</span><input name="payerProviderId" className="input" defaultValue={current?.payerProviderId ?? ""} disabled={!canEdit} /></label>
              <label className="block text-sm"><span className="label">Application submitted</span><input type="date" name="submittedOn" className="input" defaultValue={current?.submittedOn ?? ""} disabled={!canEdit} /></label>
              <label className="block text-sm"><span className="label">Effective date</span><input type="date" name="effectiveOn" className="input" defaultValue={current?.effectiveOn ?? ""} disabled={!canEdit} /></label>
              <label className="block text-sm"><span className="label">Revalidation due</span><input type="date" name="revalidationDue" className="input" defaultValue={current?.revalidationDue ?? ""} disabled={!canEdit} /></label>
              <label className="block text-sm md:col-span-3"><span className="label">Notes (reference numbers, who you spoke to)</span><textarea name="notes" rows={3} className="input" defaultValue={current?.notes ?? ""} disabled={!canEdit} /></label>
              {canEdit && <div className="md:col-span-3 flex gap-2"><SubmitButton pendingLabel="Saving...">Save</SubmitButton><Link href={withParams(BASE, sp, { provider: undefined, payer: undefined })} className="btn btn-secondary">Close</Link></div>}
            </ActionForm>
          </Card>
        </div>
      )}

      <Card title="Enrollment by provider and payer">
        {grid.providers.length === 0 || grid.payers.length === 0 ? (
          <Empty>Add providers and payers in Settings first.</Empty>
        ) : (
          <div tabIndex={0} role="region" aria-label="Table (scrolls sideways)" className="overflow-x-auto">
            <form action={BASE} className="mb-3 flex gap-2">
              <input name="q" defaultValue={sp.q} className="input max-w-xs" placeholder="Find a provider by name or NPI" aria-label="Find a provider" />
              <button className="btn btn-secondary">Search</button>
            </form>
            <div tabIndex={0} role="region" aria-label="Table (scrolls sideways)" className="overflow-x-auto"><table className="table">
              <thead>
                <tr><th>Provider</th>{grid.payers.map((p) => <th key={p.id} className="whitespace-nowrap">{p.name}</th>)}</tr>
              </thead>
              <tbody>
                {shown.map((pr) => (
                  <tr key={pr.id}>
                    <td className="whitespace-nowrap font-medium">Dr. {pr.firstName} {pr.lastName}<div className="text-xs font-normal text-slate-500">NPI {pr.npi}</div></td>
                    {grid.payers.map((pa) => {
                      const e = grid.get(pr.id, pa.id);
                      return (
                        <td key={pa.id}>
                          <a href={cell(pr.id, pa.id)} className={`badge ${TONE[e?.status ?? "none"] ?? "bg-white text-slate-500 ring-1 ring-slate-200"} hover:opacity-80`}>
                            {e ? e.status.replace(/_/g, " ") : "not tracked"}
                          </a>
                          {e?.revalidationDue && <div className="mt-1 text-[11px] text-slate-500">reval {e.revalidationDue}</div>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table></div>
            {filtered.length === 0 && <Empty>No provider matches &quot;{sp.q}&quot;.</Empty>}
            <Pager page={page} pageSize={pageSize} total={filtered.length} base={BASE} params={{ ...sp, provider: undefined, payer: undefined }} />
          </div>
        )}
        <p className="mt-3 text-xs text-slate-500">
          When a provider-payer pair is tracked and not approved for the date of service, the claim scrubber warns before the claim is sent. Untracked pairs are not checked.
        </p>
      </Card>

      <div className="mt-6">
        <Card title="Electronic transactions by payer (clearinghouse enrollment)">
          {gaps.length > 0 && (
            <Alert kind="info">
              Remittances from {gaps.map((g) => g.payerName).join(", ")} will not arrive electronically until their ERA enrollment is approved. Post their paper EOBs until then.
            </Alert>
          )}
          {txn.payers.length === 0 ? <Empty>Add payers in Settings first.</Empty> : (
            <div tabIndex={0} role="region" aria-label="Table (scrolls sideways)" className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>Payer</th>{TRANSACTIONS.map((t) => <th key={t.key} className="whitespace-nowrap">{t.label}</th>)}<th /></tr></thead>
                <tbody>
                  {txn.payers.map((p) => (
                    <tr key={p.id}>
                      <td className="whitespace-nowrap font-medium">{p.name}<div className="text-xs font-normal text-slate-500">{p.payerId}</div></td>
                      {TRANSACTIONS.map((t) => {
                        const e = txn.get(p.id, t.key);
                        return (
                          <td key={t.key}>
                            <select form={`txn-${p.id}`} name={t.key} defaultValue={e?.status ?? "not_started"} className="input py-1 text-xs" disabled={!canEdit} aria-label={`${p.name} ${t.label}`}>
                              {TXN_STATUSES.map((st) => <option key={st} value={st}>{st.replace(/_/g, " ")}</option>)}
                            </select>
                            {e?.approvedOn && <div className="mt-1 text-[11px] text-slate-500">approved {e.approvedOn}</div>}
                            {!e?.approvedOn && e?.submittedOn && <div className="mt-1 text-[11px] text-slate-500">sent {e.submittedOn}</div>}
                          </td>
                        );
                      })}
                      <td>{canEdit && <ActionForm id={`txn-${p.id}`} action={saveTransactionEnrollmentAction.bind(null, p.id)}><SubmitButton className="btn btn-secondary text-xs" pendingLabel="...">Save</SubmitButton></ActionForm>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-xs text-slate-500">Enroll in your clearinghouse&apos;s portal (for Stedi, its enrollment pages), then record where each one stands here. Tracking only: nothing is submitted to the clearinghouse from this page.</p>
        </Card>
      </div>
    </>
  );
}
