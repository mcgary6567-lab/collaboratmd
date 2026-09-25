import { jwtVerify } from "jose";
import { cookies } from "next/headers";
import { getDb } from "@/db";
import { appSecret } from "@/lib/app-secret";
import { startSsoSession } from "@/lib/auth";
import { siteOrigin } from "@/lib/origin";
import { completeSso, getSso, SSO_AUDIENCE, SSO_COOKIE, ssoUser } from "@/server/sso";

export const dynamic = "force-dynamic";

/** The identity provider sends the browser back here with a code. */
export async function GET(req: Request) {
  const origin = await siteOrigin();
  const back = (error: string) => Response.redirect(`${origin}/login/sso?error=${encodeURIComponent(error)}`, 303);
  const params = new URL(req.url).searchParams;
  const jar = await cookies();
  const cookie = jar.get(SSO_COOKIE)?.value;
  jar.delete({ name: SSO_COOKIE, path: "/api/sso" });
  if (params.get("error")) return back(params.get("error_description") || `The identity provider said: ${params.get("error")}`);
  let pending: { practiceId: string; state: string; nonce: string; verifier: string };
  try {
    const { payload } = await jwtVerify(cookie ?? "", appSecret(), { audience: SSO_AUDIENCE });
    pending = payload as unknown as typeof pending;
  } catch {
    return back("The sign-in took too long or started in another browser. Try again.");
  }
  if (!params.get("code") || params.get("state") !== pending.state) return back("The sign-in response did not match this browser's request. Try again.");
  const db = await getDb();
  const cfg = await getSso(db, pending.practiceId);
  if (!cfg) return back("Single sign-on is no longer set up for this practice");
  try {
    const claims = await completeSso(cfg, params.get("code")!, `${origin}/api/sso/callback`, pending);
    const user = await ssoUser(db, cfg, claims);
    await startSsoSession(db, user, cfg.practiceId);
  } catch (e) {
    return back(e instanceof Error ? e.message : "Single sign-on failed");
  }
  return Response.redirect(`${origin}/dashboard`, 303);
}
