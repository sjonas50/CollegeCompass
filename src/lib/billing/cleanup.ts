import { and, asc, count, eq, isNull, lte, notExists, notInArray, or } from "drizzle-orm";
import type { Db } from "@/db";
import { billingAccounts, households, stripeCleanup, users } from "@/db/schema";
import { ACCESS_STATUSES, subscriptionGrantsAccess } from "../access/entitlement";
import { audit } from "../audit";
import { type Stripe, errorName, isMissingResource } from "./stripe";

// Stripe clean-up that must not be lost: deleting a family's Stripe customer when their account is
// deleted (which cancels any plan), and setting a plan to end when the parent who pays leaves. When
// Stripe can't be reached, the job waits in stripe_cleanup (Stripe ids only, never whose they were)
// and the daily sweep tries again.

export type CleanupJob =
  | { action: "delete_customer"; stripeCustomerId: string }
  | { action: "cancel_at_period_end"; stripeSubscriptionId: string };

const HOUR_MS = 60 * 60 * 1000;

/** From this many failed tries on, each retry logs an error for staff (see docs/operations.md). */
export const CLEANUP_ALERT_ATTEMPTS = 5;

/**
 * How long to wait after `attempts` failed tries: an hour, doubling each time, at most a week. The
 * sweep runs once a day, so the first five retries happen on the next five days, then they spread
 * out to weekly.
 */
export function cleanupBackoffMs(attempts: number): number {
  return Math.min(2 ** Math.max(0, attempts - 1), 168) * HOUR_MS;
}

type Outcome = { ok: true } | { ok: false; error: string };

/** A Stripe call's outcome. Something Stripe says is already gone counts as done. */
async function attempt(fn: () => Promise<unknown>): Promise<Outcome> {
  try {
    await fn();
    return { ok: true };
  } catch (error) {
    if (isMissingResource(error)) return { ok: true };
    return { ok: false, error: errorName(error) };
  }
}

/**
 * Does the job on Stripe. A retry reads the subscription first, so one that has ended since (or
 * is already set to end) counts as done instead of failing forever.
 */
function perform(stripe: Stripe, job: CleanupJob, retry: boolean): Promise<Outcome> {
  if (job.action === "delete_customer") return attempt(() => stripe.customers.del(job.stripeCustomerId));
  return attempt(async () => {
    if (retry) {
      const sub = await stripe.subscriptions.retrieve(job.stripeSubscriptionId);
      if (sub.status === "canceled" || sub.status === "incomplete_expired" || sub.cancel_at_period_end) return;
    }
    await stripe.subscriptions.update(job.stripeSubscriptionId, { cancel_at_period_end: true });
  });
}

const FAILURE_LOG: Record<CleanupJob["action"], string> = {
  delete_customer: "[billing] couldn't delete a Stripe customer",
  cancel_at_period_end: "[billing] couldn't set a plan to end",
};

/**
 * Does a clean-up job now. If Stripe fails (or isn't set up), the job is queued for the daily sweep
 * and the error's name is logged (never its message, which can echo request details). Never
 * throws. Returns whether it's done.
 */
export async function runOrQueueCleanup(db: Db, stripe: Stripe | null, job: CleanupJob, now = new Date()): Promise<boolean> {
  const outcome: Outcome = stripe ? await perform(stripe, job, false) : { ok: false, error: "StripeNotConfigured" };
  if (outcome.ok) return true;
  console.error(FAILURE_LOG[job.action], outcome.error);
  await db.insert(stripeCleanup).values({
    action: job.action,
    stripeCustomerId: job.action === "delete_customer" ? job.stripeCustomerId : null,
    stripeSubscriptionId: job.action === "cancel_at_period_end" ? job.stripeSubscriptionId : null,
    attempts: 1,
    nextAttemptAt: new Date(now.getTime() + cleanupBackoffMs(1)),
    lastError: outcome.error,
    createdAt: now,
  });
  return false;
}

