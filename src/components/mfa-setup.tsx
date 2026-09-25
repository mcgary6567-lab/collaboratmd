"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, ShieldCheck } from "lucide-react";
import { confirmMfaAction, disableMfaAction, newRecoveryCodesAction, startMfaAction } from "@/app/(app)/security-actions";

function RecoveryCodes({ codes }: { codes: string[] }) {
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
      <p className="mb-2 text-sm font-semibold text-amber-900">Save these recovery codes now. They are shown only once.</p>
      <p className="mb-3 text-xs text-amber-900">Each code signs you in once if you lose your phone. Keep them somewhere safe, away from your password.</p>
      <ul className="grid grid-cols-2 gap-1 font-mono text-sm">{codes.map((c) => <li key={c}>{c}</li>)}</ul>
      <div className="mt-3 flex gap-2">
        <button type="button" className="btn btn-secondary text-xs" onClick={() => navigator.clipboard.writeText(codes.join("\n"))}>Copy</button>
        <button type="button" className="btn btn-secondary text-xs" onClick={() => window.print()}>Print</button>
      </div>
    </div>
  );
}

export function MfaSetup({ enabled, recoveryLeft, locked }: { enabled: boolean; recoveryLeft: number; locked: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const [setup, setSetup] = useState<{ secret: string; qrSvg: string } | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; message?: string; codes?: string[] }>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      setMsg(r.message ? { ok: r.ok, text: r.message } : null);
      if (r.codes) setCodes(r.codes);
      if (r.ok) {
        setCode("");
        after?.();
        router.refresh();
      }
    });

  if (codes) return <RecoveryCodes codes={codes} />;

  if (!enabled) {
    return (
      <div className="space-y-4 text-sm">
        {!setup ? (
          <>
            <p className="text-slate-600">Protect your account with a code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy) as well as your password.</p>
            <button
              className="btn btn-primary"
              disabled={pending}
              onClick={() => start(async () => {
                const r = await startMfaAction();
                if (r.ok && r.secret && r.qrSvg) setSetup({ secret: r.secret, qrSvg: r.qrSvg });
                else setMsg({ ok: false, text: r.message ?? "Could not start setup" });
              })}
            >
              <ShieldCheck className="h-4 w-4" /> Set up two-factor sign-in
            </button>
          </>
        ) : (
          <div className="grid gap-6 md:grid-cols-[auto_1fr]">
            {/* The SVG is generated on our server from the otpauth URI, not user input. */}
            <div className="h-[200px] w-[200px] rounded-lg border border-slate-200 bg-white p-1" dangerouslySetInnerHTML={{ __html: setup.qrSvg }} />
            <div className="space-y-3">
              <ol className="list-decimal space-y-1 pl-5 text-slate-700">
                <li>Scan the code with your authenticator app.</li>
                <li>Or enter this key by hand: <span className="select-all break-all font-mono text-xs">{setup.secret.match(/.{1,4}/g)?.join(" ")}</span></li>
                <li>Type the 6-digit code the app shows.</li>
              </ol>
              <div className="flex gap-2">
                <input value={code} onChange={(e) => setCode(e.target.value)} className="input w-36 text-center font-mono tracking-widest" inputMode="numeric" autoComplete="one-time-code" placeholder="123456" maxLength={6} />
                <button className="btn btn-primary" disabled={pending || code.length !== 6} onClick={() => run(() => confirmMfaAction(code))}>
                  {pending ? "Checking..." : "Turn on"}
                </button>
              </div>
            </div>
          </div>
        )}
        {msg && <p className={`text-xs font-medium ${msg.ok ? "text-green-700" : "text-red-700"}`}>{msg.text}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-4 text-sm">
      <p className="flex items-center gap-2 font-medium text-green-800"><ShieldCheck className="h-4 w-4" /> Two-factor sign-in is on. {recoveryLeft} recovery codes left.</p>
      <div className="flex flex-wrap items-center gap-2">
        <input value={code} onChange={(e) => setCode(e.target.value)} className="input w-40 text-center font-mono" placeholder="Current code" maxLength={11} />
        <button className="btn btn-secondary text-xs" disabled={pending || !code} onClick={() => run(() => newRecoveryCodesAction(code))}>
          <KeyRound className="h-3.5 w-3.5" /> New recovery codes
        </button>
        {!locked && (
          <button className="btn btn-danger text-xs" disabled={pending || !code} onClick={() => run(() => disableMfaAction(code))}>Turn off</button>
        )}
      </div>
      <p className="text-xs text-slate-500">Both actions need a current code from your app.</p>
      {msg && <p className={`text-xs font-medium ${msg.ok ? "text-green-700" : "text-red-700"}`}>{msg.text}</p>}
    </div>
  );
}
