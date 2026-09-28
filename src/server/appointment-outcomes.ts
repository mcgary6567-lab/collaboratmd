/**
 * Whether reminder texts are working: over past visits, how often patients who
 * confirmed by text did not come, against those who did not confirm, and how
 * many times were refilled from the waitlist.
 *
 * A comparison, not proof: patients who bother to confirm were likelier to
 * come anyway. A big gap still says the unconfirmed are worth a call.
 */
import { sql } from "drizzle-orm";
import type { Db } from "@/db";
import { practiceNow } from "./practice-time";

export type OutcomeRow = { group: "confirmed" | "unconfirmed"; visits: number; noShows: number; rate: number | null };

export async function appointmentOutcomes(db: Db, practiceId: string, days = 90, now = new Date()) {
  const clock = await practiceNow(db, practiceId, now);
  const since = new Date(clock.getTime() - days * 86_400_000).toISOString();
  const until = clock.toISOString();
  const { rows } = await db.execute<{ confirmed: boolean; visits: number; no_shows: number }>(sql`
    SELECT confirmed_at IS NOT NULL AS confirmed, count(*)::int AS visits, count(*) FILTER (WHERE status = 'no_show')::int AS no_shows
    FROM appointments
    WHERE practice_id = ${practiceId} AND starts_at >= ${since}::timestamptz AND starts_at < ${until}::timestamptz
      AND status IN ('completed', 'checked_in', 'no_show')
    GROUP BY 1`);
  const { rows: filled } = await db.execute<{ offered: number; filled: number }>(sql`
    SELECT count(*)::int AS offered, count(*) FILTER (WHERE filled_patient_id IS NOT NULL)::int AS filled
    FROM slot_offers WHERE practice_id = ${practiceId} AND created_at >= ${new Date(now.getTime() - days * 86_400_000).toISOString()}::timestamptz`);
  const row = (group: OutcomeRow["group"]): OutcomeRow => {
    const r = rows.find((x) => Boolean(x.confirmed) === (group === "confirmed"));
    const visits = Number(r?.visits ?? 0);
    const noShows = Number(r?.no_shows ?? 0);
    return { group, visits, noShows, rate: visits ? noShows / visits : null };
  };
  return { days, rows: [row("confirmed"), row("unconfirmed")], offered: Number(filled[0]?.offered ?? 0), filled: Number(filled[0]?.filled ?? 0) };
}
