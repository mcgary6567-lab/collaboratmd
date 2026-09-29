import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { CAN_ADJUST, requireSession } from "@/lib/auth";
import { listNsaDisputes, nextDeadline, nsaDeadlines } from "@/server/nsa-disputes";
import { closeNsaDisputeAction, createNsaDisputeAction, startIdrAction, startNegotiationAction } from "@/app/(app)/nsa-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { fmtDate, money } from "@/lib/utils";

export const metadata: Metadata = { title: "Out-of-network disputes" };
export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; tone: "amber" | "blue" | "green" | "slate" }> = {
  open: { label: "Before negotiation", tone: "amber" }, negotiating: { label: "Open negotiation", tone: "blue" }, idr: { label: "In IDR", tone: "blue" }, settled: { label: "Settled", tone: "green" }, closed: { label: "Closed", tone: "slate" },
};

export default async function NsaDisputesPage() {
  const s = await requireSession();
  const rows = await listNsaDisputes(await getDb(), s.practiceId);
  const canAdjust = (CAN_ADJUST as readonly string[]).includes(s.role);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <PageHeader title="Out-of-network payment disputes" subtitle="No Surprises Act: open negotiation, then federal independent dispute resolution (IDR), on business-day deadlines" />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Disputes" className="lg:col-span-2">
          {rows.length === 0 ? <Empty>No disputes. When a plan underpays an out-of-network service the No Surprises Act covers, add the claim here to keep its deadlines.</Empty> : (
            <ul className="space-y-3 text-sm">
              {rows.map(({ d, controlNumber, totalCents, payerName, patientFirst, patientLast }) => {
                const next = nextDeadline(d);
                const dl = nsaDeadlines(d);
                return (
                  <li key={d.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium"><Link href={`/claims/${d.claimId}`} className="font-mono text-brand-700 hover:underline dark:text-brand-300">{controlNumber}</Link> · {payerName} · {patientLast}, {patientFirst}</span>
                      <Badge tone={STATUS[d.status]?.tone ?? "slate"}>{STATUS[d.status]?.label ?? d.status}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                      Billed {money(totalCents)}{d.offerCents ? ` · offer ${money(d.offerCents)}` : ""} · initial payment or denial {fmtDate(d.initialResponseOn)}
                      {d.negotiationStartedOn ? ` · negotiation from ${fmtDate(d.negotiationStartedOn)} to ${fmtDate(dl.negotiationEnds)}` : ""}{d.idrInitiatedOn ? ` · IDR started ${fmtDate(d.idrInitiatedOn)}` : ""}
                    </p>
                    {next && <p className={`mt-1 text-xs font-semibold ${next.on < today ? "text-red-700" : "text-amber-800"}`}>{next.what} {fmtDate(next.on)}</p>}
                    {d.outcome && <p className="mt-1 text-xs">Outcome: {d.outcome}{d.settledCents ? ` (${money(d.settledCents)})` : ""}</p>}
                    {canAdjust && d.status === "open" && (
                      <ActionForm action={startNegotiationAction.bind(null, d.id)} className="mt-2 flex flex-wrap items-end gap-2 text-xs">
                        <label className="block"><span className="label">Notice sent on</span><input type="date" name="sentOn" className="input" defaultValue={today} required /></label>
                        <SubmitButton className="btn btn-secondary text-xs" pendingLabel="Saving...">Start open negotiation</SubmitButton>
                      </ActionForm>
                    )}
                    {canAdjust && d.status === "negotiating" && (
                      <ActionForm action={startIdrAction.bind(null, d.id)} className="mt-2 flex flex-wrap items-end gap-2 text-xs">
                        <label className="block"><span className="label">IDR started on</span><input type="date" name="initiatedOn" className="input" defaultValue={today} required /></label>
                        <SubmitButton className="btn btn-secondary text-xs" pendingLabel="Saving...">Record IDR</SubmitButton>
                      </ActionForm>
                    )}
                    {canAdjust && ["open", "negotiating", "idr"].includes(d.status) && (
                      <details className="mt-2 text-xs">
                        <summary className="cursor-pointer text-brand-700 dark:text-brand-300">Close</summary>
                        <ActionForm action={closeNsaDisputeAction.bind(null, d.id)} className="mt-2 flex flex-wrap items-end gap-2">
                          <label className="block grow"><span className="label">Outcome</span><input name="outcome" className="input" placeholder="Settled in negotiation; or IDR decided for us" required /></label>
                          <label className="block"><span className="label">Settled at $ (optional)</span><input name="settled" inputMode="decimal" className="input w-28" /></label>
                          <SubmitButton className="btn btn-secondary text-xs" pendingLabel="Saving...">Close</SubmitButton>
                        </ActionForm>
                      </details>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <div className="space-y-6">
          {canAdjust && (
            <Card title="Add a dispute">
              <ActionForm action={createNsaDisputeAction} className="space-y-3 text-sm">
                <label className="block"><span className="label">Claim number</span><input name="claim" className="input font-mono" placeholder="CMD000123" required /></label>
                <label className="block"><span className="label">Initial payment or denial received on</span><input type="date" name="initialResponseOn" className="input" max={today} required /></label>
                <label className="block"><span className="label">Your offer $ (optional)</span><input name="offer" inputMode="decimal" className="input" /></label>
                <label className="block"><span className="label">Notes</span><textarea name="notes" rows={2} className="input" /></label>
                <SubmitButton pendingLabel="Saving...">Add dispute</SubmitButton>
              </ActionForm>
            </Card>
          )}
          <Card title="How the deadlines work">
            <ul className="list-disc space-y-1 pl-5 text-xs text-slate-600 dark:text-slate-400">
              <li>Start open negotiation within 30 business days of the plan&apos;s initial payment or denial, with CMS&apos;s standard notice.</li>
              <li>Negotiation lasts 30 business days.</li>
              <li>Either side may then start IDR within 4 business days, on CMS&apos;s IDR portal.</li>
              <li>Business days skip weekends and federal holidays.</li>
            </ul>
            <a href="https://www.cms.gov/nosurprises" target="_blank" rel="noreferrer noopener" className="mt-2 inline-block text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300">CMS No Surprises Act resources</a>
          </Card>
        </div>
      </div>
    </>
  );
}
