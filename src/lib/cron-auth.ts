import { timingSafeEqual } from "node:crypto";

/**
 * The scheduled routes (/api/cron/*) run only with `Authorization: Bearer
 * <CRON_SECRET>`. Without CRON_SECRET set they do not run at all, so nobody
 * can trigger patient messages by guessing the URL. Returns the response to
 * send when the request may not run, or null when it may.
 */
export function cronRefusal(req: Request): Response | null {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return new Response("CRON_SECRET is not set", { status: 503 });
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return new Response("Unauthorized", { status: 401 });
  return null;
}
