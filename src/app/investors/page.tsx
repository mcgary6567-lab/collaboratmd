import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity, ArrowRight, BadgeCheck, Binary, Boxes, CircleCheck, Database, FileCheckCorner,
  Gauge, Landmark, Layers, ChartLine, Lock, Radar, Repeat, ScanLine, ShieldCheck,
  ArrowUpRight, Compass, Mail, MessageCircle, Network, ChartPie, Plug, Sparkles, Timer, TrendingUp, Users, Workflow,
} from "lucide-react";
import { RULE_IDS } from "@/lib/scrub/rules";
import { demoLink } from "@/lib/demo";
import { getSession } from "@/lib/auth";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Prose } from "@/components/page-shell";
import { COMPANY, addressLine, whatsappLink } from "@/content/company";
import { publicMetrics } from "@/server/public-metrics";
import { compactMoney, pct } from "@/components/kpi";
import Image from "next/image";
import {
  TEAM, TRACTION, RAISE, MARKET, LANDSCAPE, DIFFERENTIATORS,
  marketTier, privatePracticePhysicians, subscriptionTam,
} from "@/content/investors";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Investors",
  description:
    "CollaboratMD for healthcare IT investors: what is built, how it performs against every industry benchmark, how the business earns, and how to reach us.",
};

/* ------------------------------------------------------------------ content */

