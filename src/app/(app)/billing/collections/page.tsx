import Link from "next/link";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { collectionCandidates, FINAL_NOTICE_DAYS, listCollections } from "@/server/collections";
import { closeAction, finalNoticeAction, placeAction } from "@/app/(app)/collection-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Empty, Money, PageHeader, PatientLink, Stat } from "@/components/ui";
import { fmtDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

const STAGE: Record<string, { label: string; tone: "amber" | "red" | "green" | "slate" }> = {
  final_notice: { label: "final notice", tone: "amber" },
  agency: { label: "at agency", tone: "red" },
  settled: { label: "settled", tone: "green" },
  recalled: { label: "recalled", tone: "slate" },
};

export default async function CollectionsPage() {
  const s = await requireSession();
  const db = await getDb();
  const [candidates, rows] = await Promise.all([collectionCandidates(db, s.practiceId), listCollections(db, s.practiceId)]);
  const canEdit = ["admin", "biller"].includes(s.role);
  const open = rows.filter((r) => !r.collection.closedAt);
  const atAgency = open.filter((r) => r.collection.stage === "agency");
  const now = Date.now();

  return (
    <>
      <PageHeader
        title="Collections"
        subtitle="Accounts past statements and reminders: a final notice, then a collection agency"
        actions={<>{atAgency.length > 0 && canEdit && <a href="/api/export/collections" className="btn btn-secondary">Agency placement file (CSV)</a>}<Link href="/billing" className="btn btn-secondary">Patient billing</Link></>}
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Ready for a final notice" value={candidates.length.toLocaleString()} hint="2+ statements, the first 60+ days ago, no plan" />
        <Stat label="In final notice" value={open.filter((r) => r.collection.stage === "final_notice").length.toLocaleString()} />
        <Stat label="At an agency" value={atAgency.length.toLocaleString()} hint={`$${(atAgency.reduce((a, r) => a + r.collection.amountCents, 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })} written off as bad debt`} />
      </div>

      <Card title="Ready for a final notice">
        {candidates.length === 0 ? (
          <Empty>No accounts qualify. Accounts need a balance of $25 or more, at least two statements with the first 60 or more days ago, and no active payment plan.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Patient</th><th className="text-right">Balance</th><th>Statements</th><th>First statement</th><th /></tr></thead>
              <tbody>
                {candidates.map((c) => (
                  <tr key={c.patientId}>
                    <td><PatientLink id={c.patientId} first={c.firstName} last={c.lastName} /></td>
                    <td className="text-right"><Money cents={c.balanceCents} /></td>
                    <td>{c.statementCount}</td>
                    <td>{c.firstStatement ? fmtDate(c.firstStatement + "T00:00:00") : "-"}</td>
                    <td className="text-right">
                      {canEdit && (
                        <ActionForm action={finalNoticeAction.bind(null, c.patientId)}>
                          <SubmitButton className="btn btn-secondary text-xs" pendingLabel="Sending...">Send final notice</SubmitButton>
                        </ActionForm>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="mt-6">
        <Card title="Accounts in collections">
          {rows.length === 0 ? (
            <Empty>No accounts yet.</Empty>
          ) : (
            <div className="space-y-3">
              {rows.map(({ collection: c, patient: p }) => {
                const readyOn = c.finalNoticeAt ? new Date(c.finalNoticeAt.getTime() + FINAL_NOTICE_DAYS * 86_400_000) : null;
                const st = STAGE[c.stage] ?? { label: c.stage, tone: "slate" as const };
                return (
                  <div key={c.id} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <PatientLink id={p.id} first={p.firstName} last={p.lastName} />
                        <Badge tone={st.tone}>{st.label}</Badge>
                        <Money cents={c.amountCents} />
                        {c.agency && <span className="text-xs text-slate-500">with {c.agency}</span>}
                      </div>
                      <div className="text-xs text-slate-500">
                        Notice {c.finalNoticeAt ? fmtDate(c.finalNoticeAt) : "-"}
                        {c.placedAt && <> · placed {fmtDate(c.placedAt)}</>}
                        {c.closedAt && <> · closed {fmtDate(c.closedAt)}</>}
                        {" · "}<Link className="underline" href={`/billing/collections/${c.id}/notice`}>Final notice letter</Link>
                      </div>
                    </div>
                    {canEdit && !c.closedAt && (
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        {c.stage === "final_notice" && (
                          readyOn && readyOn.getTime() > now ? (
                            <p className="text-xs text-slate-600">The patient has until {fmtDate(readyOn)} to pay or call before the account can go to an agency.</p>
                          ) : (
                            <ActionForm action={placeAction.bind(null, c.id)} className="flex flex-wrap items-end gap-2">
                              <label className="block text-xs"><span className="label">Collection agency</span><input name="agency" className="input py-1 text-sm" required maxLength={200} /></label>
                              <SubmitButton className="btn btn-primary text-xs" pendingLabel="Placing...">Place and write off</SubmitButton>
                            </ActionForm>
                          )
                        )}
                        <ActionForm action={closeAction.bind(null, c.id)} className="flex flex-wrap items-end gap-2">
                          {c.stage === "agency" ? (
                            <>
                              <label className="block text-xs"><span className="label">Outcome</span>
                                <select name="outcome" className="input py-1 text-sm"><option value="settled">Settled by the agency</option><option value="recalled">Recall from the agency</option></select>
                              </label>
                              <label className="block text-xs"><span className="label">Recovered ($)</span><input name="recovered" inputMode="decimal" className="input w-28 py-1 text-sm" defaultValue="0" /></label>
                              <SubmitButton className="btn btn-secondary text-xs" pendingLabel="Saving...">Close account</SubmitButton>
                            </>
                          ) : (
                            <>
                              <input type="hidden" name="outcome" value="settled" />
                              <SubmitButton className="btn btn-secondary text-xs" pendingLabel="Saving...">Close: paid or on a plan</SubmitButton>
                            </>
                          )}
                        </ActionForm>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
      <p className="mt-4 text-xs text-slate-500">
        Placing an account writes the balance off as bad debt, so it leaves patient A/R; amounts the agency recovers are posted as payments when you close the account.
        Check state law and your agency agreement (and the No Surprises Act and credit-reporting rules) before placing accounts.
      </p>
    </>
  );
}
