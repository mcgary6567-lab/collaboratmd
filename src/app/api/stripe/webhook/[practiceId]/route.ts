import { getDb } from "@/db";
import { practiceConfig } from "@/server/integrations";
import { handleWebhook } from "../handle";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One endpoint per practice, verified with the signing secret that practice saved. */
export async function POST(req: Request, { params }: { params: Promise<{ practiceId: string }> }) {
  const { practiceId } = await params;
  if (!UUID.test(practiceId)) return new Response("Not found", { status: 404 });
  const db = await getDb();
  const cfg = await practiceConfig(db, practiceId);
  return handleWebhook(req, cfg.stripe?.webhookSecret, practiceId);
}
