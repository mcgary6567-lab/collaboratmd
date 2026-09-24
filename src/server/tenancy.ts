/**
 * Ownership checks for IDs that arrive from the browser.
 *
 * Every record belongs to one practice. An action that takes an ID from a
 * form or a bound argument must confirm the record is the signed-in
 * practice's before acting on it, or one practice could read or change
 * another's claims and patients by sending a different ID. Missing and
 * foreign records get the same "not found" so the response does not reveal
 * whether an ID exists elsewhere.
 */
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";

const tables = {
  claim: schema.claims,
  denial: schema.denials,
  appointment: schema.appointments,
  patient: schema.patients,
  provider: schema.providers,
  payer: schema.payers,
  encounter: schema.encounters,
} as const;

export type Owned = keyof typeof tables;

export async function assertOwned(db: Db, practiceId: string, kind: Owned, id: string | null | undefined): Promise<void> {
  const t = tables[kind];
  const valid = typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id);
  const [row] = valid ? await db.select({ id: t.id }).from(t).where(and(eq(t.id, id), eq(t.practiceId, practiceId))).limit(1) : [];
  if (!row) throw new Error(`${kind[0].toUpperCase()}${kind.slice(1)} not found`);
}

export const DENIAL_STATUSES = ["open", "in_progress", "appealed", "resolved", "written_off"] as const;
export const APPOINTMENT_STATUSES = ["scheduled", "checked_in", "completed", "no_show", "cancelled"] as const;
