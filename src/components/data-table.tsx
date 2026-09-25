import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Pieces for server-rendered lists whose state lives in the URL: sort,
 * filters and page survive a reload, can be bookmarked, and can be saved as a
 * named view.
 */

export type Params = Record<string, string | undefined>;

export function withParams(base: string, params: Params, change: Params): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...params, ...change })) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}

export function SortHeader({ label, field, base, params, align }: { label: string; field: string; base: string; params: Params; align?: "right" }) {
  const active = params.sort === field;
  const dir = active && params.dir === "asc" ? "desc" : "asc";
  const Icon = !active ? ArrowUpDown : params.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th className={align === "right" ? "text-right" : undefined}>
      <Link href={withParams(base, params, { sort: field, dir, page: undefined })} className={`inline-flex items-center gap-1 hover:text-slate-900 ${active ? "text-slate-900" : ""}`}>
        {label} <Icon className={`h-3 w-3 ${active ? "" : "opacity-40"}`} />
      </Link>
    </th>
  );
}

/** The same control as SortHeader, for lists that are not tables. */
export function SortLink({ label, field, base, params }: { label: string; field: string; base: string; params: Params }) {
  const active = params.sort === field;
  const dir = active && params.dir === "asc" ? "desc" : "asc";
  const Icon = !active ? ArrowUpDown : params.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <Link href={withParams(base, params, { sort: field, dir, page: undefined })} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 hover:bg-slate-100 ${active ? "font-semibold text-slate-900" : "text-slate-600"}`}>
      {label} <Icon className={`h-3 w-3 ${active ? "" : "opacity-40"}`} />
    </Link>
  );
}

export function Pager({ page, pageSize, total, base, params }: { page: number; pageSize: number; total: number; base: string; params: Params }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const link = (p: number) => withParams(base, params, { page: p > 1 ? String(p) : undefined });
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
      <span>{from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}</span>
      <div className="flex items-center gap-1">
        {page > 1 ? <Link href={link(page - 1)} className="btn btn-secondary px-2 py-1 text-xs"><ChevronLeft className="h-3.5 w-3.5" /> Previous</Link> : null}
        <span className="px-2 text-xs">Page {page} of {pages.toLocaleString()}</span>
        {page < pages ? <Link href={link(page + 1)} className="btn btn-secondary px-2 py-1 text-xs">Next <ChevronRight className="h-3.5 w-3.5" /></Link> : null}
      </div>
    </div>
  );
}

export const PAGE_SIZES = [25, 50, 100] as const;

export function pageArgs(params: Params, defaultSize = 50) {
  const pageSize = PAGE_SIZES.includes(Number(params.size) as 25) ? Number(params.size) : defaultSize;
  const page = Math.max(1, Math.min(10_000, Number(params.page) || 1));
  return { page, pageSize, offset: (page - 1) * pageSize };
}
