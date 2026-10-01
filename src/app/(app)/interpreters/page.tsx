import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { CAN_WRITE, requireSession } from "@/lib/auth";
import { MODES, interpreterReport, upcomingInterpreterNeeds } from "@/server/interpreters";
import { getPolicies } from "@/server/policies";
import { logInterpreterAction } from "@/app/(app)/visit-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Empty, Money, PageHeader } from "@/components/ui";
import { fmtDate, fmtDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Interpreter log" };
export const dynamic = "force-dynamic";

const isDay = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Language access: interpreters provided, upcoming visits that need one, and Medicaid T1013 units where the state pays. */
export default async function InterpretersPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const s = await requireSession();
  const q = await searchParams;
  const db = await getDb();
  const to = isDay(q.to) ? q.to! : new Date().toISOString().slice(0, 10);
  const from = isDay(q.from) ? q.from! : `${to.slice(0, 7)}-01`;
  const [r, upcoming, policies] = await Promise.all([interpreterReport(db, s.practiceId, from, to), upcomingInterpreterNeeds(db, s.practiceId), getPolicies(db, s.practiceId)]);
  const canWrite = (CAN_WRITE as readonly string[]).includes(s.role);
  return (
    <>
      <PageHeader title="Interpreter log" subtitle="Free, qualified interpreters for patients with limited English (Section 1557), and a record of each one provided or declined" />
      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        {canWrite && (
          <Card title="Log an interpreter">
            <ActionForm action={logInterpreterAction} className="grid gap-2 text-sm sm:grid-cols-2">
              <label className="block"><span className="label">Patient MRN</span><input name="mrn" className="input" required /></label>
              <label className="block"><span className="label">Date</span><input type="date" name="servedOn" defaultValue={to} className="input" required /></label>
              <label className="block"><span className="label">Language (blank: the patient&apos;s)</span><input name="language" className="input" maxLength={60} /></label>
              <label className="block"><span className="label">How</span><select name="mode" className="input">{Object.entries(MODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label className="block"><span className="label">Vendor</span><input name="vendor" className="input" maxLength={120} /></label>
              <label className="block"><span className="label">Minutes</span><input name="minutes" type="number" min={0} max={600} className="input" /></label>
              <label className="block"><span className="label">Cost ($)</span><input name="cost" inputMode="decimal" className="input" /></label>
              <label className="flex items-center gap-2 self-end"><input type="checkbox" name="declined" /> Offered, and the patient declined</label>
              <label className="block sm:col-span-2"><span className="label">Notes</span><input name="notes" className="input" maxLength={500} /></label>
              <div><SubmitButton pendingLabel="Saving...">Log</SubmitButton></div>
            </ActionForm>
          </Card>
        )}
        <Card title={`Coming in, needs an interpreter (${upcoming.length})`}>
          {upcoming.length === 0 ? <Empty>No visits in the next 7 days need an interpreter.</Empty> : (
            <ul className="space-y-1 text-sm">{upcoming.map((u) => (
              <li key={u.appointmentId} className="flex flex-wrap justify-between gap-3">
                <Link href={`/patients/${u.patientId}`} className="text-brand-700 underline">{u.name}</Link>
                <span>{u.language} · {fmtDateTime(u.startsAt, s.timeZone)}</span>
              </li>
            ))}</ul>
          )}
        </Card>
      </div>
      <form className="mb-4 flex flex-wrap items-end gap-3 text-sm" action="/interpreters">
        <label className="block"><span className="label">From</span><input type="date" name="from" defaultValue={from} className="input" /></label>
        <label className="block"><span className="label">To</span><input type="date" name="to" defaultValue={to} className="input" /></label>
        <button className="btn btn-secondary">Show</button>
      </form>
      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <Card title="By language">{r.byLanguage.length === 0 ? <Empty>None in this period.</Empty> : <ul className="space-y-1 text-sm">{r.byLanguage.map((l) => <li key={l.key} className="flex justify-between gap-3"><span>{l.key}</span><span className="tabular-nums">{l.sessions} · {l.minutes} min</span></li>)}</ul>}</Card>
        <Card title="By vendor">{r.byVendor.length === 0 ? <Empty>None in this period.</Empty> : <ul className="space-y-1 text-sm">{r.byVendor.map((v) => <li key={v.key} className="flex justify-between gap-3"><span>{v.key}</span><span className="tabular-nums">{v.sessions} · <Money cents={v.costCents} /></span></li>)}</ul>}</Card>
        <Card title="Medicaid (T1013)">
          {policies.interpreterT1013
            ? <p className="text-sm">{r.medicaidUnits} unit{r.medicaidUnits === 1 ? "" : "s"} of T1013 (15 minutes each) for Medicaid patients in this period. Check your state&apos;s rules for who may bill it and how.</p>
            : <p className="text-sm text-slate-600 dark:text-slate-300">Your state&apos;s Medicaid may pay for interpreters under T1013. Turn it on in <Link href="/settings/policies" className="text-brand-700 underline">Billing policies</Link> to see the units here.</p>}
          {r.declined > 0 && <p className="mt-2 text-sm">{r.declined} offer{r.declined === 1 ? "" : "s"} declined in this period.</p>}
        </Card>
      </div>
      <Card title="Sessions">
        {r.sessions.length === 0 ? <Empty>None in this period.</Empty> : (
          <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-700">{r.sessions.map((x) => (
            <li key={x.s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <span>{fmtDate(`${x.s.servedOn}T00:00:00`)}</span>
              <Link href={`/patients/${x.s.patientId}`} className="text-brand-700 underline">{x.lastName}, {x.firstName}</Link>
              <span>{x.s.language}</span>
              <span className="text-slate-500 dark:text-slate-400">{MODES[x.s.mode] ?? x.s.mode}{x.s.vendor ? `, ${x.s.vendor}` : ""}</span>
              {x.s.declined ? <Badge>declined</Badge> : <span className="tabular-nums">{x.s.minutes} min{x.s.costCents !== null ? <> · <Money cents={x.s.costCents} /></> : null}</span>}
              {x.medicaid && !x.s.declined && policies.interpreterT1013 && <Badge tone="blue">T1013 × {x.units}</Badge>}
            </li>
          ))}</ul>
        )}
      </Card>
    </>
  );
}
