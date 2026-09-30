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
import { getPolicies } from "./policies";
import { heldPatientIds, holdReason } from "./account-holds";
import { billableBalanceCents, qmbPatientIds } from "./patient-accounts";

const { patientCollections, patients, practices, ledgerEntries, statements, paymentPlans, auditLog } = schema;

export const FINAL_NOTICE_DAYS = 10;
export const MIN_BALANCE_CENTS = 2_500;
export type Collection = typeof patientCollections.$inferSelect;

/** Accounts that have had statements for 60+ days without paying, and are not on a plan or already in collections. */
export async function collectionCandidates(db: Db, practiceId: string, today = new Date()) {
  const held = await heldPatientIds(db, practiceId);
  const qmb = await qmbPatientIds(db, practiceId);
  const owing: Awaited<ReturnType<typeof patientsWithBalances>> = [];
  for (const o of await patientsWithBalances(db, practiceId, MIN_BALANCE_CENTS, 500)) {
    if (held.has(o.patientId)) continue;
    // Medicare cost-sharing a QMB patient cannot be billed never goes to collections.
    if (qmb.has(o.patientId)) { const b = await billableBalanceCents(db, o.patientId); if (b < MIN_BALANCE_CENTS) continue; o.balanceCents = b; }
    owing.push(o);
  }
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

/**
 * The practice's safeguards before an account goes to an agency (Settings on
 * the Collections page): a number of statements, days since the first one, a
 * minimum balance, and financial assistance offered (a sliding fee record
 * counts). States and nonprofit hospitals' rules differ, so the practice sets
 * them; none is assumed. Returns what is still missing.
 */
export async function collectionsReadiness(db: Db, practiceId: string, patientId: string, now = new Date()) {
  const rules = (await getPolicies(db, practiceId)).collections ?? {};
  const missing: string[] = [];
  const [stmt] = await db.select({ n: sql<number>`count(*)::int`, first: sql<string | null>`min(${statements.statementDate})::text` }).from(statements)
    .where(and(eq(statements.patientId, patientId), sql`${statements.status} <> 'void'`));
  const count = Number(stmt?.n ?? 0);
  if (rules.minStatements && count < rules.minStatements) missing.push(`${rules.minStatements} statements sent (${count} so far)`);
  if (rules.minDaysSinceFirst) {
    const days = stmt?.first ? Math.floor((now.getTime() - Date.parse(`${stmt.first}T12:00:00Z`)) / 86_400_000) : 0;
    if (days < rules.minDaysSinceFirst) missing.push(`${rules.minDaysSinceFirst} days since the first statement (${stmt?.first ? `${days} so far` : "none sent"})`);
  }
  const balance = await patientBalanceCents(db, patientId);
  if (rules.minBalanceCents && balance < rules.minBalanceCents) missing.push(`a balance of at least $${(rules.minBalanceCents / 100).toFixed(2)} (it is $${(balance / 100).toFixed(2)})`);
  if (rules.requireAssistanceOffer) {
    const [p] = await db.select({ offered: patients.assistanceOfferedOn }).from(patients).where(eq(patients.id, patientId)).limit(1);
    const [fee] = await db.select({ id: schema.patientSlidingFees.patientId }).from(schema.patientSlidingFees).where(eq(schema.patientSlidingFees.patientId, patientId)).limit(1);
    if (!p?.offered && !fee) missing.push("financial assistance offered to the patient (record it on the account)");
  }
  return { ready: missing.length === 0, missing };
}

/** Records that the patient was offered financial assistance (or a sliding fee) on a date. */
export async function recordAssistanceOffered(db: Db, practiceId: string, patientId: string, on: string, userId?: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(on)) throw new Error("Enter the date assistance was offered");
  const [p] = await db.update(patients).set({ assistanceOfferedOn: on }).where(and(eq(patients.id, patientId), eq(patients.practiceId, practiceId))).returning();
  if (!p) throw new Error("Patient not found");
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "assistance_offered", entity: "patient", entityId: patientId, details: { on } });
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
  const hold = await holdReason(db, patientId);
  if (hold) throw new Error(hold);
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
export async function placeWithAgency(db: Db, practiceId: string, collectionId: string, agency: string, opts: { userId?: string; now?: Date; commissionPct?: number | null } = {}) {
  const c = await ownCollection(db, practiceId, collectionId);
  const hold = await holdReason(db, c.patientId);
  if (hold) throw new Error(hold);
  if (c.stage !== "final_notice") throw new Error("Only an account at the final-notice stage can be placed");
  const name = agency.trim();
  if (!name) throw new Error("Name the collection agency");
  const now = opts.now ?? new Date();
  const earliest = new Date(c.finalNoticeAt!.getTime() + FINAL_NOTICE_DAYS * 86_400_000);
  if (now < earliest) throw new Error(`The final notice gives the patient until ${earliest.toISOString().slice(0, 10)}; place the account after that`);
  const balance = await patientBalanceCents(db, c.patientId);
  if (balance <= 0) throw new Error("The balance has been paid; close this account instead");
  const readiness = await collectionsReadiness(db, practiceId, c.patientId, now);
  if (!readiness.ready) throw new Error(`The practice's collection safeguards are not met yet: ${readiness.missing.join("; ")}`);
  await db.insert(ledgerEntries).values({ practiceId, patientId: c.patientId, type: "bad_debt", amountCents: balance, note: `Bad debt: placed with ${name}`, postedBy: opts.userId ?? null });
  const [row] = await db.update(patientCollections).set({ stage: "agency", agency: name.slice(0, 200), placedAt: now, amountCents: balance, commissionPct: opts.commissionPct ?? null }).where(eq(patientCollections.id, c.id)).returning();
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
      await db.insert(ledgerEntries).values({ practiceId, patientId: c.patientId, type: "patient_payment", paymentMethod: "agency", amountCents: recoveredCents, note: `Collected by ${c.agency}`, postedBy: opts.userId ?? null });
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

/* ------------------------------ Agency recoveries ------------------------------ */

/**
 * A payment the agency collected on a placed account. The patient is credited
 * with everything they paid (gross); the agency keeps its commission and sends
 * the rest. The commission is recorded here and reaches the accounting journal
 * as collection agency fees, so cash matches what the bank received.
 */
export async function recordAgencyRecovery(db: Db, practiceId: string, collectionId: string, input: { receivedOn: string; grossCents: number; commissionCents?: number; reference?: string }, userId?: string) {
  const c = await ownCollection(db, practiceId, collectionId);
  if (c.stage !== "agency" || c.closedAt) throw new Error("Only an account open with an agency can take a recovery");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.receivedOn)) throw new Error("Enter the date the agency's payment arrived");
  if (!Number.isInteger(input.grossCents) || input.grossCents <= 0) throw new Error("Enter what the agency collected from the patient");
  const [{ sofar }] = (await db.execute<{ sofar: string }>(sql`SELECT COALESCE(sum(gross_cents), 0)::text AS sofar FROM agency_recoveries WHERE collection_id = ${collectionId}`)).rows;
  if (Number(sofar) + input.grossCents > c.amountCents) throw new Error("That is more than was placed with the agency");
  const commission = input.commissionCents ?? (c.commissionPct ? Math.round((input.grossCents * c.commissionPct) / 100) : 0);
  if (!Number.isInteger(commission) || commission < 0 || commission > input.grossCents) throw new Error("The commission is between $0 and what was collected");
  await db.insert(schema.agencyRecoveries).values({ practiceId, collectionId, receivedOn: input.receivedOn, grossCents: input.grossCents, commissionCents: commission, reference: input.reference?.trim().slice(0, 80) || null, createdBy: userId ?? null });
  // The written-off balance comes back and is paid in full from the patient's side.
  await db.insert(ledgerEntries).values([
    { practiceId, patientId: c.patientId, type: "bad_debt", amountCents: -input.grossCents, note: `Recovered by ${c.agency}`, postedBy: userId ?? null },
    { practiceId, patientId: c.patientId, type: "patient_payment", paymentMethod: "agency", amountCents: input.grossCents, note: `Collected by ${c.agency}${input.reference ? ` (${input.reference.trim().slice(0, 40)})` : ""}`, postedBy: userId ?? null },
  ]);
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "agency_recovery", entity: "patient", entityId: c.patientId, details: { collectionId, grossCents: input.grossCents, commission } });
  return { grossCents: input.grossCents, commissionCents: commission, netCents: input.grossCents - commission };
}

