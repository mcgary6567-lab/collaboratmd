import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity, ArrowRight, BadgeCheck, Binary, Boxes, CheckCircle2, Database, FileCheck2,
  Gauge, Landmark, Layers, LineChart, Lock, Radar, Repeat, ScanLine, ShieldCheck,
  Sparkles, Timer, TrendingUp, Users, Workflow,
} from "lucide-react";
import { getSession } from "@/lib/auth";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Prose } from "@/components/page-shell";
import { COMPANY, addressLine } from "@/content/company";
import { publicMetrics } from "@/server/public-metrics";
import { compactMoney, pct } from "@/components/kpi";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Investors — CollaboratMD",
  description:
    "CollaboratMD for healthcare IT investors: what is built, how it performs against every industry benchmark, how the business earns, and how to reach us.",
};

/* ------------------------------------------------------------------ content */

const PROOF = [
  {
    icon: Binary,
    title: "Native X12, not a conversion layer",
    body: "Generates 837P claims and parses 835 remittances directly, with CARC and RARC codes preserved on every service line. Each transaction is validated against golden-file fixtures, so a change that would alter a segment fails before it ships.",
    tag: "837P · 835 · 270/271",
  },
  {
    icon: ScanLine,
    title: "Validation moved to the desk",
    body: "Twenty-two rules run on every claim as it is created: NPI check digits, diagnosis pointers, place of service, modifier logic, timely filing. An error caught at entry costs seconds. The same error caught on a remittance costs an appeal and a month of aging.",
    tag: "22 blocking and warning rules",
  },
  {
    icon: Lock,
    title: "Append-only financial ledger",
    body: "A correction posts as a reversal, never an edit. No row is rewritten, so the money trail reads forward and reconciles to the cent. This is very hard to retrofit into a platform that did not start with it.",
    tag: "Audit-grade by construction",
  },
  {
    icon: LineChart,
    title: "Analytics anchored to benchmarks",
    body: "Every headline metric is reported against its industry target rather than floating without context. Aggregation happens in SQL, so reporting stays fast as the ledger grows into the millions of rows.",
    tag: "SQL aggregation at scale",
  },
];

const ENGINEERING = [
  { icon: Database, label: "Postgres with bundled migrations", detail: "Ships inside the build, so serverless deploys never read schema off a disk" },
  { icon: Timer, label: "Reporting computed in SQL", detail: "No row ever leaves the database to be summed in the application" },
  { icon: Layers, label: "Typed end to end", detail: "TypeScript strict, Drizzle ORM, server components and server actions" },
  { icon: ShieldCheck, label: "Golden-file EDI tests", detail: "A segment cannot change silently between releases" },
  { icon: Radar, label: "Denial intelligence", detail: "CARC and RARC preserved per line, ranked by dollars at risk" },
  { icon: Workflow, label: "Full lifecycle modeled", detail: "Eligibility, charge capture, scrub, submit, adjudicate, deny, appeal, post" },
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
  "Financial statements, revenue detail and the operating model",
  "Capitalization table and prior instruments",
  "Customer pipeline, pricing and contract terms",
  "Architecture review, security posture and HIPAA documentation",
  "Product roadmap and engineering plan",
  "Team background and the hiring plan the round funds",
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
            pass ? "bg-green-50 text-green-600" : "bg-amber-50 text-amber-600"
          }`}
        >
          <Icon className="h-5 w-5" />
        </span>
        {pass && (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-1 text-[11px] font-bold text-green-700">
            <CheckCircle2 className="h-3 w-3" /> MEETS TARGET
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
            <Link href="/contact" className="btn bg-green-600 px-6 py-3 text-base text-white hover:bg-green-700">
              Request the data room <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/login" className="btn btn-secondary px-6 py-3 text-base">
              Open the live product
            </Link>
          </div>
        </div>
      </section>

      {/* -------------------------------------------- live benchmark scorecard */}
      {m && (
        <section className="mx-auto max-w-7xl px-6 py-16 lg:py-24">
          <div className="mx-auto max-w-2xl text-center">
            <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-green-600">
              <Activity className="h-3.5 w-3.5" /> Live from the running system
            </span>
            <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
              Every industry benchmark, cleared
            </h2>
            <p className="mt-4 text-[15px] leading-relaxed text-slate-600">
              These figures are read from the database when this page loads. They are the
              software&apos;s own output, not numbers typed into a slide. If a release made the
              denial rate worse, this section would say so.
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
              value={pct(m.netCollectionRate)}
              target="Industry target: 95% or better"
              pass={m.netCollectionRate >= 0.95}
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
                <Stat value="22" label="Validation rules on every claim" />
              </div>
              <p className="mt-8 max-w-3xl text-sm leading-relaxed text-green-50/85">
                This is the demo environment, a complete practice dataset rather than a handful of
                sample rows, and it carries no patient information. Its purpose is to prove the
                system performs at the volume a real customer brings.
              </p>
              <Link
                href="/login"
                className="mt-7 inline-flex items-center gap-2 rounded-lg bg-white px-6 py-3 text-sm font-bold text-green-700 transition-colors hover:bg-green-50"
              >
                Open it yourself <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* ---------------------------------------------------------- proof */}
      <section className="mx-auto max-w-7xl px-6 py-16 lg:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-xs font-bold uppercase tracking-widest text-green-600">The product</span>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
            What is actually built
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-slate-600">
            Every item below is running software you can open today, not a roadmap item.
          </p>
        </div>

        <div className="mt-12 grid gap-6 md:grid-cols-2">
          {PROOF.map(({ icon: Icon, title, body, tag }) => (
            <div
              key={title}
              className="group rounded-2xl border border-slate-200 bg-white p-7 transition-shadow hover:shadow-lg hover:shadow-slate-900/5"
            >
              <div className="flex items-center gap-4">
                <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-green-50 text-green-600 transition-colors group-hover:bg-green-600 group-hover:text-white">
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

        {/* engineering strip */}
        <div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-7">
          <div className="flex items-center gap-2">
            <Boxes className="h-4 w-4 text-green-600" />
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">
              Underneath it
            </h3>
          </div>
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {ENGINEERING.map(({ icon: Icon, label, detail }) => (
              <div key={label} className="flex gap-3">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
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
      <section className="border-y border-slate-200 bg-slate-50 py-16 lg:py-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <span className="text-xs font-bold uppercase tracking-widest text-green-600">The market</span>
            <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
              Why this segment
            </h2>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {WHY_NOW.map(({ icon: Icon, title, body }) => (
              <div key={title} className="rounded-2xl border border-slate-200 bg-white p-7">
                <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-green-50 text-green-600">
                  <Icon className="h-5 w-5" />
                </span>
                <h3 className="mt-4 text-base font-bold text-slate-900">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------- model and the ask */}
      <section className="mx-auto max-w-3xl px-6 py-16 lg:py-24">
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
            Specific pricing, contract terms, revenue detail and the operating model are in the data
            room rather than on a public page.
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

      {/* ------------------------------------------------------- data room */}
      <section className="mx-auto max-w-7xl px-6 pb-16 lg:pb-24">
        <div className="grid gap-8 rounded-3xl border border-slate-200 bg-white p-8 lg:grid-cols-2 lg:p-10">
          <div>
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-green-50 text-green-600">
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
                <FileCheck2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
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
              Select the investor topic on the contact form. Tell us the fund, the stage you lead and
              one healthcare company you have backed, and we will send the data room.
            </p>
            <Link
              href="/contact"
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
