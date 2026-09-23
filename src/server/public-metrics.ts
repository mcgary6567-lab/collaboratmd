import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { headlineKpis, type HeadlineKpis } from "@/server/analytics";

/**
 * Figures for the public investors page, read live from the running system.
 *
 * Nothing here is typed into the page by hand. The point of showing them is
 * that they are the software's own output: if a change made the denial rate
 * worse, the page would say so the next time it loaded.
 *
 * Every failure returns null. A marketing page that will not render because a
 * database is briefly unreachable is worse than one that quietly drops a band
 * of numbers, so the page treats this as optional content.
 */
export interface PublicMetrics extends HeadlineKpis {
  payerCount: number;
  ledgerEntryCount: number;
  specialtyCount: number;
  recoveredDenials: number;
  recoveredCents: number;
}

export async function publicMetrics(): Promise<PublicMetrics | null> {
  try {
    const db = await getDb();

    const { rows: practices } = await db.execute<Record<string, string>>(
      sql`SELECT id FROM practices ORDER BY created_at NULLS LAST LIMIT 1`,
    );
    const practiceId = practices[0]?.id;
    if (!practiceId) return null;

    const [kpis, extra] = await Promise.all([
      headlineKpis(db, practiceId),
      db.execute<Record<string, string>>(sql`
        SELECT
          (SELECT COUNT(*) FROM payers WHERE practice_id = ${practiceId})::bigint       AS payers,
          (SELECT COUNT(*) FROM ledger_entries WHERE practice_id = ${practiceId})::bigint AS ledger_entries,
          (SELECT COUNT(DISTINCT specialty) FROM providers WHERE practice_id = ${practiceId})::bigint AS specialties,
          (SELECT COUNT(*) FROM denials WHERE practice_id = ${practiceId} AND status = 'resolved')::bigint AS recovered,
          (SELECT COALESCE(SUM(amount_cents), 0) FROM denials
             WHERE practice_id = ${practiceId} AND status = 'resolved')::bigint         AS recovered_cents
      `),
    ]);

    const e = extra.rows[0];
    return {
      ...kpis,
      payerCount: Number(e?.payers ?? 0),
      ledgerEntryCount: Number(e?.ledger_entries ?? 0),
      specialtyCount: Number(e?.specialties ?? 0),
      recoveredDenials: Number(e?.recovered ?? 0),
      recoveredCents: Number(e?.recovered_cents ?? 0),
    };
  } catch (err) {
    console.error("[collaboratmd] public metrics unavailable", err);
    return null;
  }
}
