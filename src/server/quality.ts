/**
 * Quality measures reported on claims (MIPS claims-based reporting). Each
 * practice enters the measures it reports from CMS's specifications for the
 * year: which visits count (procedure codes, diagnoses, age) and the quality
 * data codes for met, not met and excluded. Nothing is built in, because the
 * measures and their codes change every year.
 *
 * A claim that qualifies shows the measure; choosing an outcome adds its code
 * as a $0.00 line. The report shows reporting and performance rates.
 */
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { isQualityCode } from "@/lib/codes/quality";
import { PROCEDURE_CODE } from "./code-catalog";
import { editClaim } from "./claim-edit";

const { qualityMeasures, claims, encounters, charges, patients, auditLog } = schema;

export type Outcome = "met" | "not_met" | "excluded";
export type MeasureInput = { number: string; title: string; eligibleCodes: string; dxPrefixes: string; minAge?: number | null; maxAge?: number | null; codes: string };

const list = (v: string) => [...new Set(v.split(/[\s,;]+/).map((x) => x.trim().toUpperCase().replace(".", "")).filter(Boolean))];

/** "G8783, met, Blood pressure screened" lines into the measure's codes. */
export function parseMeasureCodes(text: string) {
  const out: { code: string; outcome: Outcome; label: string }[] = [];
  for (const line of text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    const [code, outcome, ...label] = line.split(",").map((x) => x.trim());
    const o = outcome?.toLowerCase().replace(/[\s-]/g, "_") as Outcome;
    if (!code || !isQualityCode(code)) throw new Error(`${code || "(blank)"} is not a quality data code (CPT II like 3074F, or a G-code)`);
    if (!["met", "not_met", "excluded"].includes(o)) throw new Error(`${code}: say met, not met or excluded`);
    out.push({ code: code.toUpperCase(), outcome: o, label: label.join(", ").slice(0, 120) || code.toUpperCase() });
  }
  if (!out.length) throw new Error("Add at least one quality code");
  return out;
}

export async function saveMeasure(db: Db, practiceId: string, id: string | null, input: MeasureInput, userId?: string) {
  const number = input.number.trim().slice(0, 12);
  const title = input.title.trim().slice(0, 160);
  if (!number || !title) throw new Error("Enter the measure number and title");
  const eligibleCodes = list(input.eligibleCodes);
  if (!eligibleCodes.length || eligibleCodes.some((c) => !PROCEDURE_CODE.test(c))) throw new Error("List the procedure codes of the visits the measure counts (5-character CPT or HCPCS codes)");
  const dxPrefixes = list(input.dxPrefixes);
  const codes = parseMeasureCodes(input.codes);
  const age = (n?: number | null) => (n === null || n === undefined || Number.isNaN(n) ? null : Math.max(0, Math.min(130, Math.round(n))));
  const values = { number, title, eligibleCodes, dxPrefixes, minAge: age(input.minAge), maxAge: age(input.maxAge), codes };
  const [row] = id
    ? await db.update(qualityMeasures).set(values).where(and(eq(qualityMeasures.id, id), eq(qualityMeasures.practiceId, practiceId))).returning()
    : await db.insert(qualityMeasures).values({ practiceId, ...values }).returning();
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "quality_measure_saved", entity: "quality_measure", entityId: row.id, details: { number } });
  return row;
}

export async function setMeasureActive(db: Db, practiceId: string, id: string, active: boolean) {
  await db.update(qualityMeasures).set({ active }).where(and(eq(qualityMeasures.id, id), eq(qualityMeasures.practiceId, practiceId)));
}

export async function listMeasures(db: Db, practiceId: string) {
  return db.select().from(qualityMeasures).where(eq(qualityMeasures.practiceId, practiceId)).orderBy(asc(qualityMeasures.number));
}

const ageOn = (dob: string, day: string) => {
  const [y, m, d] = dob.split("-").map(Number);
  const [Y, M, D] = day.split("-").map(Number);
  return Y - y - (M < m || (M === m && D < d) ? 1 : 0);
};

type Visit = { dob: string; dateOfService: string; diagnoses: string[]; codes: string[] };
type Measure = typeof qualityMeasures.$inferSelect;

/** Whether a visit is in a measure's denominator. */
export function qualifies(m: Pick<Measure, "eligibleCodes" | "dxPrefixes" | "minAge" | "maxAge">, v: Visit) {
  if (!v.codes.some((c) => m.eligibleCodes.includes(c.toUpperCase()))) return false;
  const dx = v.diagnoses.map((d) => d.replace(".", "").toUpperCase());
  if (m.dxPrefixes.length && !dx.some((d) => m.dxPrefixes.some((p) => d.startsWith(p)))) return false;
  const age = ageOn(v.dob, v.dateOfService);
  if (m.minAge !== null && age < m.minAge) return false;
  if (m.maxAge !== null && age > m.maxAge) return false;
  return true;
}

