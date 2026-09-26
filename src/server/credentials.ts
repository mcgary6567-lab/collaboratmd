/**
 * Credentialing: each provider's state licenses, DEA registration, board
 * certification, malpractice coverage and CAQH attestation, with expiry
 * dates. Payer enrollment (settings/enrollment) depends on these staying
 * current; the daily checks warn 60 days ahead. CAQH attestation lapses
 * every 120 days.
 *
 * Entered by the practice. Pulling data from CAQH ProView needs an
 * organization account with CAQH and is not connected.
 */
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";

const { providerCredentials, providers, auditLog } = schema;

export const CREDENTIAL_KINDS: Record<string, string> = {
  state_license: "State medical license",
  dea: "DEA registration",
  board: "Board certification",
  malpractice: "Malpractice insurance",
  caqh: "CAQH attestation",
  other: "Other",
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function saveCredential(db: Db, practiceId: string, input: { id?: string | null; providerId: string; kind: string; identifier?: string; state?: string; issuedOn?: string; expiresOn?: string; note?: string }, userId?: string) {
  const [p] = await db.select({ id: providers.id }).from(providers).where(and(eq(providers.id, input.providerId), eq(providers.practiceId, practiceId))).limit(1);
  if (!p) throw new Error("Choose the provider");
  if (!(input.kind in CREDENTIAL_KINDS)) throw new Error("Choose what kind of credential it is");
  const expiresOn = input.expiresOn?.trim() || null;
  const issuedOn = input.issuedOn?.trim() || null;
  if (expiresOn && !DATE.test(expiresOn)) throw new Error("Enter the expiry date");
  if (issuedOn && expiresOn && issuedOn > expiresOn) throw new Error("It expires before it was issued");
  if (!expiresOn && input.kind !== "board" && input.kind !== "other") throw new Error("Enter the expiry date; it is what the reminders are for");
  const state = input.state?.trim().toUpperCase() || null;
  if (state && !/^[A-Z]{2}$/.test(state)) throw new Error("Enter the two-letter state");
  const values = { providerId: p.id, kind: input.kind, identifier: input.identifier?.trim().slice(0, 60) || null, state, issuedOn, expiresOn, note: input.note?.trim().slice(0, 300) || null };
  const [row] = input.id
    ? await db.update(providerCredentials).set(values).where(and(eq(providerCredentials.id, input.id), eq(providerCredentials.practiceId, practiceId))).returning()
    : await db.insert(providerCredentials).values({ practiceId, ...values }).returning();
  if (!row) throw new Error("Credential not found");
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "credential_saved", entity: "provider", entityId: p.id, details: { kind: input.kind, expiresOn } });
  return row;
}

export async function deleteCredential(db: Db, practiceId: string, id: string, userId?: string) {
  const [row] = await db.delete(providerCredentials).where(and(eq(providerCredentials.id, id), eq(providerCredentials.practiceId, practiceId))).returning();
  if (row) await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "credential_deleted", entity: "provider", entityId: row.providerId, details: { kind: row.kind } });
}

export async function listCredentials(db: Db, practiceId: string) {
  return db
    .select({ c: providerCredentials, first: providers.firstName, last: providers.lastName })
    .from(providerCredentials)
    .innerJoin(providers, eq(providers.id, providerCredentials.providerId))
    .where(eq(providerCredentials.practiceId, practiceId))
    .orderBy(asc(providerCredentials.expiresOn));
}

/** expired, due (within 60 days), or ok. */
export function credentialState(expiresOn: string | null, today = new Date().toISOString().slice(0, 10)) {
  if (!expiresOn) return "ok" as const;
  if (expiresOn < today) return "expired" as const;
  const days = (Date.parse(expiresOn) - Date.parse(today)) / 86_400_000;
  return days <= 60 ? ("due" as const) : ("ok" as const);
}
