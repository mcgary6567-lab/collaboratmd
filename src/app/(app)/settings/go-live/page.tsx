import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { goLivePlan } from "@/server/go-live";
import { Card, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function GoLivePage() {
  const s = await requireSession();
  const phases = await goLivePlan(await getDb(), s.practiceId);
  const auto = phases.slice(0, 3).flatMap((p) => p.steps);
  const done = auto.filter((x) => x.done).length;
  return (
    <>
      <PageHeader title="Go-live checklist" subtitle={`From setup to real claims, in order. ${done} of ${auto.length} checked steps done.`} actions={<Link href="/settings/connections/doctor" className="btn btn-secondary">Integration doctor</Link>} />
      <div className="space-y-6">
        {phases.map((p) => (
          <Card key={p.title} title={p.title}>
            <ul className="divide-y divide-slate-100 text-sm">
              {p.steps.map((st) => (
                <li key={st.label} className="flex items-start gap-3 py-2.5">
                  {st.done ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-700" aria-label="done" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-label="not done" />}
                  <div className="min-w-0 flex-1"><div className="font-medium">{st.label}</div><div className="text-slate-600">{st.detail}</div></div>
                  {st.href && !st.done && <Link href={st.href} className="shrink-0 text-xs font-semibold text-brand-700 hover:underline">Go</Link>}
                </li>
              ))}
            </ul>
          </Card>
        ))}
        <p className="text-xs text-slate-500">The pilot runbook (docs/09-pilot-runbook.md) has the measures to track in the first weeks.</p>
      </div>
    </>
  );
}
