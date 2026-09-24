import { beforeEach, describe, expect, it } from "vitest";
import { type Db, createTestDb, schema } from "@/db";
import { createChildAccount, registerParent, registerStudent } from "@/lib/accounts";
import { verifyParentConsent } from "@/lib/consent/verifier";
import { buildWeeklyReminders, claimReminder, releaseReminder, reminderGoesToParent, setRemindersEnabled } from "@/lib/reminders";
import { MILESTONES } from "@/lib/roadmap/milestones";

// The cron's scheduled instant: Monday 13:00 UTC.
const now = new Date("2026-10-05T13:00:00Z");
const thisWeek = "2026-10-05";
const lastWeek = "2026-09-28";
const APP = "http://localhost:3000";
let db: Db;

beforeEach(async () => {
  db = await createTestDb();
});

async function teen(grade = 12, email = "ana@example.com") {
  const res = await registerStudent(
    db,
    { displayName: "Ana", email, password: "correct horse battery", birthDate: "2008-12-01", grade },
    now,
  );
  if (!res.ok) throw new Error(res.error);
  return res.value.userId;
}

async function parentWithChild(birthDate: string, grade: number, parentEmail = "rosa@example.com") {
  const parent = await registerParent(db, { displayName: "Rosa", email: parentEmail, password: "correct horse battery" });
  if (!parent.ok) throw new Error();
  const consent = await verifyParentConsent({ parentUserId: parent.value.userId, attested: true });
  const child = await createChildAccount(
    db,
    parent.value.userId,
    { displayName: "Leo", username: `leo${grade}${birthDate.slice(0, 4)}`, password: "correct horse battery", birthDate, grade },
    consent,
    new Date("2026-01-10T12:00:00Z"),
  );
  if (!child.ok) throw new Error(child.error);
  return { parentId: parent.value.userId, childId: child.value.userId };
}

describe("weekly reminders (Monday 13:00 UTC)", () => {
  it("looks back at last week's finished and open steps and ahead at timely milestones", async () => {
    const id = await teen(10);
    await db.insert(schema.weeklySteps).values([
      { userId: id, weekStart: lastWeek, text: "Visit a campus", status: "done" },
      { userId: id, weekStart: lastWeek, text: "Ask about PSAT", status: "open" },
    ]);
    const [r] = await buildWeeklyReminders(db, APP, now);
    expect(r.email.to).toBe("ana@example.com");
    expect(r.email.text).toContain("Last week you finished:\n- Visit a campus");
    expect(r.email.text).toContain("Still open from last week");
    expect(r.email.text).toContain("- Ask about PSAT");
    expect(r.weekStart).toBe(thisWeek);
  });

  it("claims each send so a re-run never double-sends, and a released claim is retried", async () => {
    const id = await teen();
    await db.insert(schema.weeklySteps).values({ userId: id, weekStart: lastWeek, text: "Make an FSA ID" });
    const [r] = await buildWeeklyReminders(db, APP, now);
    expect(await claimReminder(db, r)).toBe(true);
    expect(await claimReminder(db, r)).toBe(false);
    await releaseReminder(db, r);
    expect(await claimReminder(db, r)).toBe(true);
  });

  it("skips students with nothing to do or reminders turned off", async () => {
    const id = await teen();
    // Mark every 12th-grade milestone timely in October as handled.
    const timely = MILESTONES.filter((m) => m.grade === 12 && m.months.includes(10));
    await db.insert(schema.studentMilestones).values(timely.map((m) => ({ userId: id, milestoneId: m.id, status: "done" as const })));
    expect(await buildWeeklyReminders(db, APP, now)).toHaveLength(0);
    await db.insert(schema.weeklySteps).values({ userId: id, weekStart: thisWeek, text: "Visit a campus" });
    await setRemindersEnabled(db, id, false);
    expect(await buildWeeklyReminders(db, APP, now)).toHaveLength(0);
  });

  it("sends an under-13 student's reminder to every linked parent, never to the child", async () => {
    const { childId } = await parentWithChild("2014-03-01", 7);
    const second = await registerParent(db, { displayName: "Sam", email: "sam@example.com", password: "correct horse battery" });
    if (!second.ok) throw new Error();
    await db.insert(schema.parentStudentLinks).values({ parentUserId: second.value.userId, studentUserId: childId });
    await db.insert(schema.weeklySteps).values({ userId: childId, weekStart: lastWeek, text: "Try the robotics club", status: "done" });
    const reminders = await buildWeeklyReminders(db, APP, now);
    expect(reminders.map((r) => r.email.to).sort()).toEqual(["rosa@example.com", "sam@example.com"]);
    expect(new Set(reminders.map((r) => r.recipientKey)).size).toBe(2);
    expect(reminders[0].email.subject).toBe("Leo's week in College Compass");
    expect(reminders[0].email.text).toContain("Last week Leo finished:");
  });

  it("keeps sending a parent-created account's reminders to the parent after the child turns 13", async () => {
    const { childId } = await parentWithChild("2013-06-01", 8); // 13 by October 2026, no email of their own
    await db.insert(schema.weeklySteps).values({ userId: childId, weekStart: thisWeek, text: "Pick an elective" });
    const [r] = await buildWeeklyReminders(db, APP, now);
    expect(r.email.to).toBe("rosa@example.com");
  });

  it("uses one recipient rule everywhere", () => {
    expect(reminderGoesToParent({ email: null, birthDate: "2008-01-01" }, now)).toBe(true);
    expect(reminderGoesToParent({ email: "k@example.com", birthDate: "2015-01-01" }, now)).toBe(true);
    expect(reminderGoesToParent({ email: "k@example.com", birthDate: "2008-01-01" }, now)).toBe(false);
  });

  it("never includes counselor conversations", async () => {
    const id = await teen();
    await db.insert(schema.weeklySteps).values({ userId: id, weekStart: thisWeek, text: "Ask about dual enrollment" });
    const [conv] = await db.insert(schema.counselorConversations).values({ userId: id }).returning();
    await db.insert(schema.counselorMessages).values({ conversationId: conv.id, role: "user", content: "SECRET-CHAT-CONTENT" });
    const [r] = await buildWeeklyReminders(db, APP, now);
    expect(r.email.text).not.toContain("SECRET-CHAT-CONTENT");
  });

  it("pages through students in batches", async () => {
    for (let i = 0; i < 3; i++) {
      const id = await teen(12, `s${i}@example.com`);
      await db.insert(schema.weeklySteps).values({ userId: id, weekStart: thisWeek, text: `Step ${i}` });
    }
    expect(await buildWeeklyReminders(db, APP, now)).toHaveLength(3);
  });
});
