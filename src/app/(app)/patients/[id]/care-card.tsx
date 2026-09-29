import Link from "next/link";
import { billCareMonthAction, careConsentAction, logCareMinutesAction } from "@/app/(app)/care-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card } from "@/components/ui";
import { fmtDate } from "@/lib/utils";
import { CARE_PROGRAMS, type careMonths } from "@/server/care-programs";

type Data = Awaited<ReturnType<typeof careMonths>>;
const short = (key: string) => CARE_PROGRAMS[key]?.label.split(" (")[0] ?? key;

/** Monthly care programs (CCM, BHI, RPM): consent, minutes through the month, and billing once it ends. */
export function CareCard({ patientId, data, providers, canWrite }: { patientId: string; data: Data; providers: { id: string; name: string }[]; canWrite: boolean }) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <Card title="Monthly care programs">
      <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">Chronic care management, behavioral health integration and remote monitoring are billed once a month from the time logged. Record the patient&apos;s consent first.</p>
      {data.consents.length > 0 && (
        <p className="mb-3 text-xs text-slate-600 dark:text-slate-400">Consent: {data.consents.map((c) => `${short(c.program)} (${fmtDate(c.consentedOn)})`).join(" · ")}</p>
      )}
      {data.months.length > 0 && (
        <ul className="mb-4 space-y-2 text-sm">
          {data.months.map((m) => (
            <li key={`${m.program}-${m.month}`} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{short(m.program)} · {m.month}: {m.minutes} min</span>
                {m.claimId ? <Link href={`/claims/${m.claimId}`}><Badge tone="green">Billed</Badge></Link>
                  : !m.lines.length ? <Badge tone="amber">Below {CARE_PROGRAMS[m.program]?.base.minutes} min</Badge>
                  : !m.ended ? <Badge tone="blue">In progress</Badge>
                  : <Badge tone="amber">Ready to bill</Badge>}
              </div>
              {m.lines.length > 0 && <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">Earns {m.lines.map((l) => `${l.code}${l.units > 1 ? ` x${l.units}` : ""}`).join(" + ")}</p>}
              {canWrite && !m.claimId && m.ended && m.lines.length > 0 && (
                <ActionForm action={billCareMonthAction.bind(null, patientId, m.program, m.month)} className="mt-2 flex flex-wrap items-end gap-2 text-xs">
                  <label className="block"><span className="label">Conditions managed (ICD-10)</span><input name="diagnoses" className="input font-mono" placeholder="E11.9, I10" required /></label>
                  <SubmitButton className="btn btn-secondary text-xs" pendingLabel="Billing...">Bill {m.month}</SubmitButton>
                </ActionForm>
              )}
            </li>
          ))}
        </ul>
      )}
      {canWrite && (
        <div className="space-y-3">
          <details>
            <summary className="cursor-pointer text-sm font-medium text-brand-700 dark:text-brand-300">Log time</summary>
            <ActionForm action={logCareMinutesAction.bind(null, patientId)} className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <label className="block"><span className="label">Program</span>
                <select name="program" className="select" required>{Object.entries(CARE_PROGRAMS).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}</select>
              </label>
              <label className="block"><span className="label">Billing practitioner</span>
                <select name="providerId" className="select" required>{providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              </label>
              <label className="block"><span className="label">Date</span><input type="date" name="performedOn" className="input" defaultValue={today} max={today} required /></label>
              <label className="block"><span className="label">Minutes</span><input type="number" name="minutes" min={1} max={240} className="input" required /></label>
              <label className="block sm:col-span-2"><span className="label">What was done (optional)</span><input name="note" className="input" placeholder="Medication review by phone; care plan updated" /></label>
              <div className="sm:col-span-2"><SubmitButton pendingLabel="Saving...">Log time</SubmitButton></div>
            </ActionForm>
          </details>
          <details>
            <summary className="cursor-pointer text-sm font-medium text-brand-700 dark:text-brand-300">Record consent</summary>
            <ActionForm action={careConsentAction.bind(null, patientId)} className="mt-3 flex flex-wrap items-end gap-2 text-sm">
              <label className="block"><span className="label">Program</span>
                <select name="program" className="select" required>{Object.entries(CARE_PROGRAMS).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}</select>
              </label>
              <label className="block"><span className="label">Consented on</span><input type="date" name="consentedOn" className="input" max={today} required /></label>
              <SubmitButton pendingLabel="Saving...">Record</SubmitButton>
            </ActionForm>
          </details>
        </div>
      )}
    </Card>
  );
}
