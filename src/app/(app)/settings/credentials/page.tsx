import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { listProviders } from "@/server/encounters";
import { credentialState, CREDENTIAL_KINDS, listCredentials } from "@/server/credentials";
import { deleteCredentialAction, saveCredentialAction } from "@/app/(app)/admin-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Empty, PageHeader, Stat } from "@/components/ui";
import { fmtDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

const TONE = { expired: "red", due: "amber", ok: "green" } as const;
const WORD = { expired: "expired", due: "renew soon", ok: "current" } as const;

export default async function CredentialsPage() {
  const s = await requireSession();
  const db = await getDb();
  const [rows, providers] = await Promise.all([listCredentials(db, s.practiceId), listProviders(db, s.practiceId)]);
  const canEdit = ["admin", "biller"].includes(s.role);
  const states = rows.map((r) => credentialState(r.c.expiresOn));

  return (
    <>
      <PageHeader title="Credentials" subtitle="Each provider's licenses and registrations. Administrators are notified 60 days before anything expires; an expired license or DEA registration gets claims denied." />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Expired" value={String(states.filter((x) => x === "expired").length)} tone={states.includes("expired") ? "bad" : "good"} />
        <Stat label="Due in 60 days" value={String(states.filter((x) => x === "due").length)} tone={states.includes("due") ? "bad" : "good"} />
        <Stat label="Current" value={String(states.filter((x) => x === "ok").length)} />
      </div>
      {canEdit && (
        <Card title="Add a credential" className="mb-6">
          <ActionForm action={saveCredentialAction} className="grid gap-2 text-sm md:grid-cols-4">
            <select name="providerId" className="input" required defaultValue="">
              <option value="" disabled>Provider</option>
              {providers.map((p) => <option key={p.id} value={p.id}>{p.lastName}, {p.firstName}</option>)}
            </select>
            <select name="kind" className="input" defaultValue="state_license">{Object.entries(CREDENTIAL_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <input name="identifier" className="input" placeholder="Number" />
            <input name="state" className="input" placeholder="State (licenses)" maxLength={2} />
            <label className="text-xs">Issued<input type="date" name="issuedOn" className="input mt-1" /></label>
            <label className="text-xs">Expires<input type="date" name="expiresOn" className="input mt-1" /></label>
            <input name="note" className="input md:col-span-2 md:self-end" placeholder="Note (optional)" />
            <div className="md:col-span-4"><SubmitButton pendingLabel="Saving...">Save credential</SubmitButton></div>
          </ActionForm>
          <p className="mt-2 text-xs text-slate-500">CAQH attestation must be renewed every 120 days. Pulling records straight from CAQH ProView needs an organization account with CAQH and is not connected; enter them here.</p>
        </Card>
      )}
      <Card>
        {rows.length === 0 ? <Empty>No credentials recorded yet.</Empty> : (
          <table className="table">
            <thead><tr><th>Provider</th><th>Credential</th><th>Number</th><th>Expires</th><th>Status</th><th /></tr></thead>
            <tbody>
              {rows.map(({ c, first, last }, i) => (
                <tr key={c.id}>
                  <td>{last}, {first}</td>
                  <td>{CREDENTIAL_KINDS[c.kind] ?? c.kind}{c.state ? ` · ${c.state}` : ""}{c.note && <span className="block text-xs text-slate-500">{c.note}</span>}</td>
                  <td className="font-mono text-xs">{c.identifier ?? "-"}</td>
                  <td>{c.expiresOn ? fmtDate(`${c.expiresOn}T00:00:00`) : "-"}</td>
                  <td><Badge tone={TONE[states[i]]}>{WORD[states[i]]}</Badge></td>
                  <td className="text-right">{canEdit && <ActionForm action={deleteCredentialAction.bind(null, c.id)}><SubmitButton className="btn btn-secondary px-2 py-1 text-xs" pendingLabel="...">Remove</SubmitButton></ActionForm>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
