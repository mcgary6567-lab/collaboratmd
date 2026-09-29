/**
 * Good faith estimates against the bill. Under the No Surprises Act, an
 * uninsured or self-pay patient billed at least $400 more than the good faith
 * estimate can start the federal patient-provider dispute resolution process.
 * Each good faith estimate is compared with what was actually charged for the
 * patient on that date, so the practice can review the bill (or explain the
 * difference) before the statement goes out.
 */
import { sql } from "drizzle-orm";
import type { Db } from "@/db";

export const DISPUTE_THRESHOLD_CENTS = 40_000;

export async function gfeVariances(db: Db, practiceId: string, patientId?: string) {
  const { rows } = await db.execute<Record<string, string | null>>(sql`
    SELECT es.id, es.estimate_number, es.patient_id, p.first_name, p.last_name, es.service_date::text AS dos, es.total_charge_cents::text AS estimated,
      (SELECT COALESCE(sum(ch.charge_cents * ch.units), 0) FROM encounters e JOIN charges ch ON ch.encounter_id = e.id
        WHERE e.patient_id = es.patient_id AND e.date_of_service = es.service_date
          AND NOT EXISTS (SELECT 1 FROM claims cl WHERE cl.encounter_id = e.id AND cl.status IN ('void', 'voided')))::text AS billed
    FROM estimates es JOIN patients p ON p.id = es.patient_id
    WHERE es.practice_id = ${practiceId} AND es.kind = 'good_faith' AND es.service_date IS NOT NULL
      ${patientId ? sql`AND es.patient_id = ${patientId}` : sql``}
    ORDER BY es.service_date DESC
    LIMIT 500`);
  return rows
    .map((r) => ({ estimateId: r.id!, estimateNumber: r.estimate_number!, patientId: r.patient_id!, name: `${r.last_name}, ${r.first_name}`, dateOfService: r.dos!, estimatedCents: Number(r.estimated), billedCents: Number(r.billed) }))
    .map((r) => ({ ...r, overCents: r.billedCents - r.estimatedCents }))
    .filter((r) => r.billedCents > 0 && r.overCents >= DISPUTE_THRESHOLD_CENTS);
}
