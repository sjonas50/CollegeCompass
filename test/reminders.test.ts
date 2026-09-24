import { beforeEach, describe, expect, it } from "vitest";
import { type Db, createTestDb, schema } from "@/db";
import { createChildAccount, registerParent, registerStudent } from "@/lib/accounts";
import { verifyParentConsent } from "@/lib/consent/verifier";
import { buildWeeklyReminders, markReminderSent, setRemindersEnabled } from "@/lib/reminders";

// A Wednesday in October; placeholder milestones include g12 FAFSA (Oct) and g11 apprenticeships (Oct).
const now = new Date("2026-10-07T12:00:00Z");
const weekStart = "2026-10-05";
const APP = "http://localhost:3000";
let db: Db;

beforeEach(async () => {
  db = await createTestDb();
});

async function teen(grade = 12) {
  const res = await registerStudent(
    db,
    { displayName: "Ana", email: "ana@example.com", password: "correct horse battery", birthDate: "2008-12-01", grade },
    now,
  );
  if (!res.ok) throw new Error(res.error);
  return res.value.userId;
}

describe("weekly reminders", () => {
  it("emails a teen their open steps and timely milestones, once per week", async () => {
    const id = await teen();
    await db.insert(schema.weeklySteps).values({ userId: id, weekStart, text: "Make an FSA ID" });
    const [r] = await buildWeeklyReminders(db, APP, now);
    expect(r.email.to).toBe("ana@example.com");
    expect(r.email.text).toContain("Make an FSA ID");
    expect(r.email.text).toContain("Fill out the FAFSA");
    await markReminderSent(db, id, r.weekStart);
    expect(await buildWeeklyReminders(db, APP, now)).toHaveLength(0);
  });

  it("skips students with nothing to do or reminders turned off", async () => {
    const id = await teen();
    await db.insert(schema.studentMilestones).values({ userId: id, milestoneId: "g12-submit-fafsa", status: "done" });
    expect(await buildWeeklyReminders(db, APP, now)).toHaveLength(0);
    await db.insert(schema.weeklySteps).values({ userId: id, weekStart, text: "Visit a campus" });
    await setRemindersEnabled(db, id, false);
    expect(await buildWeeklyReminders(db, APP, now)).toHaveLength(0);
  });

  it("sends an under-13 student's reminder to their parent, never to the child", async () => {
    const parent = await registerParent(db, { displayName: "Rosa", email: "rosa@example.com", password: "correct horse battery" });
    if (!parent.ok) throw new Error();
    const consent = await verifyParentConsent({ parentUserId: parent.value.userId, attested: true });
    const child = await createChildAccount(
      db,
      parent.value.userId,
      { displayName: "Leo", username: "leo7", password: "correct horse battery", birthDate: "2014-03-01", grade: 7 },
      consent,
      now,
    );
    if (!child.ok) throw new Error();
    await db.insert(schema.weeklySteps).values({ userId: child.value.userId, weekStart, text: "Try the robotics club" });
    const [r] = await buildWeeklyReminders(db, APP, now);
    expect(r.email.to).toBe("rosa@example.com");
    expect(r.email.subject).toBe("Leo's week in College Compass");
  });

  it("never includes counselor conversations", async () => {
    const id = await teen();
    await db.insert(schema.weeklySteps).values({ userId: id, weekStart, text: "Ask about dual enrollment" });
    const [conv] = await db.insert(schema.counselorConversations).values({ userId: id }).returning();
    await db.insert(schema.counselorMessages).values({ conversationId: conv.id, role: "user", content: "SECRET-CHAT-CONTENT" });
    const [r] = await buildWeeklyReminders(db, APP, now);
    expect(r.email.text).not.toContain("SECRET-CHAT-CONTENT");
  });
});
