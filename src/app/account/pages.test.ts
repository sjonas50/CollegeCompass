import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AccessPage from "@/app/account/access/page";
import CheckoutCanceledPage from "@/app/account/billing/canceled/page";
import BillingPage from "@/app/account/billing/page";
import CheckoutSuccessPage from "@/app/account/billing/success/page";
import FreeAccessPage from "@/app/account/free-access/page";
import { type Db, createTestDb, schema } from "@/db";
import { resetEnvCache } from "@/env";
import { CRISIS_LINE, formatAccessDate } from "@/lib/access/describe";
import { grantFreeAccess } from "@/lib/access/service";
import type { SessionUser } from "@/lib/auth/sessions";
import { type FakeStripeRequest, fakeStripe, listObject, subscriptionObject } from "@/lib/billing/fake-stripe";
import { clearPriceCache } from "@/lib/billing/plans";
import type { Stripe } from "@/lib/billing/stripe";

// Server-rendered checks for the account pages, with the session, database and Stripe mocked.

const state = vi.hoisted(() => ({ db: null as Db | null, user: null as SessionUser | null, stripe: null as unknown }));

vi.mock("@/db", async (original) => ({ ...(await original<typeof import("@/db")>()), getDb: async () => state.db }));
vi.mock("@/lib/auth/dal", () => ({ requireUser: async () => state.user, getCurrentUser: async () => state.user }));
vi.mock("@/lib/billing/stripe", async (original) => ({
  ...(await original<typeof import("@/lib/billing/stripe")>()),
  getStripe: () => state.stripe as Stripe | null,
}));

const DAY_MS = 86_400_000;
let db: Db;

beforeEach(async () => {
  db = await createTestDb();
  state.db = db;
  clearPriceCache();
});

afterEach(() => {
  state.db = null;
  state.user = null;
  state.stripe = null;
  vi.unstubAllEnvs();
  resetEnvCache();
});

async function signIn(role: "student" | "parent", { trial = "ended", birthDate = "2010-01-15" }: { trial?: "running" | "ended"; birthDate?: string } = {}) {
  const [household] = await db.insert(schema.households).values({}).returning();
  const start = trial === "running" ? new Date(Date.now() - 4 * DAY_MS) : new Date(Date.now() - 30 * DAY_MS);
  await db.insert(schema.accessGrants).values({ householdId: household.id, kind: "trial", startsAt: start, endsAt: new Date(start.getTime() + 14 * DAY_MS) });
  const [user] = await db
    .insert(schema.users)
    .values({ role, householdId: household.id, displayName: "Sam", passwordHash: "x", birthDate: role === "student" ? birthDate : null, grade: role === "student" ? 8 : null, gradeSchoolYear: 2026 })
    .returning({ id: schema.users.id });
  state.user = { id: user.id, role, displayName: "Sam", username: null, householdId: household.id, parentManaged: false, grade: role === "student" ? 8 : null };
  return { userId: user.id, householdId: household.id };
}

function withStripe(subscriptions: ReturnType<typeof subscriptionObject>[] = [], session?: Record<string, unknown>) {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fake");
  vi.stubEnv("STRIPE_PRICE_MONTHLY", "price_monthly");
  vi.stubEnv("STRIPE_PRICE_ANNUAL", "price_annual");
  resetEnvCache();
  const fake = fakeStripe((req: FakeStripeRequest) => {
    const price = /^\/v1\/prices\/(price_\w+)$/.exec(req.path);
    if (price) {
      const annual = price[1] === "price_annual";
      return {
        body: { id: price[1], object: "price", active: true, currency: "usd", unit_amount: annual ? 8000 : 800, recurring: { interval: annual ? "year" : "month", interval_count: 1 } },
      };
    }
    if (req.path === "/v1/subscriptions") return { body: listObject(subscriptions.filter((s) => s.customer === req.query.get("customer"))) };
    if (session && req.path === `/v1/checkout/sessions/${session.id}`) return { body: { object: "checkout.session", ...session } };
    return undefined;
  });
  state.stripe = fake.stripe;
  return fake;
}

