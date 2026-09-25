import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function money(cents: number | null | undefined): string {
  const v = (cents ?? 0) / 100;
  return v.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return String(d);
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "2-digit" });
}

export function fmtDateTime(d: string | Date | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Days between a date and now (positive when in the past). */
export function daysAgo(d: string | Date): number {
  const date = typeof d === "string" ? new Date(d) : d;
  return Math.floor((Date.now() - date.getTime()) / 86_400_000);
}

export function yyyymmdd(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

export const CLAIM_STATUS_COLORS: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700",
  scrub_errors: "bg-amber-100 text-amber-800",
  ready: "bg-sky-100 text-sky-800",
  submitted: "bg-indigo-100 text-indigo-800",
  accepted: "bg-blue-100 text-blue-800",
  rejected: "bg-red-100 text-red-800",
  pending: "bg-violet-100 text-violet-800",
  paid: "bg-green-100 text-green-800",
  partially_paid: "bg-teal-100 text-teal-800",
  denied: "bg-rose-100 text-rose-800",
  closed: "bg-slate-200 text-slate-700",
  void_pending: "bg-orange-100 text-orange-800",
  billed_secondary: "bg-cyan-100 text-cyan-800",
  voided: "bg-slate-200 text-slate-500 line-through",
  reversed: "bg-orange-100 text-orange-800",
};
