import Link from "next/link";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { codeSetStatus, isPlatformOperator } from "@/server/code-sets";
import { importCodeSetAction } from "@/app/(app)/code-set-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, PageHeader, Stat } from "@/components/ui";
import { fmtDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

const LABEL: Record<string, string> = { ncci_ptp: "NCCI procedure-to-procedure", ncci_mue: "Medically unlikely edits", coverage: "Medicare coverage policies" };

export default async function CodeSetsPage() {
  const s = await requireSession();
  const db = await getDb();
  const status = await codeSetStatus(db);
  const operator = isPlatformOperator(s.email);

  return (
    <>
      <PageHeader title="National code sets" subtitle="CMS edits every professional claim is checked against: NCCI code pairs, unit limits and Medicare coverage" actions={<Link href="/settings/payer-edits" className="btn btn-secondary">Payer rules</Link>} />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="NCCI code pairs" value={status.ptp.toLocaleString("en-US")} hint={status.ptp ? "Checked on every claim" : "Not loaded: pair checks are off"} tone={status.ptp ? "good" : "bad"} />
        <Stat label="Unit limits (MUE)" value={status.mue.toLocaleString("en-US")} hint={status.mue ? "Checked on every claim" : "Not loaded: unit checks are off"} tone={status.mue ? "good" : "bad"} />
        <Stat label="Medicare coverage policies" value={status.policies.toLocaleString("en-US")} hint={`${status.coveragePairs.toLocaleString("en-US")} code and diagnosis pairs`} tone={status.policies ? "good" : "neutral"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="How the checks work">
          <ul className="list-disc space-y-2 pl-5 text-sm text-slate-700">
            <li><b>Code pairs (NCCI PTP):</b> when two codes on the same day form a pair, the second is flagged. If CMS allows a bypass, an NCCI-associated modifier (59, XE, XS, XP, XU, anatomic, global surgery) clears it.</li>
            <li><b>Unit limits (MUE):</b> units above the daily or per-line limit are flagged.</li>
            <li><b>Medicare coverage:</b> on Medicare claims, a procedure with a coverage policy but no supporting diagnosis gets a warning, since an ABN may be needed.</li>
            <li>Medicare and Medicaid claims are blocked on pair and unit problems; other payers get warnings, because many but not all follow NCCI.</li>
          </ul>
        </Card>
        <Card title="Where the data comes from">
          <ul className="list-disc space-y-2 pl-5 text-sm text-slate-700">
            <li>NCCI code pairs and unit limits: CMS publishes them quarterly as downloads on the National Correct Coding Initiative pages (practitioner files). Save each table as tab- or comma-separated text.</li>
            <li>Coverage: from the Medicare Coverage Database downloads, join each article&apos;s HCPCS codes to its covered ICD-10 codes and save as <code>policy_id, title, hcpcs, icd10</code>.</li>
            <li>The importer finds the header row itself, skips CMS&apos;s title lines, and reports rows it could not read. Loading a newer quarter updates the same rows.</li>
          </ul>
        </Card>
      </div>

      <div className="mt-6">
        <Card title="Load a file" actions={operator ? <Badge tone="green">Platform operator</Badge> : <Badge>Read only</Badge>}>
          {operator ? (
            <>
              <ActionForm action={importCodeSetAction} className="flex flex-wrap items-end gap-3 text-sm">
                <label className="block"><span className="label">Code set</span>
                  <select name="set" className="input"><option value="ncci_ptp">NCCI code pairs (PTP)</option><option value="ncci_mue">Unit limits (MUE)</option><option value="coverage">Medicare coverage (policy, hcpcs, icd10)</option></select>
                </label>
                <label className="block"><span className="label">Label</span><input name="label" className="input" placeholder="2026 Q4 practitioner PTP, part 1" /></label>
                <label className="block"><span className="label">File (up to 4 MB)</span><input type="file" name="file" accept=".txt,.csv,.tsv" className="input" required /></label>
                <SubmitButton pendingLabel="Loading...">Load</SubmitButton>
              </ActionForm>
              <p className="mt-3 text-xs text-slate-500">
                The full quarterly PTP files are far larger than an upload allows; load them from a terminal with DATABASE_URL set:
                <code className="ml-1 rounded bg-slate-100 px-1">npm run import:code-sets -- ncci_ptp ./ccipra-v324r0-f1.txt &quot;2026 Q4 PTP part 1&quot;</code>
              </p>
            </>
          ) : (
            <p className="text-sm text-slate-600">National code sets are shared by every practice and loaded by the platform operator (the emails in PLATFORM_ADMIN_EMAILS).</p>
          )}
        </Card>
      </div>

      <div className="mt-6">
        <Card title="Load history">
          {status.loads.length === 0 ? <p className="text-sm text-slate-500">Nothing loaded yet.</p> : (
            <table className="table text-sm">
              <thead><tr><th>When</th><th>Code set</th><th>Label</th><th className="text-right">Rows</th><th>By</th></tr></thead>
              <tbody>{status.loads.map((l) => <tr key={l.id}><td className="text-xs">{fmtDateTime(l.createdAt)}</td><td>{LABEL[l.codeSet] ?? l.codeSet}</td><td>{l.label}</td><td className="text-right tabular-nums">{l.rows.toLocaleString("en-US")}</td><td className="text-xs">{l.loadedBy}</td></tr>)}</tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}
