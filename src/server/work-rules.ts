/**
 * Work queues: rules that turn new denials, stalled claims and rejections
 * into tasks, assigned round-robin among the people named on the rule, due
 * within the rule's service level. Anything that already has an open task is
 * left alone, so a rule can run every day without piling up duplicates.
 *
 * Also the service-level view (what is overdue) and productivity per person
 * (tasks finished, how fast, and what is still open).
 */
import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import type { WorkConditions } from "@/db/schema";

const { workRules, tasks, auditLog } = schema;
type Row = Record<string, string | null>;

export const RULE_KINDS: Record<string, { label: string; description: string }> = {
  denials: { label: "Open denials", description: "Each open denial without a task" },
  stalled_claims: { label: "Stalled claims", description: "Claims submitted but unpaid after a number of days" },
  rejections: { label: "Rejected claims", description: "Claims the clearinghouse or payer rejected, or that failed scrubbing" },
};

export async function listRules(db: Db, practiceId: string) {
  return db.select().from(workRules).where(eq(workRules.practiceId, practiceId)).orderBy(asc(workRules.createdAt));
}

export async function saveRule(db: Db, practiceId: string, input: { id?: string | null; name: string; kind: string; conditions: WorkConditions; assigneeIds: string[]; slaDays: number; priority: string }, userId?: string) {
  const name = input.name.trim().slice(0, 80);
  if (!name) throw new Error("Name the rule");
  if (!(input.kind in RULE_KINDS)) throw new Error("Choose what the rule watches");
  if (!Number.isInteger(input.slaDays) || input.slaDays < 1 || input.slaDays > 60) throw new Error("The service level is 1 to 60 days");
  if (!input.assigneeIds.length) throw new Error("Choose at least one person to assign to");
  const { rows } = await db.execute<{ id: string }>(sql`
    SELECT u.id FROM users u WHERE u.disabled_at IS NULL AND u.role <> 'readonly' AND (u.practice_id = ${practiceId} OR EXISTS (SELECT 1 FROM practice_memberships m WHERE m.user_id = u.id AND m.practice_id = ${practiceId} AND m.role <> 'readonly'))`);
  const allowed = new Set(rows.map((r) => r.id));
  const assigneeIds = [...new Set(input.assigneeIds)].filter((id) => allowed.has(id));
  if (!assigneeIds.length) throw new Error("Those people cannot be assigned work here");
  const conditions: WorkConditions = {
    ...(input.conditions.payerIds?.length ? { payerIds: input.conditions.payerIds } : {}),
    ...(input.conditions.minCents ? { minCents: Math.max(0, Math.round(input.conditions.minCents)) } : {}),
    ...(input.conditions.categories?.length ? { categories: input.conditions.categories } : {}),
    ...(input.kind === "stalled_claims" ? { minAgeDays: Math.min(365, Math.max(7, Math.round(input.conditions.minAgeDays ?? 30))) } : {}),
  };
  const values = { name, kind: input.kind, conditions, assigneeIds, slaDays: input.slaDays, priority: ["low", "normal", "high"].includes(input.priority) ? input.priority : "normal" };
  const [row] = input.id
    ? await db.update(workRules).set(values).where(and(eq(workRules.id, input.id), eq(workRules.practiceId, practiceId))).returning()
    : await db.insert(workRules).values({ practiceId, ...values, createdBy: userId ?? null }).returning();
  if (!row) throw new Error("Rule not found");
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "work_rule_saved", entity: "work_rule", entityId: row.id });
  return row;
}

export async function setRuleActive(db: Db, practiceId: string, id: string, active: boolean) {
  await db.update(workRules).set({ active }).where(and(eq(workRules.id, id), eq(workRules.practiceId, practiceId)));
}

export async function hasActiveRules(db: Db, practiceId: string) {
  const [r] = await db.select({ id: workRules.id }).from(workRules).where(and(eq(workRules.practiceId, practiceId), eq(workRules.active, true))).limit(1);
  return !!r;
}

/** Items a rule matches that have no open task yet. */
async function candidates(db: Db, practiceId: string, rule: typeof workRules.$inferSelect, limit: number, now: Date) {
  const c = rule.conditions;
  const payer = c.payerIds?.length ? sql`AND c.payer_id IN (${sql.join(c.payerIds.map((p) => sql`${p}`), sql`, `)})` : sql``;
  const noTask = (type: string, col: string) => sql.raw(`AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.entity_type = '${type}' AND t.entity_id = ${col} AND t.status = 'open')`);
  if (rule.kind === "denials") {
    const cat = c.categories?.length ? sql`AND d.category IN (${sql.join(c.categories.map((x) => sql`${x}`), sql`, `)})` : sql``;
    const { rows } = await db.execute<Row>(sql`
      SELECT d.id, 'denial' AS type, c.control_number AS label, d.amount_cents::text AS cents FROM denials d JOIN claims c ON c.id = d.claim_id
      WHERE d.practice_id = ${practiceId} AND d.status = 'open' AND d.amount_cents >= ${c.minCents ?? 0} ${payer} ${cat} ${noTask("denial", "d.id")}
      ORDER BY d.amount_cents DESC LIMIT ${limit}`);
    return rows;
  }
  if (rule.kind === "stalled_claims") {
    const before = new Date(now.getTime() - (c.minAgeDays ?? 30) * 86_400_000);
    const { rows } = await db.execute<Row>(sql`
      SELECT c.id, 'claim' AS type, c.control_number AS label, c.total_cents::text AS cents FROM claims c
      WHERE c.practice_id = ${practiceId} AND c.status IN ('submitted', 'accepted', 'pending') AND c.submitted_at < ${before} AND c.total_cents >= ${c.minCents ?? 0} ${payer}
        AND NOT EXISTS (SELECT 1 FROM ledger_entries l WHERE l.claim_id = c.id AND l.type = 'insurance_payment') ${noTask("claim", "c.id")}
      ORDER BY c.submitted_at LIMIT ${limit}`);
    return rows;
  }
  const { rows } = await db.execute<Row>(sql`
    SELECT c.id, 'claim' AS type, c.control_number AS label, c.total_cents::text AS cents FROM claims c
    WHERE c.practice_id = ${practiceId} AND c.status IN ('rejected', 'scrub_errors') AND c.total_cents >= ${c.minCents ?? 0} ${payer} ${noTask("claim", "c.id")}
    ORDER BY c.updated_at LIMIT ${limit}`);
  return rows;
}

