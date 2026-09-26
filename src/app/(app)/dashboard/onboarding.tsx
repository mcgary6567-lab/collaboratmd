import Link from "next/link";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { setupHealth } from "@/server/setup-health";
import { dismissOnboardingAction } from "@/app/(app)/admin-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";

/** The setup steps still to do, in order, until they are done or an administrator hides the guide. */
export async function OnboardingGuide({ practiceId }: { practiceId: string }) {
  const db = await getDb();
  const [practice] = await db.select({ dismissed: schema.practices.onboardingDismissedAt }).from(schema.practices).where(eq(schema.practices.id, practiceId)).limit(1);
  if (practice?.dismissed) return null;
  const checks = (await setupHealth(db, practiceId)).filter((c) => c.state !== "info");
  const todo = checks.filter((c) => c.state === "todo");
  if (!todo.length) return null;
  const done = checks.length - todo.length;
  return (
    <section className="card mb-6 border-brand-200 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-bold text-slate-900">Finish setting up · {done} of {checks.length} done</h2>
          <p className="text-sm text-slate-600">Each step takes a few minutes. Only administrators see this.</p>
        </div>
        <ActionForm action={dismissOnboardingAction}><SubmitButton className="btn btn-secondary text-xs" pendingLabel="...">Hide the guide</SubmitButton></ActionForm>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-green-500" style={{ width: `${Math.round((done / checks.length) * 100)}%` }} /></div>
      <ol className="mt-4 space-y-2">
        {checks.map((c, i) => (
          <li key={c.key} className="flex items-center gap-3 text-sm">
            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${c.state === "ok" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-600"}`}>{c.state === "ok" ? "✓" : i + 1}</span>
            {c.state === "ok" ? <span className="text-slate-400 line-through">{c.action}</span> : <Link href={c.href} className="font-medium text-brand-700 hover:underline">{c.action}</Link>}
          </li>
        ))}
      </ol>
    </section>
  );
}
