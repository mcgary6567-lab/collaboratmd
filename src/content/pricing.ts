/**
 * Pricing content.
 *
 * `priceMonthly` and `perClaimCents` are null until the real figures are set.
 * A null renders as a quote request rather than a number, because a published
 * price is a commitment a prospect can hold you to, and inventing one would
 * put a figure on the site that nobody in the company had agreed to.
 *
 * To publish a price, set the value and the page updates itself. Nothing else
 * has to change.
 */

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
    priceMonthly: null,
    perClaimCents: null,
    cta: "Get a quote",
    highlights: [
      "Scheduling and real-time eligibility",
      "Charge capture with fee-schedule pricing",
      "Claim scrubbing, all 22 validation rules",
      "Electronic submission as 837P",
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
      "Priority support",
    ],
  },
  {
    id: "billing-company",
    name: "Billing Company",
    forWho: "Billing companies managing multiple practices",
    summary:
      "Runs many practices side by side, with the reporting and access control that requires.",
    priceMonthly: null,
    perClaimCents: null,
    cta: "Talk to sales",
    highlights: [
      "Everything in Professional",
      "Multiple practices under one login",
      "Per-client reporting and reconciliation",
      "Role-based access across teams",
      "Dedicated onboarding and data migration",
      "Service level agreement",
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
      { feature: "Real-time eligibility (270/271)", essentials: true, professional: true, billing: true },
      { feature: "Copay and deductible at check-in", essentials: true, professional: true, billing: true },
      { feature: "Patient record and insurance history", essentials: true, professional: true, billing: true },
    ],
  },
  {
    group: "Claims",
    rows: [
      { feature: "Charge capture with CPT and ICD-10", essentials: true, professional: true, billing: true },
      { feature: "Claim scrubbing rules", essentials: "22 rules", professional: "22 rules", billing: "22 rules" },
      { feature: "Electronic submission (837P)", essentials: true, professional: true, billing: true },
      { feature: "Clearinghouse acknowledgements", essentials: true, professional: true, billing: true },
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
      { feature: "Statements in HFMA patient-friendly format", essentials: true, professional: true, billing: true },
      { feature: "Patient A/R tracked separately from insurance", essentials: true, professional: true, billing: true },
      { feature: "Payment plans", essentials: false, professional: true, billing: true },
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
    group: "Security and support",
    rows: [
      { feature: "Business associate agreement", essentials: true, professional: true, billing: true },
      { feature: "Append-only ledger and PHI audit trail", essentials: true, professional: true, billing: true },
      { feature: "Role-based access control", essentials: true, professional: true, billing: true },
      { feature: "Support response target", essentials: "1 business day", professional: "4 business hours", billing: "Per SLA" },
      { feature: "Dedicated onboarding", essentials: false, professional: false, billing: true },
    ],
  },
];

export const FAQ = [
  {
    q: "How is the subscription counted?",
    a: "Per rendering provider, per month. Front desk staff, billers and administrators do not consume a seat, because charging for the people who do the billing work would penalize exactly the behavior the software is meant to encourage.",
  },
  {
    q: "Why is there a per-claim component at all?",
    a: "Cost scales with volume: every claim submitted is a transaction across a clearinghouse connection, and every remittance is one coming back. Splitting the price into a subscription and a transaction line keeps a low-volume practice from subsidizing a high-volume one.",
  },
  {
    q: "What happens to my data if I leave?",
    a: "You export it. Patients, claims, remittances and the full ledger are yours, and the Terms commit us to keeping the export available for 30 days after a subscription ends. Billing data is a legal record, not a lock-in mechanism.",
  },
  {
    q: "Do you sign a business associate agreement?",
    a: "Yes, before any protected health information reaches the platform. A practice is the covered entity and we are its business associate, which is the arrangement HIPAA requires.",
  },
  {
    q: "How long does implementation take?",
    a: "It depends almost entirely on the state of the data being migrated and how many payer enrollments have to be moved. That is the first thing an onboarding call establishes, and we would rather give a real date than a marketing one.",
  },
  {
    q: "Is there a long-term contract?",
    a: "Terms are set in the order form. Ask during the quote and we will tell you plainly what the commitment is before you sign anything.",
  },
];
