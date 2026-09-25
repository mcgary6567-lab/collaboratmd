import Link from "next/link";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { followUpList } from "@/server/followup";
import { nextStep } from "@/lib/edi/x276";
import { checkStatusAction, runFollowUpAction } from "@/app/(app)/followup-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Empty, Money, PageHeader, Stat, StatusBadge } from "@/components/ui";
import { fmtDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

const TONE: Record<string, "slate" | "green" | "red" | "amber" | "blue"> = {
  wait: "blue", post_era: "green", work_denial: "red", send_info: "amber", fix_and_resubmit: "red", call_payer: "amber",
};

export default async function FollowUpPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const { show } = await searchParams;
  const s = await requireSession();
  const db = await getDb();
  const all = await followUpList(db, s.practiceId, 30, 300);
  const needsAction = all.filter((r) => !r.last || r.last.nextAction !== "wait");
  const rows = show === "all" ? all : needsAction;
  const unchecked = all.filter((r) => !r.last).length;
  const total = all.reduce((a, r) => a + r.claim.totalCents, 0);

  return (
    <>
      <PageHeader
        title="Unpaid claim follow-up"
        subtitle="Claims accepted more than 30 days ago and still unpaid, with what the payer said when asked"
        actions={
          <ActionForm action={runFollowUpAction} className="flex flex-col items-end">
            <SubmitButton className="btn btn-primary" pendingLabel="Asking payers...">Check status of due claims</SubmitButton>
          </ActionForm>
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Unpaid past 30 days" value={all.length.toLocaleString()} hint="claims" />
        <Stat label="Billed amount waiting" value={`$${(total / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`} />
        <Stat label="Never asked" value={unchecked.toLocaleString()} hint="no status check yet" tone={unchecked ? "bad" : "good"} />
      </div>
      <Card
        title={show === "all" ? `All unpaid claims (${all.length})` : `Needs action (${needsAction.length})`}
        actions={
          <Link href={show === "all" ? "/claims/follow-up" : "/claims/follow-up?show=all"} className="text-xs font-semibold text-brand-700 hover:underline">
            {show === "all" ? "Show only claims needing action" : "Show all, including in process"}
          </Link>
        }
      >
        {rows.length === 0 ? (
          <Empty>No unpaid claims need attention.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Claim</th><th>Patient</th><th>Payer</th><th>Sent</th><th className="text-right">Days</th><th className="text-right">Billed</th><th>Payer says</th><th>Next step</th><th /></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const step = r.last?.category ? nextStep({ category: r.last.category }) : null;
                  const action = r.last?.nextAction ?? "unchecked";
                  return (
                    <tr key={r.claim.id}>
                      <td>
                        <Link href={`/claims/${r.claim.id}`} className="font-mono text-xs font-semibold text-brand-700 hover:underline">{r.claim.controlNumber}</Link>
                        <div><StatusBadge status={r.claim.status} /></div>
                      </td>
                      <td>{r.patientName}</td>
                      <td className="text-xs">{r.payerName}</td>
                      <td className="whitespace-nowrap text-xs">{fmtDate(r.claim.submittedAt)}</td>
                      <td className={`text-right tabular-nums ${r.ageDays > 60 ? "font-semibold text-red-700" : ""}`}>{r.ageDays}</td>
                      <td className="text-right"><Money cents={r.claim.totalCents} /></td>
                      <td className="max-w-xs text-xs">
                        {r.last ? (r.last.error ? <span className="text-red-700">{r.last.error}</span> : r.last.message) : <span className="text-slate-400">Not asked yet</span>}
                        {r.last && <div className="text-[10px] text-slate-400">asked {fmtDate(r.last.checkedAt)}</div>}
                      </td>
                      <td><Badge tone={TONE[action] ?? "slate"}>{step?.label ?? (r.last?.error ? "Call the payer" : "Ask the payer")}</Badge></td>
                      <td>
                        <form action={checkStatusAction.bind(null, r.claim.id)}>
                          <button className="btn btn-secondary whitespace-nowrap text-xs">Check now</button>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
