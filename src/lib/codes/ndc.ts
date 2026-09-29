/**
 * National Drug Codes on drug lines. The package label prints the NDC in one
 * of three 10-digit layouts (4-4-2, 5-3-2, 5-4-1); claims need the 11-digit
 * 5-4-2 form, made by adding a leading zero to the short segment.
 */

/** Units a quantity of drug is billed in: international units, milliliters, grams, milligrams, each. */
export const NDC_UNITS: [string, string][] = [["UN", "Units (each)"], ["ML", "Milliliters"], ["GR", "Grams"], ["F2", "International units"], ["ME", "Milligrams"]];
const UNIT_CODES = new Set(NDC_UNITS.map(([u]) => u));
export const isNdcUnit = (u: string | null | undefined) => !!u && UNIT_CODES.has(u.toUpperCase());

/** HCPCS drug codes (J-codes): the lines that carry an NDC. */
export const isDrugCode = (code: string) => /^J\d{4}$/.test(code.toUpperCase());

/** The 11-digit NDC from how it is printed, or null when it is not an NDC. */
export function normalizeNdc(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  if (!t) return null;
  const parts = t.split(/[-\s]/).filter(Boolean);
  if (parts.length === 3) {
    const [a, b, c] = parts;
    if (![a, b, c].every((p) => /^\d+$/.test(p))) return null;
    if (a.length === 4 && b.length === 4 && c.length === 2) return `0${a}${b}${c}`;
    if (a.length === 5 && b.length === 3 && c.length === 2) return `${a}0${b}${c}`;
    if (a.length === 5 && b.length === 4 && c.length === 1) return `${a}${b}0${c}`;
    if (a.length === 5 && b.length === 4 && c.length === 2) return `${a}${b}${c}`;
    return null;
  }
  const d = t.replace(/\D/g, "");
  return d.length === 11 ? d : null;
}

/** "12345-6789-01", for showing. */
export const fmtNdc = (ndc: string) => (ndc.length === 11 ? `${ndc.slice(0, 5)}-${ndc.slice(5, 9)}-${ndc.slice(9)}` : ndc);
