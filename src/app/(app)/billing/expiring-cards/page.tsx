import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { CAN_WRITE, requireSession } from "@/lib/auth";
import { expiringCards } from "@/server/card-expiry";
import { notifyCardsAction, sendCardLinkAction } from "@/app/(app)/visit-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { fmtDate, fmtDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Expiring cards on file" };
export const dynamic = "force-dynamic";

/** Saved cards that pay plans or balances automatically and expire in the next 45 days. */
export default async function ExpiringCardsPage() {
  const s = await requireSession();
  const rows = await expiringCards(await getDb(), s.practiceId);
  const canWrite = (CAN_WRITE as readonly string[]).includes(s.role);
  return (
    <>
      <PageHeader
        title="Expiring cards on file"
        subtitle="Cards that pay a plan automatically or balances after insurance, expiring in the next 45 days. The patient gets a portal link to replace the card; nothing is charged, and the autopay and authorization carry over."
        actions={canWrite && rows.length > 0 ? <ActionForm action={notifyCardsAction}><SubmitButton pendingLabel="Sending...">Send to everyone not notified in 14 days</SubmitButton></ActionForm> : undefined}
      />
      <Card title={`Expiring (${rows.length})`}>
        {rows.length === 0 ? <Empty>No saved cards expire in the next 45 days.</Empty> : (
          <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-700">
            {rows.map((c) => (
              <li key={c.card.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Link href={`/patients/${c.card.patientId}`} className="font-medium text-brand-700 underline">{c.lastName}, {c.firstName}</Link>
                  <span>{c.card.brand ?? "Card"} ending {c.card.last4}</span>
                  <Badge tone={c.expired ? "red" : "amber"}>{c.expired ? "expired" : "expires"} {fmtDate(`${c.expiresOn}T00:00:00`)}</Badge>
                  <span className="text-slate-500 dark:text-slate-400">pays {c.uses.join(" and ")}</span>
                  {c.lastNotified && <span className="text-slate-500 dark:text-slate-400">notified {fmtDateTime(c.lastNotified, s.timeZone)}</span>}
                </div>
                {canWrite && <ActionForm action={sendCardLinkAction.bind(null, c.card.id)}><SubmitButton className="btn btn-secondary" pendingLabel="...">Send link</SubmitButton></ActionForm>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
