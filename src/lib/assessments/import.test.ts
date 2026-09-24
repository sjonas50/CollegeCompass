import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { type Db, createTestDb, schema } from "@/db";
import { createChildAccount, registerParent, registerStudent } from "@/lib/accounts";
import { computeMatches, latestMatchRun, loadOccupationProfiles } from "@/lib/matching/service";
import { deleteStudent, exportStudentData } from "@/lib/privacy";
import { emptySavedAssessment, serializeSavedAssessment } from "./anonymous";
import {
  FREE_MATCH_RATE_LIMIT,
  anonymousRateKey,
  importSavedAssessment,
  interestCode,
  matchFreeAssessment,
} from "./import";
import { INTEREST_ITEMS, type Riasec } from "./instruments";
import { scoreInterests } from "./scoring";
import { completeAttempt, instrumentStatuses, latestResult, saveResponses, startOrResumeAttempt } from "./service";

const now = new Date("2026-09-24T12:00:00Z");
const IP = "203.0.113.7";
const SECRET = "test-secret-for-rate-keys";
let db: Db;

/** A scientist: loves investigative work, likes hands-on work, lukewarm on the rest. */
const answers = Object.fromEntries(INTEREST_ITEMS.map((i) => [i.id, i.area === "I" ? 5 : i.area === "R" ? 4 : 2]));
const saved = serializeSavedAssessment({ ...emptySavedAssessment(), answers });
const scientistAreas = scoreInterests(answers).areas;

async function seedReference(target: Db) {
  const occs: [string, string, number, Partial<Record<Riasec, number>>][] = [
    ["19-2031.00", "Chemists", 4, { I: 7, R: 4 }],
    ["17-2051.00", "Civil Engineers", 4, { R: 6, I: 6 }],
    ["29-2012.00", "Medical and Clinical Laboratory Technicians", 3, { I: 6, R: 5, C: 4 }],
    ["25-2031.00", "Secondary School Teachers", 4, { S: 7, A: 3 }],
    ["27-1024.00", "Graphic Designers", 4, { A: 7 }],
    ["43-4071.00", "File Clerks", 2, { C: 7 }],
  ];
  await target
    .insert(schema.occupations)
    .values(occs.map(([code, title, jobZone]) => ({ code, title, jobZone, description: `${title} do things.` })));
  await target.insert(schema.occupationInterests).values(
    occs.flatMap(([code, , , i]) =>
      (["R", "I", "A", "S", "E", "C"] as const).map((interest) => ({ occupationCode: code, interest, score: i[interest] ?? 1 })),
    ),
  );
  await loadOccupationProfiles(target, { fresh: true });
}

async function makeStudent(email: string) {
  const res = await registerStudent(
    db,
    { displayName: "Ana", email, password: "correct horse battery", birthDate: "2011-01-15", grade: 10 },
    now,
  );
  if (!res.ok) throw new Error(res.error);
  return res.value.userId;
}

async function takeSignedIn(userId: string) {
  const start = await startOrResumeAttempt(db, userId, "interests", now);
  if (!start.ok) throw new Error(start.error);
  await saveResponses(db, userId, start.attempt.id, answers);
  await completeAttempt(db, userId, start.attempt.id, now);
  await computeMatches(db, userId);
}

beforeEach(async () => {
  db = await createTestDb();
  await seedReference(db);
});

describe("anonymousRateKey", () => {
  it("never contains the address and changes every day", () => {
    const key = anonymousRateKey(IP, SECRET, now);
    expect(key).toMatch(/^try:match:[A-Za-z0-9_-]{43}$/);
    expect(key).not.toContain(IP);
    expect(anonymousRateKey(IP, SECRET, new Date("2026-09-24T23:59:59Z"))).toBe(key);
    expect(anonymousRateKey(IP, SECRET, new Date("2026-09-25T00:00:00Z"))).not.toBe(key);
    expect(anonymousRateKey("203.0.113.8", SECRET, now)).not.toBe(key);
    // Keyed: without the server's secret, the key can't be rebuilt from a guessed address.
    expect(anonymousRateKey(IP, "another-secret", now)).not.toBe(key);
  });
});

