/**
 * Year-end payment receipts: what a patient paid the practice in a calendar
 * year, by visit, for a health savings or flexible spending account, or taxes.
 * Refunds back to the patient in the same year are shown and netted out.
 */
import { sql } from "drizzle-orm";
import type { Db } from "@/db";

type Row = Record<string, string | null>;

export type ReceiptLine = { postedOn: string; amountCents: number; dateOfService: string | null; controlNumber: string | null; note: string | null };

export async function yearReceipt(db: Db, practiceId: string, patientId: string, year: number) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error("Choose a year");
  const { rows } = await db.execute<Row>(sql`
    SELECT le.type, le.amount_cents::text AS amount, le.posted_at::date::text AS posted_on, le.note, e.date_of_service::text AS dos, c.control_number
    FROM ledger_entries le
    LEFT JOIN claims c ON c.id = le.claim_id
    LEFT JOIN encounters e ON e.id = c.encounter_id
    WHERE le.practice_id = ${practiceId} AND le.patient_id = ${patientId} AND le.type IN ('patient_payment', 'refund')
      AND le.posted_at >= ${`${year}-01-01`}::date AND le.posted_at < ${`${year + 1}-01-01`}::date
      -- Credits sent to the state as unclaimed property were not returned to the patient.
      AND NOT (le.type = 'refund' AND COALESCE(le.note, '') LIKE 'Unclaimed property%')
    ORDER BY le.posted_at`);
  const line = (r: Row): ReceiptLine => ({ postedOn: r.posted_on!, amountCents: Number(r.amount), dateOfService: r.dos, controlNumber: r.control_number, note: r.note });
  const payments = rows.filter((r) => r.type === "patient_payment").map(line);
  const refunds = rows.filter((r) => r.type === "refund").map(line);
  const paidCents = payments.reduce((a, p) => a + p.amountCents, 0);
  const refundedCents = refunds.reduce((a, p) => a + p.amountCents, 0);
  return { year, payments, refunds, paidCents, refundedCents, netCents: paidCents - refundedCents };
}

/** Patients who paid anything in the year, for printing every receipt at once. */
export async function patientsWithPayments(db: Db, practiceId: string, year: number, limit = 300, offset = 0) {
  const { rows } = await db.execute<Row>(sql`
    SELECT le.patient_id, p.last_name, p.first_name, sum(le.amount_cents)::text AS paid
    FROM ledger_entries le JOIN patients p ON p.id = le.patient_id
    WHERE le.practice_id = ${practiceId} AND le.type = 'patient_payment'
      AND le.posted_at >= ${`${year}-01-01`}::date AND le.posted_at < ${`${year + 1}-01-01`}::date
    GROUP BY le.patient_id, p.last_name, p.first_name
    ORDER BY p.last_name, p.first_name LIMIT ${limit} OFFSET ${offset}`);
  return rows.map((r) => ({ patientId: r.patient_id!, name: `${r.last_name}, ${r.first_name}`, paidCents: Number(r.paid) }));
}
