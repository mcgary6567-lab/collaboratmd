/**
 * Two-way texting. Patients' replies arrive from Twilio at a webhook per
 * practice, are matched to the patient by phone number, and sit in a shared
 * inbox the front desk answers from.
 *
 * Opt-out words (STOP and its synonyms) withdraw the patient's texting
 * consent and block further texts to that number until they reply START.
 * Carriers and Twilio enforce the same keywords; recording them here keeps
 * this system from trying to text someone who has said no.
 */
import crypto from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import type { IntegrationConfig } from "./integrations";
import { sendSms, toE164 } from "./messaging";

const { smsMessages, smsOptOuts, patients, auditLog } = schema;

export const STOP_WORDS = ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "REVOKE", "OPTOUT"];
export const START_WORDS = ["START", "UNSTOP", "YES"];

/**
 * Twilio's request signature: HMAC-SHA1 with the account's auth token over the
 * full URL Twilio called followed by each POST parameter's name and value,
 * sorted by name; base64-encoded in X-Twilio-Signature.
 */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>) {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  return crypto.createHmac("sha1", authToken).update(data, "utf8").digest("base64");
}

export function verifyTwilioSignature(authToken: string, url: string, params: Record<string, string>, signature: string | null) {
  if (!signature) return false;
  const expected = Buffer.from(twilioSignature(authToken, url, params));
  const given = Buffer.from(signature);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

/** Patients in this practice whose phone on file is this number. */
async function patientsWithPhone(db: Db, practiceId: string, e164: string) {
  const ten = e164.replace(/^\+1/, "");
  return db
    .select({ id: patients.id, firstName: patients.firstName, lastName: patients.lastName })
    .from(patients)
    .where(and(eq(patients.practiceId, practiceId), sql`right(regexp_replace(coalesce(${patients.phone}, ''), '\\D', '', 'g'), 10) = ${ten}`))
    .limit(5);
}

export async function isOptedOut(db: Db, practiceId: string, phone: string) {
  const [row] = await db.select().from(smsOptOuts).where(and(eq(smsOptOuts.practiceId, practiceId), eq(smsOptOuts.phone, phone))).limit(1);
  return !!row;
}

/** Records an inbound text (idempotent on Twilio's MessageSid) and applies STOP/START. */
export async function receiveSms(db: Db, practiceId: string, params: Record<string, string>) {
  const phone = toE164(params.From);
  const body = (params.Body ?? "").slice(0, 1600);
  if (!phone) return { stored: false as const, reason: "unreadable number" };
  const matches = await patientsWithPhone(db, practiceId, phone);
  const patientId = matches.length === 1 ? matches[0].id : null;
  const [row] = await db
    .insert(smsMessages)
    .values({ practiceId, patientId, direction: "in", phone, body, twilioSid: params.MessageSid || null, status: "received" })
    .onConflictDoNothing()
    .returning();
  if (!row) return { stored: false as const, reason: "duplicate" };

  const word = body.trim().toUpperCase().replace(/[^A-Z]/g, "");
  let keyword: "stop" | "start" | null = null;
  if (STOP_WORDS.includes(word)) {
    keyword = "stop";
    await db.insert(smsOptOuts).values({ practiceId, phone }).onConflictDoNothing();
    for (const m of matches) await db.update(patients).set({ smsConsentAt: null }).where(eq(patients.id, m.id));
  } else if (START_WORDS.includes(word) && (await isOptedOut(db, practiceId, phone))) {
    keyword = "start";
    await db.delete(smsOptOuts).where(and(eq(smsOptOuts.practiceId, practiceId), eq(smsOptOuts.phone, phone)));
    for (const m of matches) await db.update(patients).set({ smsConsentAt: new Date() }).where(eq(patients.id, m.id));
  }
  if (keyword) {
    await db.insert(auditLog).values({ practiceId, action: keyword === "stop" ? "sms_opt_out" : "sms_opt_in", entity: "sms", entityId: row.id, details: { patients: matches.length } });
  }
  return { stored: true as const, id: row.id, patientId, matches: matches.length, keyword };
}

export type Thread = { phone: string; patientId: string | null; patientName: string | null; lastBody: string; lastAt: Date; lastDirection: string; unread: number; optedOut: boolean };

export async function listThreads(db: Db, practiceId: string): Promise<Thread[]> {
  const { rows } = await db.execute<{ phone: string; patient_id: string | null; first_name: string | null; last_name: string | null; body: string; created_at: string; direction: string; unread: string; opted_out: boolean }>(sql`
    SELECT DISTINCT ON (m.phone) m.phone, t.patient_id, p.first_name, p.last_name, m.body, m.created_at, m.direction,
      (SELECT count(*) FROM sms_messages u WHERE u.practice_id = m.practice_id AND u.phone = m.phone AND u.direction = 'in' AND u.read_at IS NULL)::text AS unread,
      EXISTS (SELECT 1 FROM sms_opt_outs o WHERE o.practice_id = m.practice_id AND o.phone = m.phone) AS opted_out
    FROM sms_messages m
    LEFT JOIN LATERAL (SELECT patient_id FROM sms_messages x WHERE x.practice_id = m.practice_id AND x.phone = m.phone AND x.patient_id IS NOT NULL ORDER BY x.created_at DESC LIMIT 1) t ON true
    LEFT JOIN patients p ON p.id = t.patient_id
    WHERE m.practice_id = ${practiceId}
    ORDER BY m.phone, m.created_at DESC`);
  return rows
    .map((r) => ({ phone: r.phone, patientId: r.patient_id, patientName: r.last_name ? `${r.last_name}, ${r.first_name}` : null, lastBody: r.body, lastAt: new Date(r.created_at), lastDirection: r.direction, unread: Number(r.unread), optedOut: !!r.opted_out }))
    .sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime());
}

