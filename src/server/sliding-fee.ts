/**
 * Sliding fee scale (health centers, charity care). A patient's household
 * income as a percent of the federal poverty guideline for their household
 * size puts them in a tier, and the tier's discount applies to what they owe.
 *
 * The practice enters the year's HHS poverty guidelines and its own tiers
 * (its board-approved schedule); nothing here is assumed. Eligibility is
 * recorded with the proof seen and lasts a year unless the practice says
 * otherwise; the discount then posts to each claim's patient share.
 */
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";

const { povertyGuidelines, slidingFeeTiers, patientSlidingFees, ledgerEntries, auditLog } = schema;

const NOTE = "Sliding fee discount";
const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

export async function saveGuidelines(db: Db, practiceId: string, input: { year: number; baseCents: number; perPersonCents: number }) {
  if (!Number.isInteger(input.year) || input.year < 2020 || input.year > 2100) throw new Error("Enter the guidelines' year");
  if (!(input.baseCents > 0) || !(input.perPersonCents > 0)) throw new Error("Enter the guideline for a household of one and the amount for each additional person");
  await db.insert(povertyGuidelines).values({ practiceId, ...input }).onConflictDoUpdate({ target: [povertyGuidelines.practiceId, povertyGuidelines.year], set: { baseCents: input.baseCents, perPersonCents: input.perPersonCents } });
}

export async function saveTiers(db: Db, practiceId: string, tiers: { maxPercent: number; discountPercent: number; label?: string }[]) {
  const clean = tiers.filter((t) => t.maxPercent > 0).sort((a, b) => a.maxPercent - b.maxPercent);
  for (const t of clean) {
    if (!Number.isInteger(t.maxPercent) || t.maxPercent > 1000) throw new Error("Tier limits are whole percents of the poverty guideline, like 100 or 200");
    if (!Number.isInteger(t.discountPercent) || t.discountPercent < 0 || t.discountPercent > 100) throw new Error("Discounts are whole percents from 0 to 100");
  }
  await db.delete(slidingFeeTiers).where(eq(slidingFeeTiers.practiceId, practiceId));
  if (clean.length) await db.insert(slidingFeeTiers).values(clean.map((t) => ({ practiceId, maxPercent: t.maxPercent, discountPercent: t.discountPercent, label: t.label?.trim().slice(0, 60) || null })));
}

export async function slidingFeeSetup(db: Db, practiceId: string) {
  const [guidelines, tiers] = await Promise.all([
    db.select().from(povertyGuidelines).where(eq(povertyGuidelines.practiceId, practiceId)).orderBy(desc(povertyGuidelines.year)),
    db.select().from(slidingFeeTiers).where(eq(slidingFeeTiers.practiceId, practiceId)).orderBy(slidingFeeTiers.maxPercent),
  ]);
  return { guidelines, tiers };
}

/** Pure: percent of the poverty guideline, and the tier's discount (0 above the scale). */
export function slidingFeeFor(g: { baseCents: number; perPersonCents: number }, tiers: { maxPercent: number; discountPercent: number }[], householdSize: number, annualIncomeCents: number) {
  const guideline = g.baseCents + g.perPersonCents * (householdSize - 1);
  const percent = Math.floor((annualIncomeCents / guideline) * 100);
  const tier = [...tiers].sort((a, b) => a.maxPercent - b.maxPercent).find((t) => percent <= t.maxPercent);
  return { percent, discountPercent: tier?.discountPercent ?? 0 };
}

/**
 * Records a verified income. The discount posts now only when `apply` is true
 * (the user may adjust money); otherwise the daily job posts it from the
 * practice's approved tiers.
 */
