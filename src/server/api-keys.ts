/**
 * Keys for the public REST API. A key is shown once when created; only its
 * SHA-256 hash is stored, so a copy of the database yields no working keys.
 * "read" keys can list and fetch; "write" keys can also create patients and
 * visits.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";

const { apiKeys, auditLog, practices } = schema;

export type ApiScope = "read" | "write";
const hash = (key: string) => createHash("sha256").update(key).digest("hex");

export async function createApiKey(db: Db, practiceId: string, name: string, scope: ApiScope, userId?: string) {
  const label = name.trim().slice(0, 80);
  if (!label) throw new Error("Name the key after what will use it, such as \"Epic integration\"");
  if (scope !== "read" && scope !== "write") throw new Error("Choose read or write access");
  const key = `cmd_live_${randomBytes(24).toString("base64url")}`;
  const [row] = await db.insert(apiKeys).values({ practiceId, name: label, prefix: key.slice(0, 16), keyHash: hash(key), scope, createdBy: userId ?? null }).returning();
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "api_key_created", entity: "api_key", entityId: row.id, details: { name: label, scope } });
  return { key, row };
}

export async function revokeApiKey(db: Db, practiceId: string, id: string, userId?: string) {
  await db.update(apiKeys).set({ revokedAt: new Date() }).where(and(eq(apiKeys.id, id), eq(apiKeys.practiceId, practiceId), isNull(apiKeys.revokedAt)));
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "api_key_revoked", entity: "api_key", entityId: id });
}

export async function listApiKeys(db: Db, practiceId: string) {
  return db
    .select({ id: apiKeys.id, name: apiKeys.name, prefix: apiKeys.prefix, scope: apiKeys.scope, createdAt: apiKeys.createdAt, lastUsedAt: apiKeys.lastUsedAt, revokedAt: apiKeys.revokedAt })
    .from(apiKeys)
    .where(eq(apiKeys.practiceId, practiceId))
    .orderBy(desc(apiKeys.createdAt));
}

export type ApiCaller = { keyId: string; practiceId: string; practiceName: string; scope: ApiScope };

/** Resolves "Authorization: Bearer cmd_live_…" to the practice it belongs to, or null. */
export async function authenticateApiKey(db: Db, header: string | null): Promise<ApiCaller | null> {
  const key = header?.replace(/^Bearer\s+/i, "").trim();
  if (!key?.startsWith("cmd_live_") || key.length > 100) return null;
  const [row] = await db
    .select({ id: apiKeys.id, practiceId: apiKeys.practiceId, scope: apiKeys.scope, lastUsedAt: apiKeys.lastUsedAt, practiceName: practices.name })
    .from(apiKeys)
    .innerJoin(practices, eq(practices.id, apiKeys.practiceId))
    .where(and(eq(apiKeys.keyHash, hash(key)), isNull(apiKeys.revokedAt)))
    .limit(1);
  if (!row) return null;
  // Record use at most once a minute, so a busy integration does not write on every call.
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
    await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id));
  }
  return { keyId: row.id, practiceId: row.practiceId, practiceName: row.practiceName, scope: row.scope as ApiScope };
}

/** A per-key budget of requests per minute, per server instance. */
const RATE_PER_MIN = 300;
const windows = new Map<string, { start: number; count: number }>();
export function rateLimit(keyId: string, now = Date.now()): { ok: boolean; remaining: number; resetSec: number } {
  const w = windows.get(keyId);
  if (!w || now - w.start >= 60_000) {
    windows.set(keyId, { start: now, count: 1 });
    return { ok: true, remaining: RATE_PER_MIN - 1, resetSec: 60 };
  }
  w.count++;
  return { ok: w.count <= RATE_PER_MIN, remaining: Math.max(0, RATE_PER_MIN - w.count), resetSec: Math.ceil((w.start + 60_000 - now) / 1000) };
}
