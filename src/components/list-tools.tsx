"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { Bookmark, X } from "lucide-react";
import type { FormResult } from "@/components/action-form";
import { toast } from "@/components/toaster";
import { bulkClaimsAction, deleteViewAction, saveViewAction } from "@/app/(app)/work-actions";

/** Bulk actions for rows whose checkboxes point at form="bulk-claims". */
export function ClaimBulkBar({ people }: { people: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState<FormResult, FormData>(bulkClaimsAction, undefined);
  const [count, setCount] = useState(0);
  const [op, setOp] = useState("submit");

  useEffect(() => {
    const boxes = () => Array.from(document.querySelectorAll<HTMLInputElement>('input[form="bulk-claims"][name="ids"]'));
    const update = () => setCount(boxes().filter((b) => b.checked).length);
    document.addEventListener("change", update);
    update();
    return () => document.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (state?.message) toast(state.ok, state.message);
    if (state?.ok) document.querySelectorAll<HTMLInputElement>('input[form="bulk-claims"]').forEach((b) => { if (b.type === "checkbox") b.checked = false; });
    setCount(0);
  }, [state]);

  return (
    <form id="bulk-claims" action={action} className={`mb-3 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm ${count ? "border-brand-500 bg-brand-50" : "border-slate-200"}`}>
      <span className="font-medium">{count ? `${count} selected` : "Select claims to act on several at once"}</span>
      {count > 0 && (
        <>
          <select name="op" value={op} onChange={(e) => setOp(e.target.value)} className="input w-auto py-1 text-xs">
            <option value="submit">Submit to clearinghouse</option>
            <option value="assign">Assign to a person</option>
            <option value="rescrub">Scrub again</option>
            <option value="status">Ask payers for status (276)</option>
            <option value="writeoff">Write off the balance</option>
          </select>
          {op === "writeoff" && <input name="reason" className="input w-56 py-1 text-xs" placeholder="Reason (goes on each claim)" required />}
          {op === "assign" && (
            <>
              <select name="assigneeId" className="input w-auto py-1 text-xs" required>
                <option value="">Who?</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <input name="dueDate" type="date" className="input w-auto py-1 text-xs" />
            </>
          )}
          <button className="btn btn-primary py-1 text-xs" disabled={pending}>{pending ? "Working..." : "Apply"}</button>
        </>
      )}
    </form>
  );
}

export function SelectAll() {
  return (
    <input
      type="checkbox"
      aria-label="Select all on this page"
      onChange={(e) => {
        document.querySelectorAll<HTMLInputElement>('input[form="bulk-claims"][name="ids"]').forEach((b) => (b.checked = e.target.checked));
        document.dispatchEvent(new Event("change"));
      }}
    />
  );
}

/** A user's saved filters for a list, and a way to save the current one. */
export function SavedViews({ page, query, views }: { page: string; query: string; views: { id: string; name: string; query: string }[] }) {
  const [state, action, pending] = useActionState<FormResult, FormData>(saveViewAction.bind(null, page, query), undefined);
  const [naming, setNaming] = useState(false);
  useEffect(() => {
    if (state?.message) toast(state.ok, state.message);
    if (state?.ok) setNaming(false);
  }, [state]);
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <Bookmark className="h-3.5 w-3.5 text-slate-400" />
      {views.map((v) => (
        <span key={v.id} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5">
          <Link href={`/${page}${v.query ? `?${v.query}` : ""}`} className="font-medium text-brand-700 hover:underline">{v.name}</Link>
          <button type="button" aria-label={`Delete view ${v.name}`} onClick={() => deleteViewAction(page, v.id)} className="text-slate-400 hover:text-red-600"><X className="h-3 w-3" /></button>
        </span>
      ))}
      {naming ? (
        <form action={action} className="inline-flex gap-1">
          <input name="name" className="input w-36 py-0.5 text-xs" placeholder="Name this view" autoFocus required />
          <button className="btn btn-secondary py-0.5 text-xs" disabled={pending}>Save</button>
        </form>
      ) : (
        query && <button type="button" onClick={() => setNaming(true)} className="font-semibold text-brand-700 hover:underline">Save this view</button>
      )}
    </div>
  );
}
