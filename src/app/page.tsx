import Link from "next/link";
import type { Metadata } from "next";
import {
  ArrowRight, BadgeCheck, Brain, CalendarDays, CreditCard, EyeOff, FileSearch, Gauge, KeyRound, Landmark, LineChart, Lock,
  Radar, ReceiptText, ScanLine, SearchCheck, Send, ShieldCheck, Sparkles, Stethoscope, UsersRound, Wand2, Zap,
} from "lucide-react";
import { RULE_IDS } from "@/lib/scrub/rules";
import { getSession } from "@/lib/auth";
import { AppMockup } from "@/components/app-mockup";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { PricingTeaser } from "@/components/pricing-teaser";
import { BuiltFor } from "@/components/built-for";
import { FeatureTour } from "@/components/landing/feature-tour";
import { DenialCalculator } from "@/components/landing/denial-calculator";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "CollaboratMD — Medical billing and revenue cycle management",
  description:
    "Get paid faster with fewer denials. Eligibility, coding help, NCCI-checked claims with denial risk scores, 837P/I/D and 835, appeals, missed-charge and underpayment recovery, cash forecasting, a patient payment portal, SSO and analytics in one platform.",
};

/** Features that only work once the practice connects its own account with an outside service say which. */
type Capability = { name: string; needs?: string };

const CAPABILITIES: { group: string; icon: typeof Zap; items: Capability[] }[] = [
  {
    group: "Front desk",
    icon: CalendarDays,
    items: [
      { name: "Scheduling and patient records" },
      { name: "Online check-in with insurance updates and signed notices" },
      { name: "Eligibility (270/271), single or whole schedule", needs: "clearinghouse" },
      { name: "Appointment reminders by text and email", needs: "Twilio / Resend" },
      { name: "Lab orders and results over HL7" },
      { name: "Prior authorization tracking with units" },
      { name: "Copay by card at online check-in", needs: "Stripe" },
      { name: "Check-in and patient portal in English and Spanish" },
      { name: "Two-way text inbox, with STOP honored", needs: "Twilio" },
      { name: "Insurance card read from a photo", needs: "AI key + BAA" },
      { name: "Coverage discovery for self-pay patients", needs: "clearinghouse" },
      { name: "Estimates before the visit, with pay-ahead links", needs: "Stripe for payment" },
    ],
  },
  {
    group: "Coding and claims",
    icon: ScanLine,
    items: [
      { name: "Charge entry with fee schedules and modifiers" },
      { name: "E/M level calculator and diagnosis finder" },
      { name: "AI code suggestions from visit notes", needs: "AI key + BAA" },
      { name: `Scrubber with ${RULE_IDS.length} rules plus your payer edits` },
      { name: "Denial risk score with reasons" },
      { name: "837P claims, 999 and 277CA acknowledgments" },
      { name: "Secondary claims billed automatically" },
      { name: "Edit, correct and void claims with an audit trail" },
      { name: "Facility claims: 837I / UB-04 with revenue codes" },
      { name: "Electronic prior authorization (278)", needs: "clearinghouse" },
      { name: "Dental claims: 837D with tooth, surfaces and quadrant" },
      { name: "NCCI edits and Medicare coverage checks" },
      { name: "Payer rules suggested from your own denials" },
      { name: "Claim attachments (PWK) with a fax cover sheet" },
    ],
  },
  {
    group: "Getting paid",
    icon: ReceiptText,
    items: [
      { name: "835 remittance auto-posting by line" },
      { name: "Underpayments checked against contracts" },
      { name: "Bank deposits matched to ERAs" },
      { name: "Denials in plain English with next steps" },
      { name: "Appeal letters in one click", needs: "AI key, optional" },
      { name: "276/277 follow-up on quiet claims" },
      { name: "Denial agent that prepares each day's work for approval" },
      { name: "Missed charges: visits seen but never billed" },
      { name: "Underpayment dispute letters, one per payer" },
      { name: "Credit balances refunded with approval" },
      { name: "ERAs picked up from the clearinghouse and posted daily", needs: "Stedi" },
    ],
  },
  {
    group: "Patient payments",
    icon: CreditCard,
    items: [
      { name: "Patient-friendly statements" },
      { name: "No Surprises Act good faith estimates" },
      { name: "Payment plans and discounts" },
      { name: "Patient portal with card payments", needs: "Stripe" },
      { name: "Autopay for plan installments", needs: "Stripe" },
      { name: "Final notice and collection agency workflow" },
      { name: "Text-to-pay campaigns", needs: "Twilio / Resend" },
    ],
  },
  {
    group: "Operations",
    icon: Gauge,
    items: [
      { name: "Analytics against industry benchmarks" },
      { name: "Reports and CSV exports" },
      { name: "Weekly report by email", needs: "Resend" },
      { name: "Task inbox, notes, saved views and bulk actions" },
      { name: "Payer enrollment and revalidation tracking" },
      { name: "Many practices under one login" },
      { name: "EHR interface (HL7) and CSV patient import" },
      { name: "Ctrl+K search, shortcuts, dark mode, phone layout" },
      { name: "Report builder, and questions answered as reports" },
      { name: "8-week cash forecast and payer behavior alerts" },
      { name: "Work queues with assignment rules and SLAs" },
      { name: "Client invoicing for billing companies" },
      { name: "Accounting journal export and month-end close" },
    ],
  },
  {
    group: "Security and admin",
    icon: ShieldCheck,
    items: [
      { name: "Single sign-on (OpenID Connect or SAML) and SCIM provisioning" },
      { name: "Notifications, daily digest and a setup guide" },
      { name: "Custom roles, session limits and office-network allowlists" },
      { name: "Two-factor sign-in, required per practice if you choose" },
      { name: "Team page with invites and one-click removal" },
      { name: "Compliance center: access reviews, BAAs, audit export" },
      { name: "REST API and signed webhooks" },
      { name: "Integrations screen: paste keys, test, go live" },
      { name: "Public status page and server error monitoring" },
    ],
  },
];

