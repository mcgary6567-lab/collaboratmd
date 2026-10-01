import Link from "next/link";
import type { Db } from "@/db";
import { referralsFor } from "@/server/referrals-in";
import { DISCIPLINES, plansFor } from "@/server/therapy-plans";
import { otherCoverageDue } from "@/server/other-coverage";
import { superbillVisits } from "@/server/superbill";
import { addReferralAction, certifyPlanAction, interpreterLanguageAction, otherCoverageAction, recertifyAction, savePlanAction } from "@/app/(app)/visit-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card } from "@/components/ui";
import { fmtDate } from "@/lib/utils";

type Patient = { id: string; otherCoverageCheckedOn: string | null; otherCoverage: boolean | null; otherCoverageDetail: string | null; interpreterLanguage: string | null };

const day = (v: string) => fmtDate(`${v}T00:00:00`);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Before and after the visit: HMO referrals, therapy plans of care, the yearly other-insurance question, interpreters and superbills. */
export async function VisitAccessCard({ db, practiceId, patient, payers, canWrite }: { db: Db; practiceId: string; patient: Patient; payers: { id: string; name: string; requiresReferral: boolean }[]; canWrite: boolean }) {
  const [referrals, plans, visits] = await Promise.all([referralsFor(db, patient.id), plansFor(db, patient.id), superbillVisits(db, practiceId, patient.id)]);
  const today = new Date().toISOString().slice(0, 10);
  const hmos = payers.filter((p) => p.requiresReferral);
  const due = otherCoverageDue(patient.otherCoverageCheckedOn, today);
  return (
    <Card title="Referrals, therapy plans and visits">
      <div className="space-y-5 text-sm">
        <section>
          <div className="font-medium">Other insurance</div>
          <p>
            {patient.otherCoverageCheckedOn
              ? <>Asked {day(patient.otherCoverageCheckedOn)}: {patient.otherCoverage ? <><Badge tone="amber">yes</Badge> {patient.otherCoverageDetail ?? ""}</> : "no other coverage"}.</>
              : "Not asked yet."}
            {due && " Ask again this year (online check-in asks automatically)."}
          </p>
          {canWrite && due && (
            <ActionForm action={otherCoverageAction.bind(null, patient.id)} className="mt-1 flex flex-wrap items-end gap-2">
              <label className="block"><span className="label">Other insurance?</span><select name="answer" className="input"><option value="no">No</option><option value="yes">Yes</option></select></label>
              <label className="block grow"><span className="label">If yes: company and member ID</span><input name="detail" className="input" maxLength={300} /></label>
              <SubmitButton className="btn btn-secondary" pendingLabel="...">Record</SubmitButton>
            </ActionForm>
          )}
        </section>

        <section>
          <div className="font-medium">Interpreter</div>
          {canWrite ? (
            <ActionForm action={interpreterLanguageAction.bind(null, patient.id)} className="mt-1 flex flex-wrap items-end gap-2">
              <label className="block"><span className="label">Needs an interpreter for (blank if not)</span><input name="language" defaultValue={patient.interpreterLanguage ?? ""} className="input w-48" maxLength={60} /></label>
              <SubmitButton className="btn btn-secondary" pendingLabel="...">Save</SubmitButton>
              <Link href="/interpreters" className="text-brand-700 underline">Interpreter log</Link>
            </ActionForm>
          ) : <p>{patient.interpreterLanguage ?? "Not needed"}</p>}
        </section>

        {(referrals.length > 0 || hmos.length > 0) && (
          <section>
            <div className="font-medium">HMO referrals</div>
            {referrals.length > 0 && (
              <ul className="mt-1 space-y-1">
                {referrals.map(({ r, payer, used, left }) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2">
                    <span className="font-mono">{r.referralNumber}</span>
                    <span>{payer}</span>
                    <span className="text-slate-500 dark:text-slate-400">{day(r.startsOn)} to {day(r.endsOn)}{r.referringName ? ` · from ${r.referringName}` : ""}</span>
                    {r.visitsAllowed !== null ? <Badge tone={left !== null && left <= 0 ? "red" : left === 1 ? "amber" : "green"}>{used} of {r.visitsAllowed} visits used</Badge> : <Badge>{used} visits</Badge>}
                    {r.endsOn < today && <Badge>expired</Badge>}
                  </li>
                ))}
              </ul>
            )}
            {canWrite && hmos.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-brand-700">Add a referral</summary>
                <ActionForm action={addReferralAction.bind(null, patient.id)} className="mt-2 grid gap-2 sm:grid-cols-2">
                  <label className="block"><span className="label">Plan</span><select name="payerId" className="input">{hmos.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
                  <label className="block"><span className="label">Referral number</span><input name="number" className="input" required maxLength={50} /></label>
                  <label className="block"><span className="label">Referring physician</span><input name="referringName" className="input" maxLength={120} /></label>
                  <label className="block"><span className="label">Their NPI</span><input name="referringNpi" className="input" inputMode="numeric" maxLength={10} /></label>
                  <label className="block"><span className="label">Good from</span><input type="date" name="startsOn" defaultValue={today} className="input" required /></label>
                  <label className="block"><span className="label">Through</span><input type="date" name="endsOn" defaultValue={addDays(today, 90)} className="input" required /></label>
                  <label className="block"><span className="label">Visits allowed (blank if unlimited)</span><input name="visits" type="number" min={1} className="input" /></label>
                  <div className="self-end"><SubmitButton pendingLabel="Saving...">Save referral</SubmitButton></div>
                </ActionForm>
              </details>
            )}
          </section>
        )}

        <section>
          <div className="font-medium">Therapy plans of care</div>
          {plans.length === 0 ? <p className="text-slate-500 dark:text-slate-400">None. Medicare therapy (GP, GO, GN lines) needs a certified plan.</p> : (
            <ul className="mt-1 space-y-2">
              {plans.map((pl) => (
                <li key={pl.id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span>{DISCIPLINES[pl.discipline as keyof typeof DISCIPLINES]?.label}</span>
                    <span className="text-slate-500 dark:text-slate-400">{day(pl.startsOn)} to {day(pl.endsOn)}</span>
                    {pl.certifiedOn ? <Badge tone="green">certified {day(pl.certifiedOn)}{pl.certifierName ? ` by ${pl.certifierName}` : ""}</Badge> : <Badge tone="amber">not certified</Badge>}
                  </div>
                  {canWrite && !pl.certifiedOn && (
                    <ActionForm action={certifyPlanAction.bind(null, pl.id, patient.id)} className="mt-1 flex flex-wrap items-end gap-2">
                      <label className="block"><span className="label">Signed on</span><input type="date" name="certifiedOn" defaultValue={today} className="input" /></label>
                      <label className="block"><span className="label">By</span><input name="certifierName" className="input w-40" required maxLength={120} /></label>
                      <label className="block"><span className="label">NPI</span><input name="certifierNpi" className="input w-32" inputMode="numeric" maxLength={10} /></label>
                      <label className="block"><span className="label">If late, why</span><input name="delayReason" className="input w-48" maxLength={500} /></label>
                      <SubmitButton className="btn btn-secondary" pendingLabel="...">Certified</SubmitButton>
                    </ActionForm>
                  )}
                  {canWrite && pl.certifiedOn && pl.endsOn <= addDays(today, 21) && (
                    <ActionForm action={recertifyAction.bind(null, pl.id, patient.id)} className="mt-1 flex flex-wrap items-end gap-2">
                      <label className="block"><span className="label">Recertify: next plan through</span><input type="date" name="endsOn" defaultValue={addDays(pl.endsOn, 90)} className="input" /></label>
                      <SubmitButton className="btn btn-secondary" pendingLabel="...">Start next plan</SubmitButton>
                    </ActionForm>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canWrite && (
            <details className="mt-2">
              <summary className="cursor-pointer text-brand-700">Add a plan of care</summary>
              <ActionForm action={savePlanAction.bind(null, patient.id)} className="mt-2 grid gap-2 sm:grid-cols-2">
                <label className="block"><span className="label">Therapy</span><select name="discipline" className="input">{Object.entries(DISCIPLINES).map(([k, d]) => <option key={k} value={k}>{d.label} ({d.modifier})</option>)}</select></label>
                <label className="block"><span className="label">Evaluation or first treatment</span><input type="date" name="startsOn" defaultValue={today} className="input" required /></label>
                <label className="block"><span className="label">Plan ends (at most 90 days)</span><input type="date" name="endsOn" defaultValue={addDays(today, 89)} className="input" required /></label>
                <label className="block"><span className="label">Signed by the physician on (if already)</span><input type="date" name="certifiedOn" className="input" /></label>
                <label className="block"><span className="label">Physician or NPP</span><input name="certifierName" className="input" maxLength={120} /></label>
                <label className="block"><span className="label">Their NPI</span><input name="certifierNpi" className="input" inputMode="numeric" maxLength={10} /></label>
                <div><SubmitButton pendingLabel="Saving...">Save plan</SubmitButton></div>
              </ActionForm>
            </details>
          )}
        </section>

        {visits.length > 0 && (
          <section>
            <div className="font-medium">Superbills (for out-of-network claims)</div>
            <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
              {visits.map((v) => <li key={v.id}><Link href={`/print/superbill/${v.id}`} className="text-brand-700 underline">{day(v.dateOfService)}</Link></li>)}
            </ul>
          </section>
        )}
      </div>
    </Card>
  );
}
