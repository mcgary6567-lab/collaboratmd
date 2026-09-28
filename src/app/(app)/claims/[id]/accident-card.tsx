import { saveAccidentAction } from "@/app/(app)/claim-edit-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card } from "@/components/ui";
import { StateSelect } from "@/components/us-fields";
import { fmtDate } from "@/lib/utils";

type Enc = { relatedEmployment: boolean; relatedAuto: boolean; autoAccidentState: string | null; relatedOther: boolean; accidentDate: string | null; propertyClaimNumber: string | null; employerName: string | null };

/** Box 10 and 11b: whether the condition came from work or an accident, and the insurer's claim number. */
export function AccidentCard({ claimId, encounter: e, editable, open }: { claimId: string; encounter: Enc; editable: boolean; open: boolean }) {
  const related = [e.relatedEmployment && "employment", e.relatedAuto && `an auto accident${e.autoAccidentState ? ` in ${e.autoAccidentState}` : ""}`, e.relatedOther && "another accident"].filter(Boolean);
  const summary = related.length ? `Related to ${related.join(" and ")}${e.accidentDate ? ` on ${fmtDate(e.accidentDate)}` : ""}` : "Not related to work or an accident";
  return (
    <Card title="Injury, accident or workers' comp">
      <p className="text-sm text-slate-700 dark:text-slate-300">
        {summary}
        {e.propertyClaimNumber && <> · insurer&apos;s claim <span className="font-mono">{e.propertyClaimNumber}</span></>}
        {e.employerName && <> · employer {e.employerName}</>}
      </p>
      {editable && (
        <details className="mt-3" open={open}>
          <summary className="cursor-pointer text-sm font-medium text-brand-700">Change</summary>
          <ActionForm action={saveAccidentAction.bind(null, claimId)} className="mt-3 space-y-3">
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" name="employment" defaultChecked={e.relatedEmployment} /> Related to employment</label>
              <label className="flex items-center gap-2"><input type="checkbox" name="auto" defaultChecked={e.relatedAuto} /> Auto accident</label>
              <label className="flex items-center gap-2"><input type="checkbox" name="other" defaultChecked={e.relatedOther} /> Other accident</label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="block text-sm"><span className="label">Date of accident or injury</span><input type="date" name="date" className="input" defaultValue={e.accidentDate ?? ""} /></label>
              <label className="block text-sm"><span className="label">Auto accident state</span><StateSelect name="autoState" defaultValue={e.autoAccidentState} className="select" /></label>
              <label className="block text-sm"><span className="label">Insurer&apos;s claim number</span><input name="claimNumber" className="input" defaultValue={e.propertyClaimNumber ?? ""} autoComplete="off" /></label>
              <label className="block text-sm"><span className="label">Employer</span><input name="employer" className="input" defaultValue={e.employerName ?? ""} autoComplete="off" /></label>
            </div>
            <SubmitButton pendingLabel="Saving...">Save and check again</SubmitButton>
          </ActionForm>
        </details>
      )}
    </Card>
  );
}
