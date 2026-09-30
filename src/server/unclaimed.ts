/**
 * Unclaimed patient credits. Money a patient overpaid belongs to the patient;
 * when the account has had no activity for the state's dormancy period, state
 * unclaimed property law has the practice send a due-diligence letter, then
 * report and remit what is still unclaimed to the state.
 *
 * Dormancy periods, letter rules and report dates differ by state, so the
 * practice sets them (Credits page); nothing is assumed. The list here is a
 * worksheet for the state's report, not the report file itself (states take
 * the NAUPA format through their own portals).
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { getPolicies } from "./policies";
import { patientBalanceSql } from "./billing";

const { unclaimedCredits, ledgerEntries, patients, auditLog } = schema;

type Row = Record<string, string | null>;

/** Days after the letter with no answer before a credit is ready to report. */
export const LETTER_WAIT_DAYS = 30;
const ACTIVE = ["letter_due", "letter_sent", "to_report"];
const today = (now: Date) => now.toISOString().slice(0, 10);
const minusMonths = (iso: string, months: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
};

/**
 * Finds credits past the dormancy period and opens a case for each; closes
 * cases whose credit is gone (refunded or applied). Returns the open cases.
 */
export async function scanUnclaimed(db: Db, practiceId: string, now = new Date(), userId?: string) {
  const settings = (await getPolicies(db, practiceId)).unclaimed;
  if (!settings) return { configured: false as const, cases: [] };
  const cutoff = minusMonths(today(now), settings.dormancyMonths);
  const { rows } = await db.execute<Row>(sql`
    SELECT patient_id, (-(${patientBalanceSql}))::text AS credit, max(posted_at)::date::text AS last_activity
    FROM ledger_entries WHERE practice_id = ${practiceId}
    GROUP BY patient_id HAVING (${patientBalanceSql}) <= -100`);
  const credits = new Map(rows.map((r) => [r.patient_id!, { credit: Number(r.credit), last: r.last_activity! }]));
  const open = await db.select().from(unclaimedCredits).where(and(eq(unclaimedCredits.practiceId, practiceId), inArray(unclaimedCredits.status, ACTIVE)));
  for (const c of open) {
    const now_ = credits.get(c.patientId);
    if (!now_) await db.update(unclaimedCredits).set({ status: "resolved", resolvedOn: today(now), resolution: "The credit was refunded or applied" }).where(eq(unclaimedCredits.id, c.id));
    else if (now_.last > c.lastActivityOn) await db.update(unclaimedCredits).set({ status: "resolved", resolvedOn: today(now), resolution: "New activity on the account" }).where(eq(unclaimedCredits.id, c.id));
    else if (now_.credit !== c.amountCents) await db.update(unclaimedCredits).set({ amountCents: now_.credit }).where(eq(unclaimedCredits.id, c.id));
  }
  const tracked = new Set(open.map((c) => c.patientId));
  const fresh = [...credits].filter(([pid, c]) => !tracked.has(pid) && c.last <= cutoff);
  if (fresh.length) {
    await db.insert(unclaimedCredits).values(fresh.map(([patientId, c]) => ({
      practiceId, patientId, amountCents: c.credit, lastActivityOn: c.last,
      // Below the letter minimum, the state still gets the report; no letter is needed.
      status: c.credit >= settings.letterMinCents ? "letter_due" : "to_report", createdBy: userId ?? null,
    }))).onConflictDoNothing();
  }
  return { configured: true as const, settings, cases: await unclaimedCases(db, practiceId, now) };
}

export type UnclaimedCase = typeof unclaimedCredits.$inferSelect & { name: string; mrn: string; address: string; readyToReport: boolean };