const SMART = [
  {
    icon: Gauge,
    title: "Denial risk you can argue with",
    body: "Each unsent claim is scored from your own last 12 months with that payer, plus known warning signs like a missing authorization number or an unverified policy. Every point comes with its reason, so you fix the cause instead of trusting a number.",
  },
  {
    icon: FileSearch,
    title: "Denials in plain English",
    body: "CARC and RARC codes become what happened and what to do next. Codes alone go to the AI, and a built-in explanation is used when no AI key is configured.",
  },
  {
    icon: Send,
    title: "Appeals drafted in one click",
    body: "A letter for the denial reason, filled with the claim, patient and practice details. With AI on, the argument is written from codes only and patient details are added afterwards on our side.",
  },
  {
    icon: Wand2,
    title: "Coding help at charge entry",
    body: "Visit level by the AMA time and medical decision making rules, and a diagnosis finder that understands everyday words. AI coding of full visit notes stays off until the practice has a BAA with the AI provider.",
  },
  {
    icon: LineChart,
    title: "A cash forecast from your own history",
    body: "Every claim in flight is projected from how that payer has actually paid you: how often, how much and how fast, adjusted for the claim's age. Scheduled visits and patient payments are added, and the method is on the page.",
  },
  {
    icon: Radar,
    title: "Payers that change, caught early",
    body: "Each payer's last 30 days are compared with its previous 90: more denials, slower payment, lower payment or a denial reason that suddenly spikes. Alerts need real volume, so noise stays out.",
  },
];

const WORKFLOW = [
  { icon: CalendarDays, title: "Schedule and verify", body: "Book the visit, check coverage for the whole day, and send a reminder with an online check-in link." },
  { icon: Stethoscope, title: "Capture and code", body: "Charges priced from your fee schedule, with coding help for the visit level and diagnoses." },
  { icon: ScanLine, title: "Scrub and risk-check", body: "Blocking errors stop the claim; the risk score shows what could still get it denied." },
  { icon: Zap, title: "Submit and follow up", body: "837P, 837I or 837D out, acknowledgments in, status inquiries for quiet claims, secondary billed on its own." },
  { icon: Landmark, title: "Post and reconcile", body: "835 remittances post by line, deposits match their ERAs, and underpayments are flagged." },
  { icon: BadgeCheck, title: "Resolve and collect", body: "Denials become appeals, underpayments become dispute letters, missed visits get billed; balances become statements, portal payments, plans or, last, collections." },
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
  "X12 005010X212 (276/277)",
  "X12 005010X223A2 (837I)",
  "X12 005010X217 (278)",
  "X12 005010X224A2 (837D)",
  "X12 999 and 277CA acknowledgments",
  "HL7 v2.5.1 ADT, DFT, ORM, ORU",
  "ICD-10-CM · CPT · HCPCS · CDT",
  "NCCI PTP and MUE edits",
  "OpenID Connect, SAML 2.0 and SCIM 2.0",
  "HL7 FHIR R4 (patients and encounters)",
  "CARC and RARC code sets",
];

