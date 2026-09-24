import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";

const { feeSchedules, feeScheduleItems, underpayments, claims, charges, ledgerEntries, payers, patients, cptCodes } = schema;

/* ------------------------------------------------------------------ */
/* Pure calculations                                                    */
/* ------------------------------------------------------------------ */

/**
 * Tolerance before a shortfall counts as an underpayment: a dollar, or 1% of
 * the expected amount, whichever is larger. Payers round per line and apply
 * multiple-procedure and sequestration reductions, so an exact comparison
 * would bury real underpayments under noise.
 */
export function underpaymentThreshold(expectedCents: number): number {
  return Math.max(100, Math.round(expectedCents * 0.01));
}

export interface ExpectedAllowed {
  expectedCents: number;
  /** CPT codes on the claim with no contracted rate. Any gap makes the comparison unsafe. */
  missing: string[];
}

export function expectedAllowed(
  lines: { cpt: string; units: number }[],
  rates: Map<string, number>,
): ExpectedAllowed {
  let expectedCents = 0;
  const missing: string[] = [];
  for (const l of lines) {
    const rate = rates.get(l.cpt);
    if (rate === undefined) missing.push(l.cpt);
    else expectedCents += rate * l.units;
  }
  return { expectedCents, missing };
}

export interface UnderpaymentVerdict {
  underpaid: boolean;
  varianceCents: number;
}

export function judgeUnderpayment(expectedCents: number, actualAllowedCents: number): UnderpaymentVerdict {
  const varianceCents = expectedCents - actualAllowedCents;
  return { underpaid: varianceCents > underpaymentThreshold(expectedCents), varianceCents };
}

/**
 * The amount a payer actually allowed, from the ledger: billed charges less the
 * contractual (CO-45) write-down. It is the same number whether the claim was
 * posted from an 835 or loaded historically, and it is unaffected by how the
 * allowed amount was split between payer and patient.
 */
export function allowedFromLedger(entries: { type: string; amountCents: number; groupCode: string | null; reasonCode: string | null }[]): number {
  let charged = 0;
  let contractual = 0;
  for (const e of entries) {
    if (e.type === "charge") charged += e.amountCents;
    else if (e.type === "adjustment" && e.groupCode === "CO" && e.reasonCode === "45") contractual += e.amountCents;
  }
  return charged - contractual;
}

/* ------------------------------------------------------------------ */
/* Schedules                                                            */
/* ------------------------------------------------------------------ */

export async function listSchedules(db: Db, practiceId: string) {
  return db
    .select({
      schedule: feeSchedules,
      payerName: payers.name,
      items: sql<number>`(SELECT count(*)::int FROM fee_schedule_items WHERE fee_schedule_id = ${feeSchedules.id})`,
    })
    .from(feeSchedules)
    .leftJoin(payers, eq(payers.id, feeSchedules.payerId))
    .where(and(eq(feeSchedules.practiceId, practiceId), eq(feeSchedules.active, true)))
    .orderBy(sql`${feeSchedules.payerId} IS NOT NULL`, asc(payers.name));
}

/** The active schedule for a payer, or the standard schedule when payerId is null. */
export async function activeSchedule(db: Db, practiceId: string, payerId: string | null) {
  const [s] = await db
    .select()
    .from(feeSchedules)
    .where(
      and(
        eq(feeSchedules.practiceId, practiceId),
        eq(feeSchedules.active, true),
        payerId ? eq(feeSchedules.payerId, payerId) : isNull(feeSchedules.payerId),
      ),
    )
    .limit(1);
  return s ?? null;
}

export async function scheduleRates(db: Db, scheduleId: string): Promise<Map<string, number>> {
  const rows = await db.select().from(feeScheduleItems).where(eq(feeScheduleItems.feeScheduleId, scheduleId));
  return new Map(rows.map((r) => [r.cpt, r.amountCents]));
}

/** Contracted allowed amounts for a payer, empty when there is no contract on file. */
export async function contractRates(db: Db, practiceId: string, payerId: string): Promise<Map<string, number>> {
  const s = await activeSchedule(db, practiceId, payerId);
  return s ? scheduleRates(db, s.id) : new Map();
}

/**
 * What the practice charges for each code: its standard schedule where one
 * exists, otherwise the code's default fee. Charge entry prices from this.
 */
export async function standardCharges(db: Db, practiceId: string): Promise<Map<string, number>> {
  const codes = await db.select().from(cptCodes);
  const out = new Map(codes.map((c) => [c.code, c.defaultFeeCents]));
  const std = await activeSchedule(db, practiceId, null);
  if (std) for (const [cpt, amt] of await scheduleRates(db, std.id)) out.set(cpt, amt);
  return out;
}