export async function unreadCount(db: Db, practiceId: string) {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(smsMessages).where(and(eq(smsMessages.practiceId, practiceId), eq(smsMessages.direction, "in"), isNull(smsMessages.readAt)));
  return Number(r?.n ?? 0);
}

/** A conversation, oldest first. Opening it marks the patient's texts read. */
export async function openThread(db: Db, practiceId: string, phone: string) {
  const e164 = toE164(phone);
  if (!e164) throw new Error("Not a US phone number");
  await db.update(smsMessages).set({ readAt: new Date() }).where(and(eq(smsMessages.practiceId, practiceId), eq(smsMessages.phone, e164), eq(smsMessages.direction, "in"), isNull(smsMessages.readAt)));
  const messages = await db.select().from(smsMessages).where(and(eq(smsMessages.practiceId, practiceId), eq(smsMessages.phone, e164))).orderBy(asc(smsMessages.createdAt)).limit(500);
  const candidates = await patientsWithPhone(db, practiceId, e164);
  return { phone: e164, messages, candidates, optedOut: await isOptedOut(db, practiceId, e164) };
}

/** Links a thread to the right patient when a number is shared (a family phone). */
export async function linkThread(db: Db, practiceId: string, phone: string, patientId: string) {
  const e164 = toE164(phone);
  const [p] = await db.select({ id: patients.id }).from(patients).where(and(eq(patients.id, patientId), eq(patients.practiceId, practiceId))).limit(1);
  if (!e164 || !p) throw new Error("Patient not found");
  await db.update(smsMessages).set({ patientId }).where(and(eq(smsMessages.practiceId, practiceId), eq(smsMessages.phone, e164)));
}

/**
 * Replies from the inbox. Allowed when the patient has consented to texts or
 * wrote to the practice first (answering a patient's own text), and never to
 * a number that replied STOP.
 */
export async function replySms(db: Db, practiceId: string, cfg: IntegrationConfig, phone: string, body: string, userId?: string, send = sendSms) {
  const e164 = toE164(phone);
  if (!e164) throw new Error("Not a US phone number");
  const text = body.trim();
  if (!text) throw new Error("Type a message");
  if (text.length > 1600) throw new Error("Keep it under 1,600 characters");
  if (!cfg.twilio) throw new Error("Texting is not connected. Add Twilio under Settings, Integrations.");
  if (await isOptedOut(db, practiceId, e164)) throw new Error("This number replied STOP. It can be texted again only after it replies START.");
  const [lastIn] = await db.select({ id: smsMessages.id }).from(smsMessages).where(and(eq(smsMessages.practiceId, practiceId), eq(smsMessages.phone, e164), eq(smsMessages.direction, "in"))).orderBy(desc(smsMessages.createdAt)).limit(1);
  const candidates = await patientsWithPhone(db, practiceId, e164);
  const consented = candidates.length ? (await db.select({ c: patients.smsConsentAt }).from(patients).where(and(eq(patients.practiceId, practiceId), inArray(patients.id, candidates.map((c) => c.id))))).some((r) => r.c) : false;
  if (!lastIn && !consented) throw new Error("No texting consent on file and the patient has not texted in. Record consent on the patient's page first.");
  const r = await send(cfg.twilio, e164, text);
  const sid = r.ok ? r.detail.replace(/^sid /, "") || null : null;
  const [row] = await db.insert(smsMessages).values({
    practiceId, patientId: candidates.length === 1 ? candidates[0].id : null, direction: "out", phone: e164, body: text, twilioSid: sid, status: r.ok ? "sent" : "failed", userId: userId ?? null, readAt: new Date(),
  }).returning();
  if (!r.ok) throw new Error(`Not sent: ${r.detail}`);
  return row;
}

