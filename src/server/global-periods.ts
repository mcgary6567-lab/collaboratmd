/**
 * Surgical global periods. A procedure with a 10- or 90-day global period
 * includes the routine follow-up visits after it: an E/M visit in that window
 * is paid only when it is for something else (modifier 24), was the decision
 * for surgery (57) or is a significant separate service (25); another
 * procedure needs 58 (staged), 78 (return to the operating room) or 79
 * (unrelated). Routine post-op visits are reported as 99024 at $0.00.
 *
 * The global days come from CMS's RVU file (column GLOB DAYS), so the check
 * runs only when that year's file is loaded. The window counts surgeries by
 * the whole practice, as Medicare applies it to the surgeon's group.
 */
import { sql } from "drizzle-orm";
import type { Db } from "@/db";
import type { ScrubFinding } from "@/lib/scrub/rules";

/** Evaluation and management codes (office, hospital, nursing facility, home, consults). */
export const isEmCode = (code: string) => /^99(2[0-9]{2}|3[0-4][0-9]|4[0-9]{2})$/.test(code) && code !== "99024";
const EM_BYPASS = ["24", "25", "57"];
const PROCEDURE_BYPASS = ["58", "78", "79"];

export type GlobalSurgery = { code: string; dateOfService: string; globalDays: number };

const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Pure: which lines of a claim fall inside an earlier surgery's global period without a modifier that allows them. */
export function globalPeriodIssues(dateOfService: string, lines: { lineNumber: number; cpt: string; modifiers: string[] }[], surgeries: GlobalSurgery[], payerType: string): ScrubFinding[] {
  const out: ScrubFinding[] = [];
  const open = surgeries.filter((s) => s.dateOfService < dateOfService && dateOfService <= addDays(s.dateOfService, s.globalDays));
  if (!open.length) return out;
  const s = open.sort((a, b) => b.globalDays - a.globalDays || b.dateOfService.localeCompare(a.dateOfService))[0];
  const ends = addDays(s.dateOfService, s.globalDays);
  const strict = payerType === "medicare" || payerType === "medicaid";
  for (const l of lines) {
    const code = l.cpt.toUpperCase();
    const mods = l.modifiers.map((m) => m.toUpperCase());
    const field = `lines.${l.lineNumber}.modifiers`;
    if (code === "99024") continue;
    if (isEmCode(code)) {
      if (mods.some((m) => EM_BYPASS.includes(m))) continue;
      out.push({
        rule: "GLOBAL_PERIOD", severity: strict ? "error" : "warning", field,
        message: `Line ${l.lineNumber}: ${code} is inside the ${s.globalDays}-day global period of ${s.code} on ${s.dateOfService} (through ${ends}). A routine follow-up is included: report 99024 at $0.00 instead. Add 24 only if the visit was for an unrelated problem.`,
      });
    } else if (!mods.some((m) => PROCEDURE_BYPASS.includes(m))) {
      out.push({
        rule: "GLOBAL_PERIOD", severity: "warning", field,
        message: `Line ${l.lineNumber}: ${code} is inside the ${s.globalDays}-day global period of ${s.code} on ${s.dateOfService}. Add 58 (staged or planned), 78 (return to the operating room for a complication) or 79 (unrelated), or the payer will treat it as included.`,
      });
    }
  }
  return out;
}

/** Surgeries with a 10- or 90-day global period for the patient in the 90 days before the date of service, from other encounters. */
export async function surgeriesBefore(db: Db, c: { practiceId: string; patientId: string; encounterId: string; dateOfService: string }): Promise<GlobalSurgery[]> {
  const from = addDays(c.dateOfService, -90);
  const { rows } = await db.execute<{ code: string; dos: string; glob: string }>(sql`
    SELECT ch.cpt AS code, e.date_of_service::text AS dos, r.global_days AS glob
    FROM charges ch
    JOIN encounters e ON e.id = ch.encounter_id
    JOIN mpfs_rvus r ON r.code = ch.cpt AND r.modifier = '' AND r.year = (SELECT max(y.year) FROM mpfs_years y WHERE y.year <= extract(year FROM e.date_of_service))
    WHERE e.practice_id = ${c.practiceId} AND e.patient_id = ${c.patientId} AND e.id <> ${c.encounterId}
      AND e.date_of_service >= ${from} AND e.date_of_service < ${c.dateOfService}
      AND r.global_days IN ('010', '090')
      AND NOT EXISTS (SELECT 1 FROM claims cl WHERE cl.encounter_id = e.id AND cl.status IN ('void', 'voided'))`);
  return rows.map((r) => ({ code: r.code, dateOfService: r.dos, globalDays: Number(r.glob) }));
}

export async function globalPeriodFindings(db: Db, c: { practiceId: string; patientId: string; encounterId: string; dateOfService: string; payerType: string; lines: { lineNumber: number; cpt: string; modifiers: string[] }[] }) {
  if (!c.lines.length) return [];
  return globalPeriodIssues(c.dateOfService, c.lines, await surgeriesBefore(db, c), c.payerType);
}
