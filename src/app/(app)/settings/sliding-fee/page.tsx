import type { Metadata } from "next";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { slidingFeeSetup } from "@/server/sliding-fee";
import { saveGuidelinesAction, saveTiersAction } from "@/app/(app)/sliding-fee-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, PageHeader } from "@/components/ui";
import { money } from "@/lib/utils";

export const metadata: Metadata = { title: "Sliding fee scale" };
export const dynamic = "force-dynamic";

const ROWS = 6;

export default async function SlidingFeePage() {
  const s = await requireSession();
  const { guidelines, tiers } = await slidingFeeSetup(await getDb(), s.practiceId);
  const admin = s.role === "admin";
  const latest = guidelines[0];
  return (
    <>
      <PageHeader title="Sliding fee scale" subtitle="Discounts by household income as a percent of the federal poverty guidelines, for health centers and charity care" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Poverty guidelines">
          {latest ? <p className="mb-3 text-sm">{latest.year}: {money(latest.baseCents)} for one person, plus {money(latest.perPersonCents)} for each additional person.</p> : <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">Not entered yet.</p>}
          <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">HHS publishes the guidelines each January (Alaska and Hawaii have their own). Enter the ones for your state; a patient is measured against the latest year on or before the day their income was verified.</p>
          {admin && (
            <ActionForm action={saveGuidelinesAction} className="grid gap-2 text-sm sm:grid-cols-3">
              <label className="block"><span className="label">Year</span><input name="year" inputMode="numeric" className="input" defaultValue={new Date().getUTCFullYear()} required /></label>
              <label className="block"><span className="label">Household of 1 ($)</span><input name="base" inputMode="decimal" className="input" required /></label>
              <label className="block"><span className="label">Each additional ($)</span><input name="perPerson" inputMode="decimal" className="input" required /></label>
              <div className="sm:col-span-3"><SubmitButton pendingLabel="Saving...">Save guidelines</SubmitButton></div>
            </ActionForm>
          )}
        </Card>
        <Card title="Discount tiers">
          <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">Each tier covers incomes up to its percent of the guideline. Enter your board-approved schedule, lowest first; households above the last tier get no discount.</p>
          {admin ? (
            <ActionForm action={saveTiersAction} className="space-y-2 text-sm">
              <div className="grid grid-cols-3 gap-2 text-xs font-semibold text-slate-600 dark:text-slate-400"><span>Up to % of guideline</span><span>Discount %</span><span>Label</span></div>
              {Array.from({ length: ROWS }, (_, i) => (
                <div key={i} className="grid grid-cols-3 gap-2">
                  <input name="maxPercent" type="number" min={0} max={1000} defaultValue={tiers[i]?.maxPercent ?? ""} className="input" aria-label={`Tier ${i + 1} up to percent`} />
                  <input name="discountPercent" type="number" min={0} max={100} defaultValue={tiers[i]?.discountPercent ?? ""} className="input" aria-label={`Tier ${i + 1} discount`} />
                  <input name="label" defaultValue={tiers[i]?.label ?? ""} className="input" aria-label={`Tier ${i + 1} label`} />
                </div>
              ))}
              <SubmitButton pendingLabel="Saving...">Save tiers</SubmitButton>
            </ActionForm>
          ) : (
            <ul className="text-sm">{tiers.map((t) => <li key={t.id}>Up to {t.maxPercent}%: {t.discountPercent}% off{t.label ? ` (${t.label})` : ""}</li>)}</ul>
          )}
        </Card>
      </div>
    </>
  );
}
