import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { practiceMaintenance, runtimeStatus, type ItemStatus } from "@/server/maintenance";
import { codeSetCalendar, type SetStatus } from "@/server/code-set-calendar";
import { CODE_SYSTEMS, ISA_VERSION, X12 } from "@/lib/edi/standards";
import { Badge, Card, PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Maintenance" };
export const dynamic = "force-dynamic";

const ITEM: Record<ItemStatus, { tone: "green" | "amber" | "red"; label: string }> = {
  ok: { tone: "green", label: "Up to date" }, soon: { tone: "amber", label: "Coming up" }, attention: { tone: "red", label: "Needs attention" },
};
const SET: Record<SetStatus, { tone: "green" | "amber" | "red" | "slate"; label: string }> = {
  current: { tone: "green", label: "Current" }, due: { tone: "amber", label: "New file due" }, overdue: { tone: "red", label: "Overdue" }, never: { tone: "slate", label: "Not loaded" },
};
const day = (v: string) => fmtDate(`${v}T00:00:00`);

/** What goes out of date on its own: the practice's setup, the national code sets, and the standards and runtime underneath. */
export default async function MaintenancePage() {
  const s = await requireSession();
  const db = await getDb();
  const [items, sets] = await Promise.all([practiceMaintenance(db, s.practiceId), codeSetCalendar(db)]);
  const runtime = runtimeStatus();
  const needs = items.filter((i) => i.status !== "ok").length + sets.filter((x) => x.status === "overdue" || x.status === "due").length + (runtime.status === "ok" ? 0 : 1);
  return (
    <>
      <PageHeader title="Maintenance" subtitle={needs ? `${needs} item${needs === 1 ? "" : "s"} to look at. Rules, codes and certificates change on their own schedules; this page shows where each one stands.` : "Everything is up to date. Rules, codes and certificates change on their own schedules; this page shows where each one stands."} />
      <div className="grid gap-6">
        <Card title="This practice">
          <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-700">
            {items.map((i) => (
              <li key={i.key} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0 max-w-2xl">
                  <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{i.label}</span><Badge tone={ITEM[i.status].tone}>{ITEM[i.status].label}</Badge></div>
                  <p className="mt-1 text-slate-600 dark:text-slate-300">{i.detail}</p>
                </div>
                <Link href={i.href} className="text-brand-700 underline">Open</Link>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Administrators are notified each morning when one of these changes, at most once a month for the same item.</p>
        </Card>

        <Card title="National code sets" actions={<Link href="/settings/code-sets" className="text-sm text-brand-700 hover:underline">Load files</Link>}>
          <div tabIndex={0} role="region" aria-label="Code set calendar" className="overflow-x-auto">
            <table className="table table-stack text-sm">
              <thead><tr><th>Code set</th><th>Status</th><th>Last loaded</th><th>Current release</th><th>Next release</th><th>Source</th></tr></thead>
              <tbody>{sets.map((x) => (
                <tr key={x.set}>
                  <td data-label="Code set">{x.name}{x.loadedYear ? <span className="text-slate-500 dark:text-slate-400"> ({x.set === "icd10cm" ? `FY ${x.loadedYear}` : x.loadedYear})</span> : null}</td>
                  <td data-label="Status"><Badge tone={SET[x.status].tone}>{SET[x.status].label}</Badge></td>
                  <td data-label="Last loaded">{x.lastLoaded ? fmtDate(x.lastLoaded) : "-"}</td>
                  <td data-label="Current release">{day(x.current)}</td>
                  <td data-label="Next release">{day(x.next)}</td>
                  <td data-label="Source"><a href={x.source} target="_blank" rel="noreferrer noopener" className="text-brand-700 underline">CMS</a></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">CMS publishes these on a fixed calendar. Claims are checked against the files loaded, so a set that is overdue means claims are checked against last period&apos;s rules. The platform&apos;s operators are told every week while any set is due or overdue.</p>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Transaction standards in use">
            <ul className="space-y-1 text-sm">
              {Object.entries(X12).map(([k, v]) => <li key={k} className="flex flex-wrap justify-between gap-3"><span>{k} · {v.name}</span><span className="font-mono text-xs">{v.guide}</span></li>)}
            </ul>
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">HIPAA X12 version {ISA_VERSION} (5010), required for all electronic claims, remittances and eligibility checks. When HHS mandates a newer version, it will be added beside this one with its own compliance date.</p>
          </Card>
          <Card title="Code systems and the runtime">
            <ul className="space-y-2 text-sm">
              {CODE_SYSTEMS.map((c) => <li key={c.name}><span className="font-medium">{c.name}</span> <span className="text-slate-500 dark:text-slate-400">({c.use})</span><br /><span className="text-slate-600 dark:text-slate-300">{c.next}</span></li>)}
              <li className="border-t border-slate-200 pt-2 dark:border-slate-700"><span className="font-medium">Node.js runtime</span> <Badge tone={ITEM[runtime.status].tone}>{ITEM[runtime.status].label}</Badge><br /><span className="text-slate-600 dark:text-slate-300">{runtime.detail}</span></li>
            </ul>
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Package updates are proposed every week and tested before they go in; security advisories and the runtime&apos;s support window are checked every month.</p>
          </Card>
        </div>
      </div>
    </>
  );
}
