import type { Metadata } from "next";
import { PageShell } from "@/components/page-shell";

export const metadata: Metadata = {
  title: "Changelog — CollaboratMD",
  description: "What changed in CollaboratMD, release by release.",
};

/** Written from the project's commit history; each entry is something that shipped. */
const RELEASES: { date: string; title: string; items: string[] }[] = [
  {
    date: "2026-09-27",
    title: "Confirm by text, restricted records, and a daily guide for each role",
    items: [
      "Patients reply C to confirm or X to cancel their appointment reminder; the schedule shows who confirmed, and the front desk hears about cancellations",
      "Restrict a patient's records: opening them asks for a reason, which administrators are told about (restricting again asks everyone again)",
      "Settings > Chart access review flags unusual chart access each day",
      "The working day for the front desk, billers and administrators, from the help button",
      "Fixed: sending an online check-in link in the evening could say the day's appointment had already passed",
      "Fixed: narrow fields and dropdowns now keep their intended width instead of stretching or collapsing",
      "Fixed: the demo practice, set up in its evening, put today's appointments on tomorrow",
    ],
  },
  {
    date: "2026-09-27",
    title: "A patient access log, and checks at the size of a large practice",
    items: [
      "Administrators can see who opened a patient's chart, claims, statements and estimates, and what was done with them (Patient > Access log)",
      "Every release is tested against a practice with 100,000 claims, with time limits on the busiest screens and a check for missing database indexes",
      "Every screen is checked for sideways scrolling on a phone",
    ],
  },
  {
    date: "2026-09-27",
    title: "Safer deploys, the practice's own time zone, and Spanish checkout",
    items: [
      "Fixed: for about 20 minutes after an update, pages that read data did not load. Updates now prepare the database before they go live and are checked the moment they do",
      "Each practice has a time zone (Settings > Practice profile): today's schedule and tomorrow's reminders follow the practice's clock",
      "Patients who read Spanish see Stripe's payment page in Spanish",
      "Find patients by language on the Patients list",
      "Fixed: on a laptop-sized screen, the Team page's reset and sign-out buttons sat under the roles table",
    ],
  },
  {
    date: "2026-09-27",
    title: "Spanish for booking, statements and reminders, and a fix for online booking times",
    items: [
      "Online booking is in Spanish too, and each patient has a language: statements, appointment reminders, confirmations and payment messages go out in it",
      "Fixed: an appointment booked online showed on the schedule at the wrong hour (off by the practice's time zone)",
      "Fixed: on a laptop-sized screen, the schedule's check-in and no-show buttons sat under the booking form",
      "Dashboard figures update as soon as a payment is posted or a claim is created",
      "Administrators see useful screens the practice has not tried yet, and can dismiss them",
      "Replies to problem reports arrive in your notifications",
    ],
  },
  {
    date: "2026-09-27",
    title: "A go-live checklist, problem reports, and exports for the largest practices",
    items: [
      "Settings > Go-live checklist walks from setup to the first paid claim, ticking each step from what has actually happened",
      "Report a problem from the help button on any screen, straight to our team",
      "Very large practices get their data export in parts, each downloadable on its own",
      "Old notifications and logs are cleared on a schedule; claims, payments and the audit log are kept",
      "Every screen is checked automatically for accessibility problems before each release",
      "Dashboard figures load faster on repeat visits",
    ],
  },
  {
    date: "2026-09-27",
    title: "Online booking, payer directory, and checks before every claim",
    items: [
      "Patients request open times from your booking link; staff confirm each request on the schedule",
      "Find payers in Stedi's payer directory, with which transactions need enrollment",
      "A report comparing your locations, and import templates so next month's patient file maps itself",
      "Every claim file is checked for structural errors before it is sent, and claims carry the practice phone as the contact",
      "An integration doctor that checks each connected service end to end",
      "Help for the page you are on, from the button in the corner",
      "Account closure with deletion of all data, trial and payment reminders, and a stricter browser security policy",
    ],
  },
  {
    date: "2026-09-26",
    title: "Free trials, mailed statements, card readers, and a full data export",
    items: [
      "Practices can sign up on their own, confirm their email, and start a free trial; plans are bought and managed through Stripe",
      "Settings > Data export downloads everything the practice has here as one zip",
      "Statements printed and mailed through Lob, one at a time or as a batch",
      "Card payments at the front desk on a Stripe Terminal reader, with a simulated reader to try it",
      "Payer contracts load from a spreadsheet, with multiple-procedure and modifier reductions",
      "Locations, sent on claims as the service facility",
      "Claim acknowledgments (277CA) picked up from Stedi, and ERA/EFT enrollment tracked per payer",
      "EHR connections sign their own token requests (SMART backend services) instead of pasted tokens",
      "Sign-in attempt limits per network, security headers, and accessibility fixes for contrast",
    ],
  },
  {
    date: "2026-09-26",
    title: "Remittances on their own, estimates before the visit, SAML and FHIR",
    items: [
      "ERAs from Stedi are picked up and posted every morning; dental claims go to Stedi too",
      "Estimates before the visit, with a link for the patient to pay ahead",
      "Secondary claims for facility (UB-04) and dental claims",
      "Forgot-password emails, notifications with a daily digest, and a setup guide for new practices",
      "Credential tracking with expiry reminders, and a quarterly access review reminder",
      "Import of open balances from a previous billing system, and patient financing links",
      "SAML single sign-on alongside OpenID Connect, and patients and visits from an EHR over FHIR",
      "Bulk rescrub, status checks and write-offs on the claims list; the app can be installed on a phone",
    ],
  },
  {
    date: "2026-09-25",
    title: "Administration: settings workspace and billing policies",
    items: [
      "Settings home with setup health and search; edit the practice profile, providers and payers",
      "Billing policies: write-off limits, strict scrubbing, risk holds, two-person refunds, admin-only exports, small balance adjustments",
      "Sign everyone out, an audit log viewer, and a customizable menu",
    ],
  },
  {
    date: "2026-09-25",
    title: "Recovery, forecasting, access control and dental claims",
    items: [
      "National code sets: NCCI procedure-to-procedure and unit edits and Medicare coverage checks in the scrubber, and payer rules suggested from your own denials",
      "Revenue recovery: missed charges, underpayment dispute letters, and credit balances refunded through request, approval and issue",
      "Cash forecast for eight weeks from your own payment history and schedule, payer behavior alerts, and questions answered as reports",
      "Two-way texting inbox with STOP handling, insurance cards read from a photo (with a BAA), and coverage discovery for self-pay patients",
      "Single sign-on (OpenID Connect) and SCIM provisioning, custom roles, session length and network allowlists",
      "Client invoicing for billing companies, accounting journal export with month-end close, and work queues with service levels",
      "Dental claims as 837D, claim attachments referenced by PWK with a fax cover sheet, server error monitoring and a public status page",
    ],
  },
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
          <li key={`${r.date} ${r.title}`} className="grid gap-4 md:grid-cols-[10rem_1fr]">
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
