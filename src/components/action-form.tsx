"use client";

import { useActionState, useEffect } from "react";
import { toast } from "@/components/toaster";
import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

export type FormResult = { ok: boolean; message: string } | undefined;

/**
 * A form bound to a server action that reports its outcome inline.
 *
 * Plain form actions surface a thrown validation error as an error page, which
 * is the wrong response to "that plan is larger than the balance". Actions
 * used here return a result instead, and the message renders under the form.
 */
export function ActionForm({
  action,
  children,
  className,
}: {
  action: (prev: FormResult, formData: FormData) => Promise<FormResult>;
  children: ReactNode;
  className?: string;
}) {
  const [state, formAction] = useActionState(action, undefined);
  useEffect(() => {
    if (state?.message) toast(state.ok, state.message);
  }, [state]);
  return (
    <form action={formAction} className={className}>
      {children}
      {state?.message && (
        <p className={`mt-2 text-xs font-medium ${state.ok ? "text-green-700" : "text-red-700"}`}>{state.message}</p>
      )}
    </form>
  );
}

export function SubmitButton({ children, className = "btn btn-primary", pendingLabel = "Working..." }: { children: ReactNode; className?: string; pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <button className={className} disabled={pending}>
      {pending ? pendingLabel : children}
    </button>
  );
}

export function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="btn btn-secondary no-print">
      {label}
    </button>
  );
}
