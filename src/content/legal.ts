/**
 * The current version of each legal document, as the date it last changed.
 * The pages show this date, acceptances record it, and raising it asks every
 * self-serve practice's administrators to accept the new text on their next
 * visit. Change a date only together with the document it describes.
 */
export const LEGAL_VERSIONS = {
  terms: "2026-09-23",
  privacy: "2026-09-23",
} as const;

export type LegalDocument = keyof typeof LEGAL_VERSIONS;

export const LEGAL_TITLES: Record<LegalDocument, { title: string; href: string }> = {
  terms: { title: "Terms of Service", href: "/terms" },
  privacy: { title: "Privacy Policy", href: "/privacy" },
};

export function versionLabel(v: string) {
  return new Date(`${v}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}
