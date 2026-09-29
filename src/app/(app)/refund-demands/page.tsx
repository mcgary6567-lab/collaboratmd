import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { CAN_ADJUST, requireSession } from "@/lib/auth";
import { disputeLetter, listRefundDemands } from "@/server/refund-demands";
import { agreeRefundDemandAction, closeRefundDemandAction, createRefundDemandAction, disputeRefundDemandAction } from "@/app/(app)/refund-demand-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { CopyButton } from "@/components/copy-button";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { fmtDate, money } from "@/lib/utils";

export const metadata: Metadata = { title: "Payer refund demands" };
export const dynamic = "force-dynamic";

const TONE: Record<string, "amber" | "blue" | "green" | "slate"> = { open: "amber", disputed: "blue", agreed: "blue", offset: "green", closed: "slate" };

export default async function RefundDemandsPage() {
  const s = await requireSession();
  const db = await getDb();
  const rows = await listRefundDemands(db, s.practiceId);
  const canAdjust = (CAN_ADJUST as readonly string[]).includes(s.role);
  const today = new Date().toISOString().slice(0, 10);
  const letters = new Map(await Promise.all(rows.filter((r) => r.d.status === "disputed").map(async (r) => [r.d.id, await disputeLetter(db, s.practiceId, r.d.id, (r.d.notes ?? "").split("Disputed: ").at(-1)?.split("\n")[0] ?? "")] as const)));
  return (
    <>
      <PageHeader title="Payer refund demands" subtitle="Letters from payers asking for money back: agree and refund, or dispute before they take it from a later payment" actions={<Link href="/billing/credits" className="btn btn-secondary">Credits and refunds</Link>} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Demands" className="lg:col-span-2">
          {rows.length === 0 ? <Empty>No refund demands. When a payer writes asking for an overpayment back, add it here with its dates.</Empty> : (
            <ul className="space-y-3 text-sm">
              {rows.map(({ d, controlNumber, payerName, patientFirst, patientLast }) => (
                <li key={d.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{payerName} asks for {money(d.amountCents)} · <Link href={`/claims/${d.claimId}`} className="font-mono text-brand-700 hover:underline dark:text-brand-300">{controlNumber}</Link> · {patientLast}, {patientFirst}</span>
                    <Badge tone={TONE[d.status] ?? "slate"}>{d.status}</Badge>
                  </div>
                  <p className={`mt-1 text-xs ${d.status === "open" && d.disputeBy && d.disputeBy < today ? "font-semibold text-red-700" : "text-slate-600 dark:text-slate-400"}`}>
                    Received {fmtDate(d.receivedOn)}{d.reference ? ` · ref ${d.reference}` : ""} · decide by {fmtDate(d.disputeBy)}{d.offsetOn ? ` · offset from ${fmtDate(d.offsetOn)}` : ""}
                  </p>
                  {d.notes && <p className="mt-1 whitespace-pre-line text-xs text-slate-600 dark:text-slate-400">{d.notes}</p>}
                  {canAdjust && d.status === "open" && (
                    <div className="mt-2 flex flex-wrap items-start gap-3">
                      <ActionForm action={agreeRefundDemandAction.bind(null, d.id)}><SubmitButton className="btn btn-secondary text-xs" pendingLabel="Saving...">Agree</SubmitButton></ActionForm>
                      <details className="text-xs">
                        <summary className="btn btn-secondary cursor-pointer text-xs">Dispute</summary>
                        <ActionForm action={disputeRefundDemandAction.bind(null, d.id)} className="mt-2 w-80 space-y-2">
                          <textarea name="reason" rows={3} className="input text-xs" placeholder="Why the payment was correct: the service was covered, the patient was eligible on the date of service..." required />
                          <SubmitButton className="btn btn-primary text-xs" pendingLabel="Saving...">Dispute and write the letter</SubmitButton>
                        </ActionForm>
                      </details>
                    </div>
                  )}
                  {letters.get(d.id) && (
                    <details className="mt-2 text-xs">
                      <summary className="cursor-pointer font-semibold text-brand-700 dark:text-brand-300">Dispute letter</summary>
                      <div className="mt-2"><CopyButton value={letters.get(d.id)!} label="Copy letter" /></div>
                      <pre className="mt-2 whitespace-pre-wrap font-serif text-sm">{letters.get(d.id)}</pre>
                    </details>
                  )}
                  {canAdjust && ["agreed", "disputed"].includes(d.status) && (
                    <ActionForm action={closeRefundDemandAction.bind(null, d.id)} className="mt-2 flex flex-wrap items-end gap-2 text-xs">
                      <label className="block grow"><span className="label">Outcome</span><input name="outcome" className="input" placeholder="Payer withdrew the request; or refunded by check 1234" required /></label>
                      <SubmitButton className="btn btn-secondary text-xs" pendingLabel="Saving...">Close</SubmitButton>
                    </ActionForm>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
        {canAdjust && (
          <Card title="Add a demand">
            <ActionForm action={createRefundDemandAction} className="space-y-3 text-sm">
              <label className="block"><span className="label">Claim number</span><input name="claim" className="input font-mono" placeholder="CMD000123" required /></label>
              <label className="block"><span className="label">Amount requested ($)</span><input name="amount" inputMode="decimal" className="input" required /></label>
              <label className="block"><span className="label">Letter received on</span><input type="date" name="receivedOn" className="input" defaultValue={today} max={today} required /></label>
              <label className="block"><span className="label">Dispute or pay by (blank: 30 days)</span><input type="date" name="disputeBy" className="input" /></label>
              <label className="block"><span className="label">Payer will offset from (if the letter says)</span><input type="date" name="offsetOn" className="input" /></label>
              <label className="block"><span className="label">Payer&apos;s reference</span><input name="reference" className="input" /></label>
              <label className="block"><span className="label">Notes</span><textarea name="notes" rows={2} className="input" /></label>
              <SubmitButton pendingLabel="Saving...">Add demand</SubmitButton>
            </ActionForm>
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Medicare: a redetermination filed within 30 days of the demand letter stops recoupment, which otherwise begins around day 41. Commercial deadlines come from your contract or state law.</p>
          </Card>
        )}
      </div>
    </>
  );
}
