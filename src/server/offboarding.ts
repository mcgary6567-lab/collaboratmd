/**
 * Closing a practice: the administrator schedules it at least 30 days out
 * (time to export), can cancel until then, and on the day every row that
 * belongs to the practice is deleted, along with its stored files. What
 * remains is one line in practice_deletions saying it happened, for the BAA's
 * "return or destroy" obligation.
 *
 * Rows are found from the schema, the same way the export finds them, so a
 * table added later is deleted too. People who also work in another practice
 * keep their sign-in and move to that practice.
 */
import { and, eq, isNotNull, lte, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { fileStore } from "./files";
import { ACTIVE } from "./subscription";

const { practices, users, practiceMemberships, practiceDeletions, auditLog } = schema;
export const NOTICE_DAYS = 30;
const IDENT = /^[a-z_][a-z0-9_]*$/;
const q = (id: string) => {
  if (!IDENT.test(id)) throw new Error(`Unexpected identifier ${id}`);
  return `"${id}"`;
};

export async function scheduleClosure(db: Db, practiceId: string, input: { confirmName: string; userId: string }, now = new Date()) {
  const [p] = await db.select().from(practices).where(eq(practices.id, practiceId)).limit(1);
  if (!p) throw new Error("Practice not found");
  if (input.confirmName.trim() !== p.name.trim()) throw new Error("Type the practice name exactly to confirm");
  if (p.stripeSubscriptionId && ACTIVE.includes(p.subscriptionStatus)) throw new Error("Cancel the subscription first (Settings > Subscription > Manage billing), then schedule the closure");
  const closingAt = new Date(now.getTime() + NOTICE_DAYS * 86_400_000);
  await db.update(practices).set({ closingAt, closingRequestedBy: input.userId }).where(eq(practices.id, practiceId));
  await db.insert(auditLog).values({ practiceId, userId: input.userId, action: "closure_scheduled", entity: "practice", entityId: practiceId, details: { closingAt: closingAt.toISOString() } });
  return closingAt;
}

export async function cancelClosure(db: Db, practiceId: string, userId: string) {
  await db.update(practices).set({ closingAt: null, closingRequestedBy: null }).where(eq(practices.id, practiceId));
  await db.insert(auditLog).values({ practiceId, userId, action: "closure_cancelled", entity: "practice", entityId: practiceId });
}

type Fk = { child: string; col: string; parent: string };

/** Deletes everything that belongs to the practice. Returns counts for the record. */
export async function deletePracticeData(db: Db, practiceId: string, now = new Date()) {
  const [p] = await db.select().from(practices).where(eq(practices.id, practiceId)).limit(1);
  if (!p) throw new Error("Practice not found");
  const requester = p.closingRequestedBy ? (await db.select({ email: users.email }).from(users).where(eq(users.id, p.closingRequestedBy)).limit(1))[0]?.email ?? null : null;

  // Stored files first, while the rows that point to them still exist.
  const store = fileStore();
  const { rows: keyRows } = await db.execute(sql`
    SELECT storage_key FROM claim_attachments WHERE practice_id = ${practiceId} AND storage_key IS NOT NULL
    UNION ALL SELECT storage_key FROM export_jobs WHERE practice_id = ${practiceId} AND storage_key IS NOT NULL`);
  const keys = (keyRows as { storage_key: string }[]).map((r) => r.storage_key);
  if (keys.length && !store) throw new Error("This practice has files in storage, but file storage is not configured here");
  for (let i = 0; i < keys.length; i += 100) await store!.del(keys.slice(i, i + 100));

  // People who also belong to another practice move there and keep their sign-in.
  const { rows: movers } = await db.execute(sql`
    SELECT u.id AS user_id, (SELECT m.practice_id FROM practice_memberships m WHERE m.user_id = u.id AND m.practice_id <> ${practiceId} ORDER BY m.created_at LIMIT 1) AS other
    FROM users u WHERE u.practice_id = ${practiceId}`);
  for (const m of movers as { user_id: string; other: string | null }[]) {
    if (m.other) await db.update(users).set({ practiceId: m.other }).where(eq(users.id, m.user_id));
  }

  // Which tables hold the practice's rows, and how to find them.
  const { rows: cols } = await db.execute(sql`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`);
  const { rows: fkRows } = await db.execute(sql`
    SELECT kcu.table_name AS child, kcu.column_name AS col, ccu.table_name AS parent
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
    JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`);
  const fks = fkRows as Fk[];
  const hasPractice = new Set((cols as { table_name: string; column_name: string }[]).filter((c) => c.column_name === "practice_id").map((c) => c.table_name));
  const conditions = new Map<string, ReturnType<typeof sql>>();
  for (const t of hasPractice) if (t !== "users" && IDENT.test(t)) conditions.set(t, sql`practice_id = ${practiceId}`);
  // Children reached only through a parent that belongs to the practice (charges through encounters, say).
  for (let pass = 0; pass < 3; pass++) {
    for (const f of fks) {
      if (conditions.has(f.child) || f.child === "users" || f.child === "practices" || !IDENT.test(f.child)) continue;
      const parentCond = conditions.get(f.parent);
      if (parentCond) conditions.set(f.child, sql`${sql.raw(q(f.col))} IN (SELECT id FROM ${sql.raw(q(f.parent))} WHERE ${parentCond})`);
    }
  }
  // Users of this practice who did not move elsewhere go too; so do rows in other tables that point at them.
  const userCond = sql`practice_id = ${practiceId}`;
  conditions.set("users", userCond);

  // Delete in rounds: a table whose rows are still referenced fails this round and succeeds once its children are gone.
  let rowsDeleted = 0;
  let pending = [...conditions.keys()];
  for (let round = 0; round < 12 && pending.length; round++) {
    const next: string[] = [];
    for (const t of pending) {
      try {
        // Rows elsewhere that only record who did something are cleared rather than blocking the delete.
        if (t === "users") {
          for (const f of fks.filter((x) => x.parent === "users" && !conditions.has(x.child) && IDENT.test(x.child))) {
            await db.execute(sql`UPDATE ${sql.raw(q(f.child))} SET ${sql.raw(q(f.col))} = NULL WHERE ${sql.raw(q(f.col))} IN (SELECT id FROM users WHERE ${userCond})`).catch(() => undefined);
          }
        }
        const { rows } = await db.execute(sql`WITH d AS (DELETE FROM ${sql.raw(q(t))} WHERE ${conditions.get(t)!} RETURNING 1) SELECT count(*)::int AS n FROM d`);
        rowsDeleted += Number((rows[0] as { n: number }).n);
      } catch {
        next.push(t);
      }
    }
    if (next.length === pending.length) break;
    pending = next;
  }
  if (pending.length) throw new Error(`Could not delete: ${pending.join(", ")}`);
  await db.delete(practiceMemberships).where(eq(practiceMemberships.practiceId, practiceId));
  await db.delete(practices).where(eq(practices.id, practiceId));
  rowsDeleted++;
  await db.insert(practiceDeletions).values({ practiceId, practiceName: p.name, requestedByEmail: requester, requestedAt: p.closingAt ? new Date(p.closingAt.getTime() - NOTICE_DAYS * 86_400_000) : null, deletedAt: now, rowsDeleted, filesDeleted: keys.length });
  return { rowsDeleted, filesDeleted: keys.length };
}

/** Daily: closes practices whose date has come. */
export async function runScheduledClosures(db: Db, now = new Date()) {
  const due = await db.select({ id: practices.id }).from(practices).where(and(isNotNull(practices.closingAt), lte(practices.closingAt, now)));
  const done: string[] = [];
  for (const p of due) {
    try {
      await deletePracticeData(db, p.id, now);
      done.push(p.id);
    } catch (e) {
      console.error("practice closure failed", p.id, e instanceof Error ? e.message : e);
    }
  }
  return done.length;
}