/** Creates a schedule, or returns the active one when it already exists. */
export async function ensureSchedule(db: Db, practiceId: string, payerId: string | null) {
  const existing = await activeSchedule(db, practiceId, payerId);
  if (existing) return existing;
  let name = "Standard charges";
  if (payerId) {
    const [p] = await db.select().from(payers).where(and(eq(payers.id, payerId), eq(payers.practiceId, practiceId))).limit(1);
    if (!p) throw new Error("Payer not found in this practice");
    name = `${p.name} contract`;
  }
  const [created] = await db.insert(feeSchedules).values({ practiceId, payerId, name }).returning();
  return created;
}

/** Upserts amounts for a schedule. Blank or non-positive amounts remove the code. */
export async function saveScheduleItems(db: Db, scheduleId: string, items: { cpt: string; amountCents: number | null }[]) {
  for (const it of items) {
    if (it.amountCents === null || !Number.isFinite(it.amountCents) || it.amountCents <= 0) {
      await db.delete(feeScheduleItems).where(and(eq(feeScheduleItems.feeScheduleId, scheduleId), eq(feeScheduleItems.cpt, it.cpt)));
      continue;
    }
    await db
      .insert(feeScheduleItems)
      .values({ feeScheduleId: scheduleId, cpt: it.cpt, amountCents: Math.round(it.amountCents) })
      .onConflictDoUpdate({ target: [feeScheduleItems.feeScheduleId, feeScheduleItems.cpt], set: { amountCents: Math.round(it.amountCents) } });
  }
}

/**
 * Builds a payer contract as a percentage of the practice's standard charges,
 * which is how most commercial contracts are actually written.
 */
export async function contractFromPercent(db: Db, practiceId: string, payerId: string, percent: number) {
  if (!(percent > 0 && percent <= 200)) throw new Error("Percent must be between 0 and 200");
  const schedule = await ensureSchedule(db, practiceId, payerId);
  const std = await standardCharges(db, practiceId);
  await saveScheduleItems(db, schedule.id, [...std].map(([cpt, charge]) => ({ cpt, amountCents: Math.round((charge * percent) / 100) })));
  return schedule;
}

/* ------------------------------------------------------------------ */
/* Underpayments                                                        */
/* ------------------------------------------------------------------ */

/**
 * Compares one paid claim with its payer contract and records, updates or
 * clears its underpayment. Returns the verdict, or null when the claim cannot
 * be judged: not paid, or a code on it has no contracted rate.
 */
export async function checkClaimUnderpayment(db: Db, claimId: string, remittanceId?: string | null) {
  const [claim] = await db.select().from(claims).where(eq(claims.id, claimId)).limit(1);
  if (!claim || !["paid", "partially_paid"].includes(claim.status)) return null;

  const rates = await contractRates(db, claim.practiceId, claim.payerId);
  if (rates.size === 0) return null;
  const lines = await db.select({ cpt: charges.cpt, units: charges.units }).from(charges).where(eq(charges.encounterId, claim.encounterId));
  const exp = expectedAllowed(lines, rates);
  if (exp.missing.length) return null;

  const entries = await db
    .select({ type: ledgerEntries.type, amountCents: ledgerEntries.amountCents, groupCode: ledgerEntries.groupCode, reasonCode: ledgerEntries.reasonCode })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.claimId, claimId));
  const actual = allowedFromLedger(entries);
  const verdict = judgeUnderpayment(exp.expectedCents, actual);

  if (verdict.underpaid) {
    await db
      .insert(underpayments)
      .values({
        practiceId: claim.practiceId,
        claimId,
        payerId: claim.payerId,
        remittanceId: remittanceId ?? null,
        expectedAllowedCents: exp.expectedCents,
        actualAllowedCents: actual,
        varianceCents: verdict.varianceCents,
      })
      .onConflictDoUpdate({
        target: underpayments.claimId,
        set: { expectedAllowedCents: exp.expectedCents, actualAllowedCents: actual, varianceCents: verdict.varianceCents },
        where: eq(underpayments.status, "open"),
      });
  } else {
    // A later corrected payment can bring a claim back into line.
    await db.delete(underpayments).where(and(eq(underpayments.claimId, claimId), eq(underpayments.status, "open")));
  }
  return { ...verdict, expectedCents: exp.expectedCents, actualAllowedCents: actual };
}

