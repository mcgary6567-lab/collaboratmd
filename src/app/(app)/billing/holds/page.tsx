import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { CAN_ADJUST, CAN_WRITE, requireSession } from "@/lib/auth";
import { HOLD_KINDS, OUTCOMES, listHolds } from "@/server/account-holds";
import { claimFiledAction, closeHoldAction } from "@/app/(app)/account-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Empty, Money, PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Bankruptcy and estates" };
export const dynamic = "force-dynamic";

const day = (v: string | null) => (v ? fmtDate(`${v}T00:00:00`) : "-");

/** Patients in bankruptcy or deceased: collection stopped, claims to file by their deadlines. */
export default async function HoldsPage() {
  const s = await requireSession();
  const db = await getDb();
  const [open, closed] = await Promise.all([listHolds(db, s.practiceId, "open"), listHolds(db, s.practiceId, "closed")]);
  const canWrite = (CAN_WRITE as readonly string[]).includes(s.role);
  const canAdjust = (CAN_ADJUST as readonly string[]).includes(s.role);
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const soon = new Date(now.getTime() + 30 * 86_400_000).toISOString().slice(0, 10);
  return (
    <>
      <PageHeader title="Bankruptcy and estates" subtitle="No statements, reminders, card charges or collections while a patient is in bankruptcy or after a death. Record these on the patient's page, under Account status." />
      <Card title={`Open (${open.length})`} className="mb-6">
        {open.length === 0 ? <Empty>No patients in bankruptcy or recorded as deceased.</Empty> : (
          <ul className="divide-y divide-slate-200 dark:divide-slate-700">
            {open.map(({ h, firstName, lastName, mrn, balanceCents }) => (
              <li key={h.id} className="py-3 text-sm">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Link href={`/patients/${h.patientId}`} className="font-semibold text-brand-700 underline">{lastName}, {firstName}</Link>
                  <span className="text-slate-500 dark:text-slate-400">MRN {mrn}</span>
                  <Badge tone={h.kind === "deceased" ? "slate" : "amber"}>{HOLD_KINDS[h.kind as keyof typeof HOLD_KINDS]}</Badge>
                  <span>Held: <Money cents={balanceCents} /></span>
                  <span className="text-slate-600 dark:text-slate-300">
                    {h.kind === "bankruptcy" ? `Chapter ${h.details.chapter}, case ${h.details.caseNumber}${h.details.court ? `, ${h.details.court}` : ""}, filed ${day(h.startedOn)}` : `Died ${day(h.startedOn)}${h.details.executor ? `; executor ${h.details.executor}` : ""}`}
                  </span>
                  {h.deadline && (h.claimFiledOn
                    ? <Badge tone="green">claim filed {day(h.claimFiledOn)}</Badge>
                    : <Badge tone={h.deadline <= soon ? "red" : "amber"}>claim due {day(h.deadline)}</Badge>)}
                  {h.kind === "deceased" && <Link href={`/print/estate-claim/${h.id}`} className="text-brand-700 underline">Claim letter</Link>}
                </div>
                <div className="mt-2 grid gap-3 lg:grid-cols-2">
                  {canWrite && !h.claimFiledOn && (
                    <ActionForm action={claimFiledAction.bind(null, h.id)} className="flex flex-wrap items-end gap-2">
                      <label className="block"><span className="label">{h.kind === "bankruptcy" ? "Proof of claim filed on" : "Claim sent to the estate on"}</span><input type="date" name="filedOn" defaultValue={today} className="input" /></label>
                      <SubmitButton className="btn btn-secondary" pendingLabel="...">Record</SubmitButton>
                    </ActionForm>
                  )}
                  {canAdjust && (
                    <ActionForm action={closeHoldAction.bind(null, h.id)} className="flex flex-wrap items-end gap-2">
                      <label className="block"><span className="label">It ended</span>
                        <select name="outcome" className="input">{Object.entries(OUTCOMES).filter(([, o]) => o.kind === h.kind).map(([k, o]) => <option key={k} value={k}>{o.label}</option>)}</select>
                      </label>
                      {h.kind === "deceased" && <>
                        <label className="block"><span className="label">Estate paid ($)</span><input name="paid" inputMode="decimal" className="input w-28" /></label>
                        <label className="block"><span className="label">Check no.</span><input name="method" className="input w-24" maxLength={40} /></label>
                      </>}
                      <SubmitButton className="btn btn-secondary" pendingLabel="...">Close</SubmitButton>
                    </ActionForm>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Closed">
        {closed.length === 0 ? <Empty>None yet.</Empty> : (
          <ul className="space-y-1 text-sm">
            {closed.map(({ h, firstName, lastName }) => (
              <li key={h.id} className="flex flex-wrap justify-between gap-3">
                <Link href={`/patients/${h.patientId}`} className="text-brand-700 underline">{lastName}, {firstName}</Link>
                <span>{HOLD_KINDS[h.kind as keyof typeof HOLD_KINDS]}: {OUTCOMES[h.outcome ?? ""]?.label.split(":")[0] ?? h.outcome}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
