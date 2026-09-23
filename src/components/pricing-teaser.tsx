import Link from "next/link";
import { ArrowRight, Check, ChevronDown } from "lucide-react";
import {
  TIERS,
  ANNUAL_FREE_MONTHS,
  annualEffectiveMonthly,
} from "@/content/pricing";

const usd = (v: number) =>
  v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const usdCents = (v: number) =>
  v.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

/**
 * Condensed pricing for the landing page.
 *
 * Each card collapses its feature list, not the section: the prices are the
 * one thing this section exists to show, so hiding them behind a toggle would
 * defeat the point. Name, audience and price stay visible, and the plan a
 * visitor is weighing opens on click. The recommended plan opens by default.
 *
 * Reads the same tier data the pricing page does, so a price change lands in
 * both places at once. Deliberately has no billing toggle: the landing page is
 * not where a buyer compares cycles, and a control that only some visitors
 * notice would make the two pages appear to disagree. It shows the monthly
 * figure with the annual rate underneath, and sends anyone comparing in detail
 * to the full page.
 */
export function PricingTeaser() {
  return (
    <section id="pricing" className="border-y border-slate-200 bg-slate-50 py-20 lg:py-28">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-xs font-bold uppercase tracking-widest text-green-600">Pricing</span>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
            Priced per provider, not per seat
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-slate-600">
            Front desk staff, billers and administrators cost nothing. You pay for the clinicians
            who generate charges, plus a transaction line tied to claim volume. Pay annually and{" "}
            {ANNUAL_FREE_MONTHS} months are free.
          </p>
        </div>

        <div className="mt-14 grid gap-6 lg:grid-cols-3">
          {TIERS.map((tier) => (
            <div
              key={tier.id}
              className={`relative self-start rounded-2xl border bg-white p-7 transition-shadow hover:shadow-lg hover:shadow-slate-900/5 ${
                tier.featured ? "border-green-600 shadow-lg shadow-green-900/5" : "border-slate-200"
              }`}
            >
              {tier.featured && (
                <span className="absolute -top-3 left-7 rounded-full bg-green-600 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-white">
                  Most chosen
                </span>
              )}

              <h3 className="text-lg font-bold tracking-tight text-slate-900">{tier.name}</h3>
              <p className="mt-1 min-h-[2rem] text-xs font-semibold uppercase tracking-wide text-green-700">
                {tier.forWho}
              </p>

              <div className="mt-4 min-h-[5.5rem]">
                {tier.priceMonthly === null ? (
                  <>
                    <div className="text-3xl font-extrabold tracking-tight text-slate-900">
                      Custom quote
                    </div>
                    <p className="mt-1.5 text-sm text-slate-600">
                      Priced on provider count and claim volume
                    </p>
                  </>
                ) : (
                  <>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-4xl font-extrabold tracking-tight text-slate-900">
                        {usd(tier.priceMonthly)}
                      </span>
                      <span className="text-sm font-medium text-slate-600">
                        / provider / month
                      </span>
                    </div>
                    <p className="mt-1.5 text-sm text-slate-600">
                      or{" "}
                      <span className="font-semibold text-green-700">
                        {usdCents(annualEffectiveMonthly(tier.priceMonthly))}
                      </span>{" "}
                      billed annually
                    </p>
                    {tier.perClaimCents !== null && (
                      <p className="mt-1 text-sm text-slate-600">
                        plus {usdCents(tier.perClaimCents / 100)} per submitted claim
                      </p>
                    )}
                  </>
                )}
              </div>

              <details open={tier.featured} className="group/d mt-6 border-t border-slate-100 pt-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-1 text-sm font-semibold text-slate-700 transition-colors hover:text-green-700 [&::-webkit-details-marker]:hidden">
                  What&apos;s included
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600 transition-colors group-open/d:bg-green-600 group-open/d:text-white">
                    <ChevronDown className="h-3.5 w-3.5 transition-transform duration-200 group-open/d:rotate-180" />
                  </span>
                </summary>
                <ul className="mt-4 space-y-2.5">
                  {tier.highlights.map((h) => (
                    <li key={h} className="flex gap-2.5 text-sm leading-relaxed text-slate-700">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-600" strokeWidth={3} />
                      {h}
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          ))}
        </div>

        <div className="mt-12 text-center">
          <Link href="/pricing" className="btn bg-green-600 px-6 py-3 text-base text-white hover:bg-green-700">
            Compare every feature <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
