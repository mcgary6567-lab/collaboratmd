/**
 * Substitute physicians. When a provider is away (illness, vacation, leave),
 * another physician can see their patients and the practice bills under the
 * absent provider's NPI with a modifier on every line:
 *
 *  - Q6: a locum tenens physician paid by the practice (fee-for-time).
 *  - Q5: a reciprocal arrangement with another physician (no payment between them).
 *
 * Medicare allows this for up to 60 continuous days of the substitute's
 * services in one absence (Social Security Act 1842(b)(6)(D)); after that the
 * substitute must enroll and bill under their own NPI. The practice must keep
 * a record of each service with the substitute's NPI, which is what the
 * arrangement and the encounter's link to it are.
 */
import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import type { ScrubFinding } from "@/lib/scrub/rules";

const { substituteArrangements, encounters, charges, claims, providers, auditLog } = schema;

export const KINDS = { locum: { label: "Locum tenens (paid substitute)", modifier: "Q6" }, reciprocal: { label: "Reciprocal arrangement", modifier: "Q5" } } as const;
export const MEDICARE_DAYS = 60;

const isDay = (v: string | undefined | null) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

export async function saveArrangement(db: Db, practiceId: string, input: { absentProviderId: string; kind: string; substituteName: string; substituteNpi: string; startsOn: string; endsOn: string; notes?: string }, userId?: string) {
  const [prov] = await db.select({ id: providers.id }).from(providers).where(and(eq(providers.id, input.absentProviderId), eq(providers.practiceId, practiceId))).limit(1);
  if (!prov) throw new Error("Choose the absent provider");
  if (!(input.kind in KINDS)) throw new Error("Choose locum tenens or reciprocal");
  const name = input.substituteName.trim().slice(0, 120);
  if (!name) throw new Error("Enter the substitute physician's name");
  if (!/^\d{10}$/.test(input.substituteNpi.trim())) throw new Error("The substitute's NPI is 10 digits");
  if (!isDay(input.startsOn) || !isDay(input.endsOn) || input.endsOn < input.startsOn) throw new Error("Enter the first and last day of the absence");
  const [row] = await db.insert(substituteArrangements).values({
    practiceId, absentProviderId: input.absentProviderId, kind: input.kind, substituteName: name, substituteNpi: input.substituteNpi.trim(),
    startsOn: input.startsOn, endsOn: input.endsOn, notes: input.notes?.trim().slice(0, 500) || null, createdBy: userId ?? null,
  }).returning();
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "substitute_arrangement_saved", entity: "provider", entityId: input.absentProviderId, details: { kind: input.kind, substituteNpi: row.substituteNpi, startsOn: input.startsOn, endsOn: input.endsOn } });
  return { arrangement: row, overMedicareLimit: daysBetween(input.startsOn, input.endsOn) + 1 > MEDICARE_DAYS };
}

export async function listArrangements(db: Db, practiceId: string) {
  return db.select({ a: substituteArrangements, firstName: providers.firstName, lastName: providers.lastName }).from(substituteArrangements)
    .innerJoin(providers, eq(providers.id, substituteArrangements.absentProviderId))
    .where(eq(substituteArrangements.practiceId, practiceId)).orderBy(desc(substituteArrangements.startsOn)).limit(200);
}

/** Arrangements covering a provider on a date of service. */
export async function arrangementsOn(db: Db, providerId: string, dateOfService: string) {
  return db.select().from(substituteArrangements)
    .where(and(eq(substituteArrangements.absentProviderId, providerId), lte(substituteArrangements.startsOn, dateOfService), gte(substituteArrangements.endsOn, dateOfService)))
    .orderBy(asc(substituteArrangements.startsOn));
}

/**
 * Marks a claim's visit as seen by the substitute: the encounter records the
 * arrangement and every line gets Q6 or Q5. Refused for a date outside the
 * arrangement, or past Medicare's 60 days.
 */
