"use client";

import { useActionState } from "react";
import { requestResetAction } from "./actions";

export function ForgotForm() {
  const [state, action, pending] = useActionState(requestResetAction, undefined);
  if (state?.done) {
    return (
      <p className="rounded-lg bg-green-50 px-3 py-3 text-sm text-green-900">
        If that address has an account that signs in with a password, we sent a link to reset it. It works for an hour.
        No email after a few minutes? Check spam, or ask your practice administrator to send you one.
      </p>
    );
  }
  return (
    <form action={action} className="space-y-4">
      <label className="block">
        <span className="label">Work email</span>
        <input name="email" type="email" className="input" autoComplete="username" required />
      </label>
      <button className="btn w-full justify-center bg-green-600 text-white hover:bg-green-700" disabled={pending}>{pending ? "Sending..." : "Email me a reset link"}</button>
    </form>
  );
}
