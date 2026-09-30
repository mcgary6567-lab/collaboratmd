import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { CAN_WRITE, requireSession } from "@/lib/auth";
import { adultDependents, returnedMail } from "@/server/account-review";
import { adultConsentAction, releaseAdultAction } from "@/app/(app)/account-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, Empty, Money, PageHeader } from "@/components/ui";
import { fmtDate, fmtDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Returned mail and adult dependents" };
export const dynamic = "force-dynamic";

const day = (v: string) => fmtDate(`${v}T00:00:00`);

/** Accounts addressed wrongly: mail that came back, and grown children still billed to a parent. */
export default async function AccountReviewPage() {
  const s = await requireSession();
  const db = await getDb();
  const [mail, adults] = await Promise.all([returnedMail(db, s.practiceId), adultDependents(db, s.practiceId)]);
  const canWrite = (CAN_WRITE as readonly string[]).includes(s.role);
  const held = mail.reduce((a, m) => a + Math.max(0, m.balanceCents), 0);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <PageHeader title="Returned mail and adult dependents" subtitle="Keeping statements going to the right person at the right address" />
      <Card title={`Returned mail (${mail.length})`} className="mb-6">
        <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
          Nothing is mailed to these addresses until they are corrected on the patient&apos;s page (or updated by online check-in, HL7 or an import). The schedule check reminds the front desk to confirm the address at the next visit.
          {mail.length > 0 && <> <Money cents={held} /> is owed on these accounts.</>}
        </p>
        {mail.length === 0 ? <Empty>No returned mail.</Empty> : (
          <div tabIndex={0} role="region" aria-label="Returned mail" className="overflow-x-auto">
            <table className="table table-stack">
              <thead><tr><th>Patient</th><th>Address on file</th><th>Came back</th><th>Reach them by</th><th>Next visit</th><th className="text-right">Owed</th></tr></thead>
              <tbody>{mail.map((m) => (
                <tr key={m.id}>
                  <td data-label="Patient"><Link href={`/patients/${m.id}`} className="text-brand-700 underline">{m.name}</Link></td>
                  <td data-label="Address on file">{m.address || "-"}</td>
                  <td data-label="Came back">{day(m.since)}{m.note ? ` (${m.note})` : ""}</td>
                  <td data-label="Reach them by">{[m.phone, m.email].filter(Boolean).join(" · ") || "-"}</td>
                  <td data-label="Next visit">{m.nextVisit ? fmtDateTime(m.nextVisit, s.timeZone) : "-"}</td>
                  <td data-label="Owed" className="text-right tabular-nums"><Money cents={m.balanceCents} /></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title={`Adult dependents (${adults.length})`}>
        <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
          These patients have turned 18 but still have a guarantor. Their statements now go to them, not the guarantor, so a parent does not see an adult child&apos;s care. Record their agreement to keep the guarantor (a student on a parent&apos;s plan, for example), or move them to their own account.
        </p>
        {adults.length === 0 ? <Empty>No adult dependents to review.</Empty> : (
          <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-700">
            {adults.map((a) => (
              <li key={a.id} className="flex flex-wrap items-end justify-between gap-3 py-3">
                <div>
                  <Link href={`/patients/${a.id}`} className="font-semibold text-brand-700 underline">{a.name}</Link>
                  <span className="ml-2 text-slate-500 dark:text-slate-400">born {day(a.dob)}; guarantor <Link href={`/patients/${a.guarantorId}`} className="underline">{a.guarantor}</Link></span>
                </div>
                {canWrite && (
                  <div className="flex flex-wrap items-end gap-2">
                    <ActionForm action={adultConsentAction.bind(null, a.id)} className="flex flex-wrap items-end gap-2">
                      <label className="block"><span className="label">Agreed on</span><input type="date" name="on" defaultValue={today} className="input" /></label>
                      <SubmitButton className="btn btn-secondary" pendingLabel="...">Keep the guarantor</SubmitButton>
                    </ActionForm>
                    <ActionForm action={releaseAdultAction.bind(null, a.id)}><SubmitButton className="btn btn-secondary" pendingLabel="...">Own account</SubmitButton></ActionForm>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
