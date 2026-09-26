import type { ReactNode } from "react";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireSession } from "@/lib/auth";
import { getPolicies } from "@/server/policies";
import { runSmallBalancesAction, saveFinancingAction, savePoliciesAction } from "@/app/(app)/admin-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

const dollars = (c: number | null | undefined) => (c === null || c === undefined ? "" : (c / 100).toFixed(2));

function Rule({ title, where, children }: { title: string; where: string; children: ReactNode }) {
  return (
    <div className="grid gap-3 border-b border-slate-100 py-4 last:border-0 md:grid-cols-5">
      <div className="md:col-span-2">
        <p className="font-semibold text-slate-900">{title}</p>
        <p className="mt-0.5 text-xs text-slate-500">{where}</p>
      </div>
      <div className="space-y-2 text-sm md:col-span-3">{children}</div>
    </div>
  );
}

export default async function PoliciesPage() {
  const s = await requireSession();
  const db = await getDb();
  const [p, [{ financing }]] = await Promise.all([getPolicies(db, s.practiceId), db.select({ financing: schema.practices.financing }).from(schema.practices).where(eq(schema.practices.id, s.practiceId)).limit(1)]);
  const admin = s.role === "admin";

  return (
    <>
      <PageHeader title="Billing policies" subtitle="Rules the whole team works within. Each is enforced where the action happens, applies immediately, and every change is recorded in the audit log." />
      <ActionForm action={savePoliciesAction} className="space-y-6">
        <fieldset disabled={!admin} className="space-y-6">
          <Card title="Approvals and limits">
            <Rule title="Write-off limit" where="Claim write-offs and denial-agent write-offs. Administrators are not limited.">
              <label className="flex items-center gap-2"><input type="checkbox" name="writeOffLimitOn" defaultChecked={p.writeOffLimitCents != null} /> Billers may write off up to</label>
              <div className="flex items-center gap-2"><span>$</span><input name="writeOffLimit" inputMode="decimal" defaultValue={dollars(p.writeOffLimitCents) || "500.00"} className="input w-32" /> <span className="text-slate-500">per claim; above that an administrator does it</span></div>
            </Rule>
            <Rule title="Two-person refunds" where="Refunds of patient credits and insurance overpayments.">
              <label className="flex items-center gap-2"><input type="checkbox" name="refundDualControl" defaultChecked={!!p.refundDualControl} /> The person who requests a refund cannot also approve it</label>
            </Rule>
            <Rule title="Exports" where="CSV downloads everywhere, the report builder's export and the accounting journal.">
              <label className="flex items-center gap-2"><input type="checkbox" name="exportsAdminOnly" defaultChecked={!!p.exportsAdminOnly} /> Only administrators can download exports</label>
            </Rule>
          </Card>

          <Card title="Claim quality">
            <Rule title="Strict scrubbing" where="Every claim's scrub, and submission.">
              <label className="flex items-center gap-2"><input type="checkbox" name="strictScrub" defaultChecked={!!p.strictScrub} /> Scrubber warnings block a claim, like errors</label>
              <p className="text-xs text-slate-500">Warnings include NCCI edits on commercial plans and Medicare coverage mismatches, as well as the general scrubber warnings.</p>
            </Rule>
            <Rule title="Denial risk hold" where="Submitting an original claim, by anyone but an administrator.">
              <label className="flex items-center gap-2"><input type="checkbox" name="riskHoldOn" defaultChecked={p.riskHoldScore != null} /> Hold claims whose denial risk score is</label>
              <div className="flex items-center gap-2"><input name="riskHoldScore" type="number" min={1} max={100} defaultValue={p.riskHoldScore ?? 60} className="input w-24" /> <span className="text-slate-500">or higher, for an administrator to review and send</span></div>
            </Rule>
          </Card>

          <Card title="Patient balances">
            <Rule title="Statements" where="The statement batch on Patient billing.">
              <div className="flex flex-wrap items-center gap-2">Bill balances of at least $<input name="statementMin" inputMode="decimal" defaultValue={dollars(p.statementMinCents ?? 500)} className="input w-28" /></div>
              <div className="flex flex-wrap items-center gap-2">and no more often than every <input name="statementIntervalDays" type="number" min={7} max={90} defaultValue={p.statementIntervalDays ?? 25} className="input w-20" /> days</div>
            </Rule>
            <Rule title="Small balance adjustments" where="Runs every morning with the daily automation, or now with the button below.">
              <label className="flex items-center gap-2"><input type="checkbox" name="smallBalanceOn" defaultChecked={p.smallBalanceCents != null} /> Adjust off patient balances under</label>
              <div className="flex flex-wrap items-center gap-2">$<input name="smallBalance" inputMode="decimal" defaultValue={dollars(p.smallBalanceCents) || "5.00"} className="input w-24" /> with no activity for <input name="smallBalanceAgeDays" type="number" min={30} max={730} defaultValue={p.smallBalanceAgeDays ?? 90} className="input w-20" /> days</div>
              <p className="text-xs text-slate-500">Posted as a discount with a note saying why, so the ledger shows every adjustment. Balances are never edited.</p>
            </Rule>
          </Card>
        </fieldset>
        {admin ? <SubmitButton pendingLabel="Saving...">Save policies</SubmitButton> : <p className="text-sm text-slate-500">An administrator sets these.</p>}
      </ActionForm>
      <Card title="Patient financing" className="mt-6">
        <p className="mb-3 text-sm text-slate-600">If the practice works with a patient financing lender, the portal offers it for balances at or above the minimum. Patients apply with the lender directly; nothing about them is sent to it from here.</p>
        <ActionForm action={saveFinancingAction} className="space-y-2 text-sm">
          <fieldset disabled={!admin} className="space-y-2">
            <label className="flex items-center gap-2"><input type="checkbox" name="financingOn" defaultChecked={!!financing} /> Offer financing in the patient portal</label>
            <div className="grid gap-2 md:grid-cols-3">
              <input name="lender" defaultValue={financing?.lender ?? ""} placeholder="Lender name" className="input" />
              <input name="url" defaultValue={financing?.url ?? ""} placeholder="https://... application link" className="input" />
              <div className="flex items-center gap-2">for balances of $<input name="min" inputMode="decimal" defaultValue={financing ? (financing.minCents / 100).toFixed(2) : "500.00"} className="input w-28" /> or more</div>
            </div>
          </fieldset>
          {admin && <SubmitButton className="btn btn-secondary" pendingLabel="Saving...">Save financing</SubmitButton>}
        </ActionForm>
      </Card>
      {admin && p.smallBalanceCents != null && (
        <ActionForm action={runSmallBalancesAction} className="mt-4">
          <SubmitButton className="btn btn-secondary" pendingLabel="Adjusting...">Adjust small balances now</SubmitButton>
        </ActionForm>
      )}
    </>
  );
}
