// Who has full access, and why. Pure rules over a household's access grants and its billing
// account, so they can be tested over time without a database.

import type { AccessKind, SubscriptionStatus } from "@/db/schema";

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Free access can be renewed starting on the day this many days before it ends. */
export const FREE_ACCESS_RENEW_DAYS = 30;

/**
 * When free access ending at `endsAt` can be renewed: the start (midnight UTC) of the calendar day
 * 30 days before it ends. Midnight UTC is the evening before everywhere in the US, so a family
 * shown "starting August 25" (see formatStartDate) can renew all day on August 25 wherever they
 * live. Dates follow UTC calendar days, like addMonths.
 */
export function freeAccessRenewalOpens(endsAt: Date): Date {
  const day = new Date(endsAt.getTime() - FREE_ACCESS_RENEW_DAYS * DAY_MS);
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
}

/**
 * Subscription statuses that keep full access. `past_due` keeps access while Stripe retries the
 * payment; Stripe moves the subscription to `canceled` or `unpaid` if the retries fail.
 */
export const ACCESS_STATUSES: readonly SubscriptionStatus[] = ["active", "trialing", "past_due"];

export function subscriptionGrantsAccess(status: SubscriptionStatus | null | undefined): boolean {
  return status != null && ACCESS_STATUSES.includes(status);
}

/** Subscription statuses that can still bill or give access (everything but ended ones). */
export const LIVE_STATUSES: readonly SubscriptionStatus[] = ["trialing", "active", "past_due", "unpaid", "paused", "incomplete"];

export type GrantRow = { kind: AccessKind; startsAt: Date; endsAt: Date | null };

export type BillingRow = {
  status: SubscriptionStatus | null;
  plan: "monthly" | "annual" | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
};

export type AccessSource = AccessKind | "subscription";

export type GrantSummary = {
  kind: AccessKind;
  startsAt: Date;
  /** Null means it never ends. */
  endsAt: Date | null;
  active: boolean;
  /** Whole days left, rounded up (1 means it ends within a day). Null when it never ends. */
  daysLeft: number | null;
};

export type SubscriptionSummary = BillingRow & { grantsAccess: boolean };

/** A household's access right now. Every student in the household shares it. */
export type HouseholdAccess = {
  /** Null when the user has no household (then there is no access). */
  householdId: string | null;
  /** Full access to the counselor, class plan, roadmap and college list. */
  full: boolean;
  /** Everything giving full access right now, most important first. */
  sources: AccessSource[];
  /** The household's trial: the one running now, otherwise the one that ended last. */
  trial: GrantSummary | null;
  /** Free access: the grant running now that ends last, otherwise the one that ended last. */
  freeAccess: GrantSummary | null;
  /** A sponsored seat or staff comp running now (or the last one to end). */
  other: GrantSummary | null;
  /** The household's subscription, as Stripe last reported it. Null if they never started checkout. */
  subscription: SubscriptionSummary | null;
  /** Free access can be requested: none is running, or the running one is in its renewal window. */
  canRenewFreeAccess: boolean;
  /** When the running free access becomes renewable (null if it already is, or never will be). */
  freeAccessRenewableFrom: Date | null;
};

export function isGrantActive(grant: Pick<GrantRow, "startsAt" | "endsAt">, now: Date): boolean {
  return grant.startsAt.getTime() <= now.getTime() && (grant.endsAt === null || now.getTime() < grant.endsAt.getTime());
}

export function daysLeft(endsAt: Date | null, now: Date): number | null {
  if (endsAt === null) return null;
  return Math.max(0, Math.ceil((endsAt.getTime() - now.getTime()) / DAY_MS));
}

// Null (no end) sorts after every date.
const endValue = (g: GrantRow) => (g.endsAt === null ? Number.POSITIVE_INFINITY : g.endsAt.getTime());

/** The running grant that lasts longest; otherwise the one that ended (or starts) last. */
function summarize(grants: GrantRow[], now: Date): GrantSummary | null {
  if (grants.length === 0) return null;
  const active = grants.filter((g) => isGrantActive(g, now));
  const pool = active.length ? active : grants;
  const best = pool.reduce((a, b) => (endValue(b) > endValue(a) ? b : a));
  return { kind: best.kind, startsAt: best.startsAt, endsAt: best.endsAt, active: active.length > 0, daysLeft: daysLeft(best.endsAt, now) };
}

export function evaluateAccess(
  input: { householdId: string | null; grants: GrantRow[]; billing: BillingRow | null },
  now: Date,
): HouseholdAccess {
  const { householdId, billing } = input;
  // Grants only count for a real household.
  const grants = householdId ? input.grants : [];
  const ofKind = (...kinds: AccessKind[]) => grants.filter((g) => kinds.includes(g.kind));

  const subscription = billing ? { ...billing, grantsAccess: subscriptionGrantsAccess(billing.status) } : null;
  const trial = summarize(ofKind("trial"), now);
  const freeAccess = summarize(ofKind("free_access"), now);
  const other = summarize(ofKind("sponsored", "comp"), now);

  const sources: AccessSource[] = [];
  if (householdId && subscription?.grantsAccess) sources.push("subscription");
  for (const kind of ["sponsored", "comp", "free_access", "trial"] as const) {
    if (ofKind(kind).some((g) => isGrantActive(g, now))) sources.push(kind);
  }

  const runningFree = freeAccess?.active ? freeAccess : null;
  let canRenewFreeAccess = Boolean(householdId);
  let freeAccessRenewableFrom: Date | null = null;
  if (runningFree) {
    if (runningFree.endsAt === null) {
      canRenewFreeAccess = false;
    } else {
      const opens = freeAccessRenewalOpens(runningFree.endsAt);
      canRenewFreeAccess = now.getTime() >= opens.getTime();
      freeAccessRenewableFrom = canRenewFreeAccess ? null : opens;
    }
  }

  return {
    householdId,
    full: sources.length > 0,
    sources,
    trial,
    freeAccess,
    other,
    subscription,
    canRenewFreeAccess,
    freeAccessRenewableFrom,
  };
}

/**
 * The same calendar day `months` later, in UTC. A day the target month doesn't have becomes its
 * last day (March 31 + 1 month is April 30; February 29 + 12 months is February 28).
 */
export function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}
