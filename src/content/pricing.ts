import { RULE_IDS } from "@/lib/scrub/rules";

/**
 * Pricing content.
 *
 * A price here is a public commitment a prospect can hold the company to, so
 * every figure in this file came from the company rather than from a guess.
 * Setting either field back to null returns that plan to a quote request.
 *
 * The per-claim rate is the same on all three plans: it covers a clearinghouse
 * transaction, which costs the same whoever sends it. The plans differ on the
 * subscription, which is what the feature matrix reflects.
 */

/**
 * Annual billing charges for ten months and gives twelve, so the discount is
 * two months. Everything derived from it goes through the helpers below: a
 * discount written out by hand in the markup is a discount that disagrees with
 * itself the first time it changes.
 */
export const ANNUAL_FREE_MONTHS = 2;
export const MONTHS_PER_YEAR = 12;
export const MONTHS_BILLED_ANNUALLY = MONTHS_PER_YEAR - ANNUAL_FREE_MONTHS;

/** What a year costs up front, per provider. */
export function annualTotal(priceMonthly: number): number {
  return priceMonthly * MONTHS_BILLED_ANNUALLY;
}

/** The annual price expressed per month, which is how people compare plans. */
export function annualEffectiveMonthly(priceMonthly: number): number {
  return annualTotal(priceMonthly) / MONTHS_PER_YEAR;
}

/** Saving against paying monthly for a year, per provider. */
export function annualSaving(priceMonthly: number): number {
  return priceMonthly * ANNUAL_FREE_MONTHS;
}

export type Tier = {
  id: string;
  name: string;
  forWho: string;
  summary: string;
  /** US dollars per provider per month. null renders as "Custom quote". */
  priceMonthly: number | null;
  /** Cents per submitted claim. null omits the transaction line. */
  perClaimCents: number | null;
  highlights: string[];
  cta: string;
  featured?: boolean;
};

export const TIERS: Tier[] = [
  {
    id: "essentials",
    name: "Essentials",
    forWho: "Independent practices, 1 to 5 providers",
    summary:
      "Everything needed to get a clean claim out the door and post the remittance that comes back.",
    priceMonthly: 99,
    perClaimCents: 30,
    cta: "Start with Essentials",
    highlights: [
      "Scheduling and 270/271 eligibility checks",
      "Charge capture with fee-schedule pricing",
      `Claim scrubbing: ${RULE_IDS.length} rules plus payer edits`,
      "837P claim generation and clearinghouse submission",
      "Automatic 835 remittance posting",
      "Patient statements and balances",
    ],
  },
  {
    id: "professional",
    name: "Professional",
    forWho: "Growing and multi-specialty practices",
    summary:
      "Adds the denial and analytics layer, which is where the difference between billing and getting paid actually shows up.",
    priceMonthly: 149,
    perClaimCents: 30,
    cta: "Start with Professional",
    featured: true,
    highlights: [
      "Everything in Essentials",
      "Denial management with appeal deadlines",
      "Practice analytics against industry benchmarks",
      "Payer performance and provider productivity",
      "A/R aging by payer and by bucket",
      "Timely filing risk monitoring",
      "Underpayment detection against payer contracts",
    ],
  },
  {
    id: "billing-company",
    name: "Billing Company",
    forWho: "Billing companies managing multiple practices",
    summary:
      "Runs many practices side by side, with the reporting and access control that requires.",
    priceMonthly: 199,
    perClaimCents: 30,
    cta: "Talk to sales",
    highlights: [
      "Everything in Professional",
      "Multiple practices under one login",
      "Side-by-side reporting across clients",
      "Role-based access across teams",
      "HL7 interfaces and CSV patient import",
    ],
  },
];

export type FeatureGroup = {
  group: string;
  rows: { feature: string; essentials: boolean | string; professional: boolean | string; billing: boolean | string }[];
};

