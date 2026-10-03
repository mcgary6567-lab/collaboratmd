/**
 * Quality checks of billers' work, alongside the coding audits of providers
 * (server/coding-audits.ts): an administrator draws a random sample of each
 * person's claims sent and payments or adjustments posted in a period;
 * someone other than the person who did the work checks each one and marks it
 * correct or wrong, with what was wrong. Each person's accuracy is reported
 * against a 95% target (a common benchmark for billing teams; the practice
 * decides what to do below it, usually coaching and a follow-up sample).
 */
import { and, desc, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { assignableUsers } from "./work";

const { workAudits, workAuditItems, auditLog, ledgerEntries, claims, users } = schema;
const DAY = 86_400_000;

export const QUALITY_TARGET = 0.95;
export const CLAIM_FINDINGS: Record<string, string> = {
  patient: "Patient or insurance details wrong",
  payer: "Sent to the wrong payer",
  codes: "Codes, modifiers or units wrong",
  dx: "Diagnosis or pointer wrong",
  auth: "Authorization or referral number missing",
  other: "Something else",
};
export const POSTING_FINDINGS: Record<string, string> = {
  amount: "Wrong amount",
  adjustment: "Wrong adjustment or reason code",
  account: "Posted to the wrong claim or patient",
  denial: "Denial not recorded or worked",
  other: "Something else",
};
export const findingsFor = (kind: string) => (kind === "claim" ? CLAIM_FINDINGS : POSTING_FINDINGS);

/** Up to `n` items picked at random. */
export function sample<T>(items: T[], n: number, rand = Math.random) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

/** Draws the sample: per person, up to `perPerson` claims they sent and as many postings. */
export async function createWorkAudit(db: Db, practiceId: string, by: string, input: { from: string; to: string; perPerson: number }, rand = Math.random) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.from) || !/^\d{4}-\d{2}-\d{2}$/.test(input.to) || input.to < input.from) throw new Error("Choose the period");
  if (!Number.isInteger(input.perPerson) || input.perPerson < 1 || input.perPerson > 50) throw new Error("Check 1 to 50 of each kind per person");
  const team = await assignableUsers(db, practiceId);
  const ids = team.map((t) => t.id);
  if (!ids.length) throw new Error("Nobody on the team yet");
  const start = new Date(`${input.from}T00:00:00Z`), end = new Date(Date.parse(`${input.to}T00:00:00Z`) + DAY);
  const [sent, posted] = await Promise.all([
    db.selectDistinct({ userId: auditLog.userId, refId: auditLog.entityId }).from(auditLog)
      .where(and(eq(auditLog.practiceId, practiceId), eq(auditLog.action, "submit_claim"), inArray(auditLog.userId, ids), gte(auditLog.at, start), lt(auditLog.at, end))),
    db.select({ userId: ledgerEntries.postedBy, refId: ledgerEntries.id }).from(ledgerEntries)
      .where(and(eq(ledgerEntries.practiceId, practiceId), inArray(ledgerEntries.postedBy, ids), ne(ledgerEntries.type, "charge"), gte(ledgerEntries.postedAt, start), lt(ledgerEntries.postedAt, end))),
  ]);
  const picked: { kind: string; refId: string; workerId: string }[] = [];
  for (const id of ids) {
    for (const [kind, rows] of [["claim", sent], ["posting", posted]] as const) {
      const mine = rows.filter((r) => r.userId === id && r.refId).map((r) => r.refId!);
      for (const refId of sample(mine, input.perPerson, rand)) picked.push({ kind, refId, workerId: id });
    }
  }
  if (!picked.length) throw new Error("Nobody sent claims or posted payments in that period");
  const [audit] = await db.insert(workAudits).values({ practiceId, fromDate: input.from, toDate: input.to, perPerson: input.perPerson, createdBy: by }).returning();
  await db.insert(workAuditItems).values(picked.map((p) => ({ ...p, auditId: audit.id, practiceId })));
  await db.insert(auditLog).values({ practiceId, userId: by, action: "work_audit_created", entity: "practice", entityId: practiceId, details: { auditId: audit.id, items: picked.length } });
  return { audit, items: picked.length };
}

/** Someone other than the person who did the work marks an item correct or wrong. */
export async function reviewWorkItem(db: Db, practiceId: string, itemId: string, reviewerId: string, input: { result: string; finding?: string; note?: string }, now = new Date()) {
  const [item] = await db.select().from(workAuditItems).where(and(eq(workAuditItems.id, itemId), eq(workAuditItems.practiceId, practiceId))).limit(1);
  if (!item) throw new Error("Not found");
  if (item.workerId === reviewerId) throw new Error("Someone else checks your own work");
  if (input.result !== "correct" && input.result !== "error") throw new Error("Mark it correct or wrong");
  const finding = input.result === "error" ? input.finding ?? "" : null;
  if (finding !== null && !findingsFor(item.kind)[finding]) throw new Error("Choose what was wrong");
  await db.update(workAuditItems).set({ result: input.result, finding, note: input.note?.trim().slice(0, 500) || null, reviewerId, reviewedAt: now }).where(eq(workAuditItems.id, itemId));
}