const SECURITY = [
  { icon: KeyRound, text: "Two-factor sign-in, required per practice if you choose" },
  { icon: Lock, text: "Account lockout after repeated failed sign-ins" },
  { icon: ShieldCheck, text: "Built-in roles, and custom roles that can only narrow them" },
  { icon: UsersRound, text: "Single sign-on and SCIM: access ends when someone leaves" },
  { icon: SearchCheck, text: "Session limits and an allowlist of office networks" },
  { icon: ReceiptText, text: "Ledger amounts never edited; corrections are reversals" },
  { icon: EyeOff, text: "Patient links and keys stored only as hashes" },
  { icon: CreditCard, text: "Card numbers stay on Stripe's page, never our servers" },
];

const CONNECTS = [
  { name: "Stedi", what: "Clearinghouse for claims, eligibility and status" },
  { name: "Stripe", what: "Card payments and autopay" },
  { name: "Twilio", what: "Text reminders and a two-way inbox" },
  { name: "Resend", what: "Email reminders and reports" },
  { name: "Anthropic Claude", what: "Denials, appeals, coding, report questions" },
  { name: "Okta, Entra ID, Google", what: "Single sign-on and SCIM provisioning" },
  { name: "Any HL7 v2 EHR or lab", what: "Patients, charges, orders and results" },
];

