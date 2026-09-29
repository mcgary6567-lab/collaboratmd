import type { Metadata } from "next";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { PATIENT_FIELDS } from "@/lib/import/patients";
import { MAX_IMPORT_ROWS, listImportJobs } from "@/server/import";
import { Card, PageHeader } from "@/components/ui";
import { fmtDateTime } from "@/lib/utils";
import { Importer } from "./importer";
import { listTemplates } from "@/server/import-templates";
import { isPlatformOperator } from "@/server/code-sets";
import { shareImportTemplateAction } from "@/app/(app)/integration-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";

export const metadata: Metadata = { title: "Import patients" };

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const s = await requireSession();
  const db = await getDb();
  const [jobs, templates] = await Promise.all([listImportJobs(db, s.practiceId), listTemplates(db, s.practiceId)]);
  const operator = isPlatformOperator(s.email);
  const own = templates.filter((t) => !t.id.startsWith("shared:"));

  return (
    <>
      <PageHeader title="Import patients" subtitle="Bring a patient list from any EHR or practice management system" />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Importer fields={PATIENT_FIELDS.map(({ key, label }) => ({ key, label }))} maxRows={MAX_IMPORT_ROWS} templates={templates} />
          {operator && own.length > 0 && (
            <Card title="Share a mapping with every practice" className="mt-6">
              <p className="mb-3 text-sm text-slate-600">For a mapping made from a real export of another system. Practices uploading a file with the same columns get it applied automatically.</p>
              <ul className="space-y-3">
                {own.map((t) => (
                  <li key={t.id}>
                    <ActionForm action={shareImportTemplateAction.bind(null, t.id)} className="flex flex-wrap items-end gap-2 text-sm">
                      <span className="w-full font-medium">{t.name}</span>
                      <label className="block"><span className="label">Shared name</span><input name="name" className="input" placeholder="e.g. Tebra patient list" required /></label>
                      <SubmitButton className="btn btn-secondary" pendingLabel="Sharing...">Share</SubmitButton>
                    </ActionForm>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
        <Card title="Recent imports">
          {jobs.length === 0 ? (
            <p className="text-sm text-slate-500">None yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {jobs.map((j) => (
                <li key={j.id} className="border-b border-slate-100 pb-2 last:border-0">
                  <div className="truncate font-medium" title={j.filename}>{j.filename}</div>
                  <div className="text-xs text-slate-500">
                    {fmtDateTime(j.createdAt, s.timeZone)} · {j.created} created, {j.updated} updated, {j.skipped} skipped · mapped by {j.mappedBy === "ai" ? "AI" : j.mappedBy}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
