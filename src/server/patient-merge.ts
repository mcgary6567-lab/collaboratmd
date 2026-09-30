/**
 * Duplicate patients: found by the same name and date of birth, the same
 * member ID with the same payer, or the same date of birth and phone; merged
 * into the record kept, with every visit, claim, payment and document moved
 * across. The duplicate stays, marked as merged into the other, so links to
 * it still resolve and the audit log says what happened.
 *
 * Every table that points at a patient is found from the database's foreign
 * keys, so a table added later is moved too. The few with a one-per-patient
 * rule are settled first. The merge marks the duplicate before moving
 * anything and can be run again to finish, so an interrupted merge is resumed
 * rather than left half done.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";

const { patients, auditLog } = schema;
type Row = Record<string, string | null>;

export type DuplicatePair = { a: { id: string; name: string; mrn: string; dob: string; createdAt: string; visits: number }; b: DuplicatePair["a"]; reasons: string[] };

export async function findDuplicates(db: Db, practiceId: string, limit = 100): Promise<DuplicatePair[]> {
  const { rows } = await db.execute<Row>(sql`
    WITH p AS (
      SELECT id, first_name, last_name, dob, regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') AS phone, mrn, created_at
      FROM patients WHERE practice_id = ${practiceId} AND merged_into IS NULL
    ),
    pairs AS (
      SELECT a.id AS a, b.id AS b, 'Same name and date of birth' AS reason FROM p a JOIN p b ON a.id < b.id
        AND lower(a.last_name) = lower(b.last_name) AND lower(a.first_name) = lower(b.first_name) AND a.dob = b.dob
      UNION ALL
      SELECT a.id, b.id, 'Same date of birth and phone' FROM p a JOIN p b ON a.id < b.id AND a.dob = b.dob AND length(a.phone) >= 10 AND a.phone = b.phone
      UNION ALL
      SELECT DISTINCT LEAST(ia.patient_id, ib.patient_id), GREATEST(ia.patient_id, ib.patient_id), 'Same member ID with the same payer'
      FROM patient_insurances ia JOIN patient_insurances ib ON ia.patient_id <> ib.patient_id AND ia.payer_id = ib.payer_id AND upper(ia.member_id) = upper(ib.member_id)
      JOIN p pa ON pa.id = ia.patient_id JOIN p pb ON pb.id = ib.patient_id
      WHERE ia.relationship = 'self' AND ib.relationship = 'self'
    )
    SELECT x.a, x.b, string_agg(DISTINCT x.reason, '; ') AS reasons FROM pairs x GROUP BY x.a, x.b ORDER BY x.a, x.b LIMIT ${limit}`);
  if (!rows.length) return [];
  const ids = [...new Set(rows.flatMap((r) => [r.a!, r.b!]))];
  const { rows: info } = await db.execute<Row>(sql`
    SELECT p.id, p.first_name, p.last_name, p.mrn, p.dob::text AS dob, p.created_at::date::text AS created, (SELECT count(*) FROM encounters e WHERE e.patient_id = p.id)::text AS visits
    FROM patients p WHERE p.id IN (SELECT jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)::uuid)`);
  const by = new Map(info.map((r) => [r.id!, { id: r.id!, name: `${r.last_name}, ${r.first_name}`, mrn: r.mrn!, dob: r.dob!, createdAt: r.created!, visits: Number(r.visits) }]));
  return rows.map((r) => ({ a: by.get(r.a!)!, b: by.get(r.b!)!, reasons: r.reasons!.split("; ") }));
}

/** Every column that references patients(id), from the database itself. */
async function patientColumns(db: Db) {
  const { rows } = await db.execute<{ tbl: string; col: string }>(sql`
    SELECT c.conrelid::regclass::text AS tbl, a.attname AS col
    FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.contype = 'f' AND c.confrelid = 'patients'::regclass AND c.conrelid <> 'patients'::regclass AND array_length(c.conkey, 1) = 1`);
  return rows;
}
const ident = (s: string) => sql.raw(`"${s.replace(/"/g, '""')}"`);

