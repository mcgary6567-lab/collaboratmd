import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireSession } from "@/lib/auth";
import { searchClaims } from "@/server/lists";
import { assignableUsers, listViews, openTaskCounts } from "@/server/work";
import { Card, PageHeader, StatusBadge, PatientLink, Money, Empty } from "@/components/ui";
import { Pager, SortHeader, pageArgs, withParams, type Params } from "@/components/data-table";
import { ClaimBulkBar, SavedViews, SelectAll } from "@/components/list-tools";
import { fmtDate, daysAgo } from "@/lib/utils";
import { SubmitAllButton } from "./submit-all";

export const dynamic = "force-dynamic";

const QUICK = [
  { key: "", label: "All" },
  { key: "open", label: "Open" },
  { key: "needs_work", label: "Needs work" },
  { key: "ready", label: "Ready" },
  { key: "scrub_errors", label: "Scrub errors" },
  { key: "accepted", label: "Accepted" },
  { key: "rejected", label: "Rejected" },
  { key: "denied", label: "Denied" },
  { key: "billed_secondary", label: "At secondary" },
  { key: "paid", label: "Paid" },
  { key: "closed", label: "Closed" },
];

export default async function ClaimsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const s = await requireSession();
  const db = await getDb();
  const { page, pageSize, offset } = pageArgs(params);
  const [{ rows, total }, payers, people, views] = await Promise.all([
    searchClaims(db, s.practiceId, { q: params.q, status: params.status, payerId: params.payer, from: params.from, to: params.to, sort: params.sort, dir: params.dir, offset, limit: pageSize }),
    db.select({ id: schema.payers.id, name: schema.payers.name }).from(schema.payers).where(eq(schema.payers.practiceId, s.practiceId)).orderBy(asc(schema.payers.name)),
    assignableUsers(db, s.practiceId),
    listViews(db, s.userId, s.practiceId, "claims"),
  ]);
  const taskCounts = await openTaskCounts(db, s.practiceId, "claim", rows.map((r) => r.claim.id));
  const query = new URLSearchParams(Object.entries(params).filter(([k, v]) => v && k !== "page") as [string, string][]).toString();

  return (
    <>
      <PageHeader title="Claims" subtitle={`${total.toLocaleString()} claim${total === 1 ? "" : "s"} in this view`} actions={<SubmitAllButton disabled={false} />} />
      <Card>
        <form className="mb-3 grid gap-2 md:grid-cols-[1fr_auto_auto_auto_auto_auto]" action="/claims">
          <input name="q" defaultValue={params.q} className="input" placeholder="Claim number, payer claim number, patient or MRN" />
          <select name="payer" defaultValue={params.payer ?? ""} className="input md:w-44">
            <option value="">All payers</option>
            {payers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input name="from" type="date" defaultValue={params.from} className="input md:w-36" title="Date of service from" />
          <input name="to" type="date" defaultValue={params.to} className="input md:w-36" title="Date of service to" />
          {params.status && <input type="hidden" name="status" value={params.status} />}
          <select name="size" defaultValue={String(pageSize)} className="input md:w-24" title="Rows per page">
            <option value="25">25</option><option value="50">50</option><option value="100">100</option>
          </select>
          <button className="btn btn-primary justify-center">Search</button>
        </form>
        <div className="mb-3 flex flex-wrap gap-1">
          {QUICK.map((st) => (
            <Link key={st.key} href={withParams("/claims", params, { status: st.key || undefined, page: undefined })} className={`rounded-full px-3 py-1 text-xs font-semibold ${(params.status ?? "") === st.key ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
              {st.label}
            </Link>
          ))}
        </div>
        <div className="mb-3"><SavedViews page="claims" query={query} views={views} /></div>
        <ClaimBulkBar people={people} />
        {rows.length === 0 ? (
          <Empty>No claims match. Clear a filter or search for something else.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th className="w-8"><SelectAll /></th>
                  <SortHeader label="Claim" field="claim" base="/claims" params={params} />
                  <SortHeader label="Patient" field="patient" base="/claims" params={params} />
                  <SortHeader label="DOS" field="dos" base="/claims" params={params} />
                  <SortHeader label="Payer" field="payer" base="/claims" params={params} />
                  <SortHeader label="Status" field="status" base="/claims" params={params} />
                  <th>Scrub</th>
                  <SortHeader label="Billed" field="amount" base="/claims" params={params} align="right" />
                  <SortHeader label="Timely filing" field="tf" base="/claims" params={params} />
                </tr>
              </thead>
              <tbody>
                {rows.map(({ claim, patient, payer, encounter }) => {
                  const errors = claim.scrubResults.filter((f) => f.severity === "error").length;
                  const warnings = claim.scrubResults.filter((f) => f.severity === "warning").length;
                  const tfDays = claim.timelyFilingDeadline ? -daysAgo(claim.timelyFilingDeadline + "T00:00:00") : null;
                  const tasks = taskCounts.get(claim.id) ?? 0;
                  return (
                    <tr key={claim.id}>
                      <td><input type="checkbox" name="ids" value={claim.id} form="bulk-claims" aria-label={`Select ${claim.controlNumber}`} /></td>
                      <td className="whitespace-nowrap">
                        <Link href={`/claims/${claim.id}`} className="font-mono text-brand-700 hover:underline">{claim.controlNumber}</Link>
                        {claim.frequencyCode === "7" && <span className="ml-1 text-[10px] font-semibold text-amber-700">CORRECTED</span>}
                        {claim.frequencyCode === "8" && <span className="ml-1 text-[10px] font-semibold text-red-700">VOID</span>}
                        {claim.payerSequence === "S" && <span className="ml-1 text-[10px] font-semibold text-cyan-700">SECONDARY</span>}
                        {tasks > 0 && <span className="ml-1 rounded bg-violet-100 px-1 text-[10px] font-semibold text-violet-800">{tasks} task{tasks > 1 ? "s" : ""}</span>}
                      </td>
                      <td><PatientLink id={patient.id} first={patient.firstName} last={patient.lastName} /></td>
                      <td className="whitespace-nowrap">{fmtDate(encounter.dateOfService + "T00:00:00")}</td>
                      <td className="text-xs">{payer.name}</td>
                      <td><StatusBadge status={claim.status} /></td>
                      <td className="text-xs">
                        {errors > 0 && <span className="mr-1 text-red-700">{errors} err</span>}
                        {warnings > 0 && <span className="text-amber-700">{warnings} warn</span>}
                        {errors === 0 && warnings === 0 && <span className="text-green-700">clean</span>}
                      </td>
                      <td className="text-right"><Money cents={claim.totalCents} /></td>
                      <td className={`whitespace-nowrap text-xs ${tfDays !== null && tfDays < 15 && !["paid", "closed", "voided"].includes(claim.status) ? "font-semibold text-red-700" : "text-slate-500"}`}>
                        {tfDays === null ? "-" : tfDays < 0 ? `${-tfDays}d overdue` : `${tfDays}d left`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pager page={page} pageSize={pageSize} total={total} base="/claims" params={params} />
      </Card>
    </>
  );
}
