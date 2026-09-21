"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send, RefreshCw } from "lucide-react";
import { submitClaimAction, rescrubClaimAction } from "@/app/(app)/actions";

export function ClaimActions({ claimId, canSubmit, canRescrub }: { claimId: string; canSubmit: boolean; canRescrub: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const router = useRouter();
  const run = (fn: () => Promise<{ ok: boolean; message: string }>) =>
    start(async () => {
      setMsg(await fn());
      router.refresh();
    });
  return (
    <div className="flex items-center gap-2">
      {msg && <span className={`max-w-xs text-xs ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.message}</span>}
      {canRescrub && (
        <button className="btn btn-secondary" disabled={pending} onClick={() => run(() => rescrubClaimAction(claimId))}>
          <RefreshCw className="h-4 w-4" /> Re-scrub
        </button>
      )}
      {canSubmit && (
        <button className="btn btn-primary" disabled={pending} onClick={() => run(() => submitClaimAction(claimId))}>
          <Send className="h-4 w-4" /> {pending ? "Submitting..." : "Submit to clearinghouse"}
        </button>
      )}
    </div>
  );
}
