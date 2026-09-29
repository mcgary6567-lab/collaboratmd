"use client";

import { useState, useTransition } from "react";
import { KeyRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { finishPasskeyRegistrationAction, passkeyRegistrationOptionsAction } from "@/app/(app)/passkey-actions";
import { passkeyLoginAction, passkeyLoginOptionsAction } from "@/app/login/passkey-actions";

const toBuf = (s: string) => {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0)).buffer;
};
const toB64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const supported = () => typeof window !== "undefined" && !!window.PublicKeyCredential;

/** Adds a passkey on this device to the signed-in account. */
export function AddPasskey() {
  const [name, setName] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const add = () => start(async () => {
    if (!supported()) { setMessage({ ok: false, text: "This browser does not support passkeys." }); return; }
    try {
      const o = await passkeyRegistrationOptionsAction();
      const pk = o.publicKey;
      const cred = (await navigator.credentials.create({
        publicKey: {
          ...pk,
          challenge: toBuf(pk.challenge),
          user: { ...pk.user, id: toBuf(pk.user.id) },
          pubKeyCredParams: pk.pubKeyCredParams as PublicKeyCredentialParameters[],
          authenticatorSelection: pk.authenticatorSelection as AuthenticatorSelectionCriteria,
          attestation: "none",
          excludeCredentials: pk.excludeCredentials.map((c) => ({ type: "public-key" as const, id: toBuf(c.id) })),
        },
      })) as PublicKeyCredential | null;
      if (!cred) return;
      const r = cred.response as AuthenticatorAttestationResponse;
      const res = await finishPasskeyRegistrationAction(o.challengeId, { attestationObject: toB64(r.attestationObject), clientDataJSON: toB64(r.clientDataJSON), transports: r.getTransports?.() ?? [] }, name || "This device");
      setMessage({ ok: res.ok, text: res.message });
      if (res.ok) setName("");
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error && e.name === "NotAllowedError" ? "Cancelled, or the device did not confirm." : e instanceof Error ? e.message : "Could not add the passkey" });
    }
  });
  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-end gap-2">
        <label className="block"><span className="label">Name it</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Work laptop, iPhone" maxLength={60} /></label>
        <button type="button" className="btn btn-primary" onClick={add} disabled={pending}><KeyRound className="h-4 w-4" aria-hidden /> {pending ? "Waiting for the device..." : "Add a passkey"}</button>
      </div>
      {message && <p role="status" className={message.ok ? "text-green-700" : "text-red-700"}>{message.text}</p>}
    </div>
  );
}

/** "Sign in with a passkey" on the sign-in page. */
export function PasskeyLogin() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const signIn = () => start(async () => {
    setError(null);
    if (!supported()) { setError("This browser does not support passkeys. Sign in with your password."); return; }
    try {
      const o = await passkeyLoginOptionsAction();
      if (!o.ok) { setError(o.message); return; }
      const pk = o.options.publicKey;
      const cred = (await navigator.credentials.get({ publicKey: { challenge: toBuf(pk.challenge), rpId: pk.rpId, userVerification: "required", timeout: pk.timeout } })) as PublicKeyCredential | null;
      if (!cred) return;
      const r = cred.response as AuthenticatorAssertionResponse;
      const res = await passkeyLoginAction(o.options.challengeId, { id: toB64(cred.rawId), authenticatorData: toB64(r.authenticatorData), clientDataJSON: toB64(r.clientDataJSON), signature: toB64(r.signature) });
      if (res.ok) { router.push("/dashboard"); router.refresh(); }
      else setError(res.message ?? "Passkey sign-in failed");
    } catch (e) {
      setError(e instanceof Error && e.name === "NotAllowedError" ? "Cancelled, or no passkey for this site on this device." : e instanceof Error ? e.message : "Passkey sign-in failed");
    }
  });
  return (
    <div className="space-y-2">
      <button type="button" className="btn btn-secondary w-full justify-center" onClick={signIn} disabled={pending}>
        <KeyRound className="h-4 w-4" aria-hidden /> {pending ? "Waiting for your passkey..." : "Sign in with a passkey"}
      </button>
      {error && <p role="alert" className="text-center text-sm text-red-700">{error}</p>}
    </div>
  );
}
