import Link from "next/link";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import {
  ensureDefaultPolicies, listPlans, listPolicies, listStatements, patientsWithBalances, totalPatientBalances,
} from "@/server/billing";
import { createPolicyAction, statementBatchAction, togglePolicyAction } from "@/app/(app)/billing-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Empty, Field, Money, PageHeader, PatientLink, Stat } from "@/components/ui";
import { fmtDate, money } from "@/lib/utils";

export const dynamic = "force-dynamic";

const PLAN_TONE: Record<string, "green" | "red" | "slate" | "blue"> = { active: "blue", completed: "green", defaulted: "red", cancelled: "slate" };

export default async function BillingPage() {
  const s = await requireSession();
  const db = await getDb();
  await ensureDefaultPolicies(db, s.practiceId);
  const [balances, plans, statements, policies, total] = await Promise.all([
    patientsWithBalances(db, s.practiceId, 1, 50),
    listPlans(db, s.practiceId),
    listStatements(db, s.practiceId, undefined, 15),
    listPolicies(db, s.practiceId),
    totalPatientBalances(db, s.practiceId),
  ]);
  const active = plans.filter((p) => p.status === "active");
  const defaulted = plans.filter((p) => p.status === "defaulted");
  const onPlans = active.reduce((a, p) => a + p.totalCents - p.paidCents, 0);
  const admin = s.role === "admin";

  return (
    <>
      <PageHeader title="Patient billing" subtitle="Statements, payment plans and discounts for what patients owe" />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Owed by patients" value={money(total.totalCents)} hint={`${total.accounts.toLocaleString("en-US")} accounts with a balance`} />
        <Stat label="On payment plans" value={money(onPlans)} hint={`${active.length} active plans`} tone="good" />
        <Stat label="Defaulted plans" value={String(defaulted.length)} hint="Two or more missed installments" tone={defaulted.length ? "bad" : "good"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Largest patient balances" className="lg:col-span-2">
          {balances.length === 0 ? (
            <Empty>No patient balances.</Empty>
          ) : (
            <table className="table">
              <thead><tr><th>Patient</th><th className="text-right">Balance</th><th>Last statement</th></tr></thead>
              <tbody>
                {balances.map((b) => (
                  <tr key={b.patientId}>
                    <td><PatientLink id={b.patientId} first={b.firstName} last={b.lastName} mrn={b.mrn} /></td>
                    <td className="text-right font-semibold"><Money cents={b.balanceCents} /></td>
                    <td>{b.lastStatement ? fmtDate(b.lastStatement + "T00:00:00") : <span className="text-slate-400">Never</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <div className="space-y-6">
          <Card title="Statement run">
            <p className="mb-3 text-sm text-slate-600">
              Generates a statement for every patient at or above the threshold. Anyone billed in the last 25 days is skipped, so rerunning never double-bills.
            </p>
            <ActionForm action={statementBatchAction} className="space-y-3">
              <Field label="Minimum balance ($)"><input name="min" type="number" step="0.01" min="0.01" defaultValue="5.00" className="input" /></Field>
              <SubmitButton pendingLabel="Generating statements...">Generate statements</SubmitButton>
            </ActionForm>
          </Card>

          <Card title="Discount policies">
            <ul className="space-y-2 text-sm">
              {policies.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2">
                  <span className={p.active ? "" : "text-slate-400 line-through"}>{p.name} <span className="text-slate-500">{p.percent}%</span></span>
                  {admin && (
                    <form action={togglePolicyAction.bind(null, p.id, !p.active)}>
                      <button className="text-xs font-semibold text-brand-700 hover:underline">{p.active ? "Retire" : "Restore"}</button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
            {admin && (
              <ActionForm action={createPolicyAction} className="mt-4 grid grid-cols-2 gap-2 border-t border-slate-100 pt-4">
                <Field label="Name" className="col-span-2"><input name="name" className="input" placeholder="Courtesy discount" required /></Field>
                <Field label="Kind">
                  <select name="kind" className="select"><option value="courtesy">Courtesy</option><option value="self_pay">Self-pay</option><option value="prompt_pay">Prompt-pay</option><option value="hardship">Hardship</option></select>
                </Field>
                <Field label="Percent"><input name="percent" type="number" min="1" max="100" step="0.5" className="input" required /></Field>
                <div className="col-span-2"><SubmitButton className="btn btn-secondary">Add policy</SubmitButton></div>
              </ActionForm>
            )}
          </Card>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Payment plans">
          {plans.length === 0 ? (
            <Empty>No payment plans yet. Create one from a patient&apos;s record.</Empty>
          ) : (
            <table className="table">
              <thead><tr><th>Patient</th><th className="text-right">Paid</th><th>Next due</th><th>Status</th></tr></thead>
              <tbody>
                {plans.map((p) => (
                  <tr key={p.id}>
                    <td><PatientLink id={p.patientId} first={p.firstName} last={p.lastName} /></td>
                    <td className="text-right tabular-nums">{money(p.paidCents)} <span className="text-slate-400">/ {money(p.totalCents)}</span></td>
                    <td>{p.nextDue ? fmtDate(p.nextDue + "T00:00:00") : "-"}{p.missed > 0 && <span className="ml-1 text-xs font-semibold text-red-700">{p.missed} missed</span>}</td>
                    <td><Badge tone={PLAN_TONE[p.status] ?? "slate"}>{p.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Recent statements">
          {statements.length === 0 ? (
            <Empty>No statements yet.</Empty>
          ) : (
            <table className="table">
              <thead><tr><th>Statement</th><th>Patient</th><th className="text-right">Due</th><th>Status</th></tr></thead>
              <tbody>
                {statements.map(({ statement: st, patient }) => (
                  <tr key={st.id}>
                    <td><Link href={`/statements/${st.id}`} className="font-mono text-brand-700 hover:underline">{st.statementNumber}</Link></td>
                    <td><PatientLink id={patient.id} first={patient.firstName} last={patient.lastName} /></td>
                    <td className="text-right"><Money cents={st.amountDueCents} /></td>
                    <td><Badge tone={st.status === "sent" ? "green" : st.status === "void" ? "slate" : "blue"}>{st.status}</Badge></td>
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
