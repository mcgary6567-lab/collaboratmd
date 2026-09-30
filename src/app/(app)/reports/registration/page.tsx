import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { FIELDS, registrationQuality } from "@/server/registration";
import { Badge, Card, Empty, Money, PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Registration quality" };
export const dynamic = "force-dynamic";

const isDay = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
const KIND = { rejection: "Claim rejected", coverage_check: "Coverage check refused", denial: "Denied" } as const;

/** Rejections and denials that trace back to what was entered at registration, by field and by who entered it. */
export default async function RegistrationPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const s = await requireSession();
  const q = await searchParams;
  const to = isDay(q.to) ? q.to! : new Date().toISOString().slice(0, 10);
  const from = isDay(q.from) ? q.from! : new Date(Date.parse(`${to}T12:00:00Z`) - 90 * 86_400_000).toISOString().slice(0, 10);
  const r = await registrationQuality(await getDb(), s.practiceId, from, to);
  return (
    <>
      <PageHeader title="Registration quality" subtitle={`${fmtDate(`${from}T00:00:00`)} to ${fmtDate(`${to}T00:00:00`)}: ${r.issues.length} rejection${r.issues.length === 1 ? "" : "s"} and denials traced to registration`} />
      <form className="mb-6 flex flex-wrap items-end gap-3 text-sm" action="/reports/registration">
        <label className="block"><span className="label">From</span><input type="date" name="from" defaultValue={from} className="input" /></label>
        <label className="block"><span className="label">To</span><input type="date" name="to" defaultValue={to} className="input" /></label>
        <button className="btn btn-secondary">Show</button>
      </form>
      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card title="By field">
          {r.byField.length === 0 ? <Empty>Nothing traced to registration in this period.</Empty> : (
            <ul className="space-y-1.5 text-sm">{r.byField.map((f) => <li key={f.key} className="flex justify-between gap-3"><span>{FIELDS[f.key]}</span><span className="tabular-nums">{f.count}{f.cents ? <> · <Money cents={f.cents} /></> : null}</span></li>)}</ul>
          )}
        </Card>
        <Card title="By who entered the policy">
          {r.byPerson.length === 0 ? <Empty>Nothing traced to registration in this period.</Empty> : (
            <ul className="space-y-1.5 text-sm">{r.byPerson.map((p) => <li key={p.key} className="flex justify-between gap-3"><span>{p.key}</span><span className="tabular-nums">{p.count}{p.cents ? <> · <Money cents={p.cents} /></> : null}</span></li>)}</ul>
          )}
        </Card>
      </div>
      <Card title="To fix">
        {r.issues.length === 0 ? <Empty>None.</Empty> : (
          <div tabIndex={0} role="region" aria-label="Registration problems" className="overflow-x-auto">
            <table className="table table-stack">
              <thead><tr><th>Date</th><th>Patient</th><th>Payer</th><th>What happened</th><th>Field</th><th>Entered by</th></tr></thead>
              <tbody>{r.issues.slice(0, 200).map((i, n) => (
                <tr key={n}>
                  <td data-label="Date">{fmtDate(`${i.on}T00:00:00`)}</td>
                  <td data-label="Patient"><Link href={`/patients/${i.patientId}`} className="text-brand-700 hover:underline">{i.patientName}</Link></td>
                  <td data-label="Payer">{i.payer}</td>
                  <td data-label="What happened">{KIND[i.kind]} <span className="font-mono text-xs">{i.code}</span>{i.claimId && <> · <Link href={`/claims/${i.claimId}`} className="font-mono text-brand-700 hover:underline">{i.controlNumber}</Link></>}</td>
                  <td data-label="Field"><Badge tone="amber">{FIELDS[i.field]}</Badge></td>
                  <td data-label="Entered by">{i.enteredBy}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          Traced from front-end claim rejections (277CA member number, subscriber not found, not eligible), coverage checks the payer refused (invalid ID, name or date of birth), and denials for identity (CARC 31, 140), coverage dates (26, 27) and the wrong payer (22, 109).
          Who entered each policy is recorded from September 2026 on; earlier policies show as &quot;Not recorded&quot;.
        </p>
      </Card>
    </>
  );
}
