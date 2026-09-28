import { Lock } from "lucide-react";
import { breakGlassAction } from "@/app/(app)/restricted-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { PageHeader } from "@/components/ui";
import { GRANT_HOURS } from "@/server/restricted";

/** Shown instead of a restricted patient's record until the person says why they need it. */
export function RestrictedGate({ patientId, back, what }: { patientId: string; back: string; what: string }) {
  return (
    <>
      <PageHeader title="Restricted record" subtitle={`This ${what} belongs to a patient whose records the practice has restricted.`} />
      <section className="card max-w-xl p-6">
        <p className="flex items-start gap-2 text-sm text-slate-700">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden />
          <span>Say why you need it. Your reason is kept in the patient&apos;s access log and the administrators are told. You can then open this patient&apos;s records for {GRANT_HOURS} hours.</span>
        </p>
        <ActionForm action={breakGlassAction.bind(null, patientId, back)} className="mt-4 space-y-3">
          <label className="block text-sm">
            <span className="label">Reason</span>
            <textarea name="reason" rows={3} required minLength={10} maxLength={500} className="input" placeholder="For example: posting the payment the patient made by phone today" />
          </label>
          <SubmitButton pendingLabel="Opening...">Open the record</SubmitButton>
        </ActionForm>
      </section>
    </>
  );
}
