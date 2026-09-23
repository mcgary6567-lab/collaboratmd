import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight, Binary, FileCheck2, Landmark, LineChart, Lock, Repeat, ScanLine, Users,
} from "lucide-react";
import { PageShell, Prose } from "@/components/page-shell";
import { COMPANY, addressLine } from "@/content/company";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Investors — CollaboratMD",
  description:
    "CollaboratMD for healthcare IT investors: the problem in medical billing, what we have built, how the business works, and how to reach us.",
};

/** Engineering facts about the product, each verifiable in the running system. */
const PROOF = [
  {
    icon: Binary,
    title: "Native X12, not a conversion layer",
    body: "The platform generates 837P claims and parses 835 remittances directly, with CARC and RARC codes preserved on every service line. Each transaction is validated against golden-file fixtures in the test suite, so a change that would alter a segment fails before it ships.",
  },
  {
    icon: ScanLine,
    title: "Validation moved to the desk",
    body: "Twenty-two rules run on every claim as it is created: NPI check digits, diagnosis pointers, place of service, modifier logic and timely filing. The economics of this are the whole thesis. An error caught at entry costs seconds; the same error caught on a remittance costs an appeal and a month of aging.",
  },
  {
    icon: Lock,
    title: "Append-only financial ledger",
    body: "A correction posts as a reversal rather than an edit. No row is rewritten, so the money trail reads forward and reconciles to the cent. That property is what makes the system auditable, and it is very hard to retrofit into a platform that did not start with it.",
  },
  {
    icon: LineChart,
    title: "Analytics anchored to benchmarks",
    body: "Days in A/R, net collection rate, clean claim rate and denial rate are each reported against the industry target rather than floating without context. Aggregation happens in SQL, so reporting stays fast at millions of ledger rows.",
  },
];

/** What the demo environment demonstrates, stated as what it is. */
const SCALE = [
  { value: "105,000", label: "Claims through the full lifecycle" },
  { value: "100", label: "Providers across 26 specialties" },
  { value: "15,000", label: "Patients in 50 metro areas" },
  { value: "$62.7M", label: "Billed charges carried in the ledger" },
];

const DATA_ROOM = [
  "Financial statements, revenue detail and the operating model",
  "Capitalization table and prior instruments",
  "Customer pipeline, pricing and contract terms",
  "Architecture review and the security and HIPAA posture",
  "Product roadmap and engineering plan",
  "Team background and hiring plan",
];

const WHY_NOW = [
  {
    icon: Users,
    title: "The buyer is underserved",
    body: "Independent practices and small billing companies sit between spreadsheets and enterprise suites priced for hospital systems. They carry the same regulatory load with none of the staff.",
  },
  {
    icon: Repeat,
    title: "The work is recurring by nature",
    body: "Billing is not a project. Every visit generates a claim, every claim generates a remittance, and the software sits in the path of the money on each one.",
  },
  {
    icon: FileCheck2,
    title: "Switching is rare, so retention is structural",
    body: "A practice changes billing systems roughly as often as it changes banks. That cuts both ways, which is why the product has to be measurably better on numbers a practice already tracks.",
  },
];

