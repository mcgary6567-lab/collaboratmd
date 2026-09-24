import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { listCheckins } from "@/server/checkin";
import { applyCheckinAction, dismissCheckinAction } from "@/app/(app)/checkin-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Empty, PageHeader, PatientLink } from "@/components/ui";
import { fmtDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function CheckInsPage() {
  const s = await requireSession();
  const db = await getDb();
  const pending = await listCheckins(db, s.practiceId, "pending");

  return (
    <>
      <PageHeader title="Online check-ins" subtitle="What patients submitted before their visit, waiting for the front desk to review" />
      {pending.length === 0 ? (
        <Card>
          <Empty>No check-ins waiting. Send a check-in link from the schedule; submissions appear here for review.</Empty>
        </Card>
      ) : (
        <div className="space-y-4">
          {pending.map(({ submission, patient, appt, insurance, changes }) => {
            const ins = submission.insurance;
            const c = submission.consents;
            return (
              <Card
                key={submission.id}
                title={`${fmtDateTime(appt.startsAt)} visit`}
                actions={<span className="text-xs text-slate-500">Submitted {fmtDateTime(submission.createdAt)}</span>}
              >
                <div className="grid gap-4 text-sm md:grid-cols-3">
                  <div>
                    <PatientLink id={patient.id} first={patient.firstName} last={patient.lastName} mrn={patient.mrn} />
                    <div className="mt-2 font-medium text-slate-700">Contact changes</div>
                    {changes.length === 0 ? (
                      <div className="text-slate-500">None</div>
                    ) : (
                      <ul className="mt-1 space-y-1">
                        {changes.map((ch) => (
                          <li key={ch.field}>
                            <span className="text-slate-500">{ch.label}:</span> <span className="text-slate-400 line-through">{ch.from || "blank"}</span> → <span className="font-medium">{ch.to}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div>
                    <div className="font-medium text-slate-700">Insurance</div>
                    {ins.sameAsOnFile ? (
                      <div className="text-slate-600">Unchanged{insurance ? `: ${insurance.payerName}` : ""}</div>
                    ) : (
                      <div className="space-y-0.5">
                        <Badge tone="amber">New card</Badge>
                        <div>{ins.payerName}</div>
                        <div className="font-mono text-xs">Member {ins.memberId}{ins.groupNumber ? ` · Group ${ins.groupNumber}` : ""}</div>
                        <div className="text-xs text-slate-500">Relationship: {ins.relationship}</div>
                        {insurance && <div className="text-xs text-slate-500">On file: {insurance.payerName}, {insurance.ins.memberId}</div>}
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="font-medium text-slate-700">Consents</div>
                    <div className="flex flex-wrap gap-1">
                      <Badge tone={c.privacyNotice ? "green" : "red"}>Privacy notice</Badge>
                      <Badge tone={c.financialPolicy ? "green" : "red"}>Financial policy</Badge>
                      <Badge tone={c.assignmentOfBenefits ? "green" : "red"}>Assignment of benefits</Badge>
                    </div>
                    <div className="mt-1 text-xs text-slate-500">Signed “{c.signature}” at {fmtDateTime(c.signedAt)}</div>
                  </div>
                </div>
                <div className="mt-4 flex items-start gap-2 border-t pt-3">
                  <ActionForm action={applyCheckinAction.bind(null, submission.id)}>
                    <SubmitButton className="btn btn-primary text-xs" pendingLabel="Applying...">Apply to chart</SubmitButton>
                  </ActionForm>
                  <form action={dismissCheckinAction.bind(null, submission.id)}>
                    <button className="btn btn-secondary text-xs">Dismiss</button>
                  </form>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
