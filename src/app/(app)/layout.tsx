import { eq } from "drizzle-orm";
import { accessiblePractices, requireSession } from "@/lib/auth";
import { getDb, schema } from "@/db";
import { Sidebar } from "@/components/sidebar";
import { MfaSetup } from "@/components/mfa-setup";
import { CommandPalette } from "@/components/command-palette";
import { Toaster } from "@/components/toaster";
import { pagesFor } from "@/lib/nav";
import { myTaskCounts } from "@/server/work";
import { unreadCount } from "@/server/notifications";
import { logoutAction } from "@/app/login/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const db = await getDb();
  const [practices, [practice], [user], taskCounts] = await Promise.all([
    accessiblePractices(db, session.userId),
    db.select({ requireMfa: schema.practices.requireMfa, hiddenNav: schema.practices.hiddenNav }).from(schema.practices).where(eq(schema.practices.id, session.practiceId)).limit(1),
    db.select({ mfaSecret: schema.users.mfaSecret }).from(schema.users).where(eq(schema.users.id, session.userId)).limit(1),
    myTaskCounts(db, session.practiceId, session.userId),
  ]);
  const unread = await unreadCount(db, session.practiceId, session.userId, session.role === "admin");
  // A practice that requires two-factor gets nothing else until it is set up.
  // Single sign-on users prove a second factor at their identity provider.
  const mustEnroll = !!practice?.requireMfa && !user?.mfaSecret && !session.sso;
  return (
    <div className="app-shell flex min-h-screen">
      <Sidebar user={{ name: session.name, role: session.role }} logout={logoutAction} practices={practices.map((p) => ({ id: p.id, name: p.name }))} current={session.practiceId} tasks={taskCounts} hidden={practice?.hiddenNav ?? []} unread={unread} />
      <main className="min-w-0 flex-1 px-4 pb-8 pt-20 md:p-6 lg:p-8">
        {mustEnroll ? (
          <div className="mx-auto max-w-2xl">
            <h1 className="text-2xl font-bold">Set up two-factor sign-in</h1>
            <p className="mb-6 mt-1 text-sm text-slate-600">This practice requires a code from an authenticator app at sign-in. Set it up to continue.</p>
            <div className="card p-6"><MfaSetup enabled={false} recoveryLeft={0} locked /></div>
          </div>
        ) : (
          children
        )}
      </main>
      <CommandPalette pages={pagesFor(session.role, practices.length > 1)} />
      <Toaster />
    </div>
  );
}