const PROOF = [
  {
    icon: Binary,
    title: "Native X12, not a conversion layer",
    body: "Generates professional, facility and dental claims, eligibility, claim status and prior authorization requests, and parses the acknowledgments, responses and 835 remittances that come back, with CARC and RARC codes preserved on every service line. Segment-level tests catch a change that would alter a segment before it ships.",
    tag: "837P · 837I · 837D · 835 · 270/271 · 276/277 · 278 · 999 · 277CA",
  },
  {
    icon: ScanLine,
    title: "Validation moved to the desk",
    body: `${RULE_IDS.length} built-in rules run on every claim as it is created (NPI check digits, diagnosis pointers, place of service, timely filing), plus payer-specific edits a practice configures, including prior authorization. An error caught at entry costs seconds; the same error caught on a remittance costs an appeal and a month of aging.`,
    tag: `${RULE_IDS.length} built-in rules plus payer edits`,
  },
  {
    icon: Lock,
    title: "Amounts are never edited",
    body: "A financial correction posts as a reversal, never as an edit to a posted amount, so the money trail reads forward and reconciles to the cent. Payer recoupments post the same way. This is very hard to retrofit into a platform that did not start with it.",
    tag: "Audit-grade by construction",
  },
  {
    icon: ChartLine,
    title: "Analytics anchored to benchmarks",
    body: "Every headline metric is reported against its industry target rather than floating without context. Aggregation happens in SQL, so reporting stays fast as the ledger grows into the millions of rows.",
    tag: "SQL aggregation at scale",
  },
  {
    icon: Plug,
    title: "Interfaces, not re-keying",
    body: "HL7 v2 over HTTPS and FHIR with SMART backend services bring patients and finished visits in from an EHR, and lab results back from a lab; lab orders go out as HL7. A practice switching systems imports its patient list from any CSV export, with the columns matched for it.",
    tag: "HL7 ADT · DFT · ORM · ORU · FHIR R4",
  },
  {
    icon: Landmark,
    title: "The deadlines a practice is held to, tracked for it",
    body: "The rules that cost practices money when a date slips run as software: Medicare and Medicaid's 60-day overpayment return, No Surprises Act dispute windows, appeal levels, state prompt-pay interest, HIPAA record requests and accountings of disclosures, unclaimed patient credits, payer contract notice dates, and records requests from auditors. The practice's own controls run the same way: a month-end close that locks the month, internal coding audits, and write-offs that record why.",
    tag: "Compliance as workflow",
  },
  {
    icon: Radar,
    title: "National code sets, applied by date of service",
    body: "CMS's yearly and quarterly files load as data: ICD-10-CM with its addenda, HCPCS, NCCI edits, the physician fee schedule, the telehealth list, the HCC mapping and the Medicare ordering and referring file. Each claim is checked against the rules in force on its date of service, so the October 1 code change is a report to work, not a scramble.",
    tag: "ICD-10-CM · HCPCS · NCCI · MPFS · HCC",
  },
  {
    icon: Lock,
    title: "Books that stay closed",
    body: "A closed month is locked in the database itself: no entry can be dated into it, so the figures a practice sent its accountant cannot drift. Each month's A/R rollforward is computed two ways and must agree to the cent, and every write-off records its reason, so avoidable losses are separated from contractual adjustments.",
    tag: "Month-end close · A/R rollforward",
  },
  {
    icon: Users,
    title: "Clean data from the front desk on",
    body: "Duplicate patient records are found and merged with every row moved, discovered from the schema so new tables are never missed. Rejections and denials caused by registration are traced to the field that was wrong and the person who entered it, which turns a denial problem into a training list.",
    tag: "Patient identity · registration quality",
  },
  {
    icon: Landmark,
    title: "From the claim to the cash drawer",
    body: "The same ledger runs the daily cash close, agency recoveries with their commissions booked apart, family accounts, missed-appointment fees and provider compensation, so a practice does not keep side spreadsheets for the money that never touches a claim. Rules that protect patients, such as QMB billing protection, are enforced on every statement and collection.",
    tag: "Cash close · agencies · provider pay · QMB",
  },
  {
    icon: ShieldCheck,
    title: "The legal edge cases, built in",
    body: "Bankruptcy stays, deceased patients' estates, returned mail, adult children on a parent's account and HIPAA privacy complaints are handled in the product rather than by staff memory. Each one stops the wrong bill or letter before it goes out, which is where small practices get complaints and fines.",
    tag: "Bankruptcy · estates · privacy complaints",
  },
  {
    icon: CircleCheck,
    title: "Payer rules that are easy to miss",
    body: "Locum tenens and reciprocal billing, HMO referral numbers, therapy plans of care and the yearly other-insurance question are each a common cause of denials that a generic billing system leaves to staff. Here each one is a check on the claim before it goes out.",
    tag: "Q5/Q6 · REF*9F · plans of care · COB",
  },
  {
    icon: Users,
    title: "Made for billing companies with offshore teams",
    body: "Billing companies commonly staff overnight teams abroad to work US claims during the US day. Shifts in each biller's own time zone and holiday calendar, approved time off that reroutes the work queues, shift swaps and open shifts, handovers, approved weekly timesheets, daily targets, quality sampling of each biller's work, training records, a staffing forecast and a payroll worksheet with overtime, night and holiday pay make that model run inside the product instead of in spreadsheets and chat.",
    tag: "Shifts · time zones · holidays · overtime · productivity",
  },
  {
    icon: Repeat,
    title: "Built to stay current",
    body: "Billing rules change every quarter by regulation. Code sets load as data on a tracked CMS calendar, every HIPAA transaction version lives in one registry, and dependency, security and runtime checks run automatically, so most yearly changes are a file load rather than a software project.",
    tag: "Code-set calendar · X12 registry · maintenance checks",
  },
  {
    icon: Network,
    title: "Built for the billing company",
    body: "One login across every client practice, a side-by-side view of each one's collections and aged A/R, contract-based underpayment detection, online patient check-in and good faith estimates: the work a billing company is paid to do.",
    tag: "Multi-practice by design",
  },
];

/** Shown in full first: what is hardest to copy and what the buyer pays for. */
const FEATURED = [
  "Native X12, not a conversion layer",
  "Validation moved to the desk",
  "Amounts are never edited",
  "Built for the billing company",
  "Made for billing companies with offshore teams",
  "Built to stay current",
];

/** In-page sections, for the bar that stays under the header. */
const SECTIONS = [
  { id: "benchmarks", label: "Benchmarks" },
  { id: "product", label: "Product" },
  { id: "market", label: "Market" },
  { id: "landscape", label: "Landscape" },
  { id: "model", label: "Business model" },
  { id: "contact", label: "Data room" },
];

