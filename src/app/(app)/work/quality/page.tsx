import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { requireRole } from "@/lib/auth";
import { findingsFor, QUALITY_TARGET, qualityByWorker, workAuditItemsFor, workAuditList } from "@/server/work-quality";
import { createWorkAuditAction, reviewWorkItemAction } from "@/app/(app)/staff-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Work quality checks" };
export const dynamic = "force-dynamic";

const day = (v: string) => fmtDate(`${v}T00:00:00`);
const pct = (v: number | null) => (v === null ? "-" : `${Math.round(v * 1000) / 10}%`);

/** Samples of billers' claims and postings, checked by someone else, and each person's accuracy. */
export default async function WorkQualityPage({ searchParams }: { searchParams: Promise<{ audit?: string }> }) {
  const s = await requireRole(["admin", "biller"]);
  const q = await searchParams;
  const db = await getDb();
  const now = new Date();
  const [audits, people] = await Promise.all([workAuditList(db, s.practiceId), qualityByWorker(db, s.practiceId, new Date(now.getTime() - 90 * 86_400_000))]);
  const current = audits.find((a) => a.id === q.audit) ?? audits[0];
  const items = current ? await workAuditItemsFor(db, s.practiceId, current.id) : [];
  const admin = s.role === "admin";
  const monthAgo = new Date(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
  return (
    <>
      <PageHeader title="Work quality checks" subtitle={`A random sample of each person's claims sent and payments posted, checked by someone else, against a ${Math.round(QUALITY_TARGET * 100)}% accuracy target.`} actions={<Link href="/coding/audits" className="btn btn-secondary">Coding audits</Link>} />

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card title="Accuracy, last 90 days">
          {people.length === 0 ? <Empty>Nothing checked yet.</Empty> : (
            <div tabIndex={0} role="region" aria-label="Accuracy by person" className="overflow-x-auto">
              <table className="table table-stack text-sm">
                <thead><tr><th>Person</th><th className="text-right">Checked</th><th className="text-right">Wrong</th><th className="text-right">Accuracy</th><th>Most common</th></tr></thead>
                <tbody>{people.map((p) => (
                  <tr key={p.workerId}>
                    <td data-label="Person">{p.name}</td>
                    <td data-label="Checked" className="text-right tabular-nums">{p.reviewed}</td>
                    <td data-label="Wrong" className="text-right tabular-nums">{p.errors}</td>
                    <td data-label="Accuracy" className="text-right"><Badge tone={p.accuracy !== null && p.accuracy >= QUALITY_TARGET ? "green" : "red"}>{pct(p.accuracy)}</Badge></td>
                    <td data-label="Most common">{Object.entries(p.findings).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, n]) => `${k} (${n})`).join("; ") || "-"}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Below the target, the usual next step is coaching on the most common mistake and a follow-up sample.</p>
        </Card>
        <Card title="Samples">
          {admin && (
            <ActionForm action={createWorkAuditAction} className="mb-4 grid gap-2 text-sm sm:grid-cols-4">
              <label className="block"><span className="label">From</span><input type="date" name="from" defaultValue={monthAgo} className="input" required /></label>
              <label className="block"><span className="label">To</span><input type="date" name="to" defaultValue={yesterday} className="input" required /></label>
              <label className="block"><span className="label">Of each kind per person</span><input type="number" name="perPerson" min={1} max={50} defaultValue={5} className="input" required /></label>
              <div className="self-end"><SubmitButton pendingLabel="Drawing...">Draw a sample</SubmitButton></div>
            </ActionForm>
          )}
          {audits.length === 0 ? <Empty>No samples yet.{admin ? "" : " An administrator draws them."}</Empty> : (
            <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-700">
              {audits.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <Link href={`/work/quality?audit=${a.id}`} className={a.id === current?.id ? "font-semibold underline" : "underline"}>{day(a.fromDate)} to {day(a.toDate)}</Link>
                  <span>{a.reviewed} of {a.total} checked{a.errors ? `, ${a.errors} wrong` : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {current && (
        <Card title={`Sample: ${day(current.fromDate)} to ${day(current.toDate)}`}>
          <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-700">
            {items.map((i) => (
              <li key={i.id} className="py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span><span className="font-medium">{i.worker}</span>: {i.href ? <Link href={i.href} className="underline">{i.label}</Link> : i.label}</span>
                  {i.result === "pending" ? <Badge tone="amber">to check</Badge> : i.result === "correct" ? <Badge tone="green">correct</Badge> : <Badge tone="red">wrong: {findingsFor(i.kind)[i.finding ?? ""] ?? i.finding}</Badge>}
                </div>
                {i.note && <p className="text-slate-600 dark:text-slate-300">{i.note}</p>}
                {i.workerId === s.userId ? (i.result === "pending" && <p className="text-xs text-slate-500 dark:text-slate-400">Your own work: someone else checks it.</p>) : (
                  <ActionForm action={reviewWorkItemAction.bind(null, i.id)} className="mt-2 grid gap-2 sm:grid-cols-4">
                    <label className="block"><span className="label">Result</span>
                      <select name="result" defaultValue={i.result === "pending" ? "correct" : i.result} className="input"><option value="correct">Correct</option><option value="error">Wrong</option></select>
                    </label>
                    <label className="block"><span className="label">If wrong, what</span>
                      <select name="finding" defaultValue={i.finding ?? ""} className="input"><option value="">Choose</option>{Object.entries(findingsFor(i.kind)).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                    </label>
                    <label className="block"><span className="label">Note</span><input name="note" defaultValue={i.note ?? ""} className="input" maxLength={500} /></label>
                    <div className="self-end"><SubmitButton className="btn btn-secondary" pendingLabel="...">{i.result === "pending" ? "Save" : "Change"}</SubmitButton></div>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
