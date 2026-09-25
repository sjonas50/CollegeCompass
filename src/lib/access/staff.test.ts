import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { type Db, createTestDb, schema } from "@/db";
import { createChildAccount, registerParent, registerStudent } from "@/lib/accounts";
import { AdminRequiredError } from "@/lib/admin/access";
import { formatAccessDate } from "./describe";
import { getHouseholdAccess } from "./service";
import { GRANT_ACCESS_USAGE, findHousehold, grantStaffAccess, parseGrantAccessArgs, parseUntil, staffIdByEmail } from "./staff";

// Staff give a family comp or sponsored access with `npm run access:grant`.

const NOW = new Date("2026-09-24T18:00:00Z");
let db: Db;
let adminId: string;

beforeEach(async () => {
  db = await createTestDb();
  const [admin] = await db
    .insert(schema.users)
    .values({ role: "admin", email: "Staff@Example.com", displayName: "Jordan", passwordHash: "x" })
    .returning({ id: schema.users.id });
  adminId = admin.id;
});

async function teen() {
  const res = await registerStudent(db, { displayName: "Ana", email: "Ana@Example.com", password: "correct horse battery", birthDate: "2010-05-01", grade: 10 }, NOW);
  if (!res.ok) throw new Error(res.error);
  return res.value.userId;
}

const householdOf = async (userId: string) =>
  (await db.select({ householdId: schema.users.householdId }).from(schema.users).where(eq(schema.users.id, userId)))[0].householdId!;

describe("access:grant arguments", () => {
  it("reads each flag, as separate or joined values", () => {
    expect(parseGrantAccessArgs(["--by", "staff@example.com", "--household", "ana@example.com", "--kind", "comp", "--until", "2027-06-30"])).toEqual({
      ok: true,
      by: "staff@example.com",
      household: "ana@example.com",
      kind: "comp",
      endsAt: new Date("2027-07-01T00:00:00Z"),
    });
    expect(parseGrantAccessArgs(["--by=staff@example.com", "--household=leo7", "--kind=sponsored", "--until=none"])).toMatchObject({
      ok: true,
      kind: "sponsored",
      endsAt: null,
    });
  });

  it("explains what's wrong", () => {
    expect(parseGrantAccessArgs([])).toEqual({ ok: false, message: GRANT_ACCESS_USAGE });
    expect(parseGrantAccessArgs(["--help"])).toEqual({ ok: false, message: GRANT_ACCESS_USAGE });
    const base = ["--by", "s@example.com", "--household", "leo7"];
    expect(parseGrantAccessArgs([...base, "--kind", "trial", "--until", "none"])).toMatchObject({ message: expect.stringContaining("--kind must be comp or sponsored") });
    expect(parseGrantAccessArgs([...base, "--kind", "comp", "--until", "2027-02-30"])).toMatchObject({ message: expect.stringContaining("--until must be a date") });
    expect(parseGrantAccessArgs([...base, "--kind", "comp", "--until", "June 30"])).toMatchObject({ ok: false });
    expect(parseGrantAccessArgs([...base, "--kind", "--until", "none"])).toMatchObject({ message: expect.stringContaining("--kind needs a value") });
    expect(parseGrantAccessArgs([...base, "--kind", "comp", "--until", "none", "--email", "x"])).toMatchObject({ message: expect.stringContaining("Unknown argument") });
  });

  it("gives access through the whole --until day, shown as that day", () => {
    const endsAt = parseUntil("2027-06-30")!;
    expect(endsAt).toEqual(new Date("2027-07-01T00:00:00Z"));
    expect(formatAccessDate(endsAt)).toBe("June 30, 2027");
    expect(parseUntil("NONE")).toBeNull();
    expect(parseUntil("2027-13-01")).toBeUndefined();
  });
});

describe("finding the household", () => {
  it("by its id, or a student's email or username in any case", async () => {
    const ana = await teen();
    const household = await householdOf(ana);
    expect(await findHousehold(db, household)).toEqual({ householdId: household, studentId: null });
    expect(await findHousehold(db, " ana@example.COM ")).toEqual({ householdId: household, studentId: ana });

    const parent = await registerParent(db, { displayName: "Rosa", email: "rosa@example.com", password: "correct horse battery" });
    if (!parent.ok) throw new Error(parent.error);
    const leo = await createChildAccount(
      db,
      parent.value.userId,
      { displayName: "Leo", username: "Leo_Seven", password: "correct horse battery", birthDate: "2014-03-01", grade: 7 },
      { method: "dev_attestation", verificationRef: null },
      NOW,
    );
    if (!leo.ok) throw new Error(leo.error);
    expect(await findHousehold(db, "leo_seven")).toEqual({ householdId: await householdOf(parent.value.userId), studentId: leo.value.userId });
  });

  it("not by a parent's or staff email, or an id that isn't a household", async () => {
    await registerParent(db, { displayName: "Rosa", email: "rosa@example.com", password: "correct horse battery" });
    expect(await findHousehold(db, "rosa@example.com")).toBeNull();
    expect(await findHousehold(db, "staff@example.com")).toBeNull();
    expect(await findHousehold(db, "00000000-0000-4000-8000-000000000001")).toBeNull();
    expect(await findHousehold(db, "  ")).toBeNull();
  });
});

