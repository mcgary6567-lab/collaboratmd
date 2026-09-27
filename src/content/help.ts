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
