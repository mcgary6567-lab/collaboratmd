import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { codeSetStatus, isPlatformOperator } from "@/server/code-sets";
import { importCodeSetAction } from "@/app/(app)/code-set-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, PageHeader, Stat } from "@/components/ui";
import { fmtDateTime } from "@/lib/utils";
import { fiscalYear } from "@/server/code-catalog";
import { mpfsStatus } from "@/server/mpfs";

/** The fiscal year today is in (October starts the next one). */
const currentFiscalYear = () => fiscalYear(new Date().toISOString().slice(0, 10));

export const metadata: Metadata = { title: "Code sets" };

export const dynamic = "force-dynamic";

const LABEL: Record<string, string> = { ncci_ptp: "NCCI procedure-to-procedure", ncci_mue: "Medically unlikely edits", coverage: "Medicare coverage policies", icd10cm: "ICD-10-CM diagnoses", hcpcs: "HCPCS Level II", mpfs_rvu: "Medicare fee schedule RVUs", mpfs_gpci: "Medicare localities (GPCI)", anesthesia: "Anesthesia base units", telehealth: "Medicare telehealth list", hcc: "HCC risk adjustment mapping" };

export default async function CodeSetsPage() {
  const s = await requireSession();
  const db = await getDb();
  const [status, mpfs] = await Promise.all([codeSetStatus(db), mpfsStatus(db)]);
  const operator = isPlatformOperator(s.email);

  return (
    <>
      <PageHeader title="National code sets" subtitle="What every claim is checked against: ICD-10-CM and HCPCS codes, NCCI code pairs, unit limits and Medicare coverage" actions={<Link href="/settings/payer-edits" className="btn btn-secondary">Payer rules</Link>} />
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <Stat label="ICD-10-CM diagnoses" value={status.icd.toLocaleString("en-US")} hint={status.icdYear ? `Fiscal year ${status.icdYear} (through September 30, ${status.icdYear}) is the newest loaded` : "Not loaded: only the built-in common codes, unchecked"} tone={status.icdYear ? (status.icdYear >= currentFiscalYear() ? "good" : "bad") : "bad"} />
        <Stat label="Medicare fee schedule" value={mpfs.years[0] ? String(mpfs.years[0].year) : "Not loaded"} hint={mpfs.years[0] ? `Conversion factor ${mpfs.years[0].conversionFactor}; ${mpfs.localities} localities` : "Load the RVU and GPCI files to price Medicare claims"} tone={mpfs.years[0] && mpfs.localities ? "good" : "neutral"} />
        <Stat label="HCPCS Level II codes" value={status.hcpcs.toLocaleString("en-US")} hint={status.hcpcs ? "Supplies, drugs and G codes checked on every claim" : "Not loaded: HCPCS codes are not checked"} tone={status.hcpcs ? "good" : "neutral"} />
      </div>
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="NCCI code pairs" value={status.ptp.toLocaleString("en-US")} hint={status.ptp ? "Checked on every claim" : "Not loaded: pair checks are off"} tone={status.ptp ? "good" : "bad"} />
        <Stat label="Unit limits (MUE)" value={status.mue.toLocaleString("en-US")} hint={status.mue ? "Checked on every claim" : "Not loaded: unit checks are off"} tone={status.mue ? "good" : "bad"} />
        <Stat label="Medicare coverage policies" value={status.policies.toLocaleString("en-US")} hint={`${status.coveragePairs.toLocaleString("en-US")} code and diagnosis pairs`} tone={status.policies ? "good" : "neutral"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="How the checks work">
          <ul className="list-disc space-y-2 pl-5 text-sm text-slate-700">
            <li><b>Diagnoses (ICD-10-CM):</b> each must be a billable code (not a category) valid in the fiscal year of the date of service. New codes take effect October 1; deleted codes stay valid for earlier dates of service.</li>
            <li><b>HCPCS Level II:</b> the code must exist and be in effect on the date of service.</li>
            <li><b>Code pairs (NCCI PTP):</b> when two codes on the same day form a pair, the second is flagged. If CMS allows a bypass, an NCCI-associated modifier (59, XE, XS, XP, XU, anatomic, global surgery) clears it.</li>
            <li><b>Unit limits (MUE):</b> units above the daily or per-line limit are flagged.</li>
            <li><b>Medicare coverage:</b> on Medicare claims, a procedure with a coverage policy but no supporting diagnosis gets a warning, since an ABN may be needed.</li>
            <li>Medicare and Medicaid claims are blocked on pair and unit problems; other payers get warnings, because many but not all follow NCCI.</li>
          </ul>
        </Card>
        <Card title="Where the data comes from">
          <ul className="list-disc space-y-2 pl-5 text-sm text-slate-700">
            <li>ICD-10-CM: CMS publishes each fiscal year&apos;s files in the summer (ICD-10-CM page, &quot;Code Descriptions in Tabular Order&quot;). Load <code>icd10cm_order_YYYY.txt</code> with its fiscal year before October 1. Keep loading earlier years&apos; files too if you bill older dates of service.</li>
            <li>HCPCS Level II: CMS&apos;s quarterly Alpha-Numeric HCPCS file. Open the Excel file and save it as CSV.</li>
            <li>Medicare fee schedule: from CMS&apos;s Physician Fee Schedule relative value files each year, the PPRRVU file and the GPCI file (Addendum E), each saved as CSV, with the calendar year. Practices then choose their locality on the practice profile.</li>
            <li>Anesthesia base units: CMS&apos;s anesthesia base unit file saved as CSV (code and base units).</li>
            <li>Medicare telehealth services: CMS&apos;s list for the calendar year (Telehealth, List of Telehealth Services), saved as CSV with its HCPCS, status and audio-only columns, and the year. Medicare telehealth lines for a code not on that year&apos;s list, or audio only where the list does not allow it, get a warning.</li>
            <li>CPT codes and descriptions belong to the American Medical Association and are not loaded here; each practice describes its procedure codes in its own words under Fee schedules.</li>
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
                  <select name="set" className="input"><option value="icd10cm">ICD-10-CM order file</option><option value="hcpcs">HCPCS Level II (CSV)</option><option value="mpfs_rvu">Medicare fee schedule RVUs (PPRRVU, CSV)</option><option value="mpfs_gpci">Medicare localities (GPCI, CSV)</option><option value="anesthesia">Anesthesia base units (CSV)</option><option value="telehealth">Medicare telehealth services list (CSV)</option><option value="hcc">HCC mapping (ICD-10 to HCC, CSV)</option><option value="ncci_ptp">NCCI code pairs (PTP)</option><option value="ncci_mue">Unit limits (MUE)</option><option value="coverage">Medicare coverage (policy, hcpcs, icd10)</option></select>
                </label>
                <label className="block"><span className="label">Year (ICD-10-CM fiscal year; fee schedule or telehealth list year)</span><input name="year" className="input w-28" inputMode="numeric" placeholder={String(currentFiscalYear())} maxLength={4} /></label>
                <label className="block"><span className="label">Conversion factor (RVU file, if not in it)</span><input name="conversionFactor" className="input w-32" inputMode="decimal" placeholder="e.g. 33.4009" /></label>
                <label className="block"><span className="label">Label</span><input name="label" className="input" placeholder="2026 Q4 practitioner PTP, part 1" /></label>
                <label className="block"><span className="label">File (up to 4 MB)</span><input type="file" name="file" accept=".txt,.csv,.tsv" className="input" required /></label>
                <SubmitButton pendingLabel="Loading...">Load</SubmitButton>
              </ActionForm>
              <p className="mt-3 text-xs text-slate-500">
                The full ICD-10-CM and quarterly PTP files are larger than an upload allows; load them from a terminal with DATABASE_URL set:
                <code className="ml-1 rounded bg-slate-100 px-1 text-slate-700">npm run import:code-sets -- icd10cm ./icd10cm_order_2027.txt 2027</code>
                <code className="ml-1 rounded bg-slate-100 px-1 text-slate-700">npm run import:code-sets -- ncci_ptp ./ccipra-v324r0-f1.txt &quot;2026 Q4 PTP part 1&quot;</code>
              </p>
            </>
          ) : (
            <p className="text-sm text-slate-600">National code sets are shared by every practice and kept current by CollaboratMD each quarter.</p>
          )}
        </Card>
      </div>

      <div className="mt-6">
        <Card title="Load history">
          {status.loads.length === 0 ? <p className="text-sm text-slate-500">Nothing loaded yet.</p> : (
            <div tabIndex={0} role="region" aria-label="Table (scrolls sideways)" className="overflow-x-auto"><table className="table text-sm">
              <thead><tr><th>When</th><th>Code set</th><th>Label</th><th className="text-right">Rows</th><th>By</th></tr></thead>
              <tbody>{status.loads.map((l) => <tr key={l.id}><td className="text-xs">{fmtDateTime(l.createdAt, s.timeZone)}</td><td>{LABEL[l.codeSet] ?? l.codeSet}</td><td>{l.label}</td><td className="text-right tabular-nums">{l.rows.toLocaleString("en-US")}</td><td className="text-xs">{l.loadedBy}</td></tr>)}</tbody>
            </table></div>
          )}
        </Card>
      </div>
    </>
  );
}
