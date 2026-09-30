/**
 * Registration quality: rejections and denials that trace back to what was
 * entered at registration, by the field that was wrong and by who (or what)
 * entered the policy. Front-end rejections (277CA), coverage checks the payer
 * refused (271 AAA), and denials for identity or coverage all start at the
 * front desk, and are the cheapest denials to prevent.
 *
 * Who entered a policy is recorded from migration 0063 on; earlier policies
 * show as "Not recorded".
 */
import { sql } from "drizzle-orm";
import type { Db } from "@/db";

type Row = Record<string, string | null>;

export const FIELDS = {
  member_id: "Member ID",
  name: "Name",
  dob: "Date of birth",
  identity: "Member ID, name or date of birth",
  subscriber: "Insured person's details",
  patient: "Patient's details",
  coverage: "Coverage on the date of service",
  payer: "Payer or billing order",
} as const;
export type Field = keyof typeof FIELDS;

/** A claim status (277CA category:status:entity) that points at registration, or null. */
export function fieldFromAck(code: string | null): Field | null {
  const [, status, entity] = (code ?? "").split(":");
  if (status === "164" || status === "33") return "member_id";
  if (status === "88") return "coverage";
  if (status === "21" && entity === "IL") return "subscriber";
  if (status === "21" && entity === "QC") return "patient";
  return null;
}

/** A payer's refusal to answer a coverage check (AAA03) that points at registration, or null. */
export function fieldFromAaa(message: string | null): Field | null {
  const code = /\(AAA (\d+)\)/.exec(message ?? "")?.[1];
  if (code === "72" || code === "75" || code === "76") return "member_id";
  if (code === "73") return "name";
  if (code === "58" || code === "71") return "dob";
  return null;
}

/** A denial reason that points at registration, or null. */
export function fieldFromCarc(carc: string): Field | null {
  if (carc === "31") return "identity";
  if (carc === "140") return "member_id";
  if (carc === "26" || carc === "27") return "coverage";
  if (carc === "22" || carc === "109") return "payer";
  return null;
}

const SOURCES: Record<string, string> = { staff: "Staff (no name recorded)", discovery: "Coverage discovery", checkin: "Patient at online check-in", hl7: "EHR interface (HL7)", fhir: "EHR (FHIR)", api: "API" };

export type RegistrationIssue = { kind: "rejection" | "coverage_check" | "denial"; on: string; field: Field; code: string; patientId: string; patientName: string; payer: string; claimId: string | null; controlNumber: string | null; amountCents: number; enteredBy: string };

export async function registrationQuality(db: Db, practiceId: string, from: string, to: string) {
  const who = sql`COALESCE(u.name, CASE pi.source ${sql.raw(Object.entries(SOURCES).map(([k, v]) => `WHEN '${k}' THEN '${v.replace(/'/g, "''")}'`).join(" "))} END, 'Not recorded')`;
  const [acks, checks, denials] = await Promise.all([
    db.execute<Row>(sql`
      SELECT a.code, a.received_at::date::text AS on_date, c.id AS claim_id, c.control_number, c.total_cents::text AS amount, p.id AS patient_id, p.last_name || ', ' || p.first_name AS patient, py.name AS payer, ${who} AS who
      FROM claim_acknowledgments a JOIN claims c ON c.id = a.claim_id JOIN patients p ON p.id = c.patient_id JOIN payers py ON py.id = c.payer_id
      LEFT JOIN patient_insurances pi ON pi.id = c.patient_insurance_id LEFT JOIN users u ON u.id = pi.created_by
      WHERE c.practice_id = ${practiceId} AND a.kind = '277CA' AND NOT a.accepted AND a.received_at::date BETWEEN ${from} AND ${to}`),
    db.execute<Row>(sql`
      SELECT ec.message, ec.checked_at::date::text AS on_date, p.id AS patient_id, p.last_name || ', ' || p.first_name AS patient, py.name AS payer, ${who} AS who
      FROM eligibility_checks ec JOIN patient_insurances pi ON pi.id = ec.patient_insurance_id JOIN patients p ON p.id = pi.patient_id JOIN payers py ON py.id = pi.payer_id
      LEFT JOIN users u ON u.id = pi.created_by
      WHERE p.practice_id = ${practiceId} AND ec.status <> 'active' AND ec.message LIKE '%(AAA %' AND ec.checked_at::date BETWEEN ${from} AND ${to}`),
    db.execute<Row>(sql`
      SELECT d.carc, d.amount_cents::text AS amount, d.created_at::date::text AS on_date, c.id AS claim_id, c.control_number, p.id AS patient_id, p.last_name || ', ' || p.first_name AS patient, py.name AS payer, ${who} AS who
      FROM denials d JOIN claims c ON c.id = d.claim_id JOIN patients p ON p.id = c.patient_id JOIN payers py ON py.id = c.payer_id
      LEFT JOIN patient_insurances pi ON pi.id = c.patient_insurance_id LEFT JOIN users u ON u.id = pi.created_by
      WHERE d.practice_id = ${practiceId} AND d.carc IN ('31', '140', '26', '27', '22', '109') AND d.created_at::date BETWEEN ${from} AND ${to}`),
  ]);
  const issues: RegistrationIssue[] = [];
  const base = (r: Row) => ({ on: r.on_date!, patientId: r.patient_id!, patientName: r.patient!, payer: r.payer!, enteredBy: r.who! });
  for (const r of acks.rows) { const f = fieldFromAck(r.code); if (f) issues.push({ ...base(r), kind: "rejection", field: f, code: `277CA ${r.code}`, claimId: r.claim_id, controlNumber: r.control_number, amountCents: Number(r.amount) }); }
  for (const r of checks.rows) { const f = fieldFromAaa(r.message); if (f) issues.push({ ...base(r), kind: "coverage_check", field: f, code: r.message!.match(/AAA \d+/)![0], claimId: null, controlNumber: null, amountCents: 0 }); }
  for (const r of denials.rows) { const f = fieldFromCarc(r.carc!); if (f) issues.push({ ...base(r), kind: "denial", field: f, code: `CARC ${r.carc}`, claimId: r.claim_id, controlNumber: r.control_number, amountCents: Number(r.amount) }); }
  issues.sort((a, b) => b.on.localeCompare(a.on));
  const tally = <K extends string>(key: (i: RegistrationIssue) => K) => {
    const m = new Map<K, { count: number; cents: number }>();
    for (const i of issues) { const t = m.get(key(i)) ?? { count: 0, cents: 0 }; t.count++; t.cents += i.amountCents; m.set(key(i), t); }
    return [...m].map(([k, v]) => ({ key: k, ...v })).sort((a, b) => b.count - a.count);
  };
  return { issues, byField: tally((i) => i.field), byPerson: tally((i) => i.enteredBy) };
}
