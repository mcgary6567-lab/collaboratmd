import { getDb } from "@/db";
import { siteOrigin } from "@/lib/origin";
import { spMetadata } from "@/server/saml";
import { getSso } from "@/server/sso";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Our service provider metadata, for the identity provider to import. */
export async function GET(_req: Request, { params }: { params: Promise<{ practiceId: string }> }) {
  const { practiceId } = await params;
  if (!UUID.test(practiceId)) return new Response("Not found", { status: 404 });
  const db = await getDb();
  const cfg = await getSso(db, practiceId);
  if (!cfg || cfg.protocol !== "saml") return new Response("SAML is not set up for this practice", { status: 404 });
  return new Response(spMetadata(db, cfg, await siteOrigin()), { headers: { "Content-Type": "application/samlmetadata+xml" } });
}
