import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Tone = "good" | "bad" | "warn" | "neutral";

const TONE_TEXT: Record<Tone, string> = {
  good: "text-emerald-700",
  bad: "text-red-700",
  warn: "text-amber-700",
  neutral: "text-slate-900",
};

const TONE_DOT: Record<Tone, string> = {
  good: "bg-emerald-500",
  bad: "bg-red-500",
  warn: "bg-amber-500",
  neutral: "bg-slate-300",
};

/**
 * A headline metric.
 *
 * `target` states the benchmark the number is judged against, so a reader who
 * does not know revenue-cycle norms can tell good from bad.
 */
export function Kpi({
  label,
  value,
  target,
  tone = "neutral",
  hint,
}: {
  label: string;
  value: string;
  target?: string;
  tone?: Tone;
  hint?: ReactNode;
}) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-1.5">
        <span className={cn("h-1.5 w-1.5 rounded-full", TONE_DOT[tone])} />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      </div>
      <div className={cn("mt-1.5 text-2xl font-bold tabular-nums leading-none", TONE_TEXT[tone])}>{value}</div>
      {hint && <div className="mt-1.5 text-xs text-slate-500">{hint}</div>}
      {target && <div className="mt-0.5 text-[11px] text-slate-400">{target}</div>}
    </div>
  );
}

/** Compact currency for dense dashboards: $61.2M, $840k, $412. */
export function compactMoney(cents: number): string {
  const v = cents / 100;
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `$${Math.round(v / 1_000)}k`;
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export function pct(v: number, digits = 1): string {
  return `${(v * 100).toFixed(digits)}%`;
}