async function redirectOf(call: () => Promise<unknown>): Promise<string | null> {
  try {
    await call();
    return null;
  } catch (error) {
    const digest = (error as { digest?: unknown }).digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT;")) return digest.split(";")[2];
    throw error;
  }
}

const text = (html: string) =>
  html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
const render = async (node: Promise<ReactNode> | ReactNode) => renderToStaticMarkup(await node);
const heading = (html: string) => text(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? "").trim();
const props = <T,>(searchParams: object = {}) => ({ params: Promise.resolve({}), searchParams: Promise.resolve(searchParams) }) as T;
const accessPage = (sp: object = {}) => render(AccessPage(props<PageProps<"/account/access">>(sp)));
const billingPage = (sp: object = {}) => render(BillingPage(props<PageProps<"/account/billing">>(sp)));

describe("/account/access", () => {
  it("shows a locked teen what's free, both ways to unlock, and the crisis line", async () => {
    await signIn("student");
    withStripe();
    const html = await accessPage();
    const t = text(html);
    expect(t).toContain("Unlock the rest of College Compass");
    expect(t).toMatch(/Your free trial ended on \w+ \d+, \d{4}\./);
    expect(t).toContain("Ask a parent or guardian");
    expect(t).toContain("A parent or guardian can choose a plan");
    expect(t).toContain("students can't subscribe themselves");
    expect(t).toContain("If cost is a problem, your family can use College Compass for free.");
    expect(html).toContain('href="/account/free-access"');
    expect(t).toContain("Always free");
    for (const href of ["/careers", "/colleges", "/aid", "/dashboard"]) expect(html).toContain(`href="${href}"`);
    expect(t).toContain(CRISIS_LINE);
    expect(html).toContain('href="sms:988"');
  });

  it("without paid plans, offers only free access, never a plan a parent can't choose", async () => {
    for (const trial of ["running", "ended"] as const) {
      await signIn("student", { trial });
      const t = text(await accessPage());
      expect(t).not.toContain("Ask a parent or guardian");
      expect(t).not.toContain("choose a plan");
      expect(t).toContain("Your family can use College Compass for free.");
      expect(t).not.toContain("If cost is a problem");
    }
    // The same with a Stripe key but no prices, when the billing page doesn't offer plans either.
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fake");
    resetEnvCache();
    state.stripe = fakeStripe(() => undefined).stripe;
    await signIn("student");
    expect(text(await accessPage())).not.toContain("choose a plan");
    await signIn("parent");
    expect(text(await billingPage())).toContain("Paid plans aren't available yet.");
  });

  it("tells a student under 13 to ask their parent for free access", async () => {
    await signIn("student", { birthDate: "2014-03-01" });
    const html = await accessPage();
    expect(text(html)).toContain("Ask your parent or guardian to turn on free access from their account");
    expect(html).not.toContain('href="/account/free-access"');
    expect(text(html)).toContain(CRISIS_LINE);
    withStripe();
    expect(text(await accessPage())).toContain("If cost is a problem, ask your parent or guardian to turn on free access");
  });

  it("counts down a running trial and offers ways to keep access after it", async () => {
    await signIn("student", { trial: "running" });
    withStripe();
    const t = text(await accessPage({ free: undefined }));
    expect(t).toContain("Your College Compass access");
    expect(t).toContain("Your free trial has 10 days left.");
    expect(t).toContain("Keep full access after your trial");
    expect(t).toContain("Ask a parent or guardian");
  });

  it("confirms free access", async () => {
    const { userId } = await signIn("student");
    await grantFreeAccess(db, userId);
    const t = text(await accessPage({ free: "on" }));
    expect(t).toContain("Free access is on for your family. Everything is unlocked.");
    expect(t).toMatch(/Your family has free access until/);
    expect(t).not.toContain("How to unlock it");
  });

  it("sends parents to billing", async () => {
    await signIn("parent");
    expect(await redirectOf(() => accessPage())).toBe("/account/billing");
  });
});

