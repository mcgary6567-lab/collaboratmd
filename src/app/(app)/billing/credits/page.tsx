import Link from "next/link";
import { getDb } from "@/db";
import { CAN_ADJUST, requireSession } from "@/lib/auth";
import { creditBalances, listRefunds } from "@/server/recovery";
import { approveRefundAction, cancelRefundAction, issueRefundAction, requestRefundAction } from "@/app/(app)/recovery-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Empty, Money, PageHeader, PatientLink, Stat } from "@/components/ui";
import { fmtDate, money } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** Medicare and Medicaid overpayments must be returned within 60 days of being identified (42 U.S.C. 1320a-7k(d)). */
const GOVERNMENT = new Set(["medicare", "medicaid"]);
const STATUS_TONE = { requested: "amber", approved: "blue", issued: "green", cancelled: "slate" } as const;

function RequestForm({ payee, patientId, claimId, maxCents }: { payee: "patient" | "payer"; patientId?: string; claimId?: string; maxCents: number }) {
  return (
    <details className="text-left">
      <summary className="btn btn-secondary cursor-pointer text-xs">Refund</summary>
      <ActionForm action={requestRefundAction} className="mt-2 w-64 space-y-2">
        <input type="hidden" name="payee" value={payee} />
        {patientId && <input type="hidden" name="patientId" value={patientId} />}
        {claimId && <input type="hidden" name="claimId" value={claimId} />}
        <input name="amount" defaultValue={(maxCents / 100).toFixed(2)} className="input text-xs" aria-label="Amount" />
        <input name="reason" className="input text-xs" placeholder={payee === "patient" ? "Why (e.g. paid copay twice)" : "Why (e.g. paid twice, ERA 8812)"} required />
        <SubmitButton className="btn btn-primary text-xs" pendingLabel="Requesting...">Request refund</SubmitButton>
      </ActionForm>
    </details>
  );
}

