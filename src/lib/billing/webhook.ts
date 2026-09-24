import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { stripeEvents } from "@/db/schema";
import { type Stripe, errorName } from "./stripe";
import { syncCustomer } from "./subscriptions";

export type WebhookResponse = { status: number; body: { received: boolean; duplicate?: boolean; ignored?: boolean; error?: string } };

/** Events we act on; Stripe gets a 200 for everything else so it stops sending them. */
export const HANDLED_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
] as const;

const customerIdOf = (customer: string | { id: string } | null | undefined) =>
  typeof customer === "string" ? customer : (customer?.id ?? null);

async function applyEvent(db: Db, stripe: Stripe, event: Stripe.Event): Promise<boolean> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const customerId = customerIdOf(session.customer);
      if (session.mode !== "subscription" || !customerId) return false;
      await syncCustomer(db, stripe, customerId, session.client_reference_id ?? session.metadata?.householdId);
      return true;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object;
      const customerId = customerIdOf(sub.customer);
      if (!customerId) return false;
      await syncCustomer(db, stripe, customerId, sub.metadata?.householdId);
      return true;
    }
    default:
      return false;
  }
}

/**
 * Verifies a Stripe webhook (signature over the raw body) and applies it once: an event id already
 * in stripe_events is acknowledged without doing anything. The id is recorded only after the event
 * is applied, so if applying fails (or the function dies halfway) Stripe's retry applies it. Two
 * deliveries racing each other are harmless: applying an event re-reads Stripe's current state.
 */
export async function handleStripeWebhook(
  db: Db,
  stripe: Stripe,
  rawBody: string,
  signature: string | null,
  secret: string,
): Promise<WebhookResponse> {
  if (!signature) return { status: 400, body: { received: false, error: "Missing signature" } };
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch {
    return { status: 400, body: { received: false, error: "Invalid signature" } };
  }

  const [seen] = await db.select({ id: stripeEvents.id }).from(stripeEvents).where(eq(stripeEvents.id, event.id));
  if (seen) return { status: 200, body: { received: true, duplicate: true } };

  let handled: boolean;
  try {
    handled = await applyEvent(db, stripe, event);
  } catch (error) {
    console.error(`[billing] webhook ${event.type} failed`, errorName(error));
    return { status: 500, body: { received: false, error: "Processing failed" } };
  }
  await db.insert(stripeEvents).values({ id: event.id, type: event.type }).onConflictDoNothing();
  return { status: 200, body: handled ? { received: true } : { received: true, ignored: true } };
}
