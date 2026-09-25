/**
 * Editing a claim before a payer has ruled on it.
 *
 * A draft, a claim with scrub errors, a ready claim or one the clearinghouse
 * rejected has never been adjudicated, so it can be changed directly: date
 * and place of service, diagnoses and service lines. The change is recorded
 * on the claim's timeline line by line. Posted amounts are never edited:
 * removed or changed charges post as reversals and the new ones as new
 * charges, so the ledger still reads forward.
 *
 * A claim a payer has already decided is changed with a corrected claim
 * instead, which is what payers require.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { rescrubClaim } from "./claims";

const { claims, encounters, charges, ledgerEntries, claimEvents } = schema;

export const EDITABLE = ["draft", "scrub_errors", "ready", "rejected"] as const;

export interface ClaimEdit {
  dateOfService: string;
  placeOfService: string;
  diagnoses: string[];
  lines: { cpt: string; modifiers: string[]; units: number; chargeCents: number; dxPointers: number[]; description?: string }[];
}

function validate(e: ClaimEdit) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.dateOfService)) throw new Error("Enter a valid date of service");
  if (!/^\d{2}$/.test(e.placeOfService)) throw new Error("Choose a place of service");
  const dx = e.diagnoses.map((d) => d.trim().toUpperCase()).filter(Boolean);
  if (!dx.length || dx.length > 12) throw new Error("A claim needs between 1 and 12 diagnoses");
  if (!e.lines.length || e.lines.length > 50) throw new Error("A claim needs between 1 and 50 service lines");
  for (const [i, l] of e.lines.entries()) {
    if (!/^[A-Z0-9]{5}$/.test(l.cpt.trim().toUpperCase())) throw new Error(`Line ${i + 1}: enter a 5-character procedure code`);
    if (!Number.isInteger(l.units) || l.units < 1) throw new Error(`Line ${i + 1}: units must be at least 1`);
    if (!Number.isInteger(l.chargeCents) || l.chargeCents <= 0) throw new Error(`Line ${i + 1}: enter a charge`);
    if (!l.dxPointers.length || l.dxPointers.some((p) => p < 1 || p > dx.length)) throw new Error(`Line ${i + 1}: diagnosis pointers must point at diagnoses 1 to ${dx.length}`);
  }
  return dx;
}

const describe = (l: { cpt: string; modifiers: string[]; units: number; chargeCents: number }) =>
  `${l.cpt}${l.modifiers.length ? `-${l.modifiers.join("-")}` : ""} x${l.units} $${((l.chargeCents * l.units) / 100).toFixed(2)}`;

export async function editClaim(db: Db, practiceId: string, claimId: string, edit: ClaimEdit, userId?: string) {
  const [claim] = await db.select().from(claims).where(and(eq(claims.id, claimId), eq(claims.practiceId, practiceId))).limit(1);
  if (!claim) throw new Error("Claim not found");
  if (!(EDITABLE as readonly string[]).includes(claim.status)) {
    throw new Error("A payer has already received or decided this claim. Create a corrected claim to change it.");
  }
  if (claim.frequencyCode === "8") throw new Error("A void cannot be edited");
  if (claim.payerSequence === "S") throw new Error("A secondary claim follows its primary; edit the primary claim instead");
  const dx = validate(edit);

  const [enc] = await db.select().from(encounters).where(eq(encounters.id, claim.encounterId)).limit(1);
  const oldLines = await db.select().from(charges).where(eq(charges.encounterId, claim.encounterId)).orderBy(asc(charges.lineNumber));
  const newLines = edit.lines.map((l, i) => ({ ...l, cpt: l.cpt.trim().toUpperCase(), modifiers: l.modifiers.map((m) => m.trim().toUpperCase()).filter(Boolean), lineNumber: i + 1 }));

  const changes: string[] = [];
  if (enc.dateOfService !== edit.dateOfService) changes.push(`Date of service ${enc.dateOfService} → ${edit.dateOfService}`);
  if (enc.placeOfService !== edit.placeOfService) changes.push(`Place of service ${enc.placeOfService} → ${edit.placeOfService}`);
  if (enc.diagnoses.join(",") !== dx.join(",")) changes.push(`Diagnoses ${enc.diagnoses.join(", ")} → ${dx.join(", ")}`);
  const max = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < max; i++) {
    const o = oldLines[i];
    const n = newLines[i];
    if (o && !n) changes.push(`Line ${i + 1} removed: ${describe(o)}`);
    else if (!o && n) changes.push(`Line ${i + 1} added: ${describe(n)}`);
    else if (o && n && (describe(o) !== describe(n) || o.dxPointers.join() !== n.dxPointers.join())) changes.push(`Line ${i + 1}: ${describe(o)} → ${describe(n)}${o.dxPointers.join() !== n.dxPointers.join() ? ` (pointers ${n.dxPointers.join(",")})` : ""}`);
  }
  if (!changes.length) return { claim, changes };

  await db.update(encounters).set({ dateOfService: edit.dateOfService, placeOfService: edit.placeOfService, diagnoses: dx }).where(eq(encounters.id, enc.id));

  const chargesChanged = changes.some((c) => c.startsWith("Line"));
  let total = claim.totalCents;
  if (chargesChanged) {
    // Reverse what was charged, then charge what the claim now bills.
    const posted = await db.select().from(ledgerEntries).where(and(eq(ledgerEntries.claimId, claimId), eq(ledgerEntries.type, "charge")));
    const postedTotal = posted.reduce((a, e) => a + e.amountCents, 0);
    if (postedTotal !== 0) {
      await db.insert(ledgerEntries).values({ practiceId, patientId: claim.patientId, claimId, type: "charge", amountCents: -postedTotal, postedBy: userId ?? null, note: "Charges reversed: claim edited before submission" });
    }
    // The old lines go; their posted charges stay (and are reversed above),
    // unlinked from the line rows they pointed at.
    if (oldLines.length) await db.update(ledgerEntries).set({ chargeId: null }).where(inArray(ledgerEntries.chargeId, oldLines.map((l) => l.id)));
    await db.delete(charges).where(eq(charges.encounterId, enc.id));
    total = 0;
    for (const l of newLines) {
      const [c] = await db
        .insert(charges)
        .values({ encounterId: enc.id, lineNumber: l.lineNumber, cpt: l.cpt, modifiers: l.modifiers, units: l.units, chargeCents: l.chargeCents, dxPointers: l.dxPointers, description: l.description ?? null })
        .returning();
      await db.insert(ledgerEntries).values({ practiceId, patientId: claim.patientId, claimId, chargeId: c.id, type: "charge", amountCents: l.chargeCents * l.units, postedBy: userId ?? null, note: `${l.cpt} x${l.units}` });
      total += l.chargeCents * l.units;
    }
  }
  if (edit.dateOfService !== enc.dateOfService) {
    const [payer] = await db.select({ days: schema.payers.timelyFilingDays }).from(schema.payers).where(eq(schema.payers.id, claim.payerId)).limit(1);
    const deadline = new Date(edit.dateOfService);
    deadline.setDate(deadline.getDate() + (payer?.days ?? 90));
    await db.update(claims).set({ timelyFilingDeadline: deadline.toISOString().slice(0, 10) }).where(eq(claims.id, claimId));
  }
  await db.update(claims).set({ totalCents: total, updatedAt: new Date() }).where(eq(claims.id, claimId));
  await db.insert(claimEvents).values({ claimId, status: claim.status, source: "user", message: `Edited: ${changes.join("; ")}` });
  await db.insert(schema.auditLog).values({ practiceId, userId: userId ?? null, action: "edit_claim", entity: "claim", entityId: claimId, details: { changes } });
  const updated = await rescrubClaim(db, claimId);
  return { claim: updated, changes };
}