export async function recordSlidingFee(db: Db, practiceId: string, patientId: string, input: { householdSize: number; annualIncomeCents: number; proof: string; verifiedOn: string; expiresOn?: string }, userId?: string, opts: { apply?: boolean } = { apply: true }) {
  if (!Number.isInteger(input.householdSize) || input.householdSize < 1 || input.householdSize > 20) throw new Error("Enter the household size");
  if (!Number.isInteger(input.annualIncomeCents) || input.annualIncomeCents < 0) throw new Error("Enter the household's yearly income");
  const proof = input.proof.trim().slice(0, 200);
  if (!proof) throw new Error("Say what proof of income was seen (tax return, pay stubs, attestation)");
  if (!isDay(input.verifiedOn)) throw new Error("Enter the date income was verified");
  const expiresOn = input.expiresOn && isDay(input.expiresOn) ? input.expiresOn : new Date(Date.parse(`${input.verifiedOn}T12:00:00Z`) + 365 * 86_400_000).toISOString().slice(0, 10);
  const year = Number(input.verifiedOn.slice(0, 4));
  const [g] = await db.select().from(povertyGuidelines).where(and(eq(povertyGuidelines.practiceId, practiceId), lte(povertyGuidelines.year, year))).orderBy(desc(povertyGuidelines.year)).limit(1);
  if (!g) throw new Error("Enter the poverty guidelines first (Settings, Sliding fee scale)");
  const tiers = await db.select().from(slidingFeeTiers).where(eq(slidingFeeTiers.practiceId, practiceId));
  if (!tiers.length) throw new Error("Set up the discount tiers first (Settings, Sliding fee scale)");
  const r = slidingFeeFor(g, tiers, input.householdSize, input.annualIncomeCents);
  const values = { practiceId, householdSize: input.householdSize, annualIncomeCents: input.annualIncomeCents, percentOfPoverty: r.percent, discountPercent: r.discountPercent, proof, verifiedOn: input.verifiedOn, expiresOn, recordedBy: userId ?? null };
  await db.insert(patientSlidingFees).values({ patientId, ...values }).onConflictDoUpdate({ target: patientSlidingFees.patientId, set: values });
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "sliding_fee_recorded", entity: "patient", entityId: patientId, details: { percentOfPoverty: r.percent, discountPercent: r.discountPercent, guidelinesYear: g.year } });
  const posted = r.discountPercent && opts.apply !== false ? await applySlidingFee(db, practiceId, patientId, userId) : 0;
  return { ...r, expiresOn, posted };
}

export async function slidingFeeOf(db: Db, patientId: string) {
  const [row] = await db.select().from(patientSlidingFees).where(eq(patientSlidingFees.patientId, patientId)).limit(1);
  return row ?? null;
}

/**
 * Posts the discount on each claim's patient share that arose while the
 * patient was eligible, less what was already discounted, so it can run any
 * number of times.
 */
export async function applySlidingFee(db: Db, practiceId: string, patientId: string, userId?: string) {
  const fee = await slidingFeeOf(db, patientId);
  if (!fee || fee.practiceId !== practiceId || !fee.discountPercent) return 0;
  const { rows } = await db.execute<{ claim_id: string; owed: string; discounted: string }>(sql`
    SELECT claim_id,
      COALESCE(sum(amount_cents) FILTER (WHERE type = 'transfer_to_patient' AND posted_at::date BETWEEN ${fee.verifiedOn} AND ${fee.expiresOn}), 0)::text AS owed,
      COALESCE(sum(amount_cents) FILTER (WHERE type = 'discount' AND note LIKE ${`${NOTE}%`}), 0)::text AS discounted
    FROM ledger_entries WHERE practice_id = ${practiceId} AND patient_id = ${patientId} AND claim_id IS NOT NULL
    GROUP BY claim_id`);
  let posted = 0;
  for (const r of rows) {
    const due = Math.round((Number(r.owed) * fee.discountPercent) / 100) - Number(r.discounted);
    if (due <= 0) continue;
    await db.insert(ledgerEntries).values({ practiceId, patientId, claimId: r.claim_id, type: "discount", amountCents: due, note: `${NOTE} (${fee.discountPercent}%, ${fee.percentOfPoverty}% of poverty guideline)`, postedBy: userId ?? null });
    posted += due;
  }
  return posted;
}

/** Daily: the discount for every patient whose eligibility is current. */
export async function applySlidingFees(db: Db, practiceId: string, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const current = await db.select({ patientId: patientSlidingFees.patientId }).from(patientSlidingFees)
    .where(and(eq(patientSlidingFees.practiceId, practiceId), gte(patientSlidingFees.expiresOn, today), sql`${patientSlidingFees.discountPercent} > 0`));
  let cents = 0;
  for (const p of current) cents += await applySlidingFee(db, practiceId, p.patientId);
  return { patients: current.length, cents };
}
