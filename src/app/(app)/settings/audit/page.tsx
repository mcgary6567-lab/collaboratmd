import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { auditActions, auditEvents, practiceUsers } from "@/server/compliance";
import { Card, Empty, PageHeader } from "@/components/ui";
import { fmtDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

const PAGE = 200;
const label = (a: string) => a.replace(/_/g, " ");

/** Who did what, when: searchable, for administrators. The full log exports as CSV. */
export default async function AuditPage({ searchParams }: { searchParams: Promise<{ action?: string; user?: string; since?: string }> }) {
  const q = await searchParams;
  const s = await requireSession();
  if (s.role !== "admin") return <><PageHeader title="Audit log" /><Card><p className="text-sm text-slate-600">The audit log is for administrators.</p></Card></>;
  const db = await getDb();
  const [events, actions, people] = await Promise.all([
    auditEvents(db, s.practiceId, { action: q.action || undefined, userId: q.user || undefined, since: q.since || undefined, limit: PAGE }),
    auditActions(db, s.practiceId),
    practiceUsers(db, s.practiceId),
  ]);
  const exportQuery = new URLSearchParams(Object.entries({ action: q.action ?? "", user: q.user ?? "", since: q.since ?? "" }).filter(([, v]) => v)).toString();

  return (
    <>
      <PageHeader title="Audit log" subtitle="Sign-ins, changes to settings and records, exports, payments and approvals. Entries cannot be edited or deleted." actions={<a href={`/api/export/audit${exportQuery ? `?${exportQuery}` : ""}`} className="btn btn-secondary">Export CSV</a>} />
      <Card className="mb-6">
        <form className="flex flex-wrap items-end gap-3 text-sm">
          <label className="block"><span className="label">What</span>
            <select name="action" defaultValue={q.action ?? ""} className="input w-56"><option value="">Everything</option>{actions.map((a) => <option key={a} value={a}>{label(a)}</option>)}</select>
          </label>
          <label className="block"><span className="label">Who</span>
            <select name="user" defaultValue={q.user ?? ""} className="input w-56"><option value="">Anyone</option>{people.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
          </label>
          <label className="block"><span className="label">Since</span><input type="date" name="since" defaultValue={q.since ?? ""} className="input" /></label>
          <button className="btn btn-primary">Filter</button>
          {(q.action || q.user || q.since) && <a href="/settings/audit" className="btn btn-secondary">Clear</a>}
        </form>
      </Card>
      <Card title={`${events.length === PAGE ? `Latest ${PAGE}` : events.length} entries`}>
        {events.length === 0 ? <Empty>Nothing matches.</Empty> : (
          <table className="table">
            <thead><tr><th>When</th><th>Who</th><th>What</th><th>Record</th><th>Details</th></tr></thead>
            <tbody>
              {events.map(({ event: e, userName }) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap text-xs">{fmtDateTime(e.at)}</td>
                  <td className="text-sm">{userName ?? <span className="text-slate-400">system</span>}</td>
                  <td className="text-sm font-medium">{label(e.action)}</td>
                  <td className="text-xs text-slate-500">{e.entity}{e.entityId ? <span className="block font-mono">{e.entityId.slice(0, 8)}</span> : null}</td>
                  <td className="max-w-md truncate font-mono text-[11px] text-slate-500" title={e.details ? JSON.stringify(e.details) : ""}>{e.details ? JSON.stringify(e.details) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
