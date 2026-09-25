import Link from "next/link";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireSession } from "@/lib/auth";
import { mfaStatus } from "@/server/mfa";
import { setRequireMfaAction } from "@/app/(app)/security-actions";
import { MfaSetup } from "@/components/mfa-setup";
import { Badge, Card, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function SecuritySettingsPage() {
  const s = await requireSession();
  const db = await getDb();
  const [status, [practice], withoutMfa] = await Promise.all([
    mfaStatus(db, s.userId),
    db.select().from(schema.practices).where(eq(schema.practices.id, s.practiceId)).limit(1),
    db.select({ name: schema.users.name, email: schema.users.email }).from(schema.users).where(and(eq(schema.users.practiceId, s.practiceId), isNull(schema.users.mfaSecret))),
  ]);
  const admin = s.role === "admin";

  return (
    <>
      <PageHeader title="Sign-in security" subtitle="Two-factor sign-in for your account, and the practice's rules" actions={<Link href="/settings" className="btn btn-secondary">Back to settings</Link>} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Two-factor sign-in" className="lg:col-span-2">
          <MfaSetup enabled={status.enabled} recoveryLeft={status.recoveryLeft} locked={practice.requireMfa} />
        </Card>
        <Card title="Practice policy">
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span>Two-factor required for everyone</span>
              {practice.requireMfa ? <Badge tone="green">Required</Badge> : <Badge>Optional</Badge>}
            </div>
            {admin && (
              <form action={setRequireMfaAction.bind(null, !practice.requireMfa)}>
                <button className="btn btn-secondary w-full justify-center text-xs">{practice.requireMfa ? "Make it optional" : "Require two-factor"}</button>
              </form>
            )}
            <p className="text-xs text-slate-500">
              When required, anyone without two-factor is asked to set it up before they can use the app. Accounts lock for 15 minutes after five wrong passwords or codes.
            </p>
            {admin && withoutMfa.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-semibold text-slate-700">Not yet using two-factor ({withoutMfa.length})</div>
                <ul className="space-y-0.5 text-xs text-slate-600">{withoutMfa.map((u) => <li key={u.email}>{u.name} · {u.email}</li>)}</ul>
              </div>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}
