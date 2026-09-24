import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { type Db, createTestDb, schema } from "@/db";
import { createChildAccount, registerParent, registerStudent } from "@/lib/accounts";
import { formatStartDate } from "./describe";
import { DAY_MS, addMonths, freeAccessRenewalOpens } from "./entitlement";
import { exportHouseholdAccess, freeAccessEligibility, getHouseholdAccess, getUserAccess, grantFreeAccess } from "./service";

// Access rules against a real (in-memory) database: trials at signup and at first check, free
// access and its renewals, and who may ask for it.

const TODAY = new Date("2026-09-24T18:00:00Z");
const FIFTEEN = "2011-01-15";
const TWELVE = "2014-03-01";
let db: Db;

beforeEach(async () => {
  db = await createTestDb();
});

async function teen(email = "ana@example.com", birthDate = FIFTEEN) {
  const res = await registerStudent(db, { displayName: "Ana", email, password: "correct horse battery", birthDate, grade: 10 }, TODAY);
  if (!res.ok) throw new Error(res.error);
  return res.value.userId;
}

async function parent(email = "rosa@example.com") {
  const res = await registerParent(db, { displayName: "Rosa", email, password: "correct horse battery" });
  if (!res.ok) throw new Error(res.error);
  return res.value.userId;
}

async function child(parentId: string, birthDate: string, username: string) {
  const res = await createChildAccount(
    db,
    parentId,
    { displayName: "Leo", username, password: "correct horse battery", birthDate, grade: 7 },
    { method: "dev_attestation", verificationRef: null },
    TODAY,
  );
  if (!res.ok) throw new Error(res.error);
  return res.value.userId;
}

const householdOf = async (userId: string) =>
  (await db.select({ householdId: schema.users.householdId }).from(schema.users).where(eq(schema.users.id, userId)))[0].householdId!;
const grantsOf = async (householdId: string) => db.select().from(schema.accessGrants).where(eq(schema.accessGrants.householdId, householdId));
const audits = async (action: string) => (await db.select().from(schema.auditLog)).filter((a) => a.action === action);

describe("trials at signup", () => {
  it("start with a student's own household and run 14 days from its creation", async () => {
    const ana = await teen();
    const householdId = await householdOf(ana);
    const [household] = await db.select().from(schema.households).where(eq(schema.households.id, householdId));
    const [grant] = await grantsOf(householdId);
    expect(grant).toMatchObject({ kind: "trial", startsAt: household.createdAt });
    expect(grant.endsAt!.getTime() - grant.startsAt.getTime()).toBe(14 * DAY_MS);

    const start = grant.startsAt;
    expect((await getUserAccess(db, ana, start)).full).toBe(true);
    expect((await getUserAccess(db, ana, new Date(start.getTime() + 14 * DAY_MS - 1))).full).toBe(true);
    expect((await getUserAccess(db, ana, new Date(start.getTime() + 14 * DAY_MS))).full).toBe(false);
    // Ending doesn't start a second trial.
    expect(await grantsOf(householdId)).toHaveLength(1);
    expect((await audits("access.trial_started")).map((a) => a.metadata)).toEqual([{ days: 14 }]);
  });

  it("start with a parent's household, and children the parent adds share it", async () => {
    const rosa = await parent();
    const leo = await child(rosa, TWELVE, "leo7");
    const householdId = await householdOf(rosa);
    expect(await householdOf(leo)).toBe(householdId);
    expect(await grantsOf(householdId)).toHaveLength(1);
    const [grant] = await grantsOf(householdId);
    expect((await getUserAccess(db, leo, grant.startsAt)).full).toBe(true);
    expect((await getUserAccess(db, leo, grant.endsAt!)).full).toBe(false);
  });
});

