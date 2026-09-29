import Link from "next/link";
import { abnChoiceAction, createAbnAction } from "@/app/(app)/abn-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card } from "@/components/ui";
import { fmtDate, money } from "@/lib/utils";
import type { listAbns } from "@/server/abn";

type Notice = Awaited<ReturnType<typeof listAbns>>[number];

/** Advance Beneficiary Notices for a Medicare patient: prepare one, print its details, record the patient's choice. */
export function AbnCard({ patientId, notices, canWrite }: { patientId: string; notices: Notice[]; canWrite: boolean }) {
  return (
    <Card title="Advance Beneficiary Notices (ABN)">
      <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">Before a service Medicare may not cover, the patient gets form CMS-R-131 and chooses. With option 1, claims carry GA and the patient can be billed if Medicare denies.</p>
      {notices.length > 0 && (
        <ul className="mb-4 space-y-3 text-sm">
          {notices.map((n) => (
            <li key={n.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{fmtDate(n.serviceDate)}: {n.services.map((x) => x.code).join(", ")}</span>
                {n.option ? <Badge tone={n.option === 1 ? "green" : "amber"}>Option {n.option}, signed {fmtDate(n.signedOn)}</Badge> : <Badge tone="amber">Not signed yet</Badge>}
              </div>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{n.reason} · estimated {money(n.services.reduce((a, x) => a + x.estimatedCents, 0))}</p>
              <Link href={`/print/abn/${n.id}`} className="mt-1 inline-block text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300">Details for form CMS-R-131</Link>
              {canWrite && !n.option && (
                <ActionForm action={abnChoiceAction.bind(null, n.id, patientId)} className="mt-2 flex flex-wrap items-end gap-2 text-xs">
                  <label className="block"><span className="label">Patient chose</span>
                    <select name="option" className="select" required defaultValue=""><option value="" disabled>Choose...</option><option value="1">Option 1</option><option value="2">Option 2</option><option value="3">Option 3</option></select>
                  </label>
                  <label className="block"><span className="label">Signed on</span><input type="date" name="signedOn" className="input" required /></label>
                  <SubmitButton className="btn btn-secondary text-xs" pendingLabel="Saving...">Record</SubmitButton>
                </ActionForm>
              )}
            </li>
          ))}
        </ul>
      )}
      {canWrite && (
        <details>
          <summary className="cursor-pointer text-sm font-medium text-brand-700 dark:text-brand-300">Prepare a notice</summary>
          <ActionForm action={createAbnAction.bind(null, patientId)} className="mt-3 space-y-3 text-sm">
            <label className="block"><span className="label">Date of service</span><input type="date" name="serviceDate" className="input" required /></label>
            <label className="block"><span className="label">Services, one per line: code, description, estimated cost</span><textarea name="services" rows={3} className="input font-mono text-xs" placeholder="82947, Blood sugar test, 25.00" required /></label>
            <label className="block"><span className="label">Why Medicare may not pay</span><input name="reason" className="input" placeholder="Medicare pays for this test only once a year" required /></label>
            <SubmitButton pendingLabel="Saving...">Prepare notice</SubmitButton>
          </ActionForm>
        </details>
      )}
    </Card>
  );
}
