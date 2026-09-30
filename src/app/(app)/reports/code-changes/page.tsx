import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { codeChanges } from "@/server/code-changes";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Diagnosis code changes" };
export const dynamic = "force-dynamic";

/** The yearly ICD-10-CM change: codes this practice uses that the new year deletes or turns into categories. */
export default async function CodeChangesPage() {
  const s = await requireSession();
  const r = await codeChanges(await getDb(), s.practiceId);
  if (!r.year) {
    return (
      <>
        <PageHeader title="Diagnosis code changes" subtitle="Codes your practice uses that the new ICD-10-CM year deletes or splits" />
        <Card><Empty>No ICD-10-CM year is loaded yet. Once the platform operator loads the year&apos;s files (Settings, Code sets), this page lists the codes you use that change on October 1.</Empty></Card>
      </>
    );
  }
  const open = r.changes.filter((c) => c.openVisits + c.openAuthorizations + c.openLabOrders > 0).length;
  return (
    <>
      <PageHeader
        title="Diagnosis code changes"
        subtitle={`FY ${r.year} (from October 1, ${r.year - 1}): ${r.totalChanges.toLocaleString("en-US")} codes deleted or turned into categories; ${r.changes.length} of them used by your practice, ${open} on open work`}
        actions={<Link href="/settings/code-sets" className="btn btn-secondary">Code sets</Link>}
      />
      <Card>
        {r.changes.length === 0 ? <Empty>None of the codes that change in FY {r.year} were used by your practice in the last year or are on open work.</Empty> : (
          <div tabIndex={0} role="region" aria-label="Diagnosis code changes" className="overflow-x-auto">
            <table className="table table-stack">
              <thead><tr><th>Code</th><th>Change</th><th className="text-right">Visits, last year</th><th>Open work from October 1</th><th>Use instead</th></tr></thead>
              <tbody>{r.changes.map((c) => (
                <tr key={c.code}>
                  <td data-label="Code"><span className="font-mono">{c.code}</span><div className="text-xs text-slate-500 dark:text-slate-400">{c.description}</div></td>
                  <td data-label="Change">{c.change === "deleted" ? <Badge tone="red">Deleted</Badge> : <Badge tone="amber">Now a category</Badge>}</td>
                  <td data-label="Visits, last year" className="text-right tabular-nums">{c.recentVisits}</td>
                  <td data-label="Open work from October 1" className="text-sm">
                    {c.openVisits + c.openAuthorizations + c.openLabOrders === 0 ? <span className="text-slate-500 dark:text-slate-400">None</span> : (
                      <ul className="space-y-0.5">
                        {c.openVisits > 0 && <li>{c.openVisits} visit{c.openVisits === 1 ? "" : "s"} not billed yet{c.openClaims.length > 0 && <>: {c.openClaims.map((o, i) => <span key={o.claimId}>{i > 0 && ", "}<Link href={`/claims/${o.claimId}/edit`} className="font-mono text-brand-700 underline">{o.controlNumber}</Link> ({fmtDate(o.dateOfService)})</span>)}</>}</li>}
                        {c.openAuthorizations > 0 && <li>{c.openAuthorizations} prior authorization{c.openAuthorizations === 1 ? "" : "s"}</li>}
                        {c.openLabOrders > 0 && <li>{c.openLabOrders} lab order{c.openLabOrders === 1 ? "" : "s"} awaiting results</li>}
                      </ul>
                    )}
                  </td>
                  <td data-label="Use instead" className="text-sm">
                    {c.replacements.length === 0 ? <span className="text-slate-500 dark:text-slate-400">See the CMS conversion table</span> : (
                      <ul className="space-y-0.5">{c.replacements.map((x) => <li key={x.code}><span className="font-mono">{x.code}</span> <span className="text-slate-600 dark:text-slate-300">{x.description}</span></li>)}</ul>
                    )}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          Visits from October 1, {r.year - 1} need the FY {r.year} code; visits before it keep the old one, and the claim scrubber checks each date of service against its own year.
          Nothing is changed for you: pick the replacement the documentation supports. &quot;Use instead&quot; lists the new codes under a split code, or the codes added to the same category; CMS&apos;s conversion table has the official mapping.
        </p>
      </Card>
    </>
  );
}
