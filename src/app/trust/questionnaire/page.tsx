import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { getDb } from "@/db";
import { PageShell } from "@/components/page-shell";
import { QUESTIONNAIRE, QUESTIONNAIRE_UPDATED } from "@/content/security-questionnaire";
import { lastRestoreTest } from "@/server/restore-tests";
import { fmtDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Security questionnaire",
  description: "CollaboratMD's answers to the security questions practices and billing companies ask vendors, with what is done and what is not yet.",
};

export default async function QuestionnairePage() {
  const last = await lastRestoreTest(await getDb()).catch(() => null);
  const sections = [...new Set(QUESTIONNAIRE.map((q) => q.section))];
  return (
    <PageShell eyebrow="Trust center" title="Security questionnaire" lead="Answers to the questions a practice's compliance officer or a hospital's vendor review usually asks. Paste them into your own form, or send us yours." meta={`Last updated ${fmtDate(QUESTIONNAIRE_UPDATED)}`}>
      <div className="mb-8 flex flex-wrap gap-3">
        <a href="/trust/questionnaire/csv" className="btn bg-green-700 text-white hover:bg-green-800"><Download className="h-4 w-4" /> Download as CSV</a>
        <Link href="/contact?topic=security" className="btn btn-secondary">Send us your questionnaire</Link>
        <Link href="/trust" className="btn btn-secondary">Trust center</Link>
      </div>
      <p className="mb-8 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
        <b>Most recent backup restore test:</b>{" "}
        {last ? `${fmtDate(last.testedAt, "America/New_York")}, ${last.result === "passed" ? "passed" : "failed"}${last.minutes !== null ? ` in ${last.minutes} minutes` : ""}.` : "none recorded yet."}
      </p>
      {sections.map((sec) => (
        <section key={sec} className="mb-10">
          <h2 className="mb-3 text-xl font-bold tracking-tight text-slate-900">{sec}</h2>
          <dl className="divide-y divide-slate-200 rounded-2xl border border-slate-200">
            {QUESTIONNAIRE.filter((q) => q.section === sec).map((q) => (
              <div key={q.id} className="grid gap-1 p-4 sm:grid-cols-5 sm:gap-6">
                <dt className="text-sm font-semibold text-slate-900 sm:col-span-2"><span className="mr-2 font-mono text-xs text-slate-500">{q.id}</span>{q.question}</dt>
                <dd className="text-sm text-slate-700 sm:col-span-3">{q.answer}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </PageShell>
  );
}
