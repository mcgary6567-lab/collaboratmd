import type { Metadata } from "next";
import Link from "next/link";
import { CircleCheck, Circle } from "lucide-react";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { goLivePlan } from "@/server/go-live";
import { setupSteps } from "@/server/setup";
import { rulesSetup } from "@/server/setup-rules";
import { Badge, Card, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Setup checklist" };

export const dynamic = "force-dynamic";

/** What the go-live plan does not already check: the rest of a complete setup. */
const MORE = ["fees", "contracts", "team", "patients", "ehr", "eligibility", "payments", "sms", "email", "ai"];

/** The one checklist: from an empty practice to real claims and payments, each step checked against the practice's own data. */
export default async function SetupPage() {
  const s = await requireSession();
  const db = await getDb();
  const [phases, steps, rules] = await Promise.all([goLivePlan(db, s.practiceId), setupSteps(db, s.practiceId), rulesSetup(db, s.practiceId)]);
  const checked = phases.slice(0, 3).flatMap((p) => p.steps);
  const done = checked.filter((x) => x.done).length;
  const pct = Math.round((done / Math.max(checked.length, 1)) * 100);
  const more = steps.filter((x) => MORE.includes(x.key));

  return (
    <>
      <PageHeader title="Setup checklist" subtitle="From setup to real claims, in order, each step checked against your practice's data" actions={<Link href="/settings/connections/doctor" className="btn btn-secondary">Check connections</Link>} />
      <Card className="mb-6">
        <div className="flex items-center justify-between text-sm">
          <span className="font-semibold">{done} of {checked.length} checked steps done</span>
          <span className="text-slate-500">{pct}%</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
          <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${pct}%` }} />
        </div>
      </Card>
      <div className="space-y-6">
        {phases.map((p) => (
          <Card key={p.title} title={p.title}>
            <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
              {p.steps.map((st) => (
                <li key={st.label} className="flex items-start gap-3 py-2.5">
                  {st.done ? <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-green-700" aria-label="done" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-label="not done" />}
                  <div className="min-w-0 flex-1"><div className="font-medium">{st.label}</div><div className="text-slate-600 dark:text-slate-400">{st.detail}</div></div>
                  {st.href && !st.done && <Link href={st.href} className="btn btn-secondary shrink-0 text-xs">Set up</Link>}
                </li>
              ))}
            </ul>
          </Card>
        ))}
        <Card title="5. Yearly files and billing rules">
          <p className="mb-2 text-sm text-slate-600 dark:text-slate-400">Checks that depend on CMS&apos;s yearly files or on your own settings. National files are loaded by CollaboratMD for every practice; the rest are yours.</p>
          <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
            {rules.map((st) => (
              <li key={st.key} className="flex items-start gap-3 py-2.5">
                {st.done ? <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-green-700" aria-label="done" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-label="not done" />}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 font-medium">{st.title}{st.national && <Badge>National file</Badge>}{st.optional && <Badge>Optional</Badge>}</div>
                  <div className="text-slate-600 dark:text-slate-400">{st.detail}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Makes possible: {st.unlocks}</div>
                </div>
                {!st.done && !st.national && <Link href={st.href} className="btn btn-secondary shrink-0 text-xs">Set up</Link>}
              </li>
            ))}
          </ul>
        </Card>
        <Card title="6. Rounding out the setup">
          <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
            {more.map((st) => (
              <li key={st.key} className="flex items-start gap-3 py-2.5">
                {st.done ? <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-green-700" aria-label="done" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-label="not done" />}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 font-medium">{st.title}{st.optional && <Badge>Optional</Badge>}</div>
                  <div className="text-slate-600 dark:text-slate-400">{st.detail}</div>
                </div>
                {!st.done && <Link href={st.href} className="btn btn-secondary shrink-0 text-xs">Set up</Link>}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