describe("/account/free-access", () => {
  it("is one checkbox for a teen or a parent", async () => {
    await signIn("student");
    const html = await render(FreeAccessPage());
    expect(html).toContain('name="statement"');
    expect(text(html)).toContain("Our family qualifies for free or reduced-price school meals, SNAP, Medicaid, or similar help");
    expect(text(html)).toContain("We don't ask for proof and we don't save a reason.");
    expect(text(html)).toContain("Turn on free access");
  });

  it("asks a student under 13 to go to their parent", async () => {
    await signIn("student", { birthDate: "2014-03-01" });
    const html = await render(FreeAccessPage());
    expect(html).not.toContain('name="statement"');
    expect(text(html)).toContain("Please ask your parent or guardian to turn on free access");
  });

  it("tells a student under 13 when the family already has free access, instead of asking a parent for it", async () => {
    const { householdId } = await signIn("student", { birthDate: "2014-03-01" });
    const endsAt = new Date(Date.now() + 200 * DAY_MS);
    await db.insert(schema.accessGrants).values({ householdId, kind: "free_access", startsAt: new Date(Date.now() - 165 * DAY_MS), endsAt });
    let t = text(await render(FreeAccessPage()));
    expect(t).toContain(`Your family already has free access until ${formatAccessDate(endsAt)}.`);
    expect(t).not.toContain("Please ask your parent");
    expect(t).not.toContain("renew");

    // In its last days, only a parent can renew it.
    const other = await signIn("student", { birthDate: "2014-03-01" });
    const soon = new Date(Date.now() + 10 * DAY_MS);
    await db
      .insert(schema.accessGrants)
      .values({ householdId: other.householdId, kind: "free_access", startsAt: new Date(Date.now() - 355 * DAY_MS), endsAt: soon });
    const html = await render(FreeAccessPage());
    t = text(html);
    expect(t).toContain(`Your family already has free access until ${formatAccessDate(soon)}. Your parent or guardian can renew it from their College Compass account.`);
    expect(html).not.toContain('name="statement"');
    expect(heading(html)).toBe("Free access");
  });

  it("says when free access can next be renewed", async () => {
    const { userId } = await signIn("parent");
    await grantFreeAccess(db, userId);
    const html = await render(FreeAccessPage());
    expect(text(html)).toMatch(/Your family already has free access until .+\. You can renew it starting .+\./);
    // Not titled "Renew" while renewing isn't open yet.
    expect(heading(html)).toBe("Free access");
  });

  it("is titled Renew once free access can be renewed", async () => {
    const { householdId } = await signIn("parent");
    expect(heading(await render(FreeAccessPage()))).toBe("Free access");
    await db
      .insert(schema.accessGrants)
      .values({ householdId, kind: "free_access", startsAt: new Date(Date.now() - 350 * DAY_MS), endsAt: new Date(Date.now() + 10 * DAY_MS) });
    const html = await render(FreeAccessPage());
    expect(heading(html)).toBe("Renew free access");
    expect(html).toContain('name="statement"');
  });
});

