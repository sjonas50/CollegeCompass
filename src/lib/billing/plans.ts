import { env } from "@/env";
import { type Stripe, errorName } from "./stripe";

export type Plan = "monthly" | "annual";
export const PLANS: readonly Plan[] = ["monthly", "annual"];

export function isPlan(value: unknown): value is Plan {
  return value === "monthly" || value === "annual";
}

/** The Stripe Price id for a plan, from STRIPE_PRICE_MONTHLY / STRIPE_PRICE_ANNUAL. */
export function priceIdFor(plan: Plan): string | null {
  const e = env();
  return (plan === "monthly" ? e.STRIPE_PRICE_MONTHLY : e.STRIPE_PRICE_ANNUAL) ?? null;
}

/**
 * Which of our plans a subscription's price is: our configured price ids first, then the price's
 * billing interval (so an old price still reads right after the configured ones change).
 */
export function planForPrice(priceId: string | null | undefined, interval?: string | null): Plan | null {
  const e = env();
  if (priceId && priceId === e.STRIPE_PRICE_MONTHLY) return "monthly";
  if (priceId && priceId === e.STRIPE_PRICE_ANNUAL) return "annual";
  if (interval === "month") return "monthly";
  if (interval === "year") return "annual";
  return null;
}

export type PlanPrice = {
  plan: Plan;
  priceId: string;
  /** In the currency's smallest unit (cents). */
  unitAmount: number;
  currency: string;
  /** "$8 a month", "$80 a year". */
  label: string;
};

const INTERVAL_WORDS: Record<string, string> = { day: "a day", week: "a week", month: "a month", year: "a year" };

export function priceLabel(unitAmount: number, currency: string, interval: string | null | undefined, intervalCount = 1): string {
  const amount = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: unitAmount % 100 === 0 ? 0 : 2,
  }).format(unitAmount / 100);
  if (!interval) return amount;
  return intervalCount > 1 ? `${amount} every ${intervalCount} ${interval}s` : `${amount} ${INTERVAL_WORDS[interval] ?? `a ${interval}`}`;
}

// Prices rarely change, so each Price object is read from Stripe at most once an hour per server
// instance. A failed read is retried after a minute rather than on every page view.
const PRICE_TTL_MS = 60 * 60_000;
const FAILED_TTL_MS = 60_000;
const cache = new Map<string, { value: PlanPrice | null; expiresAt: number }>();

/** Test hook. */
export function clearPriceCache() {
  cache.clear();
}

async function readPrice(stripe: Stripe, plan: Plan, priceId: string, now: number): Promise<PlanPrice | null> {
  const hit = cache.get(priceId);
  if (hit && hit.expiresAt > now) return hit.value;
  let value: PlanPrice | null = null;
  try {
    const price = await stripe.prices.retrieve(priceId);
    if (price.active && typeof price.unit_amount === "number") {
      value = {
        plan,
        priceId,
        unitAmount: price.unit_amount,
        currency: price.currency,
        label: priceLabel(price.unit_amount, price.currency, price.recurring?.interval, price.recurring?.interval_count ?? 1),
      };
    }
  } catch (error) {
    console.error("[billing] couldn't read a price", errorName(error));
  }
  cache.set(priceId, { value, expiresAt: now + (value ? PRICE_TTL_MS : FAILED_TTL_MS) });
  return value;
}

/** The configured plans with their prices, as Stripe has them. A plan is null if it isn't set up. */
export async function getPlanPrices(stripe: Stripe, now = Date.now()): Promise<Record<Plan, PlanPrice | null>> {
  const [monthly, annual] = await Promise.all(
    PLANS.map((plan) => {
      const id = priceIdFor(plan);
      return id ? readPrice(stripe, plan, id, now) : Promise.resolve(null);
    }),
  );
  return { monthly, annual };
}
