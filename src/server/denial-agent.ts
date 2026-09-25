/**
 * The denial agent: works the open denial queue (overnight, or on demand)
 * and prepares each one for a person to approve in the morning.
 *
 * It decides with explicit rules, and writes its reasons down:
 *   coding             → a corrected claim
 *   duplicate          → write off, when the same visit was paid on another claim; otherwise appeal
 *   eligibility, cob   → re-check coverage, then get current insurance from the patient, or appeal
 *   everything else    → an appeal letter (Claude writes it from codes only, if connected)
 *
 * Nothing leaves the building and no money moves until someone approves.
 */
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { draftAppeal, markAppealSent } from "./appeals";
import { createCorrectedClaim, getClaimFinancials, writeOffClaim } from "./claims";
import { assertWriteOffAllowed } from "./policies";
import { runEligibility } from "./patients";
import { createTask } from "./work";

const { denialAgentItems, denials, claims, encounters, auditLog } = schema;

export type AgentAction = "appeal" | "correct_claim" | "write_off" | "update_insurance";
export const ACTION_LABEL: Record<AgentAction, string> = {
  appeal: "Send the appeal",
  correct_claim: "Create the corrected claim",
  write_off: "Write off the duplicate",
  update_insurance: "Ask the patient for current insurance",
};

const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const daysUntil = (iso: string | null) => (iso ? Math.round((Date.parse(iso) - Date.now()) / 86_400_000) : null);

/** Bigger and more urgent first: dollars, plus a boost as the appeal deadline nears. */
export function priorityFor(amountCents: number, appealDeadline: string | null) {
  const left = daysUntil(appealDeadline);
  const urgency = left === null ? 0 : left < 0 ? 0 : left <= 7 ? 3 : left <= 21 ? 2 : 1;
  return Math.round(amountCents / 100) + urgency * 1000;
}

type DenialRow = typeof denials.$inferSelect;
type ClaimRow = typeof claims.$inferSelect;

async function paidDuplicate(db: Db, claim: ClaimRow) {
  const [enc] = await db.select().from(encounters).where(eq(encounters.id, claim.encounterId)).limit(1);
  if (!enc) return null;
  const [dup] = await db
    .select({ id: claims.id, controlNumber: claims.controlNumber, status: claims.status })
    .from(claims)
    .innerJoin(encounters, eq(encounters.id, claims.encounterId))
    .where(and(eq(claims.patientId, claim.patientId), eq(claims.payerId, claim.payerId), ne(claims.id, claim.id), eq(encounters.dateOfService, enc.dateOfService), inArray(claims.status, ["paid", "partially_paid"])))
    .limit(1);
  return dup ?? null;
}

