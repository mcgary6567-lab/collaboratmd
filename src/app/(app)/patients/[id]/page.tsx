import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { getPatient } from "@/server/patients";
import { computeFinancials } from "@/server/claims";
import { eligibilityAction, patientPaymentAction } from "@/app/(app)/actions";
import { Card, PageHeader, Badge, Money, Empty, Field } from "@/components/ui";
import { fmtDate, fmtDateTime, money } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function PatientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireSession();
  const db = await getDb();
  const data = await getPatient(db, s.practiceId, id);
  if (!data) notFound();
  const { patient, insurances, checks, visits, ledger } = data;
  const fin = computeFinancials(ledger);
  const latestCheck = checks[0];

  return (
    <>
      <PageHeader
        title={`${patient.lastName}, ${patient.firstName}`}
        subtitle={`MRN ${patient.mrn} · DOB ${fmtDate(patient.dob + "T00:00:00")} · ${patient.sex}`}
        actions={
          <Link href={`/encounters/new?patientId=${patient.id}`} className="btn btn-primary">
            New charge
          </Link>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Demographics">
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">Phone</dt><dd>{patient.phone ?? "-"}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Email</dt><dd>{patient.email ?? "-"}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Address</dt><dd className="text-right">{patient.address1}<br />{patient.city}, {patient.state} {patient.zip}</dd></div>
          </dl>
        </Card>
        <Card title="Insurance">
          {insurances.map(({ insurance, payer }) => (
            <div key={insurance.id} className="mb-3 rounded-lg border border-slate-200 p-3 text-sm">
              <div className="flex items-center justify-between">
                <div className="font-semibold">{payer.name}</div>
                <Badge tone="blue">{insurance.rank === 1 ? "Primary" : insurance.rank === 2 ? "Secondary" : "Tertiary"}</Badge>
              </div>
              <div className="mt-1 text-slate-500">Member {insurance.memberId}{insurance.groupNumber ? ` · Group ${insurance.groupNumber}` : ""} · {insurance.relationship}</div>
              <div className="text-slate-500">Copay {money(insurance.copayCents)}</div>
              <form action={eligibilityAction.bind(null, insurance.id, patient.id)} className="mt-2">
                <button className="btn btn-secondary text-xs">Check eligibility (270/271)</button>
              </form>
            </div>
          ))}
          {latestCheck && (
            <div className={`rounded-lg p-3 text-sm ${latestCheck.status === "active" ? "bg-green-50 text-green-900" : "bg-red-50 text-red-900"}`}>
              <div className="font-semibold">Coverage {latestCheck.status} · {fmtDateTime(latestCheck.checkedAt)}</div>
              {latestCheck.status === "active" ? (
                <div className="mt-1 grid grid-cols-2 gap-x-3 text-xs">
                  <span>Plan: {latestCheck.planName}</span>
                  <span>Copay: {money(latestCheck.copayCents)}</span>
                  <span>Deductible: {money(latestCheck.deductibleCents)}</span>
                  <span>Remaining: {money(latestCheck.deductibleRemainingCents)}</span>
                  <span>OOP max: {money(latestCheck.oopMaxCents)}</span>
                </div>
              ) : (
                <div className="mt-1 text-xs">{String((latestCheck.response as { message?: string })?.message ?? "")}</div>
              )}
            </div>
          )}
        </Card>
        <Card title="Account balance">
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">Total charges</dt><dd><Money cents={fin.chargesCents} /></dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Insurance paid</dt><dd><Money cents={fin.insurancePaidCents} /></dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Adjustments</dt><dd><Money cents={fin.adjustmentsCents} /></dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Patient paid</dt><dd><Money cents={fin.patientPaidCents} /></dd></div>
            <div className="flex justify-between border-t pt-1 font-semibold"><dt>Insurance balance</dt><dd><Money cents={fin.insuranceBalanceCents} /></dd></div>
            <div className="flex justify-between font-semibold"><dt>Patient balance</dt><dd className={fin.patientBalanceCents > 0 ? "text-red-700" : ""}><Money cents={fin.patientBalanceCents} /></dd></div>
          </dl>
          <form action={patientPaymentAction.bind(null, patient.id)} className="mt-4 flex items-end gap-2">
            <Field label="Post payment ($)"><input name="amount" type="number" step="0.01" min="0.01" className="input" placeholder="25.00" required /></Field>
            <Field label="Method">
              <select name="method" className="select">
                <option value="card">Card</option>
                <option value="cash">Cash</option>
                <option value="check">Check</option>
              </select>
            </Field>
            <button className="btn btn-primary">Post</button>
          </form>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Visits">
          {visits.length === 0 ? (
            <Empty>No encounters yet.</Empty>
          ) : (
            <table className="table">
              <thead><tr><th>DOS</th><th>POS</th><th>Diagnoses</th><th>Status</th></tr></thead>
              <tbody>
                {visits.map((v) => (
                  <tr key={v.id}>
                    <td>{fmtDate(v.dateOfService + "T00:00:00")}</td>
                    <td>{v.placeOfService}</td>
                    <td className="font-mono text-xs">{v.diagnoses.join(", ")}</td>
                    <td><Badge tone={v.status === "billed" ? "green" : "amber"}>{v.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="Ledger (most recent)">
          <table className="table">
            <thead><tr><th>Date</th><th>Type</th><th>Note</th><th className="text-right">Amount</th></tr></thead>
            <tbody>
              {ledger.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap">{fmtDate(e.postedAt)}</td>
                  <td className="whitespace-nowrap">{e.type.replace(/_/g, " ")}</td>
                  <td className="text-slate-500">{e.note}{e.reasonCode ? ` (${e.groupCode}-${e.reasonCode})` : ""}</td>
                  <td className="text-right"><Money cents={e.amountCents} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </>
  );
}