export const MATRIX: FeatureGroup[] = [
  {
    group: "Front office",
    rows: [
      { feature: "Appointment scheduling", essentials: true, professional: true, billing: true },
      { feature: "Eligibility checks (270/271), single or whole schedule", essentials: true, professional: true, billing: true },
      { feature: "Online check-in link with copay shown", essentials: true, professional: true, billing: true },
      { feature: "Estimates and good faith estimates", essentials: true, professional: true, billing: true },
      { feature: "Patient record and insurance history", essentials: true, professional: true, billing: true },
    ],
  },
  {
    group: "Claims",
    rows: [
      { feature: "Charge capture with CPT and ICD-10", essentials: true, professional: true, billing: true },
      { feature: "Built-in claim scrubbing rules", essentials: `${RULE_IDS.length} rules`, professional: `${RULE_IDS.length} rules`, billing: `${RULE_IDS.length} rules` },
      { feature: "Payer-specific edits and prior authorizations", essentials: true, professional: true, billing: true },
      { feature: "837P generation and submission", essentials: true, professional: true, billing: true },
      { feature: "999 and 277CA acknowledgments", essentials: true, professional: true, billing: true },
      { feature: "Corrected and voided claims", essentials: true, professional: true, billing: true },
      { feature: "Custom fee schedules per payer", essentials: false, professional: true, billing: true },
    ],
  },
  {
    group: "Remittance and denials",
    rows: [
      { feature: "Automatic 835 posting", essentials: true, professional: true, billing: true },
      { feature: "CARC and RARC preserved per line", essentials: true, professional: true, billing: true },
      { feature: "Denial worklist with assignment", essentials: false, professional: true, billing: true },
      { feature: "Appeal deadline tracking", essentials: false, professional: true, billing: true },
      { feature: "Denial reasons ranked by dollars", essentials: false, professional: true, billing: true },
      { feature: "Underpayment detection against contract", essentials: false, professional: true, billing: true },
    ],
  },
  {
    group: "Patient billing",
    rows: [
      { feature: "Statements following HFMA patient-friendly principles", essentials: true, professional: true, billing: true },
      { feature: "Patient A/R tracked separately from insurance", essentials: true, professional: true, billing: true },
      { feature: "Payment plans and discount policies", essentials: false, professional: true, billing: true },
    ],
  },
  {
    group: "Analytics",
    rows: [
      { feature: "Standard financial reports", essentials: true, professional: true, billing: true },
      { feature: "Benchmark dashboard (A/R, NCR, clean claim, denial)", essentials: false, professional: true, billing: true },
      { feature: "Payer performance comparison", essentials: false, professional: true, billing: true },
      { feature: "Provider productivity", essentials: false, professional: true, billing: true },
      { feature: "Per-client reporting across practices", essentials: false, professional: false, billing: true },
    ],
  },
  {
    group: "Integrations",
    rows: [
      { feature: "HL7 v2 interface (ADT, DFT)", essentials: false, professional: true, billing: true },
      { feature: "Lab orders and results (ORM, ORU)", essentials: false, professional: true, billing: true },
      { feature: "CSV patient import with column matching", essentials: true, professional: true, billing: true },
    ],
  },
  {
    group: "Security and support",
    rows: [
      { feature: "Business associate agreement, available on request", essentials: true, professional: true, billing: true },
      { feature: "Posted amounts never edited; audit log of key actions", essentials: true, professional: true, billing: true },
      { feature: "Role-based access control", essentials: true, professional: true, billing: true },
      { feature: "Multiple practices under one login", essentials: false, professional: false, billing: true },
    ],
  },
];

export const FAQ = [
  {
    q: "Monthly or annual?",
    a: "Either. Paying annually charges for ten months and gives you twelve, so two months are free and the effective rate drops by about 17%. The per-claim line is usage, so it is billed as incurred each month on both cycles.",
  },
  {
    q: "How is the subscription counted?",
    a: "Per rendering provider, per month. Front desk staff, billers and administrators do not consume a seat, because charging for the people who do the billing work would penalize exactly the behavior the software is meant to encourage.",
  },
  {
    q: "Why is there a per-claim component at all?",
    a: "Cost scales with volume: once a live clearinghouse is connected, every claim submitted is a transaction across it and every remittance is one coming back. Splitting the price into a subscription and a transaction line keeps a low-volume practice from subsidizing a high-volume one.",
  },
  {
    q: "What happens to my data if I leave?",
    a: "It stays yours. Patients, claims, remittances and the ledger are exported for you on request, and the Terms commit us to providing that export for 30 days after a subscription ends. Billing data is a legal record, not a lock-in mechanism.",
  },
  {
    q: "Do you sign a business associate agreement?",
    a: "Yes. A BAA is available on request and is signed before any protected health information is loaded. A practice is the covered entity and we are its business associate, which is the arrangement HIPAA requires.",
  },
  {
    q: "How long does implementation take?",
    a: "It depends almost entirely on the state of the data being migrated and how many payer enrollments have to be moved. That is the first thing an onboarding call establishes, and we would rather give a real date than a marketing one.",
  },
  {
    q: "Am I locked in if I pay annually?",
    a: "An annual term is a twelve-month commitment; that is what the two free months are in exchange for. Monthly billing carries no such term. Whichever you choose, the export commitment in the Terms applies, so your data is never the thing holding you in place.",
  },
];