/**
 * Scans every paid claim in the practice against its payer contract in one
 * set-based statement. Built for historical backfill, where looping over a
 * hundred thousand claims one query at a time would take minutes. Claims with
 * any uncontracted code are skipped, as in the single-claim check. Existing
 * open findings are refreshed; ones already worked are left alone.
 */
export async function scanUnderpayments(db: Db, practiceId: string): Promise<{ flagged: number }> {
  const result = await db.execute<{ n: string }>(sql`
    WITH rated AS (
      SELECT c.id AS claim_id, c.payer_id,
             SUM(fi.amount_cents * ch.units)::bigint AS expected,
             COUNT(*) FILTER (WHERE fi.id IS NULL) AS missing
      FROM claims c
      JOIN charges ch ON ch.encounter_id = c.encounter_id
      JOIN fee_schedules fs ON fs.practice_id = c.practice_id AND fs.payer_id = c.payer_id AND fs.active
      LEFT JOIN fee_schedule_items fi ON fi.fee_schedule_id = fs.id AND fi.cpt = ch.cpt
      WHERE c.practice_id = ${practiceId} AND c.status IN ('paid', 'partially_paid')
      GROUP BY c.id, c.payer_id
    ),
    actual AS (
      SELECT l.claim_id,
             COALESCE(SUM(l.amount_cents) FILTER (WHERE l.type = 'charge'), 0)
               - COALESCE(SUM(l.amount_cents) FILTER (WHERE l.type = 'adjustment' AND l.group_code = 'CO' AND l.reason_code = '45'), 0) AS allowed
      FROM ledger_entries l
      JOIN rated r ON r.claim_id = l.claim_id
      GROUP BY l.claim_id
    ),
    found AS (
      SELECT r.claim_id, r.payer_id, r.expected, a.allowed, r.expected - a.allowed AS variance
      FROM rated r JOIN actual a ON a.claim_id = r.claim_id
      WHERE r.missing = 0
        AND r.expected - a.allowed > GREATEST(100, ROUND(r.expected * 0.01))
    ),
    upserted AS (
      INSERT INTO underpayments (practice_id, claim_id, payer_id, expected_allowed_cents, actual_allowed_cents, variance_cents)
      SELECT ${practiceId}, claim_id, payer_id, expected, allowed, variance FROM found
      ON CONFLICT (claim_id) DO UPDATE
        SET expected_allowed_cents = EXCLUDED.expected_allowed_cents,
            actual_allowed_cents = EXCLUDED.actual_allowed_cents,
            variance_cents = EXCLUDED.variance_cents
        WHERE underpayments.status = 'open'
      RETURNING 1
    )
    SELECT count(*)::int AS n FROM upserted
  `);
  return { flagged: Number(result.rows[0]?.n ?? 0) };
}

export async function listUnderpayments(db: Db, practiceId: string, status: string = "open") {
  return db
    .select({ underpayment: underpayments, claim: claims, payer: payers, patient: patients })
    .from(underpayments)
    .innerJoin(claims, eq(claims.id, underpayments.claimId))
    .innerJoin(payers, eq(payers.id, underpayments.payerId))
    .innerJoin(patients, eq(patients.id, claims.patientId))
    .where(and(eq(underpayments.practiceId, practiceId), eq(underpayments.status, status)))
    .orderBy(desc(underpayments.varianceCents))
    .limit(200);
}

export async function underpaymentSummary(db: Db, practiceId: string) {
  const rows = await db.execute<{ status: string; n: string; variance: string }>(sql`
    SELECT status, count(*)::int AS n, COALESCE(sum(variance_cents), 0)::bigint AS variance
    FROM underpayments WHERE practice_id = ${practiceId} GROUP BY status
  `);
  const out: Record<string, { count: number; varianceCents: number }> = {};
  for (const r of rows.rows) out[r.status] = { count: Number(r.n), varianceCents: Number(r.variance) };
  return out;
}

const RESOLUTIONS = new Set(["open", "appealed", "recovered", "accepted"]);

export async function setUnderpaymentStatus(db: Db, practiceId: string, id: string, status: string, note?: string) {
  if (!RESOLUTIONS.has(status)) throw new Error(`Unknown status ${status}`);
  const done = status === "recovered" || status === "accepted";
  await db
    .update(underpayments)
    .set({ status, note: note ?? null, resolvedAt: done ? new Date() : null })
    .where(and(eq(underpayments.id, id), eq(underpayments.practiceId, practiceId)));
}
