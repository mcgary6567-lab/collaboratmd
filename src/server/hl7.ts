/**
 * Receiving HL7 from an EHR.
 *
 * An interface engine posts messages to /api/hl7 with a practice's integration
 * key. ADT messages create or update the patient and their primary insurance;
 * DFT^P03 messages become an encounter and a claim, run through the same
 * scrubber as charges keyed by hand. Every message is logged with its outcome,
 * and a resent message (same MSH-10 control ID) is acknowledged without being
 * applied twice.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { emit } from "./webhooks";
import { schema } from "@/db";
import { buildAck, parseHl7, type Hl7Message } from "@/lib/hl7/v2";
import { ADT_EVENTS, extractEncounter, extractInsurance, extractPatient, type Hl7Insurance, type Hl7Patient } from "@/lib/hl7/extract";
import { createEncounterWithClaim } from "./encounters";
import { standardCharges } from "./fees";
import { applyOru } from "./labs";

const { integrationKeys, integrationMessages, patients, patientInsurances, payers, providers } = schema;

/* ------------------------------ Keys ------------------------------ */

const hash = (key: string) => createHash("sha256").update(key).digest("hex");

export async function createIntegrationKey(db: Db, practiceId: string, name: string, userId?: string) {
  if (!name.trim()) throw new Error("Name the key after the system that will use it");
  const key = `cmd_hl7_${randomBytes(24).toString("base64url")}`;
  const [row] = await db
    .insert(integrationKeys)
    .values({ practiceId, name: name.trim().slice(0, 80), prefix: key.slice(0, 14), keyHash: hash(key), createdBy: userId ?? null })
    .returning();
  await db.insert(schema.auditLog).values({ practiceId, userId: userId ?? null, action: "create_integration_key", entity: "integration_key", entityId: row.id });
  return { key, row };
}

export async function listIntegrationKeys(db: Db, practiceId: string) {
  return db.select().from(integrationKeys).where(eq(integrationKeys.practiceId, practiceId)).orderBy(desc(integrationKeys.createdAt));
}

export async function revokeIntegrationKey(db: Db, practiceId: string, id: string, userId?: string) {
  await db.update(integrationKeys).set({ revokedAt: new Date() }).where(and(eq(integrationKeys.id, id), eq(integrationKeys.practiceId, practiceId), isNull(integrationKeys.revokedAt)));
  await db.insert(schema.auditLog).values({ practiceId, userId: userId ?? null, action: "revoke_integration_key", entity: "integration_key", entityId: id });
}

/** The live key a bearer token names, or null. */
export async function authenticateKey(db: Db, bearer: string | null) {
  const key = bearer?.replace(/^Bearer\s+/i, "").trim();
  if (!key || !key.startsWith("cmd_hl7_")) return null;
  const [row] = await db.select().from(integrationKeys).where(and(eq(integrationKeys.keyHash, hash(key)), isNull(integrationKeys.revokedAt))).limit(1);
  if (!row) return null;
  await db.update(integrationKeys).set({ lastUsedAt: new Date() }).where(eq(integrationKeys.id, row.id));
  return row;
}

export async function listMessages(db: Db, practiceId: string, limit = 50) {
  return db.select().from(integrationMessages).where(eq(integrationMessages.practiceId, practiceId)).orderBy(desc(integrationMessages.receivedAt)).limit(limit);
}

/* ---------------------------- Patients ---------------------------- */

async function findPayer(db: Db, practiceId: string, ins: Hl7Insurance) {
  const [byId] = ins.payerId
    ? await db.select().from(payers).where(and(eq(payers.practiceId, practiceId), eq(payers.payerId, ins.payerId))).limit(1)
    : [];
  if (byId) return byId;
  if (!ins.payerName) return null;
  const [byName] = await db.select().from(payers).where(and(eq(payers.practiceId, practiceId), sql`lower(${payers.name}) = lower(${ins.payerName})`)).limit(1);
  return byName ?? null;
}

/**
 * Makes `ins` the patient's active primary insurance: updates the member and
 * group numbers if the payer is unchanged, otherwise retires the old primary
 * and adds the new one. A payer the practice does not bill is reported, not
 * guessed at. Returns notes for the user.
 */
