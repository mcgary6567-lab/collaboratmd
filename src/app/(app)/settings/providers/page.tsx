import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { listProviders } from "@/server/encounters";
import { providerActiveAction, saveProviderAction } from "@/app/(app)/admin-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

type P = { firstName: string; lastName: string; npi: string; taxonomy: string; specialty: string };

function ProviderFields({ p }: { p?: P }) {
  return (
    <div className="grid gap-2 sm:grid-cols-5">
      <input name="firstName" defaultValue={p?.firstName} placeholder="First name" className="input" required />
      <input name="lastName" defaultValue={p?.lastName} placeholder="Last name" className="input" required />
      <input name="npi" defaultValue={p?.npi} placeholder="NPI (Type 1)" className="input font-mono" maxLength={10} inputMode="numeric" required />
      <input name="taxonomy" defaultValue={p?.taxonomy} placeholder="Taxonomy, e.g. 207Q00000X" className="input font-mono" maxLength={10} required />
      <input name="specialty" defaultValue={p?.specialty} placeholder="Specialty" className="input" required />
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
        <table className="table">
          <thead><tr><th>Provider</th><th>NPI</th><th>Taxonomy</th><th>Specialty</th><th>Status</th><th /></tr></thead>
          <tbody>
            {providers.map((p) => (
              <tr key={p.id} className={p.active ? "" : "opacity-60"}>
                <td className="font-medium">{p.lastName}, {p.firstName}</td>
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
        </table>
        <p className="mt-3 text-xs text-slate-500">Inactive providers stay on their past claims but leave charge entry and scheduling. NPIs are checked against their check digit.</p>
      </Card>
    </>
  );
}
