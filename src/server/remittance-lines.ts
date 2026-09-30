/**
 * 835 service lines kept per code. The ledger posts payments per claim; these
 * keep what the payer charged, allowed, paid and adjusted on each line, so
 * reports can compare a payer's actual allowed amount for a code with the
 * practice's charge, its contract and Medicare's rate.
 *
 * Allowed is the charge less the contractual (CO) adjustments on the line.
 */
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { parseEdi835, type RemitClaim } from "@/lib/edi/x835";

const { remittanceLines, remittances, claims } = schema;

export const lineAllowed = (l: RemitClaim["lines"][number]) => l.chargedCents - l.adjustments.filter((a) => a.group === "CO").reduce((s, a) => s + a.amountCents, 0);

export async function storeRemitLines(db: Db, remit: { id: string; practiceId: string; paymentDate: string }, claim: { id: string; payerId: string }, rc: RemitClaim) {
  if (!rc.lines.length || rc.statusCode === "22") return 0;
  await db.insert(remittanceLines).values(rc.lines.map((l) => ({
    practiceId: remit.practiceId, remittanceId: remit.id, claimId: claim.id, payerId: claim.payerId,
    cpt: l.cpt.toUpperCase(), modifiers: l.modifiers, units: l.units || 1, chargedCents: l.chargedCents, allowedCents: Math.max(0, lineAllowed(l)), paidCents: l.paidCents,
    adjustments: l.adjustments, remarks: l.remarks, paymentDate: remit.paymentDate,
  })));
  return rc.lines.length;
}

/** Fills in the lines of remittances posted before lines were kept. Safe to run again. */
export async function backfillRemittanceLines(db: Db, practiceId: string, limit = 500) {
  const done = db.selectDistinct({ id: remittanceLines.remittanceId }).from(remittanceLines).where(eq(remittanceLines.practiceId, practiceId));
  const todo = await db.select().from(remittances).where(and(eq(remittances.practiceId, practiceId), eq(remittances.posted, true), notInArray(remittances.id, done))).limit(limit);
  let lines = 0;
  for (const r of todo) {
    const parsed = parseEdi835(r.raw835);
    const numbers = parsed.claims.map((c) => c.patientControlNumber);
    if (!numbers.length) continue;
    const found = await db.select({ id: claims.id, payerId: claims.payerId, controlNumber: claims.controlNumber }).from(claims).where(and(eq(claims.practiceId, practiceId), inArray(claims.controlNumber, numbers)));
    for (const rc of parsed.claims) {
      const claim = found.find((c) => c.controlNumber === rc.patientControlNumber);
      if (claim) lines += await storeRemitLines(db, r, claim, rc);
    }
  }
  return { remittances: todo.length, lines };
}

/** The highest and typical allowed amount per unit for each code, per payer, over a period. */
export async function allowedByCode(db: Db, practiceId: string, from: string, to: string) {
  const { rows } = await db.execute<Record<string, string | null>>(sql`
    SELECT rl.cpt, rl.payer_id, py.name AS payer, count(*)::text AS n,
      max(rl.allowed_cents / GREATEST(rl.units, 1))::text AS max_allowed,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY rl.allowed_cents / GREATEST(rl.units, 1))::text AS median_allowed
    FROM remittance_lines rl JOIN payers py ON py.id = rl.payer_id
    WHERE rl.practice_id = ${practiceId} AND rl.payment_date BETWEEN ${from} AND ${to} AND rl.allowed_cents > 0
      AND NOT (rl.modifiers ?| array['26', 'TC', '50'])
    GROUP BY rl.cpt, rl.payer_id, py.name`);
  return rows.map((r) => ({ cpt: r.cpt!, payerId: r.payer_id!, payer: r.payer!, lines: Number(r.n), maxAllowedCents: Math.round(Number(r.max_allowed)), medianAllowedCents: Math.round(Number(r.median_allowed)) }));
}

/** The patient-responsibility (PR) reasons the payer gave on each claim's lines, for "why do I owe this". */
export async function shareReasons(db: Db, claimIds: string[]) {
  const out = new Map<string, { reason: string; amountCents: number }[]>();
  const ids = [...new Set(claimIds.filter(Boolean))];
  if (!ids.length) return out;
  const rows = await db.select({ claimId: remittanceLines.claimId, adjustments: remittanceLines.adjustments }).from(remittanceLines).where(inArray(remittanceLines.claimId, ids));
  for (const r of rows) {
    const list = out.get(r.claimId) ?? [];
    for (const a of r.adjustments) if (a.group === "PR") list.push({ reason: a.reason, amountCents: a.amountCents });
    out.set(r.claimId, list);
  }
  return out;
}
