/**
 * Payment disputes under the No Surprises Act, for out-of-network services it
 * covers (emergency care, and non-emergency care by out-of-network providers
 * at in-network facilities). After the plan's initial payment or notice of
 * denial, either side has 30 business days to start open negotiation; that
 * runs 30 business days; then either side has 4 business days to start the
 * federal independent dispute resolution (IDR) process. Business days skip
 * weekends and federal holidays.
 *
 * CMS publishes the standard open negotiation notice and runs the IDR portal;
 * this keeps the dates and the claim details, it does not file anything.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { addBusinessDays } from "@/lib/business-days";
import { notify } from "./notifications";

const { nsaDisputes, claims, payers, patients, auditLog } = schema;

export const NEGOTIATION_START_DAYS = 30;
export const NEGOTIATION_DAYS = 30;
export const IDR_WINDOW_DAYS = 4;

/** Pure: the deadlines that follow from the dates so far. */
export function nsaDeadlines(d: { initialResponseOn: string; negotiationStartedOn: string | null }) {
  const startBy = addBusinessDays(d.initialResponseOn, NEGOTIATION_START_DAYS);
  if (!d.negotiationStartedOn) return { startBy, negotiationEnds: null, idrFrom: null, idrBy: null };
  const negotiationEnds = addBusinessDays(d.negotiationStartedOn, NEGOTIATION_DAYS);
  return { startBy, negotiationEnds, idrFrom: addBusinessDays(negotiationEnds, 1), idrBy: addBusinessDays(negotiationEnds, IDR_WINDOW_DAYS) };
}

/** The next date that matters for a dispute, and what it is. */
export function nextDeadline(d: typeof nsaDisputes.$inferSelect) {
  const dl = nsaDeadlines(d);
  if (d.status === "open") return { on: dl.startBy, what: "Start open negotiation (send the notice) by" };
  if (d.status === "negotiating") return { on: dl.idrBy!, what: `Negotiation ends ${dl.negotiationEnds}; start IDR between ${dl.idrFrom} and` };
  return null;
}

const isDay = (v: string | null | undefined) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

export async function createNsaDispute(db: Db, practiceId: string, input: { claimControlNumber: string; initialResponseOn: string; offerCents?: number | null; notes?: string }, userId?: string) {
  const [claim] = await db.select().from(claims).where(and(eq(claims.practiceId, practiceId), eq(claims.controlNumber, input.claimControlNumber.trim().toUpperCase()))).limit(1);
  if (!claim) throw new Error(`No claim ${input.claimControlNumber} in this practice`);
  if (!isDay(input.initialResponseOn)) throw new Error("Enter the date the plan's initial payment or denial arrived");
  if (input.offerCents !== undefined && input.offerCents !== null && !(input.offerCents > 0)) throw new Error("Enter the amount you will offer, or leave it blank");
  const [row] = await db.insert(nsaDisputes).values({ practiceId, claimId: claim.id, initialResponseOn: input.initialResponseOn, offerCents: input.offerCents ?? null, notes: input.notes?.trim().slice(0, 1000) || null, createdBy: userId ?? null }).returning();
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "nsa_dispute_created", entity: "claim", entityId: claim.id, details: { disputeId: row.id } });
  return row;
}

async function own(db: Db, practiceId: string, id: string) {
  const [row] = await db.select().from(nsaDisputes).where(and(eq(nsaDisputes.id, id), eq(nsaDisputes.practiceId, practiceId))).limit(1);
  if (!row) throw new Error("Dispute not found");
  return row;
}

export async function startNegotiation(db: Db, practiceId: string, id: string, sentOn: string, userId?: string) {
  const d = await own(db, practiceId, id);
  if (d.status !== "open") throw new Error("Open negotiation has already started");
  if (!isDay(sentOn) || sentOn < d.initialResponseOn) throw new Error("Enter the date the open negotiation notice was sent");
  const late = sentOn > nsaDeadlines(d).startBy;
  await db.update(nsaDisputes).set({ status: "negotiating", negotiationStartedOn: sentOn }).where(eq(nsaDisputes.id, id));
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "nsa_negotiation_started", entity: "claim", entityId: d.claimId, details: { sentOn, late } });
  return { late };
}

export async function startIdr(db: Db, practiceId: string, id: string, initiatedOn: string, userId?: string) {
  const d = await own(db, practiceId, id);
  if (d.status !== "negotiating") throw new Error("Open negotiation has to run first");
  const dl = nsaDeadlines(d);
  if (!isDay(initiatedOn)) throw new Error("Enter the date IDR was started");
  if (initiatedOn < dl.idrFrom!) throw new Error(`IDR can start only after open negotiation ends (${dl.negotiationEnds}), from ${dl.idrFrom}`);
  await db.update(nsaDisputes).set({ status: "idr", idrInitiatedOn: initiatedOn }).where(eq(nsaDisputes.id, id));
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "nsa_idr_started", entity: "claim", entityId: d.claimId, details: { initiatedOn, late: initiatedOn > dl.idrBy! } });
  return { late: initiatedOn > dl.idrBy! };
}

export async function closeNsaDispute(db: Db, practiceId: string, id: string, input: { outcome: string; settledCents?: number | null }, userId?: string) {
  const d = await own(db, practiceId, id);
  const outcome = input.outcome.trim().slice(0, 300);
  if (!outcome) throw new Error("Record the outcome");
  await db.update(nsaDisputes).set({ status: input.settledCents ? "settled" : "closed", outcome, settledCents: input.settledCents ?? null }).where(eq(nsaDisputes.id, id));
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "nsa_dispute_closed", entity: "claim", entityId: d.claimId, details: { outcome, settledCents: input.settledCents ?? null } });
}

export async function listNsaDisputes(db: Db, practiceId: string) {
  return db.select({ d: nsaDisputes, controlNumber: claims.controlNumber, totalCents: claims.totalCents, payerName: payers.name, patientFirst: patients.firstName, patientLast: patients.lastName })
    .from(nsaDisputes).innerJoin(claims, eq(claims.id, nsaDisputes.claimId)).innerJoin(payers, eq(payers.id, claims.payerId)).innerJoin(patients, eq(patients.id, claims.patientId))
    .where(eq(nsaDisputes.practiceId, practiceId)).orderBy(asc(nsaDisputes.createdAt)).limit(300);
}

/** Daily: a notice when a dispute's next deadline is within 5 business days or past. */
export async function nsaDeadlineAlerts(db: Db, practiceId: string, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const soon = addBusinessDays(today, 5);
  const rows = await db.select().from(nsaDisputes).where(and(eq(nsaDisputes.practiceId, practiceId), inArray(nsaDisputes.status, ["open", "negotiating"])));
  let n = 0;
  for (const d of rows) {
    const next = nextDeadline(d);
    if (!next || next.on > soon) continue;
    n++;
    await notify(db, practiceId, {
      kind: "nsa_deadline", href: "/nsa-disputes", dedupeKey: `nsa:${d.id}:${d.status}:${next.on < today ? "late" : "soon"}`,
      title: next.on < today ? `A No Surprises Act deadline passed on ${next.on}` : `No Surprises Act deadline ${next.on}`,
      body: `${next.what} ${next.on}. Business days skip weekends and federal holidays.`,
    });
  }
  return { dueSoon: n };
}
