"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import {
  TIERS,
  ANNUAL_FREE_MONTHS,
  annualTotal,
  annualEffectiveMonthly,
  annualSaving,
  type Tier,
} from "@/content/pricing";

type Cycle = "monthly" | "annual";

const usd = (v: number) =>
  v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const usdCents = (v: number) =>
  v.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

/**
 * The price block.
 *
 * On the annual cycle the headline stays a per-month figure, because that is
 * how a buyer compares plans, with the amount actually charged stated
 * underneath. Showing the yearly total as the headline makes a cheaper plan
 * look more expensive than a rival's monthly one.
 */
function Price({ tier, cycle }: { tier: Tier; cycle: Cycle }) {
  if (tier.priceMonthly === null) {
    return (
      <div className="mt-5 min-h-[6.5rem]">
        <div className="text-3xl font-extrabold tracking-tight text-slate-900">Custom quote</div>
        <p className="mt-1.5 text-sm text-slate-600">Priced on provider count and claim volume</p>
      </div>
    );
  }

  const monthly = cycle === "annual" ? annualEffectiveMonthly(tier.priceMonthly) : tier.priceMonthly;

  return (
    <div className="mt-5 min-h-[6.5rem]">
      <div className="flex items-baseline gap-1.5">
        <span className="text-4xl font-extrabold tracking-tight text-slate-900">
          {cycle === "annual" ? usdCents(monthly) : usd(monthly)}
        </span>
        <span className="text-sm font-medium text-slate-600">/ provider / month</span>
      </div>

      {cycle === "annual" ? (
        <p className="mt-1.5 text-sm text-slate-600">
          Billed {usd(annualTotal(tier.priceMonthly))} per provider per year.{" "}
          <span className="font-semibold text-green-700">
            Save {usd(annualSaving(tier.priceMonthly))}
          </span>
        </p>
      ) : (
        <p className="mt-1.5 text-sm text-slate-600">Billed monthly, no commitment</p>
      )}

      {tier.perClaimCents !== null && (
        <p className="mt-1 text-sm text-slate-600">
          plus {usdCents(tier.perClaimCents / 100)} per submitted claim
        </p>
      )}
    </div>
  );
}

export function PlanCards() {
  const [cycle, setCycle] = useState<Cycle>("monthly");

  return (
    <>
      {/* cycle toggle */}
      <div className="flex justify-center">
        <div
          role="radiogroup"
          aria-label="Billing cycle"
          className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white p-1"
        >
          {(["monthly", "annual"] as const).map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={cycle === c}
              onClick={() => setCycle(c)}
              className={`rounded-full px-5 py-2 text-sm font-semibold transition-colors ${
                cycle === c
                  ? "bg-green-600 text-white"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {c === "monthly" ? "Monthly" : "Annual"}
              {c === "annual" && (
                <span
                  className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                    cycle === "annual" ? "bg-white/20 text-white" : "bg-green-50 text-green-700"
                  }`}
                >
                  {ANNUAL_FREE_MONTHS} months free
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* plans */}
      <div className="mt-10 grid gap-6 lg:grid-cols-3">
        {TIERS.map((tier) => (
          <div
            key={tier.id}
            className={`relative flex flex-col rounded-2xl border bg-white p-7 transition-shadow hover:shadow-lg hover:shadow-slate-900/5 ${
              tier.featured ? "border-green-600 shadow-lg shadow-green-900/5" : "border-slate-200"
            }`}
          >
            {tier.featured && (
              <span className="absolute -top-3 left-7 rounded-full bg-green-600 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-white">
                Most chosen
              </span>
            )}
            <h2 className="text-lg font-bold tracking-tight text-slate-900">{tier.name}</h2>
            <p className="mt-1 min-h-[2rem] text-xs font-semibold uppercase tracking-wide text-green-700">
              {tier.forWho}
            </p>
            <p className="mt-2 min-h-[4.5rem] text-sm leading-relaxed text-slate-600">
              {tier.summary}
            </p>

            <Price tier={tier} cycle={cycle} />

            <Link
              href="/contact"
              className={`btn mt-6 w-full justify-center py-2.5 ${
                tier.featured ? "bg-green-600 text-white hover:bg-green-700" : "btn-secondary"
              }`}
            >
              {tier.cta} <ArrowRight className="h-4 w-4" />
            </Link>

            <ul className="mt-7 space-y-3 border-t border-slate-100 pt-6">
              {tier.highlights.map((h) => (
                <li key={h} className="flex gap-2.5 text-sm leading-relaxed text-slate-700">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-600" strokeWidth={3} />
                  {h}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </>
  );
}
