import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { signingKey } from "@/lib/auth";

/**
 * After a patient confirms their date of birth on a portal link, this
 * cookie proves it for 30 minutes. It names one link, is sent only to
 * /portal, and is signed for its own audience, so it is neither a staff
 * session nor a check-in session.
 */
const COOKIE = "collaboratmd_portal";
const AUDIENCE = "collaboratmd:portal";
const MINUTES = 30;

export async function grantPortal(linkId: string) {
  const token = await new SignJWT({ linkId }).setProtectedHeader({ alg: "HS256" }).setAudience(AUDIENCE).setIssuedAt().setExpirationTime(`${MINUTES}m`).sign(signingKey());
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/portal", maxAge: MINUTES * 60 });
}

export async function portalVerifiedFor(linkId: string): Promise<boolean> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, signingKey(), { audience: AUDIENCE });
    return payload.linkId === linkId;
  } catch {
    return false;
  }
}
