import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { contractCalendar } from "@/server/contract-calendar";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { fmtDate, money } from "@/lib/utils";

export const metadata: Metadata = { title: "Contract calendar" };
export const dynamic = "force-dynamic";

const day = (iso: string | null) => (iso ? fmtDate(`${iso}T00:00:00`) : "-");

/** When each payer contract renews, the last day to give notice, and what the payer underpaid. */
export default async function ContractCalendarPage() {
  const s = await requireSession();
  const rows = await contractCalendar(await getDb(), s.practiceId);
  const missing = rows.filter((r) => !r.renewsOn).length;
  return (
    <>
      <PageHeader
        title="Contract calendar"
        subtitle={`Payer contracts by the next date to give notice to renegotiate or end them${missing ? `; ${missing} without a renewal date yet` : ""}`}
        actions={<Link href="/settings/fees" className="btn btn-secondary">Fee schedules</Link>}
      />
      <Card>
        {rows.length === 0 ? <Empty>No payer contracts yet. Create one under Settings, Fee schedules.</Empty> : (
          <div tabIndex={0} role="region" aria-label="Payer contracts" className="overflow-x-auto">
            <table className="table table-stack">
              <thead><tr><th>Payer contract</th><th>Renews</th><th>Notice by</th><th className="text-right">Scheduled increase</th><th className="text-right">Underpaid, last 12 months</th><th className="text-right">Allowed, last 12 months</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.scheduleId}>
                  <td data-label="Payer contract"><Link href={`/settings/fees/${r.scheduleId}`} className="font-semibold text-brand-700 hover:underline">{r.payerName}</Link><div className="text-xs text-slate-500 dark:text-slate-400">{r.name}{r.termsNotes ? ` · ${r.termsNotes}` : ""}</div></td>
                  <td data-label="Renews">{r.renewsOn ? day(r.renewsOn) : <span className="text-slate-500 dark:text-slate-400">Not entered</span>}</td>
                  <td data-label="Notice by">
                    {r.noticeBy ? <>{day(r.noticeBy)} {r.daysToNotice !== null && (r.daysToNotice < 0 ? <Badge>Passed</Badge> : <Badge tone={r.daysToNotice <= 30 ? "red" : r.daysToNotice <= 60 ? "amber" : "slate"}>{r.daysToNotice} days</Badge>)}</> : "-"}
                  </td>
                  <td data-label="Scheduled increase" className="text-right tabular-nums">{r.escalatorPct !== null ? `${r.escalatorPct}%` : "-"}</td>
                  <td data-label="Underpaid, last 12 months" className="text-right tabular-nums">{r.underpaidCents ? <Link href="/underpayments" className="text-brand-700 hover:underline">{money(r.underpaidCents)} ({r.underpaidClaims})</Link> : "-"}</td>
                  <td data-label="Allowed, last 12 months" className="text-right tabular-nums">{money(r.allowedCents)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs leading-6 text-slate-500 dark:text-slate-400">
          Enter each contract&apos;s renewal date and notice period on its fee schedule. Administrators get a reminder 60, 30 and 7 days before the notice date.
          Use the <Link href="/reports/contracts" className="text-brand-700 underline">contract comparison</Link> and <Link href="/reports/fee-check" className="text-brand-700 underline">fee schedule check</Link> to see what each payer pays per code before you negotiate.
        </p>
      </Card>
    </>
  );
}
