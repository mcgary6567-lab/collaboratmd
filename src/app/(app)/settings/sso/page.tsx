import Link from "next/link";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { BUILT_IN_ROLES } from "@/lib/capabilities";
import { siteOrigin } from "@/lib/origin";
import { getSso } from "@/server/sso";
import { removeSsoAction, rotateScimAction, saveSsoAction, testSsoAction } from "@/app/(app)/access-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, PageHeader } from "@/components/ui";
import { CopyField } from "../connections/copy-field";
import { RevealForm } from "../developers/reveal-form";

export const dynamic = "force-dynamic";

export default async function SsoPage() {
  const s = await requireSession();
  const cfg = await getSso(await getDb(), s.practiceId);
  const origin = await siteOrigin().catch(() => null);
  const admin = s.role === "admin";

  return (
    <>
      <PageHeader title="Single sign-on" subtitle="Sign in with your organization's identity provider, and add or remove people automatically" actions={<Link href="/settings" className="btn btn-secondary">Back to settings</Link>} />
      <div className="grid gap-6 lg:grid-cols-5">
        <Card title="OpenID Connect" className="lg:col-span-3">
          {!admin ? (
            <p className="text-sm text-slate-600">{cfg ? `Single sign-on is set up for ${cfg.domains.join(", ")}.` : "Not set up."} An administrator manages this.</p>
          ) : (
            <>
              <ol className="mb-4 list-decimal space-y-1 pl-5 text-xs text-slate-600">
                <li>In your identity provider (Okta, Microsoft Entra ID, Google Workspace, OneLogin, JumpCloud...), create an OpenID Connect web application.</li>
                <li>Set its sign-in redirect URI to the address below, and grant the scopes openid, email and profile.</li>
                <li>Paste the issuer, client ID and client secret here, list your email domains, and save.</li>
                <li>Test, then sign in with SSO from a private window before requiring it for everyone.</li>
              </ol>
              <p className="label">Redirect URI</p>
              {origin ? <CopyField value={`${origin}/api/sso/callback`} /> : <p className="text-xs text-slate-500">Set APP_URL to see the address.</p>}
              <ActionForm action={saveSsoAction} className="mt-4 space-y-3 text-sm">
                <label className="block"><span className="label">Issuer</span><input name="issuer" defaultValue={cfg?.issuer ?? ""} className="input" placeholder="https://yourcompany.okta.com" required /></label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block"><span className="label">Client ID</span><input name="clientId" defaultValue={cfg?.clientId ?? ""} className="input" required /></label>
                  <label className="block"><span className="label">Client secret</span><input name="clientSecret" type="password" autoComplete="off" className="input" placeholder={cfg ? "Saved; enter a new one to replace it" : ""} required={!cfg} /></label>
                </div>
                <label className="block"><span className="label">Email domains</span><input name="domains" defaultValue={cfg?.domains.join(", ") ?? ""} className="input" placeholder="yourpractice.com" required /></label>
                <label className="block"><span className="label">Role for people added automatically</span>
                  <select name="defaultRole" defaultValue={cfg?.defaultRole ?? "readonly"} className="input">{Object.entries(BUILT_IN_ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                </label>
                <label className="flex items-start gap-2"><input type="checkbox" name="autoProvision" defaultChecked={cfg?.autoProvision ?? false} className="mt-1" /> <span>Create accounts automatically for anyone in these domains who signs in with SSO (with the role above). Off: only people already on the team can sign in.</span></label>
                <label className="flex items-start gap-2"><input type="checkbox" name="enforce" defaultChecked={cfg?.enforce ?? false} className="mt-1" /> <span>Require SSO: refuse passwords for these domains. Keep at least one administrator outside them, or with a working SSO sign-in, so you cannot be locked out.</span></label>
                <SubmitButton pendingLabel="Saving...">Save</SubmitButton>
              </ActionForm>
              {cfg && (
                <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-200 pt-4">
                  <ActionForm action={testSsoAction}><SubmitButton className="btn btn-secondary text-xs" pendingLabel="Testing...">Test connection</SubmitButton></ActionForm>
                  <ActionForm action={removeSsoAction}><SubmitButton className="btn btn-secondary text-xs text-red-700" pendingLabel="Removing...">Remove single sign-on</SubmitButton></ActionForm>
                </div>
              )}
            </>
          )}
        </Card>

        <Card title="SCIM provisioning" className="lg:col-span-2">
          <p className="mb-3 text-xs text-slate-600">
            With SCIM your identity provider adds people when they are assigned the app and removes access when they leave, without anyone touching this page. Supported: Users (create, update name, deactivate). Roles stay in <Link href="/settings/team" className="text-brand-700 hover:underline">Team and roles</Link>.
          </p>
          {!cfg ? (
            <p className="text-sm text-slate-500">Set up single sign-on first.</p>
          ) : (
            <>
              <p className="label">SCIM base URL</p>
              {origin ? <CopyField value={`${origin}/api/scim/v2`} /> : <p className="text-xs text-slate-500">Set APP_URL to see the address.</p>}
              <p className="mt-3 text-sm">Token: {cfg.scimTokenHint ? <Badge tone="green">active, ends in {cfg.scimTokenHint}</Badge> : <Badge>none</Badge>}</p>
              {admin && (
                <div className="mt-3">
                  <RevealForm action={rotateScimAction} label={cfg.scimTokenHint ? "Replace token" : "Create token"}><span /></RevealForm>
                </div>
              )}
            </>
          )}
        </Card>
      </div>
    </>
  );
}
