import { SignJWT } from "jose";
import { cookies } from "next/headers";
import { getDb } from "@/db";
import { appSecret } from "@/lib/app-secret";
import { siteOrigin } from "@/lib/origin";
import { beginSso, SSO_AUDIENCE, SSO_COOKIE, ssoForEmail } from "@/server/sso";
import { samlLoginUrl } from "@/server/saml";

export const dynamic = "force-dynamic";

const back = (origin: string, error: string) => Response.redirect(`${origin}/login/sso?error=${encodeURIComponent(error)}`, 303);

/** Sends the browser to the practice's identity provider for this email address. */
export async function GET(req: Request) {
  const origin = await siteOrigin();
  const email = new URL(req.url).searchParams.get("email")?.trim().toLowerCase() ?? "";
  const cfg = email.includes("@") ? await ssoForEmail(await getDb(), email) : null;
  if (!cfg) return back(origin, "Single sign-on is not set up for that email domain. Sign in with your password, or ask your administrator.");
  try {
    if (cfg.protocol === "saml") return Response.redirect(await samlLoginUrl(await getDb(), cfg, origin, email), 303);
    const { url, pending } = await beginSso(cfg, `${origin}/api/sso/callback`, email);
    const token = await new SignJWT(pending).setProtectedHeader({ alg: "HS256" }).setAudience(SSO_AUDIENCE).setIssuedAt().setExpirationTime("10m").sign(appSecret());
    (await cookies()).set(SSO_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/api/sso", maxAge: 600 });
    return Response.redirect(url, 303);
  } catch (e) {
    return back(origin, e instanceof Error ? e.message : "Could not reach the identity provider");
  }
}
