"use client";

import Link from "next/link";
import { TriangleAlert } from "lucide-react";

/** When a page fails to load: say so plainly, offer to try again, and give a reference support can look up. */
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center py-16 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
        <TriangleAlert className="h-6 w-6" aria-hidden />
      </span>
      <h1 className="mt-4 text-xl font-semibold text-slate-900 dark:text-slate-100">This page could not be loaded</h1>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
        Nothing you saved was lost. Try again; if it keeps happening, contact support{error.digest ? " and quote the reference below" : ""}.
      </p>
      {error.digest && <p className="mt-3 font-mono text-xs text-slate-500">Reference {error.digest}</p>}
      <div className="mt-6 flex gap-3">
        <button type="button" className="btn btn-primary" onClick={() => retry()}>Try again</button>
        <Link href="/dashboard" className="btn btn-secondary">Go to the dashboard</Link>
      </div>
    </div>
  );
}
