/**
 * Care gaps worth a visit:
 *
 *  - Annual wellness visits: Medicare patients seen in the last two years
 *    whose last AWV (G0438, G0439) was 11 full months ago or more, or who
 *    have none on record here. Medicare pays one every 12 months.
 *  - Chronic care management candidates: patients with two or more of the
 *    practice's chronic condition groups coded in the last year, not enrolled
 *    in care management.
 *  - HCC recapture: risk-adjusting conditions (from CMS's mapping, when
 *    loaded) coded for a patient last year and not yet this year.
 */
import { and, eq, gte, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { getPolicies } from "./policies";
import { messagePatient } from "./messaging";

const { patients, messageLog } = schema;

type Row = Record<string, string | null>;

/** Example chronic condition groups (ICD-10 prefixes); each practice sets its own list. */
export const EXAMPLE_CHRONIC_PREFIXES = ["E11", "I10", "I50", "J44", "N18", "E78", "F32", "F33", "J45", "I25"];

/** The first day a subsequent AWV is payable: after 11 full months following the month of the last one. */
export function awvDueOn(lastAwv: string) {
  const y = Number(lastAwv.slice(0, 4));
  const m = Number(lastAwv.slice(5, 7)); // 1-12
  const due = new Date(Date.UTC(y, m - 1 + 12, 1));
  return due.toISOString().slice(0, 10);
}

export async function awvGaps(db: Db, practiceId: string, today = new Date().toISOString().slice(0, 10), limit = 300) {
  const since = `${Number(today.slice(0, 4)) - 2}${today.slice(4)}`;
  const { rows } = await db.execute<Row>(sql`
    WITH medicare AS (
      SELECT DISTINCT pi.patient_id FROM patient_insurances pi JOIN payers py ON py.id = pi.payer_id WHERE pi.active AND py.type = 'medicare' AND py.practice_id = ${practiceId}
    ),
    seen AS (
      SELECT e.patient_id, max(e.date_of_service) AS last_visit,
        max(e.date_of_service) FILTER (WHERE EXISTS (SELECT 1 FROM charges ch WHERE ch.encounter_id = e.id AND ch.cpt IN ('G0438', 'G0439'))) AS last_awv,
        (array_agg(e.provider_id ORDER BY e.date_of_service DESC))[1] AS provider_id
      FROM encounters e WHERE e.practice_id = ${practiceId} AND e.date_of_service >= ${since} AND e.patient_id IN (SELECT patient_id FROM medicare)
      GROUP BY e.patient_id
    )
    SELECT s.patient_id, p.first_name, p.last_name, p.phone, p.email, s.last_visit::text AS last_visit, s.last_awv::text AS last_awv, pr.last_name AS provider
    FROM seen s JOIN patients p ON p.id = s.patient_id LEFT JOIN providers pr ON pr.id = s.provider_id
    ORDER BY s.last_awv NULLS FIRST, s.last_visit DESC`);
  return rows
    .map((r) => ({ patientId: r.patient_id!, name: `${r.last_name}, ${r.first_name}`, provider: r.provider, lastVisit: r.last_visit!, lastAwv: r.last_awv, dueOn: r.last_awv ? awvDueOn(r.last_awv) : null, contact: !!(r.phone || r.email) }))
    .filter((r) => !r.dueOn || r.dueOn <= today)
    .slice(0, limit);
}

/** A reminder to book the wellness visit, to patients due who have not had one sent in 60 days. */
export async function awvOutreach(db: Db, practiceId: string, practice: { name: string; phone: string | null }, max = 50) {
  const due = (await awvGaps(db, practiceId)).filter((g) => g.contact);
  const since = new Date(Date.now() - 60 * 86_400_000);
  let sent = 0;
  let skipped = 0;
  for (const g of due) {
    if (sent >= max) break;
    const [recent] = await db.select({ id: messageLog.id }).from(messageLog).where(and(eq(messageLog.patientId, g.patientId), eq(messageLog.kind, "awv_outreach"), gte(messageLog.createdAt, since))).limit(1);
    if (recent) { skipped++; continue; }
    const [patient] = await db.select().from(patients).where(eq(patients.id, g.patientId)).limit(1);
    const phone = practice.phone ? ` Call ${practice.phone}` : " Call the office";
    const r = await messagePatient(db, patient, {
      kind: "awv_outreach", entityId: g.patientId, reminder: true,
      sms: `${practice.name}: you are due for your yearly Medicare wellness visit, at no cost to you under Medicare.${phone} to schedule. Reply STOP to opt out.`,
      email: { subject: `Time for your yearly wellness visit with ${practice.name}`, text: `Hi ${patient.firstName},\n\nYou are due for your yearly Medicare wellness visit, a check-in on your health and a plan for the year ahead, at no cost to you under Medicare.\n\n${phone.trim()} to schedule.\n\n${practice.name}` },
    });
    if (r.sms === "sent" || r.email === "sent") sent++;
    else skipped++;
  }
  return { due: due.length, sent, skipped };
}

export async function chronicPrefixes(db: Db, practiceId: string) {
  const p = await getPolicies(db, practiceId);
  return p.chronicPrefixes?.length ? p.chronicPrefixes : EXAMPLE_CHRONIC_PREFIXES;
}

export async function ccmCandidates(db: Db, practiceId: string, today = new Date().toISOString().slice(0, 10), limit = 300) {
  const prefixes = (await chronicPrefixes(db, practiceId)).map((p) => p.replace(".", "").toUpperCase());
  const since = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
  const { rows } = await db.execute<Row>(sql`
    WITH dx AS (
      SELECT e.patient_id, e.provider_id, e.date_of_service, replace(upper(d.code), '.', '') AS code
      FROM encounters e, jsonb_array_elements_text(e.diagnoses) AS d(code)
      WHERE e.practice_id = ${practiceId} AND e.date_of_service >= ${since}
    ),
    groups AS (
      SELECT dx.patient_id, pf.prefix, max(dx.date_of_service) AS last
      FROM dx JOIN (VALUES ${sql.join(prefixes.map((p) => sql`(${p})`), sql`, `)}) AS pf(prefix) ON dx.code LIKE pf.prefix || '%'
      GROUP BY dx.patient_id, pf.prefix
    )
    SELECT g.patient_id, p.first_name, p.last_name, string_agg(g.prefix, ', ' ORDER BY g.prefix) AS groups, count(*)::text AS n, max(g.last)::text AS last_visit
    FROM groups g JOIN patients p ON p.id = g.patient_id
    WHERE NOT EXISTS (SELECT 1 FROM care_program_consents c WHERE c.patient_id = g.patient_id AND c.program IN ('ccm', 'ccm_physician'))
    GROUP BY g.patient_id, p.first_name, p.last_name
    HAVING count(*) >= 2
    ORDER BY count(*) DESC, max(g.last) DESC
    LIMIT ${limit}`);
  return { prefixes, candidates: rows.map((r) => ({ patientId: r.patient_id!, name: `${r.last_name}, ${r.first_name}`, groups: r.groups!, count: Number(r.n), lastVisit: r.last_visit! })) };
}

export async function hccRecapture(db: Db, practiceId: string, year = new Date().getUTCFullYear(), limit = 500) {
  const [{ loaded }] = (await db.execute<Row>(sql`SELECT max(year)::text AS loaded FROM hcc_mappings WHERE year <= ${year}`)).rows;
  if (!loaded) return { mappingYear: null, gaps: [] };
  const { rows } = await db.execute<Row>(sql`
    WITH m AS (SELECT icd10, hcc FROM hcc_mappings WHERE year = ${Number(loaded)}),
    dx AS (
      SELECT e.patient_id, e.provider_id, e.date_of_service, extract(year FROM e.date_of_service)::int AS yr, replace(upper(d.code), '.', '') AS code
      FROM encounters e, jsonb_array_elements_text(e.diagnoses) AS d(code)
      WHERE e.practice_id = ${practiceId} AND e.date_of_service >= ${`${year - 1}-01-01`}
        AND NOT EXISTS (SELECT 1 FROM claims cl WHERE cl.encounter_id = e.id AND cl.status IN ('void', 'voided'))
    ),
    coded AS (
      SELECT dx.patient_id, dx.yr, m.hcc, max(dx.date_of_service) AS last, min(dx.code) AS code,
        (array_agg(dx.provider_id ORDER BY dx.date_of_service DESC))[1] AS provider_id
      FROM dx JOIN m ON m.icd10 = dx.code GROUP BY dx.patient_id, dx.yr, m.hcc
    )
    SELECT prev.patient_id, p.first_name, p.last_name, prev.hcc, prev.code, prev.last::text AS last, pr.last_name AS provider
    FROM coded prev JOIN patients p ON p.id = prev.patient_id LEFT JOIN providers pr ON pr.id = prev.provider_id
    WHERE prev.yr = ${year - 1} AND NOT EXISTS (SELECT 1 FROM coded cur WHERE cur.patient_id = prev.patient_id AND cur.hcc = prev.hcc AND cur.yr = ${year})
    ORDER BY p.last_name, p.first_name, prev.hcc
    LIMIT ${limit}`);
  return {
    mappingYear: Number(loaded),
    gaps: rows.map((r) => ({ patientId: r.patient_id!, name: `${r.last_name}, ${r.first_name}`, hcc: r.hcc!, code: r.code!, lastCoded: r.last!, provider: r.provider })),
  };
}
