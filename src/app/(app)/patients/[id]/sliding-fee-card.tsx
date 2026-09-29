import { recordSlidingFeeAction } from "@/app/(app)/sliding-fee-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card } from "@/components/ui";
import { fmtDate, money } from "@/lib/utils";
import type { slidingFeeOf } from "@/server/sliding-fee";

/** The patient's sliding fee eligibility, and the form to verify income. */
export function SlidingFeeCard({ patientId, fee, canWrite }: { patientId: string; fee: Awaited<ReturnType<typeof slidingFeeOf>>; canWrite: boolean }) {
  const today = new Date().toISOString().slice(0, 10);
  const current = fee && fee.expiresOn >= today;
  return (
    <Card title="Sliding fee scale" actions={fee ? <Badge tone={current ? (fee.discountPercent ? "green" : "slate") : "amber"}>{current ? (fee.discountPercent ? `${fee.discountPercent}% off` : "Above the scale") : "Expired"}</Badge> : undefined}>
      {fee && (
        <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">
          Household of {fee.householdSize}, {money(fee.annualIncomeCents)} a year: {fee.percentOfPoverty}% of the poverty guideline. Verified {fmtDate(fee.verifiedOn)} ({fee.proof}), good until {fmtDate(fee.expiresOn)}.
        </p>
      )}
      {canWrite && (
        <details>
          <summary className="cursor-pointer text-sm font-medium text-brand-700 dark:text-brand-300">{fee ? "Verify income again" : "Verify income"}</summary>
          <ActionForm action={recordSlidingFeeAction.bind(null, patientId)} className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <label className="block"><span className="label">Household size</span><input name="household" type="number" min={1} max={20} className="input" required /></label>
            <label className="block"><span className="label">Yearly household income ($)</span><input name="income" inputMode="decimal" className="input" required /></label>
            <label className="block"><span className="label">Proof seen</span><input name="proof" className="input" placeholder="2025 tax return" required /></label>
            <label className="block"><span className="label">Verified on</span><input type="date" name="verifiedOn" className="input" defaultValue={today} max={today} required /></label>
            <div className="sm:col-span-2"><SubmitButton pendingLabel="Saving...">Save and apply</SubmitButton></div>
          </ActionForm>
        </details>
      )}
    </Card>
  );
}
