/**
 * Medicare's therapy threshold. Outpatient physical therapy and speech-language
 * pathology count together (modifiers GP and GN), occupational therapy on its
 * own (GO), per patient per calendar year. Above the year's threshold, a claim
 * needs the KX modifier, which attests that the services are medically
 * necessary and documented; above the targeted medical review amount, claims
 * may be reviewed.
 *
 * The amounts change each year, so the platform operator enters them (Code
 * sets); with none entered for the year, nothing is checked. Amounts to date
 * are what Medicare allowed on its 835s where they have come back, and the
 * charge otherwise, so they are an estimate until everything is paid.
 */
import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import type { ScrubFinding } from "@/lib/scrub/rules";

const { therapyThresholds } = schema;

export type Discipline = "pt_slp" | "ot";
export const DISCIPLINE_LABEL: Record<Discipline, string> = { pt_slp: "physical therapy and speech-language pathology", ot: "occupational therapy" };

export const disciplineOf = (modifiers: string[]): Discipline | null => {
  const m = modifiers.map((x) => x.toUpperCase());
  if (m.includes("GO")) return "ot";
  if (m.includes("GP") || m.includes("GN")) return "pt_slp";
  return null;
};

export async function saveThreshold(db: Db, input: { year: number; kxCents: number; reviewCents: number | null }, by: string) {
  if (!Number.isInteger(input.year) || input.year < 2020 || input.year > 2100) throw new Error("Give the calendar year");
  if (!Number.isInteger(input.kxCents) || input.kxCents < 100_000) throw new Error("Enter the KX threshold amount for the year");
  if (input.reviewCents !== null && (!Number.isInteger(input.reviewCents) || input.reviewCents <= input.kxCents)) throw new Error("The review amount is above the KX threshold");
  const values = { year: input.year, kxCents: input.kxCents, reviewCents: input.reviewCents, enteredBy: by.slice(0, 200) };
  await db.insert(therapyThresholds).values(values).onConflictDoUpdate({ target: therapyThresholds.year, set: { kxCents: values.kxCents, reviewCents: values.reviewCents, enteredBy: values.enteredBy, enteredAt: new Date() } });
}

export async function thresholdFor(db: Db, year: number) {
  const [t] = await db.select().from(therapyThresholds).where(eq(therapyThresholds.year, year)).limit(1);
  return t ?? null;
}

/** A Medicare patient's therapy amounts so far in a year, by discipline, leaving out one visit (the one being checked). */
export async function therapyToDate(db: Db, patientId: string, year: number, exceptEncounterId?: string) {
  const { rows } = await db.execute<{ discipline: string; cents: string }>(sql`
    WITH visits AS (
      SELECT DISTINCT e.id FROM encounters e JOIN claims c ON c.encounter_id = e.id JOIN payers py ON py.id = c.payer_id
      WHERE e.patient_id = ${patientId} AND py.type = 'medicare' AND c.status <> 'voided' AND c.frequency_code <> '8'
        AND e.date_of_service >= ${`${year}-01-01`} AND e.date_of_service <= ${`${year}-12-31`}
        ${exceptEncounterId ? sql`AND e.id <> ${exceptEncounterId}` : sql``}
    ),
    lines AS (
      SELECT ch.encounter_id, ch.cpt, ch.units * ch.charge_cents AS charged,
        CASE WHEN ch.modifiers ? 'GO' THEN 'ot' WHEN ch.modifiers ?| array['GP', 'GN'] THEN 'pt_slp' END AS discipline
      FROM charges ch WHERE ch.encounter_id IN (SELECT id FROM visits)
    )
    SELECT l.discipline, sum(COALESCE((
      SELECT sum(rl.allowed_cents) FROM remittance_lines rl JOIN claims c ON c.id = rl.claim_id
      WHERE c.encounter_id = l.encounter_id AND rl.cpt = l.cpt AND c.frequency_code <> '8'
    ), l.charged))::text AS cents
    FROM lines l WHERE l.discipline IS NOT NULL GROUP BY l.discipline`);
  const out: Record<Discipline, number> = { pt_slp: 0, ot: 0 };
  for (const r of rows) out[r.discipline as Discipline] = Number(r.cents);
  return out;
}

export async function therapyFindings(db: Db, c: { patientId: string; encounterId: string; payerType: string; dateOfService: string; lines: { lineNumber: number; cpt: string; modifiers: string[]; units: number; chargeCents: number }[] }): Promise<ScrubFinding[]> {
  if (c.payerType !== "medicare") return [];
  const therapy = c.lines.map((l) => ({ l, d: disciplineOf(l.modifiers) })).filter((x): x is { l: typeof x.l; d: Discipline } => !!x.d);
  if (!therapy.length) return [];
  const year = Number(c.dateOfService.slice(0, 4));
  const t = await thresholdFor(db, year);
  if (!t) return [];
  const before = await therapyToDate(db, c.patientId, year, c.encounterId);
  const out: ScrubFinding[] = [];
  for (const d of ["pt_slp", "ot"] as Discipline[]) {
    const mine = therapy.filter((x) => x.d === d);
    if (!mine.length) continue;
    const after = before[d] + mine.reduce((a, x) => a + x.l.units * x.l.chargeCents, 0);
    const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (after > t.kxCents) {
      const missing = mine.filter((x) => !x.l.modifiers.map((m) => m.toUpperCase()).includes("KX"));
      if (missing.length) out.push({ rule: "THERAPY_KX", severity: "warning", field: `lines.${missing[0].l.lineNumber}.modifiers`, message: `This patient's ${DISCIPLINE_LABEL[d]} for ${year} reaches about ${money(after)}, over Medicare's ${money(t.kxCents)} threshold: add KX to ${missing.map((x) => `line ${x.l.lineNumber}`).join(", ")} if the services are medically necessary and the notes show it. Without KX Medicare denies them.` });
    }
    if (t.reviewCents && after > t.reviewCents) out.push({ rule: "THERAPY_REVIEW", severity: "warning", field: "lines", message: `This patient's ${DISCIPLINE_LABEL[d]} for ${year} is over ${money(t.reviewCents)}, where Medicare may review claims: make sure the plan of care and progress notes support continued therapy.` });
  }
  return out;
}
