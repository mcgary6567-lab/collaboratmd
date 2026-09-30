import Link from "next/link";
import type { Db } from "@/db";
import { familyOf, qmbProtected } from "@/server/patient-accounts";
import { isAdult } from "@/server/account-review";
import { familyPaymentAction, feePolicySignedAction, setGuarantorAction, setQmbAction, writeOffQmbAction } from "@/app/(app)/finance-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Money } from "@/components/ui";
import { fmtDate } from "@/lib/utils";

type Insurance = { id: string; active: boolean; qmb: boolean; qmbVerifiedOn: string | null };
type Payer = { name: string; type: string };

/** Who pays: QMB protection on the Medicare policy, the guarantor and family, and the missed-appointment policy. */
export async function AccountCard({ db, practiceId, patient, insurances, canWrite, canAdjust }: {
  db: Db; practiceId: string; canWrite: boolean; canAdjust: boolean;
  patient: { id: string; dob: string; guarantorId: string | null; guarantorAdultConsentOn: string | null; feePolicySignedOn: string | null };
  insurances: { insurance: Insurance; payer: Payer }[];
}) {
  const medicare = insurances.filter((i) => i.insurance.active && i.payer.type === "medicare");
  const qmb = medicare.some((m) => m.insurance.qmb);
  const [family, protectedCents] = await Promise.all([familyOf(db, practiceId, patient.id), qmb ? qmbProtected(db, patient.id) : Promise.resolve(0)]);
  const guarantor = family?.members.find((m) => m.guarantor && m.id !== patient.id) ?? null;
  const today = new Date().toISOString().slice(0, 10);
  const adultUnconsented = !!patient.guarantorId && !patient.guarantorAdultConsentOn && isAdult(patient.dob, today);
  return (
    <Card title="Who pays">
      <div className="space-y-4 text-sm">
        {medicare.map(({ insurance }) => (
          <div key={insurance.id}>
            <ActionForm action={setQmbAction.bind(null, insurance.id, patient.id)} className="flex flex-wrap items-end gap-2">
              <label className="flex items-center gap-2"><input type="checkbox" name="qmb" defaultChecked={insurance.qmb} disabled={!canWrite} /> Qualified Medicare Beneficiary (QMB)</label>
              <label className="block"><span className="label">Verified on</span><input type="date" name="verifiedOn" defaultValue={insurance.qmbVerifiedOn ?? today} className="input" disabled={!canWrite} /></label>
              {canWrite && <SubmitButton className="btn btn-secondary" pendingLabel="...">Save</SubmitButton>}
            </ActionForm>
          </div>
        ))}
        {qmb && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
            QMB: Medicare deductibles, coinsurance and copays may not be billed to this patient; they are left off statements, reminders, card charges and collections.
            {protectedCents > 0 && <> <Money cents={protectedCents} /> of Medicare cost-sharing is on the account.</>}
            {protectedCents > 0 && canAdjust && <ActionForm action={writeOffQmbAction.bind(null, patient.id)} className="mt-2"><SubmitButton className="btn btn-secondary" pendingLabel="...">Write it off (after Medicaid has paid)</SubmitButton></ActionForm>}
          </div>
        )}

        <div>
          <div className="font-medium">Guarantor</div>
          {guarantor ? <p><Link href={`/patients/${guarantor.id}`} className="text-brand-700 hover:underline">{guarantor.name}</Link> (MRN {guarantor.mrn}) is responsible for this patient&apos;s bill; {adultUnconsented ? "the patient is now an adult, so statements go to the patient (see Account status)." : "statements go to them."}</p>
            : family ? <p>Guarantor for the family below.</p> : <p className="text-slate-500 dark:text-slate-400">The patient pays their own bill.</p>}
          {canWrite && !(family && !guarantor) && (
            <ActionForm action={setGuarantorAction.bind(null, patient.id)} className="mt-2 flex flex-wrap items-end gap-2">
              <label className="block"><span className="label">Guarantor&apos;s MRN (blank to remove)</span><input name="guarantorMrn" className="input w-36" /></label>
              <SubmitButton className="btn btn-secondary" pendingLabel="...">Save</SubmitButton>
            </ActionForm>
          )}
        </div>

        {family && (
          <div>
            <div className="font-medium">Family account</div>
            <ul className="mt-1 space-y-0.5">
              {family.members.map((m) => (
                <li key={m.id} className="flex justify-between gap-3">
                  <span>{m.id === patient.id ? m.name : <Link href={`/patients/${m.id}`} className="text-brand-700 hover:underline">{m.name}</Link>} {m.guarantor && <Badge>guarantor</Badge>}</span>
                  <span className="tabular-nums"><Money cents={m.balanceCents} /></span>
                </li>
              ))}
              <li className="flex justify-between gap-3 border-t border-slate-200 pt-1 font-semibold dark:border-slate-700"><span>Family total</span><span className="tabular-nums"><Money cents={family.members.reduce((a, m) => a + m.balanceCents, 0)} /></span></li>
            </ul>
            {canWrite && (
              <ActionForm action={familyPaymentAction.bind(null, patient.id)} className="mt-2 flex flex-wrap items-end gap-2">
                <label className="block"><span className="label">Family payment ($)</span><input name="amount" inputMode="decimal" className="input w-28" required /></label>
                <label className="block"><span className="label">Method</span><select name="method" className="input"><option value="card">Card</option><option value="cash">Cash</option><option value="check">Check</option><option value="ach">ACH</option></select></label>
                <SubmitButton pendingLabel="Posting...">Apply across the family</SubmitButton>
              </ActionForm>
            )}
          </div>
        )}

        <div>
          <div className="font-medium">Missed-appointment policy</div>
          {patient.feePolicySignedOn ? <p>Agreed on {fmtDate(`${patient.feePolicySignedOn}T00:00:00`)}.</p> : <p className="text-slate-500 dark:text-slate-400">Not agreed: missed-appointment fees cannot be charged.</p>}
          {canWrite && !patient.feePolicySignedOn && (
            <ActionForm action={feePolicySignedAction.bind(null, patient.id)} className="mt-2 flex flex-wrap items-end gap-2">
              <label className="block"><span className="label">Signed in the office on</span><input type="date" name="signedOn" defaultValue={today} className="input" /></label>
              <SubmitButton className="btn btn-secondary" pendingLabel="...">Record</SubmitButton>
            </ActionForm>
          )}
        </div>
      </div>
    </Card>
  );
}
