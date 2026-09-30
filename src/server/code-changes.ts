/**
 * The yearly ICD-10-CM change, for one practice: of the codes a new fiscal
 * year deletes or turns into categories, the ones this practice uses, where
 * (open visits dated on or after October 1, visits in the last year, open
 * prior authorizations and lab orders), and the codes that replace them.
 *
 * Nothing is changed automatically: the right replacement depends on the
 * documentation, so this is a list to work, not a conversion.
 */
import { sql } from "drizzle-orm";
import type { Db } from "@/db";
import { icdYears } from "./code-catalog";

type Row = Record<string, string | null>;

export type CodeChange = {
  code: string;
  description: string;
  change: "deleted" | "category";
  recentVisits: number;
  openVisits: number;
  openAuthorizations: number;
  openLabOrders: number;
  replacements: { code: string; description: string }[];
  openClaims: { claimId: string; controlNumber: string; dateOfService: string }[];
};

/** Visits whose claim has not gone out yet (or has no claim), still codable. */
const OPEN = ["draft", "scrub_errors", "ready", "rejected"];

export async function codeChanges(db: Db, practiceId: string, year?: number) {
  const { latest } = await icdYears(db);
  const fy = year ?? latest;
  if (!fy) return { year: null, totalChanges: 0, changes: [] as CodeChange[] };
  const start = `${fy - 1}-10-01`;
  const { rows: total } = await db.execute<Row>(sql`
    SELECT count(*) FILTER (WHERE seen_year = ${fy - 1} AND first_year IS NOT NULL)::text AS deleted,
      count(*) FILTER (WHERE changed_year = ${fy} AND NOT billable)::text AS category
    FROM icd10_codes`);
  const { rows } = await db.execute<Row>(sql`
    WITH changed AS (
      SELECT code, description, CASE WHEN seen_year = ${fy - 1} THEN 'deleted' ELSE 'category' END AS change
      FROM icd10_codes
      WHERE (seen_year = ${fy - 1} AND first_year IS NOT NULL) OR (changed_year = ${fy} AND NOT billable)
    ),
    visits AS (
      SELECT d.code, e.id AS encounter_id, e.date_of_service, c.id AS claim_id, c.control_number, c.status
      FROM encounters e
      CROSS JOIN LATERAL jsonb_array_elements_text(e.diagnoses) AS d(code)
      LEFT JOIN claims c ON c.encounter_id = e.id
      WHERE e.practice_id = ${practiceId} AND e.date_of_service >= (current_date - 365) - 90
        AND d.code IN (SELECT code FROM changed)
    ),
    auths AS (
      SELECT d.code, count(*) AS n FROM auth_requests a CROSS JOIN LATERAL jsonb_array_elements_text(a.diagnoses) AS d(code)
      WHERE a.practice_id = ${practiceId} AND a.service_to >= ${start} AND a.status IN ('approved', 'partial', 'pended') AND d.code IN (SELECT code FROM changed)
      GROUP BY d.code
    ),
    labs AS (
      SELECT d.code, count(*) AS n FROM lab_orders l CROSS JOIN LATERAL jsonb_array_elements_text(l.diagnoses) AS d(code)
      WHERE l.practice_id = ${practiceId} AND l.status IN ('ordered', 'partial') AND d.code IN (SELECT code FROM changed)
      GROUP BY d.code
    )
    SELECT ch.code, ch.description, ch.change,
      (SELECT count(DISTINCT v.encounter_id) FROM visits v WHERE v.code = ch.code AND v.date_of_service >= current_date - 365)::text AS recent,
      (SELECT count(DISTINCT v.encounter_id) FROM visits v WHERE v.code = ch.code AND v.date_of_service >= ${start} AND (v.claim_id IS NULL OR v.status IN (${sql.join(OPEN.map((s) => sql`${s}`), sql`, `)})))::text AS open,
      COALESCE((SELECT n FROM auths WHERE auths.code = ch.code), 0)::text AS auths,
      COALESCE((SELECT n FROM labs WHERE labs.code = ch.code), 0)::text AS labs,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('claimId', x.claim_id, 'controlNumber', x.control_number, 'dateOfService', x.date_of_service) ORDER BY x.date_of_service), '[]'::jsonb)::text FROM (
        SELECT DISTINCT v.claim_id, v.control_number, v.date_of_service FROM visits v
        WHERE v.code = ch.code AND v.claim_id IS NOT NULL AND v.date_of_service >= ${start} AND v.status IN (${sql.join(OPEN.map((s) => sql`${s}`), sql`, `)}) LIMIT 20) x) AS open_claims
    FROM changed ch
    WHERE EXISTS (SELECT 1 FROM visits v WHERE v.code = ch.code) OR EXISTS (SELECT 1 FROM auths WHERE auths.code = ch.code) OR EXISTS (SELECT 1 FROM labs WHERE labs.code = ch.code)
    ORDER BY ch.code`);
  const used = rows.filter((r) => Number(r.recent) + Number(r.open) + Number(r.auths) + Number(r.labs) > 0);
  const changes: CodeChange[] = [];
  for (const r of used) {
    changes.push({
      code: r.code!, description: r.description!, change: r.change as CodeChange["change"],
      recentVisits: Number(r.recent), openVisits: Number(r.open), openAuthorizations: Number(r.auths), openLabOrders: Number(r.labs),
      replacements: await replacementsFor(db, r.code!, fy),
      openClaims: JSON.parse(r.open_claims ?? "[]"),
    });
  }
  // Open work first, then how often the practice uses the code.
  changes.sort((a, b) => b.openVisits + b.openAuthorizations + b.openLabOrders - (a.openVisits + a.openAuthorizations + a.openLabOrders) || b.recentVisits - a.recentVisits || a.code.localeCompare(b.code));
  return { year: fy, totalChanges: Number(total[0]?.deleted ?? 0) + Number(total[0]?.category ?? 0), changes };
}

/**
 * Codes to choose from instead: the billable codes under it in the new year
 * (a code split into more specific ones), or else the codes the new year
 * added in the same category.
 */
export async function replacementsFor(db: Db, code: string, fy: number) {
  const under = await db.execute<{ code: string; description: string }>(sql`
    SELECT code, description FROM icd10_codes
    WHERE code > ${code} AND code < ${`${code}~`} AND billable AND seen_year >= ${fy}
    ORDER BY code LIMIT 12`);
  if (under.rows.length) return under.rows;
  const category = code.slice(0, 3);
  const added = await db.execute<{ code: string; description: string }>(sql`
    SELECT code, description FROM icd10_codes
    WHERE code >= ${category} AND code < ${`${category}~`} AND billable AND first_year = ${fy}
    ORDER BY code LIMIT 12`);
  return added.rows;
}