describe("households from before trials", () => {
  async function oldHousehold() {
    const [household] = await db.insert(schema.households).values({}).returning();
    const [user] = await db
      .insert(schema.users)
      .values({ role: "student", householdId: household.id, displayName: "Old", passwordHash: "x", birthDate: FIFTEEN, grade: 10 })
      .returning({ id: schema.users.id });
    return { householdId: household.id, userId: user.id };
  }

  it("get a trial at their first access check, once", async () => {
    const { householdId, userId } = await oldHousehold();
    const first = await getUserAccess(db, userId, TODAY);
    expect(first).toMatchObject({ full: true, sources: ["trial"], trial: { startsAt: TODAY, daysLeft: 14 } });
    const later = new Date(TODAY.getTime() + 20 * DAY_MS);
    expect((await getUserAccess(db, userId, later)).full).toBe(false);
    expect(await grantsOf(householdId)).toHaveLength(1);
    expect((await audits("access.trial_started")).map((a) => a.metadata)).toEqual([{ days: 14, firstCheck: true }]);
  });

  it("get only one trial when several checks happen at once", async () => {
    const { householdId } = await oldHousehold();
    await Promise.all([1, 2, 3, 4].map(() => getHouseholdAccess(db, householdId, TODAY)));
    expect(await grantsOf(householdId)).toHaveLength(1);
  });

  it("don't get a trial if they ever had a billing account", async () => {
    const { householdId } = await oldHousehold();
    await db.insert(schema.billingAccounts).values({ householdId, stripeCustomerId: "cus_old", status: "canceled" });
    expect((await getHouseholdAccess(db, householdId, TODAY)).full).toBe(false);
    expect(await grantsOf(householdId)).toHaveLength(0);
  });
});

describe("users without a household", () => {
  it("have no access and get no trial", async () => {
    const [user] = await db.insert(schema.users).values({ role: "student", displayName: "X", passwordHash: "x" }).returning();
    expect(await getUserAccess(db, user.id, TODAY)).toMatchObject({ householdId: null, full: false });
    expect(await db.select().from(schema.accessGrants)).toHaveLength(0);
    expect((await getUserAccess(db, "00000000-0000-4000-8000-00000000abcd", TODAY)).full).toBe(false);
  });
});

