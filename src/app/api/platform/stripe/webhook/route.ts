import { getDb } from "@/db";
import { verifyWebhook } from "@/lib/stripe";
import { handlePlatformEvent } from "@/server/subscription";

export const dynamic = "force-dynamic";

/**
 * CollaboratMD's own Stripe account (subscriptions), signed with
 * PLATFORM_STRIPE_WEBHOOK_SECRET. Send it checkout.session.completed and
 * customer.subscription.created/updated/deleted.
 */
export async function POST(req: Request) {
  const secret = process.env.PLATFORM_STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) return new Response("Webhook not configured", { status: 503 });
  const raw = await req.text();
  let event;
  try {
    event = verifyWebhook(raw, req.headers.get("stripe-signature"), secret);
  } catch (e) {
    return new Response(e instanceof Error ? e.message : "Bad signature", { status: 400 });
  }
  try {
    return Response.json({ received: true, ...(await handlePlatformEvent(await getDb(), event)) });
  } catch (e) {
    console.error("[collaboratmd] platform webhook failed", e);
    return new Response("Processing failed", { status: 500 });
  }
}
