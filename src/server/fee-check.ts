/**
 * Fee schedule check. A payer pays the lesser of its allowed amount and the
 * charge, so a standard charge below what any payer allows leaves money
 * behind on every claim for that code. For each code billed in the last year,
 * this finds the highest amount a payer would allow: actual allowed amounts
 * from the 835 lines, the payer contracts on file, and Medicare's fee schedule
 * in the practice's locality. Charges below it are listed with a suggested
 * new charge (that amount, rounded up to the next $5).
 */
import { and, eq, isNotNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { standardCharges } from "./fees";
import { medicareAllowed, practiceLocality } from "./mpfs";
import { allowedByCode } from "./remittance-lines";

const { feeSchedules, feeScheduleItems, payers } = schema;

export type FeeGap = { cpt: string; lines: number; chargeCents: number; highestCents: number; source: string; suggestedCents: number };

/** Pure: the codes whose charge is below the highest amount allowed, and what to charge instead. */
export function feeGaps(codes: { cpt: string; lines: number }[], charges: Map<string, number>, allowed: Map<string, { cents: number; source: string }>): FeeGap[] {
  const out: FeeGap[] = [];
  for (const c of codes) {
    const charge = charges.get(c.cpt);
    const top = allowed.get(c.cpt);
    if (charge === undefined || !top || charge >= top.cents) continue;
    out.push({ cpt: c.cpt, lines: c.lines, chargeCents: charge, highestCents: top.cents, source: top.source, suggestedCents: Math.ceil(top.cents / 500) * 500 });
  }
  return out.sort((a, b) => (b.highestCents - b.chargeCents) * b.lines - (a.highestCents - a.chargeCents) * a.lines);
}

export async function feeCheck(db: Db, practiceId: string, today = new Date()) {
  const to = today.toISOString().slice(0, 10);
  const from = `${Number(to.slice(0, 4)) - 1}${to.slice(4)}`;
  const { rows } = await db.execute<{ cpt: string; n: string }>(sql`
    SELECT ch.cpt, count(*)::text AS n FROM charges ch JOIN encounters e ON e.id = ch.encounter_id
    WHERE e.practice_id = ${practiceId} AND e.date_of_service BETWEEN ${from} AND ${to} AND ch.charge_cents > 0
    GROUP BY ch.cpt`);
  const codes = rows.map((r) => ({ cpt: r.cpt, lines: Number(r.n) }));
  const charges = await standardCharges(db, practiceId);
  const allowed = new Map<string, { cents: number; source: string }>();
  const consider = (cpt: string, cents: number, source: string) => {
    if (!(cents > 0)) return;
    const cur = allowed.get(cpt);
    if (!cur || cents > cur.cents) allowed.set(cpt, { cents, source });
  };
  for (const a of await allowedByCode(db, practiceId, from, to)) consider(a.cpt, a.maxAllowedCents, `${a.payer} allowed (835)`);
  const contracts = await db.select({ cpt: feeScheduleItems.cpt, amount: feeScheduleItems.amountCents, payer: payers.name })
    .from(feeScheduleItems).innerJoin(feeSchedules, eq(feeSchedules.id, feeScheduleItems.feeScheduleId)).innerJoin(payers, eq(payers.id, feeSchedules.payerId))
    .where(and(eq(feeSchedules.practiceId, practiceId), eq(feeSchedules.active, true), isNotNull(feeSchedules.payerId)));
  for (const c of contracts) consider(c.cpt, c.amount, `${c.payer} contract`);
  const loc = await practiceLocality(db, practiceId);
  if (loc && codes.length) {
    const { rates } = await medicareAllowed(db, loc, to, "11", codes.map((c) => ({ cpt: c.cpt })));
    for (const [cpt, cents] of rates) consider(cpt, cents, "Medicare fee schedule");
  }
  return { from, to, codes: codes.length, gaps: feeGaps(codes, charges, allowed) };
}
