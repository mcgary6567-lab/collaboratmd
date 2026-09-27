"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CircleHelp, X } from "lucide-react";
import { guideFor } from "@/content/help";
import { submitFeedbackAction } from "@/app/(app)/feedback-actions";

/** A help button in the corner: a short guide for the page you are on, and a way to report a problem. */
export function HelpButton() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [text, setText] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();
  const guide = guideFor(path);
  useEffect(() => { setOpen(false); setReporting(false); setResult(null); }, [path]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const send = () => start(async () => {
    const r = await submitFeedbackAction({ page: path, message: text, userAgent: navigator.userAgent, viewport: `${window.innerWidth}x${window.innerHeight}` });
    setResult(r);
    if (r.ok) setText("");
  });
  return (
    <div className="no-print fixed bottom-4 right-4 z-40">
      {open && (
        <div role="dialog" aria-label={guide ? `Help: ${guide.title}` : "Help"} className="mb-2 w-80 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-xl">
          <div className="mb-2 flex items-start justify-between gap-2">
            <h2 className="font-semibold text-slate-900">{reporting ? "Report a problem" : guide?.title ?? "Help"}</h2>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close help" className="text-slate-500 hover:text-slate-800"><X className="h-4 w-4" /></button>
          </div>
          {reporting ? (
            <div className="space-y-2">
              <p className="text-xs text-slate-600">Say what you were doing and what went wrong. Please leave out patient names and details; the page you are on is included automatically.</p>
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={4000} className="input" aria-label="What went wrong" />
              {result && <p className={`text-xs ${result.ok ? "text-green-800" : "text-red-700"}`}>{result.message}</p>}
              <div className="flex justify-between">
                <button type="button" className="text-xs text-slate-600 underline" onClick={() => { setReporting(false); setResult(null); }}>Back</button>
                <button type="button" className="btn btn-primary text-xs" disabled={pending || text.trim().length < 5} onClick={send}>{pending ? "Sending..." : "Send"}</button>
              </div>
            </div>
          ) : (
            <>
              {guide ? <ol className="list-decimal space-y-1.5 pl-5 text-slate-700">{guide.steps.map((s) => <li key={s}>{s}</li>)}</ol> : <p className="text-slate-700">Press Ctrl+K (Cmd+K on a Mac) to search for any page, patient or claim.</p>}
              {guide?.related && (
                <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                  {guide.related.map((r) => <Link key={r.href} href={r.href} className="text-xs font-semibold text-brand-700 hover:underline">{r.label}</Link>)}
                </div>
              )}
              <button type="button" className="mt-3 text-xs font-semibold text-brand-700 hover:underline" onClick={() => setReporting(true)}>Report a problem with this page</button>
            </>
          )}
        </div>
      )}
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Help for this page" className="ml-auto flex h-10 w-10 items-center justify-center rounded-full bg-white text-slate-700 shadow-lg ring-1 ring-slate-200 hover:text-brand-700">
        <CircleHelp className="h-5 w-5" />
      </button>
    </div>
  );
}
