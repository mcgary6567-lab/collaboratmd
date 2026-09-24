"use client";

import { useActionState, useState } from "react";
import { createKeyAction, testHl7Action, type KeyResult } from "@/app/(app)/integration-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";

export function CreateKeyForm() {
  const [state, action, pending] = useActionState<KeyResult, FormData>(createKeyAction, undefined);
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-2 text-sm">
      <form action={action} className="flex gap-2">
        <input name="name" className="input flex-1" placeholder="e.g. Epic Bridges, Mirth Connect" required maxLength={80} />
        <button className="btn btn-primary" disabled={pending}>{pending ? "Creating..." : "Create key"}</button>
      </form>
      {state?.key && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
          <div className="flex gap-2">
            <input readOnly value={state.key} className="input flex-1 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
            <button type="button" className="btn btn-secondary text-xs" onClick={async () => { await navigator.clipboard.writeText(state.key!); setCopied(true); }}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="mt-1 text-xs text-amber-900">{state.message}</p>
        </div>
      )}
      {state && !state.ok && <p className="text-xs text-red-700">{state.message}</p>}
    </div>
  );
}

export function TestMessageForm({ samples }: { samples: { label: string; message: string }[] }) {
  const [text, setText] = useState("");
  return (
    <ActionForm action={testHl7Action} className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {samples.map((s) => (
          // Each click gets a fresh control ID so the sample is not treated as a resend.
          <button key={s.label} type="button" className="btn btn-secondary text-xs" onClick={() => setText(s.message.replace(/\|MSG\d+\|/, `|TEST${Date.now()}|`))}>
            Load {s.label}
          </button>
        ))}
      </div>
      <textarea
        name="message"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        required
        className="input font-mono text-[11px]"
        placeholder="Paste an HL7 v2 message (MSH|^~\&|...)"
      />
      <SubmitButton className="btn btn-primary text-xs" pendingLabel="Processing...">Process message</SubmitButton>
    </ActionForm>
  );
}
