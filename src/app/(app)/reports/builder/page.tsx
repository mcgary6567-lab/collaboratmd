import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireSession } from "@/lib/auth";
import { DATASETS, getReport, listReports, normalizeConfig, RANGES, runReport } from "@/server/report-builder";
import { deleteReportAction, saveReportAction } from "@/app/(app)/report-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Alert, Badge, Card, Empty, PageHeader } from "@/components/ui";
import { fmtDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const many = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []);
const usd = (c: number | null) => (c === null ? "" : `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

export default async function ReportBuilderPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const s = await requireSession();
  const db = await getDb();
  const [saved, payers, providers] = await Promise.all([
    listReports(db, s.practiceId),
    db.select({ id: schema.payers.id, name: schema.payers.name }).from(schema.payers).where(eq(schema.payers.practiceId, s.practiceId)).orderBy(asc(schema.payers.name)),
    db.select({ id: schema.providers.id, first: schema.providers.firstName, last: schema.providers.lastName }).from(schema.providers).where(eq(schema.providers.practiceId, s.practiceId)).orderBy(asc(schema.providers.lastName)),
  ]);
  const report = one(sp.id) ? await getReport(db, s.practiceId, one(sp.id)) : null;
  const dataset = report && !one(sp.dataset) ? report.dataset : one(sp.dataset) in DATASETS ? one(sp.dataset) : "claims";
  const ds = DATASETS[dataset];
  const fromForm = one(sp.run) === "1";
  const config = report && !fromForm
    ? normalizeConfig(dataset, report.config)
    : normalizeConfig(dataset, { columns: many(sp.col), group: one(sp.group) || null, range: one(sp.range) || "30d", payerId: one(sp.payer) || null, providerId: one(sp.provider) || null, status: one(sp.status) || null });
  const result = await runReport(db, s.practiceId, dataset, config, { limit: 200 });
  const canSave = ["admin", "biller"].includes(s.role);
  const keepQuery = new URLSearchParams([["dataset", dataset], ["run", "1"], ...config.columns.map((c) => ["col", c]), ["group", config.group ?? ""], ["range", config.range], ["payer", config.payerId ?? ""], ["provider", config.providerId ?? ""], ["status", config.status ?? ""], ...(report ? [["id", report.id]] : [])] as [string, string][]);

  return (
    <>
      <PageHeader title="Report builder" subtitle="Choose the data, columns and grouping; save a report and have it emailed on a schedule" actions={<Link href="/reports" className="btn btn-secondary">Standard reports</Link>} />
      {one(sp.saved) && <Alert kind="success">Report saved.</Alert>}

      <div className="grid gap-6 lg:grid-cols-4">
        <div className="space-y-6 lg:col-span-1">
          <Card title="Saved reports">
            {saved.length === 0 ? <p className="text-sm text-slate-500">None yet.</p> : (
              <ul className="space-y-2 text-sm">
                {saved.map((r) => (
                  <li key={r.id}>
                    <Link href={`/reports/builder?id=${r.id}`} className={`font-medium hover:underline ${report?.id === r.id ? "text-brand-700" : "text-slate-800"}`}>{r.name}</Link>
                    <div className="text-xs text-slate-500">{DATASETS[r.dataset]?.label} · {r.schedule === "none" ? "not scheduled" : `emailed ${r.schedule}`}</div>
                  </li>
                ))}
              </ul>
            )}
            <Link href="/reports/builder" className="mt-3 inline-block text-xs font-semibold text-brand-700 hover:underline">+ New report</Link>
          </Card>
        </div>

        <div className="space-y-6 lg:col-span-3">
          <Card title={report ? `Editing: ${report.name}` : "Build a report"}>
            <form action="/reports/builder" className="space-y-4">
              {report && <input type="hidden" name="id" value={report.id} />}
              <input type="hidden" name="run" value="1" />
              <div className="grid gap-3 md:grid-cols-4">
                <label className="block text-sm"><span className="label">Data</span>
                  <select name="dataset" defaultValue={dataset} className="input">
                    {Object.entries(DATASETS).map(([k, d]) => <option key={k} value={k}>{d.label}</option>)}
                  </select>
                </label>
                <label className="block text-sm"><span className="label">{ds.dateLabel}</span>
                  <select name="range" defaultValue={config.range} className="input">
                    {Object.entries(RANGES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </label>
                <label className="block text-sm"><span className="label">Group by</span>
                  <select name="group" defaultValue={config.group ?? ""} className="input">
                    <option value="">No grouping (rows)</option>
                    {Object.entries(ds.groups).map(([k, g]) => <option key={k} value={k}>{g.label}</option>)}
                  </select>
                </label>
                {ds.statuses && (
                  <label className="block text-sm"><span className="label">Status</span>
                    <select name="status" defaultValue={config.status ?? ""} className="input">
                      <option value="">Any</option>
                      {ds.statuses.map((st) => <option key={st} value={st}>{st.replace(/_/g, " ")}</option>)}
                    </select>
                  </label>
                )}
                <label className="block text-sm"><span className="label">Payer</span>
                  <select name="payer" defaultValue={config.payerId ?? ""} className="input">
                    <option value="">All payers</option>
                    {payers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
                <label className="block text-sm"><span className="label">Provider</span>
                  <select name="provider" defaultValue={config.providerId ?? ""} className="input">
                    <option value="">All providers</option>
                    {providers.map((p) => <option key={p.id} value={p.id}>{p.last}, {p.first}</option>)}
                  </select>
                </label>
              </div>
              <fieldset>
                <legend className="label">Columns</legend>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {Object.entries(ds.columns).map(([k, c]) => (
                    <label key={k} className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="col" value={k} defaultChecked={config.columns.includes(k)} /> {c.label}</label>
                  ))}
                </div>
                <p className="mt-1 text-xs text-slate-500">{ds.description}. When grouped, money columns are totaled.</p>
              </fieldset>
              <button className="btn btn-primary">Run report</button>
            </form>
          </Card>

          <Card
            title={`Results · ${result.rowCount.toLocaleString("en-US")} ${config.group ? "groups" : "rows"}${result.truncated ? " (first 200 shown; download for all)" : ""}`}
            actions={report ? <a href={`/api/export/report?id=${report.id}`} className="btn btn-secondary text-xs">Download CSV</a> : <span className="text-xs text-slate-500">Save to download all rows</span>}
          >
            {result.rows.length === 0 ? <Empty>No data for these filters.</Empty> : (
              <div className="max-h-[32rem] overflow-auto">
                <table className="table text-sm">
                  <thead className="sticky top-0 bg-white"><tr>{result.headers.map((h) => <th key={h.key} className={h.kind === "money" || h.kind === "number" ? "text-right" : ""}>{h.label}</th>)}</tr></thead>
                  <tbody>
                    {result.rows.map((r, i) => (
                      <tr key={i}>{result.headers.map((h) => <td key={h.key} className={h.kind === "money" || h.kind === "number" ? "text-right tabular-nums" : ""}>{h.kind === "money" ? usd(r[h.key] as number | null) : String(r[h.key] ?? "")}</td>)}</tr>
                    ))}
                  </tbody>
                  {Object.keys(result.totals).length > 0 && (
                    <tfoot><tr className="font-semibold">{result.headers.map((h, i) => <td key={h.key} className={h.kind === "money" || h.kind === "number" ? "text-right tabular-nums" : ""}>{h.key in result.totals ? (h.kind === "money" ? usd(result.totals[h.key]) : result.totals[h.key].toLocaleString("en-US")) : i === 0 ? "Total" : ""}</td>)}</tr></tfoot>
                  )}
                </table>
              </div>
            )}
          </Card>

          {canSave && (
            <Card title={report ? "Save changes" : "Save this report"}>
              <ActionForm action={saveReportAction} className="grid gap-3 md:grid-cols-3">
                {[...keepQuery.entries()].filter(([k]) => !["run"].includes(k)).map(([k, v], i) => <input key={`${k}-${i}`} type="hidden" name={k} value={v} />)}
                <label className="block text-sm"><span className="label">Name</span><input name="name" defaultValue={report?.name ?? ""} className="input" required maxLength={120} placeholder="Monthly denials by payer" /></label>
                <label className="block text-sm"><span className="label">Email it</span>
                  <select name="schedule" defaultValue={report?.schedule ?? "none"} className="input"><option value="none">Never</option><option value="weekly">Every Monday</option><option value="monthly">On the 1st of the month</option></select>
                </label>
                <label className="block text-sm"><span className="label">To (emails, comma separated)</span><input name="recipients" defaultValue={report?.recipients.join(", ") ?? ""} className="input" placeholder="owner@practice.com" /></label>
                <div className="flex flex-wrap items-center gap-3 md:col-span-3">
                  <SubmitButton pendingLabel="Saving...">{report ? "Save changes" : "Save report"}</SubmitButton>
                  <span className="text-xs text-slate-500">Scheduled emails carry the totals and a sign-in link, never patient rows. They need email connected in Integrations.</span>
                  {report?.lastSentAt && <Badge tone="green">Last emailed {fmtDateTime(report.lastSentAt)}</Badge>}
                </div>
              </ActionForm>
              {report && (
                <ActionForm action={deleteReportAction.bind(null, report.id)} className="mt-3">
                  <SubmitButton className="text-xs text-red-700 underline" pendingLabel="Deleting...">Delete this report</SubmitButton>
                </ActionForm>
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
