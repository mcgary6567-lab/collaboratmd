import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { CAN_WRITE, requireSession } from "@/lib/auth";
import { ACCESS_KINDS, disclosuresFor, listAccessRequests, PURPOSES } from "@/server/disclosures";
import { completeAccessRequestAction, createAccessRequestAction, denyAccessRequestAction, extendAccessRequestAction, recordDisclosureAction } from "@/app/(app)/privacy-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Privacy requests" };
export const dynamic = "force-dynamic";

const day = (iso: string | null) => (iso ? fmtDate(`${iso}T00:00:00`) : "-");

/** Patients' HIPAA requests (copies of records, accountings of disclosures) and the disclosure log. */
export default async function PrivacyPage() {
  const s = await requireSession();
  const db = await getDb();
  const [open, closed, log] = await Promise.all([listAccessRequests(db, s.practiceId, "open"), listAccessRequests(db, s.practiceId, "closed"), disclosuresFor(db, s.practiceId, undefined, 50)]);
  const today = new Date().toISOString().slice(0, 10);
  const canWrite = (CAN_WRITE as readonly string[]).includes(s.role);
  return (
    <>
      <PageHeader title="Privacy requests" subtitle="Patients' requests for their records or an accounting of disclosures, with their HIPAA deadlines, and every disclosure of patient information" />
      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card title="A patient asked for their records">
          <ActionForm action={createAccessRequestAction} className="grid gap-3 text-sm sm:grid-cols-2">
            <label className="block"><span className="label">Patient MRN</span><input name="mrn" className="input" required disabled={!canWrite} /></label>
            <label className="block"><span className="label">They asked for</span>
              <select name="kind" className="input" disabled={!canWrite}>{Object.entries(ACCESS_KINDS).map(([k, v]) => <option key={k} value={k}>{v.label} ({v.days} days)</option>)}</select></label>
            <label className="block"><span className="label">Received on</span><input name="receivedOn" type="date" defaultValue={today} className="input" required disabled={!canWrite} /></label>
            <label className="block"><span className="label">Form (paper, PDF, patient portal)</span><input name="format" className="input" maxLength={80} disabled={!canWrite} /></label>
            <label className="block sm:col-span-2"><span className="label">Send to (the patient, or a person or app they named)</span><input name="deliverTo" className="input" maxLength={300} disabled={!canWrite} /></label>
            {canWrite && <div className="sm:col-span-2"><SubmitButton pendingLabel="Saving...">Record request</SubmitButton></div>}
          </ActionForm>
        </Card>
        <Card title="Record a disclosure">
          <ActionForm action={recordDisclosureAction} className="grid gap-3 text-sm sm:grid-cols-2">
            <label className="block"><span className="label">Patient MRN</span><input name="mrn" className="input" required disabled={!canWrite} /></label>
            <label className="block"><span className="label">Disclosed on</span><input name="disclosedOn" type="date" defaultValue={today} className="input" required disabled={!canWrite} /></label>
            <label className="block"><span className="label">To</span><input name="recipient" className="input" required maxLength={200} disabled={!canWrite} /></label>
            <label className="block"><span className="label">Their address, if known</span><input name="recipientAddress" className="input" maxLength={300} disabled={!canWrite} /></label>
            <label className="block sm:col-span-2"><span className="label">Purpose</span>
              <select name="purpose" className="input" disabled={!canWrite}>{Object.entries(PURPOSES).map(([k, v]) => <option key={k} value={k}>{v.label}{v.accountable ? "" : " (not in the accounting)"}</option>)}</select></label>
            <label className="block sm:col-span-2"><span className="label">What was disclosed</span><input name="description" className="input" required maxLength={1000} placeholder="Office notes and lab results, March to June 2026" disabled={!canWrite} /></label>
            {canWrite && <div className="sm:col-span-2"><SubmitButton pendingLabel="Saving...">Record disclosure</SubmitButton></div>}
          </ActionForm>
          <p className="mt-2 text-xs text-slate-500">Records sent for a payer&apos;s records request are logged automatically. Disclosures for treatment, payment and operations, to the patient, or with their written authorization are kept here but left out of the accounting.</p>
        </Card>
      </div>

      <Card title={`Open requests (${open.length})`}>
        {open.length === 0 ? <Empty>No open requests.</Empty> : (
          <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-700">
            {open.map(({ r, firstName, lastName, mrn }) => {
              const late = r.dueOn < today;
              return (
                <li key={r.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/patients/${r.patientId}`} className="font-semibold text-brand-700 hover:underline">{lastName}, {firstName}</Link>
                    <span className="text-slate-500">MRN {mrn}</span>
                    <span>{ACCESS_KINDS[r.kind]?.label}</span>
                    <Badge tone={late ? "red" : "amber"}>{late ? "Overdue" : "Due"} {day(r.dueOn)}</Badge>
                    {r.extendedOn && <Badge>Extended {day(r.extendedOn)}</Badge>}
                    {r.kind === "accounting" && <Link href={`/print/disclosures/${r.patientId}`} className="text-brand-700 hover:underline">Print the accounting</Link>}
                  </div>
                  <div className="text-xs text-slate-500">Received {day(r.receivedOn)}{r.format ? ` · ${r.format}` : ""}{r.deliverTo ? ` · to ${r.deliverTo}` : ""}</div>
                  {canWrite && (
                    <div className="mt-2 grid gap-3 lg:grid-cols-3">
                      <ActionForm action={completeAccessRequestAction.bind(null, r.id)} className="flex flex-wrap items-end gap-2">
                        <label className="block"><span className="label">Provided on</span><input name="completedOn" type="date" defaultValue={today} className="input" /></label>
                        <label className="block"><span className="label">Fee ($)</span><input name="fee" inputMode="decimal" defaultValue="0" className="input w-24" /></label>
                        <SubmitButton pendingLabel="Saving...">Provided</SubmitButton>
                      </ActionForm>
                      {!r.extendedOn && (
                        <ActionForm action={extendAccessRequestAction.bind(null, r.id)} className="flex flex-wrap items-end gap-2">
                          <label className="block grow"><span className="label">Extend 30 days: reason</span><input name="reason" className="input" maxLength={500} /></label>
                          <SubmitButton className="btn btn-secondary" pendingLabel="Saving...">Extend</SubmitButton>
                        </ActionForm>
                      )}
                      <ActionForm action={denyAccessRequestAction.bind(null, r.id)} className="flex flex-wrap items-end gap-2">
                        <label className="block grow"><span className="label">Deny: reason</span><input name="reason" className="input" maxLength={500} /></label>
                        <SubmitButton className="btn btn-secondary" pendingLabel="Saving...">Deny</SubmitButton>
                      </ActionForm>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Disclosure log (latest 50)">
          {log.length === 0 ? <Empty>No disclosures recorded yet.</Empty> : (
            <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-700">
              {log.map(({ d, firstName, lastName }) => (
                <li key={d.id} className="py-2">
                  <div className="flex flex-wrap gap-2"><span>{day(d.disclosedOn)}</span><Link href={`/patients/${d.patientId}`} className="text-brand-700 hover:underline">{lastName}, {firstName}</Link><span>to {d.recipient}</span>{PURPOSES[d.purpose]?.accountable && <Badge tone="blue">In the accounting</Badge>}</div>
                  <div className="text-xs text-slate-500">{PURPOSES[d.purpose]?.label ?? d.purpose}: {d.description}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Closed requests">
          {closed.length === 0 ? <Empty>None yet.</Empty> : (
            <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-700">
              {closed.slice(0, 30).map(({ r, firstName, lastName }) => (
                <li key={r.id} className="flex flex-wrap gap-2 py-2">
                  <span>{lastName}, {firstName}</span><span className="text-slate-500">{ACCESS_KINDS[r.kind]?.label}</span>
                  <Badge tone={r.status === "denied" ? "red" : r.completedOn && r.completedOn > r.dueOn ? "amber" : "green"}>{r.status === "denied" ? "Denied" : r.completedOn && r.completedOn > r.dueOn ? "Provided late" : "Provided"} {day(r.completedOn)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
