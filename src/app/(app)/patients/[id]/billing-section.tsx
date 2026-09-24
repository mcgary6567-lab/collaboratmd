import Link from "next/link";
import type { Db } from "@/db";
import {
  ensureDefaultPolicies, listEstimates, listPolicies, listStatements, patientBalanceCents, plansForPatient,
} from "@/server/billing";
import {
  applyDiscountAction, cancelPlanAction, createPlanAction, generateStatementAction, planPaymentAction,
} from "@/app/(app)/billing-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Empty, Field, Money } from "@/components/ui";
import { fmtDate, money } from "@/lib/utils";

const PLAN_TONE: Record<string, "green" | "amber" | "red" | "slate" | "blue"> = {
  active: "blue", completed: "green", defaulted: "red", cancelled: "slate",
};
const INSTALLMENT_TONE: Record<string, "green" | "amber" | "red" | "slate"> = {
  paid: "green", partial: "amber", missed: "red", scheduled: "slate",
};

export async function BillingSection({ db, practiceId, patientId }: { db: Db; practiceId: string; patientId: string }) {
  await ensureDefaultPolicies(db, practiceId);
  const [balance, policies, plans, statements, estimates] = await Promise.all([
    patientBalanceCents(db, patientId),
    listPolicies(db, practiceId, true),
    plansForPatient(db, practiceId, patientId),
    listStatements(db, practiceId, patientId, 10),
    listEstimates(db, practiceId, patientId),
  ]);
  const active = plans.find((p) => p.plan.status === "active" || p.plan.status === "defaulted");
  const todayIso = new Date().toISOString().slice(0, 10);

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-2">
      <Card title="Payment plan">
        {active ? (
          <>
            <div className="mb-3 flex items-center justify-between text-sm">
              <div>
                <span className="font-semibold"><Money cents={active.plan.totalCents} /></span>
                <span className="text-slate-500"> over {active.plan.installmentCount} {active.plan.frequency} installments</span>
              </div>
              <Badge tone={PLAN_TONE[active.plan.status]}>{active.plan.status}</Badge>
            </div>
            <table className="table">
              <thead><tr><th>#</th><th>Due</th><th className="text-right">Amount</th><th className="text-right">Paid</th><th>Status</th></tr></thead>
              <tbody>
                {active.installments.map((i) => (
                  <tr key={i.id}>
                    <td>{i.seq}</td>
                    <td>{fmtDate(i.dueDate + "T00:00:00")}</td>
                    <td className="text-right"><Money cents={i.amountCents} /></td>
                    <td className="text-right"><Money cents={i.paidCents} /></td>
                    <td><Badge tone={INSTALLMENT_TONE[i.status]}>{i.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ActionForm action={planPaymentAction.bind(null, active.plan.id, patientId)} className="mt-4 flex flex-wrap items-end gap-2">
              <Field label="Take payment ($)"><input name="amount" type="number" step="0.01" min="0.01" className="input w-32" required /></Field>
              <Field label="Method">
                <select name="method" className="select"><option value="card">Card</option><option value="cash">Cash</option><option value="check">Check</option><option value="ach">ACH</option></select>
              </Field>
              <SubmitButton>Post payment</SubmitButton>
            </ActionForm>
            <form action={cancelPlanAction.bind(null, active.plan.id, patientId)} className="mt-3">
              <button className="text-xs font-semibold text-slate-500 hover:text-red-700">Cancel plan</button>
            </form>
          </>
        ) : balance <= 0 ? (
          <Empty>No patient balance, so no plan is needed.</Empty>
        ) : (
          <ActionForm action={createPlanAction.bind(null, patientId)} className="grid grid-cols-2 gap-3">
            <Field label="Plan total ($)"><input name="total" type="number" step="0.01" min="1" max={(balance / 100).toFixed(2)} defaultValue={(balance / 100).toFixed(2)} className="input" required /></Field>
            <Field label="Installments">
              <select name="count" className="select" defaultValue="3">{[2, 3, 4, 6, 9, 12].map((n) => <option key={n} value={n}>{n}</option>)}</select>
            </Field>
            <Field label="Frequency">
              <select name="frequency" className="select"><option value="monthly">Monthly</option><option value="biweekly">Every two weeks</option></select>
            </Field>
            <Field label="First payment"><input name="startDate" type="date" defaultValue={todayIso} className="input" required /></Field>
            <Field label="Note" className="col-span-2"><input name="note" className="input" placeholder="Optional" /></Field>
            <div className="col-span-2"><SubmitButton>Create payment plan</SubmitButton></div>
          </ActionForm>
        )}
        {plans.filter((p) => p !== active).length > 0 && (
          <p className="mt-4 text-xs text-slate-500">
            Earlier plans: {plans.filter((p) => p !== active).map((p) => `${money(p.plan.totalCents)} ${p.plan.status}`).join(" · ")}
          </p>
        )}
      </Card>

      <Card title="Discounts">
        <p className="mb-3 text-sm text-slate-600">
          Current patient balance <span className="font-semibold"><Money cents={balance} /></span>. A discount posts to the ledger with its policy, so it stays on the record.
        </p>
        {policies.length === 0 ? (
          <Empty>No active discount policies.</Empty>
        ) : (
          <ActionForm action={applyDiscountAction.bind(null, patientId)} className="flex flex-wrap items-end gap-2">
            <Field label="Policy">
              <select name="policyId" className="select" disabled={balance <= 0}>
                {policies.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.percent}%) · saves {money(Math.round((balance * p.percent) / 100))}</option>
                ))}
              </select>
            </Field>
            <SubmitButton className="btn btn-secondary">Apply discount</SubmitButton>
          </ActionForm>
        )}
      </Card>

      <Card
        title="Statements"
        actions={
          <ActionForm action={generateStatementAction.bind(null, patientId)}>
            <SubmitButton className="btn btn-secondary text-xs" pendingLabel="Generating...">Generate statement</SubmitButton>
          </ActionForm>
        }
      >
        {statements.length === 0 ? (
          <Empty>No statements yet.</Empty>
        ) : (
          <table className="table">
            <thead><tr><th>Statement</th><th>Date</th><th>Due</th><th className="text-right">Amount due</th><th>Status</th></tr></thead>
            <tbody>
              {statements.map(({ statement: st }) => (
                <tr key={st.id}>
                  <td><Link href={`/statements/${st.id}`} className="font-mono text-brand-700 hover:underline">{st.statementNumber}</Link></td>
                  <td>{fmtDate(st.statementDate + "T00:00:00")}</td>
                  <td>{fmtDate(st.dueDate + "T00:00:00")}</td>
                  <td className="text-right"><Money cents={st.amountDueCents} /></td>
                  <td><Badge tone={st.status === "sent" ? "green" : st.status === "void" ? "slate" : "blue"}>{st.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card
        title="Estimates"
        actions={<Link href={`/estimates/new?patientId=${patientId}`} className="btn btn-secondary text-xs">New estimate</Link>}
      >
        {estimates.length === 0 ? (
          <Empty>No estimates yet. Quote the patient&apos;s cost before a planned service.</Empty>
        ) : (
          <table className="table">
            <thead><tr><th>Estimate</th><th>Kind</th><th>Created</th><th className="text-right">Patient owes</th></tr></thead>
            <tbody>
              {estimates.map((e) => (
                <tr key={e.id}>
                  <td><Link href={`/estimates/${e.id}`} className="font-mono text-brand-700 hover:underline">{e.estimateNumber}</Link></td>
                  <td>{e.kind === "good_faith" ? <Badge tone="amber">Good faith</Badge> : <Badge tone="blue">Insured</Badge>}</td>
                  <td>{fmtDate(e.createdAt)}</td>
                  <td className="text-right font-semibold"><Money cents={e.patientOwesCents} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
