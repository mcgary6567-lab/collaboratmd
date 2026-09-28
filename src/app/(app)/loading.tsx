/** Shown while a page's data loads: the shape of a page, not a spinner. */
export default function Loading() {
  return (
    <div className="animate-pulse space-y-6" role="status" aria-live="polite">
      <span className="sr-only">Loading...</span>
      <div className="space-y-2">
        <div className="h-7 w-56 rounded-lg bg-slate-200 dark:bg-slate-800" />
        <div className="h-4 w-96 max-w-full rounded bg-slate-100 dark:bg-slate-800/60" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-24 rounded-xl bg-slate-100 dark:bg-slate-800/60" />)}
      </div>
      <div className="space-y-3 rounded-xl border border-slate-200 p-5 dark:border-slate-800">
        {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="h-4 rounded bg-slate-100 dark:bg-slate-800/60" style={{ width: `${90 - i * 7}%` }} />)}
      </div>
    </div>
  );
}