describe("/account/billing", () => {
  it("without Stripe, says paid plans aren't available yet and points to free access", async () => {
    await signIn("parent");
    const html = await billingPage();
    const t = text(html);
    expect(t).toContain("Paid plans aren't available yet.");
    expect(html).toContain('href="/account/free-access"');
    expect(html).not.toContain('name="plan"');
  });

  it("offers the monthly and yearly plans at Stripe's prices", async () => {
    await signIn("parent");
    const { requests } = withStripe();
    const html = await billingPage();
    const t = text(html);
    expect(t).toContain("$8 a month");
    expect(t).toContain("$80 a year");
    expect(t).toContain("Choose monthly");
    expect(t).toContain("Choose yearly");
    expect(html).toContain('value="monthly"');
    expect(t).toContain("We never see or store your card details.");
    expect(requests.every((r) => r.method === "GET")).toBe(true);
  });

  it("shows a subscribed parent their plan and the Customer Portal", async () => {
    const { householdId } = await signIn("parent");
    withStripe();
    await db.insert(schema.billingAccounts).values({
      householdId,
      stripeCustomerId: "cus_1",
      status: "active",
      plan: "annual",
      currentPeriodEnd: new Date("2027-09-24T18:00:00Z"),
    });
    const t = text(await billingPage());
    expect(t).toContain("Your yearly plan is active. It renews on September 24, 2027.");
    expect(t).toContain("Manage billing");
    expect(t).not.toContain("Choose monthly");
  });

  it("offers the Customer Portal only to the parent who pays", async () => {
    const { householdId } = await signIn("parent");
    withStripe();
    const [payer] = await db.insert(schema.households).values({}).returning();
    const [other] = await db
      .insert(schema.users)
      .values({ role: "parent", householdId: payer.id, displayName: "Rosa", email: "rosa@example.com", passwordHash: "x" })
      .returning({ id: schema.users.id });
    await db.insert(schema.billingAccounts).values({ householdId, stripeCustomerId: "cus_1", payerUserId: other.id, status: "active", plan: "monthly" });
    const t = text(await billingPage());
    expect(t).toContain("This plan was set up from another account, so it can't be changed here.");
    expect(t).not.toContain("Manage billing");

    // A plan that ended: no portal for receipts either.
    await db.update(schema.billingAccounts).set({ status: "canceled" });
    expect(text(await billingPage())).not.toContain("Manage billing");
  });

  it("doesn't pitch a plan to a family already on free access", async () => {
    const { userId } = await signIn("parent", { trial: "running" });
    await grantFreeAccess(db, userId);
    // No plans to choose: no plan section at all, only the free access that's running.
    let t = text(await billingPage());
    expect(t).not.toContain("Choose a plan");
    expect(t).not.toContain("Paid plans aren't available yet");
    expect(t).not.toContain("A plan unlocks");
    expect(t).toMatch(/Your family has free access until .+\. You can renew it starting .+\./);

    // Plans on: still there to choose, without listing what the family already has.
    withStripe();
    t = text(await billingPage());
    expect(t).toContain("Choose monthly");
    expect(t).not.toContain("A plan unlocks");
  });

  it("lists what a plan unlocks during a trial or after it ends", async () => {
    withStripe();
    for (const trial of ["running", "ended"] as const) {
      await signIn("parent", { trial });
      const t = text(await billingPage());
      expect(t).toContain("Choose a plan");
      expect(t).toContain("A plan unlocks");
    }
  });

  it("without paid plans, talks about full access, not a plan", async () => {
    for (const trial of ["running", "ended"] as const) {
      await signIn("parent", { trial });
      const html = await billingPage();
      const t = text(html);
      expect(html).toContain('<h2 id="plan-heading" class="text-lg font-medium">Full access</h2>');
      expect(t).toContain("Full access unlocks");
      expect(t).toContain(`Paid plans aren't available yet. Your family can ${trial === "running" ? "keep" : "get"} full access with free access, below.`);
      expect(t).not.toContain("Choose a plan");
      expect(t).not.toContain("A plan unlocks");
    }
  });

  it("explains errors from checkout", async () => {
    await signIn("parent");
    expect(text(await billingPage({ error: "stripe" }))).toContain("We couldn't reach our payment service.");
    expect(text(await billingPage({ error: "not_payer" }))).toContain("This plan was set up from another account");
  });

  it("sends students to their access page", async () => {
    await signIn("student");
    expect(await redirectOf(() => billingPage())).toBe("/account/access");
  });
});

