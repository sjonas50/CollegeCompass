import { eq } from "drizzle-orm";
import * as z from "zod";
import type { Db } from "@/db";
import { type SubscriptionStatus, billingAccounts, households, subscriptionStatusEnum } from "@/db/schema";
import { LIVE_STATUSES, subscriptionGrantsAccess } from "../access/entitlement";
import { audit } from "../audit";
import { closeBillingWithoutParent, runOrQueueCleanup } from "./cleanup";
import { type Plan, planForPrice } from "./plans";
import { type Stripe, isMissingResource } from "./stripe";

/** Our copy of a subscription, as stored on the household's billing account. */
export type BillingFields = {
  stripeSubscriptionId: string | null;
  status: SubscriptionStatus | null;
  plan: Plan | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
};

const NO_SUBSCRIPTION: BillingFields = {
  stripeSubscriptionId: null,
  status: null,
  plan: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
};

/** Stripe's status, or null for one we don't know (which never gives access). */
export function toSubscriptionStatus(status: string): SubscriptionStatus | null {
  return (subscriptionStatusEnum.enumValues as readonly string[]).includes(status) ? (status as SubscriptionStatus) : null;
}

/** The parts of a Stripe Subscription we read. */
export type SubscriptionLike = Pick<Stripe.Subscription, "id" | "status" | "cancel_at_period_end" | "cancel_at" | "created" | "metadata"> & {
  items: { data: Pick<Stripe.SubscriptionItem, "current_period_end" | "price">[] };
};

/**
 * Status, plan, period end and cancellation from a Stripe subscription. Newer Stripe API versions
 * keep the period on each item, and the Customer Portal may cancel with `cancel_at` instead of
 * `cancel_at_period_end`; either counts as "set to cancel", and access ends at whichever is sooner.
 */
export function billingFieldsFrom(sub: SubscriptionLike): BillingFields {
  const item = sub.items.data[0];
  const periodEnds = sub.items.data.map((i) => i.current_period_end).filter((t): t is number => typeof t === "number");
  let end = periodEnds.length ? Math.min(...periodEnds) : null;
  if (sub.cancel_at !== null && (end === null || sub.cancel_at < end)) end = sub.cancel_at;
  return {
    stripeSubscriptionId: sub.id,
    status: toSubscriptionStatus(sub.status),
    plan: planForPrice(item?.price?.id, item?.price?.recurring?.interval),
    currentPeriodEnd: end === null ? null : new Date(end * 1000),
    cancelAtPeriodEnd: sub.cancel_at_period_end || sub.cancel_at !== null,
  };
}

// Among a customer's subscriptions, the one that gives access wins (active first), then the newest.
const RANK: Partial<Record<SubscriptionStatus, number>> = { active: 3, trialing: 2, past_due: 1 };

export function pickSubscription<T extends SubscriptionLike>(subs: T[]): T | null {
  if (subs.length === 0) return null;
  return subs.reduce((best, s) => {
    const a = RANK[toSubscriptionStatus(s.status) ?? "canceled"] ?? 0;
    const b = RANK[toSubscriptionStatus(best.status) ?? "canceled"] ?? 0;
    return a > b || (a === b && s.created > best.created) ? s : best;
  });
}

const HouseholdId = z.uuid();

export type SyncResult = { householdId: string | null; status: SubscriptionStatus | null; changed: boolean };

/** The customer's subscriptions; none for a customer Stripe no longer has. */
async function listSubscriptions(stripe: Stripe, customerId: string) {
  try {
    return (await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 20 })).data;
  } catch (error) {
    if (isMissingResource(error)) return [];
    throw error;
  }
}

/**
 * Makes the household's billing account match Stripe for one customer. Reads the customer's
 * subscriptions from Stripe instead of trusting one event's copy, so events that arrive late or out
 * of order can't leave an old status behind. `householdHint` (from Checkout's client_reference_id or
 * the subscription's metadata) links a customer we haven't stored yet; `payerUserId` is the parent
 * who checked out, when we know it.
 *
 * Two clean-ups happen here too. A customer whose household was deleted but whose plan is still
 * live (the deletion couldn't reach Stripe, say) is deleted, so the family isn't billed again. And a
 * household without a parent has its customer closed once its plan stops giving access.
 */
export async function syncCustomer(
  db: Db,
  stripe: Stripe,
  customerId: string,
  householdHint?: string | null,
  payerUserId?: string,
): Promise<SyncResult> {
  const best = pickSubscription(await listSubscriptions(stripe, customerId));

  let [account] = await db
    .select({ householdId: billingAccounts.householdId, status: billingAccounts.status })
    .from(billingAccounts)
    .where(eq(billingAccounts.stripeCustomerId, customerId));
  if (!account) {
    const hint = [householdHint, best?.metadata?.householdId].find((h) => HouseholdId.safeParse(h).success);
    const [household] = hint ? await db.select({ id: households.id }).from(households).where(eq(households.id, hint)) : [];
    if (!household) {
      const status = best ? toSubscriptionStatus(best.status) : null;
      if (hint && status && LIVE_STATUSES.includes(status)) {
        // Only our server puts a household id on customers and subscriptions, and that household
        // is gone: its account was deleted, but its plan survived.
        const stripeDeleted = await runOrQueueCleanup(db, stripe, { action: "delete_customer", stripeCustomerId: customerId });
        console.warn("[billing] deleted a Stripe customer whose household was deleted");
        await audit(db, "billing.customer_deleted", { metadata: { stripeDeleted, householdGone: true } });
      } else {
        console.warn("[billing] event for a customer that isn't linked to a household");
      }
      return { householdId: null, status: null, changed: false };
    }
    const inserted = await db
      .insert(billingAccounts)
      .values({ householdId: household.id, stripeCustomerId: customerId, payerUserId: payerUserId ?? null })
      .onConflictDoNothing()
      .returning({ householdId: billingAccounts.householdId, status: billingAccounts.status });
    if (inserted.length === 0) {
      // The household already pays through another customer; leave it alone.
      console.warn("[billing] household already has a different Stripe customer");
      return { householdId: household.id, status: null, changed: false };
    }
    account = inserted[0];
  }

  const fields = best ? billingFieldsFrom(best) : NO_SUBSCRIPTION;
  await db
    .update(billingAccounts)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(billingAccounts.householdId, account.householdId));
  const changed = fields.status !== account.status;
  if (changed) {
    // The status only: plan, dates and Stripe ids stay out of the audit log.
    await audit(db, "billing.subscription_changed", { metadata: { status: fields.status ?? "none" } });
  }
  // A plan left to end after the last parent left has ended: nobody can use its customer now.
  if (!subscriptionGrantsAccess(fields.status)) await closeBillingWithoutParent(db, stripe, account.householdId);
  return { householdId: account.householdId, status: fields.status, changed };
}
