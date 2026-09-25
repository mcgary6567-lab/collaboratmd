import Link from "next/link";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { siteOrigin } from "@/lib/origin";
import { listApiKeys } from "@/server/api-keys";
import { listDeliveries, listEndpoints, WEBHOOK_EVENTS } from "@/server/webhooks";
import { createApiKeyAction, createWebhookAction, deleteWebhookAction, retryDeliveryAction, revokeApiKeyAction, testWebhookAction, toggleWebhookAction } from "@/app/(app)/developer-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Alert, Badge, Card, Empty, PageHeader } from "@/components/ui";
import { fmtDateTime } from "@/lib/utils";
import { RevealForm } from "./reveal-form";

export const dynamic = "force-dynamic";

const ENDPOINTS = [
  { method: "GET", path: "/api/v1", scope: "read", what: "Check a key: returns the practice it belongs to" },
  { method: "GET", path: "/api/v1/patients?q=&limit=&offset=", scope: "read", what: "List or search patients" },
  { method: "GET", path: "/api/v1/patients/{id}", scope: "read", what: "A patient with insurance and balance" },
  { method: "POST", path: "/api/v1/patients", scope: "write", what: "Create a patient with primary insurance" },
  { method: "GET", path: "/api/v1/claims?status=&updated_since=&patient_id=", scope: "read", what: "List claims, newest change first" },
  { method: "GET", path: "/api/v1/claims/{id}", scope: "read", what: "A claim with lines, money, denials and history" },
  { method: "POST", path: "/api/v1/encounters", scope: "write", what: "Send charges; returns the scrubbed claim" },
  { method: "GET", path: "/api/v1/denials?status=", scope: "read", what: "Denials with plain-English explanations" },
  { method: "GET", path: "/api/v1/payments?since=", scope: "read", what: "Insurance and patient payments posted" },
];

const VERIFY = `import crypto from "node:crypto";

// Express: app.post("/webhooks/collaboratmd", express.raw({ type: "application/json" }), handler)
function verify(rawBody, header, secret) {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=")));
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) return false; // replayed
  const expected = crypto.createHmac("sha256", secret).update(\`\${parts.t}.\${rawBody}\`).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
}
// verify(req.body.toString(), req.get("CollaboratMD-Signature"), process.env.COLLABORATMD_WEBHOOK_SECRET)`;

