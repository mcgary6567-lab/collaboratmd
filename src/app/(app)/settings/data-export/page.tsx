import { getDb } from "@/db";
import { requireRole } from "@/lib/auth";
import { auditEvents } from "@/server/compliance";
import { fileStore } from "@/server/files";
import { KEEP_DAYS, listExports } from "@/server/export-jobs";
import { prepareExportAction } from "@/app/(app)/export-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, PageHeader } from "@/components/ui";
import { fmtDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";
// The background export runs after the action's response, within this limit.
export const maxDuration = 300;

const TONE = { queued: "slate", running: "blue", done: "green", failed: "red", expired: "slate" } as const;

export default async function DataExportPage() {
  const s = await requireRole(["admin"]);
  const db = await getDb();
  const background = !!fileStore();
  const [events, jobs] = await Promise.all([
    auditEvents(db, s.practiceId, { action: "export", limit: 200 }).then((e) => e.filter((x) => x.event.entity === "practice").slice(0, 10)),
    background ? listExports(db, s.practiceId) : Promise.resolve([]),
  ]);
  return (
    <>
      <PageHeader title="Data export" subtitle="Everything your practice has in CollaboratMD, in one download. Your data is yours to keep or take elsewhere." />
      <div className="grid gap-6 lg:grid-cols-5">
        <Card title="Download" className="lg:col-span-3">
          <div className="space-y-3 text-sm text-slate-600">
            <p>A zip with one spreadsheet (CSV) per kind of record: patients, insurance, visits, charges, claims and their history, remittances, the ledger, denials, appointments, statements, payment plans, tasks, notes, settings and the audit log. Claim attachments are included as the original files.</p>
            <p>Passwords, second-factor secrets, API keys and connection tokens are left out. A README in the zip lists every file, the row counts and what was left out.</p>
            <p>The file contains protected health information. Store it somewhere encrypted and access-controlled. Every export and download is recorded in the audit log.</p>
            {background ? (
              <>
                <ActionForm action={prepareExportAction}><SubmitButton pendingLabel="Starting...">Prepare an export</SubmitButton></ActionForm>
                <p className="text-xs text-slate-500">The export is built in the background and kept for {KEEP_DAYS} days. You get a notification when it is ready.</p>
              </>
            ) : (
              <>
                <a href="/api/export/practice" className="btn btn-primary">Download everything</a>
                <p className="text-xs text-slate-500">Large practices can take a few minutes. Keep this tab open until the download finishes.</p>
              </>
            )}
          </div>
          {jobs.length > 0 && (
            <ul className="mt-4 divide-y divide-slate-100 border-t border-slate-200 text-sm">
              {jobs.map((j) => (
                <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>{fmtDateTime(j.createdAt)} <Badge tone={TONE[j.status as keyof typeof TONE] ?? "slate"}>{j.status}</Badge>{j.error ? <span className="ml-2 text-red-700">{j.error}</span> : null}</span>
                  {j.status === "done" && <a className="font-semibold text-brand-700 hover:underline" href={`/api/export/files/${j.id}`}>Download ({((j.bytes ?? 0) / 1e6).toFixed(1)} MB)</a>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Recent full exports" className="lg:col-span-2">
          {events.length ? (
            <ul className="space-y-2 text-sm">
              {events.map(({ event, userName }) => <li key={event.id} className="flex justify-between gap-2"><span>{userName ?? "Someone"}</span><span className="text-slate-500">{fmtDateTime(event.at)}</span></li>)}
            </ul>
          ) : <p className="text-sm text-slate-500">No full exports yet.</p>}
        </Card>
      </div>
    </>
  );
}
