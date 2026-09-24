import { Building2, HeartPulse, Stethoscope, Users } from "lucide-react";

/**
 * The band below the hero, where a SaaS landing page usually puts a customer
 * logo wall.
 *
 * It names organization types rather than organizations. Putting a real
 * hospital's mark here would claim an endorsement that does not exist, use a
 * trademark without permission, and mislead both prospects and the investors
 * the neighbouring page is written for. When there are customers willing to be
 * named, their marks replace this and the claim becomes true.
 *
 * The payer line underneath is a capability claim, not an affiliation: the
 * platform generates 837P claims addressed to these payer IDs, which is a fact
 * about the software rather than a relationship with the payer.
 */

const SEGMENTS = [
  {
    icon: Stethoscope,
    title: "Independent practices",
    body: "One to ten providers, carrying the same regulatory load as a hospital with none of the staff.",
  },
  {
    icon: HeartPulse,
    title: "Multi-specialty groups",
    body: "Different fee schedules, authorization rules and denial patterns per specialty, in one ledger.",
  },
  {
    icon: Building2,
    title: "Billing companies",
    body: "Many practices side by side, each needing its own reporting and its own reconciliation.",
  },
  {
    icon: Users,
    title: "Community health centers",
    body: "High volume, thin margins, and a payer mix weighted toward Medicaid and sliding-scale patients.",
  },
];

export function BuiltFor() {
  return (
    <section className="border-b border-slate-200 bg-white py-16 lg:py-20">
      <div className="mx-auto max-w-7xl px-6">
        <p className="text-center text-xs font-bold uppercase tracking-widest text-slate-500">
          Built for the organizations that bill for care
        </p>

        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {SEGMENTS.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="group rounded-2xl border border-slate-200 p-6 transition-colors hover:border-green-600"
            >
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-green-50 text-green-600 transition-colors group-hover:bg-green-600 group-hover:text-white">
                <Icon className="h-5 w-5" />
              </span>
              <h3 className="mt-4 text-sm font-bold text-slate-900">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{body}</p>
            </div>
          ))}
        </div>

        <div className="mt-10 rounded-2xl bg-slate-50 px-6 py-5 text-center">
          <p className="text-sm leading-relaxed text-slate-600">
            <span className="font-semibold text-slate-900">Claims in the format every payer reads.</span>{" "}
            The platform generates 837P claims with the payer IDs for Medicare Part B, state Medicaid
            programs and the major commercial plans, and posts their 835 remittances. Live submission
            to payers runs through a connected clearinghouse.
          </p>
        </div>
      </div>
    </section>
  );
}
