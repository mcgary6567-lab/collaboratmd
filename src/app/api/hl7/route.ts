import { getDb } from "@/db";
import { authenticateKey, processHl7 } from "@/server/hl7";

export const dynamic = "force-dynamic";

const MAX_BYTES = 1_000_000;
const HL7_TYPE = "application/hl7-v2; charset=utf-8";

/**
 * HL7 v2 over HTTP. The interface engine POSTs one message per request with
 * `Authorization: Bearer <integration key>` and gets the HL7 ACK back as the
 * body: AA applied, AE fix and resend, AR not accepted. Transport errors (no
 * key, too large) are plain HTTP errors because there is no message to
 * acknowledge. MLLP over TCP is not offered; engines such as Mirth or Rhapsody
 * forward MLLP to an HTTP destination.
 */
export async function POST(req: Request) {
  const db = await getDb();
  const key = await authenticateKey(db, req.headers.get("authorization"));
  if (!key) return new Response("Missing or invalid integration key\n", { status: 401, headers: { "WWW-Authenticate": "Bearer" } });

  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_BYTES) return new Response("Message too large\n", { status: 413 });
  const raw = await req.text();
  if (raw.length > MAX_BYTES) return new Response("Message too large\n", { status: 413 });

  const r = await processHl7(db, key.practiceId, raw, { source: "api", keyId: key.id });
  return new Response(r.ack, { status: 200, headers: { "Content-Type": HL7_TYPE, "X-Collaboratmd-Status": r.status } });
}

export function GET() {
  return new Response("POST HL7 v2 messages here with an integration key.\n", { status: 405, headers: { Allow: "POST" } });
}