/**
 * Queues a clean-up job as part of the caller's transaction, so it can't be lost if the process
 * stops between the commit and the call to Stripe. Try it right away with runQueuedCleanup once the
 * transaction commits; otherwise the daily sweep does it. It's due an hour from now, so a sweep
 * running at that moment doesn't try it at the same time. Returns the job's id.
 */
export async function queueCleanup(db: Db, job: CleanupJob, now = new Date()): Promise<string> {
  const [row] = await db
    .insert(stripeCleanup)
    .values({
      action: job.action,
      stripeCustomerId: job.action === "delete_customer" ? job.stripeCustomerId : null,
      stripeSubscriptionId: job.action === "cancel_at_period_end" ? job.stripeSubscriptionId : null,
      attempts: 0,
      nextAttemptAt: new Date(now.getTime() + cleanupBackoffMs(1)),
      createdAt: now,
    })
    .returning({ id: stripeCleanup.id });
  return row.id;
}

/**
 * Tries a job queueCleanup queued, now. Once it's done, a plan set to end is marked on its billing
 * account (and audited), then the job is removed. If Stripe fails (or isn't set up), the error's
 * name is logged and the job waits for the daily sweep. Stripe errors never throw; a database
 * error can, and leaves the job queued. Returns whether it's done.
 */
export async function runQueuedCleanup(db: Db, stripe: Stripe | null, jobId: string, now = new Date()): Promise<boolean> {
  const [row] = await db.select().from(stripeCleanup).where(eq(stripeCleanup.id, jobId));
  // The sweep got to it first.
  if (!row) return true;
  const job = jobOf(row);
  const outcome: Outcome = !job ? { ok: true } : stripe ? await perform(stripe, job, false) : { ok: false, error: "StripeNotConfigured" };
  if (!outcome.ok) {
    console.error(FAILURE_LOG[row.action], outcome.error);
    await db.update(stripeCleanup).set({ attempts: row.attempts + 1, lastError: outcome.error }).where(eq(stripeCleanup.id, row.id));
    return false;
  }
  if (job?.action === "cancel_at_period_end") {
    const marked = await db
      .update(billingAccounts)
      .set({ cancelAtPeriodEnd: true, updatedAt: now })
      .where(eq(billingAccounts.stripeSubscriptionId, job.stripeSubscriptionId))
      .returning({ status: billingAccounts.status });
    for (const b of marked) {
      await audit(db, "billing.subscription_changed", { metadata: { status: b.status ?? "unknown", cancelAtPeriodEnd: true } });
    }
  }
  await db.delete(stripeCleanup).where(eq(stripeCleanup.id, row.id));
  return true;
}

function jobOf(row: typeof stripeCleanup.$inferSelect): CleanupJob | null {
  if (row.action === "delete_customer" && row.stripeCustomerId) return { action: "delete_customer", stripeCustomerId: row.stripeCustomerId };
  if (row.action === "cancel_at_period_end" && row.stripeSubscriptionId) {
    return { action: "cancel_at_period_end", stripeSubscriptionId: row.stripeSubscriptionId };
  }
  return null;
}

export type CleanupReport = { done: number; failed: number; waiting: number };

/**
 * The daily sweep's retry of queued Stripe clean-up: each job that's due is tried again, removed
 * once it succeeds, and otherwise given a later try (see cleanupBackoffMs). After
 * CLEANUP_ALERT_ATTEMPTS failures, every retry logs an error naming the job's row, so staff can
 * look into it. `waiting` counts the jobs still queued afterwards.
 */
