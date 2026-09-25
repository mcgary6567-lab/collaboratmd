import { and, asc, eq } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { listPatientAuthorizations } from "@/server/payer-edits";
import { listAuthRequests } from "@/server/prior-auth";
import { cancelAuthorizationAction, createAuthorizationAction } from "@/app/(app)/claim-control-actions";
import { requestPriorAuthAction } from "@/app/(app)/prior-auth-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Empty, Field } from "@/components/ui";
import { fmtDate } from "@/lib/utils";

const REQ_TONE: Record<string, "green" | "amber" | "red" | "slate" | "blue"> = { approved: "green", partial: "amber", pended: "blue", denied: "red", error: "red", not_required: "slate", cancelled: "slate" };

export async function AuthorizationsSection({ db, practiceId, patientId }: { db: Db; practiceId: string; patientId: string }) {
  const [auths, payers, requests, providers] = await Promise.all([
    listPatientAuthorizations(db, practiceId, patientId),
    db
      .selectDistinct({ id: schema.payers.id, name: schema.payers.name })
      .from(schema.patientInsurances)
      .innerJoin(schema.payers, eq(schema.payers.id, schema.patientInsurances.payerId))
      .where(and(eq(schema.patientInsurances.patientId, patientId), eq(schema.payers.practiceId, practiceId)))
      .orderBy(asc(schema.payers.name)),
    listAuthRequests(db, practiceId, patientId),
    db.select({ id: schema.providers.id, first: schema.providers.firstName, last: schema.providers.lastName }).from(schema.providers).where(and(eq(schema.providers.practiceId, practiceId), eq(schema.providers.active, true))).orderBy(asc(schema.providers.lastName)),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const state = (a: (typeof auths)[number]["auth"]) => {
    if (a.status === "cancelled") return { label: "Cancelled", tone: "slate" as const };
    if (a.validTo < today) return { label: "Expired", tone: "slate" as const };
    if (a.unitsApproved !== null && a.unitsUsed >= a.unitsApproved) return { label: "Used up", tone: "amber" as const };
    if (a.validFrom > today) return { label: "Not yet valid", tone: "blue" as const };
    return { label: "Active", tone: "green" as const };
  };

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-3">
      <Card title="Prior authorizations" className="lg:col-span-2">
        {auths.length === 0 ? (
          <Empty>No authorizations on file. When a payer edit requires one, claims for that code are held until it is entered here.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Payer</th><th>Number</th><th>Codes</th><th className="text-right">Units</th><th>Valid</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {auths.map(({ auth, payerName }) => {
                const st = state(auth);
                return (
                  <tr key={auth.id}>
                    <td>{payerName}</td>
                    <td className="font-mono">{auth.authNumber}</td>
                    <td className="font-mono text-xs">{auth.cpts.join(", ")}</td>
                    <td className="text-right tabular-nums">{auth.unitsApproved === null ? `${auth.unitsUsed} used` : `${auth.unitsUsed} / ${auth.unitsApproved}`}</td>
                    <td className="whitespace-nowrap text-xs">{fmtDate(auth.validFrom + "T00:00:00")} to {fmtDate(auth.validTo + "T00:00:00")}</td>
                    <td><Badge tone={st.tone}>{st.label}</Badge></td>
                    <td className="text-right">
                      {auth.status === "active" && (
                        <form action={cancelAuthorizationAction.bind(null, patientId, auth.id)}>
                          <button className="text-xs font-semibold text-red-700 hover:underline">Cancel</button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
      <Card title="Add an authorization">
        {payers.length === 0 ? (
          <p className="text-sm text-slate-600">Add the patient&apos;s insurance first.</p>
        ) : (
          <ActionForm action={createAuthorizationAction.bind(null, patientId)} className="space-y-3 text-sm">
            <Field label="Payer">
              <select name="payerId" className="input" required>
                {payers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Authorization number">
              <input name="authNumber" className="input font-mono" required />
            </Field>
            <Field label="Procedure codes covered">
              <input name="cpts" className="input font-mono" placeholder="70553, 70551" required />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Valid from"><input name="validFrom" type="date" className="input" required /></Field>
              <Field label="Valid to"><input name="validTo" type="date" className="input" required /></Field>
            </div>
            <Field label="Units approved (blank if unlimited)">
              <input name="unitsApproved" type="number" min={1} className="input" />
            </Field>
            <Field label="Note">
              <input name="note" className="input" placeholder="Reference, contact, conditions" />
            </Field>
            <SubmitButton pendingLabel="Saving...">Save authorization</SubmitButton>
          </ActionForm>
        )}
      </Card>
      <Card title="Request electronically (X12 278)" className="lg:col-span-3">
        {payers.length === 0 ? (
          <p className="text-sm text-slate-600">Add the patient&apos;s insurance first.</p>
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            <ActionForm action={requestPriorAuthAction.bind(null, patientId)} className="grid grid-cols-2 gap-3 text-sm">
              <Field label="Requesting provider">
                <select name="providerId" className="input" required>
                  {providers.map((p) => <option key={p.id} value={p.id}>{p.last}, {p.first}</option>)}
                </select>
              </Field>
              <Field label="Place of service"><input name="pos" className="input" defaultValue="11" maxLength={2} /></Field>
              <Field label="Procedure codes"><input name="cpts" className="input font-mono" placeholder="70553" required /></Field>
              <Field label="Diagnosis codes"><input name="diagnoses" className="input font-mono" placeholder="G43.909" required /></Field>
              <Field label="Planned from"><input name="serviceFrom" type="date" className="input" required /></Field>
              <Field label="Planned to"><input name="serviceTo" type="date" className="input" /></Field>
              <Field label="Units or visits"><input name="units" type="number" min={1} defaultValue={1} className="input" /></Field>
              <div className="flex items-end"><SubmitButton pendingLabel="Asking the payer...">Send request</SubmitButton></div>
              <p className="col-span-2 text-xs text-slate-500">Sent to the patient&apos;s primary insurance through your clearinghouse. An approval is added to the authorizations above automatically; a pended request creates a follow-up task.</p>
            </ActionForm>
            <div>
              <p className="label">Recent requests</p>
              {requests.length === 0 ? <p className="text-sm text-slate-500">None yet.</p> : (
                <ul className="space-y-2 text-sm">
                  {requests.map(({ req, payerName }) => (
                    <li key={req.id} className="rounded-lg border border-slate-200 p-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs">{req.cpts.join(", ")} · {payerName}</span>
                        <Badge tone={REQ_TONE[req.status] ?? "slate"}>{req.status.replace(/_/g, " ")}</Badge>
                      </div>
                      <p className="text-xs text-slate-500">{fmtDate(req.createdAt)} · {req.message}{req.authNumber ? ` · ${req.authNumber}` : ""}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