export async function applyPrimaryInsurance(db: Db, practiceId: string, patientId: string, ins: Hl7Insurance): Promise<string[]> {
  const payer = await findPayer(db, practiceId, ins);
  if (!payer) return [`Insurance not applied: payer "${ins.payerName || ins.payerId}" is not set up for this practice`];
  const [primary] = await db
    .select()
    .from(patientInsurances)
    .where(and(eq(patientInsurances.patientId, patientId), eq(patientInsurances.active, true), eq(patientInsurances.rank, 1)))
    .limit(1);
  if (primary && primary.payerId === payer.id) {
    await db.update(patientInsurances).set({ memberId: ins.memberId, groupNumber: ins.groupNumber || null, relationship: ins.relationship }).where(eq(patientInsurances.id, primary.id));
    return [];
  }
  if (primary) await db.update(patientInsurances).set({ active: false }).where(eq(patientInsurances.id, primary.id));
  await db.insert(patientInsurances).values({ patientId, payerId: payer.id, memberId: ins.memberId, groupNumber: ins.groupNumber || null, rank: 1, relationship: ins.relationship });
  return [primary ? `Primary insurance changed to ${payer.name}` : `Insurance added: ${payer.name}`];
}

/**
 * Creates or updates a patient by MRN. Blank values in the message never
 * erase what is on file. Insurance is applied when its payer is one the
 * practice bills; otherwise the patient is saved and the result says so.
 */
export async function upsertPatient(db: Db, practiceId: string, p: Hl7Patient, ins: Hl7Insurance | null) {
  const notes: string[] = [];
  const [existing] = await db.select().from(patients).where(and(eq(patients.practiceId, practiceId), eq(patients.mrn, p.mrn))).limit(1);
  const values = {
    firstName: p.firstName, lastName: p.lastName, dob: p.dob, sex: p.sex,
    phone: p.phone || null, email: p.email || null, address1: p.address1 || null, city: p.city || null, state: p.state || null, zip: p.zip || null,
  };
  let patientId: string;
  let action: "created" | "updated";
  if (existing) {
    const changes = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== null && v !== ""));
    await db.update(patients).set(changes).where(eq(patients.id, existing.id));
    patientId = existing.id;
    action = "updated";
  } else {
    const [created] = await db.insert(patients).values({ practiceId, mrn: p.mrn, ...values }).returning();
    await emit(db, practiceId, "patient.created", { patient_id: created.id, mrn: created.mrn, source: "hl7" });
    patientId = created.id;
    action = "created";
  }

  if (ins) notes.push(...(await applyPrimaryInsurance(db, practiceId, patientId, ins)));
  return { patientId, action, notes };
}

/* ---------------------------- Messages ---------------------------- */

export interface ProcessResult {
  status: "processed" | "error" | "duplicate";
  ack: string;
  message: string;
  result?: Record<string, unknown>;
}