export async function unclaimedCases(db: Db, practiceId: string, now = new Date()) {
  const rows = await db.select({ c: unclaimedCredits, p: patients }).from(unclaimedCredits).innerJoin(patients, eq(patients.id, unclaimedCredits.patientId))
    .where(and(eq(unclaimedCredits.practiceId, practiceId), inArray(unclaimedCredits.status, ACTIVE))).orderBy(unclaimedCredits.lastActivityOn);
  const waitUntil = new Date(now.getTime() - LETTER_WAIT_DAYS * 86_400_000).toISOString().slice(0, 10);
  return rows.map(({ c, p }): UnclaimedCase => ({
    ...c, name: `${p.lastName}, ${p.firstName}`, mrn: p.mrn,
    address: [p.address1, [p.city, p.state].filter(Boolean).join(", "), p.zip].filter(Boolean).join(" "),
    readyToReport: c.status === "to_report" || (c.status === "letter_sent" && !!c.letterSentOn && c.letterSentOn <= waitUntil),
  }));
}

async function caseIn(db: Db, practiceId: string, id: string) {
  const [c] = await db.select().from(unclaimedCredits).where(and(eq(unclaimedCredits.id, id), eq(unclaimedCredits.practiceId, practiceId))).limit(1);
  if (!c) throw new Error("Credit not found");
  return c;
}

export async function markLetterSent(db: Db, practiceId: string, id: string, sentOn: string, userId?: string) {
  const c = await caseIn(db, practiceId, id);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sentOn)) throw new Error("Enter the date the letter was sent");
  if (c.status !== "letter_due" && c.status !== "letter_sent") throw new Error("This credit does not need a letter");
  await db.update(unclaimedCredits).set({ status: "letter_sent", letterSentOn: sentOn }).where(eq(unclaimedCredits.id, id));
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "unclaimed_letter_sent", entity: "patient", entityId: c.patientId, details: { caseId: id, sentOn } });
}

/** The patient answered: the credit is refunded or applied through the usual refund flow, and the case closes. */
export async function resolveUnclaimed(db: Db, practiceId: string, id: string, resolution: string, userId?: string) {
  const c = await caseIn(db, practiceId, id);
  const text = resolution.trim().slice(0, 300);
  if (!text) throw new Error("Record what happened (for example: patient asked for a refund)");
  await db.update(unclaimedCredits).set({ status: "resolved", resolvedOn: new Date().toISOString().slice(0, 10), resolution: text }).where(eq(unclaimedCredits.id, id));
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "unclaimed_resolved", entity: "patient", entityId: c.patientId, details: { caseId: id, resolution: text } });
}

/**
 * Reported and remitted to the state: the credit leaves the patient's account
 * as a payment out (like a refund, to the state), so the balance is zero.
 */
export async function markReported(db: Db, practiceId: string, id: string, year: number, userId?: string, now = new Date()) {
  const c = await caseIn(db, practiceId, id);
  const ready = (await unclaimedCases(db, practiceId, now)).find((x) => x.id === id);
  if (!ready?.readyToReport) throw new Error(c.status === "letter_due" ? "Send the due-diligence letter first" : `Wait ${LETTER_WAIT_DAYS} days after the letter for an answer`);
  if (!Number.isInteger(year) || year < 2000) throw new Error("Give the report year");
  const state = (await getPolicies(db, practiceId)).unclaimed?.state ?? "the state";
  await db.insert(ledgerEntries).values({ practiceId, patientId: c.patientId, type: "refund", amountCents: c.amountCents, note: `Unclaimed property reported and remitted to ${state} (${year} report)`, postedBy: userId ?? null });
  await db.update(unclaimedCredits).set({ status: "reported", reportedYear: year, resolvedOn: now.toISOString().slice(0, 10), resolution: `Reported to ${state}` }).where(eq(unclaimedCredits.id, id));
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "unclaimed_reported", entity: "patient", entityId: c.patientId, details: { caseId: id, amountCents: c.amountCents, year, state } });
}

export async function unclaimedCase(db: Db, practiceId: string, id: string) {
  const [row] = await db.select({ c: unclaimedCredits, p: patients }).from(unclaimedCredits).innerJoin(patients, eq(patients.id, unclaimedCredits.patientId))
    .where(and(eq(unclaimedCredits.id, id), eq(unclaimedCredits.practiceId, practiceId))).limit(1);
  return row ?? null;
}
