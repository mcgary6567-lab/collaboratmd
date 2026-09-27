import Link from "next/link";
import { acceptTermsAction } from "@/app/(app)/legal-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { LEGAL_TITLES, LEGAL_VERSIONS, versionLabel, type LegalDocument } from "@/content/legal";

/** Shown to a self-serve practice's administrator when the terms or privacy policy have changed since they accepted. */
export function AcceptTerms({ documents }: { documents: LegalDocument[] }) {
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold">Please review our updated terms</h1>
      <p className="mb-6 mt-1 text-sm text-slate-600">We changed the documents below since you last accepted them. Read them, then accept to continue.</p>
      <div className="card space-y-4 p-6 text-sm">
        <ul className="list-disc space-y-1 pl-5">
          {documents.map((d) => (
            <li key={d}><Link href={LEGAL_TITLES[d].href} target="_blank" className="font-semibold text-brand-700 underline">{LEGAL_TITLES[d].title}</Link>, updated {versionLabel(LEGAL_VERSIONS[d])}</li>
          ))}
        </ul>
        <ActionForm action={acceptTermsAction} className="space-y-3">
          <label className="flex items-start gap-2"><input type="checkbox" name="agree" className="mt-1" required /> <span>I have read and accept these on behalf of the practice.</span></label>
          <SubmitButton pendingLabel="Saving...">Accept and continue</SubmitButton>
        </ActionForm>
      </div>
    </div>
  );
}