describe("matchFreeAssessment", () => {
  const rateKey = anonymousRateKey(IP, SECRET, now);

  it("ranks careers from the six area scores the same way as for signed-in students", async () => {
    const res = await matchFreeAssessment(db, scientistAreas, { rateKey, now });
    if (!res.ok) throw new Error(res.error);
    expect(res.code).toBe(scoreInterests(answers).code);
    expect(res.careers[0]).toMatchObject({ code: "19-2031.00", title: "Chemists", pathway: "degree" });
    expect(res.careers.every((c) => c.why.length > 0 && ["Great fit", "Good fit", "Worth exploring"].includes(c.fit))).toBe(true);
    expect(res.careers.find((c) => c.title === "File Clerks")?.pathway).toBe("training");
    expect(res.overview).toContain("Investigative");

    const student = await makeStudent("ana@example.com");
    await takeSignedIn(student);
    const run = await latestMatchRun(db, student);
    expect(res.careers.map((c) => c.code)).toEqual(run?.matches.map((m) => m.occupationCode));
  });

  it("refuses anything but six whole-number area scores, without counting it", async () => {
    for (const bad of [null, { ...scientistAreas, R: 41 }, { ...scientistAreas, answers }, { R: 1 }, "RIASEC"]) {
      expect(await matchFreeAssessment(db, bad, { rateKey, now })).toEqual({ ok: false, error: "invalid" });
    }
    expect(await db.select().from(schema.rateLimits)).toHaveLength(0);
  });

  it("limits each visitor per hour", async () => {
    for (let i = 0; i < FREE_MATCH_RATE_LIMIT.limit; i++) {
      expect((await matchFreeAssessment(db, scientistAreas, { rateKey, now })).ok).toBe(true);
    }
    expect(await matchFreeAssessment(db, scientistAreas, { rateKey, now })).toEqual({ ok: false, error: "rate_limited" });
    const other = anonymousRateKey("198.51.100.1", SECRET, now);
    expect((await matchFreeAssessment(db, scientistAreas, { rateKey: other, now })).ok).toBe(true);
    const nextHour = new Date(now.getTime() + FREE_MATCH_RATE_LIMIT.windowMs + 1000);
    expect((await matchFreeAssessment(db, scientistAreas, { rateKey, now: nextHour })).ok).toBe(true);
  });

  it("stores nothing about the visitor but a hashed counter", async () => {
    await matchFreeAssessment(db, scientistAreas, { rateKey, now });
    for (const table of [
      schema.users,
      schema.assessmentAttempts,
      schema.assessmentResponses,
      schema.assessmentResults,
      schema.matchRuns,
      schema.careerMatches,
      schema.auditLog,
      schema.aiUsage,
    ]) {
      expect(await db.select().from(table)).toHaveLength(0);
    }
    const limits = await db.select().from(schema.rateLimits);
    expect(limits).toHaveLength(1);
    expect(limits[0].key).toBe(rateKey);
    expect(JSON.stringify(limits)).not.toContain(IP);
  });

  it("says so when career data isn't loaded", async () => {
    const empty = await createTestDb();
    await loadOccupationProfiles(empty, { fresh: true });
    expect(await matchFreeAssessment(empty, scientistAreas, { rateKey, now })).toEqual({ ok: false, error: "unavailable" });
    await loadOccupationProfiles(db, { fresh: true });
  });

  it("uses the same interest code as the scoring", () => {
    expect(interestCode(scientistAreas)).toBe(scoreInterests(answers).code);
    // Ties keep RIASEC order.
    expect(interestCode({ R: 5, I: 5, A: 5, S: 5, E: 5, C: 5 })).toBe("RIA");
  });
});

