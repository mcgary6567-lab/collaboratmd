"use client";

import { useActionState } from "react";
import { completeSignupAction } from "../actions";

export function ConfirmSignup({ token }: { token: string }) {
  const [state, action, pending] = useActionState(completeSignupAction.bind(null, token), undefined);
  return (
    <form action={action} className="mt-4 space-y-3">
      {state?.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-red-800" role="alert">{state.error}</p>}
      <button className="btn w-full justify-center bg-green-700 text-white hover:bg-green-800" disabled={pending}>{pending ? "Creating..." : "Create my practice"}</button>
    </form>
  );
}
