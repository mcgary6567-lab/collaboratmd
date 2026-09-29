/**
 * Provider-level adjustments (835 PLB). A payer that overpaid an earlier
 * claim often takes the money back out of a later check (WO, overpayment
 * recovery; 72, authorized return) instead of asking for a refund; the check
 * is smaller than the claims in it, and the takeback belongs on the old claim.
 * Interest (L6) and balances carried forward (FB) are kept with the remittance.
 */
import { and, desc, eq, or } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import type { Remit835 } from "@/lib/edi/x835";
import { money } from "@/lib/utils";
import { notify } from "./notifications";

const { remittanceAdjustments, claims, ledgerEntries, claimEvents, remittances } = schema;

/** Reasons that take money back for a particular earlier claim. */
const TAKEBACKS = new Set(["WO", "72"]);

export const PLB_REASON: Record<string, string> = {
  WO: "Overpayment taken back", "72": "Authorized return", L6: "Interest", FB: "Balance carried forward", J1: "Not reimbursable",
  CS: "Adjustment", AP: "Acceleration of benefits", B2: "Rebate", BD: "Bad debt adjustment", C5: "Temporary allowance", IR: "Tax withholding", LE: "Levy", "50": "Late charge", "51": "Interest penalty",
};

/** The claim a takeback's reference names: its control number or the payer's claim number, possibly with more after it. */
async function claimFor(db: Db, practiceId: string, reference: string) {
  const ref = reference.trim();
  if (!ref) return null;
  const token = ref.split(/[\s:-]/)[0];
  const [c] = await db.select().from(claims).where(and(eq(claims.practiceId, practiceId), or(eq(claims.controlNumber, ref), eq(claims.controlNumber, token), eq(claims.payerClaimNumber, ref), eq(claims.payerClaimNumber, token)))).limit(1);
  return c ?? null;
}

async function postTakeback(db: Db, adjId: string, claim: typeof claims.$inferSelect, amountCents: number, remit: { id: string; payerName: string; checkNumber: string }, userId?: string) {
  const payer = remit.payerName || "The payer";
  await db.insert(ledgerEntries).values({ practiceId: claim.practiceId, patientId: claim.patientId, claimId: claim.id, remittanceId: remit.id, type: "reversal", amountCents, postedBy: userId ?? null, note: `${payer} took back ${money(amountCents)} in check ${remit.checkNumber} (PLB)` });
  await db.insert(claimEvents).values({ claimId: claim.id, status: claim.status, source: "835", message: `${payer} took back ${money(amountCents)} from a later payment (check ${remit.checkNumber})` });
  await db.update(remittanceAdjustments).set({ claimId: claim.id, posted: true }).where(eq(remittanceAdjustments.id, adjId));
}

/** Records a remittance's PLB adjustments and posts each takeback to the claim it names. */
export async function postProviderAdjustments(db: Db, remit: { id: string; practiceId: string; payerName: string; checkNumber: string }, parsed: Pick<Remit835, "providerAdjustments">, userId?: string) {
  const out = { takenBackCents: 0, interestCents: 0, unmatched: 0, other: 0 };
  for (const a of parsed.providerAdjustments) {
    if (!a.amountCents) continue;
    const [row] = await db.insert(remittanceAdjustments).values({ practiceId: remit.practiceId, remittanceId: remit.id, reason: a.reason, reference: a.reference || null, amountCents: a.amountCents }).returning();
    if (a.reason === "L6" || a.reason === "51") { out.interestCents += -a.amountCents; continue; }
    if (!TAKEBACKS.has(a.reason) || a.amountCents < 0) { out.other += a.amountCents; continue; }
    const claim = await claimFor(db, remit.practiceId, a.reference);
    if (!claim) { out.unmatched++; continue; }
    await postTakeback(db, row.id, claim, a.amountCents, remit, userId);
    out.takenBackCents += a.amountCents;
  }
  if (out.unmatched) {
    await notify(db, remit.practiceId, { kind: "plb_unmatched", dedupeKey: `plb-${remit.id}`, href: "/remittance", title: `A payer took back money for ${out.unmatched} claim${out.unmatched === 1 ? "" : "s"} we could not find`, body: `${remit.payerName} check ${remit.checkNumber}: match each takeback to its claim on the Remittance page.` });
  }
  return out;
}

/** Posts a takeback nobody could match automatically, to the claim a biller chose. */
export async function matchTakeback(db: Db, practiceId: string, adjustmentId: string, controlNumber: string, userId?: string) {
  const [row] = await db.select({ adj: remittanceAdjustments, remit: remittances }).from(remittanceAdjustments).innerJoin(remittances, eq(remittances.id, remittanceAdjustments.remittanceId))
    .where(and(eq(remittanceAdjustments.id, adjustmentId), eq(remittanceAdjustments.practiceId, practiceId))).limit(1);
  if (!row) throw new Error("Adjustment not found");
  if (row.adj.posted) throw new Error("This takeback is already on a claim");
  if (!TAKEBACKS.has(row.adj.reason) || row.adj.amountCents <= 0) throw new Error("Only takebacks are posted to a claim");
  const claim = await claimFor(db, practiceId, controlNumber);
  if (!claim) throw new Error(`No claim ${controlNumber} in this practice`);
  await postTakeback(db, row.adj.id, claim, row.adj.amountCents, row.remit, userId);
  return claim;
}

export async function listProviderAdjustments(db: Db, practiceId: string, limit = 50) {
  return db.select({ adj: remittanceAdjustments, payerName: remittances.payerName, checkNumber: remittances.checkNumber, paymentDate: remittances.paymentDate, controlNumber: claims.controlNumber })
    .from(remittanceAdjustments).innerJoin(remittances, eq(remittances.id, remittanceAdjustments.remittanceId)).leftJoin(claims, eq(claims.id, remittanceAdjustments.claimId))
    .where(eq(remittanceAdjustments.practiceId, practiceId)).orderBy(desc(remittanceAdjustments.createdAt)).limit(limit);
}

/** Whether an 835 with no claims of this practice still takes money back for one of them. */
export async function plbForPractice(db: Db, practiceId: string, parsed: Pick<Remit835, "providerAdjustments">) {
  for (const a of parsed.providerAdjustments) if (TAKEBACKS.has(a.reason) && (await claimFor(db, practiceId, a.reference))) return true;
  return false;
}
