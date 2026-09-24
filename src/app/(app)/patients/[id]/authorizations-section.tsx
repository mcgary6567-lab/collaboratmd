import { and, asc, eq } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { listPatientAuthorizations } from "@/server/payer-edits";
import { cancelAuthorizationAction, createAuthorizationAction } from "@/app/(app)/claim-control-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Empty, Field } from "@/components/ui";
import { fmtDate } from "@/lib/utils";

export async function AuthorizationsSection({ db, practiceId, patientId }: { db: Db; practiceId: string; patientId: string }) {
  const [auths, payers] = await Promise.all([
    listPatientAuthorizations(db, practiceId, patientId),
    db
      .selectDistinct({ id: schema.payers.id, name: schema.payers.name })
      .from(schema.patientInsurances)
      .innerJoin(schema.payers, eq(schema.payers.id, schema.patientInsurances.payerId))
      .where(and(eq(schema.patientInsurances.patientId, patientId), eq(schema.payers.practiceId, practiceId)))
      .orderBy(asc(schema.payers.name)),
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
    </div>
  );
}