export default async function DevelopersPage() {
  const s = await requireSession();
  const db = await getDb();
  const [keys, endpoints, deliveries, origin] = await Promise.all([
    listApiKeys(db, s.practiceId),
    listEndpoints(db, s.practiceId),
    listDeliveries(db, s.practiceId, 30),
    siteOrigin().catch(() => "https://your-collaboratmd-site"),
  ]);
  const admin = s.role === "admin";
  const activeKeys = keys.filter((k) => !k.revokedAt);

  return (
    <>
      <PageHeader
        title="Developers"
        subtitle="API keys, webhooks and the REST API reference, for EHRs and partners building on this practice's data"
        actions={<Link href="/settings/connections" className="btn btn-secondary">Integrations</Link>}
      />
      {!admin && <Alert kind="info">Only administrators can create keys and webhooks.</Alert>}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={`API keys · ${activeKeys.length} active`}>
          {admin && (
            <RevealForm action={createApiKeyAction} className="mb-4 flex flex-wrap items-end gap-2">
              <label className="block text-sm"><span className="label">Name</span><input name="name" className="input w-56" placeholder="Epic integration" required maxLength={80} /></label>
              <label className="block text-sm"><span className="label">Access</span>
                <select name="scope" className="input"><option value="read">Read only</option><option value="write">Read and write</option></select>
              </label>
            </RevealForm>
          )}
          {keys.length === 0 ? <Empty>No API keys yet.</Empty> : (
            <table className="table">
              <thead><tr><th>Name</th><th>Key</th><th>Access</th><th>Last used</th><th /></tr></thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id} className={k.revokedAt ? "opacity-50" : ""}>
                    <td>{k.name}</td>
                    <td className="font-mono text-xs">{k.prefix}…</td>
                    <td><Badge tone={k.scope === "write" ? "amber" : "slate"}>{k.scope}</Badge></td>
                    <td className="text-xs">{k.revokedAt ? `revoked ${fmtDateTime(k.revokedAt)}` : k.lastUsedAt ? fmtDateTime(k.lastUsedAt) : "never"}</td>
                    <td>{admin && !k.revokedAt && <ActionForm action={revokeApiKeyAction.bind(null, k.id)}><SubmitButton className="text-xs text-red-700 underline" pendingLabel="...">Revoke</SubmitButton></ActionForm>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-3 text-xs text-slate-500">Keys are stored as hashes and shown only once. Each key is limited to 300 requests a minute.</p>
        </Card>

        <Card title={`Webhooks · ${endpoints.length} endpoint${endpoints.length === 1 ? "" : "s"}`}>
          {admin && (
            <RevealForm action={createWebhookAction} className="mb-4 space-y-2">
              <input name="url" className="input" placeholder="https://example.com/webhooks/collaboratmd" required />
              <input name="description" className="input" placeholder="What receives it (optional)" maxLength={200} />
              <fieldset className="grid gap-1 sm:grid-cols-2">
                {WEBHOOK_EVENTS.map((e) => (
                  <label key={e.type} className="flex items-start gap-2 text-xs" title={e.description}>
                    <input type="checkbox" name="events" value={e.type} defaultChecked className="mt-0.5" /> <span className="font-mono">{e.type}</span>
                  </label>
                ))}
              </fieldset>
            </RevealForm>
          )}
          {endpoints.length === 0 ? <Empty>No endpoints yet.</Empty> : (
            <ul className="space-y-3">
              {endpoints.map((e) => (
                <li key={e.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 truncate font-mono text-xs">{e.url}</span>
                    <Badge tone={e.enabled ? "green" : "slate"}>{e.enabled ? "on" : "paused"}</Badge>
                  </div>
                  {e.description && <p className="text-xs text-slate-500">{e.description}</p>}
                  <p className="mt-1 text-xs text-slate-500">{e.events.join(", ")}</p>
                  <p className="text-xs text-slate-500">Last 7 days: {e.last7.delivered ?? 0} delivered, {e.last7.pending ?? 0} retrying, {e.last7.failed ?? 0} failed</p>
                  {admin && (
                    <div className="mt-2 flex flex-wrap gap-3">
                      <ActionForm action={testWebhookAction.bind(null, e.id)}><SubmitButton className="text-xs text-brand-700 underline" pendingLabel="Sending...">Send test event</SubmitButton></ActionForm>
                      <ActionForm action={toggleWebhookAction.bind(null, e.id, !e.enabled)}><SubmitButton className="text-xs text-slate-600 underline" pendingLabel="...">{e.enabled ? "Pause" : "Resume"}</SubmitButton></ActionForm>
                      <ActionForm action={deleteWebhookAction.bind(null, e.id)}><SubmitButton className="text-xs text-red-700 underline" pendingLabel="...">Delete</SubmitButton></ActionForm>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-6">
        <Card title="Recent webhook deliveries">
          {deliveries.length === 0 ? <Empty>Nothing sent yet. Events are sent when claims, payments, denials and patients change.</Empty> : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>When</th><th>Event</th><th>Endpoint</th><th>Status</th><th>Attempts</th><th>Last answer</th><th /></tr></thead>
                <tbody>
                  {deliveries.map(({ delivery: d, url }) => (
                    <tr key={d.id}>
                      <td className="whitespace-nowrap text-xs">{fmtDateTime(d.createdAt)}</td>
                      <td className="font-mono text-xs">{d.eventType}</td>
                      <td className="max-w-[14rem] truncate font-mono text-xs">{url}</td>
                      <td><Badge tone={d.status === "delivered" ? "green" : d.status === "failed" ? "red" : "amber"}>{d.status}</Badge></td>
                      <td>{d.attempts}</td>
                      <td className="max-w-[16rem] truncate text-xs" title={d.lastError ?? ""}>{d.lastStatus ? `HTTP ${d.lastStatus}` : ""} {d.lastError ?? ""}</td>
                      <td>{admin && d.status !== "delivered" && <ActionForm action={retryDeliveryAction.bind(null, d.id)}><SubmitButton className="text-xs text-brand-700 underline" pendingLabel="...">Retry</SubmitButton></ActionForm>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="REST API reference">
          <p className="mb-3 text-sm text-slate-600">
            JSON over HTTPS at <code className="rounded bg-slate-100 px-1">{origin}/api/v1</code>. Send the key as <code className="rounded bg-slate-100 px-1">Authorization: Bearer cmd_live_…</code>.
            Lists return <code>{`{ data, has_more, next_offset }`}</code>; errors return <code>{`{ error: { code, message } }`}</code>. Money is in cents; dates are ISO 8601.
          </p>
          <table className="table text-xs">
            <thead><tr><th>Call</th><th>Key</th><th>What it does</th></tr></thead>
            <tbody>
              {ENDPOINTS.map((e) => (
                <tr key={e.method + e.path}>
                  <td className="font-mono"><span className={e.method === "POST" ? "text-amber-700" : "text-green-700"}>{e.method}</span> {e.path}</td>
                  <td>{e.scope}</td>
                  <td>{e.what}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">{`curl ${origin}/api/v1/encounters \\
  -H "Authorization: Bearer $CMD_KEY" -H "Content-Type: application/json" \\
  -d '{"patient_id":"…","provider_npi":"1234567893","date_of_service":"2026-09-24",
       "diagnoses":["E11.9","I10"],
       "lines":[{"cpt":"99214","dx_pointers":[1,2]},{"cpt":"83036","dx_pointers":[1]}]}'`}</pre>
        </Card>
        <Card title="Verifying webhooks">
          <p className="mb-3 text-sm text-slate-600">
            Each delivery is a POST with headers <code>CollaboratMD-Event</code>, <code>CollaboratMD-Delivery</code> and <code>CollaboratMD-Signature: t=…,v1=…</code>, where v1 is the HMAC-SHA256 of
            <code> t.body</code> with the endpoint&apos;s signing secret. Answer with any 2xx within 10 seconds; anything else is retried after 1, 5 and 30 minutes, then 2, 6, 12 and 24 hours.
          </p>
          <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">{VERIFY}</pre>
          <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-700">{`{
  "id": "evt_…",
  "type": "claim.status_changed",
  "created": "2026-09-25T14:03:11.000Z",
  "practice_id": "${s.practiceId}",
  "data": { "claim_id": "…", "control_number": "CMD00090223", "status": "paid", "paid_cents": 14260 }
}`}</pre>
        </Card>
      </div>
    </>
  );
}
