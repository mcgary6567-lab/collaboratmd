import Link from "next/link";
import { getDb } from "@/db";
import { CAN_WRITE, requireSession } from "@/lib/auth";
import { missedCharges } from "@/server/recovery";
import { claimMissedEncounterAction, dismissMissedChargeAction } from "@/app/(app)/recovery-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Empty, Money, PageHeader, PatientLink, Stat } from "@/components/ui";
import { fmtDate, money } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function MissedChargesPage() {
  const s = await requireSession();
  const rows = await missedCharges(await getDb(), s.practiceId);
  const visits = rows.filter((r) => r.kind === "appointment");
  const unbilled = rows.filter((r) => r.kind === "encounter");
  const canWrite = (CAN_WRITE as readonly string[]).includes(s.role);
  const name = (n: string) => { const [l, f] = n.split(", "); return { first: f ?? "", last: l ?? n }; };

  return (
    <>
      <PageHeader
        title="Missed charges"
        subtitle="Visits from the last 60 days that were seen but never billed"
        actions={<Link href="/billing" className="btn btn-secondary">Patient billing</Link>}
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Visits with no charges" value={visits.length.toLocaleString("en-US")} hint="Checked in or completed, nothing entered" tone={visits.length ? "bad" : "good"} />
        <Stat label="Charges with no claim" value={unbilled.length.toLocaleString("en-US")} hint={`${money(unbilled.reduce((a, r) => a + r.estimateCents, 0))} entered but not sent`} tone={unbilled.length ? "bad" : "good"} />
        <Stat label="Estimated at risk" value={money(rows.reduce((a, r) => a + r.estimateCents, 0))} hint="Visit estimates use each provider's average claim" />
      </div>

      <Card title="Seen but not billed" className="mb-6">
        {visits.length === 0 ? (
          <Empty>Every checked-in or completed visit older than a day has charges. Nothing slipped through.</Empty>
        ) : (
          <table className="table">
            <thead><tr><th>Date</th><th>Patient</th><th>Provider</th><th>What happened</th><th className="text-right">Typical claim</th><th /></tr></thead>
            <tbody>
              {visits.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap">{fmtDate(r.date)}</td>
                  <td><PatientLink id={r.patientId} {...name(r.patientName)} /></td>
                  <td>{r.providerName}</td>
                  <td className="text-sm text-slate-600">{r.detail}</td>
                  <td className="text-right">{r.estimateCents ? <Money cents={r.estimateCents} /> : <span className="text-slate-400">n/a</span>}</td>
                  <td className="whitespace-nowrap text-right">
                    {canWrite && (
                      <div className="flex items-start justify-end gap-2">
                        <Link href={`/encounters/new?patientId=${r.patientId}&providerId=${r.providerId}&appointmentId=${r.id}&dos=${r.date}`} className="btn btn-primary text-xs">Enter charges</Link>
                        <details className="text-left">
                          <summary className="btn btn-secondary cursor-pointer text-xs">Not billable</summary>
                          <ActionForm action={dismissMissedChargeAction.bind(null, r.id)} className="mt-2 w-64 space-y-2">
                            <input name="reason" className="input text-xs" placeholder="Why (e.g. global period follow-up)" required />
                            <SubmitButton className="btn btn-secondary text-xs" pendingLabel="Saving...">Save</SubmitButton>
                          </ActionForm>
                        </details>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Charges entered, no claim created">
        {unbilled.length === 0 ? (
          <Empty>Every encounter with charges has a claim.</Empty>
        ) : (
          <table className="table">
            <thead><tr><th>Date of service</th><th>Patient</th><th>Provider</th><th className="text-right">Charges</th><th /></tr></thead>
            <tbody>
              {unbilled.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap">{fmtDate(r.date)}</td>
                  <td><PatientLink id={r.patientId} {...name(r.patientName)} /></td>
                  <td>{r.providerName}</td>
                  <td className="text-right"><Money cents={r.estimateCents} /></td>
                  <td className="whitespace-nowrap text-right">{canWrite ? <ActionForm action={claimMissedEncounterAction.bind(null, r.id)}><SubmitButton className="btn btn-primary text-xs" pendingLabel="Creating...">Create claim</SubmitButton></ActionForm> : <Badge tone="amber">no claim</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
