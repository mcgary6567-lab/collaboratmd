/**
 * Who looked at a patient's records, and what was done with them: the
 * practice's internal access log (HIPAA audit controls, 45 CFR 164.312(b)),
 * for reviewing access and investigating a suspected snooping incident.
 *
 * It is not the accounting of disclosures a patient can request (164.528),
 * which covers disclosures outside the practice and excludes treatment,
 * payment and operations; that stays a separate, manual record.
 *
 * Views are recorded when staff open the chart, a claim, a statement or an
 * estimate; the same person reopening the same record within 15 minutes is
 * not recorded again. Full practice exports include every patient and are
 * listed separately.
 */
import { and, desc, eq, gte, inArray, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";

const { auditLog, users, claims, statements, appointments, estimates } = schema;

export type ViewVia = "chart" | "claim" | "statement" | "estimate";
export const REPEAT_WINDOW_MS = 15 * 60_000;

export async function recordView(db: Db, who: { practiceId: string; userId: string }, patientId: string, via: ViewVia, id?: string, now = new Date()) {
  const recent = await db
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(and(eq(auditLog.practiceId, who.practiceId), eq(auditLog.entityId, patientId), eq(auditLog.userId, who.userId), eq(auditLog.action, "patient_viewed"), gte(auditLog.at, new Date(now.getTime() - REPEAT_WINDOW_MS)), sql`${auditLog.details}->>'via' = ${via}`, sql`coalesce(${auditLog.details}->>'id', '') = ${id ?? ""}`))
    .limit(1);
  if (recent.length) return false;
  await db.insert(auditLog).values({ practiceId: who.practiceId, userId: who.userId, action: "patient_viewed", entity: "patient", entityId: patientId, details: id ? { via, id } : { via }, at: now });
  return true;
}

const LABELS: Record<string, string> = {
  patient_viewed: "Opened",
  attachment_viewed: "Opened a claim attachment",
  create_portal_link: "Sent a portal link",
  statement_mailed: "Mailed a statement",
  patient_checkin: "Patient checked in online",
  patient_restricted: "Restricted the record",
  patient_unrestricted: "Removed the restriction",
};

export type AccessEntry = { at: Date; who: string; what: string; action: string };

/** A patient's access log, newest first, and the full practice exports since the earliest entry shown. */
export async function patientAccessLog(db: Db, practiceId: string, patientId: string, limit = 500) {
  const [claimIds, statementIds, apptIds, estimateIds] = await Promise.all([
    db.select({ id: claims.id }).from(claims).where(and(eq(claims.practiceId, practiceId), eq(claims.patientId, patientId))),
    db.select({ id: statements.id }).from(statements).where(and(eq(statements.practiceId, practiceId), eq(statements.patientId, patientId))),
    db.select({ id: appointments.id }).from(appointments).where(and(eq(appointments.practiceId, practiceId), eq(appointments.patientId, patientId))),
    db.select({ id: estimates.id }).from(estimates).where(and(eq(estimates.practiceId, practiceId), eq(estimates.patientId, patientId))),
  ]);
  const ids = (rows: { id: string }[]) => rows.map((r) => r.id);
  const about = [
    and(eq(auditLog.entity, "patient"), eq(auditLog.entityId, patientId)),
    ...(claimIds.length ? [and(eq(auditLog.entity, "claim"), inArray(auditLog.entityId, ids(claimIds)))] : []),
    ...(statementIds.length ? [and(eq(auditLog.entity, "statement"), inArray(auditLog.entityId, ids(statementIds)))] : []),
    ...(apptIds.length ? [and(eq(auditLog.entity, "appointment"), inArray(auditLog.entityId, ids(apptIds)))] : []),
    ...(estimateIds.length ? [and(eq(auditLog.entity, "estimate"), inArray(auditLog.entityId, ids(estimateIds)))] : []),
  ];
  const rows = await db
    .select({ log: auditLog, name: users.name, email: users.email })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.userId))
    .where(and(eq(auditLog.practiceId, practiceId), or(...about)))
    .orderBy(desc(auditLog.at))
    .limit(limit);
  const entries: AccessEntry[] = rows.map(({ log, name, email }) => {
    const via = (log.details as { via?: string } | null)?.via;
    const reason = (log.details as { reason?: string } | null)?.reason;
    if (log.action === "restricted_record_opened") return { at: log.at, who: name ? `${name}${email ? ` <${email}>` : ""}` : "A former user", what: `Opened the restricted record. Reason: ${reason ?? "(none recorded)"}`, action: log.action };
    const what = log.action === "patient_viewed"
      ? `Opened the ${via === "chart" ? "chart" : via ?? "record"}`
      : LABELS[log.action] ?? log.action.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) + (log.entity !== "patient" ? ` (${log.entity})` : "");
    return { at: log.at, who: name ? `${name}${email ? ` <${email}>` : ""}` : log.userId ? "A former user" : "The system or the patient", what, action: log.action };
  });
  const since = entries.length ? entries[entries.length - 1].at : new Date(0);
  const exports = await db
    .select({ at: auditLog.at, action: auditLog.action, name: users.name, email: users.email })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.userId))
    .where(and(eq(auditLog.practiceId, practiceId), eq(auditLog.entity, "practice"), inArray(auditLog.action, ["export", "export_downloaded"]), gte(auditLog.at, since)))
    .orderBy(desc(auditLog.at))
    .limit(100);
  return { entries, exports, truncated: rows.length === limit };
}
