import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { CAN_WRITE, requireSession } from "@/lib/auth";
import { listQueries, queryStats, QUERY_TOPICS } from "@/server/coding-queries";
import { answerQueryAction, withdrawQueryAction } from "@/app/(app)/review-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Provider questions" };
export const dynamic = "force-dynamic";

const day = (v: string | null) => (v ? fmtDate(v.length > 10 ? v : `${v}T00:00:00`) : "-");

/** Coders' questions to providers; each holds its claim until answered. */
export default async function QueriesPage() {
  const s = await requireSession();
  const db = await getDb();
  const [open, closed, stats] = await Promise.all([listQueries(db, s.practiceId, "open"), listQueries(db, s.practiceId, "closed", 30), queryStats(db, s.practiceId)]);
  const canWrite = (CAN_WRITE as readonly string[]).includes(s.role);
  return (
    <>
      <PageHeader title="Provider questions" subtitle="Questions to providers about how a visit was documented; the claim waits for the answer" actions={<Link href="/coding" className="btn btn-secondary">Coding help</Link>} />
      <Card title={`Waiting for an answer (${open.length})`}>
        {open.length === 0 ? <Empty>No open questions. Ask one from a claim that cannot be coded as documented.</Empty> : (
          <ul className="divide-y divide-slate-200 dark:divide-slate-700">
            {open.map((q) => (
              <li key={q.id} className="py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{q.provider}</span>
                  <Badge tone="amber">{QUERY_TOPICS[q.topic!] ?? q.topic}</Badge>
                  <Link href={`/patients/${q.patient_id}`} className="text-brand-700 hover:underline">{q.patient}</Link>
                  <span className="text-slate-500">visit {day(q.dos)}</span>
                  {q.claim_id && <Link href={`/claims/${q.claim_id}`} className="text-brand-700 hover:underline">claim</Link>}
                  <span className="text-xs text-slate-500">asked {day(q.asked_at)}{q.asked_by ? ` by ${q.asked_by}` : ""}</span>
                </div>
                <p className="mt-1 whitespace-pre-line text-slate-700 dark:text-slate-200">{q.question}</p>
                {canWrite && (
                  <div className="mt-2 flex flex-wrap items-end gap-3">
                    <ActionForm action={answerQueryAction.bind(null, q.id!)} className="flex grow flex-wrap items-end gap-2">
                      <label className="block grow"><span className="label">The provider&apos;s answer</span><textarea name="answer" rows={2} className="input" maxLength={4000} required /></label>
                      <SubmitButton pendingLabel="Saving...">Record answer</SubmitButton>
                    </ActionForm>
                    <ActionForm action={withdrawQueryAction.bind(null, q.id!)}><SubmitButton className="btn btn-secondary" pendingLabel="...">Withdraw</SubmitButton></ActionForm>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="By provider, last 12 months">
          {stats.length === 0 ? <Empty>No questions yet.</Empty> : (
            <div tabIndex={0} role="region" aria-label="Questions by provider" className="overflow-x-auto">
              <table className="table"><thead><tr><th>Provider</th><th className="text-right">Asked</th><th className="text-right">Open</th><th className="text-right">Median days to answer</th></tr></thead>
                <tbody>{stats.map((r) => <tr key={r.provider}><td>{r.provider}</td><td className="text-right tabular-nums">{r.asked}</td><td className="text-right tabular-nums">{r.open}</td><td className="text-right tabular-nums">{r.medianDays ?? "-"}</td></tr>)}</tbody></table>
            </div>
          )}
        </Card>
        <Card title="Recently answered">
          {closed.length === 0 ? <Empty>None yet.</Empty> : (
            <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-700">
              {closed.map((q) => (
                <li key={q.id} className="py-2">
                  <div className="flex flex-wrap gap-2"><span className="font-semibold">{q.provider}</span><span>{q.patient}</span>{q.status === "withdrawn" ? <Badge>Withdrawn</Badge> : <Badge tone="green">Answered {day(q.answered_at)}</Badge>}</div>
                  {q.answer && <p className="text-xs text-slate-600 dark:text-slate-300">{q.answer}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