/** Decides and prepares one denial. Returns the proposal, or null when there is nothing the agent can prepare. */
async function prepare(db: Db, practiceId: string, d: DenialRow, claim: ClaimRow, userId?: string) {
  const reasons: string[] = [`${claim.controlNumber}: CARC ${d.carc}${d.rarc ? ` / ${d.rarc}` : ""}, ${money(d.amountCents)} denied (${d.category.replace(/_/g, " ")}).`];
  if (d.explanation) reasons.push(d.explanation);
  const left = daysUntil(d.appealDeadline);
  if (left !== null) reasons.push(left < 0 ? `The appeal deadline passed ${-left} days ago.` : `${left} days left to appeal.`);

  let action: AgentAction = "appeal";
  let title = `Appeal ${claim.controlNumber}`;
  let letterId: string | null = null;

  if (d.category === "coding") {
    if (["denied", "rejected"].includes(claim.status)) {
      action = "correct_claim";
      title = `Correct and resubmit ${claim.controlNumber}`;
      reasons.push("A coding denial is fixed by correcting the claim, not by arguing. Approving creates the corrected claim to edit and resubmit.");
    } else {
      reasons.push(`The claim is ${claim.status.replace(/_/g, " ")}, so it cannot be replaced here; an appeal is prepared instead.`);
    }
  } else if (d.category === "duplicate") {
    const dup = await paidDuplicate(db, claim);
    if (dup) {
      action = "write_off";
      title = `Write off duplicate ${claim.controlNumber}`;
      reasons.push(`Claim ${dup.controlNumber} for the same patient, payer and date of service was already ${dup.status.replace(/_/g, " ")}. The denial is correct; approving writes off the remaining insurance balance.`);
    } else {
      reasons.push("No other paid claim for this visit was found, so the payer may have denied it in error; an appeal is prepared.");
    }
  } else if (d.category === "eligibility" || d.category === "cob") {
    const check = await runEligibility(db, claim.patientInsuranceId).catch(() => null);
    if (!check || check.status !== "active") {
      action = "update_insurance";
      title = `Get current insurance for ${claim.controlNumber}`;
      reasons.push(check ? `A fresh eligibility check returned "${check.status}"${check.message ? `: ${check.message}` : ""}.` : "A fresh eligibility check could not be completed.");
      reasons.push(d.category === "cob" ? "The payer says another plan pays first. Approving creates a front-desk task to collect the patient's other insurance." : "Approving creates a front-desk task to collect the patient's current insurance.");
    } else {
      reasons.push(`A fresh eligibility check shows coverage is active${check.planName ? ` (${check.planName})` : ""}; an appeal with that proof is prepared.`);
    }
  }

  if (action === "appeal") {
    const letter = await draftAppeal(db, practiceId, d.id, userId);
    letterId = letter.id;
    reasons.push(letter.source === "ai" ? "Claude drafted the letter from the denial and procedure codes; patient details were filled in afterwards." : "The letter comes from the template for this denial reason; fill in the bracketed parts.");
  }

  const [item] = await db
    .insert(denialAgentItems)
    .values({ practiceId, denialId: d.id, action, title, reasons, letterId, priority: priorityFor(d.amountCents, d.appealDeadline) })
    .onConflictDoNothing()
    .returning();
  if (item) await db.update(denials).set({ status: "in_progress" }).where(and(eq(denials.id, d.id), eq(denials.status, "open")));
  return item ?? null;
}

/** Works through open denials the agent has not seen yet, most valuable first. */
export async function runDenialAgent(db: Db, practiceId: string, opts: { limit?: number; userId?: string } = {}) {
  const queue = await db
    .select({ d: denials, c: claims })
    .from(denials)
    .innerJoin(claims, eq(claims.id, denials.claimId))
    .leftJoin(denialAgentItems, eq(denialAgentItems.denialId, denials.id))
    .where(and(eq(denials.practiceId, practiceId), eq(denials.status, "open"), isNull(denialAgentItems.id)))
    .orderBy(desc(denials.amountCents))
    .limit(opts.limit ?? 25);
  const counts: Record<string, number> = {};
  let failed = 0;
  for (const { d, c } of queue) {
    try {
      const item = await prepare(db, practiceId, d, c, opts.userId);
      if (item) counts[item.action] = (counts[item.action] ?? 0) + 1;
    } catch (e) {
      failed++;
      console.warn("[collaboratmd] denial agent skipped a denial", d.id, e instanceof Error ? e.message : e);
    }
  }
  await db.insert(auditLog).values({ practiceId, userId: opts.userId ?? null, action: "denial_agent_run", entity: "denial", entityId: null, details: { prepared: counts, failed } });
  return { prepared: Object.values(counts).reduce((a, b) => a + b, 0), byAction: counts, failed };
}

export async function agentQueue(db: Db, practiceId: string, status: "proposed" | "approved" | "dismissed" = "proposed") {
  return db
    .select({ item: denialAgentItems, denial: denials, claim: claims, patientFirst: schema.patients.firstName, patientLast: schema.patients.lastName, payerName: schema.payers.name })
    .from(denialAgentItems)
    .innerJoin(denials, eq(denials.id, denialAgentItems.denialId))
    .innerJoin(claims, eq(claims.id, denials.claimId))
    .innerJoin(schema.patients, eq(schema.patients.id, claims.patientId))
    .innerJoin(schema.payers, eq(schema.payers.id, claims.payerId))
    .where(and(eq(denialAgentItems.practiceId, practiceId), eq(denialAgentItems.status, status)))
    .orderBy(status === "proposed" ? desc(denialAgentItems.priority) : desc(denialAgentItems.decidedAt), asc(denialAgentItems.createdAt))
    .limit(200);
}

