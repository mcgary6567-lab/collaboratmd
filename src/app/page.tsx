import Link from "next/link";
import type { Metadata } from "next";
import {
  ArrowRight, BadgeCheck, CalendarDays, ChevronRight, ClipboardCheck, CreditCard, FileSearch,
  FlaskConical, Gauge, Landmark, Lock, Network, Plug, ReceiptText, RefreshCw, ScanLine, ShieldCheck, Sparkles, Stethoscope, Wand2, Zap,
} from "lucide-react";
import { RULE_IDS } from "@/lib/scrub/rules";
import { getSession } from "@/lib/auth";
import { AppMockup } from "@/components/app-mockup";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { PricingTeaser } from "@/components/pricing-teaser";
import { BuiltFor } from "@/components/built-for";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "CollaboratMD — Medical billing and revenue cycle management",
  description:
    "Get paid faster with fewer denials. Eligibility, claim scrubbing, X12 837 and 835, denial management, patient billing, EHR and lab interfaces and analytics in one platform.",
};

const FEATURES = [
  {
    icon: ScanLine,
    title: "Claim scrubbing before submission",
    body: `${RULE_IDS.length} built-in rules plus the payer-specific edits you configure (prior authorization, required modifiers and diagnoses, unit limits) run on every claim. NPI check digits, diagnosis pointers, place of service and timely filing are caught at your desk instead of on a remittance three weeks later. Each unsent claim also gets a denial-risk score from your own last 12 months with that payer, with the reasons spelled out.`,
  },
  {
    icon: ReceiptText,
    title: "Native X12, not a conversion layer",
    body: "The platform generates 837P professional claims, reads 999 and 277CA acknowledgments, and parses 835 remittances directly. Payments, contractual adjustments, patient responsibility and payer reversals post automatically, with CARC and RARC codes preserved on every line.",
  },
  {
    icon: FileSearch,
    title: "Denials explained in plain English",
    body: "Every denial arrives categorized, prioritized by appeal deadline, and translated out of payer shorthand into what happened and what to do next. An appeal letter is one click away, filled in with the claim's details for you to edit and print. With an AI key configured, the draft is written from the denial and procedure codes only; patient details are added afterwards on our side.",
  },
  {
    icon: BadgeCheck,
    title: "Eligibility before the visit",
    body: "Standard X12 270 requests and 271 responses, one patient at a time or the whole of tomorrow's schedule at once. Copay, deductible, remaining deductible and out-of-pocket maximum are on the screen before the patient is roomed. Payer answers are simulated until a live clearinghouse is connected.",
  },
  {
    icon: RefreshCw,
    title: "Secondary claims and follow-up",
    body: "When the primary payer pays, the balance bills to secondary insurance with the primary's adjudication attached (837P loop 2320). Claims that go quiet are chased with X12 276/277 status inquiries, and each answer comes with the next step.",
  },
  {
    icon: CreditCard,
    title: "Patient balances that actually clear",
    body: "Patient responsibility transfers straight from the remittance. Statements follow HFMA patient-friendly principles, estimates include No Surprises Act good faith estimates, and discounts and payment plans are tracked separately from insurance A/R so neither hides the other. Patients can view and pay their balance through a secure portal link (card payments run on the practice's own Stripe account), with optional autopay for plans and appointment and balance reminders by text or email once those services are connected. Accounts that still don't pay move through a final notice to a collection agency.",
  },
  {
    icon: Gauge,
    title: "Analytics measured against benchmarks",
    body: "Days in A/R, net collection rate, clean claim rate and denial rate, each shown against the industry target rather than floating without context. Paid claims are checked against your payer contracts so underpayments surface on their own.",
  },
  {
    icon: Wand2,
    title: "Coding help at charge entry",
    body: "An office-visit level calculator that follows the AMA time and medical decision making rules for 99202-99215, and a diagnosis finder that understands everyday words. Suggesting codes from a full visit note uses AI and stays off unless the practice turns it on.",
  },
  {
    icon: Landmark,
    title: "Deposits reconciled, enrollment tracked",
    body: "Import your bank's CSV and each deposit is matched to its ERA by trace number or amount, so a payment that never arrived stands out. Provider enrollment with each payer is tracked with revalidation dates, and the scrubber warns before billing a payer a provider is not approved with.",
  },
  {
    icon: Plug,
    title: "Connects to your EHR",
    body: "HL7 v2 over HTTPS: ADT messages keep patients and insurance current, DFT messages become scrubbed claims. Moving from another system? Import its patient export as a CSV, with the columns matched for you.",
  },
  {
    icon: FlaskConical,
    title: "Lab orders and results",
    body: "Orders go out as HL7 ORM messages with the diagnoses the lab needs to bill; ORU results come back, attach to the order and flag abnormal values for review. Each reference lab needs its own interface before orders flow electronically.",
  },
  {
    icon: ClipboardCheck,
    title: "Online check-in",
    body: "Send the patient a link. After confirming their date of birth they update contact and insurance details, sign the practice's notices and see their expected copay. Changes wait for the front desk to review.",
  },
  {
    icon: Network,
    title: "Built for billing companies",
    body: "One login across every practice you serve, with a switcher, a side-by-side view of each client's collections, denial rate and aged A/R, and roles that limit who can post, adjust or write off.",
  },
];

