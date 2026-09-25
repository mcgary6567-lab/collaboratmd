import Link from "next/link";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireSession } from "@/lib/auth";
import { recentRuns, weeklyReportText } from "@/server/automation";
import { emailEnabled, smsEnabled } from "@/server/messaging";
import { stripeReady } from "@/lib/stripe";
import { practiceConfig } from "@/server/integrations";
import { runNowAction, saveAutomationAction } from "@/app/(app)/automation-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, PageHeader } from "@/components/ui";
import { fmtDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

const OPTIONS = [
  { key: "appointmentReminders", label: "Appointment reminders", help: "The day before each visit, with an online check-in link. By text (patients who consented) and email." },
  { key: "balanceReminders", label: "Balance reminders", help: "A secure pay link to patients who owe $25 or more, two weeks after a statement, at most once a month. Skips patients on a payment plan." },
  { key: "claimFollowUp", label: "Unpaid claim follow-up", help: "Asks payers the status (276/277) of claims unpaid after 30 days, at most once a week per claim." },
  { key: "autopay", label: "Autopay", help: "Charges saved cards for payment-plan installments on their due dates. Needs Stripe." },
  { key: "denialAgent", label: "Denial agent", help: "Works new denials overnight: drafts appeals, prepares corrected claims and re-checks coverage, then waits for someone to approve each one." },
  { key: "weeklyReport", label: "Weekly report", help: "Monday email to administrators: collections, denial rate, A/R, unpaid claims, overdue tasks." },
] as const;

export default async function AutomationPage() {
  const s = await requireSession();
  const db = await getDb();
  const [[practice], runs, preview] = await Promise.all([
    db.select().from(schema.practices).where(eq(schema.practices.id, s.practiceId)).limit(1),
    recentRuns(db, s.practiceId),
    weeklyReportText(db, s.practiceId),
  ]);
  const settings = practice.automation ?? {};
  const cfg = await practiceConfig(db, s.practiceId);
  const admin = s.role === "admin";
  const channels = [
    { name: "Email (Resend)", on: emailEnabled(cfg), env: "Settings → Integrations" },
    { name: "Text messages (Twilio)", on: smsEnabled(cfg), env: "Settings → Integrations" },
    { name: "Card payments (Stripe)", on: stripeReady(cfg.stripe), env: "Settings → Integrations" },
    { name: "Daily schedule", on: !!process.env.CRON_SECRET, env: "CRON_SECRET" },
  ];

  return (
    <>
      <PageHeader title="Automation" subtitle="What runs every morning for this practice" actions={<Link href="/settings" className="btn btn-secondary">Back to settings</Link>} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Daily job" className="lg:col-span-2">
          <ActionForm action={saveAutomationAction} className="space-y-3">
            {OPTIONS.map((o) => (
              <label key={o.key} className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm">
                <input type="checkbox" name={o.key} defaultChecked={!!settings[o.key]} disabled={!admin} className="mt-1" />
                <span><span className="font-semibold">{o.label}</span><span className="block text-slate-600">{o.help}</span></span>
              </label>
            ))}
            {admin ? <SubmitButton pendingLabel="Saving...">Save</SubmitButton> : <p className="text-xs text-slate-500">Only an administrator can change these.</p>}
          </ActionForm>
          {admin && (
            <ActionForm action={runNowAction} className="mt-4 border-t border-slate-200 pt-4">
              <SubmitButton className="btn btn-secondary text-xs" pendingLabel="Running...">Run now</SubmitButton>
            </ActionForm>
          )}
        </Card>
        <div className="space-y-6">
          <Card title="Connections">
            <ul className="space-y-2 text-sm">
              {channels.map((c) => (
                <li key={c.name}>
                  <div className="flex items-center justify-between"><span>{c.name}</span>{c.on ? <Badge tone="green">On</Badge> : <Badge>Not set up</Badge>}</div>
                  {!c.on && <div className="text-xs text-slate-500">Set {c.env}</div>}
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Recent runs">
            {runs.length === 0 ? <p className="text-sm text-slate-500">Not run yet.</p> : (
              <ul className="space-y-2 text-xs">
                {runs.map((r) => (
                  <li key={r.id} className="border-b border-slate-100 pb-2 last:border-0">
                    <div className="font-medium">{fmtDateTime(r.ranAt)} {r.error && <span className="text-red-700">· {r.error}</span>}</div>
                    <pre className="whitespace-pre-wrap text-slate-500">{JSON.stringify(r.summary)}</pre>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <Card title="Weekly report preview" className="lg:col-span-3">
          <pre className="whitespace-pre-wrap font-mono text-xs text-slate-700">{preview}</pre>
        </Card>
      </div>
    </>
  );
}
