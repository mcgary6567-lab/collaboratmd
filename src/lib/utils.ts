import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function money(cents: number | null | undefined): string {
  const v = (cents ?? 0) / 100;
  return v.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * "Sep 21, 2026". A calendar date ("2026-09-21": a date of service or birth)
 * is that day everywhere; a moment is shown on the given time zone's day.
 */
export function fmtDate(d: string | Date | null | undefined, timeZone?: string): string {
  if (!d) return "";
  const day = typeof d === "string" && CALENDAR_DAY.test(d);
  const date = typeof d === "string" ? new Date(day ? `${d}T12:00:00Z` : d) : d;
  if (Number.isNaN(date.getTime())) return String(d);
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: day ? "UTC" : timeZone });
}

/**
 * When something happened, on the practice's clock: "Sep 21, 2026, 9:05 AM EDT".
 * Pass the practice's time zone (the session has it); the server runs in UTC.
 */
export function fmtDateTime(d: string | Date | null | undefined, timeZone?: string): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return String(d);
  return date.toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone, timeZoneName: timeZone ? "short" : undefined });
}

/** An appointment's time, which is stored as the practice's clock time: "Sep 21, 2026, 9:05 AM". */
export function fmtClock(d: string | Date | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" });
}

/** Days between a date and now (positive when in the past). */
export function daysAgo(d: string | Date): number {
  const date = typeof d === "string" ? new Date(d) : d;
  return Math.floor((Date.now() - date.getTime()) / 86_400_000);
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

/** How a claim status reads to staff. */
export const CLAIM_STATUS_LABEL: Record<string, string> = {
  draft: "Draft", scrub_errors: "Scrub errors", ready: "Ready", submitted: "Submitted", accepted: "Accepted", rejected: "Rejected",
  pending: "In process", paid: "Paid", partially_paid: "Partially paid", denied: "Denied", closed: "Closed", void_pending: "Void requested",
  billed_secondary: "At secondary", voided: "Voided", reversed: "Reversed",
};

/** Any stored status as words: "partially_paid" to "Partially paid". */
export const statusLabel = (s: string) => CLAIM_STATUS_LABEL[s] ?? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");
