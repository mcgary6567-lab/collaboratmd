import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { legacySummary, listLegacy } from "@/server/legacy-ar";
import { closeLegacyAction, importLegacyAction } from "@/app/(app)/legacy-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, Empty, Money, PageHeader, PatientLink, Stat } from "@/components/ui";
import { fmtDate, money } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function LegacyArPage() {
  const s = await requireSession();
  const db = await getDb();
  const [summary, open] = await Promise.all([legacySummary(db, s.practiceId), listLegacy(db, s.practiceId)]);
  const sum = (resp: string, status: string) => summary.filter((x) => x.responsibility === resp && x.status === status).reduce((a, x) => a + x.cents, 0);
  const canAdjust = ["admin", "biller"].includes(s.role);

  return (
    <>
      <PageHeader title="Balances from your previous system" subtitle="Open A/R carried over when switching to CollaboratMD: patient balances move onto the ledger, insurance balances are worked here until they close" />
      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <Stat label="Insurance still open" value={money(sum("insurance", "open"))} hint={`${open.length} items to work`} />
        <Stat label="Insurance collected" value={money(sum("insurance", "collected"))} tone="good" />
        <Stat label="Insurance written off" value={money(sum("insurance", "written_off"))} />
        <Stat label="Patient opening balances" value={money(sum("patient", "open"))} hint="On the ledger: statements and the portal collect them" />
      </div>
      {s.role === "admin" && (
        <Card title="Import open balances" className="mb-6">
          <ActionForm action={importLegacyAction} className="flex flex-wrap items-end gap-3 text-sm">
            <label className="block">CSV file<input type="file" name="file" accept=".csv,text/csv" className="mt-1 block text-xs" required /></label>
            <label className="block">Batch name<input name="batch" className="input mt-1 w-56" placeholder="e.g. AdvancedMD cutover" /></label>
            <SubmitButton pendingLabel="Importing...">Import</SubmitButton>
          </ActionForm>
          <p className="mt-3 text-xs text-slate-500">
            One row per open item. Columns (header names are matched loosely): <span className="font-mono">MRN</span> or <span className="font-mono">Last name, First name, DOB</span>; <span className="font-mono">Balance</span>; and optionally <span className="font-mono">Payer, Claim number, DOS, Billed, Responsibility</span> (patient or insurance; rows with no payer count as patient).
            Import patients first. Each batch name can be used once, so a file cannot be imported twice by accident.
          </p>
        </Card>
      )}
      <Card title="Insurance balances to work">
        {open.length === 0 ? <Empty>No open insurance balances from a previous system.</Empty> : (
          <table className="table">
            <thead><tr><th>Patient</th><th>Payer</th><th>Old claim</th><th>Service date</th><th className="text-right">Balance</th><th /></tr></thead>
            <tbody>
              {open.map(({ item: i, first, last }) => (
                <tr key={i.id}>
                  <td><PatientLink id={i.patientId} first={first} last={last} /></td>
                  <td>{i.payerName ?? "-"}</td>
                  <td className="font-mono text-xs">{i.sourceClaimNumber ?? "-"}</td>
                  <td>{i.dateOfService ? fmtDate(`${i.dateOfService}T00:00:00`) : "-"}</td>
                  <td className="text-right"><Money cents={i.balanceCents} /></td>
                  <td className="whitespace-nowrap text-right">
                    {canAdjust && (
                      <div className="flex justify-end gap-2">
                        <ActionForm action={closeLegacyAction.bind(null, i.id, "collected")}><SubmitButton className="btn btn-secondary px-2 py-1 text-xs" pendingLabel="...">Collected</SubmitButton></ActionForm>
                        <ActionForm action={closeLegacyAction.bind(null, i.id, "written_off")}><SubmitButton className="btn btn-secondary px-2 py-1 text-xs" pendingLabel="...">Write off</SubmitButton></ActionForm>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
