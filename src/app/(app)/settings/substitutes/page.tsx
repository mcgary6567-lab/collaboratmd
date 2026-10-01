import type { Metadata } from "next";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { listProviders } from "@/server/encounters";
import { KINDS, MEDICARE_DAYS, listArrangements } from "@/server/substitutes";
import { saveArrangementAction } from "@/app/(app)/visit-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Substitute physicians" };
export const dynamic = "force-dynamic";

const day = (v: string) => fmtDate(`${v}T00:00:00`);
const span = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000) + 1;

/** Locum tenens and reciprocal billing arrangements for absent providers. */
export default async function SubstitutesPage() {
  const s = await requireSession();
  const db = await getDb();
  const [rows, providers] = await Promise.all([listArrangements(db, s.practiceId), listProviders(db, s.practiceId)]);
  const canEdit = ["admin", "biller"].includes(s.role);
  return (
    <>
      <PageHeader title="Substitute physicians" subtitle="When a provider is away, a substitute can see their patients and the visit is billed under the absent provider with Q6 (locum tenens) or Q5 (reciprocal)" />
      {canEdit && (
        <Card title="Record an absence and its substitute" className="mb-6">
          <ActionForm action={saveArrangementAction} className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <label className="block"><span className="label">Absent provider</span><select name="providerId" className="input">{providers.map((p) => <option key={p.id} value={p.id}>{p.firstName} {p.lastName}</option>)}</select></label>
            <label className="block"><span className="label">Arrangement</span><select name="kind" className="input">{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v.label} ({v.modifier})</option>)}</select></label>
            <label className="block"><span className="label">Substitute physician</span><input name="name" className="input" required maxLength={120} /></label>
            <label className="block"><span className="label">Substitute&apos;s NPI</span><input name="npi" className="input" required inputMode="numeric" maxLength={10} /></label>
            <label className="block"><span className="label">First day away</span><input type="date" name="startsOn" className="input" required /></label>
            <label className="block"><span className="label">Last day away</span><input type="date" name="endsOn" className="input" required /></label>
            <label className="block sm:col-span-2"><span className="label">Notes</span><input name="notes" className="input" maxLength={500} /></label>
            <div><SubmitButton pendingLabel="Saving...">Save</SubmitButton></div>
          </ActionForm>
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Medicare allows a substitute for up to {MEDICARE_DAYS} continuous days of an absence; after that the substitute bills under their own enrollment. Mark each visit the substitute saw from its claim page. The substitute&apos;s NPI is kept here, as Medicare requires; it does not go on the claim.</p>
        </Card>
      )}
      <Card title="Arrangements">
        {rows.length === 0 ? <Empty>None recorded.</Empty> : (
          <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-700">
            {rows.map(({ a, firstName, lastName }) => (
              <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="font-medium">{firstName} {lastName}</span>
                <span>away {day(a.startsOn)} to {day(a.endsOn)}</span>
                <span>covered by {a.substituteName} (NPI {a.substituteNpi})</span>
                <Badge>{KINDS[a.kind as keyof typeof KINDS]?.modifier}</Badge>
                {span(a.startsOn, a.endsOn) > MEDICARE_DAYS && <Badge tone="amber">over {MEDICARE_DAYS} days for Medicare</Badge>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
