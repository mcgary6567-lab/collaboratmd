/**
 * Facility (institutional, UB-04 / 837I) claims: entered with a type of
 * bill, statement period, admission and discharge details and revenue-code
 * lines, then scrubbed with the institutional rules and sent as an 837I.
 */
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import type { Institutional } from "@/lib/edi/x837i";
import { createEncounterWithClaim } from "./encounters";
import { rescrubClaim } from "./claims";

const { charges, claims, claimEvents, providers } = schema;

export const TYPES_OF_BILL: { code: string; label: string }[] = [
  { code: "0111", label: "0111 Hospital inpatient, admit through discharge" },
  { code: "0121", label: "0121 Hospital inpatient, Part B only" },
  { code: "0131", label: "0131 Hospital outpatient" },
  { code: "0141", label: "0141 Hospital, other (non-patient)" },
  { code: "0211", label: "0211 Skilled nursing, inpatient" },
  { code: "0221", label: "0221 Skilled nursing, Part B" },
  { code: "0711", label: "0711 Rural health clinic" },
  { code: "0731", label: "0731 Federally qualified health center" },
  { code: "0741", label: "0741 Outpatient rehabilitation facility" },
  { code: "0751", label: "0751 Comprehensive outpatient rehab (CORF)" },
  { code: "0761", label: "0761 Community mental health center" },
  { code: "0831", label: "0831 Ambulatory surgery center" },
  { code: "0851", label: "0851 Critical access hospital, outpatient" },
];

export const PATIENT_STATUS: { code: string; label: string }[] = [
  { code: "01", label: "01 Discharged home or self care" },
  { code: "02", label: "02 Transferred to a short-term hospital" },
  { code: "03", label: "03 Transferred to skilled nursing" },
  { code: "06", label: "06 Home under home health care" },
  { code: "07", label: "07 Left against medical advice" },
  { code: "20", label: "20 Expired" },
  { code: "30", label: "30 Still a patient" },
  { code: "50", label: "50 Hospice, home" },
  { code: "62", label: "62 Transferred to inpatient rehabilitation" },
];

/** Place of service implied by the type of bill, for reporting alongside professional claims. */
function placeFor(tob: string) {
  const f = tob.padStart(4, "0").slice(1, 3);
  return ({ "11": "21", "12": "21", "13": "22", "14": "22", "21": "31", "22": "31", "71": "72", "73": "50", "74": "62", "75": "62", "76": "53", "83": "24", "85": "22" } as Record<string, string>)[f] ?? "99";
}

export type InstitutionalInput = Institutional & {
  patientId: string;
  attendingProviderId: string;
  diagnoses: string[];
  /** chargeCents is per unit, as on every service line. */
  lines: { revenueCode: string; hcpcs?: string; modifiers?: string[]; units: number; chargeCents: number }[];
};

export async function createInstitutionalClaim(db: Db, practiceId: string, input: InstitutionalInput, userId?: string) {
  const lines = input.lines
    .map((l) => ({ revenueCode: l.revenueCode.replace(/\D/g, "").padStart(4, "0"), hcpcs: (l.hcpcs ?? "").trim().toUpperCase(), modifiers: (l.modifiers ?? []).map((m) => m.trim().toUpperCase()).filter(Boolean), units: Math.max(1, Math.round(l.units) || 1), chargeCents: Math.round(l.chargeCents) }))
    .filter((l) => l.revenueCode !== "0000" && l.chargeCents > 0);
  if (!lines.length) throw new Error("Add at least one revenue line with a charge");
  const diagnoses = input.diagnoses.map((d) => d.trim().toUpperCase()).filter(Boolean);
  if (!diagnoses.length) throw new Error("Enter the principal diagnosis");
  if (!/^\d{4}$/.test(input.typeOfBill)) throw new Error("Choose the type of bill");
  const [attending] = await db.select({ id: providers.id }).from(providers).where(and(eq(providers.id, input.attendingProviderId), eq(providers.practiceId, practiceId))).limit(1);
  if (!attending) throw new Error("Choose the attending provider");

  const { claim } = await createEncounterWithClaim(db, practiceId, {
    patientId: input.patientId, providerId: attending.id, dateOfService: input.statementFrom, placeOfService: placeFor(input.typeOfBill), diagnoses,
    lines: lines.map((l) => ({ cpt: l.hcpcs, modifiers: l.modifiers, units: l.units, chargeCents: l.chargeCents, dxPointers: [1], description: `Revenue ${l.revenueCode}` })),
  }, userId);
  const saved = await db.select().from(charges).where(eq(charges.encounterId, claim.encounterId));
  for (const c of saved) await db.update(charges).set({ revenueCode: lines[c.lineNumber - 1]?.revenueCode ?? null }).where(eq(charges.id, c.id));
  const institutional: Institutional = {
    typeOfBill: input.typeOfBill, statementFrom: input.statementFrom, statementTo: input.statementTo || input.statementFrom,
    admissionDate: input.admissionDate || null, admissionHour: input.admissionHour?.replace(":", "") || null,
    admissionType: input.admissionType || null, admissionSource: input.admissionSource || null,
    patientStatus: input.patientStatus, admittingDiagnosis: input.admittingDiagnosis?.trim().toUpperCase() || null,
  };
  await db.update(claims).set({ claimType: "institutional", institutional }).where(eq(claims.id, claim.id));
  await db.insert(claimEvents).values({ claimId: claim.id, status: claim.status, source: "user", message: `Institutional claim (UB-04, type of bill ${input.typeOfBill})` });
  return rescrubClaim(db, claim.id);
}
