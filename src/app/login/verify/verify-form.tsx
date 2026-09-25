"use client";

import { useActionState } from "react";
import { verifyMfaAction } from "../actions";

export function VerifyForm() {
  const [state, action, pending] = useActionState(verifyMfaAction, undefined);
  return (
    <form action={action} className="space-y-4">
      {state?.error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</div>}
      <label className="block">
        <span className="label">Code</span>
        <input
          name="code"
          className="input text-center font-mono text-lg tracking-[0.3em]"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          required
          maxLength={11}
          placeholder="123456"
        />
      </label>
      <button className="btn w-full justify-center bg-green-600 text-white hover:bg-green-700" disabled={pending}>
        {pending ? "Checking..." : "Verify and sign in"}
      </button>
      <a href="/login" className="block text-center text-xs text-slate-500 hover:underline">Start over</a>
    </form>
  );
}
