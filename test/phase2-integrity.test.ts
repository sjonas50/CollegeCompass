import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { describe, expect, it } from "vitest";
import * as z from "zod";
import counselorCases from "../evals/counselor/cases.json";
import { type Db, createTestDb, schema } from "@/db";
import { createChildAccount, listChildren, registerParent, registerStudent } from "@/lib/accounts";
import { supportResponse } from "@/lib/ai/safety/responses";
import { classifyWithRules } from "@/lib/ai/safety/rules";
import { SEVERITY_ORDER } from "@/lib/ai/safety/types";
import { createSession, validateSession } from "@/lib/auth/sessions";
import { verifyParentConsent } from "@/lib/consent/verifier";
import { deleteStudent, exportStudentData } from "@/lib/privacy";
import { buildWeeklyReminders } from "@/lib/reminders";
import { MILESTONES } from "@/lib/roadmap/milestones";
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
    const reminders = await buildWeeklyReminders(db, "http://localhost:3000", later);
    // Pick by student, not position: batch order follows random UUIDs.
    const r = reminders.find((x) => x.userId === teen.value.userId)!;
    // She's now in 12th grade, so the email lists 12th-grade milestones timely in October.
    const timely = MILESTONES.find((m) => m.grade === 12 && m.months.includes(10))!;
    expect(r.email.text).toContain(timely.title);
    // Leo's email (to his parent) moves up too: 8th-grade October milestones, not 7th.
    const leo = reminders.find((x) => x.userId === child.value.userId)!;
    const october = (grade: number) => MILESTONES.filter((m) => m.grade === grade && m.months.includes(10)).map((m) => m.title);
    for (const title of october(8).slice(0, 3)) expect(leo.email.text).toContain(title); // emails list up to 3
    for (const title of october(7)) expect(leo.email.text).not.toContain(title);

    // Two Augusts later she has finished 12th grade: sessions say so and reminders stop.
    const graduated = new Date("2027-09-06T13:00:00Z"); // a Monday
    const fresh = await createSession(db, teen.value.userId, graduated);
    expect((await validateSession(db, fresh.token, graduated))?.user.grade).toBe(13);
    expect((await listChildren(db, parent.value.userId, graduated))[0].grade).toBe(9);
    // An open step would earn her an email if she were still counted as a student in school.
    await db.insert(schema.weeklySteps).values({ userId: teen.value.userId, weekStart: "2027-09-06", text: "Visit the campus" });
    const after = await buildWeeklyReminders(db, "http://localhost:3000", graduated);
    expect(after.find((x) => x.userId === teen.value.userId)).toBeUndefined();
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
    const make = async (name: string, weekStart: string) => {
      const res = await registerStudent(
        db,
        { displayName: name, email: `${name}@example.com`, password: "correct horse battery", birthDate: "2011-01-15", grade: 10 },
        now,
      );
      if (!res.ok) throw new Error();
      const id = res.value.userId;
      await db.insert(schema.studentCourses).values({ userId: id, name: `${name}-course`, subject: "science", gradeLevel: 10 });
      await db.insert(schema.studentMilestones).values({ userId: id, milestoneId: `${name}-milestone`, status: "done" });
      await db.insert(schema.weeklySteps).values({ userId: id, weekStart, text: `${name}-step` });
      const [conv] = await db.insert(schema.counselorConversations).values({ userId: id, concernFlagged: name === "ben" }).returning();
      await db.insert(schema.counselorMessages).values({ conversationId: conv.id, role: "user", content: `${name.toUpperCase()}-SECRET` });
      await db.insert(schema.counselorMemory).values({ userId: id, notes: [`${name}-note`] });
      await db.insert(schema.reminderSends).values({ userId: id, weekStart, recipient: name });
      return { id, conversationId: conv.id };
    };
    // Ben's rows go in first, so an unfiltered query would put his row ahead of Ana's.
    const ben = await make("ben", "2025-01-06");
    const ana = await make("ana", "2026-09-21");

    const data = await exportStudentData(db, ana.id, ana.id);
    if (!data || !("counselorConversations" in data)) throw new Error("expected Ana's own, complete export");
    const exported = JSON.stringify(data);
    expect(exported).toContain("ANA-SECRET");
    expect(exported).not.toMatch(/ben-|BEN-SECRET|2025-01-06/);
    expect(exported).not.toContain(ben.conversationId);
    // Counts catch leaks the text can't show (a conversation row has no student-typed text).
    expect(data.courses).toHaveLength(1);
    expect(data.roadmapProgress).toHaveLength(1);
    expect(data.weeklySteps).toHaveLength(1);
    expect(data.reminderEmails).toEqual([expect.objectContaining({ weekStart: "2026-09-21" })]);
    expect(data.counselorConversations.map((c) => [c.id, c.concernFlagged, c.messages.length])).toEqual([[ana.conversationId, false, 1]]);
    expect(data.counselorMemory).toEqual(["ana-note"]);

    await deleteStudent(db, ana.id, ana.id);
    const owners = await Promise.all([
      db.select({ userId: schema.studentCourses.userId }).from(schema.studentCourses),
      db.select({ userId: schema.studentMilestones.userId }).from(schema.studentMilestones),
      db.select({ userId: schema.weeklySteps.userId }).from(schema.weeklySteps),
      db.select({ userId: schema.counselorConversations.userId }).from(schema.counselorConversations),
      db.select({ userId: schema.counselorMemory.userId }).from(schema.counselorMemory),
      db.select({ userId: schema.reminderSends.userId }).from(schema.reminderSends),
    ]);
    for (const rows of owners) expect(rows).toEqual([{ userId: ben.id }]);
    expect(await db.select({ conversationId: schema.counselorMessages.conversationId }).from(schema.counselorMessages)).toEqual([
      { conversationId: ben.conversationId },
    ]);
    expect((await db.select().from(schema.users).where(eq(schema.users.id, ben.id))).length).toBe(1);
  });
});

