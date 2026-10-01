import type { Metadata } from "next";
import { PageShell } from "@/components/page-shell";

export const metadata: Metadata = {
  title: "Changelog",
  description: "What changed in CollaboratMD, release by release.",
};

/** Written from the project's commit history; each entry is something that shipped. */
const RELEASES: { date: string; title: string; items: string[] }[] = [
  {
    date: "2026-09-30",
    title: "Locum tenens, HMO referrals, therapy plans of care, superbills, other-insurance check, expiring cards, statement cycles, interpreters",
    items: [
      "Substitute physicians: locum tenens (Q6) and reciprocal (Q5) billing with the substitute's NPI on record and Medicare's 60-day limit",
      "HMO referrals with visit counts; the referral number goes on the claim (REF*9F) and a missing one is flagged",
      "Therapy plans of care: certification within 30 days, recertification every 90, checked on Medicare therapy claims",
      "Superbills patients can file with their own insurer for out-of-network reimbursement",
      "Online check-in asks once a year about other insurance, before a coordination-of-benefits denial",
      "Expiring cards on file: patients replace the card from a link without being charged, keeping autopay",
      "Statement cycles spread statements across the month by last name",
      "Interpreter log for language access, with Medicaid T1013 units where the state pays",
    ],
  },
  {
    date: "2026-09-30",
    title: "Bankruptcy and estates, returned mail, adult dependents, front-desk collections, referral sources, privacy complaints, cost to collect",
    items: [
      "Bankruptcy and deceased-patient holds stop statements, reminders, card charges and collections; a discharge or estate settlement closes them with the right write-off, and an estate claim letter prints itemized",
      "Returned mail stops mailings to an address until it is corrected, however it is corrected, and reminds the front desk at the next visit",
      "Dependents who turn 18 get their own statements unless they agree to keep the guarantor",
      "Front-desk collections: copays and prior balances collected at the visit against what was due, by location, week and staff",
      "Referral sources on registration, with new patients, visits and collections by source and by referring physician",
      "Privacy complaints log, from receipt through investigation, mitigation and the answer",
      "Cost to collect: monthly billing costs, plus agency commissions, as a share of collections",
    ],
  },
  {
    date: "2026-09-30",
    title: "QMB protection, family accounts, cash close, agency commissions, missed-appointment fees, denial root causes, chargemaster, provider pay",
    items: [
      "Qualified Medicare Beneficiaries: Medicare cost-sharing is kept off statements, reminders, card charges and collections, and written off in one step",
      "Family accounts: a guarantor gets the statements, the family's balances are shown together, and one payment is spread across them",
      "Daily cash close: cash, checks and cards counted against what was posted, with a note required for any difference",
      "Collection agency recoveries post in full to the patient, with the agency's commission in the accounting journal and a comparison of agencies",
      "Missed-appointment fees under a policy the patient agreed to: charged once, never to insurance or Medicaid patients, and waivable with a reason",
      "Denial root causes by the team that can prevent them, with the preventable share by month",
      "Chargemaster for facility claims, pricing UB-04 lines, and a standard charges file laid out after CMS's template",
      "Provider compensation worksheet: collections or work RVUs, with a base and bonus if the plan has one",
    ],
  },
  {
    date: "2026-09-30",
    title: "Duplicate patients, a locked month-end, provider questions, write-off and registration analysis",
    items: [
      "Duplicate patients found by name and date of birth, member ID or phone, and merged with every visit, claim and payment",
      "Month-end close locks the month, with an A/R rollforward that has to reconcile to the cent",
      "Questions to providers hold the claim until they are answered",
      "Medicare therapy checked against the year's KX threshold and review amount",
      "Write-offs record why, and a report splits avoidable from contractual and policy write-offs",
      "Registration quality: rejections and denials traced to the field and to who entered the policy",
      "Personal injury cases hold the balance under a lien until the settlement is posted",
      "Internal coding audits: a random sample per provider, scored against the notes",
    ],
  },
  {
    date: "2026-09-30",
    title: "October 1 code changes, privacy requests, unclaimed credits, contract calendar",
    items: [
      "Diagnosis code changes: the codes your practice uses that FY 2027 deletes or splits, where they are on open work, and their replacements",
      "ICD-10-CM checked by the date of service from the new year's file and its addenda, including the new QA codes; U codes such as U07.1 now pass the format check",
      "Privacy requests: patients' requests for records and accountings of disclosures on their HIPAA deadlines, with a disclosure log",
      "Unclaimed patient credits: dormancy you set by state, the due-diligence letter, and the report",
      "Year-end payment receipts, one patient or all at once, and in the patient portal",
      "Statements and the portal explain each balance in plain English or Spanish from the payer's reasons",
      "Contract calendar with renewal and notice dates, and reminders before each notice date",
      "Deductible and out-of-pocket kept current from the payer's 835s between coverage checks, and used in estimates",
      "Medicare lab, imaging and equipment claims checked against CMS's ordering and referring file",
    ],
  },
  {
    date: "2026-09-29",
    title: "Setup for yearly files, warnings that became denials, and a hardening pass",
    items: [
      "Setup checklist: which yearly CMS files and practice settings are missing, and what each one makes possible",
      "Warnings that became denials: each scrub warning by payer, how often those claims were denied, and when to block it",
      "Practice downloads now include coverage checks, and a test fails if a new table is left out of the download or the account deletion",
      "Sliding fee discounts post only for people allowed to adjust balances; appeal decisions are recorded by the same roles",
      "Faster reports on large practices: a claim's denials, corrected claims and missed charges are now indexed",
      "Anesthesia claims show base plus time units once CMS's base unit file is loaded",
      "Help for every menu and settings page, with a test that keeps it that way; more pages in the accessibility checks",
    ],
  },
  {
    date: "2026-09-29",
    title: "Fee schedule check, batch appeals, collection safeguards, time-based visits",
    items: [
      "Unlisted and unclassified codes carry their description on the 837P and the CMS-1500, and are stopped without one",
      "Fee schedule check: charges below what a payer allows, with a suggested charge",
      "Every 835 line kept with its allowed amount, including remittances posted before",
      "Batch appeals: one letter for a payer's same-reason denials, each still tracked on its own",
      "Self-pay bills $400 or more over the good faith estimate flagged before statements go out",
      "Optional coverage re-checks in January, when deductibles reset",
      "Collection safeguards you set, checked before an account goes to an agency",
      "Office visit time checked against the level, with prolonged service time (99417, or G2212 for Medicare)",
    ],
  },
  {
    date: "2026-09-29",
    title: "Care gaps, card on file, timely filing proof, payer refund demands",
    items: [
      "Proof of timely filing assembled from your submissions and acknowledgments, and added to timely filing appeals",
      "Care gaps: annual wellness visits due (with reminders), chronic care management candidates, and HCC recapture",
      "Card on file: patients can authorize charges after insurance up to a limit, with a notice three days before each one",
      "Modifier 25 and 59 use per provider, with a sample of claims to review",
      "Payer refund demands tracked to their deadlines, with a dispute letter, and settled when the payer takes the money back",
      "A primary EOB page rebuilt from the 835, to send with paper claims to secondary payers",
    ],
  },
  {
    date: "2026-09-29",
    title: "Duplicate claims, No Surprises Act disputes, sliding fees, contract and lag reports",
    items: [
      "The same service billed twice to the same payer is stopped before it goes out, unless a repeat modifier explains it",
      "The birthday rule for children on both parents' plans",
      "Out-of-network payment disputes tracked on the No Surprises Act's business-day deadlines",
      "A sliding fee scale against the poverty guidelines you enter, applied to what eligible patients owe",
      "Contract comparison: each payer against Medicare's fee schedule, with a what-if rate",
      "Charge and submission lag by provider",
      "Medicaid managed care plans caught from the eligibility response, and an optional monthly Medicaid re-check",
      "Split/shared facility visits (FS) and teaching-physician modifiers (GC, GE) checked",
    ],
  },
  {
    date: "2026-09-29",
    title: "Global periods, Medicare Advantage, care management, records requests, prompt-pay interest",
    items: [
      "Visits and procedures inside a surgery's global period are caught before the claim goes out; routine post-op visits go in as 99024 at $0.00",
      "Patients Medicare says are in a Medicare Advantage plan are flagged, and claims to traditional Medicare for them are stopped",
      "Supervising provider on claims, and provider credentials: Medicare checks expect 85% for NPs, PAs and CNSs",
      "Chronic care management, behavioral health integration and remote monitoring: consent, minutes through the month, and billing when it ends",
      "Frequency limits (once a year, once in a lifetime) as payer edits, counted from the patient's own history",
      "Records requests (ADR, RAC, TPE, audits) tracked to their due date, with the claim held until the records are sent",
      "Productivity report: work RVUs per provider and each provider's E/M level mix, with a random sample for review",
      "Prompt-pay interest on late commercial payments under your state's statute, with a letter per payer",
    ],
  },
  {
    date: "2026-09-29",
    title: "Drug codes, payer takebacks, appeal levels, ABNs and the 60-day rule",
    items: [
      "NDC, quantity and unit on drug lines, sent on the 837P and printed on the CMS-1500",
      "Payer takebacks on an 835 (PLB) post to the claim they are for; interest is shown with the check",
      "Coverage checked automatically for tomorrow's appointments, with a note for the front desk",
      "Appeal levels with their deadlines, including Medicare's five levels",
      "Advance Beneficiary Notices recorded per patient; GA added to covered Medicare lines and checked on claims",
      "Medicare and Medicaid overpayments show their 60-day return deadline, with a reminder before it passes",
      "Telehealth checks: place of service, modifiers and Medicare's telehealth list",
      "Inpatient procedure codes (ICD-10-PCS) on facility claims, and a plain-paper UB-04 to print",
    ],
  },
  {
    date: "2026-09-28",
    title: "Medicare pricing, who pays first, therapy and anesthesia, passkeys",
    items: [
      "The Medicare physician fee schedule for your locality: underpayment checks on Medicare claims, and contracts as a percentage of Medicare",
      "Medicare Secondary Payer questions decide which plan is billed first; crossovers to supplemental insurers are not billed twice",
      "Therapy minutes with the 8-minute rule and discipline modifiers; anesthesia billed in minutes",
      "Text message registration with US carriers (A2P 10DLC or toll-free), checked from your Twilio account; HELP answered automatically",
      "Sign in with a passkey: no password or code, and it cannot be phished",
      "MIPS quality measures: codes added to qualifying claims at $0.00, and a quality report",
      "Import mappings for other systems' exports can be shared with every practice",
      "Diagnosis search stays instant with the full ICD-10-CM list",
    ],
  },
  {
    date: "2026-09-28",
    title: "Full code sets, paper claims, and any clearinghouse",
    items: [
      "ICD-10-CM loaded by fiscal year: every diagnosis is checked as billable and valid on the date of service, and searched as you type",
      "HCPCS Level II checked on claims; practices add their own procedure codes, descriptions and fees from a spreadsheet",
      "Print a claim on the CMS-1500 (red form or plain paper), with an alignment test",
      "Workers' comp and auto accident claims: related causes, accident date and state, and the insurer's claim number",
      "Send claims through any clearinghouse by file, and upload the 999, 277CA and 835 that come back",
      "Look up an NPI in the national registry to fill in a provider, practice or referring provider",
      "Subscription invoices in the app, and a warning before claims pause for a failed payment",
      "A public security questionnaire with the latest backup restore test",
    ],
  },
  {
    date: "2026-09-28",
    title: "Claims for dependents, Medicare filing, and a separate demo",
    items: [
      "Fixed: a claim for a patient on someone else's plan (a child, a spouse) now names the insured person as the subscriber and the patient separately, as payers require; eligibility checks do the same",
      "Fixed: Medicare Part B and Medicaid claims carry their own filing indicator instead of the commercial one",
      "Insurance records the insured person when it is not the patient, and Medicare member IDs are checked as MBIs",
      "Register self-pay patients without insurance; states chosen from a list, and phone numbers and ZIP codes checked",
      "Try the demo practice in one click from /demo; the sign-in page no longer shows demo accounts",
      "Solo providers can bill under their own NPI; lab claims carry the practice's CLIA number, and a referring provider can be entered at charge entry",
      "The full CMS place-of-service list, a taxonomy code picker, and Medicare's one-year filing limit by default",
    ],
  },
  {
    date: "2026-09-28",
    title: "Times on your clock, and a tidier app",
    items: [
      "Every time shown in the app is on the practice's clock, with its time zone (9:05 AM EDT), and dates read the US way",
      "One setup checklist, from an empty practice to the first paid claim, with a link to each step",
      "Tab titles on every page, loading and error screens, clearer claim statuses, and lists that turn into cards on a phone",
      "A shorter menu: settings pages live under Settings, and search finds every one of them",
      "New Business Associate Agreement and Accessibility pages",
    ],
  },
  {
    date: "2026-09-28",
    title: "Reminders at the practice's own hour, and a waitlist that keeps asking",
    items: [
      "Waitlist offers nobody takes within 30 minutes go to the next people on the list; patients say which hours they can come",
      "Patients can ask to join the waitlist from the online booking page",
      "Morning-of and day-before reminders go out at each practice's own hour",
      "The schedule shows reminder texts that did not reach the phone, so the front desk can call",
      "Single sign-on users confirm with their identity provider before opening a restricted record",
      "Two-factor can be required for administrators and anyone who can export; new practices start with it on",
      "The status page shows when the site was last checked from outside",
    ],
  },
  {
    date: "2026-09-28",
    title: "A waitlist that fills cancelled times, and tighter protection for restricted records",
    items: [
      "Waitlist: a cancelled time is texted to patients waiting for it, and the first to reply B is booked",
      "An optional same-day text to patients who have not confirmed, and a report of no-shows for confirmed and unconfirmed patients",
      "Opening a restricted record asks for your password or authenticator code as well as a reason",
      "Exports that include a restricted patient, and API reads of one, go on the patient's access log; API keys see restricted patients only when allowed",
      "Chart access review: each practice sets its own limits, and reviewers record what they found",
      "Fixed: after a bulk action on the claims list failed, the bar said nothing was selected while the claims were still ticked",
      "Fixed: saving the billing policies could have cleared settings kept alongside them",
    ],
  },
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
