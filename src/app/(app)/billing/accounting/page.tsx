import Link from "next/link";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { ACCOUNTS, accountNames, closes, journalLines, periodTotals } from "@/server/accounting";
import { lastMonth } from "@/server/client-billing";
import { accountNamesAction, closePeriodAction, reopenPeriodAction } from "@/app/(app)/ops-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Empty, Money, PageHeader } from "@/components/ui";
import { fmtDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

const LABEL: Record<string, string> = {
  charge: "Charges", insurance_payment: "Insurance payments", patient_payment: "Patient payments", adjustment: "Contractual adjustments", write_off: "Write-offs",
  transfer_to_patient: "To patient responsibility", discount: "Discounts", bad_debt: "Bad debt", refund: "Refunds", reversal: "Recoupments",
};

export default async function AccountingPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const { period: requested } = await searchParams;
  const s = await requireSession();
  const db = await getDb();
  const period = /^\d{4}-(0[1-9]|1[0-2])$/.test(requested ?? "") ? requested! : lastMonth();
  const [totals, names, closed] = await Promise.all([periodTotals(db, s.practiceId, period), accountNames(db, s.practiceId), closes(db, s.practiceId)]);
  const lines = journalLines(totals, names);
  const debits = lines.reduce((a, l) => a + l.debitCents, 0);
  const credits = lines.reduce((a, l) => a + l.creditCents, 0);
  const isClosed = closed.find((c) => c.period === period);
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1 - i, 1)).toISOString().slice(0, 7);
  });
  const canClose = ["admin", "biller"].includes(s.role);

  return (
    <>
      <PageHeader title="Accounting" subtitle="The month's billing activity as a journal entry for your books, and month-end close" actions={<Link href="/reports" className="btn btn-secondary">Reports</Link>} />
      <div className="mb-4 flex flex-wrap gap-2">
        {months.map((m) => (
          <Link key={m} href={`/billing/accounting?period=${m}`} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${m === period ? "bg-brand-600 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"}`}>{m}</Link>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title={`Journal entry, ${period}`} className="lg:col-span-2" actions={isClosed ? <Badge tone="green">closed</Badge> : undefined}>
          {lines.length === 0 ? <Empty>Nothing was posted in {period}.</Empty> : (
            <>
              <table className="table">
                <thead><tr><th>Account</th><th>For</th><th className="text-right">Debit</th><th className="text-right">Credit</th></tr></thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={i}>
                      <td className={l.creditCents ? "pl-8" : ""}>{l.account}</td>
                      <td className="text-xs text-slate-500">{l.memo}</td>
                      <td className="text-right">{l.debitCents ? <Money cents={l.debitCents} /> : ""}</td>
                      <td className="text-right">{l.creditCents ? <Money cents={l.creditCents} /> : ""}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <td colSpan={2}>Totals {debits === credits ? "(balanced)" : "(NOT balanced)"}</td>
                    <td className="text-right"><Money cents={debits} /></td>
                    <td className="text-right"><Money cents={credits} /></td>
                  </tr>
                </tbody>
              </table>
              <div className="mt-4 flex flex-wrap gap-2">
                <a href={`/api/accounting/journal?period=${period}`} className="btn btn-primary text-xs">Download CSV (debit and credit columns)</a>
                <a href={`/api/accounting/journal?period=${period}&format=signed`} className="btn btn-secondary text-xs">Download CSV (signed amounts, for Xero)</a>
              </div>
              <p className="mt-2 text-xs text-slate-500">Dated the last day of the month, by posting date. Import it as a journal entry and map the columns; for Xero, set the account names below to your account codes.</p>
            </>
          )}
          {canClose && (
            <div className="mt-4 border-t border-slate-200 pt-4">
              {isClosed ? (
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <span>Closed {fmtDateTime(isClosed.closedAt)}.</span>
                  {isClosed.changes.length > 0 && <Badge tone="amber">changed since close</Badge>}
                  <ActionForm action={closePeriodAction.bind(null, period)}><SubmitButton className="btn btn-secondary text-xs" pendingLabel="...">Close again with today&apos;s figures</SubmitButton></ActionForm>
                  {s.role === "admin" && <ActionForm action={reopenPeriodAction.bind(null, period)}><SubmitButton className="btn btn-secondary text-xs" pendingLabel="...">Reopen</SubmitButton></ActionForm>}
                </div>
              ) : (
                <ActionForm action={closePeriodAction.bind(null, period)}><SubmitButton className="btn btn-secondary text-xs" pendingLabel="Closing...">Close {period}</SubmitButton></ActionForm>
              )}
            </div>
          )}
        </Card>

        <div className="space-y-6">
          <Card title="Closed months">
            {closed.length === 0 ? (
              <p className="text-sm text-slate-500">None yet. Closing a month stores its totals, so anything posted into it later stands out here.</p>
            ) : (
              <ul className="space-y-3 text-sm">
                {closed.map((c) => (
                  <li key={c.period}>
                    <Link href={`/billing/accounting?period=${c.period}`} className="font-semibold text-brand-700 hover:underline">{c.period}</Link>{" "}
                    {c.changes.length ? <Badge tone="amber">changed</Badge> : <Badge tone="green">matches</Badge>}
                    {c.changes.map((ch) => (
                      <div key={ch.type} className="text-xs text-slate-600">{LABEL[ch.type] ?? ch.type}: <Money cents={ch.closed} /> at close, <Money cents={ch.now} /> now</div>
                    ))}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Account names">
            {s.role === "admin" ? (
              <ActionForm action={accountNamesAction} className="space-y-2 text-xs">
                {Object.entries(ACCOUNTS).map(([k, a]) => {
                  const current = names[k as keyof typeof names];
                  return <label key={k} className="block">{a.label}<input name={k} defaultValue={current === a.default ? "" : current} placeholder={a.default} className="input mt-1" /></label>;
                })}
                <SubmitButton className="btn btn-secondary text-xs" pendingLabel="Saving...">Save</SubmitButton>
              </ActionForm>
            ) : <p className="text-sm text-slate-500">An administrator can match these to your chart of accounts.</p>}
          </Card>
        </div>
      </div>
    </>
  );
}
