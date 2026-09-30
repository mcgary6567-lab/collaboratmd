import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { CAN_ADJUST, CAN_WRITE, requireSession } from "@/lib/auth";
import { listInjuryCases } from "@/server/injury-cases";
import { dropInjuryCaseAction, injuryReductionAction, openInjuryCaseAction, settleInjuryCaseAction } from "@/app/(app)/review-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Empty, Money, PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Personal injury cases" };
export const dynamic = "force-dynamic";

const day = (v: string | null) => (v ? fmtDate(`${v}T00:00:00`) : "-");
const dollars = (c: number | null) => (c === null ? "" : (c / 100).toFixed(2));

/** Attorney liens and letters of protection: balances held until the case settles. */
export default async function InjuryCasesPage() {
  const s = await requireSession();
  const db = await getDb();
  const [open, closed] = await Promise.all([listInjuryCases(db, s.practiceId, "open"), listInjuryCases(db, s.practiceId, "closed")]);
  const canWrite = (CAN_WRITE as readonly string[]).includes(s.role);
  const canAdjust = (CAN_ADJUST as readonly string[]).includes(s.role);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <PageHeader title="Personal injury cases" subtitle="Balances held under an attorney's lien or letter of protection: no statements, reminders, card charges or collections until the case settles" />
      {canWrite && (
        <Card title="Open a case" className="mb-6">
          <ActionForm action={openInjuryCaseAction} className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <label className="block"><span className="label">Patient MRN</span><input name="mrn" className="input" required /></label>
            <label className="block"><span className="label">Attorney</span><input name="attorney" className="input" required maxLength={120} /></label>
            <label className="block"><span className="label">Firm</span><input name="firm" className="input" maxLength={120} /></label>
            <label className="block"><span className="label">Phone</span><input name="phone" className="input" maxLength={30} /></label>
            <label className="block"><span className="label">Email</span><input name="email" type="email" className="input" maxLength={200} /></label>
            <label className="block"><span className="label">Case or claim number</span><input name="caseNumber" className="input" maxLength={60} /></label>
            <label className="block"><span className="label">Accident date</span><input name="accidentOn" type="date" className="input" /></label>
            <label className="block"><span className="label">Lien signed on</span><input name="lienSignedOn" type="date" defaultValue={today} className="input" required /></label>
            <label className="block sm:col-span-2 lg:col-span-4"><span className="label">Notes</span><input name="notes" className="input" maxLength={1000} /></label>
            <div><SubmitButton pendingLabel="Opening...">Open case and hold the balance</SubmitButton></div>
          </ActionForm>
        </Card>
      )}
      <Card title={`Open cases (${open.length})`}>
        {open.length === 0 ? <Empty>No open cases.</Empty> : (
          <ul className="divide-y divide-slate-200 dark:divide-slate-700">
            {open.map(({ c, firstName, lastName, mrn, balanceCents }) => (
              <li key={c.id} className="py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/patients/${c.patientId}`} className="font-semibold text-brand-700 hover:underline">{lastName}, {firstName}</Link>
                  <span className="text-slate-500">MRN {mrn}</span>
                  <Badge tone="amber">Held: <Money cents={balanceCents} /></Badge>
                  <span>{c.attorney}{c.firm ? `, ${c.firm}` : ""}{c.phone ? ` · ${c.phone}` : ""}</span>
                  <span className="text-xs text-slate-500">lien signed {day(c.lienSignedOn)}{c.accidentOn ? ` · accident ${day(c.accidentOn)}` : ""}{c.caseNumber ? ` · case ${c.caseNumber}` : ""}</span>
                </div>
                <div className="mt-2 grid gap-3 lg:grid-cols-3">
                  {canAdjust && (
                    <ActionForm action={injuryReductionAction.bind(null, c.id)} className="flex flex-wrap items-end gap-2">
                      <label className="block"><span className="label">Reduction asked ($)</span><input name="requested" inputMode="decimal" defaultValue={dollars(c.reductionRequestedCents)} className="input w-28" /></label>
                      <label className="block"><span className="label">Agreed ($)</span><input name="agreed" inputMode="decimal" defaultValue={dollars(c.reductionAgreedCents)} className="input w-28" /></label>
                      <SubmitButton className="btn btn-secondary" pendingLabel="...">Save</SubmitButton>
                    </ActionForm>
                  )}
                  {canAdjust && (
                    <ActionForm action={settleInjuryCaseAction.bind(null, c.id)} className="flex flex-wrap items-end gap-2">
                      <label className="block"><span className="label">Settled on</span><input name="settledOn" type="date" defaultValue={today} className="input" /></label>
                      <label className="block"><span className="label">Paid ($)</span><input name="paid" inputMode="decimal" className="input w-28" required /></label>
                      <label className="block"><span className="label">Check no.</span><input name="method" className="input w-24" maxLength={40} /></label>
                      <SubmitButton pendingLabel="Posting...">Settled</SubmitButton>
                    </ActionForm>
                  )}
                  {canWrite && (
                    <ActionForm action={dropInjuryCaseAction.bind(null, c.id)} className="flex flex-wrap items-end gap-2">
                      <label className="block grow"><span className="label">Closed without settlement: why</span><input name="reason" className="input" maxLength={500} /></label>
                      <SubmitButton className="btn btn-secondary" pendingLabel="...">Close</SubmitButton>
                    </ActionForm>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Closed cases" className="mt-6">
        {closed.length === 0 ? <Empty>None yet.</Empty> : (
          <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-700">
            {closed.slice(0, 50).map(({ c, firstName, lastName }) => (
              <li key={c.id} className="flex flex-wrap gap-2 py-2">
                <span>{lastName}, {firstName}</span><span className="text-slate-500">{c.attorney}</span>
                {c.status === "settled" ? <Badge tone="green">Settled {day(c.settledOn)}: <Money cents={c.settlementPaidCents ?? 0} />{c.reductionAgreedCents ? <> (reduced <Money cents={c.reductionAgreedCents} />)</> : null}</Badge> : <Badge>Closed without settlement</Badge>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
