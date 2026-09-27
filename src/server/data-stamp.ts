/**
 * A cheap fingerprint of a practice's money and claims: when the latest
 * ledger posting, claim and denial happened. Cached summary figures include it
 * in their key, so they are recomputed as soon as money is posted, a claim is
 * created or a denial arrives, on every server instance, instead of waiting out
 * the cache period. Each part is one read from an existing index.
 */
import { sql } from "drizzle-orm";
import type { Db } from "@/db";

export async function dataStamp(db: Db, practiceId: string): Promise<string> {
  const { rows } = await db.execute(sql`
    SELECT concat_ws('|',
      (SELECT max(posted_at) FROM ledger_entries WHERE practice_id = ${practiceId})::text,
      (SELECT max(created_at) FROM claims WHERE practice_id = ${practiceId})::text,
      (SELECT max(created_at) FROM denials WHERE practice_id = ${practiceId})::text) AS stamp`);
  return String((rows[0] as { stamp: string | null }).stamp ?? "");
}
