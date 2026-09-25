"use client";

import { useActionState, useState } from "react";
import { Link2 } from "lucide-react";
import { sendPortalLinkAction } from "@/app/(app)/portal-actions";
import type { LinkResult } from "@/app/(app)/checkin-actions";

/** Sends the patient a portal or pay link, and shows it to copy. */
export function PortalLinkButton({ patientId, purpose, label }: { patientId: string; purpose: "portal" | "pay"; label: string }) {
  const [state, action, pending] = useActionState<LinkResult, FormData>(sendPortalLinkAction.bind(null, patientId, purpose), undefined);
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <form action={action}>
        <button className="btn btn-secondary text-xs" disabled={pending}><Link2 className="h-3.5 w-3.5" /> {pending ? "Sending..." : label}</button>
      </form>
      {state && (
        <div className={`mt-1 text-xs ${state.ok ? "text-slate-600" : "text-red-700"}`}>
          {state.url && (
            <div className="flex gap-1">
              <input readOnly value={state.url} className="input py-0.5 font-mono text-[10px]" onFocus={(e) => e.currentTarget.select()} />
              <button type="button" className="btn btn-secondary px-2 py-0.5 text-[10px]" onClick={async () => { await navigator.clipboard.writeText(state.url!); setCopied(true); }}>
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