async function applyMessage(db: Db, practiceId: string, msg: Hl7Message, userId?: string): Promise<{ message: string; result: Record<string, unknown> }> {
  if (msg.type === "ADT" && ADT_EVENTS.includes(msg.event)) {
    const r = await upsertPatient(db, practiceId, extractPatient(msg), extractInsurance(msg));
    return { message: `Patient ${r.action}${r.notes.length ? `; ${r.notes.join("; ")}` : ""}`, result: r };
  }
  if (msg.type === "DFT" && msg.event === "P03") {
    const p = extractPatient(msg);
    const enc = extractEncounter(msg);
    const [known] = await db.select({ id: patients.id }).from(patients).where(and(eq(patients.practiceId, practiceId), eq(patients.mrn, p.mrn))).limit(1);
    const up = known ? { patientId: known.id, notes: [] as string[] } : await upsertPatient(db, practiceId, p, extractInsurance(msg));
    const npi = enc.providerNpi || enc.charges[0].providerNpi;
    const [provider] = npi
      ? await db.select().from(providers).where(and(eq(providers.practiceId, practiceId), eq(providers.npi, npi))).limit(1)
      : [];
    if (!provider) throw new Error(`No provider in this practice has NPI ${npi || "(none sent)"}`);
    const [coverage] = await db.select({ id: patientInsurances.id }).from(patientInsurances).where(and(eq(patientInsurances.patientId, up.patientId), eq(patientInsurances.active, true))).limit(1);
    if (!coverage) throw new Error("The patient has no active insurance to bill; send an ADT with IN1 or add it in CollaboratMD");
    const fees = await standardCharges(db, practiceId);
    const dx = enc.diagnoses;
    const lines = enc.charges.map((c) => {
      const priced = c.chargeCents ? Math.round(c.chargeCents / c.units) : fees.get(c.cpt);
      if (!priced) throw new Error(`No price for ${c.cpt}: send FT1-11 or add the code to the fee schedule`);
      const own = c.diagnoses.map((d) => dx.indexOf(d.replace(/\./g, "").toUpperCase()) + 1).filter((n) => n > 0);
      return { cpt: c.cpt, modifiers: c.modifiers, units: c.units, chargeCents: priced, dxPointers: (own.length ? own : [1]).slice(0, 4), description: c.description || undefined };
    });
    const { claim } = await createEncounterWithClaim(
      db, practiceId,
      { patientId: up.patientId, providerId: provider.id, dateOfService: enc.charges[0].dateOfService, placeOfService: enc.placeOfService, diagnoses: dx, lines },
      userId,
    );
    return {
      message: `Claim ${claim.controlNumber} created (${claim.status === "ready" ? "ready to submit" : "needs review"})`,
      result: { patientId: up.patientId, claimId: claim.id, claimStatus: claim.status, lines: lines.length },
    };
  }
  if (msg.type === "ORU" && msg.event === "R01") return applyOru(db, practiceId, msg);
  throw new UnsupportedError(`${msg.type}^${msg.event} is not supported; send ADT A01/A04/A05/A08/A28/A31, DFT P03 or ORU R01`);
}

class UnsupportedError extends Error {}

export async function processHl7(db: Db, practiceId: string, raw: string, opts: { source: "api" | "manual"; keyId?: string; userId?: string }): Promise<ProcessResult> {
  const log = (v: { messageType: string; controlId: string; status: string; error?: string; result?: Record<string, unknown> }) =>
    db.insert(integrationMessages).values({ practiceId, keyId: opts.keyId ?? null, source: opts.source, raw: raw.slice(0, 200_000), error: v.error ?? null, result: v.result ?? null, ...v });

  let msg: Hl7Message;
  try {
    msg = parseHl7(raw);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unreadable message";
    await log({ messageType: "unknown", controlId: "", status: "error", error: message });
    return { status: "error", ack: buildAck(null, "AR", message), message };
  }
  const messageType = `${msg.type}^${msg.event}`;
  if (!msg.controlId) {
    await log({ messageType, controlId: "", status: "error", error: "MSH-10 (message control ID) is required" });
    return { status: "error", ack: buildAck(msg, "AR", "MSH-10 (message control ID) is required"), message: "MSH-10 is required" };
  }
  const [dup] = await db
    .select({ id: integrationMessages.id })
    .from(integrationMessages)
    .where(and(eq(integrationMessages.practiceId, practiceId), eq(integrationMessages.controlId, msg.controlId), eq(integrationMessages.status, "processed")))
    .limit(1);
  if (dup) {
    await log({ messageType, controlId: msg.controlId, status: "duplicate" });
    return { status: "duplicate", ack: buildAck(msg, "AA", "Already processed"), message: "Already processed; not applied again" };
  }
  try {
    const { message, result } = await applyMessage(db, practiceId, msg, opts.userId);
    await log({ messageType, controlId: msg.controlId, status: "processed", result: { ...result, message } });
    return { status: "processed", ack: buildAck(msg, "AA", message), message, result };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Processing failed";
    await log({ messageType, controlId: msg.controlId, status: "error", error: message });
    return { status: "error", ack: buildAck(msg, e instanceof UnsupportedError ? "AR" : "AE", message), message };
  }
}

/** Message counts for the integration page. */
export async function messageStats(db: Db, practiceId: string) {
  const rows = await db
    .select({ status: integrationMessages.status, n: sql<number>`count(*)::int` })
    .from(integrationMessages)
    .where(and(eq(integrationMessages.practiceId, practiceId), sql`${integrationMessages.receivedAt} > now() - interval '30 days'`))
    .groupBy(integrationMessages.status);
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)])) as Record<string, number>;
}