export default function InvestorsPage() {
  return (
    <PageShell
      eyebrow="Investors"
      title="Revenue cycle software, built like infrastructure"
      lead="CollaboratMD is a medical billing and revenue cycle platform for independent practices and the billing companies that serve them. This page is for healthcare IT and digital health investors evaluating the company."
      wide
    >
      {/* ------------------------------------------------- thesis */}
      <div className="mx-auto max-w-3xl">
        <Prose>
          <h2>The thesis in one paragraph</h2>
          <p>
            Practices do not mostly lose money because collections are hard. They lose it in small,
            preventable increments: a missing diagnosis pointer, a modifier that contradicts the
            place of service, an eligibility check nobody ran. Each surfaces weeks later as a denial
            that has to be decoded, appealed and chased, often past the point where the effort is
            worth it. CollaboratMD moves those checks to the moment the claim is created and makes
            the financial record auditable end to end. That is not a new billing theory. It is the
            ordinary revenue cycle with the errors taken out of it.
          </p>
        </Prose>
      </div>

      {/* ------------------------------------------------- proof */}
      <h2 className="mt-16 text-center text-2xl font-extrabold tracking-tight text-slate-900">
        What is actually built
      </h2>
      <p className="mx-auto mt-3 max-w-2xl text-center text-[15px] leading-relaxed text-slate-600">
        Every item below is running software you can open, not a roadmap item.
      </p>
      <div className="mt-10 grid gap-6 md:grid-cols-2">
        {PROOF.map(({ icon: Icon, title, body }) => (
          <div key={title} className="rounded-2xl border border-slate-200 bg-white p-7">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-green-50 text-green-600">
              <Icon className="h-5 w-5" />
            </span>
            <h3 className="mt-4 text-base font-bold text-slate-900">{title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">{body}</p>
          </div>
        ))}
      </div>

      {/* ------------------------------------------------- scale */}
      <div className="mt-14 rounded-3xl border border-slate-200 bg-slate-50 px-8 py-10">
        <h2 className="text-center text-xl font-bold tracking-tight text-slate-900">
          Proven at production scale, in a demo anyone can open
        </h2>
        <p className="mx-auto mt-2 max-w-2xl text-center text-sm leading-relaxed text-slate-600">
          The demo environment is a complete practice dataset rather than a handful of sample rows,
          so performance and reporting are exercised at the volume a real customer brings. It
          carries no patient information.
        </p>
        <div className="mt-8 grid grid-cols-2 gap-8 lg:grid-cols-4">
          {SCALE.map((s) => (
            <div key={s.label} className="text-center">
              <div className="text-3xl font-extrabold tracking-tight text-slate-900">{s.value}</div>
              <div className="mt-1.5 text-sm leading-snug text-slate-600">{s.label}</div>
            </div>
          ))}
        </div>
        <div className="mt-8 text-center">
          <Link
            href="/login"
            className="btn bg-green-600 px-6 py-3 text-white hover:bg-green-700"
          >
            Open the product <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {/* ------------------------------------------------- why now */}
      <h2 className="mt-16 text-center text-2xl font-extrabold tracking-tight text-slate-900">
        Why this market
      </h2>
      <div className="mt-10 grid gap-6 md:grid-cols-3">
        {WHY_NOW.map(({ icon: Icon, title, body }) => (
          <div key={title} className="rounded-2xl border border-slate-200 bg-white p-7">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-green-50 text-green-600">
              <Icon className="h-5 w-5" />
            </span>
            <h3 className="mt-4 text-base font-bold text-slate-900">{title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">{body}</p>
          </div>
        ))}
      </div>

      {/* ------------------------------------------------- model + ask */}
      <div className="mx-auto mt-16 max-w-3xl">
        <Prose>
          <h2>How the business earns</h2>
          <p>
            Revenue cycle software monetizes in two places, and both scale with the customer rather
            than with headcount on our side. The first is a recurring subscription per provider,
            which grows as a practice adds clinicians. The second is transaction-based, tied to
            claim volume, which grows as the practice sees more patients. Because the product sits
            in the path of the money on every encounter, usage and value move together, and the
            customer can see the return in metrics they already track.
          </p>
          <p>
            Specific pricing, contract terms, revenue detail and the operating model are in the data
            room rather than on a public page.
          </p>

          <h2>What we are looking for</h2>
          <p>
            We are talking with investors focused on <strong>health IT</strong>,{" "}
            <strong>digital health</strong> and <strong>SMB software</strong>, and we prefer
            partners who have taken a billing, payments or claims business through the stage ahead
            of us. Regulatory literacy matters more here than in most software categories: a partner
            who already understands HIPAA obligations, payer contracting and clearinghouse
            economics will be useful in the room, not just on the cap table.
          </p>
          <p>
            If that is you, ask for the data room through the form below and we will respond within
            one business day.
          </p>
        </Prose>
      </div>

      {/* ------------------------------------------------- data room */}
      <div className="mt-14 grid gap-8 rounded-3xl border border-slate-200 bg-white p-8 lg:grid-cols-2 lg:p-10">
        <div>
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-green-50 text-green-600">
            <Landmark className="h-5 w-5" />
          </span>
          <h2 className="mt-4 text-xl font-bold tracking-tight text-slate-900">
            What the data room contains
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">
            Shared under a mutual non-disclosure agreement after an introductory call. We keep
            financials, pipeline and cap table off the public site, where they would be visible to
            competitors and could not be kept current.
          </p>
        </div>
        <ul className="space-y-3">
          {DATA_ROOM.map((item) => (
            <li key={item} className="flex gap-3 text-sm leading-relaxed text-slate-700">
              <FileCheck2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
              {item}
            </li>
          ))}
        </ul>
      </div>

      {/* ------------------------------------------------- cta */}
      <div className="mt-14 rounded-3xl bg-gradient-to-br from-green-700 via-green-600 to-green-500 px-8 py-12 text-center">
        <h2 className="text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
          Start a conversation
        </h2>
        <p className="mx-auto mt-4 max-w-xl leading-relaxed text-green-50">
          Use the contact form and select the investor topic. Tell us the fund, the stage you lead
          and one healthcare company you have backed, and we will send the data room.
        </p>
        <Link
          href="/contact"
          className="mt-8 inline-flex items-center gap-2 rounded-lg bg-white px-6 py-3 text-base font-bold text-green-700 transition-colors hover:bg-green-50"
        >
          Request the data room <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      {/* ------------------------------------------------- disclosure */}
      <div className="mx-auto mt-12 max-w-3xl rounded-2xl border border-slate-200 bg-slate-50 px-6 py-5">
        <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">
          Important disclosure
        </h3>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          This page is provided for information only. It is not an offer to sell, or a solicitation
          of an offer to buy, any security, and it is not a recommendation or a promise of any
          financial return. Any investment would be made solely under definitive documents, and
          investing in a private company carries the risk of losing the entire amount invested.
          Statements about future plans are forward looking and may not come about.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          {COMPANY.legalName}, {addressLine()}.
        </p>
      </div>
    </PageShell>
  );
}
