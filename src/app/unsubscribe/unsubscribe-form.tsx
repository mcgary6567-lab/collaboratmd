"use client";

import { useActionState, useEffect, useRef } from "react";
import { CheckCircle2 } from "lucide-react";
import { unsubscribeAction, type UnsubscribeState } from "./actions";

export function UnsubscribeForm() {
  const [state, action, pending] = useActionState<UnsubscribeState | undefined, FormData>(
    unsubscribeAction,
    undefined,
  );
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * An unsubscribe link carries the address it is removing, so the recipient
   * does not have to type it. Read from the address bar rather than the router
   * hook, which would put the form behind a Suspense boundary for one field.
   */
  useEffect(() => {
    try {
      const email = new URLSearchParams(window.location.search).get("email");
      if (email && inputRef.current && !inputRef.current.value) inputRef.current.value = email;
    } catch {
      // Not worth failing over.
    }
  }, []);

  if (state?.ok) {
    return (
      <div className="rounded-2xl border border-green-200 bg-green-50 p-8 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-green-600" />
        <h2 className="mt-4 text-lg font-bold text-slate-900">You have been removed</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-700">
          We have recorded the request for <strong>{state.email}</strong>. It takes effect on the
          next send, and in no case later than ten business days.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-7">
      {state?.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {state.error}
        </div>
      )}
      <label className="block">
        <span className="label">Email address</span>
        <input
          ref={inputRef}
          name="email"
          type="email"
          className="input"
          autoComplete="email"
          defaultValue={state?.email}
          required
        />
      </label>
      <button
        className="btn w-full justify-center bg-green-600 py-2.5 text-white hover:bg-green-700"
        disabled={pending}
      >
        {pending ? "Removing..." : "Unsubscribe"}
      </button>
    </form>
  );
}
