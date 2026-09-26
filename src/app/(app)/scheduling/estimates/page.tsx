import Link from "next/link";
import { getDb } from "@/db";
import { CAN_WRITE, requireSession } from "@/lib/auth";
import { upcomingVisits } from "@/server/pre-visit";
import { estimateAllAction, estimateAppointmentAction, requestDepositAction } from "@/app/(app)/pre-visit-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Empty, Money, PageHeader, PatientLink } from "@/components/ui";
import { fmtDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function PreVisitEstimatesPage() {
  const s = await requireSession();
  const rows = await upcomingVisits(await getDb(), s.practiceId, 14);
  const canWrite = (CAN_WRITE as readonly string[]).includes(s.role);
  const missing = rows.filter((r) => !r.estimate).map((r) => r.appt.id);
  const expected = rows.reduce((a, r) => a + (r.estimate?.patientOwesCents ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Estimates before the visit"
        subtitle={`Next 14 days · ${rows.length} visits · about $${(expected / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })} in patient responsibility estimated so far`}
        actions={
          <span className="flex gap-2">
            <Link href="/scheduling" className="btn btn-secondary">Schedule</Link>
            {canWrite && missing.length > 0 && <ActionForm action={estimateAllAction.bind(null, missing)}><SubmitButton pendingLabel="Estimating...">Estimate all {missing.length}</SubmitButton></ActionForm>}
          </span>
        }
      />
      <Card>
        <p className="mb-4 text-sm text-slate-600">
          Each estimate uses the patient&apos;s latest eligibility check and the payer&apos;s contract for the service this provider usually bills for the visit type (you can name a different code).
          Uninsured patients get a good faith estimate. Sending asks the patient to pay ahead in the portal; what they pay sits as a credit until the visit is billed.
        </p>
        {rows.length === 0 ? <Empty>No scheduled visits in the next 14 days.</Empty> : (
          <table className="table">
            <thead><tr><th>Visit</th><th>Patient</th><th>Coverage</th><th className="text-right">Patient owes</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.appt.id}>
                  <td className="whitespace-nowrap text-sm">{fmtDateTime(r.appt.startsAt)}<span className="block text-xs text-slate-500">{r.appt.type.replace(/_/g, " ")} · Dr. {r.provider.lastName}</span></td>
                  <td><PatientLink id={r.patient.id} first={r.patient.firstName} last={r.patient.lastName} /></td>
                  <td className="text-xs">
                    {r.insurance ? (r.insurance.status === "active" ? <Badge tone="green">verified</Badge> : r.insurance.status ? <Badge tone="red">{r.insurance.status}</Badge> : <Badge tone="amber">not checked</Badge>) : <Badge>self-pay</Badge>}
                  </td>
                  <td className="text-right">
                    {r.estimate ? (
                      <>
                        <Money cents={r.estimate.patientOwesCents} className="font-semibold" />
                        <span className="block text-xs text-slate-500">{r.estimate.lines.map((l) => l.cpt).join(", ")}{r.estimate.depositRequestedAt ? " · sent" : ""}</span>
                      </>
                    ) : <span className="text-slate-400">-</span>}
                  </td>
                  <td className="text-right">
                    {canWrite && (
                      <div className="flex items-start justify-end gap-2">
                        <details className="text-left">
                          <summary className="btn btn-secondary cursor-pointer px-2 py-1 text-xs">{r.estimate ? "Redo" : "Estimate"}</summary>
                          <ActionForm action={estimateAppointmentAction.bind(null, r.appt.id)} className="mt-2 w-56 space-y-2">
                            <input name="cpt" className="input font-mono text-xs" placeholder="Code (blank: usual one)" maxLength={5} />
                            <SubmitButton className="btn btn-primary text-xs" pendingLabel="...">Estimate</SubmitButton>
                          </ActionForm>
                        </details>
                        {r.estimate && r.estimate.patientOwesCents >= 100 && (
                          <ActionForm action={requestDepositAction.bind(null, r.estimate.id)}>
                            <SubmitButton className="btn btn-primary px-2 py-1 text-xs" pendingLabel="Sending...">{r.estimate.depositRequestedAt ? "Send again" : "Send and ask to pay ahead"}</SubmitButton>
                          </ActionForm>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
