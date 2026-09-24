import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Db, createTestDb, schema } from "@/db";
import { resetEnvCache } from "@/env";
import { getUserAccess } from "@/lib/access/service";
import { registerParent, registerStudent } from "@/lib/accounts";
import { type FakeStripeRequest, fakeStripe, listObject, subscriptionObject } from "./fake-stripe";
import { handleStripeWebhook } from "./webhook";

// Webhooks: signature checks on the raw body, each event applied once, and the household's billing
// account kept in step with what Stripe says now.

const SECRET = "whsec_test_secret";
const DAY_S = 86_400;
let db: Db;
let parentId: string;
let householdId: string;

beforeEach(async () => {
  vi.stubEnv("STRIPE_PRICE_MONTHLY", "price_monthly");
  vi.stubEnv("STRIPE_PRICE_ANNUAL", "price_annual");
  resetEnvCache();
  db = await createTestDb();
  const res = await registerParent(db, { displayName: "Rosa", email: "rosa@example.com", password: "correct horse battery" });
  if (!res.ok) throw new Error(res.error);
  parentId = res.value.userId;
  householdId = (await db.select().from(schema.users).where(eq(schema.users.id, parentId)))[0].householdId!;
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

/** Stripe, as far as subscriptions go: `live` is what the API returns right now. Customers can be deleted. */
function account(live: ReturnType<typeof subscriptionObject>[], fail = () => false) {
  const fake = fakeStripe((req: FakeStripeRequest) => {
    if (fail()) return { status: 500, body: { error: { type: "api_error", message: "Stripe is down" } } };
    if (req.method === "GET" && req.path === "/v1/subscriptions") {
      return { body: listObject(live.filter((s) => s.customer === req.query.get("customer"))) };
    }
    if (req.method === "DELETE" && req.path.startsWith("/v1/customers/")) {
      return { body: { id: req.path.split("/").pop(), object: "customer", deleted: true } };
    }
    return undefined;
  });
  const listCalls = () => fake.requests.filter((r) => r.path === "/v1/subscriptions").length;
  return { ...fake, listCalls };
}

function signed(stripe: ReturnType<typeof account>["stripe"], id: string, type: string, object: unknown) {
  const payload = JSON.stringify({
    id,
    object: "event",
    type,
    api_version: "2026-08-26.dahlia",
    created: 1_790_000_000,
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    data: { object },
  });
  return { payload, signature: stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET }) };
}

const periodEnd = () => Math.floor(Date.now() / 1000) + 30 * DAY_S;
const billing = async () => (await db.select().from(schema.billingAccounts).where(eq(schema.billingAccounts.householdId, householdId)))[0];
const subscriptionAudits = async () => (await db.select().from(schema.auditLog)).filter((a) => a.action === "billing.subscription_changed");
const afterTrial = () => new Date(Date.now() + 20 * DAY_S * 1000);

async function linkCustomer(customerId = "cus_1") {
  await db.insert(schema.billingAccounts).values({ householdId, stripeCustomerId: customerId });
}

describe("signature", () => {
  it("rejects a missing, wrong or tampered signature without recording anything", async () => {
    const { stripe, requests } = account([]);
    const { payload, signature } = signed(stripe, "evt_1", "customer.subscription.updated", {});
    expect(await handleStripeWebhook(db, stripe, payload, null, SECRET)).toMatchObject({ status: 400 });
    expect(await handleStripeWebhook(db, stripe, payload, signature, "whsec_other")).toMatchObject({ status: 400 });
    expect(await handleStripeWebhook(db, stripe, payload.replace("evt_1", "evt_2"), signature, SECRET)).toMatchObject({ status: 400 });
    const stale = stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET, timestamp: Math.floor(Date.now() / 1000) - 3600 });
    expect(await handleStripeWebhook(db, stripe, payload, stale, SECRET)).toMatchObject({ status: 400 });
    expect(await db.select().from(schema.stripeEvents)).toHaveLength(0);
    expect(requests).toHaveLength(0);
  });
});

