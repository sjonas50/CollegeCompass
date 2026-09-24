import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { describe, expect, it } from "vitest";
import { type Db, createTestDb, schema } from "@/db";
import { createChildAccount, listChildren, registerParent, registerStudent } from "@/lib/accounts";
import { createSession, validateSession } from "@/lib/auth/sessions";
import { verifyParentConsent } from "@/lib/consent/verifier";
import { deleteStudent, exportStudentData } from "@/lib/privacy";
import { buildWeeklyReminders } from "@/lib/reminders";
import { addStep } from "@/lib/steps";

describe("grade advancement where it's applied", () => {
  it("advances grades in sessions, the parent list, and reminders each August", async () => {
    const db = await createTestDb();
    const signup = new Date("2025-09-15T12:00:00Z");
    const teen = await registerStudent(
      db,
      { displayName: "Ana", email: "ana@example.com", password: "correct horse battery", birthDate: "2008-12-01", grade: 11 },
      signup,
    );
    const parent = await registerParent(db, { displayName: "Rosa", email: "rosa@example.com", password: "correct horse battery" });
    if (!teen.ok || !parent.ok) throw new Error();
    const consent = await verifyParentConsent({ parentUserId: parent.value.userId, attested: true });
    const child = await createChildAccount(
      db,
      parent.value.userId,
      { displayName: "Leo", username: "leo7", password: "correct horse battery", birthDate: "2013-03-01", grade: 7 },
      consent,
      signup,
    );
    if (!child.ok) throw new Error();

    const later = new Date("2026-10-05T13:00:00Z"); // next school year, a Monday
    const { token } = await createSession(db, teen.value.userId, later);
    expect((await validateSession(db, token, later))?.user.grade).toBe(12);
    expect((await listChildren(db, parent.value.userId, later))[0].grade).toBe(8);

    await db.insert(schema.weeklySteps).values({ userId: teen.value.userId, weekStart: "2026-10-05", text: "Make an FSA ID" });
    const [r] = await buildWeeklyReminders(db, "http://localhost:3000", later);
    // Grade 12 in October: the (placeholder) 12th-grade FAFSA milestone is timely.
    expect(r.email.text).toContain("Fill out the FAFSA");
  });
});

describe("weekly step limit under concurrency", () => {
  it("locks the student's row before counting this week's steps", async () => {
    const queries: string[] = [];
    const db = drizzle({ client: new PGlite(), schema, logger: { logQuery: (q) => queries.push(q) } }) as unknown as Db;
    await migrate(db as never, { migrationsFolder: path.join(process.cwd(), "drizzle") });
    const res = await registerStudent(
      db,
      { displayName: "Ana", email: "ana@example.com", password: "correct horse battery", birthDate: "2011-01-15", grade: 10 },
      new Date("2026-09-23T12:00:00Z"),
    );
    if (!res.ok) throw new Error();
    queries.length = 0;
    await addStep(db, res.value.userId, { text: "Ask about PSAT" }, { now: new Date("2026-09-23T12:00:00Z") });
    const lock = queries.findIndex((q) => /for update/i.test(q) && /"users"/.test(q));
    const count = queries.findIndex((q) => /from "weekly_steps"/i.test(q));
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(count).toBeGreaterThan(lock);
  });
});

describe("export and delete isolate students", () => {
  it("exports and deletes only the requested student's Phase 2 data", async () => {
    const db = await createTestDb();
    const now = new Date("2026-09-23T12:00:00Z");
    const make = async (name: string) => {
      const res = await registerStudent(
        db,
        { displayName: name, email: `${name}@example.com`, password: "correct horse battery", birthDate: "2011-01-15", grade: 10 },
        now,
      );
      if (!res.ok) throw new Error();
      const id = res.value.userId;
      await db.insert(schema.studentCourses).values({ userId: id, name: `${name}-course`, subject: "science", gradeLevel: 10 });
      await db.insert(schema.studentMilestones).values({ userId: id, milestoneId: `${name}-milestone`, status: "done" });
      await db.insert(schema.weeklySteps).values({ userId: id, weekStart: "2026-09-21", text: `${name}-step` });
      const [conv] = await db.insert(schema.counselorConversations).values({ userId: id }).returning();
      await db.insert(schema.counselorMessages).values({ conversationId: conv.id, role: "user", content: `${name.toUpperCase()}-SECRET` });
      await db.insert(schema.counselorMemory).values({ userId: id, notes: [`${name}-note`] });
      await db.insert(schema.reminderSends).values({ userId: id, weekStart: "2026-09-21", recipient: name });
      return id;
    };
    const ana = await make("ana");
    const ben = await make("ben");

    const exported = JSON.stringify(await exportStudentData(db, ana, ana));
    expect(exported).toContain("ANA-SECRET");
    expect(exported).not.toMatch(/ben-|BEN-SECRET/);

    await deleteStudent(db, ana, ana);
    const remaining = await Promise.all(
      [schema.studentCourses, schema.studentMilestones, schema.weeklySteps, schema.counselorConversations, schema.counselorMemory, schema.reminderSends].map(
        (t) => db.select().from(t),
      ),
    );
    for (const rows of remaining) expect(rows).toHaveLength(1);
    expect(await db.select().from(schema.counselorMessages)).toHaveLength(1);
    expect((await db.select().from(schema.users).where(eq(schema.users.id, ben))).length).toBe(1);
  });
});