export async function setCommission(db: Db, practiceId: string, collectionId: string, pct: number | null) {
  await ownCollection(db, practiceId, collectionId);
  if (pct !== null && (!Number.isFinite(pct) || pct < 0 || pct > 75)) throw new Error("The commission is 0% to 75%");
  await db.update(patientCollections).set({ commissionPct: pct }).where(eq(patientCollections.id, collectionId));
}

/** Each agency's results: accounts and dollars placed, collected, its commission, what the practice received, and how fast. */
export async function agencyPerformance(db: Db, practiceId: string) {
  const { rows } = await db.execute<Record<string, string | null>>(sql`
    SELECT pc.agency, count(DISTINCT pc.id)::text AS accounts, COALESCE(sum(pc.amount_cents), 0)::text AS placed,
      COALESCE(sum(r.gross), 0)::text AS gross, COALESCE(sum(r.commission), 0)::text AS commission,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY r.first_on - pc.placed_at::date) AS median_days
    FROM patient_collections pc
    LEFT JOIN (SELECT collection_id, sum(gross_cents) AS gross, sum(commission_cents) AS commission, min(received_on) AS first_on FROM agency_recoveries GROUP BY collection_id) r ON r.collection_id = pc.id
    WHERE pc.practice_id = ${practiceId} AND pc.placed_at IS NOT NULL AND pc.agency IS NOT NULL
    GROUP BY pc.agency ORDER BY sum(pc.amount_cents) DESC`);
  return rows.map((r) => {
    const placed = Number(r.placed), gross = Number(r.gross), commission = Number(r.commission);
    return { agency: r.agency!, accounts: Number(r.accounts), placedCents: placed, grossCents: gross, commissionCents: commission, netCents: gross - commission, recoveryRate: placed ? gross / placed : 0, medianDaysToFirst: r.median_days === null ? null : Math.round(Number(r.median_days)) };
  });
}

/** Commissions agencies kept in a month, for the accounting journal. */
export async function commissionsInPeriod(db: Db, practiceId: string, start: Date, end: Date) {
  const [{ cents }] = (await db.execute<{ cents: string }>(sql`
    SELECT COALESCE(sum(commission_cents), 0)::text AS cents FROM agency_recoveries
    WHERE practice_id = ${practiceId} AND received_on >= ${start.toISOString().slice(0, 10)} AND received_on < ${end.toISOString().slice(0, 10)}`)).rows;
  return Number(cents);
}
