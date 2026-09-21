import Link from "next/link";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { listClaims } from "@/server/claims";
import { Card, PageHeader, StatusBadge, PatientLink, Money, Empty } from "@/components/ui";
import { fmtDate, daysAgo } from "@/lib/utils";
import { SubmitAllButton } from "./submit-all";

export const dynamic = "force-dynamic";

const STATUSES = ["", "draft", "scrub_errors", "ready", "submitted", "accepted", "rejected", "pending", "paid", "partially_paid", "denied", "closed"];

export default async function ClaimsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const s = await requireSession();
  const db = await getDb();
  const rows = await listClaims(db, s.practiceId, status || undefined);
  const readyCount = rows.filter((r) => r.claim.status === "ready").length;
  return (
    <>
      <PageHeader title="Claims worklist" subtitle={`${rows.length} claim${rows.length === 1 ? "" : "s"}${status ? ` in ${status.replace(/_/g, " ")}` : ""}`} actions={<SubmitAllButton disabled={status ? status !== "ready" : readyCount === 0} />} />
      <Card>
        <div className="mb-4 flex flex-wrap gap-1">
          {STATUSES.map((st) => (
            <Link key={st} href={st ? `/claims?status=${st}` : "/claims"} className={`rounded-full px-3 py-1 text-xs font-semibold ${(status ?? "") === st ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
              {st ? st.replace(/_/g, " ") : "All"}
            </Link>
          ))}
        </div>
        {rows.length === 0 ? (
          <Empty>No claims in this view.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Claim</th><th>Patient</th><th>DOS</th><th>Payer</th><th>Status</th><th>Scrub</th><th className="text-right">Billed</th><th>Age</th><th>Timely filing</th></tr>
            </thead>
            <tbody>
              {rows.map(({ claim, patient, payer, encounter }) => {
                const errors = claim.scrubResults.filter((f) => f.severity === "error").length;
                const warnings = claim.scrubResults.filter((f) => f.severity === "warning").length;
                const tfDays = claim.timelyFilingDeadline ? -daysAgo(claim.timelyFilingDeadline + "T00:00:00") : null;
                return (
                  <tr key={claim.id}>
                    <td>
                      <Link href={`/claims/${claim.id}`} className="font-mono text-brand-700 hover:underline">{claim.controlNumber}</Link>
                      {claim.frequencyCode === "7" && <span className="ml-1 text-[10px] font-semibold text-amber-700">CORRECTED</span>}
                    </td>
                    <td><PatientLink id={patient.id} first={patient.firstName} last={patient.lastName} /></td>
                    <td className="whitespace-nowrap">{fmtDate(encounter.dateOfService + "T00:00:00")}</td>
                    <td>{payer.name}</td>
                    <td><StatusBadge status={claim.status} /></td>
                    <td className="text-xs">
                      {errors > 0 && <span className="mr-1 text-red-700">{errors} err</span>}
                      {warnings > 0 && <span className="text-amber-700">{warnings} warn</span>}
                      {errors === 0 && warnings === 0 && <span className="text-emerald-700">clean</span>}
                    </td>
                    <td className="text-right"><Money cents={claim.totalCents} /></td>
                    <td className="text-slate-500">{daysAgo(encounter.dateOfService + "T00:00:00")}d</td>
                    <td className={`text-xs ${tfDays !== null && tfDays < 15 && !["paid", "closed"].includes(claim.status) ? "font-semibold text-red-700" : "text-slate-500"}`}>
                      {tfDays === null ? "-" : tfDays < 0 ? `${-tfDays}d overdue` : `${tfDays}d left`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
