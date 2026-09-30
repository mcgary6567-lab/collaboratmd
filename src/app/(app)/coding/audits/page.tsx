import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { ACCURACY_TARGET, listAudits } from "@/server/coding-audits";
import { createAuditAction } from "@/app/(app)/review-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Coding audits" };
export const dynamic = "force-dynamic";

const day = (v: string) => fmtDate(`${v}T00:00:00`);

/** Internal coding audits: a random sample of each provider's claims, checked against the documentation. */
export default async function AuditsPage() {
  const s = await requireSession();
  const audits = await listAudits(await getDb(), s.practiceId);
  const canCreate = ["admin", "biller"].includes(s.role);
  const today = new Date().toISOString().slice(0, 10);
  const quarterAgo = new Date(Date.parse(`${today}T12:00:00Z`) - 91 * 86_400_000).toISOString().slice(0, 10);
  return (
    <>
      <PageHeader title="Coding audits" subtitle={`A random sample of each provider's claims, checked against the notes; accuracy target ${Math.round(ACCURACY_TARGET * 100)}%`} actions={<Link href="/coding/queries" className="btn btn-secondary">Provider questions</Link>} />
      {canCreate && (
        <Card title="Start an audit" className="mb-6">
          <ActionForm action={createAuditAction} className="flex flex-wrap items-end gap-3 text-sm">
            <label className="block"><span className="label">Name</span><input name="name" className="input" required maxLength={120} placeholder="Q3 2026 visit levels" /></label>
            <label className="block"><span className="label">Visits from</span><input name="fromDate" type="date" defaultValue={quarterAgo} className="input" required /></label>
            <label className="block"><span className="label">to</span><input name="toDate" type="date" defaultValue={today} className="input" required /></label>
            <label className="block"><span className="label">Claims per provider</span><input name="perProvider" type="number" min={1} max={100} defaultValue={10} className="input w-24" required /></label>
            <SubmitButton pendingLabel="Sampling...">Sample claims</SubmitButton>
          </ActionForm>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Claims are picked at random from each provider&apos;s billed visits in the period. Have someone other than the person who coded them review each one against the note.</p>
        </Card>
      )}
      <Card title="Audits">
        {audits.length === 0 ? <Empty>No audits yet.</Empty> : (
          <div tabIndex={0} role="region" aria-label="Audits" className="overflow-x-auto">
            <table className="table table-stack">
              <thead><tr><th>Audit</th><th>Visits</th><th className="text-right">Reviewed</th><th className="text-right">Accuracy</th></tr></thead>
              <tbody>{audits.map((a) => {
                const acc = a.reviewed ? (a.reviewed - a.errors) / a.reviewed : null;
                return (
                  <tr key={a.id}>
                    <td data-label="Audit"><Link href={`/coding/audits/${a.id}`} className="font-semibold text-brand-700 hover:underline">{a.name}</Link><div className="text-xs text-slate-500 dark:text-slate-400">started {day(a.created)}</div></td>
                    <td data-label="Visits">{day(a.fromDate)} to {day(a.toDate)}</td>
                    <td data-label="Reviewed" className="text-right tabular-nums">{a.reviewed} of {a.sampled}</td>
                    <td data-label="Accuracy" className="text-right">{acc === null ? "-" : <Badge tone={acc >= ACCURACY_TARGET ? "green" : "red"}>{Math.round(acc * 1000) / 10}%</Badge>}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
