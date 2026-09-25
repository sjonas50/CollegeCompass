import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Db, createTestDb, schema } from "@/db";
import { registerParent } from "@/lib/accounts";
import { AdminRequiredError } from "./access";
import { COUNT_METRICS, countDay, countsReport, recordCount, share } from "./counts";

// Anonymous daily counts for the staff overview: numbers per day, nothing about anyone.

let db: Db;
let adminId: string;
const now = new Date("2026-09-24T15:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

beforeEach(async () => {
  db = await createTestDb();
  const [admin] = await db
    .insert(schema.users)
    .values({ role: "admin", email: "staff@example.com", displayName: "Jordan", passwordHash: "x" })
    .returning({ id: schema.users.id });
  adminId = admin.id;
});

describe("recording a count", () => {
  it("adds one to the metric's total for the UTC day, and stores only the day, metric and number", async () => {
    await recordCount(db, "free_quiz_finished", now);
    await recordCount(db, "free_quiz_finished", now);
    await recordCount(db, "signup_student", now);
    // 11pm in California on the 24th is the 25th in UTC.
    await recordCount(db, "free_quiz_finished", new Date("2026-09-25T06:00:00Z"));
    const rows = await db.select().from(schema.dailyCounts).orderBy(schema.dailyCounts.day, schema.dailyCounts.metric);
    expect(rows).toEqual([
      { day: "2026-09-24", metric: "free_quiz_finished", count: 2 },
      { day: "2026-09-24", metric: "signup_student", count: 1 },
      { day: "2026-09-25", metric: "free_quiz_finished", count: 1 },
    ]);
    expect(countDay(new Date("2026-09-24T23:59:59Z"))).toBe("2026-09-24");
  });

  it("never throws, so a count can't stop a signup", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = { insert: () => ({ values: () => ({ onConflictDoUpdate: async () => Promise.reject(new Error("down")) }) }) } as never;
    await expect(recordCount(broken, "signup_parent", now)).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalledWith("[counts] not recorded", "signup_parent", "Error");
    logged.mockRestore();
  });
});

describe("the staff report", () => {
  it("totals the last 30 days, today included, with ratios between totals", async () => {
    const add = async (metric: (typeof COUNT_METRICS)[number], times: number, at: Date) => {
      for (let i = 0; i < times; i++) await recordCount(db, metric, at);
    };
    await add("free_quiz_finished", 30, now);
    await add("free_quiz_finished", 10, daysAgo(29));
    await add("free_quiz_finished", 99, daysAgo(30)); // a day too old
    await add("free_strengths_finished", 10, daysAgo(3));
    await add("signup_student", 8, daysAgo(1));
    await add("signup_student_with_quiz", 4, daysAgo(1));
    await add("child_added_with_quiz", 2, now);
    await add("signup_parent", 3, now);

    const report = await countsReport(db, adminId, { now });
    expect(report).toEqual({
      from: "2026-08-26",
      to: "2026-09-24",
      days: 30,
      totals: {
        free_quiz_finished: 40,
        free_strengths_finished: 10,
        signup_student: 8,
        signup_student_with_quiz: 4,
        signup_parent: 3,
        child_added_with_quiz: 2,
      },
      ratios: { signupsWithQuizPerFinish: 6 / 40, strengthsPerFinish: 10 / 40, studentSignupsWithQuiz: 4 / 8 },
    });
  });

  it("shows zeros, and no ratios, before anything is counted", async () => {
    const report = await countsReport(db, adminId, { now });
    expect(Object.values(report.totals).every((n) => n === 0)).toBe(true);
    expect(report.ratios).toEqual({ signupsWithQuizPerFinish: null, strengthsPerFinish: null, studentSignupsWithQuiz: null });
    expect(share(1, 0)).toBeNull();
    expect(share(1, 4)).toBe(0.25);
  });

  it("is for staff only", async () => {
    const parent = await registerParent(db, { displayName: "Maria", email: "maria@example.com", password: "correct horse battery" });
    if (!parent.ok) throw new Error();
    await expect(countsReport(db, parent.value.userId, { now })).rejects.toBeInstanceOf(AdminRequiredError);
    await expect(countsReport(db, "not-a-uuid", { now })).rejects.toBeInstanceOf(AdminRequiredError);
  });
});
