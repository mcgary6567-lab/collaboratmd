import Link from "next/link";
import { Lightbulb } from "lucide-react";
import { getDb } from "@/db";
import { featureTips } from "@/server/tips";
import { dismissTipAction } from "@/app/(app)/admin-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";

/** Screens this practice has not opened lately that usually pay off. Administrators only. */
export async function FeatureTips({ practiceId }: { practiceId: string }) {
  const tips = await featureTips(await getDb(), practiceId);
  if (!tips.length) return null;
  return (
    <section className="card mb-6 p-5" aria-labelledby="tips-title">
      <h2 id="tips-title" className="flex items-center gap-2 font-bold text-slate-900"><Lightbulb className="h-4 w-4 text-amber-600" aria-hidden /> Not tried yet</h2>
      <p className="text-sm text-slate-600">Nobody in the practice has opened these in the last 60 days. Only administrators see this.</p>
      <ul className="mt-3 grid gap-3 md:grid-cols-3">
        {tips.map((t) => (
          <li key={t.key} className="flex flex-col rounded-lg border border-slate-200 p-3 text-sm">
            <Link href={t.href} className="font-semibold text-brand-700 hover:underline">{t.title}</Link>
            <p className="mt-1 flex-1 text-slate-600">{t.why}</p>
            <ActionForm action={dismissTipAction.bind(null, t.key)} className="mt-2"><SubmitButton className="text-xs font-medium text-slate-600 hover:text-slate-900" pendingLabel="...">Not for us</SubmitButton></ActionForm>
          </li>
        ))}
      </ul>
    </section>
  );
}
