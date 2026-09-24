import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { type Db, createTestDb, schema } from "@/db";
import { createChildAccount, registerParent, registerStudent } from "@/lib/accounts";
import { verifyParentConsent } from "@/lib/consent/verifier";
import type { Email } from "@/lib/email";
import { acceptInvite, createInvite } from "@/lib/invites";
import { PARENT_COPY_NOTE, exportStudentData } from "@/lib/privacy";

// Who asks for a student's data decides what's in it. A teen who owns their account gets all of
// it; a parent they linked gets their progress without counselor chats, memory notes or safety
// flags. A parent who set up the account for a child under 13 gets all of it (COPPA review right).

const now = new Date("2026-09-24T15:00:00Z");
const PRIVATE = ["SECRET-MESSAGE", "SECRET-CONTEXT", "SECRET-TITLE", "SECRET-MEMORY", "SECRET-EXCERPT"];

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
});

async function parent(email = "rosa@example.com") {
  const res = await registerParent(db, { displayName: "Rosa", email, password: "correct horse battery" });
  if (!res.ok) throw new Error(res.error);
  return res.value.userId;
}

/** A 15-year-old who signed up on their own, then linked a parent through an invitation. */
async function invitedTeen(parentId: string) {
  const res = await registerStudent(
    db,
    { displayName: "Ana", email: "ana@example.com", password: "correct horse battery", birthDate: "2011-01-15", grade: 10 },
    now,
  );
  if (!res.ok) throw new Error(res.error);
  const sent: Email[] = [];
  const invite = await createInvite(db, res.value.userId, "rosa@example.com", {
    appUrl: "https://compass.example",
    send: async (email) => void sent.push(email),
    now,
  });
  if (!invite.ok) throw new Error(invite.error);
  const token = /\/invite\/(\S+)/.exec(sent[0].text)![1];
  const accepted = await acceptInvite(db, token, parentId, now);
  if (!accepted.ok) throw new Error(accepted.error);
  return res.value.userId;
}

/** A child account a parent set up: under 13 with consent (parent-managed), or 13+ without. */
async function childOf(parentId: string, under13: boolean) {
  const consent = under13 ? await verifyParentConsent({ parentUserId: parentId, attested: true }) : null;
  const res = await createChildAccount(
    db,
    parentId,
    {
      displayName: under13 ? "Leo" : "Mia",
      username: under13 ? "leo12" : "mia15",
      password: "correct horse battery",
      birthDate: under13 ? "2014-03-01" : "2011-01-01",
      grade: under13 ? 7 : 10,
    },
    consent,
    now,
  );
  if (!res.ok) throw new Error(res.error);
  return res.value.userId;
}

/** Private counselor data, AI usage for each feature, and progress a parent may see. */
async function seed(userId: string) {
  const [conversation] = await db
    .insert(schema.counselorConversations)
    .values({ userId, title: "SECRET-TITLE", concernFlagged: true, context: "SECRET-CONTEXT" })
    .returning();
  await db.insert(schema.counselorMessages).values({ conversationId: conversation.id, role: "user", content: "SECRET-MESSAGE" });
  await db.insert(schema.counselorMemory).values({ userId, notes: ["SECRET-MEMORY"] });
  await db
    .insert(schema.safetyEvents)
    .values({ userId, conversationId: conversation.id, category: "abuse", severity: "high", sources: ["rules"], excerpt: "SECRET-EXCERPT" });
  await db.insert(schema.aiUsage).values(
    (["counselor", "safety", "safety_backup", "explain"] as const).map((feature) => ({
      userId,
      feature,
      model: "m",
      inputTokens: 1,
      outputTokens: 1,
      costMicros: 1,
    })),
  );
  await db.insert(schema.northStarGoals).values({ userId, occupationCode: "29-1141.00", title: "Registered Nurses" });
  await db.insert(schema.weeklySteps).values({ userId, weekStart: "2026-09-21", text: "Ask about the PSAT" });
  await db.insert(schema.collegeList).values({ userId, name: "State University" });
}

