import Link from "next/link";
import type { Db } from "@/db";
import { holdsFor } from "@/server/account-holds";
import { isAdult } from "@/server/account-review";
import { REFERRAL_SOURCES } from "@/lib/referral-sources";
import { adultConsentAction, mailReturnedAction, recordBankruptcyAction, recordDeathAction, referralAction, releaseAdultAction, updateAddressAction } from "@/app/(app)/account-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card } from "@/components/ui";
import { US_STATES } from "@/lib/us";
import { fmtDate } from "@/lib/utils";

type Patient = {
  id: string; dob: string; address1: string | null; city: string | null; state: string | null; zip: string | null;
  addressBadSince: string | null; addressBadNote: string | null; guarantorId: string | null; guarantorAdultConsentOn: string | null;
  referralSource: string | null; referralDetail: string | null;
};

const day = (v: string) => fmtDate(`${v}T00:00:00`);

/** Account status: returned mail, an adult dependent's bills, where the patient came from, and bankruptcy or death. */
export async function StatusCard({ db, patient, canWrite }: { db: Db; patient: Patient; canWrite: boolean }) {
  const holds = (await holdsFor(db, patient.id)).filter((h) => h.status === "open");
  const today = new Date().toISOString().slice(0, 10);
  const adultOnGuarantor = !!patient.guarantorId && isAdult(patient.dob, today);
  return (
    <Card title="Account status">
      <div className="space-y-4 text-sm">
        {holds.map((h) => (
          <div key={h.id} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
            {h.kind === "bankruptcy"
              ? <>Chapter {h.details.chapter} bankruptcy, case {h.details.caseNumber}, filed {day(h.startedOn)}: the automatic stay stops statements, reminders, card charges and collections.</>
              : <>Deceased {day(h.startedOn)}: the patient is not billed; the balance is a claim against the estate{h.details.executor ? ` (executor ${h.details.executor})` : ""}.</>}
            {h.deadline && <> Claim deadline {day(h.deadline)}{h.claimFiledOn ? `, filed ${day(h.claimFiledOn)}` : ", not filed yet"}.</>}
            {" "}<Link href="/billing/holds" className="font-semibold underline">Bankruptcy and estates</Link>
          </div>
        ))}

        <div>
          <div className="font-medium">Mailing address</div>
          {patient.addressBadSince ? (
            <div className="mt-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
              Mail came back on {day(patient.addressBadSince)}{patient.addressBadNote ? ` (${patient.addressBadNote})` : ""}. Nothing is mailed here until the address is corrected or confirmed.
            </div>
          ) : <p>{patient.address1 ? `${patient.address1}, ${patient.city}, ${patient.state} ${patient.zip}` : <span className="text-slate-500 dark:text-slate-400">No address on file</span>}</p>}
          {canWrite && (
            <details className="mt-2" open={!!patient.addressBadSince}>
              <summary className="cursor-pointer text-brand-700">{patient.addressBadSince ? "Correct or confirm the address" : "Change the address"}</summary>
              <ActionForm action={updateAddressAction.bind(null, patient.id)} className="mt-2 grid gap-2 sm:grid-cols-2">
                <label className="block sm:col-span-2"><span className="label">Street</span><input name="address1" defaultValue={patient.address1 ?? ""} className="input" required maxLength={100} /></label>
                <label className="block"><span className="label">City</span><input name="city" defaultValue={patient.city ?? ""} className="input" required maxLength={60} /></label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block"><span className="label">State</span><select name="state" defaultValue={patient.state ?? ""} className="input">{US_STATES.map(([c]) => <option key={c} value={c}>{c}</option>)}</select></label>
                  <label className="block"><span className="label">ZIP</span><input name="zip" defaultValue={patient.zip ?? ""} className="input" required inputMode="numeric" maxLength={10} /></label>
                </div>
                <div className="sm:col-span-2"><SubmitButton className="btn btn-secondary" pendingLabel="Saving...">Save address</SubmitButton></div>
              </ActionForm>
            </details>
          )}
          {canWrite && !patient.addressBadSince && (
            <details className="mt-1">
              <summary className="cursor-pointer text-brand-700">Mail came back</summary>
              <ActionForm action={mailReturnedAction.bind(null, patient.id)} className="mt-2 flex flex-wrap items-end gap-2">
                <label className="block"><span className="label">Returned on</span><input type="date" name="on" defaultValue={today} className="input" /></label>
                <label className="block grow"><span className="label">Note (what the envelope said)</span><input name="note" className="input" maxLength={300} /></label>
                <SubmitButton className="btn btn-secondary" pendingLabel="...">Mark returned</SubmitButton>
              </ActionForm>
            </details>
          )}
        </div>

        {adultOnGuarantor && (
          <div>
            <div className="font-medium">Adult dependent</div>
            {patient.guarantorAdultConsentOn ? (
              <p>Now 18 or older; agreed on {day(patient.guarantorAdultConsentOn)} to keep statements going to the guarantor.</p>
            ) : (
              <>
                <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">Now 18 or older, so statements go to the patient, not the guarantor, unless the patient agrees.</p>
                {canWrite && (
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <ActionForm action={adultConsentAction.bind(null, patient.id)} className="flex flex-wrap items-end gap-2">
                      <label className="block"><span className="label">Patient agreed on</span><input type="date" name="on" defaultValue={today} className="input" /></label>
                      <SubmitButton className="btn btn-secondary" pendingLabel="...">Keep the guarantor</SubmitButton>
                    </ActionForm>
                    <ActionForm action={releaseAdultAction.bind(null, patient.id)}><SubmitButton className="btn btn-secondary" pendingLabel="...">Own account</SubmitButton></ActionForm>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <div>
          <div className="font-medium">How they heard about us</div>
          {canWrite ? (
            <ActionForm action={referralAction.bind(null, patient.id)} className="mt-1 flex flex-wrap items-end gap-2">
              <label className="block"><span className="label">Source</span>
                <select name="source" defaultValue={patient.referralSource ?? ""} className="input">
                  <option value="">Not recorded</option>
                  {Object.entries(REFERRAL_SOURCES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <label className="block grow"><span className="label">Referring doctor or detail</span><input name="detail" defaultValue={patient.referralDetail ?? ""} className="input" maxLength={120} /></label>
              <SubmitButton className="btn btn-secondary" pendingLabel="...">Save</SubmitButton>
            </ActionForm>
          ) : <p>{patient.referralSource ? `${REFERRAL_SOURCES[patient.referralSource] ?? patient.referralSource}${patient.referralDetail ? `: ${patient.referralDetail}` : ""}` : "Not recorded"}</p>}
        </div>

        {canWrite && !holds.some((h) => h.kind === "bankruptcy") && (
          <details>
            <summary className="cursor-pointer text-brand-700">Record a bankruptcy</summary>
            <ActionForm action={recordBankruptcyAction.bind(null, patient.id)} className="mt-2 grid gap-2 sm:grid-cols-2">
              <label className="block"><span className="label">Chapter</span><select name="chapter" className="input"><option value="7">Chapter 7</option><option value="13">Chapter 13</option><option value="11">Chapter 11</option></select></label>
              <label className="block"><span className="label">Case number</span><input name="caseNumber" className="input" required maxLength={40} /></label>
              <label className="block"><span className="label">Court</span><input name="court" className="input" maxLength={120} /></label>
              <label className="block"><span className="label">Filed on</span><input type="date" name="filedOn" className="input" required /></label>
              <label className="block"><span className="label">Proof of claim deadline</span><input type="date" name="deadline" className="input" /></label>
              <label className="block"><span className="label">Notes</span><input name="notes" className="input" maxLength={1000} /></label>
              <div className="sm:col-span-2"><SubmitButton pendingLabel="Saving...">Stop collection activity</SubmitButton></div>
            </ActionForm>
          </details>
        )}
        {canWrite && !holds.some((h) => h.kind === "deceased") && (
          <details>
            <summary className="cursor-pointer text-brand-700">Record the patient&apos;s death</summary>
            <ActionForm action={recordDeathAction.bind(null, patient.id)} className="mt-2 grid gap-2 sm:grid-cols-2">
              <label className="block"><span className="label">Date of death</span><input type="date" name="diedOn" className="input" required /></label>
              <label className="block"><span className="label">Executor or administrator</span><input name="executor" className="input" maxLength={120} /></label>
              <label className="block sm:col-span-2"><span className="label">Executor&apos;s address</span><input name="executorAddress" className="input" maxLength={300} /></label>
              <label className="block"><span className="label">Probate court</span><input name="probateCourt" className="input" maxLength={120} /></label>
              <label className="block"><span className="label">Estate claim deadline</span><input type="date" name="deadline" className="input" /></label>
              <label className="block sm:col-span-2"><span className="label">Notes</span><input name="notes" className="input" maxLength={1000} /></label>
              <div className="sm:col-span-2"><SubmitButton pendingLabel="Saving...">Record and stop billing the patient</SubmitButton></div>
            </ActionForm>
          </details>
        )}
      </div>
    </Card>
  );
}
