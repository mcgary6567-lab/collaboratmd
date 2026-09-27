"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CircleHelp, X } from "lucide-react";
import { guideFor } from "@/content/help";

/** A help button in the corner with a short guide for the page you are on. */
export function HelpButton() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const guide = guideFor(path);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  if (!guide) return null;
  return (
    <div className="no-print fixed bottom-4 right-4 z-40">
      {open && (
        <div role="dialog" aria-label={`Help: ${guide.title}`} className="mb-2 w-80 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-xl">
          <div className="mb-2 flex items-start justify-between gap-2">
            <h2 className="font-semibold text-slate-900">{guide.title}</h2>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close help" className="text-slate-500 hover:text-slate-800"><X className="h-4 w-4" /></button>
          </div>
          <ol className="list-decimal space-y-1.5 pl-5 text-slate-700">{guide.steps.map((s) => <li key={s}>{s}</li>)}</ol>
          {guide.related && (
            <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
              {guide.related.map((r) => <Link key={r.href} href={r.href} className="text-xs font-semibold text-brand-700 hover:underline">{r.label}</Link>)}
            </div>
          )}
        </div>
      )}
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Help for this page" className="ml-auto flex h-10 w-10 items-center justify-center rounded-full bg-white text-slate-700 shadow-lg ring-1 ring-slate-200 hover:text-brand-700">
        <CircleHelp className="h-5 w-5" />
      </button>
    </div>
  );
}
