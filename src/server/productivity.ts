/**
 * Provider productivity and E/M coding profile. Work RVUs come from the
 * Medicare fee schedule year loaded for each date of service (the latest year
 * on or before it). The E/M level mix per provider is compared with the
 * practice's own, as an internal audit aid: a provider far from their peers is
 * worth a closer look, which a random sample of their visits makes easy. It is
 * not a finding of upcoding or undercoding on its own.
 */
import { sql } from "drizzle-orm";
import type { Db } from "@/db";

export const EM_NEW = ["99202", "99203", "99204", "99205"];
export const EM_ESTABLISHED = ["99211", "99212", "99213", "99214", "99215"];

type Row = Record<string, string | null>;

export async function productivity(db: Db, practiceId: string, from: string, to: string) {
  const { rows } = await db.execute<Row>(sql`
    WITH lines AS (
      SELECT e.provider_id, e.id AS encounter_id, ch.cpt, ch.units,
        (SELECT r.work_rvu FROM mpfs_rvus r WHERE r.code = ch.cpt AND r.modifier = '' AND r.year = (SELECT max(y.year) FROM mpfs_years y WHERE y.year <= extract(year FROM e.date_of_service))) AS work_rvu
      FROM encounters e JOIN charges ch ON ch.encounter_id = e.id
      WHERE e.practice_id = ${practiceId} AND e.date_of_service BETWEEN ${from} AND ${to}
        AND NOT EXISTS (SELECT 1 FROM claims cl WHERE cl.encounter_id = e.id AND cl.status IN ('void', 'voided'))
    )
    SELECT p.id, p.first_name, p.last_name, p.credential,
      count(DISTINCT l.encounter_id)::text AS visits,
      COALESCE(sum(l.units * l.work_rvu), 0)::text AS wrvu,
      count(*) FILTER (WHERE l.work_rvu IS NULL)::text AS unpriced
    FROM lines l JOIN providers p ON p.id = l.provider_id
    GROUP BY p.id, p.first_name, p.last_name, p.credential
    ORDER BY sum(l.units * l.work_rvu) DESC NULLS LAST`);
  const { rows: em } = await db.execute<Row>(sql`
    SELECT e.provider_id, ch.cpt, count(*)::text AS n
    FROM encounters e JOIN charges ch ON ch.encounter_id = e.id
    WHERE e.practice_id = ${practiceId} AND e.date_of_service BETWEEN ${from} AND ${to}
      AND ch.cpt IN ('99202','99203','99204','99205','99211','99212','99213','99214','99215')
      AND NOT EXISTS (SELECT 1 FROM claims cl WHERE cl.encounter_id = e.id AND cl.status IN ('void', 'voided'))
    GROUP BY e.provider_id, ch.cpt`);
  const [{ n: yearsLoaded }] = (await db.execute<Row>(sql`SELECT count(*)::text AS n FROM mpfs_years`)).rows;

  const mix = (filter: (r: Row) => boolean, codes: string[]) => {
    const counts = codes.map((c) => em.filter((r) => filter(r) && r.cpt === c).reduce((a, r) => a + Number(r.n), 0));
    const total = counts.reduce((a, n) => a + n, 0);
    return { total, pct: counts.map((n) => (total ? Math.round((n / total) * 1000) / 10 : 0)) };
  };
  const providers = rows.map((r) => ({
    id: r.id!, name: `${r.first_name} ${r.last_name}${r.credential ? `, ${r.credential}` : ""}`,
    visits: Number(r.visits), wrvu: Math.round(Number(r.wrvu) * 100) / 100, unpriced: Number(r.unpriced),
    newMix: mix((x) => x.provider_id === r.id, EM_NEW), establishedMix: mix((x) => x.provider_id === r.id, EM_ESTABLISHED),
  }));
  return {
    providers,
    practice: { newMix: mix(() => true, EM_NEW), establishedMix: mix(() => true, EM_ESTABLISHED) },
    rvusLoaded: Number(yearsLoaded) > 0,
  };
}

/**
 * How far a provider's established-visit mix is from the practice's: the
 * share-weighted average level difference, in levels (positive codes higher).
 * Needs 20 visits on both sides to mean anything.
 */
export function levelShift(provider: { total: number; pct: number[] }, practice: { total: number; pct: number[] }) {
  if (provider.total < 20 || practice.total < 20) return null;
  const avg = (m: { pct: number[] }) => m.pct.reduce((a, p, i) => a + (p / 100) * (i + 1), 0);
  return Math.round((avg(provider) - avg(practice)) * 100) / 100;
}

/** A random sample of a provider's E/M visits in the period, for an internal chart review. */
export async function sampleVisits(db: Db, practiceId: string, providerId: string, from: string, to: string, n = 10) {
  const { rows } = await db.execute<Row>(sql`
    SELECT * FROM (
      SELECT DISTINCT ON (e.id) e.id AS encounter_id, e.date_of_service::text AS dos, ch.cpt, cl.id AS claim_id, cl.control_number, pt.first_name, pt.last_name
      FROM encounters e
      JOIN charges ch ON ch.encounter_id = e.id
      JOIN patients pt ON pt.id = e.patient_id
      LEFT JOIN claims cl ON cl.encounter_id = e.id
      WHERE e.practice_id = ${practiceId} AND e.provider_id = ${providerId} AND e.date_of_service BETWEEN ${from} AND ${to}
        AND ch.cpt IN ('99202','99203','99204','99205','99211','99212','99213','99214','99215')
      ORDER BY e.id
    ) v ORDER BY random() LIMIT ${n}`);
  return rows.map((r) => ({
    encounterId: r.encounter_id!, dateOfService: r.dos!, cpt: r.cpt!, claimId: r.claim_id, controlNumber: r.control_number, patient: `${r.last_name}, ${r.first_name}`,
  }));
}
