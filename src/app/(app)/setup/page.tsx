import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { setupSteps } from "@/server/setup";
import { Badge, Card, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const s = await requireSession();
  const db = await getDb();
  const steps = await setupSteps(db, s.practiceId);
  const required = steps.filter((x) => !x.optional);
  const done = required.filter((x) => x.done).length;
  const pct = Math.round((done / required.length) * 100);

  return (
    <>
      <PageHeader title="Setup checklist" subtitle="Everything a practice needs before it bills, checked against its data" />
      <Card className="mb-6">
        <div className="flex items-center justify-between text-sm">
          <span className="font-semibold">{done} of {required.length} required steps done</span>
          <span className="text-slate-500">{pct}%</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${pct}%` }} />
        </div>
      </Card>
      <ol className="space-y-2">
        {steps.map((st, i) => (
          <li key={st.key} className={`card flex items-start gap-3 p-4 ${st.done ? "opacity-75" : ""}`}>
            {st.done ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600" /> : <Circle className="mt-0.5 h-5 w-5 shrink-0 text-slate-300" />}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 font-semibold">
                <span className="text-xs text-slate-400">{i + 1}.</span> {st.title}
                {st.optional && <Badge>Optional</Badge>}
              </div>
              <p className="text-sm text-slate-600">{st.detail}</p>
            </div>
            {!st.done && <Link href={st.href} className="btn btn-secondary whitespace-nowrap text-xs">Go</Link>}
          </li>
        ))}
      </ol>
    </>
  );
}
