import Link from "next/link";
import { getDb } from "@/db";
import { CAN_WRITE, can, requireSession } from "@/lib/auth";
import { practiceConfig } from "@/server/integrations";
import { listThreads, openThread } from "@/server/sms-inbox";
import { linkThreadAction, replySmsAction } from "@/app/(app)/front-desk-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { fmtDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

const pretty = (e164: string) => e164.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, "($1) $2-$3");

export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ phone?: string }> }) {
  const { phone } = await searchParams;
  const s = await requireSession();
  if (!can(s, "messages")) {
    return <><PageHeader title="Text messages" /><Card><p className="text-sm text-slate-600">Your role{s.customRole ? ` (${s.customRole})` : ""} does not include text messages.</p></Card></>;
  }
  const db = await getDb();
  const [threads, cfg] = await Promise.all([listThreads(db, s.practiceId), practiceConfig(db, s.practiceId)]);
  const active = phone ? await openThread(db, s.practiceId, phone).catch(() => null) : null;
  const canWrite = (CAN_WRITE as readonly string[]).includes(s.role);
  const current = active ? threads.find((t) => t.phone === active.phone) : null;

  return (
    <>
      <PageHeader title="Text messages" subtitle="Patients' replies to reminders, pay links and the front desk, in one inbox" />
      {!cfg.twilio && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Texting is not connected. Add your Twilio account under <Link href="/settings/connections" className="font-semibold underline">Settings, Integrations</Link>, then point the number&apos;s incoming-message webhook at the address shown there.
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title={`Conversations · ${threads.length}`} className="lg:col-span-1">
          {threads.length === 0 ? (
            <Empty>No texts yet. Replies to reminders and pay links show up here.</Empty>
          ) : (
            <ul className="-mx-2 divide-y divide-slate-100">
              {threads.map((t) => (
                <li key={t.phone}>
                  <Link href={`/messages?phone=${encodeURIComponent(t.phone)}`} className={`block rounded-lg px-2 py-2 hover:bg-slate-50 ${active?.phone === t.phone ? "bg-brand-50" : ""}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className={`truncate text-sm ${t.unread ? "font-bold text-slate-900" : "font-medium text-slate-800"}`}>{t.patientName ?? pretty(t.phone)}</span>
                      {t.unread > 0 && <span className="rounded-full bg-brand-600 px-2 text-xs font-bold text-white">{t.unread}</span>}
                    </div>
                    <p className="truncate text-xs text-slate-500">{t.lastDirection === "out" ? "You: " : ""}{t.lastBody}</p>
                    <p className="text-[11px] text-slate-400">{fmtDateTime(t.lastAt)}{t.optedOut ? " · opted out" : ""}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={active ? (current?.patientName ?? pretty(active.phone)) : "Conversation"} className="lg:col-span-2">
          {!active ? (
            <Empty>Choose a conversation.</Empty>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span>{pretty(active.phone)}</span>
                {current?.patientId && <Link href={`/patients/${current.patientId}`} className="font-semibold text-brand-700 hover:underline">Open patient</Link>}
                {active.optedOut && <Badge tone="red">Replied STOP</Badge>}
                {!current?.patientId && active.candidates.length > 1 && canWrite && (
                  <ActionForm action={linkThreadAction.bind(null, active.phone)} className="flex items-center gap-1">
                    <span>This number belongs to {active.candidates.length} patients:</span>
                    <select name="patientId" className="input w-auto py-1 text-xs">
                      {active.candidates.map((c) => <option key={c.id} value={c.id}>{c.lastName}, {c.firstName}</option>)}
                    </select>
                    <SubmitButton className="btn btn-secondary text-xs" pendingLabel="...">Link</SubmitButton>
                  </ActionForm>
                )}
                {!current?.patientId && active.candidates.length === 0 && <span>No patient has this number on file.</span>}
              </div>
              <div className="max-h-[28rem] space-y-2 overflow-y-auto rounded-lg bg-slate-50 p-3">
                {active.messages.map((m) => (
                  <div key={m.id} className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${m.direction === "out" ? "bg-brand-600 text-white" : "bg-white text-slate-900 ring-1 ring-slate-200"}`}>
                      <p className="whitespace-pre-wrap break-words">{m.body}</p>
                      <p className={`mt-1 text-[10px] ${m.direction === "out" ? "text-brand-100" : "text-slate-400"}`}>{fmtDateTime(m.createdAt)}{m.status === "failed" ? " · not delivered" : ""}</p>
                    </div>
                  </div>
                ))}
              </div>
              {canWrite && !active.optedOut && (
                <ActionForm action={replySmsAction.bind(null, active.phone)} className="mt-3 space-y-2">
                  <textarea name="body" rows={2} maxLength={1600} className="input" placeholder="Reply. Keep clinical details out of texts; send a portal link instead." required />
                  <SubmitButton pendingLabel="Sending...">Send text</SubmitButton>
                </ActionForm>
              )}
            </>
          )}
        </Card>
      </div>
    </>
  );
}
