import { mspScreeningAction } from "@/app/(app)/msp-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card } from "@/components/ui";
import { fmtDate } from "@/lib/utils";
import { MSP_QUESTIONS, MSP_TYPE_LABEL } from "@/server/msp";

type Screening = { answers: Record<string, boolean>; medicarePrimary: boolean; mspType: string | null; screenedAt: Date } | null;

/** The Medicare Secondary Payer questions, for a patient on Medicare: they decide which plan is billed first. */
export function MspCard({ patientId, last, canWrite, timeZone }: { patientId: string; last: Screening; canWrite: boolean; timeZone?: string }) {
  return (
    <Card title="Medicare Secondary Payer" actions={last ? <Badge tone={last.medicarePrimary ? "green" : "amber"}>{last.medicarePrimary ? "Medicare pays first" : "Medicare pays second"}</Badge> : <Badge>Not asked</Badge>}>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        {last
          ? <>Asked {fmtDate(last.screenedAt, timeZone)}.{!last.medicarePrimary && <> Reason: {MSP_TYPE_LABEL[last.mspType ?? ""]}. Bill the other plan first; the Medicare claim then goes as secondary.</>} Ask again at least once a year, and whenever coverage or work changes.</>
          : "Ask these before billing a patient who has Medicare and another plan, or whose visit follows an injury."}
      </p>
      {canWrite && (
        <details className="mt-3" open={!last}>
          <summary className="cursor-pointer text-sm font-medium text-brand-700">{last ? "Ask again" : "Ask the questions"}</summary>
          <ActionForm action={mspScreeningAction.bind(null, patientId)} className="mt-3 space-y-3">
            {MSP_QUESTIONS.map((q) => (
              <fieldset key={q.key} className="text-sm">
                <legend className="mb-1 text-slate-800 dark:text-slate-200">{q.text}</legend>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2"><input type="radio" name={q.key} value="yes" defaultChecked={!!last?.answers[q.key]} /> Yes</label>
                  <label className="flex items-center gap-2"><input type="radio" name={q.key} value="no" defaultChecked={!last?.answers[q.key]} /> No</label>
                </div>
              </fieldset>
            ))}
            <SubmitButton pendingLabel="Saving...">Save answers</SubmitButton>
          </ActionForm>
        </details>
      )}
    </Card>
  );
}
