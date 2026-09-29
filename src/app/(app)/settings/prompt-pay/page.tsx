import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { US_STATES } from "@/lib/us";
import { listPromptPayRules } from "@/server/prompt-pay";
import { deletePromptPayRuleAction, savePromptPayRuleAction } from "@/app/(app)/prompt-pay-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, Empty, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Prompt-pay law" };
export const dynamic = "force-dynamic";

export default async function PromptPayPage() {
  const s = await requireSession();
  const rules = await listPromptPayRules(await getDb(), s.practiceId);
  const admin = s.role === "admin";
  return (
    <>
      <PageHeader title="Prompt-pay law" subtitle="How fast your state requires commercial insurers to pay a clean claim, and the interest when they are late" actions={<Link href="/underpayments" className="btn btn-secondary">Underpayments</Link>} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Your state's statute" className="lg:col-span-2">
          {rules.length === 0 ? <Empty>Not set up. Enter your state&apos;s prompt-pay statute to see which commercial payments were late and the interest owed.</Empty> : (
            <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-700">
              {rules.map((r) => (
                <li key={r.state} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span><span className="font-semibold">{r.state}</span>: {r.days} days, {r.annualRatePct}% a year{r.citation ? ` · ${r.citation}` : ""}</span>
                  {admin && <ActionForm action={deletePromptPayRuleAction.bind(null, r.state)}><SubmitButton className="btn btn-secondary text-xs" pendingLabel="...">Remove</SubmitButton></ActionForm>}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
            The practice&apos;s state (on the practice profile) is used. Payment time is counted from the day the claim was submitted to the first payment, and interest is simple interest on the amount paid.
            Statutes differ: some count from the payer&apos;s receipt, give paper claims longer, or compound. Self-funded employer plans (ERISA) are not subject to state prompt-pay law, and Medicare and Medicaid are left out. Read the statute before asking.
          </p>
        </Card>
        {admin && (
          <Card title="Enter a statute">
            <ActionForm action={savePromptPayRuleAction} className="space-y-3 text-sm">
              <label className="block"><span className="label">State</span>
                <select name="state" className="select" required>{US_STATES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select>
              </label>
              <label className="block"><span className="label">Days to pay a clean electronic claim</span><input name="days" type="number" min={1} max={365} className="input" required /></label>
              <label className="block"><span className="label">Interest, percent a year</span><input name="rate" inputMode="decimal" className="input" required /></label>
              <label className="block"><span className="label">Citation</span><input name="citation" className="input" placeholder="The statute's section number" /></label>
              <SubmitButton pendingLabel="Saving...">Save</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
