import { Fragment } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, Minus, Receipt, ShieldCheck, Sparkles, Users } from "lucide-react";
import { getSession } from "@/lib/auth";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { TIERS, MATRIX, FAQ, type Tier } from "@/content/pricing";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pricing — CollaboratMD",
  description:
    "CollaboratMD pricing: a subscription per rendering provider plus a per-claim transaction line, across three plans for practices and billing companies.",
};

/** Renders a published price, or a quote request while none is set. */
function Price({ tier }: { tier: Tier }) {
  if (tier.priceMonthly === null) {
    return (
      <div className="mt-5">
        <div className="text-3xl font-extrabold tracking-tight text-slate-900">Custom quote</div>
        <p className="mt-1.5 text-sm text-slate-600">Priced on provider count and claim volume</p>
      </div>
    );
  }
  return (
    <div className="mt-5">
      <div className="flex items-baseline gap-1.5">
        <span className="text-4xl font-extrabold tracking-tight text-slate-900">
          ${tier.priceMonthly}
        </span>
        <span className="text-sm font-medium text-slate-600">/ provider / month</span>
      </div>
      {tier.perClaimCents !== null && (
        <p className="mt-1.5 text-sm text-slate-600">
          plus ${(tier.perClaimCents / 100).toFixed(2)} per submitted claim
        </p>
      )}
    </div>
  );
}

/** A matrix cell: true, false, or a short qualifier such as "4 business hours". */
function Cell({ value }: { value: boolean | string }) {
  if (value === true) {
    return (
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-green-50">
        <Check className="h-3.5 w-3.5 text-green-600" strokeWidth={3} />
      </span>
    );
  }
  if (value === false) {
    return <Minus className="h-4 w-4 text-slate-300" />;
  }
  return <span className="text-xs font-semibold text-green-700">{value}</span>;
}

export default async function PricingPage() {
  const session = await getSession();

  return (
    <div className="min-h-screen bg-white">
      <SiteHeader signedIn={!!session} />

      {/* ------------------------------------------------------------- hero */}
      <section className="relative overflow-hidden border-b border-slate-200 bg-slate-50">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(50rem_26rem_at_50%_-10rem,rgba(22,163,74,0.16),transparent)]"
        />
        <div className="relative mx-auto max-w-4xl px-6 py-16 text-center lg:py-20">
          <span className="inline-flex items-center gap-2 rounded-full border border-green-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-green-700">
            <Sparkles className="h-3.5 w-3.5" />
            No charge for front desk, billers or administrators
          </span>
          <h1 className="mt-6 text-4xl font-extrabold leading-[1.1] tracking-tight text-slate-900 sm:text-5xl">
            Pricing that follows the claims
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-slate-600">
            A subscription per rendering provider, plus a transaction line tied to claim volume.
            Both scale with the practice, so a two-provider clinic is never paying for a footprint
            it does not have.
          </p>
        </div>
      </section>

      {/* ------------------------------------------------------------ tiers */}
      <section className="mx-auto max-w-7xl px-6 py-16 lg:py-20">
        <div className="grid gap-6 lg:grid-cols-3">
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
              <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-green-700">
                {tier.forWho}
              </p>
              <p className="mt-3 text-sm leading-relaxed text-slate-600">{tier.summary}</p>

              <Price tier={tier} />

              <Link
                href="/contact"
                className={`btn mt-6 w-full justify-center py-2.5 ${
                  tier.featured
                    ? "bg-green-600 text-white hover:bg-green-700"
                    : "btn-secondary"
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

        {/* how billing works */}
        <div className="mt-10 grid gap-6 rounded-2xl border border-slate-200 bg-slate-50 p-8 md:grid-cols-3">
          {[
            {
              icon: Users,
              title: "Per rendering provider",
              body: "Counted on clinicians who generate charges. Staff accounts are unlimited, because charging for the people doing the billing work would penalize the behavior the software encourages.",
            },
            {
              icon: Receipt,
              title: "Per submitted claim",
              body: "Volume drives cost on our side too: every submission crosses a clearinghouse connection and every remittance comes back through one. Splitting it keeps small practices from subsidizing large ones.",
            },
            {
              icon: ShieldCheck,
              title: "Included in every plan",
              body: "A business associate agreement, the append-only ledger, the full PHI audit trail and role-based access. Compliance is not an upgrade.",
            },
          ].map(({ icon: Icon, title, body }) => (
            <div key={title}>
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-white text-green-600 ring-1 ring-green-100">
                <Icon className="h-5 w-5" />
              </span>
              <h3 className="mt-4 text-sm font-bold text-slate-900">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ----------------------------------------------------------- matrix */}
      <section className="border-y border-slate-200 bg-slate-50 py-16 lg:py-20">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <span className="text-xs font-bold uppercase tracking-widest text-green-600">
              Compare
            </span>
            <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
              What is in each plan
            </h2>
          </div>

          <div className="mt-12 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
            <table className="w-full min-w-[42rem] text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="px-6 py-4 text-left font-semibold text-slate-600">Feature</th>
                  {TIERS.map((t) => (
                    <th
                      key={t.id}
                      className={`px-6 py-4 text-center font-bold ${
                        t.featured ? "text-green-700" : "text-slate-900"
                      }`}
                    >
                      {t.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {MATRIX.map((group) => (
                  <Fragment key={group.group}>
                    <tr className="border-b border-slate-200 bg-slate-50/60">
                      <td
                        colSpan={4}
                        className="px-6 py-2.5 text-xs font-bold uppercase tracking-widest text-slate-500"
                      >
                        {group.group}
                      </td>
                    </tr>
                    {group.rows.map((row) => (
                      <tr key={row.feature} className="border-b border-slate-100 last:border-0">
                        <td className="px-6 py-3.5 text-slate-700">{row.feature}</td>
                        <td className="px-6 py-3.5 text-center">
                          <Cell value={row.essentials} />
                        </td>
                        <td className="bg-green-50/40 px-6 py-3.5 text-center">
                          <Cell value={row.professional} />
                        </td>
                        <td className="px-6 py-3.5 text-center">
                          <Cell value={row.billing} />
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------------- faq */}
      <section className="mx-auto max-w-3xl px-6 py-16 lg:py-20">
        <h2 className="text-center text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
          Questions worth asking
        </h2>
        <dl className="mt-12 space-y-8">
          {FAQ.map(({ q, a }) => (
            <div key={q} className="border-l-4 border-green-600 pl-6">
              <dt className="text-base font-bold text-slate-900">{q}</dt>
              <dd className="mt-2 text-[15px] leading-relaxed text-slate-600">{a}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* -------------------------------------------------------------- cta */}
      <section className="mx-auto max-w-7xl px-6 pb-16 lg:pb-24">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-green-700 via-green-600 to-green-500 px-8 py-14 text-center lg:px-16">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(30rem_18rem_at_50%_0%,rgba(255,255,255,0.18),transparent)]"
          />
          <div className="relative">
            <h2 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
              Get a quote on your volume
            </h2>
            <p className="mx-auto mt-4 max-w-xl leading-relaxed text-green-50">
              Tell us how many rendering providers you have and roughly how many claims you submit a
              month. That is all it takes to price it properly.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="/contact"
                className="inline-flex items-center gap-2 rounded-lg bg-white px-7 py-3.5 text-base font-bold text-green-700 transition-colors hover:bg-green-50"
              >
                Request a quote <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-lg border border-white/40 px-7 py-3.5 text-base font-bold text-white transition-colors hover:bg-white/10"
              >
                Try the demo first
              </Link>
            </div>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