const WORKFLOW = [
  { icon: CalendarDays, step: "01", title: "Schedule and verify", body: "Book the visit, verify coverage, and send an online check-in link." },
  { icon: Stethoscope, step: "02", title: "Capture charges", body: "Enter CPT and ICD-10 codes with fee-schedule pricing and modifier support." },
  { icon: ScanLine, step: "03", title: "Scrub and submit", body: "Blocking errors stop the claim; clean claims batch out as 837P." },
  { icon: ReceiptText, step: "04", title: "Post and reconcile", body: "835 remittances post automatically and open denials become assigned work." },
];

const BENCHMARKS = [
  { metric: "Days in A/R", target: "Under 40 days", why: "How long revenue sits uncollected after the visit" },
  { metric: "Net collection rate", target: "95% or better", why: "Share of collectible revenue you actually collect" },
  { metric: "Clean claim rate", target: "95% or better", why: "Claims accepted on first submission, without rework" },
  { metric: "Denial rate", target: "Under 5%", why: "Adjudicated claims the payer refused to pay" },
  { metric: "A/R over 90 days", target: "Under 15%", why: "Aged receivable that rarely gets collected" },
];

const STANDARDS = [
  "X12 005010X222A1 (837P)",
  "X12 005010X221A1 (835)",
  "X12 005010X279A1 (270/271)",
  "X12 999 and 277CA acknowledgments",
  "HL7 v2.5.1 ADT, DFT, ORM, ORU",
  "ICD-10-CM · CPT · HCPCS",
  "CARC and RARC code sets",
  "NPI, taxonomy and payer IDs",
];