describe("free access", () => {
  it("can be turned on by a parent, for the whole household, for 12 months", async () => {
    const rosa = await parent();
    const leo = await child(rosa, TWELVE, "leo7");
    const now = new Date(Date.now() + 30 * DAY_MS); // after the trial
    expect((await getUserAccess(db, leo, now)).full).toBe(false);

    const res = await grantFreeAccess(db, rosa, now);
    expect(res).toEqual({ ok: true, endsAt: addMonths(now, 12), renewal: false });
    expect((await getUserAccess(db, leo, now)).full).toBe(true);
    expect((await getUserAccess(db, leo, addMonths(now, 12))).full).toBe(false);

    const [grant] = (await grantsOf(await householdOf(rosa))).filter((g) => g.kind === "free_access");
    expect(grant.grantedByUserId).toBe(rosa);
    // No reason is asked for or kept: the audit says only how long and whether it was a renewal.
    const [entry] = await audits("access.free_access_granted");
    expect(entry).toMatchObject({ actorUserId: rosa, metadata: { months: 12, renewal: false } });
  });

  it("can be turned on by a student who is 13 or older", async () => {
    const ana = await teen();
    expect((await freeAccessEligibility(db, ana, TODAY)).ok).toBe(true);
    expect((await grantFreeAccess(db, ana, TODAY)).ok).toBe(true);
  });

  it("can't be turned on by a student under 13, who is asked to go to their parent", async () => {
    const rosa = await parent();
    const leo = await child(rosa, TWELVE, "leo7");
    expect(await freeAccessEligibility(db, leo, TODAY)).toMatchObject({ ok: false, error: "under_13" });
    expect(await grantFreeAccess(db, leo, TODAY)).toMatchObject({ ok: false, error: "under_13" });
    expect((await grantsOf(await householdOf(leo))).filter((g) => g.kind === "free_access")).toHaveLength(0);
  });

  it("goes by the student's age today, so a child who turns 13 can ask", async () => {
    const rosa = await parent();
    const leo = await child(rosa, "2013-10-01", "leo7");
    expect((await freeAccessEligibility(db, leo, TODAY)).ok).toBe(false);
    expect((await freeAccessEligibility(db, leo, new Date("2026-10-01T12:00:00Z"))).ok).toBe(true);
  });

  it("can't be asked for by staff roles or strangers", async () => {
    const [admin] = await db.insert(schema.users).values({ role: "admin", displayName: "A", passwordHash: "x" }).returning();
    expect(await grantFreeAccess(db, admin.id, TODAY)).toMatchObject({ ok: false, error: "not_allowed" });
    expect(await grantFreeAccess(db, "00000000-0000-4000-8000-00000000abcd", TODAY)).toMatchObject({ ok: false, error: "not_allowed" });
  });

  it("renews only in its last 30 days, adding the months to the current end", async () => {
    const rosa = await parent();
    const first = await grantFreeAccess(db, rosa, TODAY);
    if (!first.ok) throw new Error(first.error);

    const early = new Date(first.endsAt.getTime() - 31 * DAY_MS);
    const refused = await grantFreeAccess(db, rosa, early);
    expect(refused).toEqual({ ok: false, error: "not_yet_renewable", renewableFrom: freeAccessRenewalOpens(first.endsAt) });

    const inWindow = new Date(first.endsAt.getTime() - 10 * DAY_MS);
    const renewed = await grantFreeAccess(db, rosa, inWindow);
    expect(renewed).toEqual({ ok: true, endsAt: addMonths(first.endsAt, 12), renewal: true });
    const access = await getUserAccess(db, rosa, new Date(first.endsAt.getTime() + DAY_MS));
    expect(access).toMatchObject({ full: true, sources: ["free_access"] });
    // Right after renewing, it can't be renewed again.
    expect(await grantFreeAccess(db, rosa, inWindow)).toMatchObject({ ok: false, error: "not_yet_renewable" });
  });

  it("renews on the day it says it will, even for a family on the East Coast", async () => {
    const rosa = await parent();
    // Turned on at 11:30 pm Eastern on September 23, 2026.
    const first = await grantFreeAccess(db, rosa, new Date("2026-09-24T03:30:00Z"));
    if (!first.ok) throw new Error(first.error);
    // Noon Eastern on August 24, 2027: not yet, and the date given is August 25.
    const refused = await grantFreeAccess(db, rosa, new Date("2027-08-24T16:00:00Z"));
    expect(refused).toEqual({ ok: false, error: "not_yet_renewable", renewableFrom: new Date("2027-08-25T00:00:00Z") });
    expect(!refused.ok && refused.renewableFrom && formatStartDate(refused.renewableFrom)).toBe("August 25, 2027");
    // Just after midnight Eastern on August 25, it works.
    expect(await grantFreeAccess(db, rosa, new Date("2027-08-25T04:05:00Z"))).toMatchObject({ ok: true, renewal: true });
  });

  it("can be turned on again after it ended", async () => {
    const ana = await teen();
    const first = await grantFreeAccess(db, ana, TODAY);
    if (!first.ok) throw new Error(first.error);
    const later = new Date(first.endsAt.getTime() + 40 * DAY_MS);
    expect(await grantFreeAccess(db, ana, later)).toEqual({ ok: true, endsAt: addMonths(later, 12), renewal: false });
  });

  it("adds only one year when submitted twice at once", async () => {
    const rosa = await parent();
    const results = await Promise.all([grantFreeAccess(db, rosa, TODAY), grantFreeAccess(db, rosa, TODAY)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect((await grantsOf(await householdOf(rosa))).filter((g) => g.kind === "free_access")).toHaveLength(1);
  });
});

describe("export", () => {
  it("lists each grant's kind and dates and the subscription's status, plan and period end, without Stripe ids", async () => {
    const rosa = await parent();
    const householdId = await householdOf(rosa);
    // Now, not TODAY: the trial started when the household was created, so this sorts after it.
    await grantFreeAccess(db, rosa);
    const periodEnd = new Date("2026-10-24T00:00:00Z");
    await db.insert(schema.billingAccounts).values({
      householdId,
      stripeCustomerId: "cus_secret",
      stripeSubscriptionId: "sub_secret",
      status: "active",
      plan: "annual",
      currentPeriodEnd: periodEnd,
    });

    const data = await exportHouseholdAccess(db, householdId, TODAY);
    expect(data.fullAccess).toBe(true);
    expect(data.grants.map((g) => g.kind)).toEqual(["trial", "free_access"]);
    expect(Object.keys(data.grants[0]).sort()).toEqual(["endsAt", "kind", "startsAt"]);
    expect(data.subscription).toEqual({ status: "active", plan: "annual", currentPeriodEnd: periodEnd, cancelAtPeriodEnd: false });
    expect(JSON.stringify(data)).not.toMatch(/cus_|sub_|grantedBy/);
    expect(await exportHouseholdAccess(db, null)).toEqual({ fullAccess: false, grants: [], subscription: null });
  });
});
