"use client";

/**
 * "What denials cost you": arithmetic on the visitor's own numbers.
 *
 * It promises nothing about this product. Every input is the visitor's, the
 * formula is printed under the result, and the comparison rate defaults to
 * the industry benchmark (under 5%) shown elsewhere on the page.
 */

import { useId, useState } from "react";

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function Field({ label, hint, value, onChange, min, max, step, suffix, prefix }: {
  label: string; hint: string; value: number; onChange: (n: number) => void; min: number; max: number; step: number; suffix?: string; prefix?: string;
}) {
  const id = useId();
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-semibold text-slate-800">{label}</label>
        <span className="font-mono text-sm font-bold text-green-700">{prefix}{value.toLocaleString("en-US")}{suffix}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 w-full accent-green-600"
      />
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </div>
  );
}

export function DenialCalculator() {
  const [claims, setClaims] = useState(1500);
  const [avg, setAvg] = useState(180);
  const [rate, setRate] = useState(10);
  const [lost, setLost] = useState(50);
  const [rework, setRework] = useState(25);
  const [target, setTarget] = useState(5);

  const cost = (r: number) => {
    const denied = claims * (r / 100);
    return { denied, lostRevenue: denied * avg * (lost / 100), reworkCost: denied * rework };
  };
  const now = cost(rate);
  const then = cost(Math.min(target, rate));
  const monthly = now.lostRevenue + now.reworkCost;
  const monthlyThen = then.lostRevenue + then.reworkCost;

  return (
    <div className="grid gap-8 rounded-3xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-900/5 lg:grid-cols-5 lg:p-10">
      <div className="space-y-6 lg:col-span-3">
        <Field label="Claims per month" hint="All claims the practice sends in a month" value={claims} onChange={setClaims} min={100} max={20000} step={100} />
        <Field label="Average claim value" hint="Average billed or expected amount per claim" value={avg} onChange={setAvg} min={50} max={2000} step={10} prefix="$" />
        <Field label="Current denial rate" hint="Share of claims denied on first submission" value={rate} onChange={setRate} min={1} max={30} step={0.5} suffix="%" />
        <Field label="Denied value never recovered" hint="Of the denied amount, the share you end up writing off" value={lost} onChange={setLost} min={0} max={100} step={5} suffix="%" />
        <Field label="Staff cost to rework one denial" hint="Your estimate: time to research, correct and resubmit or appeal" value={rework} onChange={setRework} min={0} max={150} step={5} prefix="$" />
        <Field label="Compare with a denial rate of" hint="Industry benchmark is under 5%" value={target} onChange={setTarget} min={1} max={30} step={0.5} suffix="%" />
      </div>
      <div className="flex flex-col justify-center rounded-2xl bg-slate-900 p-6 text-white lg:col-span-2" aria-live="polite">
        <p className="text-sm font-semibold text-slate-300">Denials cost you about</p>
        <p className="mt-1 text-4xl font-extrabold tracking-tight">{usd(monthly * 12)}<span className="text-lg font-semibold text-slate-400"> / year</span></p>
        <p className="mt-1 text-sm text-slate-400">{usd(monthly)} a month: {usd(now.lostRevenue)} written off and {usd(now.reworkCost)} of rework on {Math.round(now.denied).toLocaleString("en-US")} denials</p>
        <div className="my-6 h-px bg-white/10" />
        <p className="text-sm font-semibold text-slate-300">At a {target}% denial rate</p>
        <p className="mt-1 text-3xl font-extrabold tracking-tight text-green-400">{usd(Math.max(0, monthly - monthlyThen) * 12)}<span className="text-base font-semibold text-slate-400"> / year back</span></p>
        <p className="mt-4 text-xs leading-relaxed text-slate-500">
          Denied claims = claims × denial rate. Cost = denied claims × (average value × share never recovered + rework cost). Your own figures, not a promise of results.
        </p>
      </div>
    </div>
  );
}