async function lastExportAudit() {
  const rows = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "student.exported"));
  return rows.at(-1);
}

function expectComplete(data: Awaited<ReturnType<typeof exportStudentData>>) {
  const dump = JSON.stringify(data);
  for (const secret of PRIVATE) expect(dump).toContain(secret);
  expect(data).not.toHaveProperty("notIncluded");
  expect(data).toMatchObject({
    counselorConversations: [{ title: "SECRET-TITLE", context: "SECRET-CONTEXT", messages: [{ content: "SECRET-MESSAGE" }] }],
    counselorMemory: ["SECRET-MEMORY"],
    safetyEvents: [{ category: "abuse", severity: "high", excerpt: "SECRET-EXCERPT" }],
  });
  expect(data?.aiUsage.map((u) => u.feature).sort()).toEqual(["counselor", "explain", "safety", "safety_backup"]);
}

function expectParentCopy(data: Awaited<ReturnType<typeof exportStudentData>>) {
  expect(data).not.toBeNull();
  const dump = JSON.stringify(data);
  for (const secret of PRIVATE) expect(dump).not.toContain(secret);
  // Left out, not empty: an empty list would read as "no chats" or "no safety flags".
  for (const key of ["counselorConversations", "counselorMemory", "safetyEvents"]) expect(data).not.toHaveProperty(key);
  expect(data).toMatchObject({ notIncluded: PARENT_COPY_NOTE });
  // Usage records would show when the teen talked with the counselor.
  expect(data?.aiUsage.map((u) => u.feature)).toEqual(["explain"]);
  // Their progress is still there.
  expect(data).toMatchObject({
    northStars: [{ title: "Registered Nurses" }],
    weeklySteps: [{ text: "Ask about the PSAT" }],
    collegeList: [{ name: "State University" }],
  });
}

describe("data export audiences", () => {
  it("gives a teen who owns their account a complete copy of their own data", async () => {
    const teen = await invitedTeen(await parent());
    await seed(teen);
    expectComplete(await exportStudentData(db, teen, teen));
    expect(await lastExportAudit()).toMatchObject({ actorUserId: teen, subjectUserId: teen, metadata: { complete: true } });
  });

  it("leaves counselor chats, memory notes and safety flags out of a linked parent's copy of that teen", async () => {
    const rosa = await parent();
    const teen = await invitedTeen(rosa);
    await seed(teen);
    expectParentCopy(await exportStudentData(db, rosa, teen));
    expect(await lastExportAudit()).toMatchObject({ actorUserId: rosa, subjectUserId: teen, metadata: { complete: false } });
  });

  it("does the same for a teen 13 or older whose account the parent set up", async () => {
    const rosa = await parent();
    const mia = await childOf(rosa, false);
    await seed(mia);
    expectParentCopy(await exportStudentData(db, rosa, mia));
    expectComplete(await exportStudentData(db, mia, mia));
  });

  it("gives a parent a complete copy for a child they set up under 13, and the child too", async () => {
    const rosa = await parent();
    const leo = await childOf(rosa, true);
    await seed(leo);
    expectComplete(await exportStudentData(db, rosa, leo));
    expect(await lastExportAudit()).toMatchObject({ actorUserId: rosa, subjectUserId: leo, metadata: { complete: true } });
    expectComplete(await exportStudentData(db, leo, leo));
  });

  it("gives nothing to anyone else", async () => {
    const rosa = await parent();
    const teen = await invitedTeen(rosa);
    const leo = await childOf(rosa, true);
    const stranger = await parent("stranger@example.com");
    expect(await exportStudentData(db, stranger, teen)).toBeNull();
    expect(await exportStudentData(db, stranger, leo)).toBeNull();
    expect(await exportStudentData(db, teen, leo)).toBeNull();
    expect(await exportStudentData(db, rosa, rosa)).toBeNull();
  });
});
