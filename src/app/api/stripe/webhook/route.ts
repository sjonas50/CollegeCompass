import { getDb } from "@/db";
import { env } from "@/env";
import { getStripe } from "@/lib/billing/stripe";
import { handleStripeWebhook } from "@/lib/billing/webhook";

/**
 * Stripe webhooks: subscription changes and finished Checkout sessions. The signature is checked
 * against the raw body with STRIPE_WEBHOOK_SECRET, and each event is applied once.
 */
export async function POST(req: Request) {
  const stripe = getStripe();
  const secret = env().STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) return Response.json({ received: false, error: "Billing isn't set up" }, { status: 503 });

  // The raw text, exactly as sent: parsing and re-serializing would break the signature.
  const rawBody = await req.text();
  const result = await handleStripeWebhook(await getDb(), stripe, rawBody, req.headers.get("stripe-signature"), secret);
  return Response.json(result.body, { status: result.status });
}
