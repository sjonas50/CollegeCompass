import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Db, createTestDb, schema } from "@/db";
import { registerParent, registerStudent } from "@/lib/accounts";
import { CLEANUP_ALERT_ATTEMPTS, cleanupBackoffMs, runOrQueueCleanup, runStripeCleanup, sweepBillingWithoutParent } from "./cleanup";
import { type FakeStripeRequest, fakeStripe } from "./fake-stripe";

// Stripe clean-up that failed waits in stripe_cleanup and the daily sweep retries it. Billing
// accounts nobody can use (no parent left) are closed once their plan has ended.

const NOW = new Date("2026-09-24T18:00:00Z");
const HOUR = 60 * 60 * 1000;
let db: Db;

beforeEach(async () => {
  db = await createTestDb();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const DOWN = { status: 500, body: { error: { type: "api_error", message: "cus_secret_1 exploded" } } };
const queue = () => db.select().from(schema.stripeCleanup);

/** Stripe that fails while `down()` is true, and otherwise deletes customers and updates subscriptions. */
function stripeThat(down: () => boolean, subscription: Record<string, unknown> = { status: "active", cancel_at_period_end: false }) {
  return fakeStripe((req: FakeStripeRequest) => {
    if (down()) return DOWN;
    if (req.method === "DELETE" && req.path.startsWith("/v1/customers/")) return { body: { id: req.path.split("/").pop(), object: "customer", deleted: true } };
    const sub = /^\/v1\/subscriptions\/(sub_\w+)$/.exec(req.path);
    if (sub) return { body: { id: sub[1], object: "subscription", ...subscription, ...(req.method === "POST" ? { cancel_at_period_end: true } : {}) } };
    return undefined;
  });
}

describe("queueing clean-up that failed", () => {
  it("keeps only the Stripe id, the action and the error's name, and tries again in an hour", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { stripe } = stripeThat(() => true);
    expect(await runOrQueueCleanup(db, stripe, { action: "delete_customer", stripeCustomerId: "cus_secret_1" }, NOW)).toBe(false);
    expect(await queue()).toEqual([
      expect.objectContaining({
        action: "delete_customer",
        stripeCustomerId: "cus_secret_1",
        stripeSubscriptionId: null,
        attempts: 1,
        nextAttemptAt: new Date(NOW.getTime() + HOUR),
        lastError: "StripeAPIError",
      }),
    ]);
    expect(errors).toHaveBeenCalledWith("[billing] couldn't delete a Stripe customer", "StripeAPIError");
    expect(JSON.stringify(errors.mock.calls)).not.toContain("cus_secret_1");
  });

  it("queues without Stripe configured, and does nothing more when Stripe works", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await runOrQueueCleanup(db, null, { action: "cancel_at_period_end", stripeSubscriptionId: "sub_1" }, NOW)).toBe(false);
    expect(await queue()).toEqual([expect.objectContaining({ action: "cancel_at_period_end", stripeSubscriptionId: "sub_1", lastError: "StripeNotConfigured" })]);

    const { stripe, requests } = stripeThat(() => false);
    expect(await runOrQueueCleanup(db, stripe, { action: "delete_customer", stripeCustomerId: "cus_2" }, NOW)).toBe(true);
    expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual(["DELETE /v1/customers/cus_2"]);
    expect(await queue()).toHaveLength(1);
  });
});