const ENGINEERING = [
  { icon: Database, label: "Postgres with bundled migrations", detail: "Ships inside the build, so serverless deploys never read schema off a disk" },
  { icon: Timer, label: "Reporting computed in SQL", detail: "No row ever leaves the database to be summed in the application" },
  { icon: Layers, label: "Typed end to end", detail: "TypeScript strict, Drizzle ORM, server components and server actions" },
  { icon: ShieldCheck, label: "Tested on every change", detail: "Hundreds of unit tests against a migrated database, X12 and HL7 checked segment by segment, and end-to-end runs of the built app" },
  { icon: Gauge, label: "Load-tested at 100,000 claims", detail: "Every report and the full claim check timed on real Postgres behind a connection pooler, with a budget per query" },
  { icon: BadgeCheck, label: "Accessible on desktop and phone", detail: "Every signed-in screen checked against WCAG 2.1 AA at both sizes on every change" },
  { icon: Radar, label: "Denial intelligence", detail: "CARC and RARC preserved per line, ranked by dollars at risk" },
  { icon: Workflow, label: "Full lifecycle modeled", detail: "Eligibility, charge capture, scrub, submit, deny, appeal, post; payer adjudication simulated in the demo" },
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
    icon: BadgeCheck,
    title: "Switching is rare, so retention is structural",
    body: "A practice changes billing systems roughly as often as it changes banks. That cuts both ways, which is why the product has to win on numbers a practice already tracks.",
  },
];

const DATA_ROOM = [
  "Operating model and use of funds",
  "Capitalization table and prior instruments",
  "Pricing model and contract terms",
  "Architecture review, security posture and HIPAA documentation",
  "Product roadmap and engineering plan",
  "The hiring plan the round funds",
];

/* ------------------------------------------------------------ small pieces */

/** A benchmark result. `pass` drives the whole visual, so it is computed, never set. */
function Benchmark({
  icon: Icon,
  metric,
  value,
  target,
  pass,
  note,
}: {
  icon: React.ComponentType<{ className?: string }>;
  metric: string;
  value: string;
  target: string;
  pass: boolean;
  note: string;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border p-6 transition-shadow hover:shadow-lg hover:shadow-slate-900/5 ${
        pass ? "border-green-200 bg-white" : "border-amber-200 bg-white"
      }`}
    >
      <div
        aria-hidden
        className={`absolute inset-x-0 top-0 h-1 ${pass ? "bg-green-500" : "bg-amber-500"}`}
      />
      <div className="flex items-start justify-between gap-3">
        <span
          className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ${
            pass ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-600"
          }`}
        >
          <Icon className="h-5 w-5" />
        </span>
        {pass && (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-1 text-[11px] font-bold text-green-700">
            <CircleCheck className="h-3 w-3" /> MEETS TARGET
          </span>
        )}
      </div>
      <div className="mt-4 text-xs font-bold uppercase tracking-widest text-slate-500">{metric}</div>
      <div className={`mt-1 text-3xl font-extrabold tracking-tight ${pass ? "text-green-700" : "text-amber-700"}`}>
        {value}
      </div>
      <div className="mt-1.5 text-sm font-medium text-slate-600">{target}</div>
      <div className="mt-2 text-xs leading-relaxed text-slate-500">{note}</div>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="text-3xl font-extrabold tracking-tight text-white lg:text-4xl">{value}</div>
      <div className="mt-1.5 text-sm leading-snug text-green-50/90">{label}</div>
    </div>
  );
}

/* -------------------------------------------------------------------- page */

