import "server-only";
import { COMPANY } from "@/content/company";

/**
 * Outbound email for contact submissions.
 *
 * Two messages go out: an alert to the team so a submission is not discovered
 * by querying a table, and an acknowledgement to the sender so the response
 * time the site promises starts from something they can see.
 *
 * Sending is entirely optional. With no RESEND_API_KEY the functions log and
 * return, because the submission is already safely stored and failing the form
 * over a missing credential would lose the lead the email was meant to protect.
 * Set the key and delivery starts with no other change.
 *
 * Resend is called over plain HTTP rather than through its SDK: one POST does
 * not justify a dependency, and this keeps the serverless bundle small.
 */

const ENDPOINT = "https://api.resend.com/emails";

function config() {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    /** Must be a domain verified with the provider, or sending is rejected. */
    from: process.env.CONTACT_FROM_EMAIL?.trim() || `CollaboratMD <notifications@collaboratmd.com>`,
    to: process.env.CONTACT_TO_EMAIL?.trim() || COMPANY.contact.general,
  };
}

async function send(to: string, subject: string, text: string, replyTo?: string) {
  const c = config();
  if (!c) {
    console.warn(`[collaboratmd] email not sent (no RESEND_API_KEY): "${subject}" to ${to}`);
    return false;
  }
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${c.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: c.from, to, subject, text, reply_to: replyTo }),
    });
    if (!res.ok) {
      console.error(`[collaboratmd] email provider returned ${res.status}: ${await res.text()}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[collaboratmd] email send failed", err);
    return false;
  }
}

export type Submission = {
  reference: string;
  name: string;
  email: string;
  organization?: string | null;
  topic: string;
  message: string;
  fund?: string | null;
  stage?: string | null;
  checkSize?: string | null;
  source?: Record<string, string> | null;
};

/** Alerts the team. Investor submissions route to the investor mailbox. */
export async function notifyTeam(s: Submission) {
  const c = config();
  const to =
    s.topic === "investor"
      ? process.env.INVESTOR_TO_EMAIL?.trim() || COMPANY.contact.investors
      : c?.to || COMPANY.contact.general;

  const lines = [
    `Reference: ${s.reference}`,
    `Topic:     ${s.topic}`,
    `Name:      ${s.name}`,
    `Email:     ${s.email}`,
    s.organization ? `Company:   ${s.organization}` : null,
    s.fund ? `Fund:      ${s.fund}` : null,
    s.stage ? `Stage:     ${s.stage}` : null,
    s.checkSize ? `Check:     ${s.checkSize}` : null,
    s.source && Object.keys(s.source).length
      ? `Campaign:  ${Object.entries(s.source).map(([k, v]) => `${k}=${v}`).join(" ")}`
      : null,
    "",
    s.message,
  ].filter(Boolean);

  return send(to, `[${s.topic}] ${s.name} — ${s.reference}`, lines.join("\n"), s.email);
}

/** Acknowledges the sender, so the clock the site promises visibly starts. */
export async function acknowledge(s: Submission) {
  const body = [
    `Hi ${s.name.split(" ")[0]},`,
    "",
    "Thank you for getting in touch with CollaboratMD. Your message is logged and",
    `we will reply shortly. Your reference is ${s.reference}.`,
    "",
    s.topic === "investor"
      ? "We will follow up with the data room and a time to talk."
      : "If anything changes in the meantime, reply to this email and it reaches the same queue.",
    "",
    "— CollaboratMD",
    `${COMPANY.address.street}, ${COMPANY.address.city}, ${COMPANY.address.state} ${COMPANY.address.zip}`,
  ].join("\n");

  return send(s.email, `We have your message (${s.reference})`, body);
}