export async function applySubstitute(db: Db, practiceId: string, claimId: string, arrangementId: string | null, userId?: string) {
  const [row] = await db.select({ claim: claims, encounter: encounters, payerType: schema.payers.type }).from(claims)
    .innerJoin(encounters, eq(encounters.id, claims.encounterId)).innerJoin(schema.payers, eq(schema.payers.id, claims.payerId))
    .where(and(eq(claims.id, claimId), eq(claims.practiceId, practiceId))).limit(1);
  if (!row) throw new Error("Claim not found");
  if (!["draft", "ready", "scrub_errors", "rejected"].includes(row.claim.status)) throw new Error("Only a claim that has not been sent can be changed");
  const lines = await db.select().from(charges).where(eq(charges.encounterId, row.encounter.id));
  const strip = (m: string[]) => m.filter((x) => x !== "Q5" && x !== "Q6");
  if (!arrangementId) {
    for (const l of lines) await db.update(charges).set({ modifiers: strip(l.modifiers) }).where(eq(charges.id, l.id));
    await db.update(encounters).set({ substituteId: null }).where(eq(encounters.id, row.encounter.id));
    await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "substitute_removed", entity: "claim", entityId: claimId });
    return;
  }
  const [a] = await db.select().from(substituteArrangements).where(and(eq(substituteArrangements.id, arrangementId), eq(substituteArrangements.practiceId, practiceId))).limit(1);
  if (!a) throw new Error("Arrangement not found");
  if (a.absentProviderId !== row.encounter.providerId) throw new Error("The arrangement is for a different provider than the claim's");
  const dos = row.encounter.dateOfService;
  if (dos < a.startsOn || dos > a.endsOn) throw new Error(`The visit (${dos}) is outside the arrangement (${a.startsOn} to ${a.endsOn})`);
  if (row.payerType === "medicare" && daysBetween(a.startsOn, dos) + 1 > MEDICARE_DAYS) throw new Error(`Medicare allows a substitute for ${MEDICARE_DAYS} continuous days; this visit is day ${daysBetween(a.startsOn, dos) + 1}. The substitute must bill under their own enrollment.`);
  const modifier = KINDS[a.kind as keyof typeof KINDS].modifier;
  for (const l of lines) {
    const mods = strip(l.modifiers);
    if (mods.length >= 4) throw new Error(`Line ${l.lineNumber} already has four modifiers`);
    await db.update(charges).set({ modifiers: [...mods, modifier] }).where(eq(charges.id, l.id));
  }
  await db.update(encounters).set({ substituteId: a.id }).where(eq(encounters.id, row.encounter.id));
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "substitute_applied", entity: "claim", entityId: claimId, details: { arrangementId, modifier, substituteNpi: a.substituteNpi } });
}

/** Scrub: Q5 or Q6 without a covering arrangement on record, or past Medicare's 60 days. */
export async function substituteFindings(db: Db, c: { providerId: string; substituteId: string | null; payerType: string; dateOfService: string; lines: { lineNumber: number; modifiers: string[] }[] }): Promise<ScrubFinding[]> {
  const flagged = c.lines.filter((l) => l.modifiers.some((m) => m === "Q5" || m === "Q6"));
  if (!flagged.length) return [];
  const [a] = c.substituteId ? await db.select().from(substituteArrangements).where(eq(substituteArrangements.id, c.substituteId)).limit(1) : [];
  if (!a || a.absentProviderId !== c.providerId || c.dateOfService < a.startsOn || c.dateOfService > a.endsOn) {
    return [{ rule: "SUBSTITUTE_RECORD", severity: "warning", field: `lines.${flagged[0].lineNumber}.modifiers`, message: "Q5 or Q6 is on this claim, but no substitute arrangement covering the provider on this date is linked to the visit. Record the substitute physician and their NPI under Substitute physicians, then mark the visit from the claim." }];
  }
  const day = daysBetween(a.startsOn, c.dateOfService) + 1;
  if (c.payerType === "medicare" && day > MEDICARE_DAYS) {
    return [{ rule: "SUBSTITUTE_60_DAYS", severity: "error", field: "lines", message: `Day ${day} of the substitute's coverage: Medicare allows ${MEDICARE_DAYS} continuous days. Bill under the substitute's own enrollment instead.` }];
  }
  const modifier = KINDS[a.kind as keyof typeof KINDS].modifier;
  const wrong = flagged.find((l) => !l.modifiers.includes(modifier));
  return wrong ? [{ rule: "SUBSTITUTE_MODIFIER", severity: "warning", field: `lines.${wrong.lineNumber}.modifiers`, message: `The arrangement is ${a.kind === "locum" ? "locum tenens (Q6)" : "reciprocal (Q5)"}; line ${wrong.lineNumber} has the other modifier.` }] : [];
}
