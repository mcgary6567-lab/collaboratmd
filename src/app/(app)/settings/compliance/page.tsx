import Link from "next/link";
import { CheckCircle2, CircleAlert, CircleX } from "lucide-react";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { auditActions, auditEvents, BAA_STATUSES, evaluateControls, lastAccessReview, listVendors, practiceUsers, type Control } from "@/server/compliance";
import { accessReviewAction, saveVendorAction } from "@/app/(app)/compliance-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Alert, Badge, Card, PageHeader } from "@/components/ui";
import { fmtDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

const ICON = { pass: CheckCircle2, warn: CircleAlert, fail: CircleX };
const TONE = { pass: "text-green-600", warn: "text-amber-500", fail: "text-red-600" };
const BAA_LABEL: Record<string, string> = { signed: "BAA signed", pending: "BAA requested", not_needed: "No BAA needed", not_recorded: "Not recorded" };

export default async function CompliancePage({ searchParams }: { searchParams: Promise<{ action?: string; user?: string; since?: string }> }) {
  const sp = await searchParams;
  const s = await requireSession();
  const db = await getDb();
  const [controls, people, review, vendors, events, actions] = await Promise.all([
    evaluateControls(db, s.practiceId),
    practiceUsers(db, s.practiceId),
    lastAccessReview(db, s.practiceId),
    listVendors(db, s.practiceId),
    auditEvents(db, s.practiceId, { action: sp.action, userId: sp.user, since: sp.since, limit: 100 }),
    auditActions(db, s.practiceId),
  ]);
  const admin = s.role === "admin";
  const passing = controls.filter((c) => c.status === "pass").length;
  const areas = [...new Set(controls.map((c) => c.area))];
  const exportQuery = new URLSearchParams(Object.entries({ action: sp.action ?? "", user: sp.user ?? "", since: sp.since ?? "" }).filter(([, v]) => v)).toString();

  return (
    <>
      <PageHeader title="Compliance" subtitle="HIPAA Security Rule and SOC 2 groundwork: controls, access reviews, vendor agreements and the audit trail" actions={<Link href="/settings" className="btn btn-secondary">Settings</Link>} />
      {!admin && <Alert kind="info">Only administrators can record reviews and vendor agreements.</Alert>}

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <div className="card p-5 md:col-span-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Controls passing</p>
          <p className="mt-1 text-4xl font-extrabold">{passing}<span className="text-xl text-slate-400"> / {controls.length}</span></p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-green-500" style={{ width: `${Math.round((passing / controls.length) * 100)}%` }} /></div>
        </div>
        <div className="card p-5 text-sm text-slate-600 md:col-span-2">
          These checks read how this practice is actually set up. They support preparing for a HIPAA risk assessment or a SOC 2 audit; they are not a certification.
          Written policies, workforce training, a documented risk analysis and an auditor&apos;s review are still needed, and are outside what software can verify.
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {areas.map((area) => (
          <Card key={area} title={area}>
            <ul className="space-y-3">
              {controls.filter((c) => c.area === area).map((c: Control) => {
                const Icon = ICON[c.status];
                return (
                  <li key={c.key} className="flex gap-3 text-sm">
                    <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${TONE[c.status]}`} />
                    <div>
                      <p className="font-medium text-slate-900">{c.title}</p>
                      <p className="text-slate-600">{c.detail} {c.href && c.status !== "pass" && <Link className="font-semibold text-brand-700 underline" href={c.href}>Fix</Link>}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        ))}
      </div>

      <div className="mt-6">
        <Card title={`Access review · ${people.length} people with access`} actions={review ? <Badge tone="slate">Last review {fmtDateTime(review.createdAt)}</Badge> : <Badge tone="red">Never reviewed</Badge>}>
          <div className="overflow-x-auto">
            <table className="table text-sm">
              <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Two-factor</th><th>Last sign-in</th><th>Status</th></tr></thead>
              <tbody>
                {people.map((u) => {
                  const dormant = !u.lastLogin || Date.now() - u.lastLogin.getTime() > 90 * 86_400_000;
                  return (
                    <tr key={u.id}>
                      <td>{u.name}</td>
                      <td className="text-xs">{u.email}</td>
                      <td className="capitalize">{u.role.replace("_", " ")}</td>
                      <td>{u.mfaEnabledAt ? <Badge tone="green">on</Badge> : <Badge tone="red">off</Badge>}</td>
                      <td className="text-xs">{u.lastLogin ? fmtDateTime(u.lastLogin) : "never"}</td>
                      <td>{u.lockedUntil && u.lockedUntil > new Date() ? <Badge tone="red">locked</Badge> : dormant ? <Badge tone="amber">dormant</Badge> : <Badge tone="green">active</Badge>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {admin && (
            <ActionForm action={accessReviewAction} className="mt-4 flex flex-wrap items-end gap-3">
              <label className="block min-w-[18rem] flex-1 text-sm"><span className="label">Review notes (who you removed or changed, and why)</span><input name="notes" className="input" placeholder="Removed former front-desk temp; confirmed roles for billing team" /></label>
              <SubmitButton pendingLabel="Recording...">Record access review</SubmitButton>
            </ActionForm>
          )}
        </Card>
      </div>

      <div className="mt-6">
        <Card title="Vendors and business associate agreements">
          <p className="mb-3 text-sm text-slate-600">Vendors this deployment uses are listed automatically. Record whether a BAA is signed; a vendor&apos;s willingness to sign is between you and them.</p>
          <div className="space-y-3">
            {vendors.map((v) => (
              <ActionForm key={v.id} action={saveVendorAction.bind(null, v.id)} className="grid items-end gap-2 rounded-lg border border-slate-200 p-3 text-sm md:grid-cols-[1fr_1fr_auto_auto_1fr_auto]">
                <input type="hidden" name="vendor" value={v.vendor} />
                <div><p className="font-semibold">{v.vendor}</p><input name="service" defaultValue={v.service} className="input mt-1 py-1 text-xs" disabled={!admin} /></div>
                <label className="block"><span className="label">Agreement</span>
                  <select name="baaStatus" defaultValue={v.baaStatus} className="input py-1" disabled={!admin}>{BAA_STATUSES.map((st) => <option key={st} value={st}>{BAA_LABEL[st]}</option>)}</select>
                </label>
                <label className="block"><span className="label">Signed on</span><input type="date" name="signedOn" defaultValue={v.signedOn ?? ""} className="input py-1" disabled={!admin} /></label>
                <label className="flex items-center gap-1.5 pb-2"><input type="checkbox" name="handlesPhi" defaultChecked={v.handlesPhi} disabled={!admin} /> Handles PHI</label>
                <input name="notes" defaultValue={v.notes ?? ""} placeholder="Where the agreement is filed" className="input py-1" disabled={!admin} />
                {admin && <SubmitButton className="btn btn-secondary text-xs" pendingLabel="...">Save</SubmitButton>}
              </ActionForm>
            ))}
            {admin && (
              <ActionForm action={saveVendorAction.bind(null, null)} className="grid items-end gap-2 rounded-lg border border-dashed border-slate-300 p-3 text-sm md:grid-cols-[1fr_1fr_auto_auto]">
                <label className="block"><span className="label">Other vendor</span><input name="vendor" className="input py-1" placeholder="EHR vendor, IT support, shredding service" required /></label>
                <label className="block"><span className="label">What they do</span><input name="service" className="input py-1" /></label>
                <input type="hidden" name="baaStatus" value="not_recorded" />
                <label className="flex items-center gap-1.5 pb-2"><input type="checkbox" name="handlesPhi" defaultChecked /> Handles PHI</label>
                <SubmitButton className="btn btn-secondary text-xs" pendingLabel="...">Add vendor</SubmitButton>
              </ActionForm>
            )}
          </div>
        </Card>
      </div>

      <div className="mt-6">
        <Card title="Audit log" actions={admin ? <a href={`/api/export/audit${exportQuery ? `?${exportQuery}` : ""}`} className="btn btn-secondary text-xs">Export CSV</a> : undefined}>
          <form action="/settings/compliance" className="mb-3 flex flex-wrap items-end gap-2 text-sm">
            <label className="block"><span className="label">Action</span>
              <select name="action" defaultValue={sp.action ?? ""} className="input py-1"><option value="">All actions</option>{actions.map((a) => <option key={a} value={a}>{a.replace(/_/g, " ")}</option>)}</select>
            </label>
            <label className="block"><span className="label">Person</span>
              <select name="user" defaultValue={sp.user ?? ""} className="input py-1"><option value="">Everyone</option>{people.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
            </label>
            <label className="block"><span className="label">Since</span><input type="date" name="since" defaultValue={sp.since ?? ""} className="input py-1" /></label>
            <button className="btn btn-secondary">Filter</button>
          </form>
          <div className="max-h-[28rem] overflow-auto">
            <table className="table text-xs">
              <thead className="sticky top-0 bg-white"><tr><th>When</th><th>Who</th><th>Action</th><th>Record</th><th>Details</th></tr></thead>
              <tbody>
                {events.map(({ event: e, userName }) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap">{fmtDateTime(e.at)}</td>
                    <td>{userName ?? "System or patient"}</td>
                    <td className="font-mono">{e.action}</td>
                    <td>{e.entity}{e.entityId ? ` ${e.entityId.slice(0, 8)}` : ""}</td>
                    <td className="max-w-md truncate text-slate-500" title={e.details ? JSON.stringify(e.details) : ""}>{e.details ? JSON.stringify(e.details) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-slate-500">Showing the latest 100 matching events. Export includes up to 50,000.</p>
        </Card>
      </div>
    </>
  );
}
