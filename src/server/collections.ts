/**
 * Patient collections: the step after statements and reminders.
 *
 * 1. Final notice: a last letter (and email or text where allowed) with a pay
 *    link, giving the patient FINAL_NOTICE_DAYS before the account moves on.
 * 2. Agency: the balance is written off as bad debt (a `bad_debt` ledger
 *    entry, so it leaves patient A/R) and the account goes to the agency,
 *    which receives a CSV of its placements.
 * 3. Closed: settled (what the agency recovered is posted as a payment) or
 *    recalled (the account comes back and the unrecovered rest is owed again).
 *
 * The ledger is never edited: write-offs and reinstatements are entries.
 */
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { patientBalanceCents, patientsWithBalances } from "./billing";
import { createPortalLink } from "./portal";
import { messagePatient, type MessageResult } from "./messaging";

const { patientCollections, patients, practices, ledgerEntries, statements, paymentPlans, auditLog } = schema;

export const FINAL_NOTICE_DAYS = 10;
export const MIN_BALANCE_CENTS = 2_500;
export type Collection = typeof patientCollections.$inferSelect;

/** Accounts that have had statements for 60+ days without paying, and are not on a plan or already in collections. */
export async function collectionCandidates(db: Db, practiceId: string, today = new Date()) {
  const owing = await patientsWithBalances(db, practiceId, MIN_BALANCE_CENTS, 500);
  if (!owing.length) return [];
  const ids = owing.map((o) => o.patientId);
  const [stmts, plans, open] = await Promise.all([
    db
      .select({ patientId: statements.patientId, n: sql<number>`count(*)::int`, first: sql<string>`min(${statements.statementDate})::text` })
      .from(statements)
      .where(and(inArray(statements.patientId, ids), sql`${statements.status} <> 'void'`))
      .groupBy(statements.patientId),
    db.select({ patientId: paymentPlans.patientId }).from(paymentPlans).where(and(inArray(paymentPlans.patientId, ids), eq(paymentPlans.status, "active"))),
    db.select({ patientId: patientCollections.patientId }).from(patientCollections).where(and(inArray(patientCollections.patientId, ids), isNull(patientCollections.closedAt))),
  ]);
  const byPatient = new Map(stmts.map((s) => [s.patientId, s]));
  const onPlan = new Set(plans.map((p) => p.patientId));
  const inCollections = new Set(open.map((p) => p.patientId));
  const cutoff = new Date(today.getTime() - 60 * 86_400_000).toISOString().slice(0, 10);
  return owing
    .filter((o) => !onPlan.has(o.patientId) && !inCollections.has(o.patientId))
    .map((o) => ({ ...o, statementCount: Number(byPatient.get(o.patientId)?.n ?? 0), firstStatement: byPatient.get(o.patientId)?.first ?? null }))
    .filter((o) => o.statementCount >= 2 && o.firstStatement !== null && o.firstStatement <= cutoff);
}

async function ownCollection(db: Db, practiceId: string, id: string) {
  const [c] = await db.select().from(patientCollections).where(and(eq(patientCollections.id, id), eq(patientCollections.practiceId, practiceId))).limit(1);
  if (!c) throw new Error("Collection account not found");
  return c;
}

export function finalNoticeText(p: { firstName: string; lastName: string }, practice: { name: string; phone: string | null }, amountCents: number, payBy: string, url?: string) {
  const amount = `$${(amountCents / 100).toFixed(2)}`;
  return `Dear ${p.firstName} ${p.lastName},

Our records show a balance of ${amount} on your account with ${practice.name}, which remains unpaid after several statements.

Please pay the balance, or contact us to set up a payment plan, by ${payBy}. If we do not hear from you by then, the account may be referred to a collection agency.
${url ? `\nYou can see what the balance is for and pay securely here:\n${url}\n` : ""}
If you believe this balance is wrong, or your insurance should have paid it, please call us${practice.phone ? ` at ${practice.phone}` : ""} so we can review it.

${practice.name}`;
}

/** Opens a collection account with a final notice, and sends it by email or text where the patient can receive one. */
export async function sendFinalNotice(
  db: Db,
  practiceId: string,
  patientId: string,
  opts: { userId?: string; origin?: string; now?: Date; deps?: Parameters<typeof messagePatient>[3] } = {},
): Promise<{ collection: Collection; delivery: MessageResult | null }> {
  const [p] = await db.select().from(patients).where(and(eq(patients.id, patientId), eq(patients.practiceId, practiceId))).limit(1);
  if (!p) throw new Error("Patient not found");
  const [open] = await db.select({ id: patientCollections.id }).from(patientCollections).where(and(eq(patientCollections.patientId, patientId), isNull(patientCollections.closedAt))).limit(1);
  if (open) throw new Error("This account is already in collections");
  const balance = await patientBalanceCents(db, patientId);
  if (balance <= 0) throw new Error("There is no balance to collect");
  const now = opts.now ?? new Date();
  const [collection] = await db
    .insert(patientCollections)
    .values({ practiceId, patientId, stage: "final_notice", amountCents: balance, finalNoticeAt: now, createdBy: opts.userId ?? null })
    .returning();
  await db.insert(auditLog).values({ practiceId, userId: opts.userId ?? null, action: "collections_final_notice", entity: "patient", entityId: patientId, details: { amountCents: balance } });

  let delivery: MessageResult | null = null;
  if (opts.origin) {
    const [practice] = await db.select().from(practices).where(eq(practices.id, practiceId)).limit(1);
    const link = await createPortalLink(db, practiceId, patientId, opts.userId, "pay");
    const url = `${opts.origin}${link.path}`;
    const payBy = new Date(now.getTime() + FINAL_NOTICE_DAYS * 86_400_000).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    delivery = await messagePatient(db, p, {
      kind: "final_notice", entityId: collection.id,
      sms: `${practice.name}: final notice. Your balance of $${(balance / 100).toFixed(2)} is past due. Please pay or call us by ${payBy}: ${url}`,
      email: { subject: `Final notice from ${practice.name}`, text: finalNoticeText(p, practice, balance, payBy, url) },
    }, opts.deps);
  }
  return { collection, delivery };
}

