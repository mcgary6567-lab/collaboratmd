import Link from "next/link";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { listDenials } from "@/server/reports";
import { denialStatusAction } from "@/app/(app)/actions";
import { Card, PageHeader, PatientLink, Money, Badge, Empty, StatusBadge } from "@/components/ui";
import { fmtDate, daysAgo } from "@/lib/utils";

export const dynamic = "force-dynamic";

const FILTERS = ["open", "in_progress", "appealed", "resolved", "written_off", ""];

export default async function DenialsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const sp = await searchParams;
  const status = sp.status === undefined ? "open" : sp.status;
  const s = await requireSession();
  const db = await getDb();
  const { rows, total, totalCents, categories, truncated } = await listDenials(db, s.practiceId, status || undefined);

  return (
    <>
      <PageHeader
        title="Denial management"
        subtitle={`${total.toLocaleString()} denials · ${(totalCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })} at risk${truncated ? ` · showing the ${rows.length} most urgent` : ""}`}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <Link key={f} href={f ? `/denials?status=${f}` : "/denials?status="} className={`rounded-full px-3 py-1 text-xs font-semibold ${status === f ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
            {f ? f.replace(/_/g, " ") : "All"}
          </Link>
        ))}
        <span className="ml-auto text-xs text-slate-500">
          Patterns: {categories.map((c) => `${c.category.replace(/_/g, " ")} ${c.count.toLocaleString()}`).join(" · ") || "none"}
        </span>
      </div>
      {rows.length === 0 ? (
        <Card><Empty>No denials in this view.</Empty></Card>
      ) : (
        <div className="space-y-3">
          {rows.map(({ denial, claim, patient, payer }) => {
            const deadlineDays = denial.appealDeadline ? -daysAgo(denial.appealDeadline + "T00:00:00") : null;
            return (
              <div key={denial.id} className="card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/claims/${claim.id}`} className="font-mono font-semibold text-brand-700 hover:underline">{claim.controlNumber}</Link>
                  <PatientLink id={patient.id} first={patient.firstName} last={patient.lastName} />
                  <span className="text-sm text-slate-500">{payer.name}</span>
                  <Badge tone="red">CARC {denial.carc}</Badge>
                  {denial.rarc && <Badge tone="amber">RARC {denial.rarc}</Badge>}
                  <Badge>{denial.category.replace(/_/g, " ")}</Badge>
                  <StatusBadge status={claim.status} />
                  <span className="ml-auto font-semibold"><Money cents={denial.amountCents} /></span>
                </div>
                <p className="mt-2 text-sm text-slate-800">{denial.explanation}</p>
                {denial.nextSteps && denial.nextSteps.length > 0 && (
                  <ol className="mt-1 list-decimal pl-5 text-sm text-slate-600">
                    {denial.nextSteps.map((st, i) => (
                      <li key={i}>{st}</li>
                    ))}
                  </ol>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-slate-500">Received {fmtDate(denial.createdAt)}</span>
                  {deadlineDays !== null && (
                    <span className={`font-semibold ${deadlineDays < 14 ? "text-red-700" : "text-slate-600"}`}>· Appeal deadline {fmtDate(denial.appealDeadline + "T00:00:00")} ({deadlineDays < 0 ? `${-deadlineDays}d overdue` : `${deadlineDays}d left`})</span>
                  )}
                  <span className="ml-auto flex gap-1">
                    {denial.status !== "in_progress" && !["resolved", "written_off"].includes(denial.status) && (
                      <form action={denialStatusAction.bind(null, denial.id, "in_progress")}><button className="btn btn-secondary text-xs">Start working</button></form>
                    )}
                    {!["appealed", "resolved", "written_off"].includes(denial.status) && (
                      <form action={denialStatusAction.bind(null, denial.id, "appealed")}><button className="btn btn-secondary text-xs">Mark appealed</button></form>
                    )}
                    {!["resolved", "written_off"].includes(denial.status) && (
                      <form action={denialStatusAction.bind(null, denial.id, "resolved")}><button className="btn btn-primary text-xs">Resolve</button></form>
                    )}
                    <Link href={`/claims/${claim.id}`} className="btn btn-secondary text-xs">Open claim</Link>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
