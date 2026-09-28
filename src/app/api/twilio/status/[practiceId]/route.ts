import { recordDelivery } from "@/server/sms-delivery";
import { verifiedTwilioRequest } from "@/server/twilio-webhook";

export const dynamic = "force-dynamic";

/**
 * Twilio's delivery report for a text the practice sent (the StatusCallback
 * given with each message, server/messaging.ts). Signature checked in
 * server/twilio-webhook.ts.
 */
export async function POST(req: Request, { params }: { params: Promise<{ practiceId: string }> }) {
  const r0 = await verifiedTwilioRequest(req, (await params).practiceId);
  if (r0 instanceof Response) return r0;
  await recordDelivery(r0.db, r0.practiceId, { sid: r0.fields.MessageSid ?? "", status: r0.fields.MessageStatus ?? "", errorCode: r0.fields.ErrorCode || null });
  return new Response(null, { status: 204 });
}
