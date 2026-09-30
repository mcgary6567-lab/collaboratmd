import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { CAN_WRITE, requireSession } from "@/lib/auth";
import { OWNERS, ROOT_CAUSES, rootCauseReport } from "@/server/denial-causes";
import { rootCauseAction } from "@/app/(app)/finance-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Empty, Money, PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Denial root causes" };
export const dynamic = "force-dynamic";

const isDay = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;

/** Why denials happened, whose process prevents them, and how much was preventable. */
export default async function DenialCausesPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const s = await requireSession();
  const q = await searchParams;
  const to = isDay(q.to) ? q.to! : new Date().toISOString().slice(0, 10);
  const from = isDay(q.from) ? q.from! : new Date(Date.parse(`${to}T12:00:00Z`) - 180 * 86_400_000).toISOString().slice(0, 10);
  const r = await rootCauseReport(await getDb(), s.practiceId, from, to);
  const canWrite = (CAN_WRITE as readonly string[]).includes(s.role);
  return (
    <>
      <PageHeader title="Denial root causes" subtitle={`${fmtDate(`${from}T00:00:00`)} to ${fmtDate(`${to}T00:00:00`)}: ${pct(r.preventableShare)} of denied dollars were preventable`} actions={<Link href="/denials" className="btn btn-secondary">Denials</Link>} />
      <form className="mb-6 flex flex-wrap items-end gap-3 text-sm" action="/reports/denial-causes">
        <label className="block"><span className="label">From</span><input type="date" name="from" defaultValue={from} className="input" /></label>
        <label className="block"><span className="label">To</span><input type="date" name="to" defaultValue={to} className="input" /></label>
        <button className="btn btn-secondary">Show</button>
      </form>
      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <Card title="By owner">
          {r.byOwner.length === 0 ? <Empty>No denials in this period.</Empty> : (
            <ul className="space-y-1.5 text-sm">{r.byOwner.map((o) => <li key={o.key} className="flex justify-between gap-3"><span>{OWNERS[o.key]}</span><span className="tabular-nums">{o.count} · <Money cents={o.cents} /></span></li>)}</ul>
          )}
        </Card>
        <Card title="By cause">
          {r.byCause.length === 0 ? <Empty>No denials in this period.</Empty> : (
            <ul className="space-y-1.5 text-sm">{r.byCause.map((c) => <li key={c.key} className="flex justify-between gap-3"><span>{ROOT_CAUSES[c.key].label}</span><span className="tabular-nums">{c.count} · <Money cents={c.cents} /></span></li>)}</ul>
          )}
        </Card>
        <Card title="Preventable share by month">
          {r.byMonth.length === 0 ? <Empty>No denials in this period.</Empty> : (
            <ul className="space-y-1.5 text-sm">{r.byMonth.map((m) => <li key={m.month} className="flex justify-between gap-3"><span>{m.month}</span><span className="tabular-nums">{pct(m.share)} of <Money cents={m.total} /></span></li>)}</ul>
          )}
        </Card>
      </div>
      <Card title="Denials">
        {r.items.length === 0 ? <Empty>None.</Empty> : (
          <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-700">
            {r.items.slice(0, 150).map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 py-2">
                <Link href={`/claims/${d.claimId}`} className="font-mono text-brand-700 hover:underline">{d.controlNumber}</Link>
                <span>{d.payer}</span><span className="text-slate-500">CARC {d.carc} · {fmtDate(`${d.on}T00:00:00`)}</span><Money cents={d.cents} />
                {d.preventable ? <Badge tone="red">preventable</Badge> : <Badge>payer</Badge>}
                {canWrite ? (
                  <ActionForm action={rootCauseAction.bind(null, d.id)} className="flex items-end gap-2">
                    <select name="cause" defaultValue={d.cause} className="input text-xs" aria-label={`Root cause for ${d.controlNumber}`}>{Object.entries(ROOT_CAUSES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
                    <SubmitButton className="btn btn-secondary text-xs" pendingLabel="...">{d.inferred ? "Confirm" : "Save"}</SubmitButton>
                  </ActionForm>
                ) : <span className="text-xs">{d.label}</span>}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Each denial starts with a cause guessed from its category and reason code; confirm or correct it. Preventable causes belong to the front desk, coding, clinical documentation or billing; benefit limits and payer errors are not preventable.</p>
      </Card>
    </>
  );
}
