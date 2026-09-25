import "server-only";
import { headers } from "next/headers";

/**
 * The site's own address, for links sent to patients and for payment
 * return URLs. APP_URL decides; then Vercel's production domain; the
 * request's host only in development, because a forged Host header must
 * never choose the domain in a message sent to a patient.
 */
export async function siteOrigin(): Promise<string> {
  const configured = process.env.APP_URL?.trim().replace(/\/$/, "");
  if (configured) return configured;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.NODE_ENV === "production") throw new Error("Set APP_URL to the site's address before sending patient links");
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  return `${host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https"}://${host}`;
}