export default async function CreditsPage() {
  const s = await requireSession();
  const db = await getDb();
  const [credits, refunds] = await Promise.all([creditBalances(db, s.practiceId), listRefunds(db, s.practiceId)]);
  const canAdjust = (CAN_ADJUST as readonly string[]).includes(s.role);
  const isAdmin = s.role === "admin";
  const urgent = credits.claims.filter((c) => GOVERNMENT.has(c.payerType) && (c.ageDays ?? 0) > 45 && c.overpaidCents > c.pendingCents);
  const open = refunds.filter((r) => r.refund.status === "requested" || r.refund.status === "approved");

  return (
    <>
      <PageHeader
        title="Credit balances and refunds"
        subtitle="Money on the books that belongs to a patient or a payer"
        actions={<Link href="/billing" className="btn btn-secondary">Patient billing</Link>}
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Patient credits" value={money(credits.patients.reduce((a, p) => a + p.creditCents, 0))} hint={`${credits.patients.length} patients paid more than they owed`} />
        <Stat label="Insurance overpayments" value={money(credits.claims.reduce((a, c) => a + c.overpaidCents, 0))} hint={`${credits.claims.length} claims paid above the balance`} />
        <Stat label="Refunds in progress" value={money(open.reduce((a, r) => a + r.refund.amountCents, 0))} hint={`${open.length} requested or approved`} tone={open.length ? "neutral" : "good"} />
      </div>

      {urgent.length > 0 && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <p className="font-semibold">{urgent.length} Medicare or Medicaid overpayment{urgent.length === 1 ? "" : "s"} paid more than 45 days ago</p>
          <p className="mt-1">Federal law requires identified Medicare and Medicaid overpayments to be reported and returned within 60 days. Keeping them longer can be treated as a false claim. Review these first; the date shown is the last payment, so confirm when the overpayment was actually identified.</p>
        </div>
      )}

      <Card title="Refunds" className="mb-6">
        {refunds.length === 0 ? (
          <Empty>No refunds yet. Request one from a credit below; an administrator approves it, then whoever cuts the check records it here.</Empty>
        ) : (
          <table className="table">
            <thead><tr><th>Requested</th><th>To</th><th>Patient</th><th>Reason</th><th className="text-right">Amount</th><th>Status</th><th /></tr></thead>
            <tbody>
              {refunds.map(({ refund: r, patientFirst, patientLast, payerName, controlNumber }) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap">{fmtDate(r.createdAt)}</td>
                  <td>{r.payee === "patient" ? "Patient" : <>{payerName}{controlNumber && <span className="block font-mono text-xs text-slate-500">{controlNumber}</span>}</>}</td>
                  <td><PatientLink id={r.patientId} first={patientFirst} last={patientLast} /></td>
                  <td className="max-w-xs text-sm text-slate-600">{r.reason}{r.reference && <span className="block text-xs text-slate-500">{r.method} {r.reference}</span>}</td>
                  <td className="text-right"><Money cents={r.amountCents} /></td>
                  <td><Badge tone={STATUS_TONE[r.status as keyof typeof STATUS_TONE] ?? "slate"}>{r.status}</Badge></td>
                  <td className="whitespace-nowrap text-right">
                    <div className="flex items-start justify-end gap-2">
                      {r.status === "requested" && isAdmin && (
                        <ActionForm action={approveRefundAction.bind(null, r.id)}><SubmitButton className="btn btn-primary text-xs" pendingLabel="...">Approve</SubmitButton></ActionForm>
                      )}
                      {r.status === "approved" && canAdjust && (
                        <details className="text-left">
                          <summary className="btn btn-primary cursor-pointer text-xs">Record issued</summary>
                          <ActionForm action={issueRefundAction.bind(null, r.id)} className="mt-2 w-56 space-y-2">
                            <select name="method" className="input text-xs" defaultValue="check">
                              <option value="check">Check</option>
                              <option value="card">Card refund</option>
                              <option value="ach">ACH</option>
                              <option value="offset">Payer offset</option>
                            </select>
                            <input name="reference" className="input text-xs" placeholder="Check number or reference" required />
                            <SubmitButton className="btn btn-primary text-xs" pendingLabel="Posting...">Post to ledger</SubmitButton>
                          </ActionForm>
                        </details>
                      )}
                      {(r.status === "requested" || r.status === "approved") && canAdjust && (
                        <ActionForm action={cancelRefundAction.bind(null, r.id)}><SubmitButton className="btn btn-secondary text-xs" pendingLabel="...">Cancel</SubmitButton></ActionForm>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Patient credits">
          {credits.patients.length === 0 ? (
            <Empty>No patient has paid more than they owe.</Empty>
          ) : (
            <table className="table">
              <thead><tr><th>Patient</th><th className="text-right">Credit</th><th className="text-right">In refund</th><th /></tr></thead>
              <tbody>
                {credits.patients.map((p) => {
                  const [last, first] = p.name.split(", ");
                  const left = p.creditCents - p.pendingCents;
                  return (
                    <tr key={p.patientId}>
                      <td><PatientLink id={p.patientId} first={first ?? ""} last={last} mrn={p.mrn} /></td>
                      <td className="text-right font-semibold text-green-700"><Money cents={p.creditCents} /></td>
                      <td className="text-right">{p.pendingCents ? <Money cents={p.pendingCents} /> : ""}</td>
                      <td className="text-right">{canAdjust && left >= 100 && <RequestForm payee="patient" patientId={p.patientId} maxCents={left} />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="Insurance overpayments">
          {credits.claims.length === 0 ? (
            <Empty>No claim has been paid more than its balance.</Empty>
          ) : (
            <table className="table">
              <thead><tr><th>Claim</th><th>Payer</th><th className="text-right">Overpaid</th><th /></tr></thead>
              <tbody>
                {credits.claims.map((c) => {
                  const left = c.overpaidCents - c.pendingCents;
                  const gov = GOVERNMENT.has(c.payerType);
                  return (
                    <tr key={c.claimId}>
                      <td>
                        <Link href={`/claims/${c.claimId}`} className="font-mono text-brand-700 hover:underline">{c.controlNumber}</Link>
                        <span className="block text-xs text-slate-500">{c.patientName}</span>
                      </td>
                      <td>
                        {c.payerName}
                        {c.lastPaidOn && <span className={`block text-xs ${gov && (c.ageDays ?? 0) > 45 ? "font-semibold text-red-700" : "text-slate-500"}`}>paid {fmtDate(c.lastPaidOn)}{gov ? ` · ${c.ageDays} days` : ""}</span>}
                      </td>
                      <td className="text-right font-semibold text-amber-700"><Money cents={c.overpaidCents} />{c.pendingCents ? <span className="block text-xs font-normal text-slate-500">{money(c.pendingCents)} in refund</span> : null}</td>
                      <td className="text-right">{canAdjust && left >= 100 && <RequestForm payee="payer" claimId={c.claimId} maxCents={left} />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <p className="mt-3 text-xs text-slate-500">A payer may also take the money back itself by offsetting a later payment; that arrives on an 835 as a reversal and clears the overpayment without a refund here.</p>
        </Card>
      </div>
    </>
  );
}
