import { getDb } from "@/db";
import { practiceConfig } from "@/server/integrations";
import { receiveSms, verifyTwilioSignature } from "@/server/sms-inbox";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

/**
 * Twilio's "A message comes in" webhook, one per practice. The request must
 * carry a valid X-Twilio-Signature made with that practice's auth token.
 * Twilio signs the URL it was configured with, so both the address the
 * request arrived at and the site's configured address are accepted.
 */
export async function POST(req: Request, { params }: { params: Promise<{ practiceId: string }> }) {
  const { practiceId } = await params;
  if (!UUID.test(practiceId)) return new Response("Not found", { status: 404 });
  const db = await getDb();
  const twilio = (await practiceConfig(db, practiceId)).twilio;
  if (!twilio) return new Response("Texting is not connected for this practice", { status: 404 });

  const form = await req.formData();
  const fields: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") fields[k] = v;
  const url = new URL(req.url);
  const configured = (process.env.APP_URL?.trim().replace(/\/$/, "") || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "")) + url.pathname + url.search;
  const signature = req.headers.get("x-twilio-signature");
  const valid = [req.url, configured].some((u) => u && verifyTwilioSignature(twilio.authToken, u, fields, signature));
  if (!valid) return new Response("Invalid signature", { status: 403 });
  if (fields.AccountSid && fields.AccountSid !== twilio.accountSid) return new Response("Wrong account", { status: 403 });

  await receiveSms(db, practiceId, fields);
  return new Response(EMPTY_TWIML, { headers: { "Content-Type": "text/xml" } });
}
