import { handleWebhook } from "./handle";

export const dynamic = "force-dynamic";

/**
 * The deployment-wide endpoint, for a Stripe account set with
 * STRIPE_WEBHOOK_SECRET. A practice that connects its own Stripe account in
 * Settings → Integrations uses /api/stripe/webhook/<practice id> instead.
 */
export async function POST(req: Request) {
  return handleWebhook(req, process.env.STRIPE_WEBHOOK_SECRET?.trim());
}
