import Stripe from "stripe";
import { env } from "@/env";

export type { Stripe };

let client: Stripe | undefined;

/**
 * The Stripe client, or null when STRIPE_SECRET_KEY isn't set (paid plans are off; the trial and
 * free access still work). Business functions take the client as a parameter so tests can pass
 * one with a fake HTTP layer (see createStripeClient).
 */
export function getStripe(): Stripe | null {
  const key = env().STRIPE_SECRET_KEY;
  if (!key) return null;
  client ??= createStripeClient(key);
  return client;
}

/** A Stripe client. `fetchFn` replaces the network, for tests. */
export function createStripeClient(secretKey: string, fetchFn?: typeof fetch): Stripe {
  return new Stripe(secretKey, {
    maxNetworkRetries: fetchFn ? 0 : 2,
    timeout: 15_000,
    telemetry: false,
    ...(fetchFn ? { httpClient: Stripe.createFetchHttpClient(fetchFn) } : {}),
  });
}

/** Paid plans can be offered: Stripe is configured with at least one price. */
export function paidPlansAvailable(): boolean {
  const e = env();
  return Boolean(e.STRIPE_SECRET_KEY && (e.STRIPE_PRICE_MONTHLY || e.STRIPE_PRICE_ANNUAL));
}

/** Stripe says the object doesn't exist (for example, a customer that was already deleted). */
export function isMissingResource(error: unknown): boolean {
  return error instanceof Stripe.errors.StripeError && error.code === "resource_missing";
}

/**
 * Only the error's name (never its message, which can include request details). Stripe's errors
 * name themselves in `type` (like "StripeConnectionError"), plus a short `code` for some.
 */
export function errorName(error: unknown): string {
  if (error instanceof Stripe.errors.StripeError) return `${error.type}${error.code ? `:${error.code}` : ""}`;
  return error instanceof Error ? error.name : "unknown";
}