export default async function LandingPage() {
  const session = await getSession();

  return (
    <div className="min-h-screen bg-white">
      <SiteHeader signedIn={!!session} anchored />

      {/* --------------------------------------------------------- hero */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(60rem_40rem_at_50%_-10rem,rgba(22,163,74,0.16),transparent)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-green-500/40 to-transparent"
        />
        <div className="relative mx-auto max-w-7xl px-6 pb-16 pt-16 lg:pt-24">
          <div className="mx-auto max-w-3xl text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-green-200 bg-green-50 px-3.5 py-1.5 text-xs font-semibold text-green-700">
              <Sparkles className="h-3.5 w-3.5" />
              Built on real X12 claim and remittance processing
            </span>
            <h1 className="mt-6 text-4xl font-extrabold leading-[1.1] tracking-tight text-slate-900 sm:text-5xl lg:text-6xl">
              Get paid faster,
              <br />
              with fewer denials
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-slate-600">
              A complete revenue cycle platform for medical practices and billing companies.
              Eligibility, charge capture, claim scrubbing, 837P claims, remittance posting,
              denial management and patient billing, in one system.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link href="/login" className="btn bg-green-600 text-white hover:bg-green-700 px-6 py-3 text-base">
                Explore the live demo <ArrowRight className="h-4 w-4" />
              </Link>
              <a
                href="https://github.com/mcgary6567-lab/collaboratmd"
                className="btn btn-secondary px-6 py-3 text-base"
                target="_blank"
                rel="noreferrer noopener"
              >
                Read the source
              </a>
            </div>
            <p className="mt-5 text-sm text-slate-500">
              Open the demo environment with{" "}
              <span className="font-mono text-slate-700">admin@collaboratmd.local</span> /{" "}
              <span className="font-mono text-slate-700">admin123</span>
            </p>
          </div>

          {/* Product mockup */}
          <div className="relative mx-auto mt-16 max-w-5xl">
            <div aria-hidden className="absolute -inset-x-8 -top-6 bottom-8 rounded-[2rem] bg-gradient-to-b from-green-600/10 to-transparent blur-2xl" />
            <div className="relative">
              <AppMockup />
            </div>

            {/* Proof points. Kept below the mockup rather than floating over
                it: the container leaves too little gutter for a card to sit
                clear of the product shot at any viewport width. */}
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {[
                { icon: Zap, tone: "text-green-600", title: "Scrubbed before submission", body: `${RULE_IDS.length} rules plus payer edits` },
                { icon: ReceiptText, tone: "text-green-600", title: "ERA posted automatically", body: "835 matched to claim and line" },
                { icon: ShieldCheck, tone: "text-slate-700", title: "Amounts never edited", body: "Corrections post as reversals" },
              ].map(({ icon: Icon, tone, title, body }) => (
                <div key={title} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                  <Icon className={`h-5 w-5 shrink-0 ${tone}`} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-900">{title}</div>
                    <div className="truncate text-xs text-slate-500">{body}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <BuiltFor />

      {/* -------------------------------------------------------- stats */}
      <section className="border-y border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-7xl px-6 py-12">
          <p className="text-xs font-bold uppercase tracking-widest text-green-600">
            Inside the live demo environment
          </p>
          <div className="mt-6 grid grid-cols-2 gap-8 lg:grid-cols-4">
          {[
            { value: "$62.7M", label: "Billed charges carried in the ledger" },
            { value: "100", label: "Providers across 26 specialties" },
            { value: "15,000", label: "Patients in 50 metro areas" },
            { value: "105k", label: "Synthetic claims through the full lifecycle" },
          ].map((s) => (
            <div key={s.label}>
              <div className="text-3xl font-extrabold tracking-tight text-slate-900 lg:text-4xl">{s.value}</div>
              <div className="mt-1.5 text-sm leading-snug text-slate-600">{s.label}</div>
            </div>
          ))}
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------- features */}
      <section id="platform" className="mx-auto max-w-7xl px-6 py-20 lg:py-28">
        <div className="max-w-2xl">
          <span className="text-xs font-bold uppercase tracking-widest text-green-600">The platform</span>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
            Everything between the visit and the deposit
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-slate-600">
            Most billing problems are caught too late. This platform moves the checks forward,
            to the moment the claim is created, and makes the money trail auditable end to end.
          </p>
        </div>

        <div className="mt-14 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="group rounded-2xl border border-slate-200 bg-white p-6 transition-shadow hover:shadow-lg hover:shadow-slate-900/5"
            >
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-green-50 text-green-600 transition-colors group-hover:bg-green-600 group-hover:text-white">
                <Icon className="h-5 w-5" />
              </span>
              <h3 className="mt-4 text-base font-bold text-slate-900">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ----------------------------------------------------- workflow */}
      <section id="workflow" className="border-y border-slate-200 bg-slate-50 py-20 lg:py-28">
        <div className="mx-auto max-w-7xl px-6">
          <div className="max-w-2xl">
            <span className="text-xs font-bold uppercase tracking-widest text-green-600">How it works</span>
            <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
              One loop, start to finish
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-slate-600">
              Every screen in the product sits somewhere on this path. Nothing is a dead end:
              a denial becomes a corrected claim, a balance becomes a statement.
            </p>
          </div>

          <ol className="mt-14 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {WORKFLOW.map(({ icon: Icon, step, title, body }, i) => (
              <li key={step} className="relative rounded-2xl border border-slate-200 bg-white p-6">
                <div className="flex items-center justify-between">
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-slate-900 text-white">
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="font-mono text-sm font-bold text-slate-300">{step}</span>
                </div>
                <h3 className="mt-4 text-base font-bold text-slate-900">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{body}</p>
                {i < WORKFLOW.length - 1 && (
                  <ChevronRight aria-hidden className="absolute -right-3 top-1/2 hidden h-6 w-6 -translate-y-1/2 text-slate-300 lg:block" />
                )}
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* --------------------------------------------------- benchmarks */}
      <section id="benchmarks" className="mx-auto max-w-7xl px-6 py-20 lg:py-28">
        <div className="grid gap-14 lg:grid-cols-2 lg:items-center">
          <div>
            <span className="text-xs font-bold uppercase tracking-widest text-green-600">Benchmarks</span>
            <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
              Numbers with a point of comparison
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-slate-600">
              A dashboard that reports 51 days in A/R without saying whether that is good
              is just trivia. Every headline metric is shown against the industry target and
              colored accordingly, so anyone can read the practice in a glance.
            </p>
            <Link href="/login" className="btn bg-green-600 text-white hover:bg-green-700 mt-8 px-6 py-3 text-base">
              See it on a full-size demo practice <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left">
                <tr>
                  <th className="px-5 py-3 font-semibold text-slate-600">Metric</th>
                  <th className="px-5 py-3 font-semibold text-slate-600">Target</th>
                </tr>
              </thead>
              <tbody>
                {BENCHMARKS.map((b) => (
                  <tr key={b.metric} className="border-t border-slate-200">
                    <td className="px-5 py-4">
                      <div className="font-semibold text-slate-900">{b.metric}</div>
                      <div className="mt-0.5 text-xs text-slate-500">{b.why}</div>
                    </td>
                    <td className="whitespace-nowrap px-5 py-4 font-semibold text-green-700">{b.target}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <PricingTeaser />

      {/* ---------------------------------------------------- standards */}
      <section id="standards" className="border-t border-slate-200 bg-slate-900 py-20 text-white lg:py-28">
        <div className="mx-auto max-w-7xl px-6">
          <div className="grid gap-14 lg:grid-cols-2">
            <div>
              <span className="text-xs font-bold uppercase tracking-widest text-green-400">Standards and security</span>
              <h2 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">
                Built on the formats payers actually use
              </h2>
              <p className="mt-4 text-lg leading-relaxed text-slate-300">
                Claims, eligibility, acknowledgments and remittances are generated and parsed as real
                ASC X12 transactions, and EHR and lab traffic as HL7 v2, all covered by segment-level
                tests. Posted amounts are never edited: a correction is a reversal.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <span className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-3.5 py-2 text-sm font-medium">
                  <ShieldCheck className="h-4 w-4 text-green-400" /> HIPAA-aligned design
                </span>
                <span className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-3.5 py-2 text-sm font-medium">
                  <Lock className="h-4 w-4 text-green-400" /> Audit log of key actions
                </span>
              </div>
            </div>

            <ul className="grid gap-3 sm:grid-cols-2 lg:content-start">
              {STANDARDS.map((s) => (
                <li key={s} className="rounded-xl border border-white/10 bg-white/5 px-4 py-3.5 text-sm font-medium text-slate-200">
                  {s}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------- cta */}
      <section className="mx-auto max-w-7xl px-6 py-20 lg:py-28">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-green-700 via-green-600 to-green-500 px-8 py-16 text-center lg:px-16">
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(30rem_20rem_at_50%_0%,rgba(255,255,255,0.18),transparent)]" />
          <div className="relative">
            <h2 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
              Walk the whole revenue cycle
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-lg leading-relaxed text-green-50">
              The demo runs on a full-size synthetic practice: 100 providers, 15,000 patients and
              105,000 claims that have been scrubbed, submitted, adjudicated by a simulated payer,
              denied and appealed.
            </p>
            <Link
              href="/login"
              className="mt-9 inline-flex items-center gap-2 rounded-lg bg-white px-6 py-3 text-base font-bold text-green-700 transition-colors hover:bg-green-50"
            >
              Open the demo <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
