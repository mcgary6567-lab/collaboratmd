import type { Metadata } from "next";
import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireSession } from "@/lib/auth";
import { listSchedules, standardCharges } from "@/server/fees";
import { listPracticeCodes } from "@/server/code-catalog";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { createContractAction, importPracticeCodesAction, removePracticeCodeAction } from "@/app/(app)/fees-actions";
import { Alert, Badge, Card, Empty, Field, PageHeader } from "@/components/ui";
import { fmtDate, money } from "@/lib/utils";

export const metadata: Metadata = { title: "Fee schedules" };

export const dynamic = "force-dynamic";

export default async function FeeSchedulesPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const s = await requireSession();
  const db = await getDb();
  const [schedules, payers, own, standard] = await Promise.all([
    listSchedules(db, s.practiceId),
    db.select().from(schema.payers).where(eq(schema.payers.practiceId, s.practiceId)).orderBy(asc(schema.payers.name)),
    listPracticeCodes(db, s.practiceId),
    standardCharges(db, s.practiceId),
  ]);
  const contracted = new Set(schedules.map((r) => r.schedule.payerId).filter(Boolean));
  const uncontracted = payers.filter((p) => !contracted.has(p.id));
  const hasStandard = schedules.some((r) => r.schedule.payerId === null);
  const admin = s.role === "admin";

  return (
    <>
      <PageHeader
        title="Fee schedules"
        subtitle="What the practice charges, and what each payer contract says it should be paid"
        actions={<Link href="/settings" className="btn btn-secondary">Back to settings</Link>}
      />
      {error && <Alert kind="error">{error}</Alert>}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Schedules on file" className="lg:col-span-2">
          {schedules.length === 0 ? (
            <Empty>No schedules yet. Charges use each code&apos;s default fee until a standard schedule exists.</Empty>
          ) : (
            <div tabIndex={0} role="region" aria-label="Table (scrolls sideways)" className="overflow-x-auto"><table className="table">
              <thead>
                <tr><th>Schedule</th><th>Kind</th><th className="text-right">Codes</th><th>Effective</th><th /></tr>
              </thead>
              <tbody>
                {schedules.map(({ schedule, payerName, items }) => (
                  <tr key={schedule.id}>
                    <td className="font-medium">{schedule.name}</td>
                    <td>
                      {payerName ? <Badge tone="blue">Contract · {payerName}</Badge> : <Badge tone="green">Standard charges</Badge>}
                    </td>
                    <td className="text-right tabular-nums">{items}</td>
                    <td>{fmtDate(schedule.effectiveFrom + "T00:00:00")}</td>
                    <td className="text-right">
                      <Link href={`/settings/fees/${schedule.id}`} className="text-sm font-semibold text-brand-700 hover:underline">
                        {admin ? "Edit" : "View"}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </Card>

        <Card title="Add a schedule">
          {!admin ? (
            <p className="text-sm text-slate-600">Only an administrator can create or change fee schedules.</p>
          ) : (
            <div className="space-y-6">
              {!hasStandard && (
                <form action={createContractAction} className="space-y-3">
                  <input type="hidden" name="payerId" value="" />
                  <p className="text-sm text-slate-600">
                    Start with a standard schedule. It sets what the practice bills, and payer contracts are built from it.
                  </p>
                  <button className="btn btn-primary w-full justify-center">Create standard schedule</button>
                </form>
              )}
              <form action={createContractAction} className="space-y-3">
                <p className="text-sm text-slate-600">
                  Most contracts are written as a percentage of Medicare or of your standard charges. Start there, then adjust individual codes.
                </p>
                <Field label="Payer">
                  <select name="payerId" className="select" required disabled={uncontracted.length === 0}>
                    {uncontracted.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </Field>
                <fieldset className="space-y-1 text-sm">
                  <legend className="label">Allowed amounts as a percentage of</legend>
                  <label className="flex items-center gap-2"><input type="radio" name="basis" value="medicare" defaultChecked /> Medicare&apos;s fee schedule in your locality</label>
                  <label className="flex items-center gap-2"><input type="radio" name="basis" value="charges" /> Your standard charges</label>
                </fieldset>
                <Field label="Percent">
                  <input name="percent" type="number" min="1" max="500" step="0.5" defaultValue="120" className="input" required />
                </Field>
                <button className="btn btn-primary w-full justify-center" disabled={uncontracted.length === 0}>
                  {uncontracted.length === 0 ? "Every payer has a contract" : "Create contract"}
                </button>
              </form>
            </div>
          )}
        </Card>
      </div>

      <div className="mt-6">
        <Card title={`Your procedure codes · ${own.length}`}>
          <p className="mb-3 text-sm text-slate-600">
            Codes you bill beyond the built-in list, described in your own words. They appear in charge entry, estimates and every fee schedule.
            CPT descriptions themselves belong to the American Medical Association and are not supplied here.
          </p>
          {admin && (
            <ActionForm action={importPracticeCodesAction} className="mb-4 flex flex-wrap items-end gap-3 text-sm">
              <label className="block"><span className="label">CSV with code, description and (optionally) fee</span><input type="file" name="file" accept=".csv,.txt" className="input" required /></label>
              <SubmitButton pendingLabel="Adding...">Add codes</SubmitButton>
            </ActionForm>
          )}
          {own.length === 0 ? <Empty>No codes of your own yet. Most practices export their procedure list with fees from their current system and add it here.</Empty> : (
            <div tabIndex={0} role="region" aria-label="Table (scrolls sideways)" className="max-h-96 overflow-auto"><table className="table">
              <thead><tr><th>Code</th><th>Description</th><th className="text-right">Standard charge</th>{admin && <th />}</tr></thead>
              <tbody>{own.map((c) => (
                <tr key={c.code}>
                  <td className="font-mono">{c.code}</td>
                  <td>{c.description}</td>
                  <td className="text-right tabular-nums">{standard.has(c.code) ? money(standard.get(c.code)!) : "-"}</td>
                  {admin && <td className="text-right"><ActionForm action={removePracticeCodeAction.bind(null, c.code)}><SubmitButton className="btn btn-secondary text-xs" pendingLabel="...">Remove</SubmitButton></ActionForm></td>}
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>
      </div>
    </>
  );
}
