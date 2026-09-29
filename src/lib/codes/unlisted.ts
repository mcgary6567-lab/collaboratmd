/**
 * Unlisted procedure codes (CPT's "unlisted ... procedure", which end in 99,
 * like 17999 or 64999) and HCPCS "not otherwise classified" codes (like J3490
 * for an unclassified drug) say nothing on their own: the claim must describe
 * the service, in SV101-7 on the 837P and in the shaded part of the line (or
 * box 19) on the CMS-1500, and payers usually want the records too.
 */
const NOC_HCPCS = new Set(["J3490", "J3590", "J7599", "J7699", "J7799", "J8499", "J8999", "J9999", "A9999", "E1399", "L8699", "A4649", "C9399", "Q4100"]);

export function isUnlistedCode(code: string) {
  const c = code.toUpperCase();
  return NOC_HCPCS.has(c) || /^\d{3}99$/.test(c);
}

/** A description safe inside an X12 composite (no separators), at most 80 characters. */
export const claimDescription = (text: string) => text.replace(/[*~:^]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
