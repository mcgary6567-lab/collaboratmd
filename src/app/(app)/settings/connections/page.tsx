import Link from "next/link";
import { CheckCircle2, CircleDashed, CircleOff, ExternalLink, Server } from "lucide-react";
import { getDb } from "@/db";
import { accessiblePractices, requireSession } from "@/lib/auth";
import { listIntegrations } from "@/server/integrations";
import { siteOrigin } from "@/lib/origin";
import { disconnectConnectionAction, saveConnectionAction, testConnectionAction, testEmailAction, testSmsAction } from "@/app/(app)/connection-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Alert, Card, PageHeader } from "@/components/ui";
import { fmtDateTime } from "@/lib/utils";
import { CopyField } from "./copy-field";

export const dynamic = "force-dynamic";

const STATUS = {
  practice: { label: "Connected", tone: "bg-green-100 text-green-800", icon: CheckCircle2 },
  environment: { label: "Using the deployment's keys", tone: "bg-blue-100 text-blue-800", icon: Server },
  off: { label: "Not connected", tone: "bg-slate-100 text-slate-600", icon: CircleDashed },
  disabled: { label: "Switched off", tone: "bg-amber-100 text-amber-800", icon: CircleOff },
} as const;

export default async function ConnectionsPage() {
  const s = await requireSession();
  const db = await getDb();
  const [items, practices, origin] = await Promise.all([
    listIntegrations(db, s.practiceId),
    accessiblePractices(db, s.userId),
    siteOrigin().catch(() => null),
  ]);
  const admin = s.role === "admin";
  const adminOf = practices.filter((p) => p.role === "admin").length;
  const connected = items.filter((i) => i.connected).length;

  return (
    <>
      <PageHeader
        title="Integrations"
        subtitle="Paste a service's keys, test the connection, and the features that depend on it switch on for this practice"
        actions={<Link href="/settings" className="btn btn-secondary">Settings</Link>}
      />
      {!admin && <Alert kind="info">Only administrators can change integrations. You can see what is connected.</Alert>}

      <div className="mb-6 grid gap-3 sm:grid-cols-5">
        {items.map((i) => {
          const st = STATUS[i.row && !i.row.enabled ? "disabled" : i.source];
          const Icon = st.icon;
          return (
            <a key={i.provider} href={`#${i.provider}`} className="card flex items-center gap-3 p-3 transition-shadow hover:shadow-md">
              <Icon className={`h-5 w-5 shrink-0 ${i.connected ? "text-green-600" : "text-slate-400"}`} />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{i.def.name}</div>
                <div className="truncate text-xs text-slate-500">{i.def.category}</div>
              </div>
            </a>
          );
        })}
      </div>
      <p className="mb-6 text-sm text-slate-600">
        {connected} of {items.length} services connected. Keys are encrypted before they are stored and never shown again; only the last four characters appear below.
      </p>

      <div className="space-y-6">
        {items.map((i) => {
          const st = STATUS[i.row && !i.row.enabled ? "disabled" : i.source];
          const hints = i.row?.secretHints ?? {};
          const settings = i.row?.settings ?? {};
          return (
            <section key={i.provider} id={i.provider} className="scroll-mt-24">
              <Card
                title={`${i.def.name} · ${i.def.category}`}
                actions={<span className={`badge ${st.tone}`}>{st.label}</span>}
              >
                <div className="grid gap-6 lg:grid-cols-5">
                  <div className="space-y-3 lg:col-span-2">
                    <p className="text-sm text-slate-700">{i.def.purpose}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {i.def.unlocks.map((u) => (
                        <span key={u} className={`badge ${i.connected ? "bg-green-50 text-green-800" : "bg-slate-100 text-slate-500"}`}>{u}</span>
                      ))}
                    </div>
                    <a href={i.def.signup} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline">
                      Get your keys from {i.def.name} <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                    {i.row?.lastTestAt && (
                      <p className={`rounded-lg px-3 py-2 text-xs ${i.row.lastTestOk ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>
                        Last test {fmtDateTime(i.row.lastTestAt)}: {i.row.lastTestMessage}
                      </p>
                    )}
                    {i.source === "environment" && !i.row && (
                      <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800">This practice uses the keys set for the whole deployment. Save keys here to use the practice&apos;s own account instead.</p>
                    )}
                    {i.extra && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{i.extra}</p>}
                    {i.provider === "stripe" && (
                      <div>
                        <p className="label">Webhook URL for Stripe</p>
                        {origin ? <CopyField value={`${origin}/api/stripe/webhook/${s.practiceId}`} /> : <p className="text-xs text-slate-500">Set APP_URL to see the webhook address.</p>}
                        <p className="mt-1 text-xs text-slate-500">In Stripe → Developers → Webhooks, add this endpoint for the events checkout.session.completed and checkout.session.async_payment_succeeded.</p>
                        <p className="mt-2 text-xs text-slate-500">Apple Pay and Google Pay: Stripe Checkout shows them automatically on supported phones and browsers once they are turned on under Stripe → Settings → Payment methods. Nothing else to set up here.</p>
                      </div>
                    )}
                    {i.provider === "twilio" && (
                      <div>
                        <p className="label">Incoming message webhook for Twilio</p>
                        {origin ? <CopyField value={`${origin}/api/twilio/sms/${s.practiceId}`} /> : <p className="text-xs text-slate-500">Set APP_URL to see the webhook address.</p>}
                        <p className="mt-1 text-xs text-slate-500">In Twilio → Phone Numbers → your number → Messaging, set &ldquo;A message comes in&rdquo; to this URL (HTTP POST). Replies then appear under Text messages, and STOP replies turn texting off for that number.</p>
                      </div>
                    )}
                  </div>

                  <div className="lg:col-span-3">
                    <ActionForm action={saveConnectionAction.bind(null, i.provider)} className="space-y-3">
                      {i.def.settings.filter((f) => f.kind !== "boolean").map((f) => (
                        <label key={f.key} className="block text-sm">
                          <span className="label">{f.label}{f.optional ? " (optional)" : ""}</span>
                          <input name={`setting_${f.key}`} defaultValue={typeof settings[f.key] === "string" ? String(settings[f.key]) : ""} placeholder={f.placeholder} className="input font-mono" disabled={!admin} autoComplete="off" />
                          {f.help && <span className="mt-1 block text-xs text-slate-500">{f.help}</span>}
                        </label>
                      ))}
                      {i.def.secrets.map((f) => (
                        <label key={f.key} className="block text-sm">
                          <span className="label">{f.label}</span>
                          <input
                            name={`secret_${f.key}`}
                            type="password"
                            placeholder={hints[f.key] ? `Saved ${hints[f.key]} · leave blank to keep` : f.placeholder}
                            className="input font-mono"
                            disabled={!admin}
                            autoComplete="new-password"
                            spellCheck={false}
                          />
                          {f.help && <span className="mt-1 block text-xs text-slate-500">{f.help}</span>}
                        </label>
                      ))}
                      {i.def.settings.filter((f) => f.kind === "boolean").map((f) => (
                        <label key={f.key} className="flex items-start gap-2 text-sm">
                          <input type="checkbox" name={`setting_${f.key}`} defaultChecked={settings[f.key] === true} disabled={!admin} className="mt-1" />
                          <span>{f.label}{f.help && <span className="block text-xs text-slate-500">{f.help}</span>}</span>
                        </label>
                      ))}
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" name="enabled" defaultChecked={i.row ? i.row.enabled : true} disabled={!admin} /> Use {i.def.name} for this practice
                      </label>
                      {adminOf > 1 && (
                        <label className="flex items-center gap-2 text-sm">
                          <input type="checkbox" name="allPractices" disabled={!admin} /> Apply to all {adminOf} practices I administer
                        </label>
                      )}
                      {admin && <SubmitButton pendingLabel="Saving and testing...">Save and test</SubmitButton>}
                    </ActionForm>
                    {admin && (
                      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                        {i.connected && (
                          <ActionForm action={testConnectionAction.bind(null, i.provider)}>
                            <SubmitButton className="btn btn-secondary text-xs" pendingLabel="Testing...">Test connection</SubmitButton>
                          </ActionForm>
                        )}
                        {i.provider === "resend" && i.connected && (
                          <ActionForm action={testEmailAction}>
                            <SubmitButton className="btn btn-secondary text-xs" pendingLabel="Sending...">Email me a test</SubmitButton>
                          </ActionForm>
                        )}
                        {i.provider === "twilio" && i.connected && (
                          <ActionForm action={testSmsAction} className="flex items-center gap-2">
                            <input name="to" placeholder="Your mobile number" className="input w-44 py-1 text-xs" aria-label="Mobile number for a test text" />
                            <SubmitButton className="btn btn-secondary text-xs" pendingLabel="Sending...">Text me a test</SubmitButton>
                          </ActionForm>
                        )}
                        {i.row && (
                          <ActionForm action={disconnectConnectionAction.bind(null, i.provider)}>
                            <SubmitButton className="btn btn-secondary text-xs text-red-700" pendingLabel="Removing...">Remove keys</SubmitButton>
                          </ActionForm>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            </section>
          );
        })}

        <Card title="Deployment settings (set in Vercel, not here)">
          <p className="mb-3 text-sm text-slate-600">These belong to the whole installation rather than a practice, so they are environment variables in the hosting project.</p>
          <ul className="space-y-2 text-sm">
            <li className="flex items-center justify-between gap-3">
              <span><b>Site address</b> <span className="text-slate-500">(APP_URL; links sent to patients)</span></span>
              <span className={`badge ${origin ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}>{origin ?? "not set"}</span>
            </li>
            <li className="flex items-center justify-between gap-3">
              <span><b>Daily automation</b> <span className="text-slate-500">(CRON_SECRET; reminders, follow-up, autopay, reports)</span></span>
              <span className={`badge ${process.env.CRON_SECRET ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}>{process.env.CRON_SECRET ? "on" : "not set"}</span>
            </li>
            <li className="flex items-center justify-between gap-3">
              <span><b>Encryption key</b> <span className="text-slate-500">(AUTH_SECRET; protects sessions and the keys above)</span></span>
              <span className={`badge ${process.env.AUTH_SECRET ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>{process.env.AUTH_SECRET ? "set" : "missing"}</span>
            </li>
          </ul>
          <p className="mt-3 text-xs text-slate-500">Changing AUTH_SECRET makes the saved keys above unreadable; they would need to be entered again.</p>
        </Card>
      </div>
    </>
  );
}
