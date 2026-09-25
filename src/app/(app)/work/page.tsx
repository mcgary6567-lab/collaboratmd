import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireSession } from "@/lib/auth";
import { assignableUsers } from "@/server/work";
import { listRules, productivity, RULE_KINDS, slaSummary } from "@/server/work-rules";
import { ruleActiveAction, runRulesAction, saveRuleAction } from "@/app/(app)/ops-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { money } from "@/lib/utils";

export const dynamic = "force-dynamic";

// The denial categories CARC codes map to (see lib/codes/carc.ts).
const CATEGORIES = ["eligibility", "authorization", "coding", "medical_necessity", "timely_filing", "duplicate", "cob", "contractual", "patient_responsibility", "other"];

export default async function WorkPage() {
  const s = await requireSession();
  const db = await getDb();
  const [rules, sla, people, users, payers] = await Promise.all([
    listRules(db, s.practiceId),
    slaSummary(db, s.practiceId),
    productivity(db, s.practiceId),
    assignableUsers(db, s.practiceId),
    db.select({ id: schema.payers.id, name: schema.payers.name }).from(schema.payers).where(eq(schema.payers.practiceId, s.practiceId)).orderBy(asc(schema.payers.name)),
  ]);
  const admin = s.role === "admin";
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const bySla = new Map(sla.map((r) => [r.ruleId, r]));

  return (
    <>
      <PageHeader
        title="Work queues"
        subtitle="Rules that hand out denials and stuck claims as tasks, with a due date, and how the team is keeping up"
        actions={<span className="flex gap-2"><Link href="/tasks" className="btn btn-secondary">Tasks</Link>{["admin", "biller"].includes(s.role) && <ActionForm action={runRulesAction}><SubmitButton pendingLabel="Running...">Run rules now</SubmitButton></ActionForm>}</span>}
      />
      <div className="grid gap-6 xl:grid-cols-3">
        <Card title="Rules" className="xl:col-span-2">
          {rules.length === 0 ? <Empty>No rules yet. A rule runs every morning and assigns anything new that matches it.</Empty> : (
            <table className="table">
              <thead><tr><th>Rule</th><th>Assigns to</th><th className="text-right">Open</th><th className="text-right">Overdue</th><th className="text-right">On time (30 days)</th><th /></tr></thead>
              <tbody>
                {rules.map((r) => {
                  const st = bySla.get(r.id);
                  return (
                    <tr key={r.id} className={r.active ? "" : "opacity-60"}>
                      <td>
                        <div className="font-medium">{r.name}</div>
                        <div className="text-xs text-slate-500">
                          {RULE_KINDS[r.kind]?.label}{r.conditions.minAgeDays ? `, unpaid ${r.conditions.minAgeDays}+ days` : ""}{r.conditions.minCents ? `, ${money(r.conditions.minCents)}+` : ""}
                          {r.conditions.payerIds?.length ? `, ${r.conditions.payerIds.length} payer${r.conditions.payerIds.length === 1 ? "" : "s"}` : ""}{r.conditions.categories?.length ? `, ${r.conditions.categories.join("/").replace(/_/g, " ")}` : ""} · due in {r.slaDays} days · {r.priority}
                        </div>
                      </td>
                      <td className="text-xs">{r.assigneeIds.map((id) => userName.get(id) ?? "former user").join(", ")}</td>
                      <td className="text-right">{st?.open ?? 0}</td>
                      <td className="text-right">{st?.overdue ? <span className="font-semibold text-red-700">{st.overdue}</span> : 0}</td>
                      <td className="text-right">{st?.onTimePct === null || st?.onTimePct === undefined ? "-" : `${Math.round(st.onTimePct * 100)}% of ${st.done30}`}</td>
                      <td className="text-right">{admin && <ActionForm action={ruleActiveAction.bind(null, r.id, !r.active)}><SubmitButton className="btn btn-secondary px-2 py-1 text-xs" pendingLabel="...">{r.active ? "Pause" : "Turn on"}</SubmitButton></ActionForm>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="New rule">
          {!admin ? <p className="text-sm text-slate-500">An administrator sets up rules.</p> : (
            <ActionForm action={saveRuleAction} className="space-y-2 text-sm">
              <input name="name" className="input" placeholder="e.g. Aetna denials over $500" required maxLength={80} />
              <select name="kind" className="input" defaultValue="denials">{Object.entries(RULE_KINDS).map(([k, v]) => <option key={k} value={k}>{v.label}: {v.description.toLowerCase()}</option>)}</select>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-xs">At least ($)<input name="min" inputMode="decimal" placeholder="0" className="input mt-1" /></label>
                <label className="block text-xs">Unpaid days (stalled)<input name="minAgeDays" type="number" min={7} max={365} defaultValue={30} className="input mt-1" /></label>
                <label className="block text-xs">Due within (days)<input name="slaDays" type="number" min={1} max={60} defaultValue={5} className="input mt-1" required /></label>
                <label className="block text-xs">Priority<select name="priority" defaultValue="normal" className="input mt-1"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select></label>
              </div>
              <details className="text-xs"><summary className="cursor-pointer font-semibold">Only these payers (optional)</summary>
                <div className="mt-1 max-h-32 space-y-1 overflow-y-auto">{payers.map((p) => <label key={p.id} className="flex items-center gap-2"><input type="checkbox" name="payerIds" value={p.id} /> {p.name}</label>)}</div>
              </details>
              <details className="text-xs"><summary className="cursor-pointer font-semibold">Only these denial categories (optional)</summary>
                <div className="mt-1 space-y-1">{CATEGORIES.map((c) => <label key={c} className="flex items-center gap-2"><input type="checkbox" name="categories" value={c} /> {c.replace(/_/g, " ")}</label>)}</div>
              </details>
              <fieldset className="text-xs"><legend className="mb-1 font-semibold">Assign to, taking turns</legend>
                <div className="max-h-32 space-y-1 overflow-y-auto">{users.map((u) => <label key={u.id} className="flex items-center gap-2"><input type="checkbox" name="assigneeIds" value={u.id} /> {u.name}</label>)}</div>
              </fieldset>
              <SubmitButton pendingLabel="Saving...">Save rule</SubmitButton>
            </ActionForm>
          )}
        </Card>

        <Card title="Productivity, last 30 days" className="xl:col-span-3">
          {people.length === 0 ? <Empty>No assigned work yet.</Empty> : (
            <table className="table">
              <thead><tr><th>Person</th><th className="text-right">Done (7 days)</th><th className="text-right">Done (30 days)</th><th className="text-right">Average days to finish</th><th className="text-right">Open</th><th className="text-right">Overdue</th><th className="text-right">Ledger postings</th></tr></thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.userId}>
                    <td>{p.name}</td>
                    <td className="text-right">{p.done7}</td>
                    <td className="text-right font-semibold">{p.done30}</td>
                    <td className="text-right">{p.avgDays === null ? "-" : p.avgDays.toFixed(1)}</td>
                    <td className="text-right">{p.open}</td>
                    <td className="text-right">{p.overdue ? <Badge tone="red">{p.overdue}</Badge> : 0}</td>
                    <td className="text-right">{p.postings}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}
