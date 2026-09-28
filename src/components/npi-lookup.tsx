"use client";

import { useRef, useState, useTransition } from "react";
import { Search } from "lucide-react";
import { lookupNpiAction } from "@/app/(app)/npi-actions";
import type { NpiRecord } from "@/lib/nppes";

/**
 * "Look up" beside an NPI field: reads the NPI from the same form, asks the
 * NPI Registry, and fills the named fields (field name to registry value), or
 * hands the record to onFound.
 */
export function NpiLookup({ npiField = "npi", fill, onFound, npi }: { npiField?: string; fill?: Record<string, keyof NpiRecord>; onFound?: (r: NpiRecord) => void; npi?: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = () => {
    const form = ref.current?.closest("form") ?? ref.current?.closest("fieldset, div");
    const value = npi ?? (form?.querySelector<HTMLInputElement>(`[name="${npiField}"]`)?.value ?? "");
    start(async () => {
      const r = await lookupNpiAction(value);
      if (!r.ok) { setMessage(r.message); return; }
      const rec = r.record;
      if (fill && form) {
        for (const [name, key] of Object.entries(fill)) {
          const el = form.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`);
          const v = rec[key];
          if (el && v !== null && v !== undefined && typeof v !== "boolean") {
            el.value = String(v);
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
          }
        }
      }
      onFound?.(rec);
      setMessage(`${rec.name}${rec.credential ? `, ${rec.credential}` : ""} · ${rec.kind === "individual" ? "Type 1 (individual)" : "Type 2 (organization)"}${rec.specialty ? ` · ${rec.specialty}` : ""}${rec.active ? "" : " · deactivated in NPPES"}`);
    });
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button ref={ref} type="button" className="btn btn-secondary text-xs" onClick={run} disabled={pending}>
        <Search className="h-3.5 w-3.5" aria-hidden /> {pending ? "Looking up..." : "Look up NPI"}
      </button>
      {message && <span className="text-xs text-slate-600 dark:text-slate-400" role="status">{message}</span>}
    </span>
  );
}