describe("subscription events", () => {
  it("update the billing account from Stripe and audit the status only", async () => {
    await linkCustomer();
    const end = periodEnd();
    const sub = subscriptionObject({ id: "sub_1", customer: "cus_1", status: "active", priceId: "price_annual", periodEnd: end });
    const { stripe } = account([sub]);
    const { payload, signature } = signed(stripe, "evt_1", "customer.subscription.created", sub);

    expect(await handleStripeWebhook(db, stripe, payload, signature, SECRET)).toEqual({ status: 200, body: { received: true } });
    expect(await billing()).toMatchObject({
      stripeSubscriptionId: "sub_1",
      status: "active",
      plan: "annual",
      currentPeriodEnd: new Date(end * 1000),
      cancelAtPeriodEnd: false,
    });
    expect((await subscriptionAudits()).map((a) => a.metadata)).toEqual([{ status: "active" }]);
    expect((await getUserAccess(db, parentId, afterTrial())).sources).toEqual(["subscription"]);
  });

  it("apply each event once", async () => {
    await linkCustomer();
    const sub = subscriptionObject({ id: "sub_1", customer: "cus_1", status: "active", periodEnd: periodEnd() });
    const stripeAccount = account([sub]);
    const { payload, signature } = signed(stripeAccount.stripe, "evt_1", "customer.subscription.updated", sub);
    await handleStripeWebhook(db, stripeAccount.stripe, payload, signature, SECRET);
    const again = await handleStripeWebhook(db, stripeAccount.stripe, payload, signature, SECRET);
    expect(again).toEqual({ status: 200, body: { received: true, duplicate: true } });
    expect(stripeAccount.listCalls()).toBe(1);
    expect(await db.select().from(schema.stripeEvents)).toEqual([expect.objectContaining({ id: "evt_1", type: "customer.subscription.updated" })]);
    expect(await subscriptionAudits()).toHaveLength(1);
  });

  it("use Stripe's current state, so an out-of-order event can't undo a payment", async () => {
    await linkCustomer();
    const now = subscriptionObject({ id: "sub_1", customer: "cus_1", status: "active", periodEnd: periodEnd() });
    const { stripe } = account([now]);
    // The "incomplete" created event arrives after the "active" update.
    const late = signed(stripe, "evt_old", "customer.subscription.created", { ...now, status: "incomplete" });
    await handleStripeWebhook(db, stripe, late.payload, late.signature, SECRET);
    expect((await billing()).status).toBe("active");
  });

  it("keep access while past due, and end it when Stripe cancels or gives up", async () => {
    await linkCustomer();
    const live = [subscriptionObject({ id: "sub_1", customer: "cus_1", status: "past_due", periodEnd: periodEnd() })];
    const { stripe } = account(live);
    let n = 0;
    const send = async (status: string, type = "customer.subscription.updated") => {
      live[0] = subscriptionObject({ id: "sub_1", customer: "cus_1", status, periodEnd: periodEnd() });
      const e = signed(stripe, `evt_${++n}`, type, live[0]);
      return handleStripeWebhook(db, stripe, e.payload, e.signature, SECRET);
    };
    await send("past_due");
    expect((await getUserAccess(db, parentId, afterTrial())).full).toBe(true);
    await send("unpaid");
    expect((await getUserAccess(db, parentId, afterTrial())).full).toBe(false);
    await send("active");
    expect((await getUserAccess(db, parentId, afterTrial())).full).toBe(true);
    await send("canceled", "customer.subscription.deleted");
    expect(await billing()).toMatchObject({ status: "canceled", stripeSubscriptionId: "sub_1" });
    expect((await getUserAccess(db, parentId, afterTrial())).full).toBe(false);
    expect((await subscriptionAudits()).map((a) => a.metadata)).toEqual([
      { status: "past_due" },
      { status: "unpaid" },
      { status: "active" },
      { status: "canceled" },
    ]);
  });

  it("record a cancellation at period end", async () => {
    await linkCustomer();
    const sub = subscriptionObject({ id: "sub_1", customer: "cus_1", status: "active", cancelAtPeriodEnd: true, periodEnd: periodEnd() });
    const { stripe } = account([sub]);
    const e = signed(stripe, "evt_1", "customer.subscription.updated", sub);
    await handleStripeWebhook(db, stripe, e.payload, e.signature, SECRET);
    expect(await billing()).toMatchObject({ status: "active", cancelAtPeriodEnd: true });
  });
});

