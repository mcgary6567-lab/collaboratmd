/**
 * Scrubber rules for dental (837D) claims: CDT code format, tooth numbers in
 * the Universal National Tooth Designation System, surfaces, and the area of
 * the mouth for procedures billed by quadrant or arch.
 */
import type { ScrubFinding } from "./rules";
import { isValidNpi } from "./rules";

export type DentalScrubInput = {
  billingNpi: string;
  renderingNpi: string;
  memberId: string;
  payerId: string;
  dateOfService: string;
  lines: { lineNumber: number; cdt: string; tooth: string | null; surfaces: string | null; oralCavity: string | null; units: number; chargeCents: number }[];
  today?: string;
};

/** Permanent teeth 1-32, primary teeth A-T, supernumerary 51-82 and AS-TS. */
export function isValidTooth(t: string) {
  const s = t.trim().toUpperCase();
  if (/^\d{1,2}$/.test(s)) { const n = Number(s); return (n >= 1 && n <= 32) || (n >= 51 && n <= 82); }
  return /^[A-T]$/.test(s) || /^[A-T]S$/.test(s);
}

/** M mesial, O occlusal, D distal, B buccal, L lingual, I incisal, F facial. */
export const SURFACES = "MODBLIF";
/** Oral cavity areas (SV304): 00 whole mouth, 01 maxillary arch, 02 mandibular arch, 10/20/30/40 quadrants (UR, UL, LL, LR). */
export const ORAL_CAVITY = ["00", "01", "02", "09", "10", "20", "30", "40"];

/** Surface restorations: amalgam D2140-D2161, composite D2330-D2335 and D2391-D2394, inlays and onlays D2510-D2664. */
const needsSurface = (cdt: string) => /^D2(1[4-6]\d|33[0-5]|39[1-4]|5[1-6]\d|6[1-6]\d)$/.test(cdt);
/** Done on one tooth: restorative and crowns (D2xxx), endodontics (D31xx-D34xx), extractions (D7111-D7250), an implant (D6010). */
const needsTooth = (cdt: string) => cdt !== "D2999" && /^D(2\d{3}|3[1-4]\d\d|71[1-4]\d|72[1-5]\d|6010)$/.test(cdt);
/** Billed per quadrant: scaling and root planing (D4341, D4342), gingivectomy (D4210, D4211), osseous surgery (D4260, D4261). */
const needsQuadrant = (cdt: string) => /^D(434[12]|421[01]|426[01])$/.test(cdt);
/** Complete and partial dentures: the code names the arch, and some payers also want it as the area. */
const archDenture = (cdt: string) => /^D5(1[1-4]0|2[12][1-4])$/.test(cdt);

export function scrubDental(c: DentalScrubInput): ScrubFinding[] {
  const out: ScrubFinding[] = [];
  const err = (rule: string, message: string, field?: string) => out.push({ rule, severity: "error", message, field });
  const warn = (rule: string, message: string, field?: string) => out.push({ rule, severity: "warning", message, field });
  const today = c.today ?? new Date().toISOString().slice(0, 10);
  if (!isValidNpi(c.billingNpi)) err("BILLING_NPI", "The practice's NPI fails its check digit", "practice.npi");
  if (!isValidNpi(c.renderingNpi)) err("RENDERING_NPI", "The treating dentist's NPI fails its check digit", "provider.npi");
  if (!c.memberId.trim()) err("MEMBER_ID", "The patient's member ID is missing", "insurance.memberId");
  if (!c.payerId.trim()) err("PAYER_ID", "The payer has no clearinghouse payer ID", "payer.payerId");
  if (c.dateOfService > today) err("DOS_FUTURE", "The date of service is in the future", "encounter.dateOfService");
  if (!c.lines.length) err("NO_LINES", "Add at least one procedure");
  const seen = new Set<string>();
  for (const l of c.lines) {
    const cdt = l.cdt.trim().toUpperCase();
    const f = (x: string) => `lines.${l.lineNumber}.${x}`;
    if (!/^D\d{4}$/.test(cdt)) { err("CDT_FORMAT", `Line ${l.lineNumber}: "${l.cdt}" is not a CDT code (D followed by four digits)`, f("cdt")); continue; }
    if (l.chargeCents <= 0) err("LINE_CHARGE", `Line ${l.lineNumber}: enter the fee`, f("charge"));
    if (l.tooth && !isValidTooth(l.tooth)) err("TOOTH", `Line ${l.lineNumber}: "${l.tooth}" is not a tooth number (1-32, A-T, or supernumerary 51-82, AS-TS)`, f("tooth"));
    if (!l.tooth && needsTooth(cdt)) err("TOOTH_REQUIRED", `Line ${l.lineNumber}: ${cdt} is done on a tooth; enter the tooth number`, f("tooth"));
    const surfaces = (l.surfaces ?? "").toUpperCase().replace(/\s/g, "");
    if (surfaces) {
      if ([...surfaces].some((ch) => !SURFACES.includes(ch))) err("SURFACE_CODE", `Line ${l.lineNumber}: surfaces use M, O, D, B, L, I and F`, f("surfaces"));
      if (new Set(surfaces).size !== surfaces.length) err("SURFACE_REPEAT", `Line ${l.lineNumber}: a surface is listed twice`, f("surfaces"));
      if (surfaces.length > 5) err("SURFACE_COUNT", `Line ${l.lineNumber}: at most five surfaces`, f("surfaces"));
      if (!l.tooth) err("SURFACE_NO_TOOTH", `Line ${l.lineNumber}: surfaces need a tooth number`, f("tooth"));
    } else if (needsSurface(cdt)) err("SURFACE_REQUIRED", `Line ${l.lineNumber}: ${cdt} is a restoration; enter the surfaces treated`, f("surfaces"));
    const areas = (l.oralCavity ?? "").split(/[\s,:]+/).filter(Boolean);
    if (areas.some((a) => !ORAL_CAVITY.includes(a))) err("ORAL_CAVITY", `Line ${l.lineNumber}: area of the mouth must be 00, 01, 02, 09, 10, 20, 30 or 40`, f("oralCavity"));
    if (needsQuadrant(cdt) && !areas.some((a) => ["10", "20", "30", "40"].includes(a))) err("QUADRANT_REQUIRED", `Line ${l.lineNumber}: ${cdt} is billed per quadrant; enter 10, 20, 30 or 40`, f("oralCavity"));
    if (archDenture(cdt) && !areas.some((a) => ["01", "02"].includes(a))) warn("ARCH", `Line ${l.lineNumber}: some payers want the arch (01 upper, 02 lower) for ${cdt}`, f("oralCavity"));
    const key = `${cdt}|${l.tooth ?? ""}|${surfaces}|${areas.join(",")}`;
    if (seen.has(key)) warn("DUPLICATE_LINE", `Line ${l.lineNumber}: the same procedure on the same tooth and surfaces appears twice`, f("cdt"));
    seen.add(key);
  }
  return out;
}
