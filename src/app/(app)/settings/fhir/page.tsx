import Link from "next/link";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { getFhir } from "@/server/fhir";
import { removeFhirAction, saveFhirAction, syncFhirAction, testFhirAction } from "@/app/(app)/fhir-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, PageHeader } from "@/components/ui";
import { fmtDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function FhirPage() {
  const s = await requireSession();
  const conn = await getFhir(await getDb(), s.practiceId);
  const admin = s.role === "admin";
  const last = conn?.lastResult as { patientsCreated?: number; patientsUpdated?: number; visits?: number; skippedCount?: number; skipped?: string[] } | null | undefined;

  return (
    <>
      <PageHeader title="EHR over FHIR" subtitle="Patients and finished visits from your EHR's FHIR R4 API (Epic, Oracle Health, athenahealth and others). Read only." actions={<Link href="/settings/integrations" className="btn btn-secondary">HL7 interfaces</Link>} />
      <div className="grid gap-6 lg:grid-cols-5">
        <Card title="Connection" className="lg:col-span-3">
          {admin ? (
            <ActionForm action={saveFhirAction} className="space-y-3 text-sm">
              <label className="block"><span className="label">FHIR base URL</span><input name="baseUrl" defaultValue={conn?.baseUrl ?? ""} className="input" placeholder="https://fhir.yourehr.com/api/FHIR/R4" required /></label>
              <label className="block"><span className="label">Access token</span><input name="token" type="password" autoComplete="off" className="input" placeholder={conn?.tokenSealed ? "Saved; paste a new one to replace it" : "Bearer token from your EHR's backend app registration"} /></label>
              <p className="text-xs text-slate-500">The token is encrypted before it is stored and sent only to this server. Getting tokens automatically (SMART backend services) is not built yet, so paste a token and replace it when it expires.</p>
              <SubmitButton pendingLabel="Saving...">Save</SubmitButton>
            </ActionForm>
          ) : <p className="text-sm text-slate-600">{conn ? `Connected to ${conn.baseUrl}.` : "Not connected."} An administrator manages this.</p>}
          {conn && (
            <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-200 pt-4">
              {admin && <ActionForm action={testFhirAction}><SubmitButton className="btn btn-secondary text-xs" pendingLabel="Testing...">Test connection</SubmitButton></ActionForm>}
              {["admin", "biller"].includes(s.role) && <ActionForm action={syncFhirAction}><SubmitButton className="btn btn-primary text-xs" pendingLabel="Syncing...">Sync now</SubmitButton></ActionForm>}
              {admin && <ActionForm action={removeFhirAction}><SubmitButton className="btn btn-secondary text-xs text-red-700" pendingLabel="...">Disconnect</SubmitButton></ActionForm>}
            </div>
          )}
        </Card>
        <Card title="What comes in" className="lg:col-span-2">
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
            <li>Patients changed since the last sync, matched by FHIR id, then name and date of birth; new ones are added.</li>
            <li>Finished encounters, as completed visits with the provider whose NPI is on the encounter. They then wait under <Link href="/billing/missed-charges" className="text-brand-700 hover:underline">Missed charges</Link> for charges to be entered.</li>
            <li>Syncs every morning with the daily jobs, or now with the button.</li>
          </ul>
          {conn?.lastSyncAt && (
            <div className="mt-4 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
              <p className="font-semibold">Last sync {fmtDateTime(conn.lastSyncAt)}</p>
              <p>{last?.patientsCreated ?? 0} new patients, {last?.patientsUpdated ?? 0} updated, {last?.visits ?? 0} visits{last?.skippedCount ? `, ${last.skippedCount} skipped` : ""}</p>
              {last?.skipped?.slice(0, 5).map((x) => <p key={x} className="font-mono text-[11px]">{x}</p>)}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
