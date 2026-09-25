import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Db, createTestDb, schema } from "@/db";
import { resetEnvCache } from "@/env";
import { getUserAccess } from "@/lib/access/service";
import { registerParent, registerStudent } from "@/lib/accounts";
import { ensureCustomer, openBillingPortal, startCheckout, syncCheckoutSession } from "./checkout";
import { type FakeStripeRequest, type FakeStripeResponse, fakeStripe, listObject, subscriptionObject } from "./fake-stripe";
import { clearPriceCache, getPlanPrices, planForPrice, priceLabel } from "./plans";
import { type SubscriptionLike, billingFieldsFrom, pickSubscription, syncCustomer, toSubscriptionStatus } from "./subscriptions";

// Checkout, the Customer Portal, prices and subscription syncing, with Stripe's HTTP faked.

let db: Db;
let parentId: string;
let householdId: string;

beforeEach(async () => {
  vi.stubEnv("STRIPE_PRICE_MONTHLY", "price_monthly");
  vi.stubEnv("STRIPE_PRICE_ANNUAL", "price_annual");
  vi.stubEnv("APP_URL", "https://app.example.com");
  resetEnvCache();
  clearPriceCache();
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

/** A fake Stripe account: customers, checkout sessions, portal sessions, prices and subscriptions. */
function stripeAccount(subscriptions: ReturnType<typeof subscriptionObject>[] = []) {
  let customers = 0;
  const handler = (req: FakeStripeRequest): FakeStripeResponse | undefined => {
    if (req.method === "POST" && req.path === "/v1/customers") return { body: { id: `cus_${++customers}`, object: "customer" } };
    if (req.method === "POST" && req.path === "/v1/checkout/sessions") {
      return { body: { id: "cs_test_1", object: "checkout.session", url: "https://checkout.stripe.com/c/pay/cs_test_1" } };
    }
    if (req.method === "POST" && req.path === "/v1/billing_portal/sessions") {
      return { body: { id: "bps_1", object: "billing_portal.session", url: "https://billing.stripe.com/p/session/test" } };
    }
    if (req.method === "GET" && req.path === "/v1/subscriptions") {
      return { body: listObject(subscriptions.filter((s) => s.customer === req.query.get("customer"))) };
    }
    const price = /^\/v1\/prices\/(price_\w+)$/.exec(req.path);
    if (req.method === "GET" && price) {
      const annual = price[1] === "price_annual";
      return {
        body: {
          id: price[1],
          object: "price",
          active: true,
          currency: "usd",
          unit_amount: annual ? 7999 : 800,
          recurring: { interval: annual ? "year" : "month", interval_count: 1 },
        },
      };
    }
    return undefined;
  };
  return { ...fakeStripe(handler), subscriptions };
}

describe("subscription status mapping", () => {
  it("keeps Stripe's statuses we know and drops the rest", () => {
    for (const s of ["active", "trialing", "past_due", "canceled", "unpaid", "paused", "incomplete", "incomplete_expired"]) {
      expect(toSubscriptionStatus(s)).toBe(s);
    }
    expect(toSubscriptionStatus("something_new")).toBeNull();
  });

  it("reads the plan from our price ids, then the billing interval", () => {
    expect(planForPrice("price_monthly")).toBe("monthly");
    expect(planForPrice("price_annual")).toBe("annual");
    expect(planForPrice("price_old", "year")).toBe("annual");
    expect(planForPrice("price_old", "month")).toBe("monthly");
    expect(planForPrice(null, "week")).toBeNull();
  });

  it("takes the period end from the items, and a scheduled cancellation as the end when it's sooner", () => {
    const base = subscriptionObject({ id: "sub_1", customer: "cus_1", status: "active", priceId: "price_annual", periodEnd: 1_800_000_000 });
    expect(billingFieldsFrom(base as unknown as SubscriptionLike)).toEqual({
      stripeSubscriptionId: "sub_1",
      status: "active",
      plan: "annual",
      currentPeriodEnd: new Date(1_800_000_000_000),
      cancelAtPeriodEnd: false,
    });
    const cancelAt = subscriptionObject({ id: "sub_1", customer: "cus_1", status: "active", periodEnd: 1_800_000_000, cancelAt: 1_795_000_000 });
    expect(billingFieldsFrom(cancelAt as unknown as SubscriptionLike)).toMatchObject({ cancelAtPeriodEnd: true, currentPeriodEnd: new Date(1_795_000_000_000) });
    const atPeriodEnd = subscriptionObject({ id: "sub_1", customer: "cus_1", status: "active", cancelAtPeriodEnd: true });
    expect(billingFieldsFrom(atPeriodEnd as unknown as SubscriptionLike).cancelAtPeriodEnd).toBe(true);
    const unknown = subscriptionObject({ id: "sub_1", customer: "cus_1", status: "mystery" });
    expect(billingFieldsFrom(unknown as unknown as SubscriptionLike).status).toBeNull();
  });

  it("prefers the subscription that gives access, then the newest", () => {
    const old = subscriptionObject({ id: "sub_old", customer: "c", status: "canceled", created: 3 });
    const live = subscriptionObject({ id: "sub_live", customer: "c", status: "active", created: 1 });
    const retrying = subscriptionObject({ id: "sub_retry", customer: "c", status: "past_due", created: 2 });
    const pick = (subs: unknown[]) => pickSubscription(subs as SubscriptionLike[])?.id;
    expect(pick([old, live, retrying])).toBe("sub_live");
    expect(pick([old, retrying])).toBe("sub_retry");
    expect(pick([subscriptionObject({ id: "a", customer: "c", status: "canceled", created: 1 }), old])).toBe("sub_old");
    expect(pick([])).toBeUndefined();
  });
});

describe("prices", () => {
  it("formats whole and partial amounts", () => {
    expect(priceLabel(800, "usd", "month")).toBe("$8 a month");
    expect(priceLabel(7999, "usd", "year")).toBe("$79.99 a year");
    expect(priceLabel(2400, "usd", "month", 3)).toBe("$24 every 3 months");
  });

  it("reads the Price objects from Stripe and caches them for an hour", async () => {
    const { stripe, requests } = stripeAccount();
    const now = Date.now();
    const prices = await getPlanPrices(stripe, now);
    expect(prices.monthly).toMatchObject({ plan: "monthly", priceId: "price_monthly", unitAmount: 800, label: "$8 a month" });
    expect(prices.annual).toMatchObject({ plan: "annual", label: "$79.99 a year" });
    expect(requests).toHaveLength(2);
    await getPlanPrices(stripe, now + 59 * 60_000);
    expect(requests).toHaveLength(2);
    await getPlanPrices(stripe, now + 61 * 60_000);
    expect(requests).toHaveLength(4);
  });

  it("shows no price for a plan that isn't configured or can't be read", async () => {
    vi.stubEnv("STRIPE_PRICE_ANNUAL", "");
    resetEnvCache();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { stripe } = fakeStripe(() => ({ status: 500, body: { error: { type: "api_error", message: "boom" } } }));
    expect(await getPlanPrices(stripe)).toEqual({ monthly: null, annual: null });
    expect(errors).toHaveBeenCalledWith("[billing] couldn't read a price", expect.stringContaining("StripeAPIError"));
    errors.mockRestore();
  });
});

describe("checkout", () => {
  it("creates one Stripe customer per household, carrying only the household id", async () => {
    const { stripe, requests } = stripeAccount();
    expect(await ensureCustomer(db, stripe, householdId, parentId)).toBe("cus_1");
    expect(await ensureCustomer(db, stripe, householdId, parentId)).toBe("cus_1");
    const creates = requests.filter((r) => r.path === "/v1/customers");
    expect(creates).toHaveLength(1);
    expect([...creates[0].form.keys()]).toEqual(["metadata[householdId]"]);
    expect(creates[0].form.get("metadata[householdId]")).toBe(householdId);
    const [account] = await db.select().from(schema.billingAccounts);
    // The parent who created it is its payer.
    expect(account).toMatchObject({ householdId, stripeCustomerId: "cus_1", status: null, payerUserId: parentId });
  });

  it("starts a subscription Checkout tied to the household", async () => {
    const { stripe, requests } = stripeAccount();
    const res = await startCheckout(db, stripe, parentId, "annual");
    expect(res).toEqual({ ok: true, url: "https://checkout.stripe.com/c/pay/cs_test_1" });
    const session = requests.find((r) => r.path === "/v1/checkout/sessions")!.form;
    expect(Object.fromEntries(session)).toEqual({
      mode: "subscription",
      customer: "cus_1",
      client_reference_id: householdId,
      "metadata[householdId]": householdId,
      "subscription_data[metadata][householdId]": householdId,
      // The family is in its 14-day trial, so billing starts when the trial ends.
      "subscription_data[trial_end]": expect.stringMatching(/^\d+$/),
      "line_items[0][price]": "price_annual",
      "line_items[0][quantity]": "1",
      success_url: "https://app.example.com/account/billing/success?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "https://app.example.com/account/billing/canceled",
    });
    const audits = (await db.select().from(schema.auditLog)).filter((a) => a.action === "billing.checkout_started");
    expect(audits).toEqual([expect.objectContaining({ actorUserId: parentId, metadata: { plan: "annual" } })]);
  });

  it("keeps the trial's remaining days, and starts billing now once the trial is over", async () => {
    const [trial] = await db.select().from(schema.accessGrants).where(eq(schema.accessGrants.householdId, householdId));
    const first = stripeAccount();
    await startCheckout(db, first.stripe, parentId, "monthly");
    const withTrial = first.requests.find((r) => r.path === "/v1/checkout/sessions")!.form;
    expect(Number(withTrial.get("subscription_data[trial_end]"))).toBe(Math.floor(trial.endsAt!.getTime() / 1000));

    await db.delete(schema.accessGrants);
    const second = stripeAccount();
    await startCheckout(db, second.stripe, parentId, "monthly");
    expect(second.requests.find((r) => r.path === "/v1/checkout/sessions")!.form.has("subscription_data[trial_end]")).toBe(false);
  });

  it("is for parents only", async () => {
    const { stripe, requests } = stripeAccount();
    const teen = await registerStudent(
      db,
      { displayName: "Ana", email: "ana@example.com", password: "correct horse battery", birthDate: "2010-01-15", grade: 11 },
      new Date("2026-09-24T18:00:00Z"),
    );
    if (!teen.ok) throw new Error(teen.error);
    expect(await startCheckout(db, stripe, teen.value.userId, "monthly")).toEqual({ ok: false, error: "not_parent" });
    expect(await openBillingPortal(db, stripe, teen.value.userId)).toEqual({ ok: false, error: "not_parent" });
    expect(requests).toHaveLength(0);
  });

  it("refuses a second plan and a plan that isn't set up", async () => {
    const { stripe } = stripeAccount();
    vi.stubEnv("STRIPE_PRICE_ANNUAL", "");
    resetEnvCache();
    expect(await startCheckout(db, stripe, parentId, "annual")).toEqual({ ok: false, error: "plan_unavailable" });
    await db.insert(schema.billingAccounts).values({ householdId, stripeCustomerId: "cus_9", payerUserId: parentId, status: "past_due" });
    expect(await startCheckout(db, stripe, parentId, "monthly")).toEqual({ ok: false, error: "already_subscribed" });
    // A plan that ended can be started again.
    await db.update(schema.billingAccounts).set({ status: "canceled" });
    expect(await startCheckout(db, stripe, parentId, "monthly")).toMatchObject({ ok: true });
  });

  it("opens the Customer Portal for the household's customer", async () => {
    const { stripe, requests } = stripeAccount();
    expect(await openBillingPortal(db, stripe, parentId)).toEqual({ ok: false, error: "no_customer" });
    await ensureCustomer(db, stripe, householdId, parentId);
    expect(await openBillingPortal(db, stripe, parentId)).toEqual({ ok: true, url: "https://billing.stripe.com/p/session/test" });
    const portal = requests.find((r) => r.path === "/v1/billing_portal/sessions")!.form;
    expect(Object.fromEntries(portal)).toEqual({ customer: "cus_1", return_url: "https://app.example.com/account/billing" });
  });
});

describe("the parent who pays", () => {
  /** Another parent account in the same household (the app never does this today). */
  async function secondParent() {
    const [other] = await db
      .insert(schema.users)
      .values({ role: "parent", householdId, displayName: "Sam", email: "sam@example.com", passwordHash: "x" })
      .returning({ id: schema.users.id });
    return other.id;
  }

  it("is the only one who can open the portal or check out on the household's customer", async () => {
    const { stripe, requests } = stripeAccount();
    const sam = await secondParent();
    await db.insert(schema.billingAccounts).values({ householdId, stripeCustomerId: "cus_rosa", payerUserId: parentId, status: "canceled" });

    expect(await openBillingPortal(db, stripe, sam)).toEqual({ ok: false, error: "not_payer" });
    expect(await startCheckout(db, stripe, sam, "monthly")).toEqual({ ok: false, error: "not_payer" });
    expect(await ensureCustomer(db, stripe, householdId, sam)).toBeNull();
    expect(requests).toHaveLength(0);
    // Rosa still can.
    expect(await openBillingPortal(db, stripe, parentId)).toMatchObject({ ok: true });
  });

  it("is set to null when the payer deletes their account", async () => {
    const { stripe } = stripeAccount();
    await ensureCustomer(db, stripe, householdId, parentId);
    await db.delete(schema.users).where(eq(schema.users.id, parentId));
    const [account] = await db.select().from(schema.billingAccounts);
    expect(account).toMatchObject({ householdId, stripeCustomerId: "cus_1", payerUserId: null });
  });

  it("can be claimed on an older account by the household's parent, only if Stripe made it for this household", async () => {
    let metadataHousehold = "00000000-0000-4000-8000-000000000001";
    const { stripe, requests } = fakeStripe((req) => {
      if (req.method === "GET" && req.path === "/v1/customers/cus_old") {
        return { body: { id: "cus_old", object: "customer", metadata: { householdId: metadataHousehold } } };
      }
      if (req.path === "/v1/billing_portal/sessions") {
        return { body: { id: "bps_1", object: "billing_portal.session", url: "https://billing.stripe.com/p/session/test" } };
      }
      return undefined;
    });
    await db.insert(schema.billingAccounts).values({ householdId, stripeCustomerId: "cus_old", status: "active" });

    // Made for another household (and moved here): never handed over.
    expect(await openBillingPortal(db, stripe, parentId)).toEqual({ ok: false, error: "not_payer" });
    expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual(["GET /v1/customers/cus_old"]);

    metadataHousehold = householdId;
    expect(await openBillingPortal(db, stripe, parentId)).toMatchObject({ ok: true });
    expect((await db.select().from(schema.billingAccounts))[0].payerUserId).toBe(parentId);
  });
});

describe("returning from Checkout", () => {
  function withSession(session: Record<string, unknown>, subs: ReturnType<typeof subscriptionObject>[]) {
    const account = stripeAccount(subs);
    const { stripe, requests } = fakeStripe((req) => {
      if (req.method === "GET" && req.path === "/v1/checkout/sessions/cs_test_1") return { body: { id: "cs_test_1", object: "checkout.session", ...session } };
      if (req.method === "GET" && req.path === "/v1/subscriptions") return { body: listObject(subs.filter((s) => s.customer === req.query.get("customer"))) };
      return undefined;
    });
    return { stripe, requests, account };
  }

  it("turns on access right away for the household that started the session", async () => {
    const periodEnd = Math.floor(Date.now() / 1000) + 30 * 86_400;
    const sub = subscriptionObject({ id: "sub_1", customer: "cus_new", status: "active", priceId: "price_monthly", periodEnd, metadata: { householdId } });
    const { stripe } = withSession({ mode: "subscription", status: "complete", customer: "cus_new", client_reference_id: householdId }, [sub]);
    const res = await syncCheckoutSession(db, stripe, parentId, "cs_test_1");
    expect(res).toMatchObject({ ok: true, completed: true, sync: { householdId, status: "active", changed: true } });
    const [account] = await db.select().from(schema.billingAccounts);
    expect(account).toMatchObject({ stripeCustomerId: "cus_new", stripeSubscriptionId: "sub_1", status: "active", plan: "monthly" });
    expect((await getUserAccess(db, parentId, new Date(Date.now() + 60 * 86_400_000))).sources).toEqual(["subscription"]);
  });

  it("says whether the parent finished checkout", async () => {
    const { stripe } = withSession({ mode: "subscription", status: "open", customer: "cus_new", client_reference_id: householdId }, []);
    expect(await syncCheckoutSession(db, stripe, parentId, "cs_test_1")).toMatchObject({ ok: true, completed: false });
  });

  it("ignores another household's session and malformed ids", async () => {
    const { stripe, requests } = withSession({ mode: "subscription", customer: "cus_x", client_reference_id: "00000000-0000-4000-8000-00000000ffff" }, []);
    expect(await syncCheckoutSession(db, stripe, parentId, "cs_test_1")).toEqual({ ok: false, error: "not_found" });
    expect(await syncCheckoutSession(db, stripe, parentId, "../customers/cus_1")).toEqual({ ok: false, error: "not_found" });
    expect(requests).toHaveLength(1);
    expect(await db.select().from(schema.billingAccounts)).toHaveLength(0);
  });
});

describe("syncCustomer", () => {
  it("leaves customers it can't tie to a household alone", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { stripe } = stripeAccount([subscriptionObject({ id: "sub_1", customer: "cus_stray", status: "active" })]);
    expect(await syncCustomer(db, stripe, "cus_stray")).toEqual({ householdId: null, status: null, changed: false });
    expect(await syncCustomer(db, stripe, "cus_stray", "not-a-uuid")).toEqual({ householdId: null, status: null, changed: false });
    expect(await db.select().from(schema.billingAccounts)).toHaveLength(0);
    warn.mockRestore();
  });

  it("doesn't let a second customer take over a household's billing account", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await db.insert(schema.billingAccounts).values({ householdId, stripeCustomerId: "cus_first", status: "active" });
    const { stripe } = stripeAccount([subscriptionObject({ id: "sub_2", customer: "cus_second", status: "canceled", metadata: { householdId } })]);
    expect(await syncCustomer(db, stripe, "cus_second", householdId)).toMatchObject({ changed: false });
    const [account] = await db.select().from(schema.billingAccounts);
    expect(account).toMatchObject({ stripeCustomerId: "cus_first", status: "active" });
    warn.mockRestore();
  });

  it("clears the subscription when Stripe has none for the customer", async () => {
    await db.insert(schema.billingAccounts).values({ householdId, stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_gone", status: "active", plan: "monthly" });
    const { stripe } = stripeAccount([]);
    expect(await syncCustomer(db, stripe, "cus_1")).toEqual({ householdId, status: null, changed: true });
    const [account] = await db.select().from(schema.billingAccounts);
    expect(account).toMatchObject({ stripeSubscriptionId: null, status: null, plan: null, currentPeriodEnd: null });
  });
});
