import { SignJWT } from "jose";
import { cookies } from "next/headers";
import { getDb } from "@/db";
import { appSecret } from "@/lib/app-secret";
import { getSession } from "@/lib/auth";
import { siteOrigin } from "@/lib/origin";
import { beginSso, SAFE_NEXT, SSO_AUDIENCE, SSO_COOKIE, ssoForEmail } from "@/server/sso";
import { samlLoginUrl } from "@/server/saml";

export const dynamic = "force-dynamic";

const back = (origin: string, error: string) => Response.redirect(`${origin}/login/sso?error=${encodeURIComponent(error)}`, 303);

/**
 * Sends the browser to the practice's identity provider for this email address.
 * With `reauth=1` (from a restricted record, server/reauth.ts) it is for the
 * person already signed in, the provider is asked to check their credentials
 * again, and the browser comes back to `next`, a restricted-record screen.
 */
export async function GET(req: Request) {
  const origin = await siteOrigin();
  const params = new URL(req.url).searchParams;
  const reauth = params.get("reauth") === "1";
  const next = params.get("next") ?? "";
  // A fresh sign-in is for whoever is signed in now: their address, never one from the link.
  const email = reauth ? ((await getSession())?.email ?? "") : params.get("email")?.trim().toLowerCase() ?? "";
  if (reauth && (!email || !SAFE_NEXT.test(next))) return back(origin, "Sign in first, then open the record again.");
  const cfg = email.includes("@") ? await ssoForEmail(await getDb(), email) : null;
  if (!cfg) return back(origin, "Single sign-on is not set up for that email domain. Sign in with your password, or ask your administrator.");
  try {
    if (cfg.protocol === "saml") return Response.redirect(await samlLoginUrl(await getDb(), cfg, origin, email, reauth ? { reauth, next } : {}), 303);
    const { url, pending } = await beginSso(cfg, `${origin}/api/sso/callback`, email, undefined, reauth ? { reauth, next } : {});
    const token = await new SignJWT(pending).setProtectedHeader({ alg: "HS256" }).setAudience(SSO_AUDIENCE).setIssuedAt().setExpirationTime("10m").sign(appSecret());
    (await cookies()).set(SSO_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/api/sso", maxAge: 600 });
    return Response.redirect(url, 303);
  } catch (e) {
    return back(origin, e instanceof Error ? e.message : "Could not reach the identity provider");
  }
}
