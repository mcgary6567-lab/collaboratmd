import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { listPayers } from "@/server/encounters";
import { PAYER_TYPE_LABEL, PAYER_TYPES } from "@/server/admin";
import { addDirectoryPayerAction, savePayerAction } from "@/app/(app)/admin-actions";
import { searchPayerDirectory, SUPPORT_LABEL, type DirectoryPayer } from "@/server/payer-directory";
import { practiceConfig } from "@/server/integrations";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Payers" };

export const dynamic = "force-dynamic";

type P = { name: string; payerId: string; type: string; timelyFilingDays: number; appealDays: number };

function PayerFields({ p }: { p?: P }) {
  return (
    <div className="grid gap-2 sm:grid-cols-5">
      <input name="name" defaultValue={p?.name} placeholder="Payer name" className="input sm:col-span-2" required />
      <input name="payerId" defaultValue={p?.payerId} placeholder="Payer ID" className="input font-mono" required />
      <select name="type" defaultValue={p?.type ?? "commercial"} className="input" aria-label="Payer type">{PAYER_TYPES.map((t) => <option key={t} value={t}>{PAYER_TYPE_LABEL[t] ?? t}</option>)}</select>
      <div className="grid grid-cols-2 gap-2">
        <input name="timelyFilingDays" type="number" min={30} max={730} defaultValue={p?.timelyFilingDays} className="input" title="Days to file from the date of service. Empty: 365 for Medicare, 90 otherwise" aria-label="Timely filing days" />
        <input name="appealDays" type="number" min={15} max={365} defaultValue={p?.appealDays} className="input" title="Days to appeal a denial. Empty: 120 for Medicare, 60 otherwise" aria-label="Appeal window days" />
      </div>
    </div>
  );
}

export default async function PayersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const s = await requireSession();
  const db = await getDb();
  const payers = await listPayers(db, s.practiceId);
  const admin = s.role === "admin";
  const stedi = !!(await practiceConfig(db, s.practiceId)).stedi;
  let found: DirectoryPayer[] = [];
  let searchError = "";
  if (admin && stedi && q.trim().length >= 2) {
    try { found = await searchPayerDirectory(db, s.practiceId, q); } catch (e) { searchError = e instanceof Error ? e.message : "Search failed"; }
  }
  const have = new Set(payers.map((p) => p.payerId.toUpperCase()));
  const label = (v: DirectoryPayer["claims"]) => (v ? SUPPORT_LABEL[v] : "unknown");

  return (
    <>
      <PageHeader title="Payers" subtitle="Clearinghouse payer IDs and the deadlines follow-up, timely filing and appeals are measured against" actions={<span className="flex gap-2"><Link href="/settings/payer-edits" className="btn btn-secondary">Payer edits</Link><Link href="/settings/enrollment" className="btn btn-secondary">Enrollment</Link></span>} />
      {admin && (
        <Card title="Find a payer in Stedi's directory" className="mb-6">
          {!stedi ? <p className="text-sm text-slate-600">Connect Stedi under Integrations to search its payer directory and pick payer IDs from it.</p> : (
            <>
              <form action="/settings/payers" className="flex gap-2">
                <input name="q" defaultValue={q} className="input max-w-sm" placeholder="Payer name or ID, e.g. Aetna or 60054" aria-label="Search the payer directory" />
                <button className="btn btn-secondary">Search</button>
              </form>
              {searchError && <p className="mt-2 text-sm text-red-700">{searchError}</p>}
              {q && !searchError && found.length === 0 && <p className="mt-2 text-sm text-slate-600">No payers match &quot;{q}&quot;.</p>}
              {found.length > 0 && (
                <div className="mt-3 overflow-x-auto">
                  <table className="table">
                    <thead><tr><th>Payer</th><th>Payer ID</th><th>Claims</th><th>ERA</th><th>Eligibility</th><th>EFT</th><th /></tr></thead>
                    <tbody>
                      {found.map((f) => (
                        <tr key={`${f.stediId}-${f.payerId}`}>
                          <td className="font-medium">{f.name}{f.aliases.length ? <div className="text-xs font-normal text-slate-500">also {f.aliases.slice(0, 3).join(", ")}</div> : null}</td>
                          <td className="font-mono">{f.payerId}</td>
                          <td>{label(f.claims)}</td><td>{label(f.era)}</td><td>{label(f.eligibility)}</td><td>{label(f.eft)}</td>
                          <td>
                            {have.has(f.payerId.toUpperCase()) ? <span className="text-xs text-slate-500">added</span> : (
                              <ActionForm action={addDirectoryPayerAction} className="flex items-center gap-1">
                                <input type="hidden" name="name" value={f.name} />
                                <input type="hidden" name="payerId" value={f.payerId} />
                                <input type="hidden" name="support" value={JSON.stringify({ claims: f.claims, era: f.era, eligibility: f.eligibility, eft: f.eft, claim_status: f.claimStatus })} />
                                <select name="type" defaultValue={/medicare/i.test(f.name) ? "medicare" : /medicaid/i.test(f.name) ? "medicaid" : "commercial"} className="input py-1 text-xs" aria-label="Payer type">{PAYER_TYPES.filter((t) => t !== "self_pay").map((t) => <option key={t} value={t}>{PAYER_TYPE_LABEL[t]}</option>)}</select>
                                <SubmitButton className="btn btn-secondary text-xs" pendingLabel="...">Add</SubmitButton>
                              </ActionForm>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-2 text-xs text-slate-500">&quot;After enrollment&quot; means the payer needs an enrollment form before that transaction works; adding the payer puts it on your enrollment list.</p>
                </div>
              )}
            </>
          )}
        </Card>
      )}
      {admin && (
        <Card title="Add a payer" className="mb-6">
          <ActionForm action={savePayerAction.bind(null, null)} className="space-y-3">
            <PayerFields />
            <p className="text-xs text-slate-500">Last two boxes: days to file and days to appeal. Leave them empty for the usual: 365 and 120 for Medicare, 90 and 60 otherwise. Use the payer ID your clearinghouse lists for this payer.</p>
            <SubmitButton pendingLabel="Adding...">Add payer</SubmitButton>
          </ActionForm>
        </Card>
      )}
      <Card>
        <div tabIndex={0} role="region" aria-label="Table (scrolls sideways)" className="overflow-x-auto"><table className="table">
          <thead><tr><th>Payer</th><th>Payer ID</th><th>Type</th><th className="text-right">Timely filing</th><th className="text-right">Appeal window</th><th /></tr></thead>
          <tbody>
            {payers.map((p) => (
              <tr key={p.id}>
                <td className="font-medium">{p.name}</td>
                <td className="font-mono">{p.payerId}</td>
                <td>{PAYER_TYPE_LABEL[p.type] ?? p.type}</td>
                <td className="text-right">{p.timelyFilingDays} days</td>
                <td className="text-right">{p.appealDays} days</td>
                <td className="text-right">
                  {admin && (
                    <details className="text-left">
                      <summary className="btn btn-secondary cursor-pointer px-2 py-1 text-xs">Edit</summary>
                      <ActionForm action={savePayerAction.bind(null, p.id)} className="mt-2 w-[44rem] max-w-[80vw] space-y-2 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
                        <PayerFields p={p} />
                        <SubmitButton className="btn btn-primary text-xs" pendingLabel="Saving...">Save</SubmitButton>
                      </ActionForm>
                    </details>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </Card>
    </>
  );
}
