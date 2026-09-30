/**
 * Internal coding audits. The OIG's compliance program guidance for physician
 * practices expects a practice to check its own coding regularly: a random
 * sample of each provider's claims, compared with the documentation by
 * someone other than the person who coded it. Each sampled claim is marked
 * correct or in error, with what the error was, and each provider's accuracy
 * is reported against a 95% target (a common benchmark; the practice decides
 * what to do below it, usually education and a follow-up audit).
 */
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";

const { codingAudits, codingAuditItems, auditLog } = schema;
type Row = Record<string, string | null>;

export const ACCURACY_TARGET = 0.95;
export const FINDINGS: Record<string, string> = {
  level_high: "Visit level higher than documented",
  level_low: "Visit level lower than documented",
  diagnosis: "Diagnosis code wrong or not specific enough",
  modifier: "Modifier missing or not supported",
  procedure: "Procedure code wrong",
  units: "Units wrong",
  documentation: "Documentation missing or not signed",
  other: "Other",
};
const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * A random sample of each provider's billed claims in the period (original
 * claims that went out, one per visit), perProvider each, or all of them when
 * a provider has fewer.
 */
export async function createAudit(db: Db, practiceId: string, input: { name: string; fromDate: string; toDate: string; perProvider: number }, userId?: string) {
  const name = input.name.trim().slice(0, 120);
  if (!name) throw new Error("Name the audit (for example: Q3 2026 E/M review)");
  if (!isDay(input.fromDate) || !isDay(input.toDate) || input.fromDate > input.toDate) throw new Error("Choose the period");
  if (!Number.isInteger(input.perProvider) || input.perProvider < 1 || input.perProvider > 100) throw new Error("Claims per provider is 1 to 100");
  const { rows } = await db.execute<Row>(sql`
    SELECT claim_id, provider_id FROM (
      SELECT c.id AS claim_id, e.provider_id, row_number() OVER (PARTITION BY e.provider_id ORDER BY random()) AS n
      FROM claims c JOIN encounters e ON e.id = c.encounter_id
      WHERE c.practice_id = ${practiceId} AND c.frequency_code = '1' AND c.submitted_at IS NOT NULL
        AND e.date_of_service BETWEEN ${input.fromDate} AND ${input.toDate}
    ) s WHERE n <= ${input.perProvider}`);
  if (!rows.length) throw new Error("No billed claims in that period");
  const [audit] = await db.insert(codingAudits).values({ practiceId, name, fromDate: input.fromDate, toDate: input.toDate, perProvider: input.perProvider, createdBy: userId ?? null }).returning();
  await db.insert(codingAuditItems).values(rows.map((r) => ({ auditId: audit.id, claimId: r.claim_id!, providerId: r.provider_id! })));
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "coding_audit_created", entity: "coding_audit", entityId: audit.id, details: { claims: rows.length } });
  return { audit, claims: rows.length };
}

async function ownAudit(db: Db, practiceId: string, auditId: string) {
  const [a] = await db.select().from(codingAudits).where(and(eq(codingAudits.id, auditId), eq(codingAudits.practiceId, practiceId))).limit(1);
  if (!a) throw new Error("Audit not found");
  return a;
}

export async function scoreItem(db: Db, practiceId: string, itemId: string, input: { result: "correct" | "error"; finding?: string; billedCode?: string; correctCode?: string; note?: string }, userId?: string) {
  const [item] = await db.select({ item: codingAuditItems, practiceId: codingAudits.practiceId }).from(codingAuditItems).innerJoin(codingAudits, eq(codingAudits.id, codingAuditItems.auditId))
    .where(eq(codingAuditItems.id, itemId)).limit(1);
  if (!item || item.practiceId !== practiceId) throw new Error("Claim not found in this audit");
  if (input.result !== "correct" && input.result !== "error") throw new Error("Mark the claim correct or in error");
  if (input.result === "error" && !FINDINGS[input.finding ?? ""]) throw new Error("Say what the error was");
  await db.update(codingAuditItems).set({
    result: input.result, finding: input.result === "error" ? input.finding! : null,
    billedCode: input.billedCode?.trim().toUpperCase().slice(0, 20) || null, correctCode: input.correctCode?.trim().toUpperCase().slice(0, 20) || null,
    note: input.note?.trim().slice(0, 1000) || null, reviewedBy: userId ?? null, reviewedAt: new Date(),
  }).where(eq(codingAuditItems.id, itemId));
}

export async function auditDetail(db: Db, practiceId: string, auditId: string) {
  const audit = await ownAudit(db, practiceId, auditId);
  const { rows } = await db.execute<Row>(sql`
    SELECT i.id, i.claim_id, i.result, i.finding, i.billed_code, i.correct_code, i.note, c.control_number, e.date_of_service::text AS dos,
      p.last_name || ', ' || p.first_name AS patient, pr.id AS provider_id, pr.first_name || ' ' || pr.last_name AS provider,
      (SELECT string_agg(ch.cpt, ', ' ORDER BY ch.line_number) FROM charges ch WHERE ch.encounter_id = e.id) AS codes
    FROM coding_audit_items i JOIN claims c ON c.id = i.claim_id JOIN encounters e ON e.id = c.encounter_id JOIN patients p ON p.id = c.patient_id JOIN providers pr ON pr.id = i.provider_id
    WHERE i.audit_id = ${auditId} ORDER BY pr.last_name, e.date_of_service`);
  const byProvider = new Map<string, { provider: string; sampled: number; reviewed: number; errors: number; findings: Record<string, number> }>();
  for (const r of rows) {
    const p = byProvider.get(r.provider_id!) ?? { provider: r.provider!, sampled: 0, reviewed: 0, errors: 0, findings: {} };
    p.sampled++;
    if (r.result !== "pending") p.reviewed++;
    if (r.result === "error") { p.errors++; p.findings[r.finding!] = (p.findings[r.finding!] ?? 0) + 1; }
    byProvider.set(r.provider_id!, p);
  }
  const providers = [...byProvider.values()].map((p) => ({ ...p, accuracy: p.reviewed ? (p.reviewed - p.errors) / p.reviewed : null, belowTarget: p.reviewed > 0 && (p.reviewed - p.errors) / p.reviewed < ACCURACY_TARGET }));
  return { audit, items: rows, providers };
}

export async function listAudits(db: Db, practiceId: string) {
  const { rows } = await db.execute<Row>(sql`
    SELECT a.id, a.name, a.from_date::text AS from_date, a.to_date::text AS to_date, a.created_at::date::text AS created,
      count(i.id)::text AS sampled, count(i.id) FILTER (WHERE i.result <> 'pending')::text AS reviewed, count(i.id) FILTER (WHERE i.result = 'error')::text AS errors
    FROM coding_audits a LEFT JOIN coding_audit_items i ON i.audit_id = a.id
    WHERE a.practice_id = ${practiceId} GROUP BY a.id ORDER BY a.created_at DESC LIMIT 50`);
  return rows.map((r) => ({ id: r.id!, name: r.name!, fromDate: r.from_date!, toDate: r.to_date!, created: r.created!, sampled: Number(r.sampled), reviewed: Number(r.reviewed), errors: Number(r.errors) }));
}

