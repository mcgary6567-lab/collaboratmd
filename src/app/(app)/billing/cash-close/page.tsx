import type { Metadata } from "next";
import { getDb } from "@/db";
import { CAN_WRITE, requireSession } from "@/lib/auth";
import { dayTotals, METHOD_LABEL, recentCloses } from "@/server/cash-close";
import { practiceNow } from "@/server/practice-time";
import { closeDayAction } from "@/app/(app)/finance-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Empty, Money, PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Daily cash close" };
export const dynamic = "force-dynamic";

const isDay = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
const dollars = (c: number) => (c / 100).toFixed(2);

/** End of day at the front desk: counted cash, checks and card batch against the payments posted. */
export default async function CashClosePage({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  const s = await requireSession();
  const db = await getDb();
  const q = await searchParams;
  const today = (await practiceNow(db, s.practiceId)).toISOString().slice(0, 10);
  const day = isDay(q.day) ? q.day! : today;
  const [totals, closes] = await Promise.all([dayTotals(db, s.practiceId, day), recentCloses(db, s.practiceId)]);
  const closed = closes.find((c) => c.day === day);
  const canWrite = (CAN_WRITE as readonly string[]).includes(s.role);
  const desk = ["cash", "check", "card"];
  const elsewhere = Object.entries(totals).filter(([m]) => !desk.includes(m));
  return (
    <>
      <PageHeader title="Daily cash close" subtitle="Count the drawer and read the card batch at the end of the day; any difference is explained before the deposit goes to the bank" />
      <form className="mb-6 flex flex-wrap items-end gap-3 text-sm" action="/billing/cash-close">
        <label className="block"><span className="label">Day</span><input type="date" name="day" defaultValue={day} max={today} className="input" /></label>
        <button className="btn btn-secondary">Show</button>
      </form>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={`Posted on ${fmtDate(`${day}T00:00:00`)}`} actions={closed ? <Badge tone="green">closed</Badge> : undefined}>
          <ul className="space-y-1.5 text-sm">
            {desk.map((m) => <li key={m} className="flex justify-between"><span>{METHOD_LABEL[m]}</span><span className="tabular-nums"><Money cents={totals[m] ?? 0} /></span></li>)}
          </ul>
          {elsewhere.length > 0 && (
            <>
              <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Not at the desk (not counted)</p>
              <ul className="mt-1 space-y-1 text-sm">{elsewhere.map(([m, c]) => <li key={m} className="flex justify-between"><span>{METHOD_LABEL[m] ?? m}</span><span className="tabular-nums"><Money cents={c} /></span></li>)}</ul>
            </>
          )}
        </Card>
        <Card title="Count and close">
          {canWrite ? (
            <ActionForm action={closeDayAction} className="grid gap-3 text-sm sm:grid-cols-3">
              <input type="hidden" name="day" value={day} />
              <label className="block"><span className="label">Cash counted ($)</span><input name="cash" inputMode="decimal" defaultValue={closed ? dollars(closed.countedCashCents) : ""} className="input" required /></label>
              <label className="block"><span className="label">Checks counted ($)</span><input name="checks" inputMode="decimal" defaultValue={closed ? dollars(closed.countedChecksCents) : ""} className="input" required /></label>
              <label className="block"><span className="label">Card batch total ($)</span><input name="cards" inputMode="decimal" defaultValue={closed ? dollars(closed.cardBatchCents) : ""} className="input" required /></label>
              <label className="block sm:col-span-3"><span className="label">Deposit slip or reference</span><input name="deposit" defaultValue={closed?.depositReference ?? ""} className="input" maxLength={80} /></label>
              <label className="block sm:col-span-3"><span className="label">Notes (required when something does not match)</span><input name="notes" defaultValue={closed?.notes ?? ""} className="input" maxLength={1000} /></label>
              <div className="sm:col-span-3"><SubmitButton pendingLabel="Closing...">{closed ? "Close again" : "Close the day"}</SubmitButton></div>
            </ActionForm>
          ) : <p className="text-sm text-slate-500">Read-only.</p>}
        </Card>
      </div>
      <Card title="Recent days" className="mt-6">
        {closes.length === 0 ? <Empty>No days closed yet.</Empty> : (
          <div tabIndex={0} role="region" aria-label="Closed days" className="overflow-x-auto">
            <table className="table table-stack">
              <thead><tr><th>Day</th><th className="text-right">Cash</th><th className="text-right">Checks</th><th className="text-right">Cards</th><th>Deposit</th><th>Notes</th></tr></thead>
              <tbody>{closes.map((c) => (
                <tr key={c.id}>
                  <td data-label="Day">{fmtDate(`${c.day}T00:00:00`)}</td>
                  {(["cash", "check", "card"] as const).map((m) => (
                    <td key={m} data-label={METHOD_LABEL[m]} className="text-right tabular-nums">{c.variance[m] === 0 ? <Badge tone="green">matches</Badge> : <Badge tone="red">{c.variance[m] > 0 ? "over" : "short"} <Money cents={Math.abs(c.variance[m])} /></Badge>}</td>
                  ))}
                  <td data-label="Deposit">{c.depositReference ?? "-"}</td>
                  <td data-label="Notes" className="text-xs">{c.notes ?? ""}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
