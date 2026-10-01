import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { CAN_WRITE, requireSession } from "@/lib/auth";
import { otherCoverageList } from "@/server/other-coverage";
import { otherCoverageAction } from "@/app/(app)/visit-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, Empty, PageHeader } from "@/components/ui";
import { fmtDate, fmtDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Other insurance check" };
export const dynamic = "force-dynamic";

/** The yearly "any other insurance?" question: who is due before their next visit, and who said yes. */
export default async function OtherCoveragePage() {
  const s = await requireSession();
  const { due, said } = await otherCoverageList(await getDb(), s.practiceId);
  const canWrite = (CAN_WRITE as readonly string[]).includes(s.role);
  return (
    <>
      <PageHeader title="Other insurance check" subtitle="Ask every patient once a year whether they have any other coverage, before the claim is denied for coordination of benefits. Online check-in asks automatically." />
      <Card title={`Due, with a visit in the next 14 days (${due.length})`} className="mb-6">
        {due.length === 0 ? <Empty>Everyone coming in has been asked this year.</Empty> : (
          <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-700">
            {due.map((d) => (
              <li key={d.id} className="flex flex-wrap items-end justify-between gap-3 py-2">
                <div>
                  <Link href={`/patients/${d.id}`} className="font-medium text-brand-700 underline">{d.lastName}, {d.firstName}</Link>
                  <span className="ml-2 text-slate-500 dark:text-slate-400">visit {fmtDateTime(d.next, s.timeZone)} · {d.checkedOn ? `last asked ${fmtDate(`${d.checkedOn}T00:00:00`)}` : "never asked"}</span>
                </div>
                {canWrite && (
                  <ActionForm action={otherCoverageAction.bind(null, d.id)} className="flex flex-wrap items-end gap-2">
                    <label className="block"><span className="label">Other insurance?</span><select name="answer" className="input"><option value="no">No</option><option value="yes">Yes</option></select></label>
                    <label className="block"><span className="label">If yes</span><input name="detail" className="input w-48" maxLength={300} /></label>
                    <SubmitButton className="btn btn-secondary" pendingLabel="...">Record</SubmitButton>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title={`Said yes (${said.length})`}>
        {said.length === 0 ? <Empty>No one has reported other coverage.</Empty> : (
          <ul className="space-y-1 text-sm">
            {said.map((x) => (
              <li key={x.id} className="flex flex-wrap justify-between gap-3">
                <Link href={`/patients/${x.id}`} className="text-brand-700 underline">{x.lastName}, {x.firstName}</Link>
                <span>{x.detail ?? "no details"}{x.checkedOn ? ` · ${fmtDate(`${x.checkedOn}T00:00:00`)}` : ""}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Add the other policy on the patient&apos;s page and set which plan pays first (the birthday rule, Medicare Secondary Payer rules, or the plans&apos; coordination provisions).</p>
      </Card>
    </>
  );
}
