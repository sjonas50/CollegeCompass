import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Db, createTestDb, schema } from "@/db";
import { grantFreeAccess } from "@/lib/access/service";
import { createChildAccount, registerParent, registerStudent } from "@/lib/accounts";
import { deleteEmptyHousehold, deleteParentAccount, deleteStudent, exportStudentData } from "@/lib/privacy";
import { runStripeCleanup } from "./cleanup";
import { fakeStripe } from "./fake-stripe";

// Households are deleted with their last member, and their Stripe customer with them (which
// cancels any subscription). Exports carry the household's access.

const TODAY = new Date("2026-09-24T18:00:00Z");
let db: Db;

beforeEach(async () => {
  db = await createTestDb();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function teen(email = "ana@example.com") {
  const res = await registerStudent(db, { displayName: "Ana", email, password: "correct horse battery", birthDate: "2011-01-15", grade: 10 }, TODAY);
  if (!res.ok) throw new Error(res.error);
  return res.value.userId;
}

async function parentWithKids() {
  const res = await registerParent(db, { displayName: "Rosa", email: "rosa@example.com", password: "correct horse battery" });
  if (!res.ok) throw new Error(res.error);
  const parentId = res.value.userId;
  const kid = async (username: string, birthDate: string, consent: boolean) => {
    const c = await createChildAccount(
      db,
      parentId,
      { displayName: username, username, password: "correct horse battery", birthDate, grade: 8 },
      consent ? { method: "dev_attestation", verificationRef: null } : null,
      TODAY,
    );
    if (!c.ok) throw new Error(c.error);
    return c.value.userId;
  };
  return { parentId, kid };
}

const householdOf = async (userId: string) =>
  (await db.select({ householdId: schema.users.householdId }).from(schema.users).where(eq(schema.users.id, userId)))[0].householdId!;

async function subscribe(householdId: string, customerId = "cus_1") {
  await db.insert(schema.billingAccounts).values({ householdId, stripeCustomerId: customerId, stripeSubscriptionId: "sub_1", status: "active", plan: "monthly" });
}

const DOWN = { status: 500, body: { error: { type: "api_error", message: "Stripe is down" } } };
const cleanupQueue = () => db.select().from(schema.stripeCleanup);
const nextDay = () => new Date(Date.now() + 25 * 60 * 60 * 1000);

describe("a parent leaves while teens stay", () => {
  it("sets the family's renewing plan to end with its paid period", async () => {
    const { parentId, kid } = await parentWithKids();
    const teenId = await kid("teen_one", "2011-01-15", false);
    const householdId = await householdOf(teenId);
    await subscribe(householdId);
    const { stripe, requests } = fakeStripe((req) =>
      req.method === "POST" && req.path === "/v1/subscriptions/sub_1"
        ? { body: { id: "sub_1", object: "subscription", status: "active", cancel_at_period_end: true } }
        : undefined,
    );
    await deleteParentAccount(db, parentId, { stripe });
    const update = requests.find((r) => r.path === "/v1/subscriptions/sub_1");
    expect(update?.form.get("cancel_at_period_end")).toBe("true");
    const [billing] = await db.select().from(schema.billingAccounts).where(eq(schema.billingAccounts.householdId, householdId));
    expect(billing.cancelAtPeriodEnd).toBe(true);
    expect(await householdOf(teenId)).toBe(householdId);
    expect(await cleanupQueue()).toHaveLength(0);
  });

  it("queues the plan's end when Stripe fails, and the daily sweep finishes it", async () => {
    const { parentId, kid } = await parentWithKids();
    const teenId = await kid("teen_one", "2011-01-15", false);
    const householdId = await householdOf(teenId);
    await subscribe(householdId);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    let down = true;
    const { stripe, requests } = fakeStripe((req) => {
      if (down) return DOWN;
      if (req.path === "/v1/subscriptions/sub_1") {
        return { body: { id: "sub_1", object: "subscription", status: "active", cancel_at_period_end: req.method === "POST" } };
      }
      return undefined;
    });

    await deleteParentAccount(db, parentId, { stripe });
    expect(errors).toHaveBeenCalledWith("[billing] couldn't end a plan without a parent", "StripeAPIError");
    expect(await cleanupQueue()).toEqual([
      expect.objectContaining({ action: "cancel_at_period_end", stripeSubscriptionId: "sub_1", stripeCustomerId: null, attempts: 1 }),
    ]);

    down = false;
    expect(await runStripeCleanup(db, stripe, nextDay())).toMatchObject({ done: 1, waiting: 0 });
    expect(requests.at(-1)).toMatchObject({ method: "POST", path: "/v1/subscriptions/sub_1" });
    const [billing] = await db.select().from(schema.billingAccounts).where(eq(schema.billingAccounts.householdId, householdId));
    expect(billing.cancelAtPeriodEnd).toBe(true);
  });

  it("closes a plan that had already ended, keeping the household for the teens", async () => {
    const { parentId, kid } = await parentWithKids();
    const teenId = await kid("teen_one", "2011-01-15", false);
    const householdId = await householdOf(teenId);
    await db.insert(schema.billingAccounts).values({ householdId, stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1", status: "canceled" });
    const { stripe, requests } = stripeThatDeletes();

    await deleteParentAccount(db, parentId, { stripe });
    expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual(["DELETE /v1/customers/cus_1"]);
    expect(await db.select().from(schema.billingAccounts)).toHaveLength(0);
    expect(await householdOf(teenId)).toBe(householdId);
  });
});

function stripeThatDeletes() {
  return fakeStripe((req) =>
    req.method === "DELETE" && req.path.startsWith("/v1/customers/")
      ? { body: { id: req.path.split("/").pop(), object: "customer", deleted: true } }
      : undefined,
  );
}

describe("deleting the last person in a household", () => {
  it("deletes the household, its grants and billing account, and its Stripe customer", async () => {
    const ana = await teen();
    const householdId = await householdOf(ana);
    await grantFreeAccess(db, ana, TODAY);
    await subscribe(householdId);
    const { stripe, requests } = stripeThatDeletes();

    expect(await deleteStudent(db, ana, ana, { stripe })).toBe(true);
    expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual(["DELETE /v1/customers/cus_1"]);
    expect(await db.select().from(schema.households)).toHaveLength(0);
    expect(await db.select().from(schema.accessGrants)).toHaveLength(0);
    expect(await db.select().from(schema.billingAccounts)).toHaveLength(0);
    const audit = (await db.select().from(schema.auditLog)).find((a) => a.action === "billing.customer_deleted");
    expect(audit?.metadata).toEqual({ stripeDeleted: true });
    expect(JSON.stringify(await db.select().from(schema.auditLog))).not.toContain("cus_1");
  });

  it("still deletes everything here when Stripe fails, and queues the customer for the daily sweep", async () => {
    const ana = await teen();
    await subscribe(await householdOf(ana), "cus_private_123");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    let down = true;
    const { stripe, requests } = fakeStripe((req) =>
      down
        ? { status: 500, body: { error: { type: "api_error", message: "cus_private_123 exploded" } } }
        : { body: { id: req.path.split("/").pop(), object: "customer", deleted: true } },
    );

    expect(await deleteStudent(db, ana, ana, { stripe })).toBe(true);
    expect(await db.select().from(schema.households)).toHaveLength(0);
    expect(await db.select().from(schema.billingAccounts)).toHaveLength(0);
    expect(errors).toHaveBeenCalledWith("[billing] couldn't delete a Stripe customer", "StripeAPIError");
    expect(JSON.stringify(errors.mock.calls)).not.toContain("cus_private_123");
    const audit = (await db.select().from(schema.auditLog)).find((a) => a.action === "billing.customer_deleted");
    expect(audit?.metadata).toEqual({ stripeDeleted: false });
    // Only the Stripe id is kept, so the sweep can finish the job.
    const [job] = await cleanupQueue();
    expect(job).toMatchObject({ action: "delete_customer", stripeCustomerId: "cus_private_123", lastError: "StripeAPIError" });
    expect(Object.values(job)).not.toContain(ana);

    down = false;
    expect(await runStripeCleanup(db, stripe, nextDay())).toMatchObject({ done: 1, waiting: 0 });
    expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual(Array(2).fill("DELETE /v1/customers/cus_private_123"));
  });

  it("treats a customer Stripe already deleted as done", async () => {
    const ana = await teen();
    await subscribe(await householdOf(ana));
    const { stripe } = fakeStripe(() => undefined); // 404 resource_missing
    await deleteStudent(db, ana, ana, { stripe });
    const audit = (await db.select().from(schema.auditLog)).find((a) => a.action === "billing.customer_deleted");
    expect(audit?.metadata).toEqual({ stripeDeleted: true });
  });

  it("deletes a household without billing without calling Stripe", async () => {
    const ana = await teen();
    const { stripe, requests } = stripeThatDeletes();
    await deleteStudent(db, ana, ana, { stripe });
    expect(requests).toHaveLength(0);
    expect(await db.select().from(schema.households)).toHaveLength(0);
  });

  it("works without Stripe configured", async () => {
    const ana = await teen();
    await subscribe(await householdOf(ana));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await deleteStudent(db, ana, ana, { stripe: null });
    expect(await db.select().from(schema.households)).toHaveLength(0);
    expect(errors).toHaveBeenCalledWith("[billing] couldn't delete a Stripe customer", "StripeNotConfigured");
    expect(await cleanupQueue()).toEqual([expect.objectContaining({ stripeCustomerId: "cus_1", lastError: "StripeNotConfigured" })]);
  });
});

describe("deleting someone who isn't the last", () => {
  it("keeps the household, access and billing when a parent deletes one child", async () => {
    const { parentId, kid } = await parentWithKids();
    const leo = await kid("leo7", "2014-03-01", true);
    const householdId = await householdOf(parentId);
    await subscribe(householdId);
    const { stripe, requests } = stripeThatDeletes();

    expect(await deleteStudent(db, parentId, leo, { stripe })).toBe(true);
    expect(requests).toHaveLength(0);
    expect(await db.select().from(schema.billingAccounts)).toHaveLength(1);
    expect((await db.select().from(schema.accessGrants)).length).toBeGreaterThan(0);
  });

  it("keeps the billing account with the household when a parent leaves and teens remain", async () => {
    const { parentId, kid } = await parentWithKids();
    const leo = await kid("leo7", "2014-03-01", true);
    const ana = await kid("ana15", "2011-01-15", false);
    const householdId = await householdOf(parentId);
    await subscribe(householdId);
    const { stripe, requests } = stripeThatDeletes();

    expect(await deleteParentAccount(db, parentId, { stripe })).toEqual({ childrenDeleted: 1 });
    // The customer isn't deleted; the only call asks Stripe to end the plan with its paid period.
    expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual(["POST /v1/subscriptions/sub_1"]);
    expect((await db.select({ id: schema.users.id }).from(schema.users)).map((u) => u.id)).toEqual([ana]);
    expect(await householdOf(ana)).toBe(householdId);
    expect(await db.select().from(schema.billingAccounts)).toEqual([expect.objectContaining({ householdId, status: "active" })]);
    expect((await db.select().from(schema.users).where(eq(schema.users.id, leo)))).toHaveLength(0);
  });

  it("deletes the household when a parent leaves and only their under-13 children were in it", async () => {
    const { parentId, kid } = await parentWithKids();
    await kid("leo7", "2014-03-01", true);
    await subscribe(await householdOf(parentId));
    const { stripe, requests } = stripeThatDeletes();

    await deleteParentAccount(db, parentId, { stripe });
    expect(requests.map((r) => r.method)).toEqual(["DELETE"]);
    expect(await db.select().from(schema.households)).toHaveLength(0);
    expect(await db.select().from(schema.billingAccounts)).toHaveLength(0);
  });

  it("never deletes a household someone still belongs to", async () => {
    const ana = await teen();
    expect(await deleteEmptyHousehold(db, await householdOf(ana), { stripe: null })).toBe(false);
    expect(await deleteEmptyHousehold(db, null)).toBe(false);
    expect(await db.select().from(schema.households)).toHaveLength(1);
  });
});

describe("export", () => {
  it("includes the household's access and subscription in each student's export", async () => {
    const { parentId, kid } = await parentWithKids();
    const leo = await kid("leo7", "2014-03-01", true);
    // Now, not TODAY: the trial started when the household was created, so this sorts after it.
    await grantFreeAccess(db, parentId);
    await subscribe(await householdOf(parentId));

    const data = await exportStudentData(db, parentId, leo);
    expect(data?.householdAccess.grants.map((g) => g.kind)).toEqual(["trial", "free_access"]);
    expect(data?.householdAccess.subscription).toMatchObject({ status: "active", plan: "monthly" });
    expect(data?.householdAccess.fullAccess).toBe(true);
    expect(JSON.stringify(data)).not.toMatch(/cus_1|sub_1|householdId/);
    // The student's own export has the same.
    expect((await exportStudentData(db, leo, leo))?.householdAccess.grants).toHaveLength(2);
  });
});
