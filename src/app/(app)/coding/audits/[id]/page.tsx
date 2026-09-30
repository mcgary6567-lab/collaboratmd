import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { ACCURACY_TARGET, auditDetail, FINDINGS } from "@/server/coding-audits";
import { scoreItemAction } from "@/app/(app)/review-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Coding audit" };
export const dynamic = "force-dynamic";

const pct = (v: number | null) => (v === null ? "-" : `${Math.round(v * 1000) / 10}%`);

export default async function AuditPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession();
  const { id } = await params;
  let d;
  try { d = await auditDetail(await getDb(), s.practiceId, id); } catch { notFound(); }
  const canScore = ["admin", "biller"].includes(s.role);
  return (
    <>
      <PageHeader title={d.audit.name} subtitle={`Visits ${fmtDate(`${d.audit.fromDate}T00:00:00`)} to ${fmtDate(`${d.audit.toDate}T00:00:00`)}, up to ${d.audit.perProvider} claims per provider`} actions={<Link href="/coding/audits" className="btn btn-secondary">All audits</Link>} />
      <Card title="By provider" className="mb-6">
        <div tabIndex={0} role="region" aria-label="Accuracy by provider" className="overflow-x-auto">
          <table className="table table-stack">
            <thead><tr><th>Provider</th><th className="text-right">Reviewed</th><th className="text-right">Errors</th><th className="text-right">Accuracy</th><th>Most common errors</th></tr></thead>
            <tbody>{d.providers.map((p) => (
              <tr key={p.provider}>
                <td data-label="Provider">{p.provider}</td>
                <td data-label="Reviewed" className="text-right tabular-nums">{p.reviewed} of {p.sampled}</td>
                <td data-label="Errors" className="text-right tabular-nums">{p.errors}</td>
                <td data-label="Accuracy" className="text-right">{p.accuracy === null ? "-" : <Badge tone={p.belowTarget ? "red" : "green"}>{pct(p.accuracy)}</Badge>}</td>
                <td data-label="Most common errors" className="text-xs">{Object.entries(p.findings).sort((a, b) => b[1] - a[1]).map(([f, n]) => `${FINDINGS[f] ?? f} (${n})`).join("; ") || "-"}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Below {Math.round(ACCURACY_TARGET * 100)}%: go over the errors with the provider, and audit their claims again after the education.</p>
      </Card>
      <Card title="Claims in the sample">
        <ul className="divide-y divide-slate-200 dark:divide-slate-700">
          {d.items.map((i) => (
            <li key={i.id} className="py-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/claims/${i.claim_id}`} className="font-mono text-brand-700 hover:underline">{i.control_number}</Link>
                <span>{i.patient}</span><span className="text-slate-500">{fmtDate(`${i.dos}T00:00:00`)} · {i.provider}</span>
                <span className="font-mono text-xs">{i.codes}</span>
                {i.result === "pending" ? <Badge>Not reviewed</Badge> : i.result === "correct" ? <Badge tone="green">Correct</Badge> : <Badge tone="red">{FINDINGS[i.finding!] ?? "Error"}</Badge>}
              </div>
              {canScore && (
                <ActionForm action={scoreItemAction.bind(null, id, i.id!)} className="mt-2 flex flex-wrap items-end gap-2">
                  <label className="block"><span className="label">Result</span><select name="result" defaultValue={i.result === "error" ? "error" : "correct"} className="input"><option value="correct">Correct</option><option value="error">Error</option></select></label>
                  <label className="block"><span className="label">If an error, what</span><select name="finding" defaultValue={i.finding ?? ""} className="input"><option value="">-</option>{Object.entries(FINDINGS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                  <label className="block"><span className="label">Billed</span><input name="billedCode" defaultValue={i.billed_code ?? ""} className="input w-24" maxLength={20} /></label>
                  <label className="block"><span className="label">Should be</span><input name="correctCode" defaultValue={i.correct_code ?? ""} className="input w-24" maxLength={20} /></label>
                  <label className="block grow"><span className="label">Note</span><input name="note" defaultValue={i.note ?? ""} className="input" maxLength={1000} /></label>
                  <SubmitButton className="btn btn-secondary" pendingLabel="Saving...">Save</SubmitButton>
                </ActionForm>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
