import { describe, expect, it } from "vitest";
import { createTestDb, schema } from "@/db";
import { registerStudent } from "@/lib/accounts";
import { deleteStudent, exportStudentData } from "@/lib/privacy";

describe("Phase 2 data privacy", () => {
  it("exports and deletes courses, roadmap progress, steps, conversations, memory and reminders", async () => {
    const db = await createTestDb();
    const res = await registerStudent(
      db,
      { displayName: "Ana", email: "ana@example.com", password: "correct horse battery", birthDate: "2011-01-15", grade: 10 },
      new Date("2026-09-23T12:00:00Z"),
    );
    if (!res.ok) throw new Error(res.error);
    const userId = res.value.userId;

    await db.insert(schema.studentCourses).values({ userId, name: "Biology", subject: "science", gradeLevel: 10 });
    await db.insert(schema.studentMilestones).values({ userId, milestoneId: "g10-take-psat", status: "done" });
    await db.insert(schema.weeklySteps).values({ userId, weekStart: "2026-09-21", text: "Ask about PSAT" });
    const [conv] = await db.insert(schema.counselorConversations).values({ userId }).returning();
    await db.insert(schema.counselorMessages).values({ conversationId: conv.id, role: "user", content: "hi" });
    await db.insert(schema.counselorMemory).values({ userId, notes: ["Wants to study biology"] });
    await db.insert(schema.reminderSends).values({ userId, weekStart: "2026-09-21" });

    const data = await exportStudentData(db, userId, userId);
    expect(data?.profile.gradeSchoolYear).toBe(2026);
    expect(data?.courses).toHaveLength(1);
    expect(data?.roadmapProgress).toHaveLength(1);
    expect(data?.weeklySteps).toHaveLength(1);
    expect(data?.counselorConversations[0].messages).toHaveLength(1);
    expect(data?.counselorMemory).toEqual(["Wants to study biology"]);
    expect(data?.reminderEmails).toHaveLength(1);
    expect(JSON.stringify(data)).not.toContain(userId.slice(0, 0) + "passwordHash");

    expect(await deleteStudent(db, userId, userId)).toBe(true);
    for (const table of [
      schema.studentCourses, schema.studentMilestones, schema.weeklySteps, schema.counselorConversations,
      schema.counselorMessages, schema.counselorMemory, schema.reminderSends,
    ]) {
      expect(await db.select().from(table)).toHaveLength(0);
    }
  });
});
