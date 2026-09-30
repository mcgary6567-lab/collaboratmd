import type { Metadata } from "next";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { frontDeskCollections, rate, type Tally } from "@/server/pos-collections";
import { Card, Empty, Money, PageHeader, Stat } from "@/components/ui";
import { fmtDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Front-desk collections" };
export const dynamic = "force-dynamic";

const isDay = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
const pct = (v: number | null) => (v === null ? "-" : `${Math.round(v * 1000) / 10}%`);

function Row({ label, t }: { label: string; t: Tally }) {
  return (
    <tr>
      <td data-label="">{label}</td>
      <td data-label="Visits" className="text-right tabular-nums">{t.visits}</td>
      <td data-label="Copays" className="text-right tabular-nums"><Money cents={t.copayCollectedCents} /> of <Money cents={t.copayDueCents} /> ({pct(rate(t.copayCollectedCents, t.copayDueCents))})</td>
      <td data-label="Prior balances" className="text-right tabular-nums"><Money cents={t.priorCollectedCents} /> of <Money cents={t.priorDueCents} /> ({pct(rate(t.priorCollectedCents, t.priorDueCents))})</td>
    </tr>
  );
}

/** What the front desk collected at each visit against the copay and prior balance due. */
export default async function FrontDeskPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const s = await requireSession();
  const q = await searchParams;
  const to = isDay(q.to) ? q.to! : new Date().toISOString().slice(0, 10);
  const from = isDay(q.from) ? q.from! : new Date(Date.parse(`${to}T12:00:00Z`) - 27 * 86_400_000).toISOString().slice(0, 10);
  const r = await frontDeskCollections(await getDb(), s.practiceId, from, to);
  const t = r.total;
  return (
    <>
      <PageHeader title="Front-desk collections" subtitle={`${fmtDate(`${from}T00:00:00`)} to ${fmtDate(`${to}T00:00:00`)}: copays and prior balances collected on the day of the visit`} />
      <form className="mb-6 flex flex-wrap items-end gap-3 text-sm" action="/reports/front-desk">
        <label className="block"><span className="label">From</span><input type="date" name="from" defaultValue={from} className="input" /></label>
        <label className="block"><span className="label">To</span><input type="date" name="to" defaultValue={to} className="input" /></label>
        <button className="btn btn-secondary">Show</button>
      </form>
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Visits" value={t.visits.toLocaleString("en-US")} hint="Checked in or completed, one per patient per day" />
        <Stat label="Copays collected" value={pct(rate(t.copayCollectedCents, t.copayDueCents))} hint={`$${Math.round(t.copayCollectedCents / 100).toLocaleString("en-US")} of $${Math.round(t.copayDueCents / 100).toLocaleString("en-US")} due`} />
        <Stat label="Prior balances collected" value={pct(rate(t.priorCollectedCents, t.priorDueCents))} hint={`$${Math.round(t.priorCollectedCents / 100).toLocaleString("en-US")} of $${Math.round(t.priorDueCents / 100).toLocaleString("en-US")} owed at check-in`} />
      </div>
      {t.visits === 0 ? <Card title="Results"><Empty>No visits in this period.</Empty></Card> : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="By location">
            <div tabIndex={0} role="region" aria-label="By location" className="overflow-x-auto">
              <table className="table table-stack text-sm"><thead><tr><th>Location</th><th className="text-right">Visits</th><th className="text-right">Copays</th><th className="text-right">Prior balances</th></tr></thead>
                <tbody>{r.byLocation.map((l) => <Row key={l.location} label={l.location} t={l} />)}</tbody></table>
            </div>
          </Card>
          <Card title="By week">
            <div tabIndex={0} role="region" aria-label="By week" className="overflow-x-auto">
              <table className="table table-stack text-sm"><thead><tr><th>Week of</th><th className="text-right">Visits</th><th className="text-right">Copays</th><th className="text-right">Prior balances</th></tr></thead>
                <tbody>{r.byWeek.map((w) => <Row key={w.week} label={fmtDate(`${w.week}T00:00:00`)} t={w} />)}</tbody></table>
            </div>
          </Card>
          <Card title="Payments taken, by who posted them" className="lg:col-span-2">
            {r.byStaff.length === 0 ? <Empty>No payments taken.</Empty> : (
              <ul className="space-y-1 text-sm">{r.byStaff.map((p) => <li key={p.name} className="flex justify-between gap-3"><span>{p.name}</span><span className="tabular-nums">{p.payments} · <Money cents={p.cents} /></span></li>)}</ul>
            )}
          </Card>
        </div>
      )}
      <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">A payment counts toward the copay first, then the balance owed before that day. Card-on-file, agency, settlement and estate payments are left out; online check-in payments count. The copay is the one on the patient&apos;s primary insurance today.</p>
    </>
  );
}
