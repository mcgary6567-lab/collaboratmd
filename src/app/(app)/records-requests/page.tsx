import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { CAN_WRITE, requireSession } from "@/lib/auth";
import { REQUEST_KINDS, listRecordsRequests } from "@/server/records-requests";
import { closeRecordsRequestAction, createRecordsRequestAction, recordsSentAction } from "@/app/(app)/records-request-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Records requests" };
export const dynamic = "force-dynamic";

export default async function RecordsRequestsPage() {
  const s = await requireSession();
  const rows = await listRecordsRequests(await getDb(), s.practiceId);
  const canWrite = (CAN_WRITE as readonly string[]).includes(s.role);
  const today = new Date().toISOString().slice(0, 10);
  const open = rows.filter((x) => x.r.status === "open");
  const late = open.filter((x) => x.r.dueOn < today).length;

  return (
    <>
      <PageHeader title="Records requests" subtitle={`${open.length} waiting for records${late ? `, ${late} past due` : ""} · additional documentation requests and audits`} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Requests" className="lg:col-span-2">
          {rows.length === 0 ? (
            <Empty>No records requests. When a payer asks for medical records (a Medicare ADR letter, a RAC or TPE review, a commercial audit), add it here so it is sent on time.</Empty>
          ) : (
            <ul className="space-y-3 text-sm">
              {rows.map(({ r, controlNumber, patientFirst, patientLast, payerName }) => {
                const overdue = r.status === "open" && r.dueOn < today;
                return (
                  <li key={r.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{REQUEST_KINDS[r.kind]?.label ?? r.kind}</span>
                      {r.status === "open" ? <Badge tone={overdue ? "red" : "amber"}>{overdue ? `Past due ${fmtDate(r.dueOn)}` : `Due ${fmtDate(r.dueOn)}`}</Badge>
                        : r.status === "sent" ? <Badge tone="blue">Sent {fmtDate(r.sentOn)}</Badge> : <Badge tone="green">Closed</Badge>}
                    </div>
                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                      {controlNumber ? <Link href={`/claims/${r.claimId}`} className="font-mono text-brand-700 hover:underline dark:text-brand-300">{controlNumber}</Link> : "No claim linked"}
                      {patientLast ? ` · ${patientLast}, ${patientFirst}` : ""}{payerName ? ` · ${payerName}` : ""}{r.reference ? ` · ref ${r.reference}` : ""} · received {fmtDate(r.receivedOn)}
                    </p>
                    {r.notes && <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{r.notes}</p>}
                    {r.sentVia && <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">Sent by {r.sentVia}</p>}
                    {r.outcome && <p className="mt-1 text-xs font-medium">Outcome: {r.outcome}</p>}
                    {canWrite && r.status === "open" && (
                      <ActionForm action={recordsSentAction.bind(null, r.id)} className="mt-2 flex flex-wrap items-end gap-2 text-xs">
                        <label className="block"><span className="label">Sent on</span><input type="date" name="sentOn" className="input" defaultValue={today} max={today} required /></label>
                        <label className="block"><span className="label">How</span><input name="sentVia" className="input" placeholder="esMD, payer portal, fax" required /></label>
                        <SubmitButton className="btn btn-secondary text-xs" pendingLabel="Saving...">Mark sent</SubmitButton>
                      </ActionForm>
                    )}
                    {canWrite && r.status === "sent" && (
                      <ActionForm action={closeRecordsRequestAction.bind(null, r.id)} className="mt-2 flex flex-wrap items-end gap-2 text-xs">
                        <label className="block grow"><span className="label">Outcome</span><input name="outcome" className="input" placeholder="Payment upheld; or $120 taken back, appealing" required /></label>
                        <SubmitButton className="btn btn-secondary text-xs" pendingLabel="Saving...">Close</SubmitButton>
                      </ActionForm>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        {canWrite && (
          <Card title="Add a request">
            <ActionForm action={createRecordsRequestAction} className="space-y-3 text-sm">
              <label className="block"><span className="label">Kind</span>
                <select name="kind" className="select" required>{Object.entries(REQUEST_KINDS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
              </label>
              <label className="block"><span className="label">Claim number (optional)</span><input name="claim" className="input font-mono" placeholder="CMD000123" /></label>
              <label className="block"><span className="label">Payer&apos;s reference (letter or case number)</span><input name="reference" className="input" /></label>
              <label className="block"><span className="label">Received on</span><input type="date" name="receivedOn" className="input" defaultValue={today} max={today} required /></label>
              <label className="block"><span className="label">Due on (blank: 45 days for Medicare reviews, 30 otherwise)</span><input type="date" name="dueOn" className="input" /></label>
              <label className="block"><span className="label">Notes</span><textarea name="notes" rows={2} className="input" placeholder="Records asked for: office notes, orders, signature attestation" /></label>
              <SubmitButton pendingLabel="Saving...">Add request</SubmitButton>
            </ActionForm>
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Use the due date on the letter when it gives one. Medicare review letters usually allow 45 days; send by esMD or the contractor&apos;s portal to have proof of the date.</p>
          </Card>
        )}
      </div>
    </>
  );
}
