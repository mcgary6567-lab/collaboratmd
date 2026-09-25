"use client";

import { useActionState, type ReactNode } from "react";
import type { RevealResult } from "@/app/(app)/developer-actions";
import { CopyField } from "../connections/copy-field";

/** A form whose success reveals a secret exactly once, with a copy button. */
export function RevealForm({ action, children, className, label = "Create" }: { action: (prev: RevealResult, fd: FormData) => Promise<RevealResult>; children: ReactNode; className?: string; label?: string }) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <div>
      <form action={formAction} className={className}>
        {children}
        <button className="btn btn-primary" disabled={pending}>{pending ? "Working..." : label}</button>
      </form>
      {state && (
        <div className={`mt-3 rounded-lg border p-3 text-sm ${state.ok ? "border-amber-300 bg-amber-50" : "border-red-200 bg-red-50 text-red-800"}`} role="status">
          <p className="mb-2 font-medium">{state.message}</p>
          {state.secret && <CopyField value={state.secret} />}
        </div>
      )}
    </div>
  );
}
