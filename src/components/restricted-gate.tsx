import { Lock } from "lucide-react";
import { breakGlassAction } from "@/app/(app)/restricted-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { PageHeader } from "@/components/ui";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { GRANT_HOURS } from "@/server/restricted";
import { reauthNeeds, RECENT_SSO_MINUTES } from "@/server/reauth";

/**
 * Shown instead of a restricted patient's record until the person says why they
 * need it and proves it is them (server/reauth.ts): someone at an unlocked desk
 * has the session, not the password or the phone.
 */
export async function RestrictedGate({ patientId, back, what }: { patientId: string; back: string; what: string }) {
  const s = await requireSession();
  const need = await reauthNeeds(await getDb(), s.userId, !!s.sso);
  return (
    <>
      <PageHeader title="Restricted record" subtitle={`This ${what} belongs to a patient whose records the practice has restricted.`} />
      <section className="card max-w-xl p-6">
        <p className="flex items-start gap-2 text-sm text-slate-700">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden />
          <span>Say why you need it, and confirm it is you. Your reason is kept in the patient&apos;s access log and the administrators are told. You can then open this patient&apos;s records for {GRANT_HOURS} hours.</span>
        </p>
        <ActionForm action={breakGlassAction.bind(null, patientId, back)} className="mt-4 space-y-3">
          <label className="block text-sm">
            <span className="label">Reason</span>
            <textarea name="reason" rows={3} required minLength={10} maxLength={500} className="textarea" placeholder="For example: posting the payment the patient made by phone today" />
          </label>
          {need === "password" && (
            <label className="block text-sm">
              <span className="label">Your password</span>
              <input name="password" type="password" autoComplete="current-password" required className="input" />
            </label>
          )}
          {need === "code" && (
            <label className="block text-sm">
              <span className="label">Code from your authenticator app</span>
              <input name="code" inputMode="numeric" autoComplete="one-time-code" required className="input w-40" placeholder="123456" />
            </label>
          )}
          {need === "recent_sso" && (
            <p className="text-xs text-slate-600">
              You sign in with single sign-on, so your organization checks it is you: this works within {RECENT_SSO_MINUTES} minutes of entering your password there.{" "}
              <a href={`/api/sso/start?reauth=1&next=${encodeURIComponent(back)}`} className="font-semibold text-brand-700 underline">Sign in again with single sign-on</a>, then give your reason here.
            </p>
          )}
          <SubmitButton pendingLabel="Opening...">Open the record</SubmitButton>
        </ActionForm>
      </section>
    </>
  );
}
