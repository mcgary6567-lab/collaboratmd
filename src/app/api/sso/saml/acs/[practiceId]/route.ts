import { getDb } from "@/db";
import { startSsoSession } from "@/lib/auth";
import { siteOrigin } from "@/lib/origin";
import { completeSaml } from "@/server/saml";
import { getSso, ssoUser } from "@/server/sso";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The identity provider posts its SAMLResponse here (the assertion consumer service). */
export async function POST(req: Request, { params }: { params: Promise<{ practiceId: string }> }) {
  const origin = await siteOrigin();
  const back = (error: string) => Response.redirect(`${origin}/login/sso?error=${encodeURIComponent(error)}`, 303);
  const { practiceId } = await params;
  if (!UUID.test(practiceId)) return new Response("Not found", { status: 404 });
  const db = await getDb();
  const cfg = await getSso(db, practiceId);
  if (!cfg || cfg.protocol !== "saml") return back("SAML sign-in is not set up for this practice");
  const form = await req.formData();
  const samlResponse = form.get("SAMLResponse");
  if (typeof samlResponse !== "string" || !samlResponse) return back("The identity provider sent no sign-in response");
  try {
    const claims = await completeSaml(db, cfg, origin, samlResponse);
    const user = await ssoUser(db, cfg, claims);
    await startSsoSession(db, user, cfg.practiceId);
  } catch (e) {
    return back(e instanceof Error ? e.message : "SAML sign-in failed");
  }
  return Response.redirect(`${origin}/dashboard`, 303);
}
