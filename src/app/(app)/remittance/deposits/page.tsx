import Link from "next/link";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { candidatesFor, depositsOverview } from "@/server/deposits";
import { autoMatchAction, depositStatusAction, importDepositsAction, matchDepositAction } from "@/app/(app)/deposit-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Empty, Money, PageHeader, Stat } from "@/components/ui";
import { fmtDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

const d = (iso: string) => fmtDate(iso + "T00:00:00");

export default async function DepositsPage() {
  const s = await requireSession();
  const db = await getDb();
  const o = await depositsOverview(db, s.practiceId);
  const canEdit = ["admin", "biller"].includes(s.role);
  const missingCents = o.missing.reduce((a, r) => a + r.amountCents, 0);

  return (
    <>
      <PageHeader
        title="Bank deposits"
        subtitle="Check that every insurance payment on an ERA actually reached the bank"
        actions={<Link href="/remittance" className="btn btn-secondary">Back to ERAs</Link>}
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Matched deposits" value={o.counts.matched.toLocaleString()} />
        <Stat label="Deposits to review" value={o.counts.unmatched.toLocaleString()} hint="Not matched to an ERA yet" />
        <Stat label="ERAs with no deposit after 7 days" value={o.missing.length.toLocaleString()} tone={o.missing.length ? "bad" : undefined} />
        <Stat label="Amount not yet seen in the bank" value={`$${(missingCents / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`} />
      </div>

      {canEdit && (
        <Card title="Import from your bank">
          <ActionForm action={importDepositsAction} className="flex flex-wrap items-end gap-3">
            <label className="block text-sm">
              <span className="label">CSV export of the account the payers pay into</span>
              <input type="file" name="file" accept=".csv,text/csv,.txt" className="input" required />
            </label>
            <SubmitButton pendingLabel="Importing...">Import and match</SubmitButton>
          </ActionForm>
          <p className="mt-2 text-xs text-slate-500">
            Needs a date column, a description and an amount (or credit) column; withdrawals are skipped. Importing the same file twice adds nothing twice.
            Deposits match an ERA when the EFT trace number is in the description, or when one ERA alone has the same amount within a few days.
          </p>
        </Card>
      )}

      {o.missing.length > 0 && (
        <div className="mt-6">
          <Card title="ERAs paid more than 7 days ago with no deposit">
            <table className="table">
              <thead><tr><th>Payer</th><th>Trace / check</th><th>Paid</th><th className="text-right">Amount</th></tr></thead>
              <tbody>
                {o.missing.map((r) => (
                  <tr key={r.id}>
                    <td>{r.payerName}</td>
                    <td className="font-mono text-xs">{r.checkNumber}</td>
                    <td>{d(r.paymentDate)}</td>
                    <td className="text-right"><Money cents={r.amountCents} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-slate-500">Import a newer bank export, or ask the payer to trace the payment.</p>
          </Card>
        </div>
      )}

      <div className="mt-6">
        <Card title="Deposits" actions={canEdit && o.counts.unmatched > 0 ? <ActionForm action={autoMatchAction}><SubmitButton className="btn btn-secondary text-xs" pendingLabel="Matching...">Match again</SubmitButton></ActionForm> : undefined}>
          {o.deposits.length === 0 ? (
            <Empty>No deposits imported yet.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>Date</th><th>Description</th><th className="text-right">Amount</th><th>Status</th><th>ERA</th></tr></thead>
                <tbody>
                  {o.deposits.map(({ deposit: dep, remittance: r }) => (
                    <tr key={dep.id}>
                      <td className="whitespace-nowrap">{d(dep.depositDate)}</td>
                      <td className="max-w-xs truncate text-xs" title={dep.description}>{dep.description}</td>
                      <td className="text-right"><Money cents={dep.amountCents} /></td>
                      <td>
                        <Badge tone={dep.status === "matched" ? "green" : dep.status === "ignored" ? "slate" : "amber"}>{dep.status === "ignored" ? "not insurance" : dep.status}</Badge>
                      </td>
                      <td className="text-xs">
                        {r ? (
                          <>
                            <span className="font-semibold">{r.payerName}</span> · <span className="font-mono">{r.checkNumber}</span>
                            <p className="text-slate-500">{dep.matchReason}</p>
                            {canEdit && <ActionForm action={depositStatusAction.bind(null, dep.id, "unmatched")}><button className="text-xs text-slate-500 underline">Unmatch</button></ActionForm>}
                          </>
                        ) : dep.status === "unmatched" && canEdit ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <ActionForm action={matchDepositAction.bind(null, dep.id)} className="flex items-center gap-2">
                              <select name="remittanceId" className="input py-1 text-xs" defaultValue="" aria-label="ERA to match">
                                <option value="" disabled>Pick an ERA</option>
                                {candidatesFor(dep, o.openRemittances).map((c) => (
                                  <option key={c.id} value={c.id}>{c.amountCents === dep.amountCents ? "= " : ""}{c.payerName} · {c.checkNumber} · ${(c.amountCents / 100).toFixed(2)} · {c.paymentDate}</option>
                                ))}
                              </select>
                              <SubmitButton className="btn btn-secondary text-xs" pendingLabel="...">Match</SubmitButton>
                            </ActionForm>
                            <ActionForm action={depositStatusAction.bind(null, dep.id, "ignored")}><button className="text-xs text-slate-500 underline">Not insurance</button></ActionForm>
                          </div>
                        ) : dep.status === "ignored" && canEdit ? (
                          <ActionForm action={depositStatusAction.bind(null, dep.id, "unmatched")}><button className="text-xs text-slate-500 underline">Review again</button></ActionForm>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
