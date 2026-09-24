import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { signingKey } from "@/lib/auth";

/**
 * After a patient confirms their date of birth, this cookie proves it for the
 * rest of the check-in. It names one link, lasts thirty minutes, is sent only
 * to /check-in, and is signed for its own audience so it can never be taken
 * for a staff session (and a staff session never for it).
 */
const COOKIE = "collaboratmd_checkin";
const AUDIENCE = "collaboratmd:checkin";
const MINUTES = 30;

export async function grantCheckin(linkId: string) {
  const token = await new SignJWT({ linkId })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${MINUTES}m`)
    .sign(signingKey());
  const jar = await cookies();
  jar.set(COOKIE, token, { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/check-in", maxAge: MINUTES * 60 });
}

/** The link this browser has verified, if it is `linkId`. */
export async function verifiedFor(linkId: string): Promise<boolean> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, signingKey(), { audience: AUDIENCE });
    return payload.linkId === linkId;
  } catch {
    return false;
  }
}

export async function endCheckin() {
  const jar = await cookies();
  jar.delete({ name: COOKIE, path: "/check-in" });
}
