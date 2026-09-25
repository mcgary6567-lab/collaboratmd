"use client";

import { useActionState } from "react";
import { acceptInviteAction } from "./actions";

export function WelcomeForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(acceptInviteAction.bind(null, token), undefined);
  return (
    <form action={action} className="space-y-4">
      {state?.error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</div>}
      <label className="block">
        <span className="label">New password (12 characters or more)</span>
        <input name="password" type="password" minLength={12} autoComplete="new-password" className="input" required />
      </label>
      <label className="block">
        <span className="label">Again</span>
        <input name="confirm" type="password" minLength={12} autoComplete="new-password" className="input" required />
      </label>
      <button className="btn w-full justify-center bg-green-600 text-white hover:bg-green-700" disabled={pending}>{pending ? "Saving..." : "Set password"}</button>
    </form>
  );
}