describe("the daily retry", () => {
  it("backs off from daily retries to weekly", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 20].map((n) => cleanupBackoffMs(n) / HOUR)).toEqual([1, 2, 4, 8, 16, 32, 64, 128, 168, 168]);
  });

  it("retries what's due until it works, then forgets it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let down = true;
    const { stripe, requests } = stripeThat(() => down);
    await runOrQueueCleanup(db, stripe, { action: "delete_customer", stripeCustomerId: "cus_1" }, NOW);

    // Not due yet.
    expect(await runStripeCleanup(db, stripe, new Date(NOW.getTime() + 30 * 60_000))).toEqual({ done: 0, failed: 0, waiting: 1 });
    expect(requests).toHaveLength(1);

    const nextDay = new Date(NOW.getTime() + 24 * HOUR);
    expect(await runStripeCleanup(db, stripe, nextDay)).toEqual({ done: 0, failed: 1, waiting: 1 });
    expect(await queue()).toEqual([expect.objectContaining({ attempts: 2, nextAttemptAt: new Date(nextDay.getTime() + 2 * HOUR) })]);

    down = false;
    expect(await runStripeCleanup(db, stripe, new Date(nextDay.getTime() + 24 * HOUR))).toEqual({ done: 1, failed: 0, waiting: 0 });
    expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual(Array(3).fill("DELETE /v1/customers/cus_1"));
  });

  it("logs an error naming the job, never a Stripe id, once it keeps failing", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { stripe } = stripeThat(() => true);
    await runOrQueueCleanup(db, stripe, { action: "delete_customer", stripeCustomerId: "cus_secret_1" }, NOW);
    const [{ id }] = await queue();
    const alerts = () => errors.mock.calls.filter((c) => String(c[0]).includes("keeps failing"));

    let at = NOW;
    for (let attempt = 2; attempt <= CLEANUP_ALERT_ATTEMPTS; attempt++) {
      at = new Date(at.getTime() + 8 * 24 * HOUR);
      await runStripeCleanup(db, stripe, at);
      expect(alerts()).toHaveLength(attempt < CLEANUP_ALERT_ATTEMPTS ? 0 : 1);
    }
    expect(alerts()[0][1]).toBe(JSON.stringify({ job: id, action: "delete_customer", attempts: CLEANUP_ALERT_ATTEMPTS, lastError: "StripeAPIError" }));
    expect(JSON.stringify(errors.mock.calls)).not.toContain("cus_secret_1");
    expect((await queue())[0].attempts).toBe(CLEANUP_ALERT_ATTEMPTS);
  });

  it("sets a plan to end, or counts one that already ended as done", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const parent = await registerParent(db, { displayName: "Rosa", email: "rosa@example.com", password: "correct horse battery" });
    if (!parent.ok) throw new Error(parent.error);
    const [{ householdId }] = await db.select({ householdId: schema.users.householdId }).from(schema.users);
    await db.insert(schema.billingAccounts).values({ householdId: householdId!, stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1", status: "active" });
    await runOrQueueCleanup(db, null, { action: "cancel_at_period_end", stripeSubscriptionId: "sub_1" }, NOW);
    await runOrQueueCleanup(db, null, { action: "cancel_at_period_end", stripeSubscriptionId: "sub_gone" }, NOW);

    const { stripe, requests } = fakeStripe((req) => {
      if (req.path === "/v1/subscriptions/sub_1") return { body: { id: "sub_1", object: "subscription", status: "active", cancel_at_period_end: req.method === "POST" } };
      return undefined; // sub_gone: resource_missing
    });
    expect(await runStripeCleanup(db, stripe, new Date(NOW.getTime() + 2 * HOUR))).toEqual({ done: 2, failed: 0, waiting: 0 });
    const calls = requests.map((r) => `${r.method} ${r.path}`);
    expect(calls.filter((c) => c.endsWith("sub_1"))).toEqual(["GET /v1/subscriptions/sub_1", "POST /v1/subscriptions/sub_1"]);
    expect(calls.filter((c) => c.endsWith("sub_gone"))).toEqual(["GET /v1/subscriptions/sub_gone"]);
    expect(requests.find((r) => r.method === "POST")!.form.get("cancel_at_period_end")).toBe("true");
    expect((await db.select().from(schema.billingAccounts))[0].cancelAtPeriodEnd).toBe(true);
  });

  it("waits without Stripe configured", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await runOrQueueCleanup(db, null, { action: "delete_customer", stripeCustomerId: "cus_1" }, NOW);
    expect(await runStripeCleanup(db, null, new Date(NOW.getTime() + 2 * HOUR))).toEqual({ done: 0, failed: 0, waiting: 1 });
    expect(errors).toHaveBeenLastCalledWith("[billing] Stripe clean-up is waiting", "StripeNotConfigured");
  });
});

describe("billing accounts without a parent", () => {
  async function teenHousehold() {
    const res = await registerStudent(db, { displayName: "Ana", email: "ana@example.com", password: "correct horse battery", birthDate: "2010-05-01", grade: 10 }, NOW);
    if (!res.ok) throw new Error(res.error);
    return (await db.select({ householdId: schema.users.householdId }).from(schema.users).where(eq(schema.users.id, res.value.userId)))[0].householdId!;
  }

  it("are closed by the sweep once the plan no longer gives access", async () => {
    const ended = await teenHousehold();
    await db.insert(schema.billingAccounts).values({ householdId: ended, stripeCustomerId: "cus_ended", status: "canceled" });
    const { stripe, requests } = stripeThat(() => false);

    expect(await sweepBillingWithoutParent(db, stripe, NOW)).toBe(1);
    expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual(["DELETE /v1/customers/cus_ended"]);
    expect(await db.select().from(schema.billingAccounts)).toHaveLength(0);
    // The teen still lives there, so the household stays.
    expect(await db.select().from(schema.households).where(eq(schema.households.id, ended))).toHaveLength(1);
    const audit = (await db.select().from(schema.auditLog)).find((a) => a.action === "billing.customer_deleted");
    expect(audit?.metadata).toEqual({ stripeDeleted: true, noParent: true });
  });

  it("are left alone while the plan still gives access, and a parent's are never touched", async () => {
    const live = await teenHousehold();
    await db.insert(schema.billingAccounts).values({ householdId: live, stripeCustomerId: "cus_live", status: "active", cancelAtPeriodEnd: true });
    const parent = await registerParent(db, { displayName: "Rosa", email: "rosa@example.com", password: "correct horse battery" });
    if (!parent.ok) throw new Error(parent.error);
    const [rosa] = await db.select().from(schema.users).where(eq(schema.users.id, parent.value.userId));
    await db.insert(schema.billingAccounts).values({ householdId: rosa.householdId!, stripeCustomerId: "cus_rosa", status: "canceled" });
    const { stripe, requests } = stripeThat(() => false);

    expect(await sweepBillingWithoutParent(db, stripe, NOW)).toBe(0);
    expect(requests).toHaveLength(0);
    expect(await db.select().from(schema.billingAccounts)).toHaveLength(2);
  });

  it("delete an empty household with its account, and queue the customer when Stripe fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const [empty] = await db.insert(schema.households).values({}).returning();
    await db.insert(schema.billingAccounts).values({ householdId: empty.id, stripeCustomerId: "cus_parked", status: null });
    const { stripe } = stripeThat(() => true);

    expect(await sweepBillingWithoutParent(db, stripe, NOW)).toBe(1);
    expect(await db.select().from(schema.households)).toHaveLength(0);
    expect(await queue()).toEqual([expect.objectContaining({ action: "delete_customer", stripeCustomerId: "cus_parked" })]);
  });
});
