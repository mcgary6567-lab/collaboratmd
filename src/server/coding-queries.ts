/**
 * Questions to providers. A coder who cannot bill a visit as documented asks
 * the provider (the level is not supported, laterality is missing, a
 * diagnosis is unclear); the claim is held by the scrubber until the question
 * is answered or withdrawn. Questions are worded to ask, not to lead: the
 * provider documents what happened, and the coder codes from that.
 *
 * Providers are not always users here, so the answer is recorded by whoever
 * enters it, with the provider named on the question.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import type { ScrubFinding } from "@/lib/scrub/rules";
import { notify } from "./notifications";

const { codingQueries, encounters, auditLog } = schema;

export const QUERY_TOPICS: Record<string, string> = {
  level: "Visit level not supported by the note",
  diagnosis: "Diagnosis unclear or not specific enough",
  laterality: "Side (left, right, both) missing",
  procedure: "Procedure details missing",
  time: "Time not documented",
  signature: "Note not signed or incomplete",
  other: "Other",
};

export async function askProvider(db: Db, practiceId: string, input: { encounterId: string; topic: string; question: string }, userId?: string) {
  const [e] = await db.select().from(encounters).where(and(eq(encounters.id, input.encounterId), eq(encounters.practiceId, practiceId))).limit(1);
  if (!e) throw new Error("Visit not found");
  if (!QUERY_TOPICS[input.topic]) throw new Error("Choose what the question is about");
  const question = input.question.trim().slice(0, 2000);
  if (question.length < 10) throw new Error("Write the question for the provider");
  const [row] = await db.insert(codingQueries).values({ practiceId, encounterId: e.id, providerId: e.providerId, topic: input.topic, question, askedBy: userId ?? null }).returning();
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "coding_query_asked", entity: "encounter", entityId: e.id, details: { queryId: row.id, topic: input.topic } });
  await notify(db, practiceId, { kind: "coding_query", title: `Question for the provider: ${QUERY_TOPICS[input.topic]}`, body: question.slice(0, 300), href: "/coding/queries", dedupeKey: `coding_query:${row.id}` });
  return row;
}

async function openQuery(db: Db, practiceId: string, id: string) {
  const [q] = await db.select().from(codingQueries).where(and(eq(codingQueries.id, id), eq(codingQueries.practiceId, practiceId))).limit(1);
  if (!q) throw new Error("Question not found");
  if (q.status !== "open") throw new Error("This question is already closed");
  return q;
}

export async function answerQuery(db: Db, practiceId: string, id: string, answer: string, userId?: string) {
  const q = await openQuery(db, practiceId, id);
  const text = answer.trim().slice(0, 4000);
  if (!text) throw new Error("Enter the provider's answer");
  await db.update(codingQueries).set({ status: "answered", answer: text, answeredBy: userId ?? null, answeredAt: new Date() }).where(eq(codingQueries.id, id));
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "coding_query_answered", entity: "encounter", entityId: q.encounterId, details: { queryId: id } });
}

export async function withdrawQuery(db: Db, practiceId: string, id: string, userId?: string) {
  const q = await openQuery(db, practiceId, id);
  await db.update(codingQueries).set({ status: "withdrawn", answeredBy: userId ?? null, answeredAt: new Date() }).where(eq(codingQueries.id, id));
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "coding_query_withdrawn", entity: "encounter", entityId: q.encounterId, details: { queryId: id } });
}

/** Holds the claim while a question about its visit is open. */
export async function queryFindings(db: Db, encounterId: string): Promise<ScrubFinding[]> {
  const open = await db.select({ topic: codingQueries.topic }).from(codingQueries).where(and(eq(codingQueries.encounterId, encounterId), eq(codingQueries.status, "open")));
  return open.map((q) => ({ rule: "CODING_QUERY", severity: "error", field: "encounter", message: `Waiting for the provider's answer: ${QUERY_TOPICS[q.topic] ?? q.topic}` }));
}

export async function listQueries(db: Db, practiceId: string, status: "open" | "closed" = "open", limit = 200) {
  const { rows } = await db.execute<Record<string, string | null>>(sql`
    SELECT q.id, q.encounter_id, q.topic, q.question, q.answer, q.status, q.asked_at::text AS asked_at, q.answered_at::text AS answered_at,
      pr.first_name || ' ' || pr.last_name AS provider, p.id AS patient_id, p.last_name || ', ' || p.first_name AS patient, e.date_of_service::text AS dos,
      (SELECT c.id FROM claims c WHERE c.encounter_id = e.id ORDER BY c.created_at DESC LIMIT 1) AS claim_id,
      u.name AS asked_by
    FROM coding_queries q JOIN encounters e ON e.id = q.encounter_id JOIN patients p ON p.id = e.patient_id JOIN providers pr ON pr.id = q.provider_id
    LEFT JOIN users u ON u.id = q.asked_by
    WHERE q.practice_id = ${practiceId} AND ${status === "open" ? sql`q.status = 'open'` : sql`q.status <> 'open'`}
    ORDER BY ${status === "open" ? sql`q.asked_at` : sql`q.answered_at DESC`} LIMIT ${limit}`);
  return rows;
}

/** Per provider over the last 12 months: questions asked, still open, and the median days to answer. */
export async function queryStats(db: Db, practiceId: string) {
  const { rows } = await db.execute<Record<string, string | null>>(sql`
    SELECT pr.first_name || ' ' || pr.last_name AS provider, count(*)::text AS asked,
      count(*) FILTER (WHERE q.status = 'open')::text AS open,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (q.answered_at - q.asked_at)) / 86400) FILTER (WHERE q.status = 'answered') AS median_days
    FROM coding_queries q JOIN providers pr ON pr.id = q.provider_id
    WHERE q.practice_id = ${practiceId} AND q.asked_at >= now() - interval '365 days'
    GROUP BY pr.id, pr.first_name, pr.last_name ORDER BY count(*) DESC`);
  return rows.map((r) => ({ provider: r.provider!, asked: Number(r.asked), open: Number(r.open), medianDays: r.median_days === null ? null : Math.round(Number(r.median_days) * 10) / 10 }));
}

export async function queriesForEncounters(db: Db, encounterIds: string[]) {
  if (!encounterIds.length) return [];
  return db.select().from(codingQueries).where(inArray(codingQueries.encounterId, encounterIds)).orderBy(desc(codingQueries.askedAt));
}
