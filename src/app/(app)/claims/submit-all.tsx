"use client";

import { useState, useTransition } from "react";
import { Send } from "lucide-react";
import { submitAllReadyAction } from "@/app/(app)/actions";

export function SubmitAllButton({ disabled }: { disabled?: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-3">
      {msg && <span className="text-xs text-slate-600">{msg}</span>}
      <button className="btn btn-primary" disabled={disabled || pending} onClick={() => start(async () => setMsg((await submitAllReadyAction()).message))}>
        <Send className="h-4 w-4" /> {pending ? "Submitting batch..." : "Submit all ready claims"}
      </button>
    </div>
  );
}