export async function runStripeCleanup(db: Db, stripe: Stripe | null, now = new Date(), limit = 100): Promise<CleanupReport> {
  const due = await db
    .select()
    .from(stripeCleanup)
    .where(lte(stripeCleanup.nextAttemptAt, now))
    .orderBy(asc(stripeCleanup.nextAttemptAt), asc(stripeCleanup.id))
    .limit(limit);
  let done = 0;
  let failed = 0;
  if (!stripe) {
    if (due.length) console.error("[billing] Stripe clean-up is waiting", "StripeNotConfigured");
  } else {
    for (const row of due) {
      const job = jobOf(row);
      const outcome = job ? await perform(stripe, job, true) : null;
      if (!job || outcome?.ok) {
        if (!job) console.error("[billing] dropped a Stripe clean-up job without a Stripe id", row.id);
        await db.delete(stripeCleanup).where(eq(stripeCleanup.id, row.id));
        if (job?.action === "cancel_at_period_end") {
          await db
            .update(billingAccounts)
            .set({ cancelAtPeriodEnd: true, updatedAt: now })
            .where(eq(billingAccounts.stripeSubscriptionId, job.stripeSubscriptionId));
        }
        done++;
        continue;
      }
      failed++;
      const attempts = row.attempts + 1;
      const lastError = outcome && !outcome.ok ? outcome.error : "unknown";
      await db
        .update(stripeCleanup)
        .set({ attempts, nextAttemptAt: new Date(now.getTime() + cleanupBackoffMs(attempts)), lastError })
        .where(eq(stripeCleanup.id, row.id));
      if (attempts >= CLEANUP_ALERT_ATTEMPTS) {
        console.error(
          "[billing] Stripe clean-up keeps failing. See \"Stripe clean-up\" in docs/operations.md.",
          JSON.stringify({ job: row.id, action: row.action, attempts, lastError }),
        );
      }
    }
  }
  const [{ waiting }] = await db.select({ waiting: count() }).from(stripeCleanup);
  return { done, failed, waiting };
}

// ---------------------------------------------------------------------------
// Billing accounts nobody can use
// ---------------------------------------------------------------------------

const hasParent = (householdId: string | typeof billingAccounts.householdId) =>
  and(eq(users.householdId, householdId), eq(users.role, "parent"));

/**
 * Only the parent who pays can use a Stripe customer. When a household has no parent left, its plan
 * is left to end (see endPlanWithoutParent); once it no longer gives access, the customer is
 * deleted (or queued), the billing account removed, and the household too if nobody is left in it.
 * Returns whether it closed anything.
 */
export async function closeBillingWithoutParent(db: Db, stripe: Stripe | null, householdId: string, now = new Date()): Promise<boolean> {
  const [billing] = await db
    .select({ stripeCustomerId: billingAccounts.stripeCustomerId, status: billingAccounts.status })
    .from(billingAccounts)
    .where(eq(billingAccounts.householdId, householdId));
  if (!billing || subscriptionGrantsAccess(billing.status)) return false;
  const [parent] = await db.select({ id: users.id }).from(users).where(hasParent(householdId)).limit(1);
  if (parent) return false;

  const stripeDeleted = await runOrQueueCleanup(db, stripe, { action: "delete_customer", stripeCustomerId: billing.stripeCustomerId }, now);
  await db
    .delete(billingAccounts)
    .where(and(eq(billingAccounts.householdId, householdId), eq(billingAccounts.stripeCustomerId, billing.stripeCustomerId)));
  const [member] = await db.select({ id: users.id }).from(users).where(eq(users.householdId, householdId)).limit(1);
  if (!member) await db.delete(households).where(eq(households.id, householdId));
  await audit(db, "billing.customer_deleted", { metadata: { stripeDeleted, noParent: true } });
  return true;
}

/**
 * The daily sweep's backstop for closeBillingWithoutParent: billing accounts in households without a
 * parent whose plan no longer gives access (a webhook that never came, or accounts from before this
 * check existed). Returns how many were closed.
 */
export async function sweepBillingWithoutParent(db: Db, stripe: Stripe | null, now = new Date(), limit = 100): Promise<number> {
  const rows = await db
    .select({ householdId: billingAccounts.householdId })
    .from(billingAccounts)
    .where(
      and(
        or(isNull(billingAccounts.status), notInArray(billingAccounts.status, [...ACCESS_STATUSES])),
        notExists(db.select({ id: users.id }).from(users).where(hasParent(billingAccounts.householdId))),
      ),
    )
    .limit(limit);
  let closed = 0;
  for (const row of rows) {
    if (await closeBillingWithoutParent(db, stripe, row.householdId, now)) closed++;
  }
  return closed;
}
