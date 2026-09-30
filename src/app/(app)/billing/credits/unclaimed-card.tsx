import Link from "next/link";
import type { PracticePolicies } from "@/db/schema";
import type { UnclaimedCase } from "@/server/unclaimed";
import { LETTER_WAIT_DAYS } from "@/server/unclaimed";
import { reportUnclaimedAction, resolveUnclaimedAction, saveUnclaimedSettingsAction, scanUnclaimedAction, unclaimedLetterSentAction } from "@/app/(app)/privacy-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Empty } from "@/components/ui";
import { US_STATES } from "@/lib/us";
import { fmtDate, money } from "@/lib/utils";

const day = (iso: string | null) => (iso ? fmtDate(`${iso}T00:00:00`) : "-");

/** Dormant patient credits: the due-diligence letter, then refund, apply or report to the state. */
export function UnclaimedCard({ settings, cases, isAdmin, canWrite, canAdjust }: { settings: PracticePolicies["unclaimed"]; cases: UnclaimedCase[]; isAdmin: boolean; canWrite: boolean; canAdjust: boolean }) {
  const today = new Date().toISOString().slice(0, 10);
  const year = new Date().getUTCFullYear();
  return (
    <Card title="Unclaimed credits" className="mt-6">
      <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
        A patient credit with no activity for your state&apos;s dormancy period is unclaimed property: send the patient a letter, then refund or apply it if they answer, or report and remit it to the state if they do not.
        Dormancy periods, letter rules and report dates differ by state, so set them to your state&apos;s law; nothing is assumed.
      </p>
      <ActionForm action={saveUnclaimedSettingsAction} className="mb-4 flex flex-wrap items-end gap-3 text-sm">
        <label className="block"><span className="label">State the credits are reported to</span>
          <select name="state" defaultValue={settings?.state ?? ""} className="input" disabled={!isAdmin}><option value="">Choose</option>{US_STATES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></label>
        <label className="block"><span className="label">Dormancy period (months)</span><input name="dormancyMonths" type="number" min="6" max="120" defaultValue={settings?.dormancyMonths ?? ""} className="input w-28" disabled={!isAdmin} /></label>
        <label className="block"><span className="label">Letter for credits of at least ($)</span><input name="letterMin" inputMode="decimal" defaultValue={settings ? (settings.letterMinCents / 100).toFixed(2) : ""} className="input w-28" disabled={!isAdmin} /></label>
        {isAdmin && <SubmitButton className="btn btn-secondary" pendingLabel="Saving...">Save</SubmitButton>}
      </ActionForm>
      {!settings ? <Empty>Set the state and dormancy period to find dormant credits.</Empty> : (
        <>
          {canWrite && <ActionForm action={scanUnclaimedAction} className="mb-3"><SubmitButton className="btn btn-secondary" pendingLabel="Checking...">Check for dormant credits now</SubmitButton></ActionForm>}
          {cases.length === 0 ? <Empty>No patient credit has been dormant for {settings.dormancyMonths} months.</Empty> : (
            <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-700">
              {cases.map((c) => (
                <li key={c.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/patients/${c.patientId}`} className="font-semibold text-brand-700 hover:underline">{c.name}</Link>
                    <span className="tabular-nums">{money(c.amountCents)}</span>
                    <span className="text-slate-500">last activity {day(c.lastActivityOn)}</span>
                    {c.readyToReport ? <Badge tone="red">Ready to report</Badge> : c.status === "letter_sent" ? <Badge tone="amber">Letter sent {day(c.letterSentOn)}</Badge> : <Badge tone="amber">Letter due</Badge>}
                  </div>
                  {canWrite && (
                    <div className="mt-2 flex flex-wrap items-end gap-3">
                      {c.status !== "to_report" && <Link href={`/print/unclaimed-letter/${c.id}`} className="btn btn-secondary">Print letter</Link>}
                      {c.status === "letter_due" && (
                        <ActionForm action={unclaimedLetterSentAction.bind(null, c.id)} className="flex items-end gap-2">
                          <label className="block"><span className="label">Sent on</span><input name="sentOn" type="date" defaultValue={today} className="input" /></label>
                          <SubmitButton pendingLabel="Saving...">Letter sent</SubmitButton>
                        </ActionForm>
                      )}
                      <ActionForm action={resolveUnclaimedAction.bind(null, c.id)} className="flex items-end gap-2">
                        <label className="block"><span className="label">Patient answered</span><input name="resolution" className="input" placeholder="Asked for a refund" maxLength={300} /></label>
                        <SubmitButton className="btn btn-secondary" pendingLabel="Saving...">Close</SubmitButton>
                      </ActionForm>
                      {c.readyToReport && canAdjust && (
                        <ActionForm action={reportUnclaimedAction.bind(null, c.id)} className="flex items-end gap-2">
                          <label className="block"><span className="label">Report year</span><input name="year" type="number" defaultValue={year} className="input w-24" /></label>
                          <SubmitButton pendingLabel="Saving...">Reported and remitted</SubmitButton>
                        </ActionForm>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            A credit is ready to report {LETTER_WAIT_DAYS} days after the letter with no answer, or at once when it is below the letter minimum. Report it through the state&apos;s unclaimed property portal in its format;
            &quot;Reported and remitted&quot; then takes the credit off the patient&apos;s account. New activity on the account closes the case.
          </p>
        </>
      )}
    </Card>
  );
}
