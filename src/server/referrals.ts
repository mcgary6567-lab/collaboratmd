/**
 * Where new patients come from, and what they are worth: new patients by
 * referral source, how many were seen, what was billed and what has been
 * collected for them since. A physician referral can name the physician, so
 * the practice sees which referring doctors send the most patients.
 */
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";

import { REFERRAL_SOURCES } from "@/lib/referral-sources";

export { REFERRAL_SOURCES };

const { patients, auditLog } = schema;

/** Checks a source picked on a form; empty means not recorded. */
export function cleanReferral(source: string | null | undefined, detail: string | null | undefined) {
  const s = source?.trim() || null;
  if (s && !REFERRAL_SOURCES[s]) throw new Error("Choose where the patient heard about the practice");
  return { referralSource: s, referralDetail: s ? detail?.trim().slice(0, 120) || null : null };
}

export async function setReferralSource(db: Db, practiceId: string, patientId: string, source: string, detail: string, userId?: string) {
  const values = cleanReferral(source, detail);
  const [p] = await db.update(patients).set(values).where(and(eq(patients.id, patientId), eq(patients.practiceId, practiceId))).returning();
  if (!p) throw new Error("Patient not found");
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "referral_source_set", entity: "patient", entityId: patientId, details: values });
}

/** New patients registered between two dates, by source, with visits, charges and collections to date. */
export async function referralReport(db: Db, practiceId: string, from: string, to: string) {
  const { rows } = await db.execute<Record<string, string | null>>(sql`
    WITH np AS (
      SELECT id, referral_source, referral_detail FROM patients
      WHERE practice_id = ${practiceId} AND merged_into IS NULL AND created_at::date BETWEEN ${from} AND ${to}
    ), money AS (
      SELECT le.patient_id,
        COALESCE(sum(le.amount_cents) FILTER (WHERE le.type = 'charge'), 0) AS charges,
        COALESCE(sum(le.amount_cents) FILTER (WHERE le.type IN ('insurance_payment', 'patient_payment')), 0)
          - COALESCE(sum(le.amount_cents) FILTER (WHERE le.type = 'refund'), 0) AS collected
      FROM ledger_entries le WHERE le.patient_id IN (SELECT id FROM np) GROUP BY le.patient_id
    )
    SELECT np.referral_source AS source, count(*)::text AS patients,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM encounters e WHERE e.patient_id = np.id))::text AS seen,
      COALESCE(sum(m.charges), 0)::text AS charges, COALESCE(sum(m.collected), 0)::text AS collected
    FROM np LEFT JOIN money m ON m.patient_id = np.id
    GROUP BY np.referral_source ORDER BY count(*) DESC`);
  const { rows: doctors } = await db.execute<Record<string, string | null>>(sql`
    SELECT referral_detail AS name, count(*)::text AS patients FROM patients
    WHERE practice_id = ${practiceId} AND merged_into IS NULL AND referral_source = 'physician' AND referral_detail IS NOT NULL
      AND created_at::date BETWEEN ${from} AND ${to}
    GROUP BY referral_detail ORDER BY count(*) DESC LIMIT 20`);
  const sources = rows.map((r) => ({
    source: r.source, label: r.source ? REFERRAL_SOURCES[r.source] ?? r.source : "Not recorded",
    patients: Number(r.patients), seen: Number(r.seen), chargesCents: Number(r.charges), collectedCents: Number(r.collected),
  }));
  const total = sources.reduce((a, s) => a + s.patients, 0);
  const recorded = sources.filter((s) => s.source).reduce((a, s) => a + s.patients, 0);
  return { sources, total, recordedShare: total ? recorded / total : 0, doctors: doctors.map((d) => ({ name: d.name!, patients: Number(d.patients) })) };
}
