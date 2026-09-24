"use client";

import { useActionState, useState } from "react";
import { Link2 } from "lucide-react";
import { createCheckinLinkAction, type LinkResult } from "@/app/(app)/checkin-actions";

/** Creates a check-in link for one appointment and shows it, ready to copy. */
export function CheckinLinkButton({ appointmentId, resend }: { appointmentId: string; resend: boolean }) {
  const [state, action, pending] = useActionState<LinkResult, FormData>(createCheckinLinkAction.bind(null, appointmentId), undefined);
  const [copied, setCopied] = useState(false);
  return (
    <div className="inline-block text-left">
      <form action={action} className="inline">
        <button className="btn btn-secondary text-xs" disabled={pending} title="Create a link the patient uses to check in before the visit">
          <Link2 className="h-3.5 w-3.5" /> {pending ? "Creating..." : resend ? "Resend online check-in" : "Send online check-in"}
        </button>
      </form>
      {state && (
        <div className={`mt-1 max-w-xs whitespace-normal text-xs ${state.ok ? "text-slate-600" : "text-red-700"}`}>
          {state.url && (
            <div className="flex items-center gap-1">
              <input readOnly value={state.url} className="input py-0.5 font-mono text-[10px]" onFocus={(e) => e.currentTarget.select()} />
              <button
                type="button"
                className="btn btn-secondary px-2 py-0.5 text-[10px]"
                onClick={async () => {
                  await navigator.clipboard.writeText(state.url!);
                  setCopied(true);
                }}
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          )}
          <p className="mt-0.5">{state.message}</p>
        </div>
      )}
    </div>
  );
}