export default async function InvestorsPage() {
  const [session, m] = await Promise.all([getSession(), publicMetrics()]);

  return (
    <div className="min-h-screen bg-white">
      <SiteHeader signedIn={!!session} />

      {/* ------------------------------------------------------------ hero */}
      <section className="relative overflow-hidden border-b border-slate-200 bg-slate-50">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(55rem_28rem_at_50%_-10rem,rgba(22,163,74,0.18),transparent)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-green-500/50 to-transparent"
        />
        <div className="relative mx-auto max-w-5xl px-6 py-16 text-center lg:py-24">
          <span className="inline-flex items-center gap-2 rounded-full border border-green-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-green-700">
            <Sparkles className="h-3.5 w-3.5" />
            For health IT, digital health and SMB software investors
          </span>
          <h1 className="mt-6 text-4xl font-extrabold leading-[1.1] tracking-tight text-slate-900 sm:text-5xl lg:text-6xl">
            Revenue cycle software,
            <br />
            built like infrastructure
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-slate-600">
            Practices do not mostly lose money because collections are hard. They lose it to
            preventable errors that surface weeks later as denials. CollaboratMD moves the checks to
            the moment the claim is created and makes the money trail auditable end to end.
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/contact?topic=investor" className="btn bg-green-700 px-6 py-3 text-base text-white hover:bg-green-800">
              Request the data room <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href={demoLink().href} className="btn btn-secondary px-6 py-3 text-base">
              {demoLink().open ? "Open the live product" : "Book a product demo"}
            </Link>
          </div>
          <dl className="mx-auto mt-14 grid max-w-4xl grid-cols-2 gap-px overflow-hidden rounded-2xl border border-slate-200 bg-slate-200 text-left lg:grid-cols-4">
            {[
              { value: String(RULE_IDS.length), label: "Checks on every claim before it is sent" },
              { value: "9", label: "HIPAA X12 transaction types, generated and parsed natively" },
              { value: "1", label: "Login across every client practice of a billing company" },
              ...(m ? [{ value: m.claimCount.toLocaleString("en-US"), label: "Claims in the live demo, through the full lifecycle" }] : []),
            ].map((f) => (
              <div key={f.label} className="flex flex-col-reverse bg-white p-5">
                <dt className="mt-1 text-xs leading-snug text-slate-600">{f.label}</dt>
                <dd className="text-3xl font-extrabold tracking-tight text-slate-900">{f.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ------------------------------------------------- section bar */}
      <nav aria-label="On this page" className="sticky top-16 z-40 border-b border-slate-200 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-6 py-2 text-sm">
          {SECTIONS.map((x) => (
            <a key={x.id} href={`#${x.id}`} className="whitespace-nowrap rounded-lg px-3 py-1.5 font-medium text-slate-600 transition-colors hover:bg-green-50 hover:text-green-800">
              {x.label}
            </a>
          ))}
        </div>
      </nav>

      {/* -------------------------------------------- live benchmark scorecard */}
      {m && (
        <section id="benchmarks" className="mx-auto max-w-7xl scroll-mt-32 px-6 py-16 lg:py-24">
          <div className="mx-auto max-w-2xl text-center">
            <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-green-700">
              <Activity className="h-3.5 w-3.5" /> Computed live from the demo environment
            </span>
            <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
              Every benchmark, computed live
            </h2>
            <p className="mt-4 text-[15px] leading-relaxed text-slate-600">
              These figures are calculated from the database each time this page loads, over a
              synthetic practice of {m.claimCount.toLocaleString("en-US")} claims that carries no
              patient information. They show the software computing revenue cycle benchmarks
              correctly at production volume. The outcomes reflect how the demo data was generated,
              so they are not results at a customer.
            </p>
          </div>

          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <Benchmark
              icon={Timer}
              metric="Days in A/R"
              value={String(m.daysInAr)}
              target="Industry target: under 40 days"
              pass={m.daysInAr < 40}
              note="How long revenue sits uncollected after the visit."
            />
            <Benchmark
              icon={TrendingUp}
              metric="Net collection rate"
              value={m.netCollectionRate === null ? "n/a" : pct(m.netCollectionRate)}
              target="Industry target: 95% or better"
              pass={(m.netCollectionRate ?? 0) >= 0.95}
              note="Share of collectible revenue actually collected."
            />
            <Benchmark
              icon={BadgeCheck}
              metric="Clean claim rate"
              value={pct(m.cleanClaimRate)}
              target="Industry target: 95% or better"
              pass={m.cleanClaimRate >= 0.95}
              note="Accepted on first submission, without rework."
            />
            <Benchmark
              icon={Gauge}
              metric="Denial rate"
              value={pct(m.denialRate)}
              target="Industry target: under 5%"
              pass={m.denialRate < 0.05}
              note="Adjudicated claims the payer refused to pay."
            />
            <Benchmark
              icon={Activity}
              metric="First pass yield"
              value={pct(m.firstPassYield)}
              target="Paid without intervention"
              pass={m.firstPassYield >= 0.85}
              note="Claims that reached paid with no human rework."
            />
            <Benchmark
              icon={Landmark}
              metric="Denials recovered"
              value={compactMoney(m.recoveredCents)}
              target={`${m.recoveredDenials.toLocaleString("en-US")} appeals overturned`}
              pass={m.recoveredDenials > 0}
              note="Revenue returned that a practice would otherwise write off."
            />
          </div>
        </section>
      )}

      {/* ------------------------------------------------------ scale band */}
      {m && (
        <section className="bg-gradient-to-br from-green-700 via-green-600 to-green-500">
          <div className="relative mx-auto max-w-7xl px-6 py-14">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(30rem_16rem_at_50%_0%,rgba(255,255,255,0.16),transparent)]"
            />
            <div className="relative">
              <p className="text-xs font-bold uppercase tracking-widest text-green-50/80">
                Exercised at production volume
              </p>
              <div className="mt-7 grid grid-cols-2 gap-8 lg:grid-cols-4">
                <Stat value={m.claimCount.toLocaleString("en-US")} label="Claims through the full lifecycle" />
                <Stat value={compactMoney(m.chargesCents)} label="Billed charges, trailing 12 months" />
                <Stat
                  value={compactMoney(m.insurancePaidCents + m.patientPaidCents)}
                  label="Collections posted, trailing 12 months"
                />
                <Stat value={m.ledgerEntryCount.toLocaleString("en-US")} label="Append-only ledger entries" />
                <Stat value={m.providerCount.toLocaleString("en-US")} label={`Providers across ${m.specialtyCount} specialties`} />
                <Stat value={m.patientCount.toLocaleString("en-US")} label="Patients in 50 metro areas" />
                <Stat value={m.payerCount.toLocaleString("en-US")} label="Payers with distinct filing rules" />
                <Stat value={String(RULE_IDS.length)} label="Built-in rules on every claim" />
              </div>
              <p className="mt-8 max-w-3xl text-sm leading-relaxed text-green-50/85">
                This is the demo environment, a complete practice dataset rather than a handful of
                sample rows, and it carries no patient information. Its purpose is to prove the
                system performs at the volume a real customer brings.
              </p>
              <Link
                href={demoLink().href}
                className="mt-7 inline-flex items-center gap-2 rounded-lg bg-white px-6 py-3 text-sm font-bold text-green-700 transition-colors hover:bg-green-50"
              >
                Open it yourself <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* -------------------------------------------------------- traction */}
      {TRACTION.length > 0 && (
        <section className="mx-auto max-w-7xl px-6 pt-16 lg:pt-24">
          <div className="mx-auto max-w-2xl text-center">
            <span className="text-xs font-bold uppercase tracking-widest text-green-700">Traction</span>
            <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
              Where we are today
            </h2>
          </div>
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {TRACTION.map((t) => (
              <div key={t.label} className="rounded-2xl border border-slate-200 bg-white p-6">
                <div className="text-xl font-extrabold tracking-tight text-green-700">{t.label}</div>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{t.detail}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ---------------------------------------------------------- proof */}
      <section id="product" className="mx-auto max-w-7xl scroll-mt-32 px-6 py-16 lg:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-xs font-bold uppercase tracking-widest text-green-700">The product</span>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
            What is actually built
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-slate-600">
            Every item below is running software you can open today, not a roadmap item.
          </p>
        </div>

        <div className="mt-12 grid gap-6 md:grid-cols-2">
          {PROOF.filter((p) => FEATURED.includes(p.title)).sort((a, b) => FEATURED.indexOf(a.title) - FEATURED.indexOf(b.title)).map(({ icon: Icon, title, body, tag }) => (
            <div
              key={title}
              className="group rounded-2xl border border-slate-200 bg-white p-7 transition-shadow hover:shadow-lg hover:shadow-slate-900/5"
            >
              <div className="flex items-center gap-4">
                <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-green-50 text-green-700 transition-colors group-hover:bg-green-700 group-hover:text-white">
                  <Icon className="h-5 w-5" />
                </span>
                <div>
                  <h3 className="text-base font-bold text-slate-900">{title}</h3>
                  <span className="mt-0.5 block font-mono text-[11px] text-green-700">{tag}</span>
                </div>
              </div>
              <p className="mt-4 text-sm leading-relaxed text-slate-600">{body}</p>
            </div>
          ))}
        </div>

        <h3 className="mt-14 text-center text-xs font-bold uppercase tracking-widest text-slate-500">Also built and running</h3>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PROOF.filter((p) => !FEATURED.includes(p.title)).map(({ icon: Icon, title, body, tag }) => (
            <details key={title} className="group rounded-2xl border border-slate-200 bg-white p-5 open:shadow-lg open:shadow-slate-900/5">
              <summary className="flex cursor-pointer list-none items-start gap-3 [&::-webkit-details-marker]:hidden">
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-green-50 text-green-700"><Icon className="h-4 w-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold text-slate-900">{title}</span>
                  <span className="mt-0.5 block font-mono text-[11px] text-green-700">{tag}</span>
                </span>
                <span aria-hidden className="text-lg leading-none text-slate-400 transition-transform group-open:rotate-45">+</span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-slate-600">{body}</p>
            </details>
          ))}
        </div>

        {/* engineering strip */}
        <div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-7">
          <div className="flex items-center gap-2">
            <Boxes className="h-4 w-4 text-green-700" />
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">
              Underneath it
            </h3>
          </div>
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {ENGINEERING.map(({ icon: Icon, label, detail }) => (
              <div key={label} className="flex gap-3">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-green-700" />
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900">{label}</div>
                  <div className="mt-0.5 text-xs leading-relaxed text-slate-600">{detail}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- market */}
      <section id="market" className="scroll-mt-32 border-y border-slate-200 bg-slate-50 py-16 lg:py-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <span className="text-xs font-bold uppercase tracking-widest text-green-700">The market</span>
            <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
              Why this segment
            </h2>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {WHY_NOW.map(({ icon: Icon, title, body }) => (
              <div key={title} className="rounded-2xl border border-slate-200 bg-white p-7">
                <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-green-50 text-green-700">
                  <Icon className="h-5 w-5" />
                </span>
                <h3 className="mt-4 text-base font-bold text-slate-900">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------- market size */}
      <section className="mx-auto max-w-7xl px-6 py-16 lg:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-green-700">
            <ChartPie className="h-3.5 w-3.5" /> Market size
          </span>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
            {compactMoney(subscriptionTam() * 100)} a year, in subscriptions alone
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-slate-600">
            A bottom-up count of who could buy, priced at our own list rate rather than lifted from
            an industry report.
          </p>
        </div>

        <div className="mt-12 grid items-center gap-4 lg:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr]">
          {[
            {
              value: MARKET.patientCarePhysicians.toLocaleString("en-US"),
              label: "Physicians in direct patient care in the United States",
            },
            { op: "\u00d7" },
            {
              value: pct(MARKET.privatePracticeShare),
              label: `In private practice, or ${privatePracticePhysicians().toLocaleString("en-US")} physicians`,
            },
            { op: "\u00d7" },
            {
              value: `$${((marketTier().priceMonthly ?? 0) * 12).toLocaleString("en-US")}`,
              label: `Per provider per year on ${marketTier().name}, at monthly list price`,
            },
            { op: "=" },
            {
              value: compactMoney(subscriptionTam() * 100),
              label: "Annual subscription revenue across the addressable base",
              result: true,
            },
          ].map((step, i) =>
            "op" in step ? (
              <div key={i} className="text-center text-2xl font-bold text-slate-300">
                {step.op}
              </div>
            ) : (
              <div
                key={i}
                className={`rounded-2xl border p-6 text-center ${
                  step.result ? "border-green-600 bg-green-50" : "border-slate-200 bg-white"
                }`}
              >
                <div
                  className={`text-3xl font-extrabold tracking-tight ${
                    step.result ? "text-green-700" : "text-slate-900"
                  }`}
                >
                  {step.value}
                </div>
                <div className="mt-2 text-sm leading-snug text-slate-600">{step.label}</div>
              </div>
            ),
          )}
        </div>

        <div className="mt-10 grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
            <h3 className="text-sm font-bold text-slate-900">What it leaves out</h3>
            <ul className="mt-3 space-y-2 text-sm leading-relaxed text-slate-600">
              <li>
                Nurse practitioners, physician assistants and therapists who bill under their own
                NPI. Plans are priced per rendering provider, so they are customers too.
              </li>
              <li>The per-claim transaction line, which is charged on top of every subscription.</li>
            </ul>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
            <h3 className="text-sm font-bold text-slate-900">What it assumes</h3>
            <ul className="mt-3 space-y-2 text-sm leading-relaxed text-slate-600">
              <li>
                Every private-practice physician as a customer at monthly list price. Annual billing
                lowers realized revenue by about 17%.
              </li>
              <li>
                The private-practice share from one survey applied to the physician count from
                another, a standard approximation for a sizing figure.
              </li>
            </ul>
          </div>
        </div>

        <p className="mt-6 text-center text-xs leading-relaxed text-slate-500">
          Sources:{" "}
          <a href={MARKET.patientCareSource.url} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2 hover:text-green-700">
            {MARKET.patientCareSource.label}
          </a>
          {"; "}
          <a href={MARKET.privatePracticeSource.url} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2 hover:text-green-700">
            {MARKET.privatePracticeSource.label}
          </a>
          .
        </p>
      </section>

      {/* ------------------------------------------------------ landscape */}
      <section id="landscape" className="scroll-mt-32 border-y border-slate-200 bg-slate-50 py-16 lg:py-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-green-700">
              <Compass className="h-3.5 w-3.5" /> Where we fit
            </span>
            <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
              Two ways the market is served today, and a third
            </h2>
          </div>

          <div className="mt-12 grid gap-6 lg:grid-cols-3">
            {LANDSCAPE.map((c) => (
              <div key={c.kind} className="rounded-2xl border border-slate-200 bg-white p-7">
                <h3 className="text-base font-bold text-slate-900">{c.kind}</h3>
                <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {c.examples}
                </p>
                <p className="mt-4 text-sm leading-relaxed text-slate-600">{c.approach}</p>
              </div>
            ))}
            <div className="rounded-2xl border-2 border-green-600 bg-white p-7 shadow-lg shadow-green-900/5">
              <h3 className="text-base font-bold text-slate-900">Billing-first</h3>
              <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-green-700">
                CollaboratMD
              </p>
              <ul className="mt-4 space-y-2.5">
                {DIFFERENTIATORS.map((d) => (
                  <li key={d} className="flex gap-2.5 text-sm leading-relaxed text-slate-700">
                    <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-green-700" />
                    {d}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <p className="mx-auto mt-8 max-w-3xl text-center text-xs leading-relaxed text-slate-500">
            Competitor descriptions reflect each company&apos;s public positioning. Product names
            are trademarks of their owners and are used here only to describe the market.
          </p>
        </div>
      </section>

      {/* ------------------------------------------------- model and the ask */}
      <section id="model" className="mx-auto max-w-3xl scroll-mt-32 px-6 py-16 lg:py-24">
        <Prose>
          <h2>How the business earns</h2>
          <p>
            Revenue cycle software monetizes in two places, and both scale with the customer rather
            than with headcount on our side. The first is a recurring subscription per provider,
            which grows as a practice adds clinicians. The second is transaction-based, tied to claim
            volume, which grows as the practice sees more patients. Because the product sits in the
            path of the money on every encounter, usage and value move together, and the customer
            can see the return in metrics they already track.
          </p>
          <p>
            List pricing is public on the pricing page; contract terms and the operating model are in
            the data room.
          </p>

          <h2>What we are looking for</h2>
          <p>
            We are talking with investors focused on <strong>health IT</strong>,{" "}
            <strong>digital health</strong> and <strong>SMB software</strong>, and we prefer partners
            who have taken a billing, payments or claims business through the stage ahead of us.
            Regulatory literacy matters more here than in most software categories. A partner who
            already understands HIPAA obligations, payer contracting and clearinghouse economics is
            useful in the room, not just on the cap table.
          </p>
        </Prose>
      </section>

      {/* ------------------------------------------------------ the round */}
      {RAISE && (
        <section className="mx-auto max-w-3xl px-6 pb-16">
          <div className="rounded-2xl border border-green-200 bg-green-50/60 p-7">
            <div className="text-xs font-bold uppercase tracking-widest text-green-700">The round</div>
            <div className="mt-2 text-3xl font-extrabold tracking-tight text-slate-900">{RAISE.amount}</div>
            <div className="mt-1 text-sm text-slate-600">{RAISE.instrument}</div>
            <div className="mt-6 space-y-3">
              {RAISE.useOfFunds.map((u) => (
                <div key={u.label}>
                  <div className="flex justify-between text-sm">
                    <span className="font-medium text-slate-700">{u.label}</span>
                    <span className="font-semibold text-green-700">{Math.round(u.share * 100)}%</span>
                  </div>
                  <div className="mt-1.5 h-2 rounded-full bg-white">
                    <div className="h-2 rounded-full bg-green-600" style={{ width: `${u.share * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ----------------------------------------------------------- team */}
      {TEAM.length > 0 && (
        <section className="mx-auto max-w-7xl px-6 pb-16 lg:pb-24">
          <div className="mx-auto max-w-2xl text-center">
            <span className="text-xs font-bold uppercase tracking-widest text-green-700">The team</span>
            <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
              Who is building it
            </h2>
          </div>
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {TEAM.map((person) => (
              <div key={person.name} className="rounded-2xl border border-slate-200 bg-white p-7">
                <div className="flex items-center gap-4">
                  {person.photo ? (
                    <Image
                      src={person.photo}
                      alt={person.name}
                      width={56}
                      height={56}
                      className="h-14 w-14 rounded-full object-cover"
                    />
                  ) : (
                    <span className="flex h-14 w-14 items-center justify-center rounded-full bg-green-700 text-lg font-bold text-white">
                      {person.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
                    </span>
                  )}
                  <div>
                    <div className="text-base font-bold text-slate-900">{person.name}</div>
                    <div className="text-sm text-green-700">{person.role}</div>
                  </div>
                </div>
                <p className="mt-4 text-sm leading-relaxed text-slate-600">{person.background}</p>
                {person.linkedin && (
                  <a
                    href={person.linkedin}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-green-700 hover:text-green-800"
                  >
                    LinkedIn <ArrowUpRight className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ------------------------------------------------------- data room */}
      <section id="contact" className="mx-auto max-w-7xl scroll-mt-32 px-6 pb-16 lg:pb-24">
        <div className="grid gap-8 rounded-3xl border border-slate-200 bg-white p-8 lg:grid-cols-2 lg:p-10">
          <div>
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-green-50 text-green-700">
              <Landmark className="h-5 w-5" />
            </span>
            <h2 className="mt-4 text-xl font-bold tracking-tight text-slate-900">
              What the data room contains
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">
              Shared under a mutual non-disclosure agreement after an introductory call. Financials,
              pipeline and cap table stay off the public site, where they would be visible to
              competitors and could not be kept current.
            </p>
          </div>
          <ul className="space-y-3.5">
            {DATA_ROOM.map((item) => (
              <li key={item} className="flex gap-3 text-sm leading-relaxed text-slate-700">
                <FileCheckCorner className="mt-0.5 h-4 w-4 shrink-0 text-green-700" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        {/* cta */}
        <div className="relative mt-10 overflow-hidden rounded-3xl bg-gradient-to-br from-green-700 via-green-600 to-green-500 px-8 py-14 text-center lg:px-16">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(30rem_18rem_at_50%_0%,rgba(255,255,255,0.18),transparent)]"
          />
          <div className="relative">
            <h2 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
              Start a conversation
            </h2>
            <p className="mx-auto mt-4 max-w-xl leading-relaxed text-green-50">
              Tell us the fund, the stage you lead and one healthcare company you have backed, and we
              will follow up with the data room.
            </p>
            <div className="mx-auto mt-7 flex max-w-lg flex-col justify-center gap-3 sm:flex-row">
              <a
                href={`mailto:${COMPANY.contact.investors}`}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/40 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-white/10"
              >
                <Mail className="h-4 w-4" /> {COMPANY.contact.investors}
              </a>
              <a
                href={whatsappLink("Hi CollaboratMD, I am an investor and would like the data room.")}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/40 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-white/10"
              >
                <MessageCircle className="h-4 w-4" /> WhatsApp
              </a>
            </div>
            <Link
              href="/contact?topic=investor"
              className="mt-8 inline-flex items-center gap-2 rounded-lg bg-white px-7 py-3.5 text-base font-bold text-green-700 transition-colors hover:bg-green-50"
            >
              Request the data room <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>

        {/* disclosure */}
        <div className="mx-auto mt-10 max-w-3xl rounded-2xl border border-slate-200 bg-slate-50 px-6 py-5">
          <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">
            Important disclosure
          </h3>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">
            This page is provided for information only. It is not an offer to sell, or a
            solicitation of an offer to buy, any security, and it is not a recommendation or a
            promise of any financial return. Any investment would be made solely under definitive
            documents, and investing in a private company carries the risk of losing the entire
            amount invested. Statements about future plans are forward looking and may not come
            about.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">
            {COMPANY.legalName}, {addressLine()}.
          </p>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
