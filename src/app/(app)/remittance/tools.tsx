"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, Upload } from "lucide-react";
import { fetchRemittancesAction, import835Action } from "@/app/(app)/actions";
import { Alert } from "@/components/ui";

export function RemittanceTools() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [state, action, importing] = useActionState(import835Action, undefined);
  const router = useRouter();
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        {msg && <span className="text-xs text-slate-600">{msg}</span>}
        <button className="btn btn-secondary" onClick={() => setOpen((o) => !o)}>
          <Upload className="h-4 w-4" /> Import 835 file
        </button>
        <button
          className="btn btn-primary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await fetchRemittancesAction();
              setMsg(r.message);
              router.refresh();
            })
          }
        >
          <Download className="h-4 w-4" /> {pending ? "Fetching..." : "Fetch ERAs from clearinghouse"}
        </button>
      </div>
      {open && (
        <form action={action} className="card w-[36rem] max-w-full p-4">
          {state && <Alert kind={state.ok ? "success" : "error"}>{state.message}</Alert>}
          <textarea name="raw" className="textarea h-40 font-mono text-xs" placeholder="Paste an X12 835 file (ISA*00*...)" required />
          <div className="mt-2 flex justify-end">
            <button className="btn btn-primary" disabled={importing}>{importing ? "Posting..." : "Import and auto-post"}</button>
          </div>
        </form>
      )}
    </div>
  );
}
