import type { Metadata } from "next";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { listProviders } from "@/server/encounters";
import { providerActiveAction, saveProviderAction } from "@/app/(app)/admin-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, PageHeader } from "@/components/ui";
import { TaxonomyInput } from "@/components/code-pickers";
import { NpiLookup } from "@/components/npi-lookup";
import { CREDENTIALS, NPP_85 } from "@/lib/codes/credentials";

export const metadata: Metadata = { title: "Providers" };

export const dynamic = "force-dynamic";

type P = { firstName: string; lastName: string; npi: string; taxonomy: string; specialty: string; credential: string | null };

function ProviderFields({ p }: { p?: P }) {
  return (
    <div className="grid gap-2 sm:grid-cols-6">
      <input name="firstName" defaultValue={p?.firstName} placeholder="First name" className="input" required />
      <input name="lastName" defaultValue={p?.lastName} placeholder="Last name" className="input" required />
      <input name="npi" defaultValue={p?.npi} placeholder="NPI (Type 1)" className="input font-mono" maxLength={10} inputMode="numeric" required />
      <TaxonomyInput defaultValue={p?.taxonomy} className="input font-mono" required id={`taxonomy-${p?.npi ?? "new"}`} placeholder="Taxonomy: type a specialty or code" />
      <input name="specialty" defaultValue={p?.specialty} placeholder="Specialty" className="input" required />
      <select name="credential" defaultValue={p?.credential ?? ""} className="input" aria-label="Credential">
        <option value="">Credential...</option>
        {CREDENTIALS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
      </select>
      <div className="sm:col-span-6"><NpiLookup fill={{ firstName: "firstName", lastName: "lastName", taxonomy: "taxonomy", specialty: "specialty" }} /></div>
    </div>
  );
}

export default async function ProvidersPage() {
  const s = await requireSession();
  const providers = await listProviders(await getDb(), s.practiceId, true);
  const admin = s.role === "admin";
  const active = providers.filter((p) => p.active).length;

  return (
    <>
      <PageHeader title="Providers" subtitle={`${active} active, ${providers.length - active} inactive · the rendering provider on each claim`} />
      {admin && (
        <Card title="Add a provider" className="mb-6">
          <ActionForm action={saveProviderAction.bind(null, null)} className="space-y-3">
            <ProviderFields />
            <SubmitButton pendingLabel="Adding...">Add provider</SubmitButton>
          </ActionForm>
        </Card>
      )}
      <Card>
        <div tabIndex={0} role="region" aria-label="Table (scrolls sideways)" className="overflow-x-auto"><table className="table">
          <thead><tr><th>Provider</th><th>Credential</th><th>NPI</th><th>Taxonomy</th><th>Specialty</th><th>Status</th><th /></tr></thead>
          <tbody>
            {providers.map((p) => (
              <tr key={p.id} className={p.active ? "" : "opacity-60"}>
                <td className="font-medium">{p.lastName}, {p.firstName}</td>
                <td>{p.credential ?? ""}{p.credential && NPP_85.has(p.credential) ? <span className="block text-xs text-slate-500">Medicare 85% own NPI</span> : null}</td>
                <td className="font-mono">{p.npi}</td>
                <td className="font-mono">{p.taxonomy}</td>
                <td>{p.specialty}</td>
                <td>{p.active ? <Badge tone="green">active</Badge> : <Badge>inactive</Badge>}</td>
                <td className="text-right">
                  {admin && (
                    <div className="flex items-start justify-end gap-2">
                      <details className="text-left">
                        <summary className="btn btn-secondary cursor-pointer px-2 py-1 text-xs">Edit</summary>
                        <ActionForm action={saveProviderAction.bind(null, p.id)} className="mt-2 w-[42rem] max-w-[80vw] space-y-2 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
                          <ProviderFields p={p} />
                          <SubmitButton className="btn btn-primary text-xs" pendingLabel="Saving...">Save</SubmitButton>
                        </ActionForm>
                      </details>
                      <ActionForm action={providerActiveAction.bind(null, p.id, !p.active)}>
                        <SubmitButton className="btn btn-secondary px-2 py-1 text-xs" pendingLabel="...">{p.active ? "Deactivate" : "Reactivate"}</SubmitButton>
                      </ActionForm>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <p className="mt-3 text-xs text-slate-500">Inactive providers stay on their past claims but leave charge entry and scheduling. NPIs are checked against their check digit. The credential sets what Medicare&apos;s fee schedule pays: nurse practitioners, physician assistants and clinical nurse specialists billing under their own NPI are paid 85%.</p>
      </Card>
    </>
  );
}
