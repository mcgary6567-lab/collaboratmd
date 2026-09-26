"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { saveSsoAction } from "@/app/(app)/access-actions";
import { CopyField } from "../connections/copy-field";

type Saved = { protocol: string; issuer: string | null; clientId: string | null; samlEntryPoint: string | null; samlIdpIssuer: string | null; hasCert: boolean; hasSecret: boolean; domains: string[]; defaultRole: string; autoProvision: boolean; enforce: boolean } | null;

/** Single sign-on settings: OpenID Connect or SAML, with the addresses to give the identity provider. */
export function SsoForm({ saved, roles, urls }: { saved: Saved; roles: [string, string][]; urls: { oidcRedirect: string; samlEntityId: string; samlAcs: string } | null }) {
  const [protocol, setProtocol] = useState(saved?.protocol === "saml" ? "saml" : "oidc");
  return (
    <ActionForm action={saveSsoAction} className="space-y-3 text-sm">
      <div className="flex gap-4">
        {[["oidc", "OpenID Connect (recommended)"], ["saml", "SAML 2.0"]].map(([v, l]) => (
          <label key={v} className="flex items-center gap-2"><input type="radio" name="protocol" value={v} checked={protocol === v} onChange={() => setProtocol(v)} /> {l}</label>
        ))}
      </div>
      {protocol === "oidc" ? (
        <>
          <p className="label">Redirect URI to give your identity provider</p>
          {urls ? <CopyField value={urls.oidcRedirect} /> : <p className="text-xs text-slate-500">Set APP_URL to see the address.</p>}
          <label className="block"><span className="label">Issuer</span><input name="issuer" defaultValue={saved?.issuer ?? ""} className="input" placeholder="https://yourcompany.okta.com" required /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block"><span className="label">Client ID</span><input name="clientId" defaultValue={saved?.clientId ?? ""} className="input" required /></label>
            <label className="block"><span className="label">Client secret</span><input name="clientSecret" type="password" autoComplete="off" className="input" placeholder={saved?.hasSecret ? "Saved; enter a new one to replace it" : ""} required={!saved?.hasSecret} /></label>
          </div>
        </>
      ) : (
        <>
          <p className="label">Give your identity provider these (or the metadata URL)</p>
          {urls ? (
            <div className="space-y-2 text-xs">
              <div>Entity ID / metadata URL<CopyField value={urls.samlEntityId} /></div>
              <div>Assertion consumer service (ACS) URL, HTTP-POST<CopyField value={urls.samlAcs} /></div>
              <p className="text-slate-500">Send the user&apos;s email as the NameID (email format) or an email attribute, and sign the assertion.</p>
            </div>
          ) : <p className="text-xs text-slate-500">Set APP_URL to see the addresses.</p>}
          <label className="block"><span className="label">Identity provider SSO URL</span><input name="samlEntryPoint" defaultValue={saved?.samlEntryPoint ?? ""} className="input" placeholder="https://idp.example.org/saml2/sso" required /></label>
          <label className="block"><span className="label">Identity provider entity ID (issuer, optional but recommended)</span><input name="samlIdpIssuer" defaultValue={saved?.samlIdpIssuer ?? ""} className="input" /></label>
          <label className="block"><span className="label">Signing certificate (PEM)</span><textarea name="samlIdpCert" rows={4} className="input font-mono text-[11px]" placeholder={saved?.hasCert ? "Saved; paste a new one to replace it" : "-----BEGIN CERTIFICATE-----"} required={!saved?.hasCert} /></label>
        </>
      )}
      <label className="block"><span className="label">Email domains</span><input name="domains" defaultValue={saved?.domains.join(", ") ?? ""} className="input" placeholder="yourpractice.com" required /></label>
      <label className="block"><span className="label">Role for people added automatically</span>
        <select name="defaultRole" defaultValue={saved?.defaultRole ?? "readonly"} className="input">{roles.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      </label>
      <label className="flex items-start gap-2"><input type="checkbox" name="autoProvision" defaultChecked={saved?.autoProvision ?? false} className="mt-1" /> <span>Create accounts automatically for anyone in these domains who signs in with SSO (with the role above).</span></label>
      <label className="flex items-start gap-2"><input type="checkbox" name="enforce" defaultChecked={saved?.enforce ?? false} className="mt-1" /> <span>Require SSO: refuse passwords for these domains. Sign in with SSO yourself first, so a setup mistake cannot lock you out.</span></label>
      <SubmitButton pendingLabel="Saving...">Save</SubmitButton>
    </ActionForm>
  );
}
