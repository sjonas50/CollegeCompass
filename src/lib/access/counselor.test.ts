import { beforeEach, describe, expect, it } from "vitest";
import { type Db, createTestDb, schema } from "@/db";
import { LOCKED_SCREEN_LIMIT, lockedCounselorReply } from "./counselor";
import { CRISIS_LINE } from "./describe";

// A locked student's counselor message: no reply, but always screened for a crisis.

let db: Db;
let student: { id: string; displayName: string; username: string | null };

beforeEach(async () => {
  db = await createTestDb();
  const [user] = await db.insert(schema.users).values({ role: "student", displayName: "Sam", passwordHash: "x" }).returning();
  student = { id: user.id, displayName: "Sam", username: null };
});

describe("lockedCounselorReply", () => {
  it("explains the lock with the crisis line and the unlock link", async () => {
    const body = await lockedCounselorReply(db, student, "Which classes should I take?");
    expect(body).toMatchObject({ error: "access_required", support: null, unlock: { href: "/account/access" } });
    expect(body.message).toContain(CRISIS_LINE);
    expect(await db.select().from(schema.safetyEvents)).toHaveLength(0);
  });

  it("returns crisis resources and queues the message for review", async () => {
    const body = await lockedCounselorReply(db, student, "i want to kill myself");
    expect(body.support).toContain("988");
    // Marked as sent while locked, so staff know it was never saved in a conversation.
    const [event] = await db.select().from(schema.safetyEvents);
    expect(event.sources).toContain("locked");
  });

  it("past its screening cap, still returns crisis resources from the keyword rules and queues them, up to a daily cap", async () => {
    for (let i = 0; i < LOCKED_SCREEN_LIMIT.count; i++) await lockedCounselorReply(db, student, "hello");
    const body = await lockedCounselorReply(db, student, "i want to kill myself");
    expect(body.support).toContain("988");
    expect(await db.select().from(schema.safetyEvents)).toEqual([expect.objectContaining({ severity: "high", sources: ["rules", "rate_limited", "locked"] })]);

    for (let i = 0; i < 25; i++) expect((await lockedCounselorReply(db, student, "i want to kill myself")).support).toContain("988");
    expect(await db.select().from(schema.safetyEvents)).toHaveLength(20);
  });
});
