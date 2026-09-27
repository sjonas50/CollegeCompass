import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Db, createTestDb, schema } from "@/db";
import { resetEnvCache } from "@/env";
import { registerStudent } from "@/lib/accounts";
import { AdminRequiredError } from "@/lib/admin/access";
import { BETA_PLANNER_USAGE, parseBetaPlannerArgs, plannerPathEnabled, runBetaPlanner, setPlannerBeta } from "./beta";

// The class planner's "Your path" is in beta: households staff mark with `npm run beta:planner`, or
// everyone with PLANNER_PATH=everyone. Staff accounts have no page that shows a path, so the flag
// isn't on for them either (round 10): staff preview it with a test household.

const NOW = new Date("2026-09-25T18:00:00Z");
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

afterEach(() => {
  delete process.env.PLANNER_PATH;
  resetEnvCache();
});

async function teen() {
  const res = await registerStudent(db, { displayName: "Ana", email: "Ana@Example.com", password: "correct horse battery", birthDate: "2010-05-01", grade: 10 }, NOW);
  if (!res.ok) throw new Error(res.error);
  return res.value.userId;
}

const householdOf = async (userId: string) =>
  (await db.select({ householdId: schema.users.householdId }).from(schema.users).where(eq(schema.users.id, userId)))[0].householdId!;

describe("beta:planner arguments", () => {
  it("reads --by and --household, joined or separate, and --off", () => {
    expect(parseBetaPlannerArgs(["--by", "staff@example.com", "--household", "ana@example.com"])).toEqual({ ok: true, by: "staff@example.com", household: "ana@example.com", on: true });
    expect(parseBetaPlannerArgs(["--by=staff@example.com", "--household=leo7", "--off"])).toEqual({ ok: true, by: "staff@example.com", household: "leo7", on: false });
  });

  it("explains what's wrong", () => {
    expect(parseBetaPlannerArgs([])).toEqual({ ok: false, message: BETA_PLANNER_USAGE });
    expect(parseBetaPlannerArgs(["--help"])).toEqual({ ok: false, message: BETA_PLANNER_USAGE });
    expect(parseBetaPlannerArgs(["--household", "leo7"])).toEqual({ ok: false, message: BETA_PLANNER_USAGE });
    expect(parseBetaPlannerArgs(["--by", "s@example.com", "--household"])).toMatchObject({ message: expect.stringContaining("--household needs a value") });
    expect(parseBetaPlannerArgs(["--by", "s@example.com", "--household", "leo7", "--on"])).toMatchObject({ message: expect.stringContaining("Unknown argument: --on") });
  });
});

describe("who sees \"Your path\"", () => {
  it("a household staff marked; not everyone else, and not staff accounts (no page shows them a path)", async () => {
    const ana = await teen();
    expect(await plannerPathEnabled(db, ana)).toBe(false);
    expect(await plannerPathEnabled(db, adminId)).toBe(false);
    await db.update(schema.households).set({ plannerBeta: true }).where(eq(schema.households.id, await householdOf(ana)));
    expect(await plannerPathEnabled(db, ana)).toBe(true);
    expect(await plannerPathEnabled(db, "00000000-0000-4000-8000-000000000000")).toBe(false);
  });

  it("everyone with PLANNER_PATH=everyone", async () => {
    const ana = await teen();
    process.env.PLANNER_PATH = "everyone";
    resetEnvCache();
    expect(await plannerPathEnabled(db, ana)).toBe(true);
  });
});

describe("setting the beta as staff", () => {
  it("by a student's email or username, or the household id, and back off; audited without personal data", async () => {
    const ana = await teen();
    const hh = await householdOf(ana);
    expect(await runBetaPlanner(db, ["--by", "staff@example.com", "--household", "ANA@example.com"])).toEqual({ ok: true, message: `Household ${hh} now sees "Your path" (the class planner beta).` });
    expect(await plannerPathEnabled(db, ana)).toBe(true);
    expect(await setPlannerBeta(db, adminId, { household: hh, on: false })).toEqual({ ok: true, householdId: hh, on: false });
    expect(await plannerPathEnabled(db, ana)).toBe(false);
    const entries = (await db.select().from(schema.auditLog)).filter((a) => a.action === "planner.beta_set_by_staff");
    expect(entries.map((e) => e.metadata)).toEqual([{ on: true }, { on: false }]);
    expect(entries.every((e) => e.actorUserId === adminId && e.subjectUserId === null)).toBe(true);
    const metadata = JSON.stringify(entries.map((e) => e.metadata));
    for (const secret of ["ana", "@", hh]) expect(metadata.toLowerCase()).not.toContain(secret.toLowerCase());
  });

  it("only by a staff account, for a household that exists", async () => {
    const ana = await teen();
    await expect(setPlannerBeta(db, ana, { household: "ana@example.com", on: true })).rejects.toBeInstanceOf(AdminRequiredError);
    expect(await setPlannerBeta(db, adminId, { household: "nobody@example.com", on: true })).toEqual({ ok: false, error: "household_not_found" });
    expect(await runBetaPlanner(db, ["--by", "someone@example.com", "--household", "ana@example.com"])).toMatchObject({ ok: false, message: expect.stringContaining("No staff account has that email") });
    expect(await runBetaPlanner(db, ["--by", "staff@example.com", "--household", "nobody"])).toMatchObject({ ok: false, message: expect.stringContaining("No household matches that") });
    expect(await plannerPathEnabled(db, ana)).toBe(false);
  });
});
