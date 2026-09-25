import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@/db";
import { billingAccounts, users } from "@/db/schema";
import { env } from "@/env";
import { subscriptionGrantsAccess } from "../access/entitlement";
import { audit } from "../audit";
import { BILLING_PATH } from "../access/describe";
import { getHouseholdAccess } from "../access/service";
import { closeBillingWithoutParent, runOrQueueCleanup } from "./cleanup";
import { type Plan, priceIdFor } from "./plans";
import { type Stripe, isMissingResource } from "./stripe";
import { type SyncResult, syncCustomer } from "./subscriptions";

/** Only parents manage billing, and only for their own household. */
async function parentHousehold(db: Db, parentUserId: string): Promise<string | null> {
  const [parent] = await db
    .select({ householdId: users.householdId })
    .from(users)
    .where(and(eq(users.id, parentUserId), eq(users.role, "parent")));
  return parent?.householdId ?? null;
}

type BillingAccount = typeof billingAccounts.$inferSelect;

async function billingAccountFor(db: Db, householdId: string): Promise<BillingAccount | null> {
  const [row] = await db.select().from(billingAccounts).where(eq(billingAccounts.householdId, householdId));
  return row ?? null;
}

/** The household's only parent, or null when it has none (or, which doesn't happen today, two). */
async function soleParent(db: Db, householdId: string): Promise<string | null> {
  const parents = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.householdId, householdId), eq(users.role, "parent")))
    .limit(2);
  return parents.length === 1 ? parents[0].id : null;
}

/**
 * Whether `parentUserId` is the parent who pays through this billing account: the one whose card,
 * email and receipts the Stripe customer holds. Only they may open its portal or check out on it.
 *
 * Accounts made before payers were recorded have none. The household's only parent may claim such
 * an account when Stripe says the customer was made for this household: a parent never joins
 * another household, and a household has at most one parent, so that parent is the one who set it
 * up. (When a payer deletes their account their household has no parent left, so nobody can claim
 * it.) A customer that came here from another household is never claimed.
 */
async function isPayer(db: Db, stripe: Stripe, account: BillingAccount, parentUserId: string): Promise<boolean> {
  if (account.payerUserId !== null) return account.payerUserId === parentUserId;
  if ((await soleParent(db, account.householdId)) !== parentUserId) return false;
  let customer: Stripe.Customer | Stripe.DeletedCustomer;
  try {
    customer = await stripe.customers.retrieve(account.stripeCustomerId);
  } catch (error) {
    if (isMissingResource(error)) return false;
    throw error;
  }
  if (customer.deleted || customer.metadata?.householdId !== account.householdId) return false;
  await db
    .update(billingAccounts)
    .set({ payerUserId: parentUserId, updatedAt: new Date() })
    .where(and(eq(billingAccounts.householdId, account.householdId), isNull(billingAccounts.payerUserId)));
  return true;
}

/**
 * Whether the billing page offers this parent the Customer Portal: their household has a Stripe
 * customer and it's theirs, or it's an older account they may claim (openBillingPortal makes the
 * final check).
 */
export async function canManageBilling(db: Db, parentUserId: string): Promise<boolean> {
  const householdId = await parentHousehold(db, parentUserId);
  const account = householdId ? await billingAccountFor(db, householdId) : null;
  if (!householdId || !account) return false;
  if (account.payerUserId !== null) return account.payerUserId === parentUserId;
  return (await soleParent(db, householdId)) === parentUserId;
}

/**
 * The Stripe customer for a parent's household, created on first use with that parent as its
 * payer. It carries only the household id: no names or emails (Checkout asks the parent for what
 * Stripe needs). Returns null when the household's customer belongs to someone else: one adult's
 * card and receipts are never handed to another.
 */