export default async function LandingPage() {
  const session = await getSession();

  return (
    <div className="min-h-screen bg-white">
      <SiteHeader signedIn={!!session} anchored />

      {/* --------------------------------------------------------- hero */}
      <section className="relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(60rem_40rem_at_50%_-10rem,rgba(22,163,74,0.16),transparent)]" />
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-green-500/40 to-transparent" />
        <div className="relative mx-auto max-w-7xl px-6 pb-16 pt-16 lg:pt-24">
          <div className="mx-auto max-w-3xl text-center">
            <a href="#platform" className="inline-flex items-center gap-2 rounded-full border border-green-200 bg-green-50 px-3.5 py-1.5 text-xs font-semibold text-green-700 transition-colors hover:bg-green-100">
              <Sparkles className="h-3.5 w-3.5" />
              New: cash forecast, missed-charge recovery, single sign-on and dental claims
              <ArrowRight className="h-3.5 w-3.5" />
            </a>
            <h1 className="mt-6 text-4xl font-extrabold leading-[1.1] tracking-tight text-slate-900 sm:text-5xl lg:text-6xl">
              Get paid faster,
              <br />
              <span className="bg-gradient-to-r from-green-600 to-emerald-500 bg-clip-text text-transparent">with fewer denials</span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-slate-600">
              The complete revenue cycle for medical practices and billing companies. Verify coverage,
              code the visit, check every claim against NCCI and your payers before it goes out, post remittances,
              match deposits, recover what was missed or underpaid, forecast cash and let patients pay from their phone.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link href="/login" className="btn bg-green-600 px-6 py-3 text-base text-white hover:bg-green-700">
                Explore the live demo <ArrowRight className="h-4 w-4" />
              </Link>
              <a href="#calculator" className="btn btn-secondary px-6 py-3 text-base">
                What do denials cost you?
              </a>
            </div>
            <p className="mt-5 text-sm text-slate-500">
              Open the demo environment with <span className="font-mono text-slate-700">admin@collaboratmd.local</span> /{" "}
              <span className="font-mono text-slate-700">admin123</span>
              {" · "}
              <a href="https://github.com/mcgary6567-lab/collaboratmd" target="_blank" rel="noreferrer noopener" className="font-medium text-slate-700 underline decoration-slate-300 underline-offset-4 hover:text-green-700">
                Read the source
              </a>
            </p>
          </div>

          <div className="relative mx-auto mt-16 max-w-5xl">
            <div aria-hidden className="absolute -inset-x-8 -top-6 bottom-8 rounded-[2rem] bg-gradient-to-b from-green-600/10 to-transparent blur-2xl" />
            <div className="relative">
              <AppMockup />
            </div>
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { icon: Zap, title: "Scrubbed and risk-scored", body: `${RULE_IDS.length} rules plus payer edits` },
                { icon: ReceiptText, title: "ERA posted, deposit matched", body: "835 to the line, bank to the ERA" },
                { icon: Send, title: "Appeals in one click", body: "Filled with the claim's details" },
                { icon: ShieldCheck, title: "Amounts never edited", body: "Corrections post as reversals" },
              ].map(({ icon: Icon, title, body }) => (
                <div key={title} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                  <Icon className="h-5 w-5 shrink-0 text-green-600" />
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
          <p className="text-xs font-bold uppercase tracking-widest text-green-600">Inside the live demo environment</p>
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

      {/* ------------------------------------------------- product tour */}
      <section id="platform" className="mx-auto max-w-7xl scroll-mt-20 px-6 py-20 lg:py-28">
        <div className="max-w-2xl">
          <span className="text-xs font-bold uppercase tracking-widest text-green-600">The platform</span>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">Everything between the visit and the deposit</h2>
          <p className="mt-4 text-lg leading-relaxed text-slate-600">
            Most billing problems are caught too late. CollaboratMD moves every check forward, to the moment
            the claim is created, and follows the money all the way to your bank statement.
          </p>
        </div>
        <div className="mt-12">
          <FeatureTour />
        </div>
      </section>

      {/* ------------------------------------------------ intelligence */}
      <section className="relative overflow-hidden bg-slate-950 py-20 text-white lg:py-28">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(50rem_30rem_at_80%_0%,rgba(34,197,94,0.18),transparent)]" />
        <div className="relative mx-auto max-w-7xl px-6">
          <div className="grid gap-12 lg:grid-cols-5">
            <div className="lg:col-span-2">
              <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-green-400">
                <Brain className="h-4 w-4" /> Smart, not reckless
              </span>
              <h2 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">Intelligence that shows its work, and keeps patient data home</h2>
              <p className="mt-4 text-lg leading-relaxed text-slate-300">
                Every suggestion comes with its reasons. Where AI is used, it is given codes, not people:
                names, dates of birth and member IDs are filled in on our side after the AI has answered.
              </p>
              <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-5">
                <p className="flex items-center gap-2 text-sm font-semibold text-green-300"><EyeOff className="h-4 w-4" /> What the AI never sees</p>
                <p className="mt-2 text-sm leading-relaxed text-slate-300">
                  Patient names, dates of birth, member IDs or addresses, for denial explanations, appeals and data imports.
                  Visit notes, which do contain patient information, are sent only if the practice turns that on after signing a BAA.
                </p>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:col-span-3">
              {SMART.map(({ icon: Icon, title, body }) => (
                <div key={title} className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 transition-colors hover:border-green-400/40 hover:bg-white/[0.07]">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-green-500/15 text-green-300"><Icon className="h-5 w-5" /></span>
                  <h3 className="mt-4 font-bold">{title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-300">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ capabilities */}
      <section id="features" className="mx-auto max-w-7xl scroll-mt-20 px-6 py-20 lg:py-28">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="max-w-2xl">
            <span className="text-xs font-bold uppercase tracking-widest text-green-600">Everything included</span>
            <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">One system instead of six</h2>
            <p className="mt-4 text-lg leading-relaxed text-slate-600">
              Eligibility, coding, claims, remittance, patient payments and reporting share one ledger, so nothing is
              re-keyed and every dollar can be traced.
            </p>
          </div>
          <p className="text-sm text-slate-500">
            <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-medium">needs …</span> = connect the practice&apos;s own account
          </p>
        </div>
        <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map(({ group, icon: Icon, items }) => (
            <div key={group} className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex items-center gap-2">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-green-50 text-green-600"><Icon className="h-4.5 w-4.5" /></span>
                <h3 className="font-bold text-slate-900">{group}</h3>
              </div>
              <ul className="mt-4 space-y-2.5">
                {items.map((c) => (
                  <li key={c.name} className="text-sm leading-snug text-slate-700">
                    <span className="mr-1.5 text-green-600">✓</span>
                    {c.name}
                    {c.needs && <span className="ml-1 whitespace-nowrap rounded border border-slate-200 bg-slate-50 px-1 py-px text-[10px] font-medium text-slate-500">needs {c.needs}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* ----------------------------------------------------- workflow */}
      <section id="workflow" className="scroll-mt-20 border-y border-slate-200 bg-slate-50 py-20 lg:py-28">
        <div className="mx-auto max-w-7xl px-6">
          <div className="max-w-2xl">
            <span className="text-xs font-bold uppercase tracking-widest text-green-600">How it works</span>
            <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">One loop, start to finish</h2>
            <p className="mt-4 text-lg leading-relaxed text-slate-600">
              Every screen sits somewhere on this path, and nothing is a dead end: a denial becomes an appeal or a
              corrected claim, a balance becomes a statement, a payment or a plan.
            </p>
          </div>
          <ol className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {WORKFLOW.map(({ icon: Icon, title, body }, i) => (
              <li key={title} className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 transition-shadow hover:shadow-lg hover:shadow-slate-900/5">
                <span aria-hidden className="absolute -right-2 -top-4 font-mono text-7xl font-black text-slate-100 transition-colors group-hover:text-green-50">{String(i + 1).padStart(2, "0")}</span>
                <span className="relative inline-flex h-11 w-11 items-center justify-center rounded-xl bg-slate-900 text-white transition-colors group-hover:bg-green-600">
                  <Icon className="h-5 w-5" />
                </span>
                <h3 className="relative mt-4 text-base font-bold text-slate-900">{title}</h3>
                <p className="relative mt-1.5 text-sm leading-relaxed text-slate-600">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* --------------------------------------------------- calculator */}
      <section id="calculator" className="mx-auto max-w-7xl scroll-mt-20 px-6 py-20 lg:py-28">
        <div className="max-w-2xl">
          <span className="text-xs font-bold uppercase tracking-widest text-green-600">Denial cost calculator</span>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">What are denials costing you?</h2>
          <p className="mt-4 text-lg leading-relaxed text-slate-600">
            Move the sliders to your practice&apos;s numbers. The arithmetic is shown under the result, and nothing you enter leaves this page.
          </p>
        </div>
        <div className="mt-12">
          <DenialCalculator />
        </div>
      </section>

      {/* --------------------------------------------------- benchmarks */}
      <section id="benchmarks" className="border-t border-slate-200 bg-slate-50">
        <div className="mx-auto grid max-w-7xl gap-14 px-6 py-20 lg:grid-cols-2 lg:items-center lg:py-28">
          <div>
            <span className="text-xs font-bold uppercase tracking-widest text-green-600">Benchmarks</span>
            <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">Numbers with a point of comparison</h2>
            <p className="mt-4 text-lg leading-relaxed text-slate-600">
              A dashboard that reports 51 days in A/R without saying whether that is good is just trivia. Every headline
              metric is shown against the industry target and colored accordingly. With email connected, a summary arrives every Monday.
            </p>
            <Link href="/login" className="btn mt-8 bg-green-600 px-6 py-3 text-base text-white hover:bg-green-700">
              See it on a full-size demo practice <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
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

      {/* ------------------------------------- standards, security, integrations */}
      <section id="standards" className="border-t border-slate-200 bg-slate-900 py-20 text-white lg:py-28">
        <div className="mx-auto max-w-7xl px-6">
          <div className="grid gap-14 lg:grid-cols-2">
            <div>
              <span className="text-xs font-bold uppercase tracking-widest text-green-400">Standards and security</span>
              <h2 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">Built on the formats payers actually use</h2>
              <p className="mt-4 text-lg leading-relaxed text-slate-300">
                Claims, eligibility, status inquiries, acknowledgments and remittances are generated and parsed as real ASC X12
                transactions, and EHR and lab traffic as HL7 v2, all covered by segment-level tests.
              </p>
              <ul className="mt-8 grid gap-3 sm:grid-cols-2">
                {SECURITY.map(({ icon: Icon, text }) => (
                  <li key={text} className="flex items-start gap-2.5 text-sm text-slate-200">
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-green-400" /> {text}
                  </li>
                ))}
              </ul>
              <Link href="/security" className="mt-8 inline-flex items-center gap-1.5 text-sm font-semibold text-green-300 hover:text-green-200">
                How we protect patient data <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            <div className="space-y-8">
              <ul className="grid gap-3 sm:grid-cols-2">
                {STANDARDS.map((s) => (
                  <li key={s} className="rounded-xl border border-white/10 bg-white/5 px-4 py-3.5 text-sm font-medium text-slate-200">{s}</li>
                ))}
              </ul>
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Connects to, with your own account, from one settings screen</p>
                <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                  {CONNECTS.map((c) => (
                    <li key={c.name} className="rounded-xl border border-white/10 px-4 py-3">
                      <div className="text-sm font-semibold text-white">{c.name}</div>
                      <div className="text-xs text-slate-400">{c.what}</div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------- cta */}
      <section className="mx-auto max-w-7xl px-6 py-20 lg:py-28">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-green-700 via-green-600 to-emerald-500 px-8 py-16 text-center lg:px-16">
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(30rem_20rem_at_50%_0%,rgba(255,255,255,0.18),transparent)]" />
          <div className="relative">
            <h2 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">Walk the whole revenue cycle</h2>
            <p className="mx-auto mt-4 max-w-2xl text-lg leading-relaxed text-green-50">
              The demo runs on a full-size synthetic practice: 100 providers, 15,000 patients and 105,000 claims that have been
              scrubbed, submitted, adjudicated by a simulated payer, denied and appealed, with bank deposits and collection accounts to work through.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link href="/login" className="inline-flex items-center gap-2 rounded-lg bg-white px-6 py-3 text-base font-bold text-green-700 transition-colors hover:bg-green-50">
                Open the demo <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/contact" className="inline-flex items-center gap-2 rounded-lg border border-white/40 px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-white/10">
                Talk to us
              </Link>
            </div>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
