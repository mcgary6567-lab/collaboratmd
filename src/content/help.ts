/**
 * Short guides shown by the help button, keyed by the start of the page's path
 * (the longest match wins). Each is what a new biller or front-desk user needs
 * to get through that screen, not a manual.
 */
export type Guide = { title: string; steps: string[]; related?: { label: string; href: string }[] };

export const GUIDES: Record<string, Guide> = {
  "/dashboard": {
    title: "Your dashboard",
    steps: [
      "The top cards are this practice's key numbers; the lists below are the work waiting for you.",
      "New practices see a setup guide here until everything claims need is filled in.",
      "Press Ctrl+K (Cmd+K on a Mac) anywhere to jump to a patient, claim or page.",
    ],
    related: [{ label: "Tasks", href: "/tasks" }, { label: "Reports", href: "/reports" }],
  },
  "/scheduling": {
    title: "Scheduling",
    steps: [
      "Move between days with Previous, Today and Next.",
      "Verify coverage for this day runs eligibility for every patient on the schedule at once.",
      "Online requests wait at the top: Confirm books the visit (matching or creating the patient); Decline frees the time.",
      "Send a check-in link so the patient updates insurance and signs forms before arriving.",
    ],
    related: [{ label: "Online booking settings", href: "/settings/booking" }],
  },
  "/encounters/new": {
    title: "Charge entry",
    steps: [
      "Pick the patient, provider and date of service; choose the location if the visit was not at the main office.",
      "Add diagnoses first, then each service line with its diagnosis pointers (1 for the first diagnosis, and so on).",
      "Saving builds the claim and scrubs it; fix anything the scrubber flags on the claim page before sending.",
    ],
    related: [{ label: "Coding help", href: "/coding" }],
  },
  "/claims": {
    title: "Claims",
    steps: [
      "Filter by status, payer or dates; tick claims to rescrub, check status or write off several at once.",
      "Open a claim to see its scrub results, acknowledgments (999 and 277CA), payments and history.",
      "Submit sends the 837 to the clearinghouse; it checks the file itself first and will not send a malformed one.",
      "Corrected and void claims are made from the original claim page, so the history stays linked.",
    ],
    related: [{ label: "Denials", href: "/denials" }, { label: "Remittance", href: "/remittance" }],
  },
  "/patients": {
    title: "Patients",
    steps: [
      "Search by name or MRN. A patient's page shows insurance, visits, claims, balance and messages.",
      "Run an eligibility check from the insurance section before the visit.",
      "Send a portal or pay link so the patient can see and pay their balance online.",
      "Take a card payment on the front-desk reader from the patient page when Stripe is connected.",
    ],
    related: [{ label: "Import patients", href: "/import" }],
  },
  "/remittance": {
    title: "Remittance (ERAs)",
    steps: [
      "With Stedi connected, ERAs arrive every morning and post to their claims on their own.",
      "Payers listed as missing ERA enrollment will not send ERAs until you enroll; post their paper EOBs meanwhile.",
      "Bank deposits matches each ERA to the money that reached your account.",
    ],
    related: [{ label: "Payer enrollment", href: "/settings/enrollment" }],
  },
  "/denials": {
    title: "Denials",
    steps: [
      "Each denial explains the reason codes in plain English with next steps.",
      "Work the ones with the nearest appeal deadline first; the list sorts by it.",
      "Draft an appeal letter from the denial, then mark it appealed so it is followed up.",
    ],
    related: [{ label: "Work queues", href: "/work" }],
  },
  "/records-requests": {
    title: "Records requests",
    steps: [
      "Add each payer request for medical records (a Medicare ADR, a RAC or TPE review, a commercial audit) with its claim and due date.",
      "The claim is held from appeals and write-offs until the records are sent, and the daily job reminds you a week before the due date.",
      "Mark it sent with how it went (esMD, portal, fax), then close it with the outcome.",
    ],
    related: [{ label: "Denials", href: "/denials" }],
  },
  "/reports/productivity": {
    title: "Productivity and coding profile",
    steps: [
      "Work RVUs per provider from the Medicare fee schedule year loaded for each visit.",
      "Each provider's E/M level mix beside the practice's; half a level or more away is marked for a closer look.",
      "Sample 10 visits to compare the documentation with the level billed.",
    ],
    related: [{ label: "National code sets", href: "/settings/code-sets" }],
  },
  "/nsa-disputes": {
    title: "Out-of-network disputes",
    steps: [
      "Add the claim when a plan underpays an out-of-network service the No Surprises Act covers, with the date its payment or denial arrived.",
      "Send CMS's open negotiation notice within 30 business days and record it; negotiation then runs 30 business days.",
      "Start federal IDR within the 4 business days after that. Business days skip weekends and federal holidays; the daily job warns 5 business days ahead.",
    ],
    related: [{ label: "Underpayments", href: "/underpayments" }],
  },
  "/reports/contracts": {
    title: "Contract comparison",
    steps: [
      "Each payer's allowed amounts (paid plus patient share) against what Medicare's fee schedule would allow for the same claims.",
      "Enter a percent of Medicare to see what each payer would have paid at that rate: a starting point for renegotiating.",
    ],
    related: [{ label: "Fee schedules", href: "/settings/fees" }],
  },
  "/reports/lag": {
    title: "Charge and submission lag",
    steps: [
      "Days from the visit to its charges, and from the charges to the claim going out, by provider.",
      "A day or two for each is good practice; visits never charged are on Missed charges.",
    ],
    related: [{ label: "Missed charges", href: "/billing/missed-charges" }],
  },
  "/settings/sliding-fee": {
    title: "Sliding fee scale",
    steps: [
      "Enter the year's HHS poverty guidelines and your board-approved discount tiers.",
      "On a patient's page, verify household size and income; the tier's discount then comes off what they owe on each claim for a year.",
    ],
    related: [{ label: "Patient billing", href: "/billing" }],
  },
  "/settings/prompt-pay": {
    title: "Prompt-pay law",
    steps: [
      "Enter your state's statute: the days a commercial insurer has to pay a clean claim, the interest rate, and the citation.",
      "Late commercial payments then appear on Underpayments with the interest, and a letter per payer asks for it once.",
    ],
    related: [{ label: "Underpayments", href: "/underpayments" }],
  },
  "/underpayments": {
    title: "Underpayments",
    steps: [
      "Paid claims whose allowed amount fell short of your payer contract, after multiple-procedure and modifier reductions.",
      "Group them by payer and send one dispute letter for all of that payer's claims.",
    ],
    related: [{ label: "Fee schedules and contracts", href: "/settings/fees" }],
  },
  "/billing": {
    title: "Patient billing",
    steps: [
      "Generate statements for everyone above a balance; people billed in the last 25 days are skipped.",
      "Mail unsent statements through Lob, or print and mark them mailed yourself.",
      "Set up payment plans and discounts from a patient's page.",
    ],
    related: [{ label: "Collections", href: "/billing/collections" }],
  },
  "/reports": {
    title: "Reports",
    steps: [
      "The standard reports cover A/R aging, payer performance, productivity and denials.",
      "The report builder makes your own and saves it; any list can be downloaded as CSV.",
      "Cash forecast, payer alerts and the by-location report are linked at the top.",
    ],
  },
  "/tasks": {
    title: "Tasks",
    steps: ["Work assigned to you, from people or from work queue rules. Mark each done when finished; overdue ones are highlighted."],
    related: [{ label: "Work queues", href: "/work" }],
  },
  "/import": {
    title: "Importing patients",
    steps: [
      "Export patients from your old system as CSV and choose the file; columns are matched automatically.",
      "Check each match (date of birth is required), then look at the first rows before importing.",
      "Save the mapping as a template; next time a file with the same columns maps itself.",
    ],
  },
  "/settings/connections/doctor": {
    title: "Integration doctor",
    steps: [
      "Run all checks after connecting a service and before going live.",
      "With test keys it also makes a payment it cancels at once and renders a letter that is never mailed; with live keys it only reads.",
    ],
  },
  "/settings/connections": {
    title: "Integrations",
    steps: [
      "Paste each service's keys and press Test. Features that need a service turn on once it is connected.",
      "Use test keys first; the integration doctor checks everything end to end.",
    ],
    related: [{ label: "Integration doctor", href: "/settings/connections/doctor" }],
  },
  "/settings/booking": {
    title: "Online booking",
    steps: [
      "Turn it on, choose your time zone and visit length, then set each provider's weekly hours.",
      "Share the link on your website. Requests appear on the Schedule for staff to confirm.",
    ],
  },
  "/settings/data-export": {
    title: "Data export",
    steps: ["Downloads everything the practice has as spreadsheets and files. It contains patient information, so store it securely."],
  },
  "/settings": {
    title: "Settings",
    steps: [
      "Search at the top to find any setting.",
      "Administrators manage the practice profile, team, security, integrations and billing policies here.",
    ],
  },
};

export function guideFor(path: string): Guide | null {
  const key = Object.keys(GUIDES).filter((k) => path === k || path.startsWith(`${k}/`)).sort((a, b) => b.length - a.length)[0];
  return key ? GUIDES[key] : null;
}
