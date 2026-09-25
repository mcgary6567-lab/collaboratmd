/**
 * Dental (837D) claims: CDT procedures with tooth, surfaces and area of the
 * mouth, entered as an encounter like any other and then scrubbed with the
 * dental rules and sent as an 837D.
 */
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { createEncounterWithClaim } from "./encounters";
import { rescrubClaim } from "./claims";

const { charges, claims, claimEvents, providers } = schema;

/** Common CDT codes, for the picker. Descriptions are short labels, not the ADA's descriptors. */
export const COMMON_CDT: { code: string; label: string }[] = [
  { code: "D0120", label: "Periodic oral evaluation" },
  { code: "D0140", label: "Limited oral evaluation, problem focused" },
  { code: "D0150", label: "Comprehensive oral evaluation" },
  { code: "D0210", label: "Intraoral radiographs, complete series" },
  { code: "D0274", label: "Bitewings, four images" },
  { code: "D0330", label: "Panoramic radiograph" },
  { code: "D1110", label: "Prophylaxis, adult" },
  { code: "D1120", label: "Prophylaxis, child" },
  { code: "D1208", label: "Topical fluoride" },
  { code: "D1351", label: "Sealant, per tooth" },
  { code: "D2140", label: "Amalgam, one surface" },
  { code: "D2150", label: "Amalgam, two surfaces" },
  { code: "D2330", label: "Resin composite, one surface, anterior" },
  { code: "D2391", label: "Resin composite, one surface, posterior" },
  { code: "D2392", label: "Resin composite, two surfaces, posterior" },
  { code: "D2740", label: "Crown, porcelain/ceramic" },
  { code: "D2950", label: "Core buildup" },
  { code: "D3310", label: "Root canal, anterior" },
  { code: "D3330", label: "Root canal, molar" },
  { code: "D4341", label: "Scaling and root planing, 4+ teeth per quadrant" },
  { code: "D4342", label: "Scaling and root planing, 1-3 teeth per quadrant" },
  { code: "D4910", label: "Periodontal maintenance" },
  { code: "D7140", label: "Extraction, erupted tooth" },
  { code: "D7210", label: "Extraction, surgical" },
];

export type DentalInput = {
  patientId: string;
  providerId: string;
  dateOfService: string;
  placeOfService?: string;
  diagnoses: string[];
  lines: { cdt: string; tooth?: string; surfaces?: string; oralCavity?: string; units: number; chargeCents: number }[];
};

export async function createDentalClaim(db: Db, practiceId: string, input: DentalInput, userId?: string) {
  const lines = input.lines
    .map((l) => ({ cdt: l.cdt.trim().toUpperCase(), tooth: l.tooth?.trim().toUpperCase() || null, surfaces: l.surfaces?.replace(/\s/g, "").toUpperCase() || null, oralCavity: l.oralCavity?.trim() || null, units: Math.max(1, Math.round(l.units) || 1), chargeCents: Math.round(l.chargeCents) }))
    .filter((l) => l.cdt && l.chargeCents > 0);
  if (!lines.length) throw new Error("Add at least one procedure with a fee");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dateOfService)) throw new Error("Enter the date of service");
  const [dentist] = await db.select({ id: providers.id }).from(providers).where(and(eq(providers.id, input.providerId), eq(providers.practiceId, practiceId))).limit(1);
  if (!dentist) throw new Error("Choose the treating dentist");

  const { claim } = await createEncounterWithClaim(db, practiceId, {
    patientId: input.patientId, providerId: dentist.id, dateOfService: input.dateOfService, placeOfService: input.placeOfService || "11",
    diagnoses: input.diagnoses.map((d) => d.trim().toUpperCase()).filter(Boolean),
    lines: lines.map((l) => ({ cpt: l.cdt, modifiers: [], units: l.units, chargeCents: l.chargeCents, dxPointers: [1], description: COMMON_CDT.find((c) => c.code === l.cdt)?.label })),
  }, userId);
  const saved = await db.select().from(charges).where(eq(charges.encounterId, claim.encounterId));
  for (const c of saved) {
    const l = lines[c.lineNumber - 1];
    if (l) await db.update(charges).set({ tooth: l.tooth, surfaces: l.surfaces, oralCavity: l.oralCavity }).where(eq(charges.id, c.id));
  }
  await db.update(claims).set({ claimType: "dental" }).where(eq(claims.id, claim.id));
  await db.insert(claimEvents).values({ claimId: claim.id, status: claim.status, source: "user", message: "Dental claim (837D)" });
  return rescrubClaim(db, claim.id);
}
