import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireSession } from "@/lib/auth";
import { listPayerEdits } from "@/server/payer-edits";
import { KIND_LABEL, suggestRules } from "@/server/rule-suggestions";
import { adoptSuggestionAction, dismissSuggestionAction } from "@/app/(app)/code-set-actions";
import { EDIT_KINDS } from "@/lib/scrub/payer-edits";
import { createPayerEditAction, setPayerEditActiveAction } from "@/app/(app)/claim-control-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Empty, Field, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

function detail(kind: string, params: { modifiers?: string[]; dxPrefixes?: string[]; maxUnits?: number }) {
  if (kind === "modifier_required") return `One of ${params.modifiers?.join(", ")}`;
  if (kind === "dx_required") return `Dx starting ${params.dxPrefixes?.join(", ")}`;
  if (kind === "max_units") return `At most ${params.maxUnits} per line`;
  return "";
}

export default async function PayerEditsPage() {
  const s = await requireSession();
  const db = await getDb();
  const [edits, suggestions, payers] = await Promise.all([
    listPayerEdits(db, s.practiceId),
    suggestRules(db, s.practiceId),
    db.select().from(schema.payers).where(eq(schema.payers.practiceId, s.practiceId)).orderBy(asc(schema.payers.name)),
  ]);
  const admin = s.role === "admin";
  const label = new Map(EDIT_KINDS.map((k) => [k.kind, k.label]));

  return (
    <>
      <PageHeader
        title="Payer edits"
        subtitle="Rules one payer applies and another does not, checked on every claim before it is sent"
        actions={<><Link href="/settings/code-sets" className="btn btn-secondary">National code sets</Link><Link href="/settings" className="btn btn-secondary">Back to settings</Link></>}
      />
      {suggestions.length > 0 && (
        <div className="mb-6">
          <Card title={`Suggested from your denials · ${suggestions.length}`}>
            <p className="mb-3 text-sm text-slate-600">These payers keep denying the same code for the same reason. Adding the rule stops the next claim at the desk instead of weeks later on a remittance.</p>
            <ul className="space-y-3">
              {suggestions.map((sg) => (
                <li key={sg.key} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-slate-200 p-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900">{sg.payerName} · {sg.cpt}: {KIND_LABEL[sg.kind]}{detail(sg.kind, sg.params) ? ` (${detail(sg.kind, sg.params)})` : ""}</p>
                    <p className="text-slate-600">{sg.evidence} {(sg.deniedCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })} denied.</p>
                  </div>
                  {["admin", "biller"].includes(s.role) && (
                    <div className="flex gap-2">
                      <ActionForm action={adoptSuggestionAction.bind(null, sg.key)}><SubmitButton className="btn btn-primary text-xs" pendingLabel="Adding...">Add rule</SubmitButton></ActionForm>
                      <ActionForm action={dismissSuggestionAction.bind(null, sg.key)}><SubmitButton className="btn btn-secondary text-xs" pendingLabel="...">Dismiss</SubmitButton></ActionForm>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title={`Edits on file · ${edits.filter((e) => e.edit.active).length} active`} className="lg:col-span-2">
          {edits.length === 0 ? (
            <Empty>
              No payer edits yet. Every claim still goes through the general scrubber; add an edit when a payer denies something the general rules
              allow, so the next claim is stopped at the desk instead.
            </Empty>
          ) : (
            <table className="table">
              <thead>
                <tr><th>Payer</th><th>Code</th><th>Rule</th><th>Message</th><th /></tr>
              </thead>
              <tbody>
                {edits.map(({ edit, payerName }) => (
                  <tr key={edit.id} className={edit.active ? "" : "opacity-50"}>
                    <td className="whitespace-nowrap">{payerName ?? <span className="text-slate-500">All payers</span>}</td>
                    <td className="font-mono">{edit.cpt ?? "Any"}</td>
                    <td>
                      <div className="flex items-center gap-1">
                        <Badge tone={edit.severity === "error" ? "red" : "amber"}>{edit.severity === "error" ? "Blocks" : "Warns"}</Badge>
                        <span>{label.get(edit.kind as never) ?? edit.kind}</span>
                      </div>
                      <div className="text-xs text-slate-500">{detail(edit.kind, edit.params)}</div>
                    </td>
                    <td className="text-slate-600">{edit.message}</td>
                    <td className="text-right">
                      {admin && (
                        <form action={setPayerEditActiveAction.bind(null, edit.id, !edit.active)}>
                          <button className="text-xs font-semibold text-brand-700 hover:underline">{edit.active ? "Turn off" : "Turn on"}</button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <div className="space-y-6">
          {admin ? (
            <Card title="Add an edit">
              <ActionForm action={createPayerEditAction} className="space-y-3 text-sm">
                <Field label="Payer">
                  <select name="payerId" className="input">
                    <option value="">All payers</option>
                    {payers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </Field>
                <Field label="Rule">
                  <select name="kind" className="input" required>
                    {EDIT_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
                  </select>
                </Field>
                <Field label="Procedure code">
                  <input name="cpt" className="input font-mono" placeholder="e.g. 70553 (optional for a diagnosis rule)" />
                </Field>
                <Field label="Modifiers (for a modifier rule)">
                  <input name="modifiers" className="input font-mono" placeholder="26, TC" />
                </Field>
                <Field label="Diagnosis codes or prefixes (for a diagnosis rule)">
                  <input name="dxPrefixes" className="input font-mono" placeholder="E78, Z13.220" />
                </Field>
                <Field label="Unit limit (for a unit rule)">
                  <input name="maxUnits" type="number" min={1} className="input" />
                </Field>
                <Field label="When it fails">
                  <select name="severity" className="input">
                    <option value="error">Block the claim</option>
                    <option value="warning">Warn only</option>
                  </select>
                </Field>
                <Field label="Message for the biller (optional)">
                  <input name="message" className="input" placeholder="Shown on the claim when the rule fails" />
                </Field>
                <SubmitButton pendingLabel="Saving...">Add edit</SubmitButton>
              </ActionForm>
            </Card>
          ) : (
            <Card title="Add an edit">
              <p className="text-sm text-slate-600">Only an administrator can change payer edits.</p>
            </Card>
          )}
          <Card title="How the rules work">
            <ul className="space-y-2 text-sm text-slate-600">
              {EDIT_KINDS.map((k) => (
                <li key={k.kind}><span className="font-medium text-slate-800">{k.label}.</span> {k.help}</li>
              ))}
              <li>Prior authorizations are entered on the patient&apos;s page. A claim that uses one sends its number to the payer (REF*G1) and draws down its units when accepted.</li>
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
