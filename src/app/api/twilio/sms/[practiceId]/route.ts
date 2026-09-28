import { receiveSms } from "@/server/sms-inbox";
import { verifiedTwilioRequest } from "@/server/twilio-webhook";

export const dynamic = "force-dynamic";

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

/** Twilio's "A message comes in" webhook, one per practice (signature checked in server/twilio-webhook.ts). */
export async function POST(req: Request, { params }: { params: Promise<{ practiceId: string }> }) {
  const r0 = await verifiedTwilioRequest(req, (await params).practiceId);
  if (r0 instanceof Response) return r0;
  const r = await receiveSms(r0.db, r0.practiceId, r0.fields);
  // A reply to C, X or B (confirm, cancel, or take a waitlist opening) goes back in Twilio's answer.
  const twiml = r.stored && r.reply ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${xml(r.reply.text)}</Message></Response>` : EMPTY_TWIML;
  return new Response(twiml, { headers: { "Content-Type": "text/xml" } });
}

const xml = (v: string) => v.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);