describe("counselor eval cases", () => {
  // The shape scripts/eval-counselor.ts reads. Strict, so a misspelled field fails here
  // instead of being silently ignored by a paid eval run.
  const EvalCase = z.strictObject({
    id: z.string().min(1),
    dimension: z.string().min(1),
    student: z.strictObject({
      grade: z.number().int().min(7).max(12),
      interests: z.string().min(1),
      northStars: z.array(z.string().min(1)),
      openSteps: z.array(z.string().min(1)),
      memory: z.array(z.string().min(1)),
      concernFlagged: z.boolean().optional(),
    }),
    conversation: z.array(z.strictObject({ role: z.enum(["user", "assistant"]), content: z.string().min(1) })).min(1),
    mustDo: z.array(z.string().min(1)).min(1),
    mustNotDo: z.array(z.string().min(1)).min(1),
  });
  const cases = z.array(EvalCase).parse(counselorCases);
  const inDimension = (d: string) => cases.filter((c) => c.dimension === d);
  const rated = (text: string) => SEVERITY_ORDER[classifyWithRules(text)?.severity ?? "none"];
  const userTurns = (c: (typeof cases)[number]) => c.conversation.filter((m) => m.role === "user").map((m) => m.content);

  it("match the runner's shape, with unique ids and alternating turns that start and end with the student", () => {
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    for (const c of cases) {
      expect(c.id.startsWith(`${c.dimension}-`), c.id).toBe(true);
      const roles = c.conversation.map((m) => m.role);
      expect(roles.at(-1), c.id).toBe("user");
      roles.forEach((r, i) => expect(r === "user", `${c.id} turn ${i}`).toBe(i % 2 === 0));
    }
  });

  it("cover crises the safety screen may rate below high, which reach the counselor model", () => {
    const crisis = inDimension("crisis-below-high");
    expect(crisis).toHaveLength(6);
    for (const c of crisis) {
      // A high rule match would swap the model's reply for the fixed support message.
      for (const text of userTurns(c)) expect(rated(text), c.id).toBeLessThan(SEVERITY_ORDER.high);
      expect(c.mustDo.some((d) => /trusted adult/i.test(d)), c.id).toBe(true);
    }
    const required = crisis.flatMap((c) => c.mustDo).join("\n");
    expect(required).toMatch(/988/);
    expect(required).toMatch(/911/);
  });

  it("cover support mode: a flagged conversation replays the real support message, then asks about classes", () => {
    const followups = inDimension("support-mode-followup");
    expect(followups).toHaveLength(4);
    for (const c of followups) {
      expect(c.student.concernFlagged, c.id).toBe(true);
      const [first, support, ...rest] = c.conversation;
      const flagged = classifyWithRules(first.content);
      expect(flagged && SEVERITY_ORDER[flagged.severity], c.id).toBeGreaterThanOrEqual(SEVERITY_ORDER.high);
      expect(support.content, c.id).toBe(supportResponse(flagged!.category));
      for (const m of rest) if (m.role === "user") expect(rated(m.content), c.id).toBeLessThan(SEVERITY_ORDER.high);
      expect(rest.at(-1)!.content, c.id).toMatch(/\bclass(es)?\b|\belectives?\b|\bAP\b|\bcalc\b/i);
      expect(c.mustDo.some((d) => /trusted adult/i.test(d)), c.id).toBe(true);
    }
    // Only support-mode cases run with the flag, and no other case has a turn rated high.
    for (const c of cases.filter((c) => c.dimension !== "support-mode-followup")) {
      expect(c.student.concernFlagged, c.id).toBeUndefined();
      for (const text of userTurns(c)) expect(rated(text), c.id).toBeLessThan(SEVERITY_ORDER.high);
    }
  });
});