export async function ensureCustomer(db: Db, stripe: Stripe, householdId: string, parentUserId: string): Promise<string | null> {
  const existing = await billingAccountFor(db, householdId);
  if (existing) return (await isPayer(db, stripe, existing, parentUserId)) ? existing.stripeCustomerId : null;
  // The idempotency key makes a double click (or a retried request) reuse one customer.
  const customer = await stripe.customers.create({ metadata: { householdId } }, { idempotencyKey: `household-customer-${householdId}` });
  const inserted = await db
    .insert(billingAccounts)
    .values({ householdId, stripeCustomerId: customer.id, payerUserId: parentUserId })
    .onConflictDoNothing()
    .returning({ stripeCustomerId: billingAccounts.stripeCustomerId });
  if (inserted.length) return inserted[0].stripeCustomerId;
  const stored = await billingAccountFor(db, householdId);
  if (!stored) throw new Error("Billing account missing after insert");
  if (stored.stripeCustomerId !== customer.id) {
    await runOrQueueCleanup(db, stripe, { action: "delete_customer", stripeCustomerId: customer.id });
  }
  return (await isPayer(db, stripe, stored, parentUserId)) ? stored.stripeCustomerId : null;
}

export type CheckoutResult =
  | { ok: true; url: string }
  | { ok: false; error: "not_parent" | "not_payer" | "plan_unavailable" | "already_subscribed" };

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

  const customer = await ensureCustomer(db, stripe, householdId, parentUserId);
  if (!customer) return { ok: false, error: "not_payer" };
  const appUrl = env().APP_URL;
  // Subscribing during the free trial keeps the days left: billing starts when the trial ends.
  // (Stripe needs a trial end at least 48 hours away.)
  const trial = (await getHouseholdAccess(db, householdId)).trial;
  const trialEnd =
    trial?.active && trial.endsAt && trial.endsAt.getTime() - Date.now() >= 48 * 60 * 60 * 1000
      ? Math.floor(trial.endsAt.getTime() / 1000)
      : undefined;
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: householdId,
    metadata: { householdId },
    subscription_data: { metadata: { householdId }, ...(trialEnd && { trial_end: trialEnd }) },
    line_items: [{ price, quantity: 1 }],
    success_url: `${new URL(`${BILLING_PATH}/success`, appUrl)}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: new URL(`${BILLING_PATH}/canceled`, appUrl).toString(),
  });
  if (!session.url) throw new Error("Checkout session has no URL");
  await audit(db, "billing.checkout_started", { actorUserId: parentUserId, metadata: { plan } });
  return { ok: true, url: session.url };
}

/**
 * The Stripe Customer Portal, where the parent who pays changes plans, updates their card or
 * cancels. It shows their card, billing address and receipts, so it opens only for them.
 */
export async function openBillingPortal(
  db: Db,
  stripe: Stripe,
  parentUserId: string,
): Promise<{ ok: true; url: string } | { ok: false; error: "not_parent" | "no_customer" | "not_payer" }> {
  const householdId = await parentHousehold(db, parentUserId);
  if (!householdId) return { ok: false, error: "not_parent" };
  const account = await billingAccountFor(db, householdId);
  if (!account) return { ok: false, error: "no_customer" };
  if (!(await isPayer(db, stripe, account, parentUserId))) return { ok: false, error: "not_payer" };
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
 * can use it. `completed`: the parent finished checkout (a session still open was never paid).
 * `created`: when the session started; a session stays complete forever, so an old link isn't news.
 */
export async function syncCheckoutSession(
  db: Db,
  stripe: Stripe,
  parentUserId: string,
  sessionId: string,
): Promise<{ ok: true; completed: boolean; created: Date; sync: SyncResult } | { ok: false; error: "not_parent" | "not_found" }> {
  const householdId = await parentHousehold(db, parentUserId);
  if (!householdId) return { ok: false, error: "not_parent" };
  if (!CHECKOUT_SESSION_ID.test(sessionId)) return { ok: false, error: "not_found" };
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  const owner = session.client_reference_id ?? session.metadata?.householdId ?? null;
  const customerId = typeof session.customer === "string" ? session.customer : (session.customer?.id ?? null);
  if (owner !== householdId || !customerId || session.mode !== "subscription") return { ok: false, error: "not_found" };
  return {
    ok: true,
    completed: session.status === "complete",
    created: new Date(session.created * 1000),
    sync: await syncCustomer(db, stripe, customerId, householdId, parentUserId),
  };
}

/** Checkout links last 24 hours, so a finished session older than that isn't news to the parent. */
export const RECENT_CHECKOUT_MS = 24 * 60 * 60 * 1000;

/**
 * The parent just finished this checkout, so the success page may thank them. A session stays
 * complete forever, so an old success link (from the browser's history, say) doesn't count.
 */
export function finishedRecently(session: { completed: boolean; created: Date }, now = new Date()): boolean {
  return session.completed && now.getTime() - session.created.getTime() <= RECENT_CHECKOUT_MS;
}

export type EndPlanResult =
  /** A parent is still in the household, or it has no billing account: nothing to do. */
  | "none"
  /** The plan ends with the period it's paid through (or that change is queued for the sweep). */
  | "ending"
  /** The plan had already ended: its customer is deleted (or queued) and the billing account removed. */
  | "closed";

/**
 * When a household's last parent leaves (deletes their account) but students remain, nobody can use
 * its Stripe customer any more: only the parent who pays can. A plan that still gives access is set
 * to end with the period it's paid through, instead of charging that parent's card again; once it
 * ends, its customer is deleted (closeBillingWithoutParent, from the webhook or the daily sweep).
 * A plan that no longer gives access is closed now. If Stripe fails, the change is queued for the
 * daily sweep. Never throws.
 */
export async function endPlanWithoutParent(db: Db, stripe: Stripe | null, householdId: string, now = new Date()): Promise<EndPlanResult> {
  const [parent] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.householdId, householdId), eq(users.role, "parent")))
    .limit(1);
  if (parent) return "none";
  const billing = await billingAccountFor(db, householdId);
  if (!billing) return "none";
  if (!subscriptionGrantsAccess(billing.status)) {
    return (await closeBillingWithoutParent(db, stripe, householdId, now)) ? "closed" : "none";
  }
  await endAtPeriodEnd(db, stripe, billing, now);
  return "ending";
}

/**
 * When the last student leaves a household that keeps its parent (a teen removed the parent linked
 * to them), its plan covers nobody. Like a plan left without a parent, one that still gives access
 * is set to end with the period it's paid through instead of renewing: the parent keeps the time
 * they paid for, and the parent who pays can keep it going from Manage billing. A plan that no
 * longer gives access is left alone: its Stripe customer is still that parent's to use. If Stripe
 * fails, the change is queued for the daily sweep. Never throws.
 */
export async function endPlanWithoutStudents(
  db: Db,
  stripe: Stripe | null,
  householdId: string,
  now = new Date(),
): Promise<Exclude<EndPlanResult, "closed">> {
  const [student] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.householdId, householdId), eq(users.role, "student")))
    .limit(1);
  if (student) return "none";
  const billing = await billingAccountFor(db, householdId);
  if (!billing || !subscriptionGrantsAccess(billing.status)) return "none";
  await endAtPeriodEnd(db, stripe, billing, now);
  return "ending";
}

/**
 * Sets a plan to end with the period it's paid through (Stripe's cancel_at_period_end), unless it
 * already is. If Stripe can't be reached, the change waits in the clean-up queue, and the sweep
 * marks the billing account once it's done.
 */
async function endAtPeriodEnd(db: Db, stripe: Stripe | null, billing: BillingAccount, now: Date): Promise<void> {
  if (!billing.stripeSubscriptionId || billing.cancelAtPeriodEnd) return;
  const ended = await runOrQueueCleanup(db, stripe, { action: "cancel_at_period_end", stripeSubscriptionId: billing.stripeSubscriptionId }, now);
  if (ended) {
    await db.update(billingAccounts).set({ cancelAtPeriodEnd: true, updatedAt: now }).where(eq(billingAccounts.householdId, billing.householdId));
    await audit(db, "billing.subscription_changed", { metadata: { status: billing.status ?? "unknown", cancelAtPeriodEnd: true } });
  }
}
