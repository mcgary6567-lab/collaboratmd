import { getDb } from "@/db";
import { verifyWebhook } from "@/lib/stripe";
import { handleStripeEvent } from "@/server/portal";

/**
 * Checks the Stripe-Signature over the raw body with the endpoint's signing
 * secret before anything is read. Posting is idempotent, so Stripe's retries
 * are harmless; a 500 makes Stripe retry a transient failure.
 */
export async function handleWebhook(req: Request, secret: string | null | undefined, practiceId?: string) {
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
    const r = await handleStripeEvent(db, event, undefined, practiceId);
    return Response.json({ received: true, ...r });
  } catch (e) {
    console.error("[collaboratmd] stripe webhook failed", e);
    return new Response("Processing failed", { status: 500 });
  }
}
