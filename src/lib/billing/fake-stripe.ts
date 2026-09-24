// Test support: a real Stripe SDK client whose HTTP calls go to a handler instead of the network,
// so tests exercise the SDK's own request encoding and response parsing. Not used by the app.

import { createStripeClient } from "./stripe";

export type FakeStripeRequest = { method: string; path: string; query: URLSearchParams; form: URLSearchParams };
export type FakeStripeResponse = { status?: number; body: unknown };

const NOT_FOUND: FakeStripeResponse = {
  status: 404,
  body: { error: { type: "invalid_request_error", code: "resource_missing", message: "No such resource" } },
};

/** `respond` gets each request; returning undefined answers 404 resource_missing. */
export function fakeStripe(respond: (req: FakeStripeRequest) => FakeStripeResponse | undefined | Promise<FakeStripeResponse | undefined>) {
  const requests: FakeStripeRequest[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const req: FakeStripeRequest = {
      method: (init?.method ?? "GET").toUpperCase(),
      path: url.pathname,
      query: url.searchParams,
      form: new URLSearchParams(typeof init?.body === "string" ? init.body : ""),
    };
    requests.push(req);
    const res = (await respond(req)) ?? NOT_FOUND;
    return new Response(JSON.stringify(res.body), {
      status: res.status ?? 200,
      headers: { "content-type": "application/json", "request-id": `req_${requests.length}` },
    });
  }) as typeof fetch;
  return { stripe: createStripeClient("sk_test_fake", fetchFn), requests };
}

export type FakeSubscription = {
  id: string;
  customer: string;
  status: string;
  priceId?: string;
  interval?: "month" | "year";
  /** Unix seconds. */
  periodEnd?: number;
  cancelAtPeriodEnd?: boolean;
  cancelAt?: number | null;
  created?: number;
  metadata?: Record<string, string>;
};

/** A Stripe Subscription object with the fields we read. */
export function subscriptionObject(s: FakeSubscription) {
  return {
    id: s.id,
    object: "subscription",
    customer: s.customer,
    status: s.status,
    cancel_at_period_end: s.cancelAtPeriodEnd ?? false,
    cancel_at: s.cancelAt ?? null,
    created: s.created ?? 1_790_000_000,
    metadata: s.metadata ?? {},
    items: {
      object: "list",
      has_more: false,
      url: `/v1/subscription_items?subscription=${s.id}`,
      data: [
        {
          id: `si_${s.id}`,
          object: "subscription_item",
          current_period_end: s.periodEnd ?? 1_792_000_000,
          current_period_start: (s.periodEnd ?? 1_792_000_000) - 30 * 86_400,
          price: {
            id: s.priceId ?? "price_monthly",
            object: "price",
            active: true,
            currency: "usd",
            unit_amount: 800,
            recurring: { interval: s.interval ?? "month", interval_count: 1 },
          },
        },
      ],
    },
  };
}

export function listObject(data: unknown[], url = "/v1/subscriptions") {
  return { object: "list", data, has_more: false, url };
}
