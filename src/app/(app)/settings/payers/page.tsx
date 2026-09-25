import Link from "next/link";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { listPayers } from "@/server/encounters";
import { PAYER_TYPES } from "@/server/admin";
import { savePayerAction } from "@/app/(app)/admin-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

type P = { name: string; payerId: string; type: string; timelyFilingDays: number; appealDays: number };

function PayerFields({ p }: { p?: P }) {
  return (
    <div className="grid gap-2 sm:grid-cols-5">
      <input name="name" defaultValue={p?.name} placeholder="Payer name" className="input sm:col-span-2" required />
      <input name="payerId" defaultValue={p?.payerId} placeholder="Payer ID" className="input font-mono" required />
      <select name="type" defaultValue={p?.type ?? "commercial"} className="input">{PAYER_TYPES.map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}</select>
      <div className="grid grid-cols-2 gap-2">
        <input name="timelyFilingDays" type="number" min={30} max={730} defaultValue={p?.timelyFilingDays ?? 90} className="input" title="Timely filing days" aria-label="Timely filing days" />
        <input name="appealDays" type="number" min={15} max={365} defaultValue={p?.appealDays ?? 60} className="input" title="Appeal window days" aria-label="Appeal window days" />
      </div>
    </div>
  );
}

export default async function PayersPage() {
  const s = await requireSession();
  const payers = await listPayers(await getDb(), s.practiceId);
  const admin = s.role === "admin";

  return (
    <>
      <PageHeader title="Payers" subtitle="Clearinghouse payer IDs and the deadlines follow-up, timely filing and appeals are measured against" actions={<span className="flex gap-2"><Link href="/settings/payer-edits" className="btn btn-secondary">Payer edits</Link><Link href="/settings/enrollment" className="btn btn-secondary">Enrollment</Link></span>} />
      {admin && (
        <Card title="Add a payer" className="mb-6">
          <ActionForm action={savePayerAction.bind(null, null)} className="space-y-3">
            <PayerFields />
            <p className="text-xs text-slate-500">Last two boxes: timely filing days and appeal window days. Use the payer ID your clearinghouse lists for this payer.</p>
            <SubmitButton pendingLabel="Adding...">Add payer</SubmitButton>
          </ActionForm>
        </Card>
      )}
      <Card>
        <table className="table">
          <thead><tr><th>Payer</th><th>Payer ID</th><th>Type</th><th className="text-right">Timely filing</th><th className="text-right">Appeal window</th><th /></tr></thead>
          <tbody>
            {payers.map((p) => (
              <tr key={p.id}>
                <td className="font-medium">{p.name}</td>
                <td className="font-mono">{p.payerId}</td>
                <td className="capitalize">{p.type.replace("_", " ")}</td>
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
        </table>
      </Card>
    </>
  );
}