describe("checkout.session.completed", () => {
  it("links a new customer to the household named in the session", async () => {
    const sub = subscriptionObject({ id: "sub_9", customer: "cus_9", status: "active", periodEnd: periodEnd(), metadata: { householdId } });
    const { stripe } = account([sub]);
    const session = { id: "cs_1", object: "checkout.session", mode: "subscription", customer: "cus_9", subscription: "sub_9", client_reference_id: householdId, metadata: { householdId } };
    const e = signed(stripe, "evt_1", "checkout.session.completed", session);
    expect(await handleStripeWebhook(db, stripe, e.payload, e.signature, SECRET)).toMatchObject({ status: 200 });
    expect(await billing()).toMatchObject({ stripeCustomerId: "cus_9", stripeSubscriptionId: "sub_9", status: "active" });
  });

  it("ignores one-time payments", async () => {
    const { stripe, requests } = account([]);
    const e = signed(stripe, "evt_1", "checkout.session.completed", { id: "cs_1", object: "checkout.session", mode: "payment", customer: "cus_9" });
    expect(await handleStripeWebhook(db, stripe, e.payload, e.signature, SECRET)).toEqual({ status: 200, body: { received: true, ignored: true } });
    expect(requests).toHaveLength(0);
  });
});

describe("customers nobody can use", () => {
  const GONE = "00000000-0000-4000-8000-00000000dead";
  const deletes = (requests: FakeStripeRequest[]) => requests.filter((r) => r.method === "DELETE").map((r) => r.path);

  it("deletes a customer whose household was deleted while its plan still bills", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sub = subscriptionObject({ id: "sub_x", customer: "cus_orphan", status: "active", periodEnd: periodEnd(), metadata: { householdId: GONE } });
    const { stripe, requests } = account([sub]);
    const e = signed(stripe, "evt_1", "customer.subscription.updated", sub);

    expect(await handleStripeWebhook(db, stripe, e.payload, e.signature, SECRET)).toEqual({ status: 200, body: { received: true } });
    expect(deletes(requests)).toEqual(["/v1/customers/cus_orphan"]);
    expect(warn).toHaveBeenCalledWith("[billing] deleted a Stripe customer whose household was deleted");
    const audit = (await db.select().from(schema.auditLog)).find((a) => a.action === "billing.customer_deleted");
    expect(audit?.metadata).toEqual({ stripeDeleted: true, householdGone: true });
    expect(await db.select().from(schema.billingAccounts)).toHaveLength(0);
    warn.mockRestore();
  });

  it("only logs a customer it can't place, or whose plan has already ended", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ended = subscriptionObject({ id: "sub_e", customer: "cus_e", status: "canceled", metadata: { householdId: GONE } });
    const unknown = subscriptionObject({ id: "sub_u", customer: "cus_u", status: "active", periodEnd: periodEnd() });
    const { stripe, requests } = account([ended, unknown]);
    for (const [id, sub] of [["evt_1", ended], ["evt_2", unknown]] as const) {
      const e = signed(stripe, id, "customer.subscription.updated", sub);
      expect(await handleStripeWebhook(db, stripe, e.payload, e.signature, SECRET)).toMatchObject({ status: 200 });
    }
    expect(deletes(requests)).toEqual([]);
    expect(warn).toHaveBeenCalledWith("[billing] event for a customer that isn't linked to a household");
    warn.mockRestore();
  });

  it("deletes the customer once a plan left without a parent ends, and keeps the teen's household", async () => {
    const teen = await registerStudent(db, { displayName: "Ana", email: "ana@example.com", password: "correct horse battery", birthDate: "2010-05-01", grade: 10 }, new Date());
    if (!teen.ok) throw new Error(teen.error);
    const [ana] = await db.select().from(schema.users).where(eq(schema.users.id, teen.value.userId));
    await db.insert(schema.billingAccounts).values({ householdId: ana.householdId!, stripeCustomerId: "cus_left", stripeSubscriptionId: "sub_left", status: "active", cancelAtPeriodEnd: true });
    const live = [subscriptionObject({ id: "sub_left", customer: "cus_left", status: "active", cancelAtPeriodEnd: true, periodEnd: periodEnd() })];
    const { stripe, requests } = account(live);

    // Still in its paid period: nothing changes.
    let e = signed(stripe, "evt_1", "customer.subscription.updated", live[0]);
    await handleStripeWebhook(db, stripe, e.payload, e.signature, SECRET);
    expect(deletes(requests)).toEqual([]);

    live[0] = subscriptionObject({ id: "sub_left", customer: "cus_left", status: "canceled", periodEnd: periodEnd() });
    e = signed(stripe, "evt_2", "customer.subscription.deleted", live[0]);
    expect(await handleStripeWebhook(db, stripe, e.payload, e.signature, SECRET)).toEqual({ status: 200, body: { received: true } });
    expect(deletes(requests)).toEqual(["/v1/customers/cus_left"]);
    expect(await db.select().from(schema.billingAccounts)).toHaveLength(0);
    expect(await db.select().from(schema.households).where(eq(schema.households.id, ana.householdId!))).toHaveLength(1);
  });

  it("never closes a parent's own account when their plan ends", async () => {
    await linkCustomer();
    const sub = subscriptionObject({ id: "sub_1", customer: "cus_1", status: "canceled", periodEnd: periodEnd() });
    const { stripe, requests } = account([sub]);
    const e = signed(stripe, "evt_1", "customer.subscription.deleted", sub);
    await handleStripeWebhook(db, stripe, e.payload, e.signature, SECRET);
    expect(deletes(requests)).toEqual([]);
    expect(await billing()).toMatchObject({ stripeCustomerId: "cus_1", status: "canceled" });
  });
});

