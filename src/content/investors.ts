import { TIERS } from "@/content/pricing";

/**
 * Content for the investors page that only the company can supply.
 *
 * TEAM, TRACTION and RAISE start empty, and each section on the page renders
 * only once its data exists. A placeholder founder, an invented pilot or a
 * guessed round size on a fundraising page is a misstatement to an investor,
 * which is a legal problem rather than a design one, so an empty section is
 * hidden instead of faked.
 *
 * To publish one, fill it in here. Nothing else has to change.
 */

export type Person = {
  name: string;
  role: string;
  /** One or two sentences: what they did before that makes them right for this. */
  background: string;
  linkedin?: string;
  /** Path under /public, e.g. "/team/jane.jpg". Initials render without one. */
  photo?: string;
};

export const TEAM: Person[] = [
  // { name: "Jane Doe", role: "Co-founder and CEO", background: "...", linkedin: "https://www.linkedin.com/in/..." },
];

export type Milestone = {
  /** Short and countable: "3 practices in pilot", "12 providers live". */
  label: string;
  detail: string;
};

export const TRACTION: Milestone[] = [
  // { label: "3 practices in pilot", detail: "Orthopedics, family medicine and a behavioral health group in Utah." },
];

export type Raise = {
  /** As you would say it: "$1.5M seed". */
  amount: string;
  /** "SAFE, post-money", "priced seed", etc. */
  instrument: string;
  useOfFunds: { label: string; share: number }[];
} | null;

export const RAISE: Raise = null;

/* ------------------------------------------------------------------ market */

/**
 * Bottom-up addressable market, computed from two published sources and the
 * company's own list price, so it moves when the price does.
 *
 * Applying the AMA's private-practice share to the AAMC's patient-care count
 * combines two surveys with slightly different populations. That is a normal
 * approximation for a sizing figure and the page says so.
 */
export const MARKET = {
  patientCarePhysicians: 866_460,
  patientCareSource: {
    label: "AAMC, U.S. Physician Workforce, 2025 Key Findings (2024 data)",
    url: "https://www.aamc.org/data-reports/data/2025-key-findings",
  },
  privatePracticeShare: 0.422,
  privatePracticeSource: {
    label: "AMA, Physician Practice Characteristics in 2024",
    url: "https://www.ama-assn.org/system/files/2024-prp-pp-characteristics.pdf",
  },
};

/** The plan the market figure is priced at: the recommended one. */
export function marketTier() {
  return TIERS.find((t) => t.featured) ?? TIERS[0];
}

export function privatePracticePhysicians(): number {
  return Math.round(MARKET.patientCarePhysicians * MARKET.privatePracticeShare);
}

/** Annual subscription revenue if every private-practice physician were a customer. Dollars. */
export function subscriptionTam(): number {
  const price = marketTier().priceMonthly ?? 0;
  return privatePracticePhysicians() * price * 12;
}

/* ------------------------------------------------------------- competition */

/**
 * How the category divides, described by approach rather than by attacking a
 * product. Each description is the vendor's public positioning; each claim in
 * the CollaboratMD column is something the running software does.
 */
export const LANDSCAPE = [
  {
    kind: "Enterprise clinical suites",
    examples: "athenahealth",
    approach:
      "Electronic health record, revenue cycle and patient engagement in one platform, built for mid-size and large groups. Billing is one module of a much larger system.",
  },
  {
    kind: "All-in-one practice suites",
    examples: "Tebra, AdvancedMD",
    approach:
      "Charting, scheduling, billing and patient marketing bundled into one subscription for independent practices. Breadth across the practice is the product.",
  },
];

export const DIFFERENTIATORS = [
  "Built around the revenue cycle rather than the chart, so depth goes to claims, remittances and denials",
  "Native X12 generation and parsing, with CARC and RARC preserved on every service line",
  "An append-only financial ledger: corrections post as reversals and history is never rewritten",
  "Every headline metric reported against its industry benchmark, computed in SQL at full ledger scale",
  "Published per-provider pricing, with front desk, billing and admin seats free",
];