export async function agentCounts(db: Db, practiceId: string) {
  const rows = await db.select({ status: denialAgentItems.status, n: sql<number>`count(*)::int` }).from(denialAgentItems).where(eq(denialAgentItems.practiceId, practiceId)).groupBy(denialAgentItems.status);
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)])) as Record<string, number>;
}

async function ownItem(db: Db, practiceId: string, id: string) {
  const [row] = await db.select({ item: denialAgentItems, denial: denials }).from(denialAgentItems).innerJoin(denials, eq(denials.id, denialAgentItems.denialId)).where(and(eq(denialAgentItems.id, id), eq(denialAgentItems.practiceId, practiceId))).limit(1);
  if (!row) throw new Error("Proposal not found");
  if (row.item.status !== "proposed") throw new Error(`Already ${row.item.status}`);
  return row;
}

/** Carries out what the agent proposed. */
export async function approveItem(db: Db, practiceId: string, id: string, userId?: string, role = "admin") {
  const { item, denial } = await ownItem(db, practiceId, id);
  let resultClaimId: string | null = null;
  let message = "";
  switch (item.action as AgentAction) {
    case "appeal":
      if (!item.letterId) throw new Error("No letter was prepared");
      await markAppealSent(db, practiceId, item.letterId, userId);
      message = "Appeal marked sent. Print or fax the letter from the appeal page if you have not already.";
      break;
    case "correct_claim": {
      const created = await createCorrectedClaim(db, denial.claimId, userId);
      resultClaimId = created.id;
      message = `Corrected claim ${created.controlNumber} created; review and resubmit it.`;
      break;
    }
    case "write_off":
      await assertWriteOffAllowed(db, practiceId, role, (await getClaimFinancials(db, denial.claimId)).insuranceBalanceCents);
      await writeOffClaim(db, denial.claimId, `Duplicate: same visit paid on another claim (denial agent, approved)`, userId);
      await db.update(denials).set({ status: "written_off", resolvedAt: new Date() }).where(eq(denials.id, denial.id));
      message = "Duplicate written off.";
      break;
    case "update_insurance": {
      const [claim] = await db.select().from(claims).where(eq(claims.id, denial.claimId)).limit(1);
      await createTask(db, practiceId, {
        title: `Get current insurance for claim ${claim.controlNumber}`,
        entityType: "patient", entityId: claim.patientId,
        note: `Denied for ${denial.category.replace(/_/g, " ")} (CARC ${denial.carc}). Collect the patient's current card, update the chart, then correct and resubmit the claim. Sending the patient a portal link lets them report it themselves.`,
        priority: "high",
      }, userId);
      message = "Task created for the front desk.";
      break;
    }
  }
  await db.update(denialAgentItems).set({ status: "approved", decidedBy: userId ?? null, decidedAt: new Date(), resultClaimId }).where(eq(denialAgentItems.id, id));
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "denial_agent_approved", entity: "denial", entityId: denial.id, details: { action: item.action } });
  return { message, resultClaimId };
}

export async function dismissItem(db: Db, practiceId: string, id: string, userId?: string) {
  const { denial } = await ownItem(db, practiceId, id);
  await db.update(denialAgentItems).set({ status: "dismissed", decidedBy: userId ?? null, decidedAt: new Date() }).where(eq(denialAgentItems.id, id));
  await db.update(denials).set({ status: "open" }).where(and(eq(denials.id, denial.id), eq(denials.status, "in_progress")));
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "denial_agent_dismissed", entity: "denial", entityId: denial.id });
}
