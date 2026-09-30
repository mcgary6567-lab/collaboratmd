import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { CAN_WRITE, requireSession } from "@/lib/auth";
import { feeCandidates, recentFees } from "@/server/missed-fees";
import { chargeFeeAction, saveFeePolicyAction, waiveFeeAction } from "@/app/(app)/finance-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Empty, Money, PageHeader } from "@/components/ui";
import { fmtDate, fmtDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Missed appointment fees" };
export const dynamic = "force-dynamic";

const dollars = (c: number | undefined) => (c === undefined ? "" : (c / 100).toFixed(2));

/** No-show and late-cancellation fees under the policy patients agreed to. */
export default async function MissedFeesPage() {
  const s = await requireSession();
  const db = await getDb();
  const [{ policy, candidates }, fees] = await Promise.all([feeCandidates(db, s.practiceId), recentFees(db, s.practiceId)]);
  const canWrite = (CAN_WRITE as readonly string[]).includes(s.role);
  return (
    <>
      <PageHeader title="Missed appointment fees" subtitle="No-shows and late cancellations, charged only to patients who agreed to the policy beforehand; never billed to insurance" />
      <Card title="Policy" className="mb-6">
        <ActionForm action={saveFeePolicyAction} className="flex flex-wrap items-end gap-3 text-sm">
          <label className="block"><span className="label">No-show fee ($)</span><input name="noShow" inputMode="decimal" defaultValue={dollars(policy?.noShowCents)} className="input w-28" disabled={s.role !== "admin"} /></label>
          <label className="block"><span className="label">Late cancellation fee ($)</span><input name="lateCancel" inputMode="decimal" defaultValue={dollars(policy?.lateCancelCents)} className="input w-28" disabled={s.role !== "admin"} /></label>
          <label className="block"><span className="label">Late means within (hours)</span><input name="hours" type="number" min={1} max={72} defaultValue={policy?.lateCancelHours ?? 24} className="input w-24" disabled={s.role !== "admin"} /></label>
          {s.role === "admin" && <SubmitButton className="btn btn-secondary" pendingLabel="Saving...">Save</SubmitButton>}
        </ActionForm>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Patients agree at online check-in, or record a signed policy on the patient&apos;s page. Medicaid patients are never charged. Some states and payer contracts limit these fees: set the policy to what yours allow.</p>
      </Card>
      <Card title="To charge (last 60 days)" className="mb-6">
        {!policy ? <Empty>Set the policy first.</Empty> : candidates.length === 0 ? <Empty>No missed appointments to charge.</Empty> : (
          <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-700">
            {candidates.map((c) => (
              <li key={c.appointmentId} className="flex flex-wrap items-center gap-2 py-2">
                <Link href={`/patients/${c.patientId}`} className="font-semibold text-brand-700 hover:underline">{c.patient}</Link>
                <span className="text-slate-500">{fmtDateTime(c.startsAt, s.timeZone)}</span>
                <Badge tone="amber">{c.kind === "no_show" ? "No-show" : "Late cancellation"}</Badge>
                <Money cents={c.feeCents} />
                {c.blocked ? <span className="text-xs text-slate-500">{c.blocked}</span> : canWrite && <ActionForm action={chargeFeeAction.bind(null, c.appointmentId)}><SubmitButton className="btn btn-secondary" pendingLabel="...">Charge</SubmitButton></ActionForm>}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Charged (last 90 days)">
        {fees.length === 0 ? <Empty>None yet.</Empty> : (
          <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-700">
            {fees.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-2 py-2">
                <Link href={`/patients/${f.patientId}`} className="text-brand-700 hover:underline">{f.patient}</Link>
                <span className="text-slate-500">{fmtDate(`${f.on}T00:00:00`)}</span>
                <Money cents={f.cents} />
                <span className="text-xs text-slate-500">{f.note.replace(/ \[appt [^\]]+\]/, "")}</span>
                {f.waived ? <Badge>Waived</Badge> : canWrite && (
                  <ActionForm action={waiveFeeAction.bind(null, f.id)} className="flex items-end gap-2">
                    <label className="block"><span className="label">Waive: reason</span><input name="reason" className="input" maxLength={200} /></label>
                    <SubmitButton className="btn btn-secondary" pendingLabel="...">Waive</SubmitButton>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