const TITLES: Record<string, (label: string) => string> = {
  denials: (l) => `Work denial on claim ${l}`,
  stalled_claims: (l) => `Follow up unpaid claim ${l}`,
  rejections: (l) => `Fix and resubmit claim ${l}`,
};

/** Runs every active rule once. At most `limit` new tasks per rule per run. */
export async function applyRules(db: Db, practiceId: string, opts: { limit?: number; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const out: Record<string, number> = {};
  for (const rule of (await listRules(db, practiceId)).filter((r) => r.active)) {
    const items = await candidates(db, practiceId, rule, opts.limit ?? 200, now);
    let next = rule.nextIndex;
    const due = new Date(now.getTime() + rule.slaDays * 86_400_000).toISOString().slice(0, 10);
    for (const item of items) {
      const assigneeId = rule.assigneeIds[next % rule.assigneeIds.length];
      next++;
      await db.insert(tasks).values({ practiceId, title: TITLES[rule.kind](item.label ?? ""), entityType: item.type, entityId: item.id, assigneeId, dueDate: due, priority: rule.priority, ruleId: rule.id, note: `Assigned by the rule "${rule.name}"` });
    }
    if (items.length) await db.update(workRules).set({ nextIndex: next % Math.max(1, rule.assigneeIds.length) }).where(eq(workRules.id, rule.id));
    out[rule.name] = items.length;
  }
  return out;
}

/* ------------------------------ Service levels and productivity ------------------------------ */

export async function slaSummary(db: Db, practiceId: string, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const { rows } = await db.execute<Row>(sql`
    SELECT r.id, r.name, r.sla_days::text AS sla,
      count(t.id) FILTER (WHERE t.status = 'open')::text AS open,
      count(t.id) FILTER (WHERE t.status = 'open' AND t.due_date < ${today})::text AS overdue,
      count(t.id) FILTER (WHERE t.status = 'done' AND t.completed_at >= ${new Date(now.getTime() - 30 * 86_400_000)})::text AS done30,
      count(t.id) FILTER (WHERE t.status = 'done' AND t.completed_at >= ${new Date(now.getTime() - 30 * 86_400_000)} AND t.completed_at::date <= t.due_date)::text AS ontime30
    FROM work_rules r LEFT JOIN tasks t ON t.rule_id = r.id
    WHERE r.practice_id = ${practiceId}
    GROUP BY r.id, r.name, r.sla_days ORDER BY r.name`);
  return rows.map((r) => ({ ruleId: r.id!, name: r.name!, slaDays: Number(r.sla), open: Number(r.open), overdue: Number(r.overdue), done30: Number(r.done30), onTimePct: Number(r.done30) ? Number(r.ontime30) / Number(r.done30) : null }));
}

export async function productivity(db: Db, practiceId: string, now = new Date()) {
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const today = now.toISOString().slice(0, 10);
  const { rows } = await db.execute<Row>(sql`
    SELECT u.id, u.name,
      count(t.id) FILTER (WHERE t.status = 'done' AND t.completed_at >= ${since})::text AS done30,
      count(t.id) FILTER (WHERE t.status = 'done' AND t.completed_at >= ${new Date(now.getTime() - 7 * 86_400_000)})::text AS done7,
      avg(extract(epoch FROM (t.completed_at - t.created_at)) / 86400) FILTER (WHERE t.status = 'done' AND t.completed_at >= ${since})::text AS days,
      count(t.id) FILTER (WHERE t.status = 'open')::text AS open,
      count(t.id) FILTER (WHERE t.status = 'open' AND t.due_date < ${today})::text AS overdue,
      (SELECT count(*) FROM ledger_entries l WHERE l.practice_id = ${practiceId} AND l.posted_by = u.id AND l.posted_at >= ${since})::text AS postings
    FROM users u JOIN tasks t ON t.assignee_id = u.id AND t.practice_id = ${practiceId}
    GROUP BY u.id, u.name ORDER BY count(t.id) FILTER (WHERE t.status = 'done' AND t.completed_at >= ${since}) DESC`);
  return rows.map((r) => ({ userId: r.id!, name: r.name!, done30: Number(r.done30), done7: Number(r.done7), avgDays: r.days === null ? null : Number(r.days), open: Number(r.open), overdue: Number(r.overdue), postings: Number(r.postings) }));
}
