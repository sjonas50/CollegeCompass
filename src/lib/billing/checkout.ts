import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { billingAccounts, users } from "@/db/schema";
import { env } from "@/env";
import { subscriptionGrantsAccess } from "../access/entitlement";
import { audit } from "../audit";
import { BILLING_PATH } from "../access/describe";
import { type Plan, priceIdFor } from "./plans";
import { type Stripe, errorName, isMissingResource } from "./stripe";
import { type SyncResult, syncCustomer } from "./subscriptions";

/** Only parents manage billing, and only for their own household. */
async function parentHousehold(db: Db, parentUserId: string): Promise<string | null> {
  const [parent] = await db
    .select({ householdId: users.householdId })
    .from(users)
    .where(and(eq(users.id, parentUserId), eq(users.role, "parent")));
  return parent?.householdId ?? null;
}

async function billingAccountFor(db: Db, householdId: string) {
  const [row] = await db.select().from(billingAccounts).where(eq(billingAccounts.householdId, householdId));
  return row ?? null;
}

/**
 * The household's Stripe customer, created on first use. It carries only the household id: no
 * names or emails (Checkout asks the parent for what Stripe needs).
 */
export async function ensureCustomer(db: Db, stripe: Stripe, householdId: string): Promise<string> {
  const existing = await billingAccountFor(db, householdId);
  if (existing) return existing.stripeCustomerId;
  // The idempotency key makes a double click (or a retried request) reuse one customer.
  const customer = await stripe.customers.create({ metadata: { householdId } }, { idempotencyKey: `household-customer-${householdId}` });
  const inserted = await db
    .insert(billingAccounts)
    .values({ householdId, stripeCustomerId: customer.id })
    .onConflictDoNothing()
    .returning({ stripeCustomerId: billingAccounts.stripeCustomerId });
  if (inserted.length) return inserted[0].stripeCustomerId;
  const stored = await billingAccountFor(db, householdId);
  if (!stored) throw new Error("Billing account missing after insert");
  if (stored.stripeCustomerId !== customer.id) await deleteStripeCustomer(stripe, customer.id);
  return stored.stripeCustomerId;
}

export type CheckoutResult =
  | { ok: true; url: string }
  | { ok: false; error: "not_parent" | "plan_unavailable" | "already_subscribed" };

/**
 * Starts Stripe Checkout (subscription mode) for a parent's household. The session and the
 * subscription carry the household id (client_reference_id and metadata), so the webhook can tie
 * them back even if our customer record were missing.
 */
export async function startCheckout(db: Db, stripe: Stripe, parentUserId: string, plan: Plan): Promise<CheckoutResult> {
  const householdId = await parentHousehold(db, parentUserId);
  if (!householdId) return { ok: false, error: "not_parent" };
  const price = priceIdFor(plan);
  if (!price) return { ok: false, error: "plan_unavailable" };
  const existing = await billingAccountFor(db, householdId);
  // One plan per household: changes go through the Customer Portal.
  if (existing && subscriptionGrantsAccess(existing.status)) return { ok: false, error: "already_subscribed" };

  const customer = await ensureCustomer(db, stripe, householdId);
  const appUrl = env().APP_URL;
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: householdId,
    metadata: { householdId },
    subscription_data: { metadata: { householdId } },
    line_items: [{ price, quantity: 1 }],
    success_url: `${new URL(`${BILLING_PATH}/success`, appUrl)}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: new URL(`${BILLING_PATH}/canceled`, appUrl).toString(),
  });
  if (!session.url) throw new Error("Checkout session has no URL");
  await audit(db, "billing.checkout_started", { actorUserId: parentUserId, metadata: { plan } });
  return { ok: true, url: session.url };
}

/** The Stripe Customer Portal, where a parent changes plans, updates their card or cancels. */
export async function openBillingPortal(
  db: Db,
  stripe: Stripe,
  parentUserId: string,
): Promise<{ ok: true; url: string } | { ok: false; error: "not_parent" | "no_customer" }> {
  const householdId = await parentHousehold(db, parentUserId);
  if (!householdId) return { ok: false, error: "not_parent" };
  const account = await billingAccountFor(db, householdId);
  if (!account) return { ok: false, error: "no_customer" };
  const session = await stripe.billingPortal.sessions.create({
    customer: account.stripeCustomerId,
    return_url: new URL(BILLING_PATH, env().APP_URL).toString(),
  });
  return { ok: true, url: session.url };
}

const CHECKOUT_SESSION_ID = /^cs_[A-Za-z0-9_]{1,200}$/;

/**
 * After Checkout sends the parent back: reads the session from Stripe and updates the household
 * right away, so access doesn't wait for the webhook. Only the household that started the session
 * can use it.
 */
export async function syncCheckoutSession(
  db: Db,
  stripe: Stripe,
  parentUserId: string,
  sessionId: string,
): Promise<{ ok: true; sync: SyncResult } | { ok: false; error: "not_parent" | "not_found" }> {
  const householdId = await parentHousehold(db, parentUserId);
  if (!householdId) return { ok: false, error: "not_parent" };
  if (!CHECKOUT_SESSION_ID.test(sessionId)) return { ok: false, error: "not_found" };
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  const owner = session.client_reference_id ?? session.metadata?.householdId ?? null;
  const customerId = typeof session.customer === "string" ? session.customer : (session.customer?.id ?? null);
  if (owner !== householdId || !customerId || session.mode !== "subscription") return { ok: false, error: "not_found" };
  return { ok: true, sync: await syncCustomer(db, stripe, customerId, householdId) };
}

/**
 * Deletes a Stripe customer, which cancels its subscriptions right away. Never throws: a failure is
 * logged by error name only and reported as false.
 */
export async function deleteStripeCustomer(stripe: Stripe, customerId: string): Promise<boolean> {
  try {
    await stripe.customers.del(customerId);
    return true;
  } catch (error) {
    // Already gone (deleted in the Stripe dashboard, say): nothing left to cancel.
    if (isMissingResource(error)) return true;
    console.error("[billing] couldn't delete a Stripe customer", errorName(error));
    return false;
  }
}
