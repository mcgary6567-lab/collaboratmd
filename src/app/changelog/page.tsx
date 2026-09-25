import type { Metadata } from "next";
import { PageShell } from "@/components/page-shell";

export const metadata: Metadata = {
  title: "Changelog — CollaboratMD",
  description: "What changed in CollaboratMD, release by release.",
};

/** Written from the project's commit history; each entry is something that shipped. */
const RELEASES: { date: string; title: string; items: string[] }[] = [
  {
    date: "2026-09-25",
    title: "Integrations, API, denial agent, facility claims and compliance",
    items: [
      "Integrations screen: connect Stedi, Stripe, Twilio, Resend and Claude with your own keys, test each connection, and the features that need them switch on",
      "Public REST API with per-practice keys, and signed webhooks for claims, payments, denials and patients",
      "Denial agent: prepares appeals, corrected claims, write-offs of duplicates and coverage follow-ups for a person to approve",
      "Copay by card at online check-in, and text-to-pay links for patient balances",
      "Report builder with columns, filters, grouping, CSV export and scheduled email (totals only, never patient rows)",
      "Electronic prior authorization requests (X12 278)",
      "Facility claims as 837I (UB-04), with institutional scrubbing rules",
      "Compliance center: control checks, access reviews, vendor BAA register and audit log export",
      "Landing page rebuilt with a product tour and a denial cost calculator",
    ],
  },
  {
    date: "2026-09-24",
    title: "Getting paid, end to end",
    items: [
      "Secondary insurance billed automatically after the primary pays",
      "Unpaid claim follow-up with 276/277 status inquiries",
      "Two-factor sign-in and account lockout",
      "Patient portal with online payments and autopay",
      "Automated reminders, follow-up, autopay and a weekly report",
      "Appeal letters, denial risk scores and coding help",
      "Bank deposit reconciliation, provider enrollment tracking and a collections workflow",
      "Phone layout, search from anywhere, a task inbox, saved views and dark mode",
      "Payer contracts and underpayments, statements, estimates, payment plans, prior authorizations, voids and replacements",
      "Eligibility (270/271), online check-in, HL7 interfaces, lab orders and results, and multi-practice logins",
      "Stedi clearinghouse adapter",
    ],
  },
  {
    date: "2026-09-23",
    title: "CollaboratMD",
    items: [
      "Renamed the product, with a new identity and marketing site",
      "Published pricing, with annual billing",
      "Investor page built on live system metrics",
    ],
  },
];

export default function ChangelogPage() {
  return (
    <PageShell eyebrow="Changelog" title="What's new" lead="Every release, newest first. Features that need an outside account (a clearinghouse, card payments, texting, email or AI) work once the practice connects its own.">
      <ol className="mt-10 space-y-10">
        {RELEASES.map((r) => (
          <li key={r.date} className="grid gap-4 md:grid-cols-[10rem_1fr]">
            <time dateTime={r.date} className="text-sm font-semibold text-slate-500">{new Date(`${r.date}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</time>
            <div>
              <h2 className="text-lg font-bold text-slate-900">{r.title}</h2>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-slate-700">
                {r.items.map((i) => <li key={i}>{i}</li>)}
              </ul>
            </div>
          </li>
        ))}
      </ol>
    </PageShell>
  );
}
