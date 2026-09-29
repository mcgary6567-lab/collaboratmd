import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { CAN_WRITE, requireSession } from "@/lib/auth";
import { awvGaps, ccmCandidates, hccRecapture } from "@/server/care-gaps";
import { awvOutreachAction, chronicPrefixesAction } from "@/app/(app)/care-gap-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, Empty, PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Care gaps" };
export const dynamic = "force-dynamic";

const TABS = [
  { key: "awv", label: "Wellness visits due" },
  { key: "ccm", label: "Care management candidates" },
  { key: "hcc", label: "HCC recapture" },
];

export default async function CareGapsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const s = await requireSession();
  const requested = (await searchParams).tab;
  const tab = TABS.some((t) => t.key === requested) ? requested! : "awv";
  const db = await getDb();
  const canWrite = (CAN_WRITE as readonly string[]).includes(s.role);
  const patientLink = (id: string, name: string) => <Link href={`/patients/${id}`} className="text-brand-700 hover:underline dark:text-brand-300">{name}</Link>;

  return (
    <>
      <PageHeader title="Care gaps" subtitle="Visits and conditions worth a follow-up, from your own claims" />
      <nav className="mb-6 flex flex-wrap gap-2" aria-label="Care gap lists">
        {TABS.map((t) => (
          <Link key={t.key} href={`/reports/care-gaps?tab=${t.key}`} aria-current={t.key === tab ? "page" : undefined} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${t.key === tab ? "bg-brand-700 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700"}`}>{t.label}</Link>
        ))}
      </nav>

      {tab === "awv" && await (async () => {
        const gaps = await awvGaps(db, s.practiceId);
        return (
          <Card title={`Medicare annual wellness visits due · ${gaps.length}`} actions={canWrite && gaps.length ? <ActionForm action={awvOutreachAction}><SubmitButton className="btn btn-secondary text-xs" pendingLabel="Sending...">Send reminders</SubmitButton></ActionForm> : undefined}>
            <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">Medicare patients seen in the last two years whose last wellness visit (G0438, G0439) here was 11 full months ago or more, or who have none on record. Reminders go by text or email to patients who have not opted out, at most once in 60 days.</p>
            {gaps.length === 0 ? <Empty>No Medicare patient is due.</Empty> : (
              <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-700">
                {gaps.map((g) => <li key={g.patientId} className="flex flex-wrap justify-between gap-2 py-2"><span>{patientLink(g.patientId, g.name)}{g.provider ? ` · Dr. ${g.provider}` : ""}</span><span className="text-slate-600 dark:text-slate-400">{g.lastAwv ? `last AWV ${fmtDate(g.lastAwv)}, due ${fmtDate(g.dueOn)}` : "no AWV on record"} · last visit {fmtDate(g.lastVisit)}</span></li>)}
              </ul>
            )}
          </Card>
        );
      })()}

      {tab === "ccm" && await (async () => {
        const r = await ccmCandidates(db, s.practiceId);
        return (
          <div className="grid gap-6 lg:grid-cols-3">
            <Card title={`Chronic care management candidates · ${r.candidates.length}`} className="lg:col-span-2">
              <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">Patients with two or more of your chronic condition groups coded in the last year, not enrolled in chronic care management. Record consent and log time on the patient&apos;s page.</p>
              {r.candidates.length === 0 ? <Empty>No candidates.</Empty> : (
                <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-700">
                  {r.candidates.map((c) => <li key={c.patientId} className="flex flex-wrap justify-between gap-2 py-2"><span>{patientLink(c.patientId, c.name)}</span><span className="font-mono text-xs text-slate-600 dark:text-slate-400">{c.groups} · last {fmtDate(c.lastVisit)}</span></li>)}
                </ul>
              )}
            </Card>
            <Card title="Chronic condition groups">
              <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">Diagnosis code prefixes counted as chronic conditions. The starting list is an example; set your own.</p>
              <p className="mb-3 font-mono text-xs">{r.prefixes.join(", ")}</p>
              {s.role === "admin" && (
                <ActionForm action={chronicPrefixesAction} className="space-y-2 text-sm">
                  <textarea name="prefixes" rows={3} className="input font-mono text-xs" defaultValue={r.prefixes.join(", ")} aria-label="Chronic condition prefixes" />
                  <SubmitButton pendingLabel="Saving...">Save</SubmitButton>
                </ActionForm>
              )}
            </Card>
          </div>
        );
      })()}

      {tab === "hcc" && await (async () => {
        const r = await hccRecapture(db, s.practiceId);
        return (
          <Card title={`Conditions coded last year, not yet this year · ${r.gaps.length}`}>
            {!r.mappingYear ? (
              <Empty action={<Link href="/settings/code-sets" className="btn btn-primary">Code sets</Link>}>Load CMS&apos;s ICD-10 to HCC mapping for the year to see risk-adjusting conditions that have not been addressed yet.</Empty>
            ) : r.gaps.length === 0 ? <Empty>Every risk-adjusting condition coded last year has been coded again this year.</Empty> : (
              <>
                <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">Using the {r.mappingYear} mapping. Each condition must be assessed and documented at a visit this year to count; code it only if it is still present and addressed.</p>
                <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-700">
                  {r.gaps.map((g) => <li key={`${g.patientId}-${g.hcc}`} className="flex flex-wrap justify-between gap-2 py-2"><span>{patientLink(g.patientId, g.name)}{g.provider ? ` · Dr. ${g.provider}` : ""}</span><span className="text-slate-600 dark:text-slate-400">HCC {g.hcc} · <span className="font-mono">{g.code}</span> last coded {fmtDate(g.lastCoded)}</span></li>)}
                </ul>
              </>
            )}
          </Card>
        );
      })()}
    </>
  );
}
