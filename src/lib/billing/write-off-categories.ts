/** Why a balance is written off (server/write-offs.ts analyses them). Shared with the forms that ask. */
export const WRITE_OFF_CATEGORIES: Record<string, { label: string; kind: "avoidable" | "policy" | "neutral" }> = {
  timely_filing: { label: "Timely filing", kind: "avoidable" },
  authorization: { label: "No authorization", kind: "avoidable" },
  eligibility: { label: "Not covered on the date / wrong payer", kind: "avoidable" },
  coding: { label: "Coding or billing error", kind: "avoidable" },
  medical_necessity: { label: "Medical necessity", kind: "avoidable" },
  small_balance: { label: "Small balance", kind: "policy" },
  courtesy: { label: "Courtesy or administrative", kind: "policy" },
  uncollectible: { label: "Uncollectible, not sent to collections", kind: "policy" },
  duplicate: { label: "Duplicate claim (paid on another)", kind: "neutral" },
  void: { label: "Charge removed (claim voided)", kind: "neutral" },
  other: { label: "Other", kind: "avoidable" },
};

export const KIND_LABELS = { contractual: "Contractual (payer contract)", avoidable: "Avoidable write-offs", policy: "Policy write-offs and discounts", collections: "Sent to collections", neutral: "No revenue lost" } as const;