describe("granting access as staff", () => {
  it("gives the household full access and audits it without personal data", async () => {
    const ana = await teen();
    const household = await householdOf(ana);
    const endsAt = new Date("2027-07-01T00:00:00Z");
    expect(await grantStaffAccess(db, adminId, { household: "ana@example.com", kind: "comp", endsAt }, NOW)).toEqual({
      ok: true,
      householdId: household,
      endsAt,
      forStudent: true,
    });

    const access = await getHouseholdAccess(db, household, new Date("2027-06-30T12:00:00Z"));
    expect(access).toMatchObject({ full: true, sources: ["comp"], other: { kind: "comp", endsAt } });
    const [grant] = await db.select().from(schema.accessGrants).where(eq(schema.accessGrants.kind, "comp"));
    // Made with Ana's email, so it's hers: it goes with her if she leaves the household.
    expect(grant).toMatchObject({ householdId: household, startsAt: NOW, endsAt, grantedByUserId: adminId, forUserId: ana });

    const [entry] = (await db.select().from(schema.auditLog)).filter((a) => a.action === "access.granted_by_staff");
    expect(entry).toMatchObject({ actorUserId: adminId, subjectUserId: null, metadata: { kind: "comp", days: 280 } });
    expect(JSON.stringify(entry)).not.toMatch(/ana|Ana|example|household/i);
  });

  it("is for the whole family when given by household id", async () => {
    const ana = await teen();
    const household = await householdOf(ana);
    expect(await grantStaffAccess(db, adminId, { household, kind: "sponsored", endsAt: null }, NOW)).toMatchObject({ ok: true, forStudent: false });
    const [grant] = await db.select().from(schema.accessGrants).where(eq(schema.accessGrants.kind, "sponsored"));
    expect(grant).toMatchObject({ householdId: household, forUserId: null });
  });

  it("can have no end", async () => {
    const ana = await teen();
    const res = await grantStaffAccess(db, adminId, { household: "ana@example.com", kind: "sponsored", endsAt: null }, NOW);
    expect(res).toMatchObject({ ok: true, endsAt: null });
    expect((await getHouseholdAccess(db, await householdOf(ana), new Date("2040-01-01T00:00:00Z"))).sources).toEqual(["sponsored"]);
    const [entry] = (await db.select().from(schema.auditLog)).filter((a) => a.action === "access.granted_by_staff");
    expect(entry.metadata).toEqual({ kind: "sponsored", noEnd: true });
  });

  it("is only for staff admins, checked in the database", async () => {
    const ana = await teen();
    const input = { household: "ana@example.com", kind: "comp" as const, endsAt: null };
    await expect(grantStaffAccess(db, ana, input, NOW)).rejects.toThrow(AdminRequiredError);
    await expect(grantStaffAccess(db, "not-a-uuid", input, NOW)).rejects.toThrow(AdminRequiredError);
    expect(await db.select().from(schema.accessGrants).where(eq(schema.accessGrants.kind, "comp"))).toHaveLength(0);
  });

  it("refuses a date that has passed and a household it can't find", async () => {
    await teen();
    expect(await grantStaffAccess(db, adminId, { household: "ana@example.com", kind: "comp", endsAt: NOW }, NOW)).toEqual({ ok: false, error: "ended" });
    expect(await grantStaffAccess(db, adminId, { household: "nobody@example.com", kind: "comp", endsAt: null }, NOW)).toEqual({
      ok: false,
      error: "household_not_found",
    });
    expect(await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "access.granted_by_staff"))).toHaveLength(0);
  });

  it("finds the staff member by email, and only staff", async () => {
    expect(await staffIdByEmail(db, " staff@EXAMPLE.com")).toBe(adminId);
    await teen();
    expect(await staffIdByEmail(db, "ana@example.com")).toBeNull();
  });
});
