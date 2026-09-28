import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireSession } from "@/lib/auth";
import { scheduleRates, standardCharges } from "@/server/fees";
import { importContractAction, saveContractTermsAction, saveScheduleAction } from "@/app/(app)/fees-actions";
import { formatModifierRules } from "@/server/contracts";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, PageHeader } from "@/components/ui";
import { money } from "@/lib/utils";

export const metadata: Metadata = { title: "Fee schedule" };

export const dynamic = "force-dynamic";

export default async function FeeScheduleEditor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireSession();
  const db = await getDb();
  const [schedule] = await db
    .select()
    .from(schema.feeSchedules)
    .where(and(eq(schema.feeSchedules.id, id), eq(schema.feeSchedules.practiceId, s.practiceId)))
    .limit(1);
  if (!schedule) notFound();

  const mpprCodes = new Set((await db.select({ cpt: schema.feeScheduleItems.cpt }).from(schema.feeScheduleItems).where(and(eq(schema.feeScheduleItems.feeScheduleId, schedule.id), eq(schema.feeScheduleItems.mppr, true)))).map((r) => r.cpt));
  const [codes, rates, standard] = await Promise.all([
    db.select().from(schema.cptCodes).orderBy(asc(schema.cptCodes.code)),
    scheduleRates(db, schedule.id),
    standardCharges(db, s.practiceId),
  ]);
  const isContract = schedule.payerId !== null;
  const admin = s.role === "admin";

  return (
    <>
      <PageHeader
        title={schedule.name}
        subtitle={
          isContract
            ? "Contracted allowed amounts. Paid claims allowed below these are flagged as underpayments."
            : "Standard charges. Charge entry prices new claims from these."
        }
        actions={<Link href="/settings/fees" className="btn btn-secondary">All schedules</Link>}
      />
      {isContract && (
        <div className="mb-6 grid gap-6 lg:grid-cols-2">
          <Card title="Load the contract from a spreadsheet">
            <ActionForm action={importContractAction.bind(null, schedule.id)} className="space-y-3 text-sm">
              <p className="text-slate-600">A CSV with a code column (CPT, HCPCS or Code) and an allowed amount column (Allowed, Rate or Fee). An optional column named MPPR or Mult Proc marks codes subject to the multiple-procedure reduction (Y, 1, or the Medicare indicator 2 or 3).</p>
              <input type="file" name="file" accept=".csv,text/csv,text/plain" className="block text-sm" disabled={!admin} aria-label="Contract spreadsheet" />
              <label className="flex items-center gap-2"><input type="checkbox" name="replace" defaultChecked disabled={!admin} /> Replace every rate (codes not in the file are removed)</label>
              {admin && <SubmitButton pendingLabel="Loading...">Load contract</SubmitButton>}
            </ActionForm>
          </Card>
          <Card title="Contract terms">
            <ActionForm action={saveContractTermsAction.bind(null, schedule.id)} className="space-y-3 text-sm">
              <label className="block"><span className="label">Multiple-procedure reduction: % paid for each additional procedure (Medicare pays 50; blank for none)</span>
                <input name="mpprPercent" type="number" min="0" max="100" step="0.1" defaultValue={schedule.rules?.mpprPercent ?? ""} className="input w-32" disabled={!admin} /></label>
              <label className="block"><span className="label">Modifier percentages of the rate, like 50=150, 80=16, 62=62.5</span>
                <input name="modifiers" defaultValue={formatModifierRules(schedule.rules?.modifiers)} className="input font-mono" disabled={!admin} /></label>
              <p className="text-xs text-slate-500">{mpprCodes.size} code{mpprCodes.size === 1 ? " is" : "s are"} marked for the reduction. Underpayment checks pay the highest one in full and the rest at this percentage. Check the percentages against your contract; payers differ.</p>
              {admin && <SubmitButton pendingLabel="Saving...">Save terms</SubmitButton>}
            </ActionForm>
          </Card>
        </div>
      )}
      <Card>
        <form action={saveScheduleAction.bind(null, schedule.id)}>
          <div tabIndex={0} role="region" aria-label="Table (scrolls sideways)" className="overflow-x-auto"><table className="table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Description</th>
                {isContract && <th className="text-right">Standard charge</th>}
                <th className="text-right">{isContract ? "Contracted allowed" : "Charge"}</th>
                {isContract && <th className="text-right">% of charge</th>}
              </tr>
            </thead>
            <tbody>
              {codes.map((c) => {
                const amt = rates.get(c.code);
                const std = standard.get(c.code) ?? c.defaultFeeCents;
                return (
                  <tr key={c.code}>
                    <td className="font-mono">{c.code}{mpprCodes.has(c.code) && <span className="ml-1 rounded bg-slate-100 px-1 text-[10px] font-sans text-slate-600" title="Subject to the multiple-procedure reduction">MPPR</span>}</td>
                    <td>{c.description}</td>
                    {isContract && <td className="text-right tabular-nums text-slate-500">{money(std)}</td>}
                    <td className="text-right">
                      <input
                        name={`amt_${c.code}`}
                        type="number"
                        step="0.01"
                        min="0"
                        defaultValue={amt !== undefined ? (amt / 100).toFixed(2) : ""}
                        placeholder={isContract ? "No contract rate" : (c.defaultFeeCents / 100).toFixed(2)}
                        className="input ml-auto w-36 text-right"
                        disabled={!admin}
                      />
                    </td>
                    {isContract && (
                      <td className="text-right tabular-nums text-slate-500">
                        {amt !== undefined && std > 0 ? `${Math.round((amt / std) * 100)}%` : "-"}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table></div>
          {admin && (
            <div className="mt-4 flex items-center justify-between gap-4">
              <p className="text-xs text-slate-500">
                Leave a code blank to remove it.{" "}
                {isContract
                  ? "A claim with any uncontracted code is not judged for underpayment."
                  : "Blank codes fall back to the default fee."}
              </p>
              <button className="btn btn-primary">Save schedule</button>
            </div>
          )}
        </form>
      </Card>
    </>
  );
}
