/**
 * Texts and emails to patients.
 *
 * A text goes only to a patient who has consented to texts (TCPA); the
 * consent time is on the patient record. Email goes to the address on file.
 * Every attempt is logged, sent or not, so the practice can see what each
 * patient was told and when. Nothing clinical is ever put in a message: a
 * message says who it is from and links to a page that asks for the date of
 * birth before showing anything.
 *
 * SMS uses Twilio's REST API and email uses Resend, each with the keys the
 * practice connected in Settings → Integrations (or the deployment's
 * environment variables). Built from their API references and tested with
 * stubs, not against live accounts.
 */
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { sendEmail } from "./notify";
import { practiceConfig, type IntegrationConfig } from "./integrations";

type Http = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export const smsEnabled = (cfg: IntegrationConfig) => !!cfg.twilio;
export const emailEnabled = (cfg: IntegrationConfig) => !!cfg.resend;

/** US numbers to E.164 (+1XXXXXXXXXX); anything else is refused. */
export function toE164(phone: string | null | undefined): string | null {
  const d = (phone ?? "").replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return null;
}

export async function sendSms(twilio: NonNullable<IntegrationConfig["twilio"]>, to: string, body: string, http: Http = fetch as unknown as Http): Promise<{ ok: boolean; detail: string }> {
  const sid = twilio.accountSid;
  const res = await http(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${twilio.authToken}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, From: twilio.from, Body: body }).toString(),
  });
  const text = await res.text();
  if (!res.ok) return { ok: false, detail: `Twilio ${res.status}: ${text.slice(0, 200)}` };
  try {
    return { ok: true, detail: `sid ${(JSON.parse(text) as { sid?: string }).sid ?? ""}` };
  } catch {
    return { ok: true, detail: "sent" };
  }
}

export interface PatientContact {
  id: string;
  practiceId: string;
  firstName: string;
  phone: string | null;
  email: string | null;
  smsConsentAt: Date | null;
  remindersOptOut: boolean;
}

export interface MessageResult {
  sms: "sent" | "failed" | "skipped";
  email: "sent" | "failed" | "skipped";
  reason?: string;
}

/**
 * Sends a message by text and/or email, whichever the patient can receive.
 * `reminder` messages respect the patient's opt-out; transactional ones
 * (a link the front desk chose to send) do not.
 */
export async function messagePatient(
  db: Db,
  p: PatientContact,
  m: { kind: string; entityId?: string | null; sms?: string; email?: { subject: string; text: string }; reminder?: boolean },
  deps: { sms?: (to: string, body: string) => Promise<{ ok: boolean; detail: string }>; email?: (to: string, subject: string, text: string) => Promise<boolean> } = {},
): Promise<MessageResult> {
  const cfg = await practiceConfig(db, p.practiceId);
  const sms = deps.sms ?? ((to: string, body: string) => sendSms(cfg.twilio!, to, body));
  const email = deps.email ?? ((to: string, subject: string, text: string) => sendEmail(to, subject, text, undefined, cfg.resend));
  const out: MessageResult = { sms: "skipped", email: "skipped" };
  const log = (channel: string, recipient: string, status: string, detail?: string) =>
    db.insert(schema.messageLog).values({ practiceId: p.practiceId, patientId: p.id, channel, kind: m.kind, recipient, entityId: m.entityId ?? null, status, detail: detail ?? null });
  if (m.reminder && p.remindersOptOut) return { ...out, reason: "Patient opted out of reminders" };

  const phone = toE164(p.phone);
  // A number that replied STOP gets nothing until it replies START (see sms-inbox.ts).
  const optedOut = phone ? (await db.select({ phone: schema.smsOptOuts.phone }).from(schema.smsOptOuts).where(and(eq(schema.smsOptOuts.practiceId, p.practiceId), eq(schema.smsOptOuts.phone, phone))).limit(1)).length > 0 : false;
  if (m.sms && phone && p.smsConsentAt && !optedOut && smsEnabled(cfg)) {
    const r = await sms(phone, m.sms);
    out.sms = r.ok ? "sent" : "failed";
    await log("sms", phone, out.sms, r.detail);
    // Into the texting inbox too, so a patient's reply lands under what they were sent.
    await db.insert(schema.smsMessages).values({ practiceId: p.practiceId, patientId: p.id, direction: "out", phone, body: m.sms, twilioSid: r.ok ? r.detail.replace(/^sid /, "") || null : null, status: r.ok ? "sent" : "failed", readAt: new Date() }).onConflictDoNothing();
  }
  if (m.email && p.email && emailEnabled(cfg)) {
    const ok = await email(p.email, m.email.subject, m.email.text);
    out.email = ok ? "sent" : "failed";
    await log("email", p.email, out.email);
  }
  if (out.sms === "skipped" && out.email === "skipped") {
    out.reason = !smsEnabled(cfg) && !emailEnabled(cfg)
      ? "Neither texting nor email is set up"
      : !p.email && !(phone && p.smsConsentAt)
        ? "No email on file and no consent to text"
        : "No channel available for this patient";
    await log(m.sms ? "sms" : "email", p.email ?? phone ?? "none", "skipped", out.reason);
  }
  return out;
}
