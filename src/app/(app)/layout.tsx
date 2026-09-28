import { eq } from "drizzle-orm";
import { accessiblePractices, requireSession } from "@/lib/auth";
import { getDb, schema } from "@/db";
import { Sidebar } from "@/components/sidebar";
import { MfaSetup } from "@/components/mfa-setup";
import { CommandPalette } from "@/components/command-palette";
import { Toaster } from "@/components/toaster";
import { HelpButton } from "@/components/help-button";
import { UsageBeacon } from "@/components/usage-beacon";
import { pagesFor } from "@/lib/nav";
import { myTaskCounts } from "@/server/work";
import { unreadCount } from "@/server/notifications";
import { logoutAction } from "@/app/login/actions";
import { standing } from "@/server/subscription";
import { pendingDocuments } from "@/server/legal";
import { AcceptTerms } from "@/components/accept-terms";
import { mfaRule } from "@/server/mfa-policy";
import Link from "next/link";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const db = await getDb();
  const [practices, [practice], taskCounts] = await Promise.all([
    accessiblePractices(db, session.userId),
    db.select({ requireMfa: schema.practices.requireMfa, hiddenNav: schema.practices.hiddenNav, selfServe: schema.practices.selfServe, subscriptionStatus: schema.practices.subscriptionStatus, trialEndsAt: schema.practices.trialEndsAt, plan: schema.practices.plan, stripeSubscriptionId: schema.practices.stripeSubscriptionId, pastDueSince: schema.practices.pastDueSince, closingAt: schema.practices.closingAt }).from(schema.practices).where(eq(schema.practices.id, session.practiceId)).limit(1),
    myTaskCounts(db, session.practiceId, session.userId),
  ]);
  const unread = await unreadCount(db, session.practiceId, session.userId, session.role === "admin");
  // A practice that requires two-factor (of everyone, or of administrators and exporters) gets nothing else until it is set up.
  // Single sign-on users prove a second factor at their identity provider.
  const mustEnroll = (await mfaRule(db, session)).mustEnroll;
  // Self-serve administrators accept changed terms before continuing; practices on a signed agreement are not asked.
  const mustAccept = practice?.selfServe && session.role === "admin" && !mustEnroll ? await pendingDocuments(db, session.practiceId, session.userId) : [];
  // Self-serve practices see their trial ending, and why claims stopped after it.
  const account = practice ? standing(practice) : null;
  const notice = practice?.closingAt
    ? `This practice is scheduled to close on ${practice.closingAt.toUTCString().slice(0, 16)}; all its data will then be deleted.`
    : account?.blocked ? account.reason
    : account?.graceUntil ? `A payment failed. Claims keep going out until ${account.graceUntil.toUTCString().slice(0, 16)}; update the payment method before then.`
    : account?.trialDaysLeft !== null && account?.trialDaysLeft !== undefined && account.trialDaysLeft <= 7 ? `Your free trial ends in ${account.trialDaysLeft} day${account.trialDaysLeft === 1 ? "" : "s"}.` : null;
  return (
    <div className="app-shell flex min-h-screen">
      <Sidebar user={{ name: session.name, role: session.role }} logout={logoutAction} practices={practices.map((p) => ({ id: p.id, name: p.name }))} current={session.practiceId} tasks={taskCounts} hidden={practice?.hiddenNav ?? []} unread={unread} />
      <main className="min-w-0 flex-1 px-4 pb-8 pt-20 md:p-6 lg:p-8">
        {notice && (
          <div className={`mb-4 rounded-lg border px-4 py-2 text-sm ${account?.blocked ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
            {notice} {session.role === "admin" && <Link href="/settings/subscription" className="font-semibold underline">Choose a plan</Link>}
          </div>
        )}
        {mustEnroll ? (
          <div className="mx-auto max-w-2xl">
            <h1 className="text-2xl font-bold">Set up two-factor sign-in</h1>
            <p className="mb-6 mt-1 text-sm text-slate-600">This practice requires a code from an authenticator app at sign-in. Set it up to continue.</p>
            <div className="card p-6"><MfaSetup enabled={false} recoveryLeft={0} locked /></div>
          </div>
        ) : mustAccept.length ? (
          <AcceptTerms documents={mustAccept} />
        ) : (
          children
        )}
      </main>
      <CommandPalette pages={pagesFor(session.role, practices.length > 1)} />
      <Toaster />
      <HelpButton />
      <UsageBeacon />
    </div>
  );
}
