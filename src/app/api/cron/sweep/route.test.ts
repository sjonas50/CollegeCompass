import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Db, createTestDb, schema } from "@/db";
import { resetEnvCache } from "@/env";
import { fakeStripe } from "@/lib/billing/fake-stripe";
import type { Stripe } from "@/lib/billing/stripe";
import { GET } from "./route";

// The daily sweep, as far as billing goes: queued Stripe clean-up and customers nobody can use.

const state = vi.hoisted(() => ({ db: null as Db | null, stripe: null as unknown }));
vi.mock("@/db", async (original) => ({ ...(await original<typeof import("@/db")>()), getDb: async () => state.db }));
vi.mock("@/lib/billing/stripe", async (original) => ({
  ...(await original<typeof import("@/lib/billing/stripe")>()),
  getStripe: () => state.stripe as Stripe | null,
}));

const SECRET = "cron_test_secret";
const sweep = (auth = `Bearer ${SECRET}`) => GET(new Request("http://localhost/api/cron/sweep", { headers: { authorization: auth } }));

beforeEach(async () => {
  state.db = await createTestDb();
  vi.stubEnv("CRON_SECRET", SECRET);
  resetEnvCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe("GET /api/cron/sweep", () => {
  it("retries queued Stripe clean-up and closes customers of households with no parent", async () => {
    const db = state.db!;
    const { stripe, requests } = fakeStripe((req) =>
      req.method === "DELETE" ? { body: { id: req.path.split("/").pop(), object: "customer", deleted: true } } : undefined,
    );
    state.stripe = stripe;
    await db.insert(schema.stripeCleanup).values({ action: "delete_customer", stripeCustomerId: "cus_queued", attempts: 1, nextAttemptAt: new Date(Date.now() - 1000) });
    const [teenHousehold] = await db.insert(schema.households).values({}).returning();
    await db.insert(schema.users).values({ role: "student", householdId: teenHousehold.id, displayName: "Ana", passwordHash: "x", grade: 10, gradeSchoolYear: 2026 });
    await db.insert(schema.billingAccounts).values({ householdId: teenHousehold.id, stripeCustomerId: "cus_ended", status: "canceled" });

    const res = await sweep();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ stripeCleanup: { done: 1, failed: 0, waiting: 0 }, billingClosed: 1 });
    expect(requests.map((r) => `${r.method} ${r.path}`).sort()).toEqual(["DELETE /v1/customers/cus_ended", "DELETE /v1/customers/cus_queued"]);
    expect(await db.select().from(schema.stripeCleanup)).toHaveLength(0);
    expect(await db.select().from(schema.billingAccounts)).toHaveLength(0);
  });

  it("needs the cron secret", async () => {
    expect((await sweep("Bearer wrong")).status).toBe(401);
  });
});