describe("other events and failures", () => {
  it("answers 200 to events we don't handle", async () => {
    const { stripe } = account([]);
    const e = signed(stripe, "evt_1", "invoice.paid", { id: "in_1", object: "invoice" });
    expect(await handleStripeWebhook(db, stripe, e.payload, e.signature, SECRET)).toEqual({ status: 200, body: { received: true, ignored: true } });
  });

  it("answers 500 without recording the event when Stripe can't be read, so the retry applies it", async () => {
    await linkCustomer();
    let down = true;
    const sub = subscriptionObject({ id: "sub_1", customer: "cus_1", status: "active", periodEnd: periodEnd() });
    const { stripe } = account([sub], () => down);
    const e = signed(stripe, "evt_1", "customer.subscription.updated", sub);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await handleStripeWebhook(db, stripe, e.payload, e.signature, SECRET)).toMatchObject({ status: 500 });
    expect(errors).toHaveBeenCalledWith("[billing] webhook customer.subscription.updated failed", "StripeAPIError");
    errors.mockRestore();
    expect(await db.select().from(schema.stripeEvents)).toHaveLength(0);

    down = false;
    expect(await handleStripeWebhook(db, stripe, e.payload, e.signature, SECRET)).toEqual({ status: 200, body: { received: true } });
    expect((await billing()).status).toBe("active");
  });
});
