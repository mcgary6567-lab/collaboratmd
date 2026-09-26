import Link from "next/link";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireSession } from "@/lib/auth";
import { listNotifications } from "@/server/notifications";
import { digestAction, markAllReadAction, markOneReadAction } from "@/app/(app)/notification-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, Empty, PageHeader } from "@/components/ui";
import { fmtDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const s = await requireSession();
  const db = await getDb();
  const [items, [me]] = await Promise.all([
    listNotifications(db, s.practiceId, s.userId, s.role === "admin"),
    db.select({ digest: schema.users.emailDigest }).from(schema.users).where(eq(schema.users.id, s.userId)),
  ]);
  const unread = items.filter((i) => !i.readAt).length;

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle={`${unread} unread · payments posted, payer changes, held claims, approvals, expiring credentials and work assigned to you`}
        actions={
          <span className="flex gap-2">
            <ActionForm action={digestAction}><SubmitButton className="btn btn-secondary" pendingLabel="...">{me?.digest ? "Stop the daily email" : "Email me a daily digest"}</SubmitButton></ActionForm>
            {unread > 0 && <ActionForm action={markAllReadAction}><SubmitButton pendingLabel="...">Mark all read</SubmitButton></ActionForm>}
          </span>
        }
      />
      <Card>
        {items.length === 0 ? <Empty>Nothing yet. Things that need someone&apos;s attention show up here.</Empty> : (
          <ul className="divide-y divide-slate-100">
            {items.map((n) => (
              <li key={n.id} className={`flex items-start justify-between gap-4 py-3 ${n.readAt ? "opacity-60" : ""}`}>
                <div className="min-w-0">
                  <p className={`text-sm ${n.readAt ? "text-slate-700" : "font-semibold text-slate-900"}`}>{!n.readAt && <span className="mr-2 inline-block h-2 w-2 rounded-full bg-brand-600" />}{n.href ? <Link href={n.href} className="hover:underline">{n.title}</Link> : n.title}</p>
                  {n.body && <p className="mt-0.5 text-sm text-slate-600">{n.body}</p>}
                  <p className="mt-0.5 text-xs text-slate-400">{fmtDateTime(n.createdAt)}{n.userId ? "" : " · to administrators"}</p>
                </div>
                {!n.readAt && <form action={markOneReadAction.bind(null, n.id)}><button className="text-xs font-semibold text-brand-700 hover:underline">Mark read</button></form>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
