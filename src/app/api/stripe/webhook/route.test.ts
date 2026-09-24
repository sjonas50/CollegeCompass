import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Db, createTestDb, schema } from "@/db";
import { resetEnvCache } from "@/env";
import { fakeStripe, listObject } from "@/lib/billing/fake-stripe";
import type { Stripe } from "@/lib/billing/stripe";
import { POST } from "./route";

// The webhook route: raw body and signature header straight to handleStripeWebhook.

const state = vi.hoisted(() => ({ db: null as Db | null, stripe: null as unknown }));
vi.mock("@/db", async (original) => ({ ...(await original<typeof import("@/db")>()), getDb: async () => state.db }));
vi.mock("@/lib/billing/stripe", async (original) => ({
  ...(await original<typeof import("@/lib/billing/stripe")>()),
  getStripe: () => state.stripe as Stripe | null,
}));

const SECRET = "whsec_route_test";

beforeEach(async () => {
  state.db = await createTestDb();
  state.stripe = fakeStripe((req) => (req.path === "/v1/subscriptions" ? { body: listObject([]) } : undefined)).stripe;
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", SECRET);
  resetEnvCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

const post = (body: string, signature?: string) =>
  POST(new Request("http://localhost/api/stripe/webhook", { method: "POST", body, headers: signature ? { "stripe-signature": signature } : {} }));

describe("POST /api/stripe/webhook", () => {
  // Formatting kept exactly as sent: the signature covers these bytes.
  const payload = '{\n  "id": "evt_route_1",\n  "object": "event",\n  "type": "invoice.paid",\n  "data": { "object": { "id": "in_1" } }\n}';

  it("accepts a correctly signed event, verifying the raw body", async () => {
    const signature = (state.stripe as Stripe).webhooks.generateTestHeaderString({ payload, secret: SECRET });
    const res = await post(payload, signature);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, ignored: true });
    expect(await state.db!.select().from(schema.stripeEvents)).toEqual([expect.objectContaining({ id: "evt_route_1" })]);
  });

  it("rejects an unsigned or wrongly signed event", async () => {
    expect((await post(payload)).status).toBe(400);
    const wrong = (state.stripe as Stripe).webhooks.generateTestHeaderString({ payload, secret: "whsec_other" });
    expect((await post(payload, wrong)).status).toBe(400);
    expect(await state.db!.select().from(schema.stripeEvents)).toHaveLength(0);
  });

  it("answers 503 when billing isn't set up", async () => {
    state.stripe = null;
    expect((await post(payload, "t=1,v1=x")).status).toBe(503);
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    resetEnvCache();
    state.stripe = fakeStripe(() => undefined).stripe;
    expect((await post(payload, "t=1,v1=x")).status).toBe(503);
  });
});