describe("importSavedAssessment", () => {
  it("creates a completed attempt, its server-scored result and a match run, like the signed-in flow", async () => {
    const imported = await makeStudent("ana@example.com");
    const res = await importSavedAssessment(db, imported, imported, saved, { via: "signup", now });
    expect(res).toMatchObject({ ok: true });
    if (!res.ok) return;

    const signedIn = await makeStudent("bo@example.com");
    await takeSignedIn(signedIn);

    const [a, b] = await Promise.all([latestResult(db, imported, "interests"), latestResult(db, signedIn, "interests")]);
    expect(a?.attemptId).toBe(res.attemptId);
    expect(a?.scores).toEqual(b?.scores);
    // The browser shows the same scores before signup.
    expect(a?.scores).toEqual(scoreInterests(answers));

    const [attempt] = await db.select().from(schema.assessmentAttempts).where(eq(schema.assessmentAttempts.id, res.attemptId));
    expect(attempt).toMatchObject({ userId: imported, instrument: "interests", instrumentVersion: "ipsf-1", completedAt: now });
    const responses = await db
      .select()
      .from(schema.assessmentResponses)
      .where(eq(schema.assessmentResponses.attemptId, res.attemptId));
    expect(Object.fromEntries(responses.map((r) => [r.itemId, r.value]))).toEqual(answers);

    const [runA, runB] = await Promise.all([latestMatchRun(db, imported), latestMatchRun(db, signedIn)]);
    expect(runA?.id).toBe(res.runId);
    expect(runA?.interestsAttemptId).toBe(res.attemptId);
    expect(runA?.matches.map((m) => [m.occupationCode, m.score])).toEqual(runB?.matches.map((m) => [m.occupationCode, m.score]));
    expect((await instrumentStatuses(db, imported)).interests.state).toBe("done");
  });

  it("audits the import without personal data", async () => {
    const student = await makeStudent("ana@example.com");
    await importSavedAssessment(db, student, student, saved, { via: "signup", now });
    const rows = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "assessment.imported"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorUserId: student, subjectUserId: student, metadata: { instrument: "interests", via: "signup" } });
    expect(JSON.stringify(rows[0].metadata)).not.toMatch(/ana|example|2011/i);
  });

  it("never imports twice", async () => {
    const student = await makeStudent("ana@example.com");
    expect((await importSavedAssessment(db, student, student, saved, { via: "signup", now })).ok).toBe(true);
    expect(await importSavedAssessment(db, student, student, saved, { via: "dashboard", now })).toEqual({
      ok: false,
      error: "already_done",
    });
    expect(await db.select().from(schema.assessmentAttempts)).toHaveLength(1);
    expect(await db.select().from(schema.matchRuns)).toHaveLength(1);
    expect(await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "assessment.imported"))).toHaveLength(1);
  });

  it("leaves a finished in-account result alone", async () => {
    const student = await makeStudent("ana@example.com");
    await takeSignedIn(student);
    const before = await latestResult(db, student, "interests");
    expect(await importSavedAssessment(db, student, student, saved, { via: "dashboard", now })).toEqual({
      ok: false,
      error: "already_done",
    });
    expect((await latestResult(db, student, "interests"))?.attemptId).toBe(before?.attemptId);
  });

  it("replaces an unfinished in-account attempt", async () => {
    const student = await makeStudent("ana@example.com");
    const start = await startOrResumeAttempt(db, student, "interests", now);
    if (!start.ok) throw new Error();
    await saveResponses(db, student, start.attempt.id, { R1: 1, I1: 1 });
    const res = await importSavedAssessment(db, student, student, saved, { via: "dashboard", now });
    expect(res.ok).toBe(true);
    const attempts = await db.select().from(schema.assessmentAttempts);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].completedAt).toEqual(now);
    expect((await instrumentStatuses(db, student)).interests.state).toBe("done");
  });

  it("writes nothing for invalid answers", async () => {
    const student = await makeStudent("ana@example.com");
    const { C10: _dropped, ...partial } = answers;
    const cases: [unknown, string][] = [
      [serializeSavedAssessment({ ...emptySavedAssessment(), answers: partial }), "incomplete"],
      [serializeSavedAssessment({ ...emptySavedAssessment(), answers: { ...answers, X1: 3 } }), "unknown_item"],
      [serializeSavedAssessment({ ...emptySavedAssessment(), answers: { ...answers, R1: 7 } }), "bad_value"],
      [JSON.stringify({ ...JSON.parse(saved), scores: { areas: { R: 40 } } }), "invalid_format"],
      ["{", "invalid_format"],
    ];
    for (const [payload, error] of cases) {
      expect(await importSavedAssessment(db, student, student, payload, { via: "signup", now })).toEqual({ ok: false, error });
    }
    expect(await db.select().from(schema.assessmentAttempts)).toHaveLength(0);
    expect(await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "assessment.imported"))).toHaveLength(0);
  });

  it("imports only into the actor's own account or a linked child's", async () => {
    const student = await makeStudent("ana@example.com");
    const other = await makeStudent("bo@example.com");
    expect(await importSavedAssessment(db, other, student, saved, { via: "dashboard", now })).toEqual({
      ok: false,
      error: "not_allowed",
    });

    const parent = await registerParent(db, { displayName: "Maria", email: "maria@example.com", password: "correct horse battery" });
    if (!parent.ok) throw new Error();
    expect(await importSavedAssessment(db, parent.value.userId, student, saved, { via: "parent", now })).toEqual({
      ok: false,
      error: "not_allowed",
    });
    // A parent account never gets assessment results of its own.
    expect(await importSavedAssessment(db, parent.value.userId, parent.value.userId, saved, { via: "parent", now })).toEqual({
      ok: false,
      error: "not_allowed",
    });
    expect(await db.select().from(schema.assessmentAttempts)).toHaveLength(0);

    const child = await createChildAccount(
      db,
      parent.value.userId,
      { displayName: "Leo", username: "leo15", password: "correct horse battery", birthDate: "2011-01-15", grade: 10 },
      null,
      now,
    );
    if (!child.ok) throw new Error(child.error);
    const res = await importSavedAssessment(db, parent.value.userId, child.value.userId, saved, { via: "parent", now });
    expect(res.ok).toBe(true);
    const [row] = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "assessment.imported"));
    expect(row).toMatchObject({ actorUserId: parent.value.userId, subjectUserId: child.value.userId, metadata: { via: "parent" } });
  });

  it("is in the student's export and deleted with them", async () => {
    const student = await makeStudent("ana@example.com");
    const res = await importSavedAssessment(db, student, student, saved, { via: "signup", now });
    if (!res.ok) throw new Error(res.error);
    const exported = await exportStudentData(db, student, student);
    expect(exported?.assessments).toEqual([
      expect.objectContaining({ id: res.attemptId, instrument: "interests", responses: answers, scores: scoreInterests(answers) }),
    ]);
    expect(exported?.careerMatches[0].matches.length).toBeGreaterThan(0);

    expect(await deleteStudent(db, student, student)).toBe(true);
    for (const table of [schema.assessmentAttempts, schema.assessmentResponses, schema.assessmentResults, schema.matchRuns, schema.careerMatches]) {
      expect(await db.select().from(table)).toHaveLength(0);
    }
  });
});
