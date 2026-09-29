import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { listMeasures } from "@/server/quality";
import { measureActiveAction, saveMeasureAction } from "@/app/(app)/quality-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Quality measures" };
export const dynamic = "force-dynamic";

type M = Awaited<ReturnType<typeof listMeasures>>[number];

function MeasureFields({ m }: { m?: M }) {
  return (
    <div className="grid gap-3 text-sm sm:grid-cols-4">
      <label className="block"><span className="label">Measure number</span><input name="number" className="input" defaultValue={m?.number} placeholder="236" required /></label>
      <label className="block sm:col-span-3"><span className="label">Title</span><input name="title" className="input" defaultValue={m?.title} placeholder="Controlling high blood pressure" required /></label>
      <label className="block sm:col-span-2"><span className="label">Visit codes that count</span><input name="eligibleCodes" className="input font-mono" defaultValue={m?.eligibleCodes.join(", ")} placeholder="99202, 99203, 99212, 99213" required /></label>
      <label className="block sm:col-span-2"><span className="label">Diagnosis codes or starts (optional)</span><input name="dxPrefixes" className="input font-mono" defaultValue={m?.dxPrefixes.join(", ")} placeholder="I10, I11, I12" /></label>
      <label className="block"><span className="label">Youngest age</span><input name="minAge" type="number" min={0} max={130} className="input" defaultValue={m?.minAge ?? ""} /></label>
      <label className="block"><span className="label">Oldest age</span><input name="maxAge" type="number" min={0} max={130} className="input" defaultValue={m?.maxAge ?? ""} /></label>
      <label className="block sm:col-span-4"><span className="label">Quality codes, one per line: code, met / not met / excluded, what it means</span>
        <textarea name="codes" rows={4} className="input font-mono text-xs" defaultValue={m?.codes.map((c) => `${c.code}, ${c.outcome.replace("_", " ")}, ${c.label}`).join("\n")} placeholder={"G8752, met, Most recent systolic below 140\nG8753, not met, Most recent systolic 140 or higher"} required />
      </label>
    </div>
  );
}

/** The measures the practice reports on claims, as it defines them from CMS's specifications for the year. */
export default async function QualityPage() {
  const s = await requireSession();
  const measures = await listMeasures(await getDb(), s.practiceId);
  const admin = s.role === "admin";
  return (
    <>
      <PageHeader title="Quality measures" subtitle="MIPS measures reported on claims: which visits count, and the codes for each outcome" actions={<Link href="/reports/quality" className="btn btn-secondary">Quality report</Link>} />
      <Card className="mb-6">
        <p className="text-sm text-slate-700 dark:text-slate-300">
          Enter each measure the way this year&apos;s CMS specification defines it for claims reporting. Measures and their codes change every year, so nothing is filled in for you.
          A claim for a qualifying visit then shows the measure, and choosing the outcome adds its code as a $0.00 line.
        </p>
      </Card>
      {measures.length === 0 ? <Card><Empty>No measures yet.</Empty></Card> : (
        <div className="space-y-4">
          {measures.map((m) => (
            <Card key={m.id} title={`#${m.number} ${m.title}`} actions={<Badge tone={m.active ? "green" : "slate"}>{m.active ? "Reporting" : "Paused"}</Badge>}>
              {admin ? (
                <>
                  <ActionForm action={saveMeasureAction.bind(null, m.id)} className="space-y-3"><MeasureFields m={m} /><SubmitButton pendingLabel="Saving...">Save</SubmitButton></ActionForm>
                  <form action={measureActiveAction.bind(null, m.id, !m.active)} className="mt-2"><button className="btn btn-secondary text-xs">{m.active ? "Pause" : "Resume"}</button></form>
                </>
              ) : <p className="text-sm text-slate-600">Visits {m.eligibleCodes.join(", ")}; codes {m.codes.map((c) => c.code).join(", ")}</p>}
            </Card>
          ))}
        </div>
      )}
      {admin && (
        <div className="mt-6"><Card title="Add a measure"><ActionForm action={saveMeasureAction.bind(null, null)} className="space-y-3"><MeasureFields /><SubmitButton pendingLabel="Saving...">Add measure</SubmitButton></ActionForm></Card></div>
      )}
    </>
  );
}