/** The practice's measures a claim qualifies for, and what (if anything) it already reports. */
export async function measuresForClaim(db: Db, practiceId: string, claimId: string) {
  const [row] = await db.select({ claim: claims, enc: encounters, dob: patients.dob }).from(claims)
    .innerJoin(encounters, eq(encounters.id, claims.encounterId)).innerJoin(patients, eq(patients.id, claims.patientId))
    .where(and(eq(claims.id, claimId), eq(claims.practiceId, practiceId))).limit(1);
  if (!row) return [];
  const measures = (await listMeasures(db, practiceId)).filter((m) => m.active);
  if (!measures.length) return [];
  const codes = (await db.select({ cpt: charges.cpt }).from(charges).where(eq(charges.encounterId, row.enc.id))).map((c) => c.cpt.toUpperCase());
  const visit = { dob: row.dob, dateOfService: row.enc.dateOfService, diagnoses: row.enc.diagnoses, codes };
  return measures.filter((m) => qualifies(m, visit)).map((m) => ({ measure: m, reported: m.codes.find((c) => codes.includes(c.code)) ?? null }));
}

/** Adds the chosen outcome's code to the claim as a $0.00 line (the claim is checked again). */
export async function reportMeasure(db: Db, practiceId: string, claimId: string, measureId: string, code: string, userId?: string) {
  const [m] = await db.select().from(qualityMeasures).where(and(eq(qualityMeasures.id, measureId), eq(qualityMeasures.practiceId, practiceId))).limit(1);
  if (!m || !m.codes.some((c) => c.code === code)) throw new Error("That code is not one of the measure's");
  const [row] = await db.select({ claim: claims, enc: encounters }).from(claims).innerJoin(encounters, eq(encounters.id, claims.encounterId)).where(and(eq(claims.id, claimId), eq(claims.practiceId, practiceId))).limit(1);
  if (!row) throw new Error("Claim not found");
  const lines = await db.select().from(charges).where(eq(charges.encounterId, row.enc.id)).orderBy(asc(charges.lineNumber));
  // One outcome per measure: choosing another replaces it.
  const others = new Set(m.codes.map((c) => c.code));
  const kept = lines.filter((l) => !others.has(l.cpt.toUpperCase()));
  const pointer = kept.find((l) => m.eligibleCodes.includes(l.cpt.toUpperCase()))?.dxPointers ?? [1];
  return editClaim(db, practiceId, claimId, {
    dateOfService: row.enc.dateOfService, placeOfService: row.enc.placeOfService, diagnoses: row.enc.diagnoses,
    lines: [...kept.map((l) => ({ cpt: l.cpt, modifiers: l.modifiers, units: l.units, chargeCents: l.chargeCents, dxPointers: l.dxPointers, description: l.description ?? undefined, minutes: l.minutes })),
      { cpt: code, modifiers: [], units: 1, chargeCents: 0, dxPointers: pointer.slice(0, 1), description: `Quality measure ${m.number}` }],
  }, userId);
}

/** For each measure over a period: visits that qualified, how many reported it, and the performance rate. */
export async function qualityReport(db: Db, practiceId: string, from: string, to: string) {
  const measures = await listMeasures(db, practiceId);
  if (!measures.length) return [];
  const visits = await db.select({ encId: encounters.id, dos: encounters.dateOfService, diagnoses: encounters.diagnoses, dob: patients.dob }).from(encounters)
    .innerJoin(patients, eq(patients.id, encounters.patientId))
    .where(and(eq(encounters.practiceId, practiceId), gte(encounters.dateOfService, from), lte(encounters.dateOfService, to)));
  const lines = visits.length ? await db.select({ encId: charges.encounterId, cpt: charges.cpt }).from(charges).where(inArray(charges.encounterId, visits.map((v) => v.encId))) : [];
  const codesBy = new Map<string, string[]>();
  for (const l of lines) codesBy.set(l.encId, [...(codesBy.get(l.encId) ?? []), l.cpt.toUpperCase()]);
  return measures.map((m) => {
    let eligible = 0, met = 0, notMet = 0, excluded = 0;
    for (const v of visits) {
      const codes = codesBy.get(v.encId) ?? [];
      if (!qualifies(m, { dob: v.dob, dateOfService: v.dos, diagnoses: v.diagnoses, codes })) continue;
      eligible++;
      const r = m.codes.find((c) => codes.includes(c.code));
      if (r?.outcome === "met") met++;
      else if (r?.outcome === "not_met") notMet++;
      else if (r?.outcome === "excluded") excluded++;
    }
    const reported = met + notMet + excluded;
    return { measure: m, eligible, reported, met, notMet, excluded, reportingRate: eligible ? reported / eligible : null, performanceRate: met + notMet ? met / (met + notMet) : null };
  });
}