describe("returning from Checkout", () => {
  const successPage = (sp: object = {}) => render(CheckoutSuccessPage(props<PageProps<"/account/billing/success">>(sp)));
  const session = (householdId: string, extra: Record<string, unknown> = {}) => ({
    id: "cs_test_1",
    mode: "subscription",
    status: "complete",
    customer: "cus_1",
    client_reference_id: householdId,
    created: Math.floor(Date.now() / 1000) - 60,
    ...extra,
  });

  it("confirms the plan right away", async () => {
    const { householdId } = await signIn("parent");
    await db.insert(schema.billingAccounts).values({ householdId, stripeCustomerId: "cus_1" });
    withStripe(
      [subscriptionObject({ id: "sub_1", customer: "cus_1", status: "active", periodEnd: Math.floor(Date.now() / 1000) + 30 * 86_400 })],
      session(householdId),
    );
    const t = text(await successPage({ session_id: "cs_test_1" }));
    expect(t).toContain("Thank you! Your plan is active.");
    expect(t).toContain("Stripe emails your receipt.");
  });

  it("says it's still confirming a finished checkout when Stripe hasn't made the plan yet", async () => {
    const { householdId } = await signIn("parent");
    withStripe([], session(householdId));
    const t = text(await successPage({ session_id: "cs_test_1" }));
    expect(t).toContain("Thank you! We're confirming your payment.");
  });

  it("thanks nobody for a checkout that wasn't finished, isn't theirs, or can't be checked", async () => {
    const { householdId } = await signIn("parent");
    const cases: [Record<string, unknown> | undefined, object][] = [
      [undefined, {}], // no session id
      [undefined, { session_id: "cs_test_made_up" }], // Stripe doesn't know it
      [session(householdId, { status: "open" }), { session_id: "cs_test_1" }], // never paid
      [session("00000000-0000-4000-8000-00000000ffff"), { session_id: "cs_test_1" }], // another family's
      [undefined, { session_id: "../customers/cus_1" }],
    ];
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const [stripeSession, sp] of cases) {
      withStripe([], stripeSession);
      const t = text(await successPage(sp));
      expect(t).not.toContain("Thank you");
      expect(t).not.toContain("Stripe emails your receipt");
      expect(t).toContain("Plan and billing shows your family's plan and access.");
    }
    quiet.mockRestore();
  });

  it("doesn't thank a parent again for an old checkout, say from the browser's history", async () => {
    const { householdId } = await signIn("parent");
    await db.insert(schema.billingAccounts).values({ householdId, stripeCustomerId: "cus_1" });
    // Paid three days ago, and the plan was canceled since.
    const old = session(householdId, { created: Math.floor(Date.now() / 1000) - 3 * 86_400 });
    withStripe([subscriptionObject({ id: "sub_1", customer: "cus_1", status: "canceled" })], old);
    let t = text(await successPage({ session_id: "cs_test_1" }));
    expect(t).not.toContain("Thank you");
    expect(t).not.toContain("We're confirming your payment");
    expect(t).toContain("Plan and billing shows your family's plan and access.");

    // Still a day later than the checkout link could have been used.
    withStripe([], session(householdId, { created: Math.floor(Date.now() / 1000) - 86_400 - 60 }));
    t = text(await successPage({ session_id: "cs_test_1" }));
    expect(t).not.toContain("Thank you");
  });

  it("sends a parent to Plan and billing when paid plans are off", async () => {
    await signIn("parent");
    expect(await redirectOf(() => successPage({ session_id: "cs_test_1" }))).toBe("/account/billing");
    expect(await redirectOf(() => render(CheckoutCanceledPage()))).toBe("/account/billing");
    // A Stripe key but no prices: no plan to come back to either.
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fake");
    resetEnvCache();
    state.stripe = fakeStripe(() => undefined).stripe;
    expect(await redirectOf(() => render(CheckoutCanceledPage()))).toBe("/account/billing");
  });

  it("reassures a parent who canceled", async () => {
    await signIn("parent");
    withStripe();
    const t = text(await render(CheckoutCanceledPage()));
    expect(t).toContain("No problem. You weren't charged.");
    expect(t).toContain("You can choose a plan any time from Plan and billing.");
  });
});
