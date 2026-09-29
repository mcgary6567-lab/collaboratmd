/**
 * Monthly care programs: chronic care management (CCM), behavioral health
 * integration (BHI) and remote patient monitoring treatment management (RPM).
 * Time is logged through the calendar month and billed once, after the month
 * ends, as the base code when the minimum time is met plus add-on units for
 * each further block. The patient's consent must be on file first.
 *
 * The codes and time thresholds are CPT's; the add-on caps follow CMS's
 * medically unlikely edits, which the NCCI check confirms when loaded. Check
 * each payer's own policy for anything beyond Medicare.
 */
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { createEncounterWithClaim } from "./encounters";
import { standardCharges } from "./fees";

const { careMinutes, careProgramConsents, auditLog, providers } = schema;

export type CareProgram = {
  label: string;
  base: { code: string; minutes: number };
  addOn: { code: string; minutes: number; max: number } | null;
  /** Programs of which only one may be billed for a patient in a month. */
  excludes?: string[];
};

export const CARE_PROGRAMS: Record<string, CareProgram> = {
  ccm: { label: "Chronic care management, clinical staff (99490 + 99439)", base: { code: "99490", minutes: 20 }, addOn: { code: "99439", minutes: 20, max: 2 }, excludes: ["ccm_physician"] },
  ccm_physician: { label: "Chronic care management, by the physician or practitioner (99491)", base: { code: "99491", minutes: 30 }, addOn: null, excludes: ["ccm"] },
  bhi: { label: "Behavioral health integration (99484)", base: { code: "99484", minutes: 20 }, addOn: null },
  rpm: { label: "Remote monitoring treatment management (99457 + 99458)", base: { code: "99457", minutes: 20 }, addOn: { code: "99458", minutes: 20, max: 2 } },
};

/** Pure: the lines a month's minutes earn. */
export function unitsFor(programKey: string, minutes: number): { code: string; units: number }[] {
  const p = CARE_PROGRAMS[programKey];
  if (!p || minutes < p.base.minutes) return [];
  const lines = [{ code: p.base.code, units: 1 }];
  if (p.addOn) {
    const extra = Math.min(p.addOn.max, Math.floor((minutes - p.base.minutes) / p.addOn.minutes));
    if (extra > 0) lines.push({ code: p.addOn.code, units: extra });
  }
  return lines;
}

const program = (key: string) => {
  const p = CARE_PROGRAMS[key];
  if (!p) throw new Error("Choose the care program");
  return p;
};
const lastDay = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

export async function recordCareConsent(db: Db, practiceId: string, patientId: string, programKey: string, consentedOn: string, userId?: string) {
  program(programKey);
  if (!isDay(consentedOn) || consentedOn > new Date().toISOString().slice(0, 10)) throw new Error("Enter the date the patient consented");
  await db.insert(careProgramConsents).values({ practiceId, patientId, program: programKey, consentedOn, recordedBy: userId ?? null })
    .onConflictDoUpdate({ target: [careProgramConsents.patientId, careProgramConsents.program], set: { consentedOn, recordedBy: userId ?? null } });
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "care_consent", entity: "patient", entityId: patientId, details: { program: programKey, consentedOn } });
}

export async function logCareMinutes(db: Db, practiceId: string, input: { patientId: string; providerId: string; program: string; performedOn: string; minutes: number; note?: string }, userId?: string) {
  program(input.program);
  if (!isDay(input.performedOn) || input.performedOn > new Date().toISOString().slice(0, 10)) throw new Error("Enter the date the time was spent (not in the future)");
  if (!Number.isInteger(input.minutes) || input.minutes < 1 || input.minutes > 240) throw new Error("Enter the minutes spent, 1 to 240");
  const [prov] = await db.select({ id: providers.id }).from(providers).where(and(eq(providers.id, input.providerId), eq(providers.practiceId, practiceId))).limit(1);
  if (!prov) throw new Error("Choose the billing practitioner");
  const month = input.performedOn.slice(0, 7);
  const [billed] = await db.select({ id: careMinutes.id }).from(careMinutes).where(and(eq(careMinutes.patientId, input.patientId), eq(careMinutes.program, input.program), eq(careMinutes.month, month), sql`${careMinutes.claimId} IS NOT NULL`)).limit(1);
  if (billed) throw new Error(`${month} is already billed for this program; time for it can no longer be added`);
  const [row] = await db.insert(careMinutes).values({ practiceId, patientId: input.patientId, providerId: input.providerId, program: input.program, month, performedOn: input.performedOn, minutes: input.minutes, note: input.note?.trim().slice(0, 300) || null, loggedBy: userId ?? null }).returning();
  return row;
}

