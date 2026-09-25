import Link from "next/link";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireSession } from "@/lib/auth";
import { mfaStatus } from "@/server/mfa";
import { setRequireMfaAction } from "@/app/(app)/security-actions";
import { ipAllowlistAction, sessionHoursAction } from "@/app/(app)/access-actions";
import { signOutEveryoneAction } from "@/app/(app)/admin-actions";
import { SESSION_HOURS } from "@/server/team";
import { clientIp } from "@/lib/ip";
import { headers } from "next/headers";
import { ActionForm, SubmitButton } from "@/components/action-form";
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
  const ip = clientIp(await headers());

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
        <Card title="Session length">
          <p className="mb-3 text-xs text-slate-500">How long someone stays signed in, counted from when they signed in (switching practices does not restart it).</p>
          {admin ? (
            <ActionForm action={sessionHoursAction} className="flex items-center gap-2 text-sm">
              <select name="hours" defaultValue={String(practice.sessionHours)} className="input w-auto">
                {SESSION_HOURS.map((h) => <option key={h} value={h}>{h} hour{h === 1 ? "" : "s"}</option>)}
              </select>
              <SubmitButton className="btn btn-secondary text-xs" pendingLabel="Saving...">Save</SubmitButton>
            </ActionForm>
          ) : <p className="text-sm">{practice.sessionHours} hours</p>}
        </Card>
        <Card title="Allowed networks" className="lg:col-span-2">
          <p className="mb-3 text-xs text-slate-500">
            Limit sign-in to your offices&apos; internet addresses. One address or range per line (203.0.113.10 or 203.0.113.0/24; IPv6 works too). Empty allows sign-in from anywhere.
            People already signed in are signed out as soon as they use the app from elsewhere. You are connecting from <strong>{ip ?? "an unknown address"}</strong>.
          </p>
          {admin ? (
            <ActionForm action={ipAllowlistAction} className="space-y-2">
              <textarea name="allowlist" rows={4} defaultValue={practice.ipAllowlist.join("\n")} className="input font-mono text-xs" placeholder={ip ?? "203.0.113.0/24"} />
              <SubmitButton className="btn btn-secondary text-xs" pendingLabel="Saving...">Save</SubmitButton>
            </ActionForm>
          ) : <p className="text-sm">{practice.ipAllowlist.length ? practice.ipAllowlist.join(", ") : "Anywhere"}</p>}
        </Card>
        <Card title="Sign everyone out">
          <p className="mb-3 text-xs text-slate-500">Ends every session in this practice right away, on every device: after a lost laptop, a departure, or a change to these rules. Everyone signs in again; you stay signed in. To sign out one person, use Team and roles.</p>
          {admin ? (
            <ActionForm action={signOutEveryoneAction}>
              <SubmitButton className="btn btn-secondary text-xs text-red-700" pendingLabel="Signing out...">Sign everyone else out now</SubmitButton>
            </ActionForm>
          ) : <p className="text-sm text-slate-500">An administrator can do this.</p>}
        </Card>
        <Card title="More">
          <ul className="space-y-2 text-sm">
            <li><Link href="/settings/team" className="font-semibold text-brand-700 hover:underline">Team and roles</Link><span className="block text-xs text-slate-500">People, roles, custom roles, invites</span></li>
            <li><Link href="/settings/sso" className="font-semibold text-brand-700 hover:underline">Single sign-on and SCIM</Link><span className="block text-xs text-slate-500">Okta, Entra ID, Google Workspace and others</span></li>
          </ul>
        </Card>
      </div>
    </>
  );
}
