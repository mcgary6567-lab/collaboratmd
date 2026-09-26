/**
 * In-app notifications: things someone should look at, delivered to one
 * person (userId) or to the practice's administrators (userId null). A
 * dedupe key keeps a recurring check (a credential about to expire, a payer
 * alert) from notifying twice. People can also get a daily email digest.
 */
import { and, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";

const { notifications, users } = schema;

export type NewNotification = { userId?: string | null; kind: string; title: string; body?: string; href?: string; dedupeKey?: string };

export async function notify(db: Db, practiceId: string, n: NewNotification) {
  await db.insert(notifications).values({ practiceId, userId: n.userId ?? null, kind: n.kind, title: n.title.slice(0, 200), body: n.body?.slice(0, 1000) ?? null, href: n.href ?? null, dedupeKey: n.dedupeKey ?? null }).onConflictDoNothing();
}

/** What this person sees: their own, and the administrators' if they are one. */
const audience = (practiceId: string, userId: string, admin: boolean) =>
  and(eq(notifications.practiceId, practiceId), admin ? or(eq(notifications.userId, userId), isNull(notifications.userId)) : eq(notifications.userId, userId));

export async function listNotifications(db: Db, practiceId: string, userId: string, admin: boolean, limit = 100) {
  return db.select().from(notifications).where(audience(practiceId, userId, admin)).orderBy(desc(notifications.createdAt)).limit(limit);
}

export async function unreadCount(db: Db, practiceId: string, userId: string, admin: boolean) {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(notifications).where(and(audience(practiceId, userId, admin), isNull(notifications.readAt)));
  return Number(r?.n ?? 0);
}

export async function markRead(db: Db, practiceId: string, userId: string, admin: boolean, ids?: string[]) {
  const where = and(audience(practiceId, userId, admin), isNull(notifications.readAt), ...(ids?.length ? [inArray(notifications.id, ids)] : []));
  await db.update(notifications).set({ readAt: new Date() }).where(where);
}

export async function setDigest(db: Db, userId: string, on: boolean) {
  await db.update(users).set({ emailDigest: on }).where(eq(users.id, userId));
}

/**
 * The daily email: each person who asked for it gets their unread
 * notifications from the last day, as a list of titles with links. No
 * patient details are put in the email; the titles are written that way.
 */
export async function sendDigests(db: Db, practiceId: string, origin: string, send: (to: string, subject: string, text: string) => Promise<boolean>, now = new Date()) {
  const since = new Date(now.getTime() - 86_400_000);
  const { rows: people } = await db.execute<{ id: string; email: string; name: string; admin: boolean }>(sql`
    SELECT u.id, u.email, u.name, (COALESCE(m.role, CASE WHEN u.practice_id = ${practiceId} THEN u.role END) = 'admin') AS admin
    FROM users u LEFT JOIN practice_memberships m ON m.user_id = u.id AND m.practice_id = ${practiceId}
    WHERE u.email_digest AND u.disabled_at IS NULL AND (u.practice_id = ${practiceId} OR m.user_id IS NOT NULL)`);
  let sent = 0;
  for (const p of people) {
    const items = await db.select().from(notifications).where(and(audience(practiceId, p.id, !!p.admin), isNull(notifications.readAt), gte(notifications.createdAt, since))).orderBy(desc(notifications.createdAt)).limit(30);
    if (!items.length) continue;
    const text = `Hi ${p.name.split(" ")[0]},\n\nNew in CollaboratMD since yesterday:\n\n${items.map((i) => `- ${i.title}${i.href ? `\n  ${origin}${i.href}` : ""}`).join("\n")}\n\nAll notifications: ${origin}/notifications\nTurn this email off on that page.`;
    if (await send(p.email, `${items.length} new in CollaboratMD`, text)) sent++;
  }
  return { sent };
}

/** Whether anyone with access to the practice asked for the daily email. */
export async function hasDigestSubscribers(db: Db, practiceId: string) {
  const { rows } = await db.execute(sql`
    SELECT 1 FROM users u LEFT JOIN practice_memberships m ON m.user_id = u.id AND m.practice_id = ${practiceId}
    WHERE u.email_digest AND u.disabled_at IS NULL AND (u.practice_id = ${practiceId} OR m.user_id IS NOT NULL) LIMIT 1`);
  return rows.length > 0;
}
