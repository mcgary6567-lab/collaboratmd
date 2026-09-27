/**
 * Re-encrypts every stored secret under the current SEAL_KEYS key. Run it after
 * setting SEAL_KEYS for the first time (moving off AUTH_SECRET), and after
 * putting a new key at the front of the ring; then the old key can be removed.
 */
import { sql } from "drizzle-orm";
import type { Db } from "@/db";
import { appSecret } from "@/lib/app-secret";
import { keyRing, seal, sealedWithCurrent, unseal } from "@/lib/seal";

/** Every column that holds a sealed value, and the key that identifies its row. */
export const SEALED_COLUMNS = [
  { table: "users", column: "mfa_secret", id: "id" },
  { table: "users", column: "mfa_pending_secret", id: "id" },
  { table: "practice_integrations", column: "secrets", id: "id" },
  { table: "fhir_connections", column: "token_sealed", id: "practice_id" },
  { table: "fhir_connections", column: "private_key_sealed", id: "practice_id" },
  { table: "practice_sso", column: "client_secret_sealed", id: "practice_id" },
  { table: "webhook_endpoints", column: "secret", id: "id" },
] as const;

export async function resealAll(db: Db) {
  if (!keyRing()) throw new Error("Set SEAL_KEYS first; there is no key ring to move the secrets to");
  const result = { resealed: 0, current: 0, unreadable: [] as string[] };
  for (const c of SEALED_COLUMNS) {
    const { rows } = await db.execute(sql`SELECT ${sql.raw(`"${c.id}"`)}::text AS id, ${sql.raw(`"${c.column}"`)} AS v FROM ${sql.raw(`"${c.table}"`)} WHERE ${sql.raw(`"${c.column}"`)} IS NOT NULL`);
    for (const r of rows as { id: string; v: string }[]) {
      if (sealedWithCurrent(r.v)) { result.current++; continue; }
      let plain: string;
      try {
        plain = unseal(r.v, appSecret());
      } catch {
        result.unreadable.push(`${c.table}.${c.column} ${r.id}`);
        continue;
      }
      await db.execute(sql`UPDATE ${sql.raw(`"${c.table}"`)} SET ${sql.raw(`"${c.column}"`)} = ${seal(plain, appSecret())} WHERE ${sql.raw(`"${c.id}"`)}::text = ${r.id}`);
      result.resealed++;
    }
  }
  return result;
}