export async function workAuditList(db: Db, practiceId: string) {
  const { rows } = await db.execute<{ id: string; total: string; reviewed: string; errors: string }>(sql`
    SELECT a.id, count(i.id)::text AS total, count(i.id) FILTER (WHERE i.result <> 'pending')::text AS reviewed, count(i.id) FILTER (WHERE i.result = 'error')::text AS errors
    FROM work_audits a LEFT JOIN work_audit_items i ON i.audit_id = a.id WHERE a.practice_id = ${practiceId} GROUP BY a.id`);
  const audits = await db.select().from(workAudits).where(eq(workAudits.practiceId, practiceId)).orderBy(desc(workAudits.createdAt)).limit(50);
  return audits.map((a) => {
    const r = rows.find((x) => x.id === a.id);
    return { ...a, total: Number(r?.total ?? 0), reviewed: Number(r?.reviewed ?? 0), errors: Number(r?.errors ?? 0) };
  });
}

/** An audit's items, with who did the work and what each one is. */
export async function workAuditItemsFor(db: Db, practiceId: string, auditId: string) {
  const items = await db.select({ i: workAuditItems, worker: users.name }).from(workAuditItems).innerJoin(users, eq(users.id, workAuditItems.workerId))
    .where(and(eq(workAuditItems.auditId, auditId), eq(workAuditItems.practiceId, practiceId))).orderBy(users.name, workAuditItems.kind);
  const claimIds = items.filter((x) => x.i.kind === "claim").map((x) => x.i.refId);
  const entryIds = items.filter((x) => x.i.kind === "posting").map((x) => x.i.refId);
  const [cs, es] = await Promise.all([
    claimIds.length ? db.select({ id: claims.id, controlNumber: claims.controlNumber, status: claims.status }).from(claims).where(inArray(claims.id, claimIds)) : [],
    entryIds.length ? db.select({ id: ledgerEntries.id, type: ledgerEntries.type, amountCents: ledgerEntries.amountCents, patientId: ledgerEntries.patientId, claimId: ledgerEntries.claimId, postedAt: ledgerEntries.postedAt, reasonCode: ledgerEntries.reasonCode }).from(ledgerEntries).where(inArray(ledgerEntries.id, entryIds)) : [],
  ]);
  return items.map(({ i, worker }) => {
    if (i.kind === "claim") {
      const c = cs.find((x) => x.id === i.refId);
      return { ...i, worker, label: c ? `Claim ${c.controlNumber} (${c.status})` : "Claim (removed)", href: c ? `/claims/${c.id}` : null };
    }
    const e = es.find((x) => x.id === i.refId);
    return {
      ...i, worker,
      label: e ? `${e.type.replace(/_/g, " ")} of $${(Math.abs(e.amountCents) / 100).toFixed(2)}${e.reasonCode ? ` (${e.reasonCode})` : ""}, ${e.postedAt.toISOString().slice(0, 10)}` : "Posting (removed)",
      href: e ? (e.claimId ? `/claims/${e.claimId}` : `/patients/${e.patientId}`) : null,
    };
  });
}

/** Each person's accuracy over the checked items since a date, with the most common findings. */
export async function qualityByWorker(db: Db, practiceId: string, since: Date) {
  const rows = await db.select({ i: workAuditItems, worker: users.name }).from(workAuditItems).innerJoin(users, eq(users.id, workAuditItems.workerId))
    .innerJoin(workAudits, eq(workAudits.id, workAuditItems.auditId))
    .where(and(eq(workAuditItems.practiceId, practiceId), ne(workAuditItems.result, "pending"), gte(workAudits.createdAt, since)));
  const by = new Map<string, { workerId: string; name: string; reviewed: number; errors: number; findings: Record<string, number> }>();
  for (const { i, worker } of rows) {
    const w = by.get(i.workerId) ?? { workerId: i.workerId, name: worker, reviewed: 0, errors: 0, findings: {} };
    w.reviewed++;
    if (i.result === "error") {
      w.errors++;
      const label = findingsFor(i.kind)[i.finding ?? ""] ?? i.finding ?? "Other";
      w.findings[label] = (w.findings[label] ?? 0) + 1;
    }
    by.set(i.workerId, w);
  }
  return [...by.values()].map((w) => ({ ...w, accuracy: w.reviewed ? (w.reviewed - w.errors) / w.reviewed : null })).sort((a, b) => a.name.localeCompare(b.name));
}
