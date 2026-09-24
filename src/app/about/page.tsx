import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PageShell, Prose } from "@/components/page-shell";
import { COMPANY, addressLine } from "@/content/company";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "About — CollaboratMD",
  description:
    "Why CollaboratMD exists, what it believes about revenue cycle software, and how to see it running at full scale.",
};

const NUMBERS = [
  { value: "$62.7M", label: "Billed charges carried in the ledger" },
  { value: "100", label: "Providers across 26 specialties" },
  { value: "15,000", label: "Patients in 50 metropolitan areas" },
  { value: "105,000", label: "Synthetic claims through the full lifecycle" },
];

const BELIEFS = [
  {
    title: "Catch it at the desk, not on the remittance",
    body: "A denial found three weeks later costs a phone call, an appeal and a month of aging. The same error found before submission costs ten seconds. That is why every claim is checked as it is created, against built-in rules and the payer-specific edits a practice sets up.",
  },
  {
    title: "A number without a benchmark is trivia",
    body: "Reporting 51 days in A/R tells you nothing unless you know the target is 40. Every headline metric on the dashboard is shown against the industry figure and colored by whether it clears it.",
  },
  {
    title: "The money trail should never be rewritten",
    body: "Financial history is append-only here. A correction posts as a reversal, so the ledger reads forward and an auditor can follow every cent from charge to deposit without trusting anyone's memory.",
  },
  {
    title: "Speak the payer's language natively",
    body: "The platform generates 837P claims and parses 835 remittances directly, with CARC and RARC codes preserved on every line. There is no lossy conversion layer between you and the payer.",
  },
];

export default function AboutPage() {
  return (
    <PageShell
      eyebrow="Company"
      title="Software that treats billing as an engineering problem"
      lead="CollaboratMD is a revenue cycle platform built around a simple observation: most billing losses are not collection failures, they are preventable errors that nobody caught in time."
      wide
    >
      <div className="mx-auto max-w-3xl">
        <Prose>
          <h2>Why this exists</h2>
          <p>
            Practices lose revenue in small, quiet increments. A missing diagnosis pointer. A
            procedure that needed prior authorization. An eligibility check nobody ran. None of
            these is dramatic, and all of them surface weeks later as a denial that someone has to
            decode, appeal and chase, often past the point where it is worth the effort.
          </p>
          <p>
            CollaboratMD moves those checks forward, to the moment the claim is created, and makes
            the financial record auditable from end to end. The result is not a new billing theory.
            It is the ordinary revenue cycle, run with the errors taken out of it.
          </p>

          <h2>Built on real transactions</h2>
          <p>
            The platform is not a mockup of billing. It generates and parses the ASC X12
            transactions payers actually use, covered by segment-level tests. In the demo, claims are
            scrubbed, submitted, adjudicated by a simulated payer, denied, appealed and posted through
            the full lifecycle, and the ledger reconciles at every step.
          </p>
          <p>
            The demo you can open carries no real patient information, which is the only
            responsible way to hand a billing system to a stranger.
          </p>

          <h2>Where to find us</h2>
          <p>
            {COMPANY.legalName} is based at {addressLine()}. The quickest way to reach the right
            team is the <a href="/contact">contact page</a>, which routes sales, support, privacy
            and security to separate queues.
          </p>
        </Prose>
      </div>

      <div className="mt-14 rounded-3xl border border-slate-200 bg-slate-50 px-8 py-10">
        <h2 className="text-center text-xl font-bold tracking-tight text-slate-900">
          The demo environment, at full size
        </h2>
        <p className="mx-auto mt-2 max-w-2xl text-center text-sm leading-relaxed text-slate-600">
          Every screen you can open runs against a complete practice dataset, not a handful of
          sample rows. Performance and reporting are measured at the scale a real customer brings.
        </p>
        <div className="mt-8 grid grid-cols-2 gap-8 lg:grid-cols-4">
          {NUMBERS.map((n) => (
            <div key={n.label} className="text-center">
              <div className="text-3xl font-extrabold tracking-tight text-slate-900">{n.value}</div>
              <div className="mt-1.5 text-sm leading-snug text-slate-600">{n.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-14 grid gap-6 md:grid-cols-2">
        {BELIEFS.map((b) => (
          <div key={b.title} className="rounded-2xl border border-slate-200 bg-white p-7">
            <h3 className="text-base font-bold text-slate-900">{b.title}</h3>
            <p className="mt-2.5 text-sm leading-relaxed text-slate-600">{b.body}</p>
          </div>
        ))}
      </div>

      <div className="mt-14 flex flex-col items-center gap-4 rounded-3xl bg-gradient-to-br from-green-700 via-green-600 to-green-500 px-8 py-12 text-center">
        <h2 className="text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
          See it with a full practice behind it
        </h2>
        <p className="max-w-xl text-green-50">
          The demo opens on full-size synthetic volume: scrubbed claims, posted remittances, worked
          denials and the analytics computed over all of it.
        </p>
        <Link
          href="/login"
          className="mt-3 inline-flex items-center gap-2 rounded-lg bg-white px-6 py-3 text-base font-bold text-green-700 transition-colors hover:bg-green-50"
        >
          Open the demo <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </PageShell>
  );
}