export async function mergePatients(db: Db, practiceId: string, keepId: string, mergeId: string, userId?: string) {
  if (keepId === mergeId) throw new Error("Choose two different patients");
  const both = await db.select().from(patients).where(and(eq(patients.practiceId, practiceId), sql`${patients.id} IN (${keepId}, ${mergeId})`));
  const keep = both.find((p) => p.id === keepId);
  const dup = both.find((p) => p.id === mergeId);
  if (!keep || !dup) throw new Error("Patient not found");
  if (keep.mergedInto) throw new Error(`${keep.lastName}, ${keep.firstName} was itself merged into another record`);
  if (dup.mergedInto && dup.mergedInto !== keepId) throw new Error("That record was already merged into a different patient");

  // Mark first: the ledger allows moving entries only from a record merged into the other, and a rerun resumes from here.
  await db.update(patients).set({
    mergedInto: keepId, mergedAt: dup.mergedAt ?? new Date(),
  }).where(eq(patients.id, mergeId));
  await db.update(patients).set({
    restricted: keep.restricted || dup.restricted,
    phone: keep.phone ?? dup.phone, email: keep.email ?? dup.email,
    address1: keep.address1 ?? dup.address1, city: keep.city ?? dup.city, state: keep.state ?? dup.state, zip: keep.zip ?? dup.zip,
    assistanceOfferedOn: [keep.assistanceOfferedOn, dup.assistanceOfferedOn].filter(Boolean).sort().at(-1) ?? null,
  }).where(eq(patients.id, keepId));

  // One-per-patient rows: settle a clash before moving.
  await db.execute(sql`DELETE FROM care_program_consents d WHERE d.patient_id = ${mergeId} AND EXISTS (SELECT 1 FROM care_program_consents k WHERE k.patient_id = ${keepId} AND k.program = d.program)`);
  await db.execute(sql`DELETE FROM slot_offer_recipients d WHERE d.patient_id = ${mergeId} AND EXISTS (SELECT 1 FROM slot_offer_recipients k WHERE k.patient_id = ${keepId} AND k.offer_id = d.offer_id)`);
  // The newer sliding fee verification wins.
  await db.execute(sql`DELETE FROM patient_sliding_fees k WHERE k.patient_id = ${keepId} AND EXISTS (SELECT 1 FROM patient_sliding_fees d WHERE d.patient_id = ${mergeId} AND d.verified_on > k.verified_on)`);
  await db.execute(sql`DELETE FROM patient_sliding_fees d WHERE d.patient_id = ${mergeId} AND EXISTS (SELECT 1 FROM patient_sliding_fees k WHERE k.patient_id = ${keepId})`);
  await db.execute(sql`UPDATE unclaimed_credits SET status = 'resolved', resolved_on = current_date, resolution = 'Patient records merged; the credit is checked again on the record kept'
    WHERE patient_id = ${mergeId} AND status IN ('letter_due', 'letter_sent', 'to_report')`);
  await db.execute(sql`UPDATE waitlist_entries d SET closed_at = now() WHERE d.patient_id = ${mergeId} AND d.closed_at IS NULL
    AND EXISTS (SELECT 1 FROM waitlist_entries k WHERE k.patient_id = ${keepId} AND k.closed_at IS NULL)`);

  const moved: Record<string, number> = {};
  for (const { tbl, col } of await patientColumns(db)) {
    const r = await db.execute(sql`UPDATE ${ident(tbl)} SET ${ident(col)} = ${keepId} WHERE ${ident(col)} = ${mergeId}`);
    const n = Number((r as { rowCount?: number; affectedRows?: number }).rowCount ?? (r as { affectedRows?: number }).affectedRows ?? 0);
    if (n) moved[`${tbl}.${col}`] = n;
  }
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "patients_merged", entity: "patient", entityId: keepId, details: { mergedId: mergeId, mergedMrn: dup.mrn, keptMrn: keep.mrn, moved } });
  return { kept: keep.mrn, merged: dup.mrn, moved };
}

/** The record to show for a patient id: itself, or the one it was merged into. */
export async function survivorOf(db: Db, practiceId: string, patientId: string) {
  const [p] = await db.select({ mergedInto: patients.mergedInto }).from(patients).where(and(eq(patients.id, patientId), eq(patients.practiceId, practiceId))).limit(1);
  return p?.mergedInto ?? null;
}

export const notMerged = isNull(patients.mergedInto);
