/**
 * What Twilio's webhooks (a text arriving, a delivery report) have in common:
 * the practice in the path, a valid X-Twilio-Signature made with that
 * practice's auth token, and the right account. Twilio signs the URL it was
 * given, so both the address the request arrived at and the site's configured
 * address are accepted.
 */
import { getDb, type Db } from "@/db";
import { configuredOrigin } from "@/lib/configured-origin";
import { practiceConfig, type IntegrationConfig } from "./integrations";
import { verifyTwilioSignature } from "./sms-inbox";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TwilioRequest = { db: Db; practiceId: string; twilio: NonNullable<IntegrationConfig["twilio"]>; fields: Record<string, string> };

export async function verifiedTwilioRequest(req: Request, practiceId: string): Promise<TwilioRequest | Response> {
  if (!UUID.test(practiceId)) return new Response("Not found", { status: 404 });
  const db = await getDb();
  const twilio = (await practiceConfig(db, practiceId)).twilio;
  if (!twilio) return new Response("Texting is not connected for this practice", { status: 404 });
  const form = await req.formData();
  const fields: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") fields[k] = v;
  const url = new URL(req.url);
  const origin = configuredOrigin();
  const signature = req.headers.get("x-twilio-signature");
  const valid = [req.url, origin ? origin + url.pathname + url.search : ""].some((u) => u && verifyTwilioSignature(twilio.authToken, u, fields, signature));
  if (!valid) return new Response("Invalid signature", { status: 403 });
  if (fields.AccountSid && fields.AccountSid !== twilio.accountSid) return new Response("Wrong account", { status: 403 });
  return { db, practiceId, twilio, fields };
}
