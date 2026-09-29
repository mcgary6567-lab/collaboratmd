/**
 * Duplicate claims: the same service for the same patient, date and payer on
 * another claim. The payer denies the second one (CARC 18) unless a modifier
 * says it was a real repeat: 76 (repeated by the same practitioner), 77 (by
 * another), 91 (repeat lab test). A claim that corrects or replaces another is
 * not a duplicate of it, and a claim the clearinghouse rejected never reached
 * the payer.
 */
import { sql } from "drizzle-orm";
import type { Db } from "@/db";
import type { ScrubFinding } from "@/lib/scrub/rules";

const REPEAT = ["76", "77", "91"];
const NOT_YET_SENT = ["draft", "scrub_errors", "ready"];

export type OtherService = { claimId: string; controlNumber: string; status: string; cpt: string };

/** Pure: which lines repeat a service on another claim. */
export function duplicateIssues(lines: { lineNumber: number; cpt: string; modifiers: string[] }[], others: OtherService[]): ScrubFinding[] {
  const out: ScrubFinding[] = [];
  for (const l of lines) {
    const code = l.cpt.toUpperCase();
    if (l.modifiers.some((m) => REPEAT.includes(m.toUpperCase()))) continue;
    const other = others.find((o) => o.cpt.toUpperCase() === code);
    if (!other) continue;
    const field = `lines.${l.lineNumber}.cpt`;
    if (other.status === "denied") {
      out.push({ rule: "DUPLICATE_CLAIM", severity: "warning", field, message: `Line ${l.lineNumber}: ${code} was already billed on claim ${other.controlNumber}, which was denied. Send a corrected claim (frequency 7) for it instead of a new one, or the payer denies this as a duplicate.` });
    } else if (NOT_YET_SENT.includes(other.status)) {
      out.push({ rule: "DUPLICATE_CLAIM", severity: "warning", field, message: `Line ${l.lineNumber}: ${code} for this date is also on claim ${other.controlNumber}, not yet sent. Bill it once.` });
    } else {
      out.push({ rule: "DUPLICATE_CLAIM", severity: "error", field, message: `Line ${l.lineNumber}: ${code} for this patient and date was already billed to this payer on claim ${other.controlNumber} (${other.status.replace(/_/g, " ")}). Remove it, or add 76, 77 or 91 if it was truly repeated.` });
    }
  }
  return out;
}

/** The same patient's services on the same date to the same payer, on other claims that are live. */
export async function otherServices(db: Db, c: { claimId: string; originalClaimId: string | null; practiceId: string; patientId: string; payerId: string; dateOfService: string }): Promise<OtherService[]> {
  const { rows } = await db.execute<{ claim_id: string; control_number: string; status: string; cpt: string }>(sql`
    SELECT cl.id AS claim_id, cl.control_number, cl.status, ch.cpt
    FROM claims cl
    JOIN encounters e ON e.id = cl.encounter_id
    JOIN charges ch ON ch.encounter_id = e.id
    WHERE cl.practice_id = ${c.practiceId} AND cl.patient_id = ${c.patientId} AND cl.payer_id = ${c.payerId}
      AND e.date_of_service = ${c.dateOfService} AND cl.id <> ${c.claimId}
      AND cl.status NOT IN ('void', 'voided', 'rejected')
      AND cl.frequency_code NOT IN ('7', '8')
      AND (cl.original_claim_id IS NULL OR cl.original_claim_id <> ${c.claimId})
      AND cl.id <> ${c.originalClaimId ?? c.claimId}`);
  return rows.map((r) => ({ claimId: r.claim_id, controlNumber: r.control_number, status: r.status, cpt: r.cpt }));
}

export async function duplicateFindings(db: Db, c: Parameters<typeof otherServices>[1] & { frequencyCode: string; lines: { lineNumber: number; cpt: string; modifiers: string[] }[] }) {
  if (c.frequencyCode !== "1") return [];
  return duplicateIssues(c.lines, await otherServices(db, c));
}
