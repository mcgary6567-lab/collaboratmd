"use client";

import { useActionState } from "react";
import { loginAction } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, undefined);
  return (
    <form action={action} className="space-y-4">
      {state?.error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</div>}
      <label className="block">
        <span className="label">Email</span>
        <input name="email" type="email" className="input" defaultValue="admin@collaboratmd.local" autoComplete="username" required />
      </label>
      <label className="block">
        <span className="label">Password</span>
        <input name="password" type="password" className="input" defaultValue="admin123" autoComplete="current-password" required />
      </label>
      <button className="btn w-full justify-center bg-green-600 text-white hover:bg-green-700" disabled={pending}>
        {pending ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