/** Writes the balance off as bad debt and records the placement with the agency. */
export async function placeWithAgency(db: Db, practiceId: string, collectionId: string, agency: string, opts: { userId?: string; now?: Date } = {}) {
  const c = await ownCollection(db, practiceId, collectionId);
  if (c.stage !== "final_notice") throw new Error("Only an account at the final-notice stage can be placed");
  const name = agency.trim();
  if (!name) throw new Error("Name the collection agency");
  const now = opts.now ?? new Date();
  const earliest = new Date(c.finalNoticeAt!.getTime() + FINAL_NOTICE_DAYS * 86_400_000);
  if (now < earliest) throw new Error(`The final notice gives the patient until ${earliest.toISOString().slice(0, 10)}; place the account after that`);
  const balance = await patientBalanceCents(db, c.patientId);
  if (balance <= 0) throw new Error("The balance has been paid; close this account instead");
  await db.insert(ledgerEntries).values({ practiceId, patientId: c.patientId, type: "bad_debt", amountCents: balance, note: `Bad debt: placed with ${name}`, postedBy: opts.userId ?? null });
  const [row] = await db.update(patientCollections).set({ stage: "agency", agency: name.slice(0, 200), placedAt: now, amountCents: balance }).where(eq(patientCollections.id, c.id)).returning();
  await db.insert(auditLog).values({ practiceId, userId: opts.userId ?? null, action: "collections_placed", entity: "patient", entityId: c.patientId, details: { agency: name, amountCents: balance } });
  return row;
}

/**
 * Closes an account. At the agency: "settled" posts what the agency
 * recovered and leaves the rest written off; "recalled" posts what was
 * recovered and puts the rest back on the patient's balance. Before
 * placement, closing just ends the collection (the patient paid or agreed a plan).
 */
export async function closeCollection(db: Db, practiceId: string, collectionId: string, outcome: "settled" | "recalled", recoveredCents = 0, opts: { userId?: string; note?: string } = {}) {
  const c = await ownCollection(db, practiceId, collectionId);
  if (c.closedAt) throw new Error("This account is already closed");
  if (!Number.isInteger(recoveredCents) || recoveredCents < 0) throw new Error("Enter the amount recovered");
  if (c.stage === "agency") {
    if (recoveredCents > c.amountCents) throw new Error("More than was placed with the agency");
    const reinstate = outcome === "recalled" ? c.amountCents : recoveredCents;
    if (reinstate > 0) {
      await db.insert(ledgerEntries).values({ practiceId, patientId: c.patientId, type: "bad_debt", amountCents: -reinstate, note: outcome === "recalled" ? `Recalled from ${c.agency}` : `Recovered by ${c.agency}`, postedBy: opts.userId ?? null });
    }
    if (recoveredCents > 0) {
      await db.insert(ledgerEntries).values({ practiceId, patientId: c.patientId, type: "patient_payment", amountCents: recoveredCents, note: `Collected by ${c.agency}`, postedBy: opts.userId ?? null });
    }
  } else if (recoveredCents > 0) {
    throw new Error("Post the patient's payment in Patient billing; this only closes the notice");
  }
  const [row] = await db.update(patientCollections).set({ stage: outcome, closedAt: new Date(), notes: opts.note?.slice(0, 1000) ?? c.notes }).where(eq(patientCollections.id, c.id)).returning();
  await db.insert(auditLog).values({ practiceId, userId: opts.userId ?? null, action: `collections_${outcome}`, entity: "patient", entityId: c.patientId, details: { recoveredCents } });
  return row;
}

export async function listCollections(db: Db, practiceId: string) {
  const rows = await db
    .select({ collection: patientCollections, patient: patients })
    .from(patientCollections)
    .innerJoin(patients, eq(patients.id, patientCollections.patientId))
    .where(eq(patientCollections.practiceId, practiceId))
    .orderBy(asc(patientCollections.closedAt), desc(patientCollections.createdAt))
    .limit(500);
  return rows;
}

export async function getCollection(db: Db, practiceId: string, id: string) {
  const c = await ownCollection(db, practiceId, id);
  const [[patient], [practice]] = await Promise.all([
    db.select().from(patients).where(eq(patients.id, c.patientId)).limit(1),
    db.select().from(practices).where(eq(practices.id, practiceId)).limit(1),
  ]);
  return { collection: c, patient, practice };
}

/** The placement file for the agency: accounts currently with it. */
export async function agencyPlacements(db: Db, practiceId: string) {
  const rows = await db
    .select({ collection: patientCollections, patient: patients, lastPayment: sql<string | null>`(SELECT max(l.posted_at)::date::text FROM ledger_entries l WHERE l.patient_id = ${patients.id} AND l.type = 'patient_payment')` })
    .from(patientCollections)
    .innerJoin(patients, eq(patients.id, patientCollections.patientId))
    .where(and(eq(patientCollections.practiceId, practiceId), eq(patientCollections.stage, "agency")))
    .orderBy(asc(patientCollections.placedAt));
  return rows;
}
