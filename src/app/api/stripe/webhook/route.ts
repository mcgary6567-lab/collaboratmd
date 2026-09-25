import { getDb } from "@/db";
import { verifyWebhook } from "@/lib/stripe";
import { handleStripeEvent } from "@/server/portal";

export const dynamic = "force-dynamic";

/**
 * Stripe calls this when a payment completes. The signature is checked
 * against STRIPE_WEBHOOK_SECRET over the raw body before anything is read,
 * and posting is idempotent, so Stripe's retries are harmless.
 */
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) return new Response("Webhook not configured", { status: 503 });
  const raw = await req.text();
  let event;
  try {
    event = verifyWebhook(raw, req.headers.get("stripe-signature"), secret);
  } catch (e) {
    return new Response(e instanceof Error ? e.message : "Bad signature", { status: 400 });
  }
  try {
    const db = await getDb();
    const r = await handleStripeEvent(db, event);
    return Response.json({ received: true, ...r });
  } catch (e) {
    console.error("[collaboratmd] stripe webhook failed", e);
    // A 500 makes Stripe retry, which is what we want for a transient failure.
    return new Response("Processing failed", { status: 500 });
  }
}
