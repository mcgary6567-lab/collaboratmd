import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { PATIENT_FIELDS } from "@/lib/import/patients";
import { MAX_IMPORT_ROWS, listImportJobs } from "@/server/import";
import { Card, PageHeader } from "@/components/ui";
import { fmtDateTime } from "@/lib/utils";
import { Importer } from "./importer";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const s = await requireSession();
  const db = await getDb();
  const jobs = await listImportJobs(db, s.practiceId);

  return (
    <>
      <PageHeader title="Import patients" subtitle="Bring a patient list from any EHR or practice management system" />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Importer fields={PATIENT_FIELDS.map(({ key, label }) => ({ key, label }))} maxRows={MAX_IMPORT_ROWS} />
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
                    {fmtDateTime(j.createdAt)} · {j.created} created, {j.updated} updated, {j.skipped} skipped · mapped by {j.mappedBy === "ai" ? "AI" : j.mappedBy}
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