/** Each program and month for a patient: minutes, what they earn, and whether billed. */
export async function careMonths(db: Db, practiceId: string, patientId: string) {
  const [rows, consents] = await Promise.all([
    db.select().from(careMinutes).where(and(eq(careMinutes.practiceId, practiceId), eq(careMinutes.patientId, patientId))).orderBy(asc(careMinutes.performedOn)),
    db.select().from(careProgramConsents).where(and(eq(careProgramConsents.practiceId, practiceId), eq(careProgramConsents.patientId, patientId))),
  ]);
  const months = new Map<string, { program: string; month: string; minutes: number; claimId: string | null; entries: typeof rows }>();
  for (const r of rows) {
    const key = `${r.program}|${r.month}`;
    const m = months.get(key) ?? { program: r.program, month: r.month, minutes: 0, claimId: null, entries: [] };
    m.minutes += r.minutes;
    m.claimId = m.claimId ?? r.claimId;
    m.entries.push(r);
    months.set(key, m);
  }
  const today = new Date().toISOString().slice(0, 10);
  return {
    consents,
    months: [...months.values()].sort((a, b) => b.month.localeCompare(a.month) || a.program.localeCompare(b.program)).map((m) => ({
      ...m, lines: unitsFor(m.program, m.minutes), ended: lastDay(m.month) < today,
    })),
  };
}

/**
 * Bills a finished month: one claim dated the month's last day, under the
 * practitioner who logged the most time, at the practice's standard charges.
 */
export async function billCareMonth(db: Db, practiceId: string, input: { patientId: string; program: string; month: string; diagnoses: string[] }, userId?: string, today = new Date()) {
  const p = program(input.program);
  if (!/^\d{4}-\d{2}$/.test(input.month)) throw new Error("Choose the month");
  const end = lastDay(input.month);
  if (end >= today.toISOString().slice(0, 10)) throw new Error(`${input.month} has not ended yet: bill it from ${end} on, once all of its time is logged`);
  const diagnoses = input.diagnoses.map((d) => d.trim().toUpperCase()).filter(Boolean);
  if (!diagnoses.length) throw new Error("Enter the conditions being managed");
  if (input.program.startsWith("ccm") && diagnoses.length < 2) throw new Error("Chronic care management needs two or more chronic conditions: enter them");
  const [consent] = await db.select().from(careProgramConsents).where(and(eq(careProgramConsents.patientId, input.patientId), eq(careProgramConsents.program, input.program), eq(careProgramConsents.practiceId, practiceId))).limit(1);
  if (!consent || consent.consentedOn > end) throw new Error("The patient's consent to this program is not on file for this month: record it first");
  const entries = await db.select().from(careMinutes).where(and(eq(careMinutes.practiceId, practiceId), eq(careMinutes.patientId, input.patientId), eq(careMinutes.program, input.program), eq(careMinutes.month, input.month)));
  if (entries.some((e) => e.claimId)) throw new Error(`${input.month} is already billed for this program`);
  for (const other of p.excludes ?? []) {
    const [billed] = await db.select({ id: careMinutes.id }).from(careMinutes).where(and(eq(careMinutes.patientId, input.patientId), eq(careMinutes.program, other), eq(careMinutes.month, input.month), sql`${careMinutes.claimId} IS NOT NULL`)).limit(1);
    if (billed) throw new Error(`${CARE_PROGRAMS[other].label.split(" (")[0]} is already billed for ${input.month}: only one of them may be billed for a patient in a month`);
  }
  const minutes = entries.reduce((a, e) => a + e.minutes, 0);
  const lines = unitsFor(input.program, minutes);
  if (!lines.length) throw new Error(`${minutes} minutes logged; ${p.base.code} needs at least ${p.base.minutes}`);
  const byProvider = new Map<string, number>();
  for (const e of entries) byProvider.set(e.providerId, (byProvider.get(e.providerId) ?? 0) + e.minutes);
  const providerId = [...byProvider].sort((a, b) => b[1] - a[1])[0][0];
  const fees = await standardCharges(db, practiceId);
  const missing = lines.filter((l) => !fees.get(l.code));
  if (missing.length) throw new Error(`Add a standard charge for ${missing.map((l) => l.code).join(" and ")} under Fee schedules first`);
  const { claim } = await createEncounterWithClaim(db, practiceId, {
    patientId: input.patientId, providerId, dateOfService: end, placeOfService: "11", diagnoses,
    lines: lines.map((l) => ({ cpt: l.code, modifiers: [], units: l.units, chargeCents: fees.get(l.code)!, dxPointers: diagnoses.slice(0, 4).map((_, i) => i + 1), description: `${p.label.split(" (")[0]}, ${input.month}: ${minutes} minutes` })),
  }, userId);
  await db.update(careMinutes).set({ claimId: claim.id }).where(and(eq(careMinutes.patientId, input.patientId), eq(careMinutes.program, input.program), eq(careMinutes.month, input.month), isNull(careMinutes.claimId)));
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "care_month_billed", entity: "claim", entityId: claim.id, details: { program: input.program, month: input.month, minutes } });
  return { claim, minutes, lines };
}
