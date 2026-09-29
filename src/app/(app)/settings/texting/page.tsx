import type { Metadata } from "next";
import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireSession } from "@/lib/auth";
import { practiceConfig } from "@/server/integrations";
import { numberKind, registrationAnswers } from "@/server/sms-registration";
import { runOneCheckAction } from "@/app/(app)/doctor-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, PageHeader } from "@/components/ui";
import { siteUrl } from "@/lib/site-url";
import { fmtDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Text message registration" };
export const dynamic = "force-dynamic";

const KIND: Record<string, string> = { local: "an ordinary 10-digit number (A2P 10DLC)", toll_free: "a toll-free number (toll-free verification)", short_code: "a short code", service: "a Twilio messaging service (A2P 10DLC)" };

/** US carriers block unregistered business texts: where the practice's registration stands, and the answers Twilio asks for. */
export default async function TextingPage() {
  const s = await requireSession();
  const db = await getDb();
  const [cfg, [p], [last]] = await Promise.all([
    practiceConfig(db, s.practiceId),
    db.select().from(schema.practices).where(eq(schema.practices.id, s.practiceId)).limit(1),
    db.select().from(schema.integrationChecks).where(and(eq(schema.integrationChecks.practiceId, s.practiceId), eq(schema.integrationChecks.checkId, "twilio.registration"))).orderBy(desc(schema.integrationChecks.ranAt)).limit(1),
  ]);
  const answers = registrationAnswers(p, siteUrl());
  const tone = last?.status === "pass" ? "green" : last?.status === "warn" ? "amber" : last ? "red" : "slate";
  return (
    <>
      <PageHeader title="Text message registration" subtitle="US carriers block business texts from senders that have not registered. Registration is done once, in your Twilio account." actions={<Link href="/settings/connections" className="btn btn-secondary">Integrations</Link>} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Where it stands" actions={<Badge tone={tone}>{last ? (last.status === "pass" ? "Registered" : last.status === "warn" ? "Pending" : "Not registered") : "Not checked"}</Badge>}>
          {!cfg.twilio ? <p className="text-sm text-slate-600">Connect Twilio under Integrations first.</p> : (
            <div className="space-y-3 text-sm">
              <p>You text from {KIND[numberKind(cfg.twilio.from)]}.</p>
              {last && <p className="text-slate-600 dark:text-slate-400">{last.detail} <span className="block text-xs text-slate-500">Checked {fmtDateTime(last.ranAt, s.timeZone)}</span></p>}
              {s.role === "admin" && <ActionForm action={runOneCheckAction.bind(null, "twilio.registration")}><SubmitButton className="btn btn-secondary" pendingLabel="Asking Twilio...">Check now</SubmitButton></ActionForm>}
            </div>
          )}
        </Card>
        <Card title="How to register" className="lg:col-span-2">
          <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-700 dark:text-slate-300">
            <li><b>Ordinary number:</b> in the Twilio console, Messaging, Regulatory compliance, register a <b>brand</b> (your business) and then a <b>campaign</b> (what you text), and add your number to the campaign&apos;s messaging service. Approval usually takes a few days to a few weeks.</li>
            <li><b>Toll-free number:</b> submit it for <b>toll-free verification</b> in the Twilio console with the same answers.</li>
            <li>Come back here and check. Until it is approved, reminders and payment texts may not arrive, and the schedule shows texts that did not reach the phone.</li>
          </ol>
        </Card>
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Brand: your answers">
          <dl className="divide-y divide-slate-100 text-sm dark:divide-slate-800">{answers.brand.map(([k, v]) => <div key={k} className="grid gap-1 py-2 sm:grid-cols-3"><dt className="font-medium">{k}</dt><dd className="sm:col-span-2">{v || <span className="text-amber-700">Add it on the practice profile</span>}</dd></div>)}</dl>
        </Card>
        <Card title="Campaign: your answers">
          <dl className="divide-y divide-slate-100 text-sm dark:divide-slate-800">{answers.campaign.map(([k, v]) => <div key={k} className="grid gap-1 py-2 sm:grid-cols-3"><dt className="font-medium">{k}</dt><dd className="sm:col-span-2">{v}</dd></div>)}</dl>
          <p className="mt-3 text-xs text-slate-500">These describe the texts this system actually sends. Copy them into Twilio&apos;s form; change anything that is not true for your practice.</p>
        </Card>
      </div>
    </>
  );
}
