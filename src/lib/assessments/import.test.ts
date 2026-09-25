import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { type Db, createTestDb, schema } from "@/db";
import { createChildAccount, registerParent, registerStudent } from "@/lib/accounts";
import { computeMatches, latestMatchRun, loadOccupationProfiles } from "@/lib/matching/service";
import { deleteStudent, exportStudentData } from "@/lib/privacy";
import { emptySavedAssessment, emptySavedStrengths, serializeSavedAssessment } from "./anonymous";
import {
  FREE_FINISH_COUNT_LIMIT,
  FREE_MATCH_RATE_LIMIT,
  IMPORT_UNDO_DAYS,
  anonymousRateKey,
  countFreeFinish,
  importSavedAssessment,
  interestCode,
  matchFreeAssessment,
  removeImportedAssessment,
  strengthsFromUndoableImport,
  undoableImport,
} from "./import";
import { WORK_STYLES } from "../reference/work-styles";
import { INTEREST_ITEMS, PERSONALITY_ITEMS, type Riasec } from "./instruments";
import { scoreInterests, scorePersonality } from "./scoring";
import { completeAttempt, instrumentStatuses, latestResult, saveResponses, startOrResumeAttempt } from "./service";

const now = new Date("2026-09-24T12:00:00Z");
const IP = "203.0.113.7";
const SECRET = "test-secret-for-rate-keys";
let db: Db;

/** A scientist: loves investigative work, likes hands-on work, lukewarm on the rest. */
const answers = Object.fromEntries(INTEREST_ITEMS.map((i) => [i.id, i.area === "I" ? 5 : i.area === "R" ? 4 : 2]));
const saved = serializeSavedAssessment({ ...emptySavedAssessment(), answers });
const scientistAreas = scoreInterests(answers).areas;
const strengthsAnswers = Object.fromEntries(PERSONALITY_ITEMS.map((i, n) => [i.id, (n % 5) + 1]));
const savedStrengths = serializeSavedAssessment({ ...emptySavedStrengths(), answers: strengthsAnswers });

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
  // Work styles, so strengths imported with the quiz count in matching (see computeMatches).
  await target.insert(schema.occupationWorkStyles).values(
    occs.flatMap(([code], k) => WORK_STYLES.map((s, j) => ({ occupationCode: code, style: s.id, impact: ((j * (k + 1)) % 5) - 1, distinctiveRank: null }))),
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

  it("doesn't invent top interests or great fits when every answer is the same", async () => {
    for (const value of [0, 20, 40]) {
      const same = { R: value, I: value, A: value, S: value, E: value, C: value };
      const res = await matchFreeAssessment(db, same, { rateKey, now });
      if (!res.ok) throw new Error(res.error);
      expect(res.careers.length).toBeGreaterThan(0);
      expect(res.careers.every((c) => c.fit === "Worth exploring")).toBe(true);
      expect(res.overview).toContain("no area stands out");
      expect(res.overview).not.toMatch(/strongest|Realistic/);
    }
  });

  it("doesn't call a career a great fit when no area was liked", async () => {
    // "Dislike" on the Conventional activities, "Strongly dislike" on the rest: File Clerks match the
    // shape exactly, as before, but that's the career disliked least, not a great fit.
    const res = await matchFreeAssessment(db, { R: 0, I: 0, A: 0, S: 0, E: 0, C: 10 }, { rateKey, now });
    if (!res.ok) throw new Error(res.error);
    expect(res.careers.filter((c) => c.pathway === "training")[0]).toMatchObject({ title: "File Clerks", fit: "Worth exploring" });
    expect(res.careers.every((c) => c.fit === "Worth exploring")).toBe(true);
    expect(res.overview).toMatch(/^You leaned toward disliking all six interest areas, so no area stands out yet\./);
    expect(res.overview).not.toMatch(/Conventional|strongest/);
    expect(res.careers.every((c) => !/your .* interests/.test(c.why))).toBe(true);
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

  it("is shared by one internet connection, so a whole classroom can see their matches", async () => {
    // Forty students behind a school's one public address, each loading their results a couple of
    // times (the results page keeps what it found, so going to a career and back costs nothing).
    const results = [];
    for (let student = 0; student < 40; student++) {
      const areas = { ...scientistAreas, A: student % 41 };
      for (let load = 0; load < 2; load++) results.push(await matchFreeAssessment(db, areas, { rateKey, now }));
    }
    expect(results.filter((r) => !r.ok)).toEqual([]);
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

describe("importing the strengths add-on with the quiz", () => {
  it("adds the strengths, scored on the server, before matching", async () => {
    const student = await makeStudent("ana@example.com");
    const res = await importSavedAssessment(db, student, student, saved, { via: "signup", strengths: savedStrengths, now });
    if (!res.ok) throw new Error(res.error);
    expect(res.strengthsAttemptId).toBeTruthy();

    const personality = await latestResult(db, student, "personality");
    expect(personality).toMatchObject({ attemptId: res.strengthsAttemptId, completedAt: now });
    expect(personality?.scores).toEqual(scorePersonality(strengthsAnswers));
    const responses = await db
      .select()
      .from(schema.assessmentResponses)
      .where(eq(schema.assessmentResponses.attemptId, res.strengthsAttemptId!));
    expect(Object.fromEntries(responses.map((r) => [r.itemId, r.value]))).toEqual(strengthsAnswers);
    // The match run was made with them.
    expect((await latestMatchRun(db, student))?.personalityAttemptId).toBe(res.strengthsAttemptId);
    expect((await instrumentStatuses(db, student)).personality.state).toBe("done");

    const audits = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "assessment.imported"));
    expect(audits.map((a) => a.metadata)).toEqual([
      { instrument: "interests", via: "signup" },
      { instrument: "personality", via: "signup" },
    ]);
    const exported = await exportStudentData(db, student, student);
    expect(exported?.assessments.map((a: { instrument: string }) => a.instrument).sort()).toEqual(["interests", "personality"]);
  });

  it("leaves out strengths that don't check out, and still imports the quiz", async () => {
    const student = await makeStudent("ana@example.com");
    const { P20: _dropped, ...partial } = strengthsAnswers;
    for (const bad of [
      serializeSavedAssessment({ ...emptySavedStrengths(), answers: partial }),
      serializeSavedAssessment({ ...emptySavedStrengths(), answers: { ...strengthsAnswers, P1: 9 } }),
      JSON.stringify({ ...JSON.parse(savedStrengths), scores: { traits: { neuroticism: 0 } } }),
      // The quiz's answers sent as strengths.
      saved,
      "{",
    ]) {
      const other = await makeStudent(`s${Math.random()}@example.com`);
      const res = await importSavedAssessment(db, other, other, saved, { via: "signup", strengths: bad, now });
      expect(res).toMatchObject({ ok: true, strengthsAttemptId: null });
      expect(await latestResult(db, other, "personality")).toBeNull();
    }
    expect((await importSavedAssessment(db, student, student, saved, { via: "signup", now })).ok).toBe(true);
  });

  it("never replaces a personality result the student already has", async () => {
    const student = await makeStudent("ana@example.com");
    const start = await startOrResumeAttempt(db, student, "personality", now);
    if (!start.ok) throw new Error();
    await saveResponses(db, student, start.attempt.id, Object.fromEntries(PERSONALITY_ITEMS.map((i) => [i.id, 3])));
    await completeAttempt(db, student, start.attempt.id, now);
    const res = await importSavedAssessment(db, student, student, saved, { via: "dashboard", strengths: savedStrengths, now });
    expect(res).toMatchObject({ ok: true, strengthsAttemptId: null });
    expect((await latestResult(db, student, "personality"))?.attemptId).toBe(start.attempt.id);
  });

  it("never replaces a personality activity the student started in their account", async () => {
    const student = await makeStudent("ana@example.com");
    const start = await startOrResumeAttempt(db, student, "personality", now);
    if (!start.ok) throw new Error();
    const started = Object.fromEntries(PERSONALITY_ITEMS.slice(0, 7).map((i) => [i.id, 2]));
    await saveResponses(db, student, start.attempt.id, started);

    const res = await importSavedAssessment(db, student, student, saved, { via: "dashboard", strengths: savedStrengths, now });
    // The quiz goes in; the strengths from this device don't, and the answers given here are kept.
    expect(res).toMatchObject({ ok: true, strengthsAttemptId: null });
    expect(await latestResult(db, student, "interests")).not.toBeNull();
    expect(await latestResult(db, student, "personality")).toBeNull();
    expect((await instrumentStatuses(db, student)).personality).toEqual({ state: "in_progress", answered: 7, total: 20 });
    const kept = await db.select().from(schema.assessmentResponses).where(eq(schema.assessmentResponses.attemptId, start.attempt.id));
    expect(Object.fromEntries(kept.map((r) => [r.itemId, r.value]))).toEqual(started);
    const audited = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "assessment.imported"));
    expect(audited.map((a) => a.metadata)).toEqual([{ instrument: "interests", via: "dashboard" }]);

    // Taking the quiz back leaves the started activity too.
    expect(await removeImportedAssessment(db, student, student, res.ok ? res.attemptId : "", { now })).toEqual({ ok: true });
    expect((await instrumentStatuses(db, student)).personality).toMatchObject({ state: "in_progress", answered: 7 });
  });

  it("says when the student's strengths are the ones that came with a quiz they can take back", async () => {
    const student = await makeStudent("ana@example.com");
    expect(await strengthsFromUndoableImport(db, student, now)).toBe(false);
    const res = await importSavedAssessment(db, student, student, saved, { via: "signup", strengths: savedStrengths, now });
    if (!res.ok) throw new Error(res.error);
    expect(await strengthsFromUndoableImport(db, student, now)).toBe(true);
    // Not once the quiz can't be taken back.
    expect(await strengthsFromUndoableImport(db, student, new Date(now.getTime() + IMPORT_UNDO_DAYS * 86_400_000))).toBe(false);

    // Not for strengths the student gave themself, with a quiz imported alone.
    const other = await makeStudent("ben@example.com");
    const start = await startOrResumeAttempt(db, other, "personality", new Date(now.getTime() - 600_000));
    if (!start.ok) throw new Error();
    await saveResponses(db, other, start.attempt.id, Object.fromEntries(PERSONALITY_ITEMS.map((i) => [i.id, 3])));
    await completeAttempt(db, other, start.attempt.id, now);
    expect((await importSavedAssessment(db, other, other, saved, { via: "dashboard", strengths: savedStrengths, now })).ok).toBe(true);
    expect(await undoableImport(db, other, now)).toMatchObject({ strengthsAttemptId: null });
    expect(await strengthsFromUndoableImport(db, other, now)).toBe(false);
  });

  it("takes both back when the quiz wasn't the student's", async () => {
    const student = await makeStudent("ana@example.com");
    const res = await importSavedAssessment(db, student, student, saved, { via: "signup", strengths: savedStrengths, now });
    if (!res.ok) throw new Error(res.error);
    const later = new Date(now.getTime() + 60_000);
    expect(await undoableImport(db, student, later)).toMatchObject({ attemptId: res.attemptId, strengthsAttemptId: res.strengthsAttemptId });
    expect(await removeImportedAssessment(db, student, student, res.attemptId, { now: later })).toEqual({ ok: true });
    for (const table of [schema.assessmentAttempts, schema.assessmentResponses, schema.assessmentResults, schema.matchRuns]) {
      expect(await db.select().from(table)).toHaveLength(0);
    }
    const statuses = await instrumentStatuses(db, student);
    expect([statuses.interests.state, statuses.personality.state]).toEqual(["not_started", "not_started"]);
    const removed = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "assessment.import_removed"));
    expect(removed.map((a) => a.metadata)).toEqual([{ instrument: "interests" }, { instrument: "personality" }]);
  });

  it("leaves a personality result the student gave themself when taking back a quiz", async () => {
    const student = await makeStudent("ana@example.com");
    const start = await startOrResumeAttempt(db, student, "personality", new Date(now.getTime() - 600_000));
    if (!start.ok) throw new Error();
    await saveResponses(db, student, start.attempt.id, Object.fromEntries(PERSONALITY_ITEMS.map((i) => [i.id, 3])));
    await completeAttempt(db, student, start.attempt.id, now);
    const res = await importSavedAssessment(db, student, student, saved, { via: "dashboard", strengths: savedStrengths, now });
    if (!res.ok) throw new Error(res.error);
    expect(await removeImportedAssessment(db, student, student, res.attemptId, { now })).toEqual({ ok: true });
    expect((await latestResult(db, student, "personality"))?.attemptId).toBe(start.attempt.id);
  });
});

describe("counting free quiz finishes", () => {
  const countKey = anonymousRateKey(IP, SECRET, now, "count");

  it("adds one to today's anonymous count, and nothing about the visitor", async () => {
    expect(await countFreeFinish(db, "interests", { rateKey: countKey, now })).toBe(true);
    expect(await countFreeFinish(db, "interests", { rateKey: countKey, now })).toBe(true);
    expect(await countFreeFinish(db, "personality", { rateKey: countKey, now })).toBe(true);
    const rows = await db.select().from(schema.dailyCounts);
    expect(rows.map(({ day, metric, count }) => ({ day, metric, count })).sort((a, b) => a.metric.localeCompare(b.metric))).toEqual([
      { day: "2026-09-24", metric: "free_quiz_finished", count: 2 },
      { day: "2026-09-24", metric: "free_strengths_finished", count: 1 },
    ]);
    expect(Object.keys(rows[0]).sort()).toEqual(["count", "day", "metric"]);
    for (const table of [schema.users, schema.assessmentAttempts, schema.auditLog]) {
      expect(await db.select().from(table)).toHaveLength(0);
    }
    const [limit] = await db.select().from(schema.rateLimits);
    expect(limit.key).toMatch(/^try:count:/);
    expect(JSON.stringify(await db.select().from(schema.rateLimits))).not.toContain(IP);
  });

  it("counts only the two free activities", async () => {
    for (const bad of ["values", "signup_student", "free_quiz_finished", null, { activity: "interests" }]) {
      expect(await countFreeFinish(db, bad, { rateKey: countKey, now })).toBe(false);
    }
    expect(await db.select().from(schema.dailyCounts)).toHaveLength(0);
    expect(await db.select().from(schema.rateLimits)).toHaveLength(0);
  });

  it("stops counting past the limit for one connection, so a script can't inflate it", async () => {
    for (let i = 0; i < FREE_FINISH_COUNT_LIMIT.limit; i++) await countFreeFinish(db, "interests", { rateKey: countKey, now });
    expect(await countFreeFinish(db, "interests", { rateKey: countKey, now })).toBe(false);
    const [row] = await db.select().from(schema.dailyCounts);
    expect(row.count).toBe(FREE_FINISH_COUNT_LIMIT.limit);
    // Another connection, or the next hour, counts again.
    expect(await countFreeFinish(db, "interests", { rateKey: anonymousRateKey("198.51.100.1", SECRET, now, "count"), now })).toBe(true);
    const nextHour = new Date(now.getTime() + FREE_FINISH_COUNT_LIMIT.windowMs + 1000);
    expect(await countFreeFinish(db, "interests", { rateKey: countKey, now: nextHour })).toBe(true);
  });

  it("uses a different key from career lookups", () => {
    expect(countKey).toMatch(/^try:count:[A-Za-z0-9_-]{43}$/);
    expect(countKey.slice("try:count:".length)).toBe(anonymousRateKey(IP, SECRET, now).slice("try:match:".length));
  });
});

describe("taking back an import that wasn't the student's", () => {
  const later = new Date(now.getTime() + 60_000);

  it("removes someone else's quiz so the student can take the interests activity right away", async () => {
    // A sibling's quiz, brought in at signup on a shared computer.
    const student = await makeStudent("ana@example.com");
    const res = await importSavedAssessment(db, student, student, saved, { via: "signup", now });
    if (!res.ok) throw new Error(res.error);
    const [conversation] = await db
      .insert(schema.counselorConversations)
      .values({ userId: student, context: "Top interests: Investigative", contextBuiltAt: later })
      .returning();
    expect(await startOrResumeAttempt(db, student, "interests", later)).toMatchObject({ ok: false, error: "too_soon" });

    const imported = await undoableImport(db, student, later);
    expect(imported).toMatchObject({ attemptId: res.attemptId, code: scoreInterests(answers).code });
    expect(await removeImportedAssessment(db, student, student, res.attemptId, { now: later })).toEqual({ ok: true });

    for (const table of [schema.assessmentAttempts, schema.assessmentResponses, schema.assessmentResults, schema.matchRuns, schema.careerMatches]) {
      expect(await db.select().from(table)).toHaveLength(0);
    }
    const [after] = await db.select().from(schema.counselorConversations).where(eq(schema.counselorConversations.id, conversation.id));
    expect(after.context).toBeNull();
    expect((await instrumentStatuses(db, student)).interests.state).toBe("not_started");
    expect((await startOrResumeAttempt(db, student, "interests", later)).ok).toBe(true);
    // Once is enough.
    expect(await removeImportedAssessment(db, student, student, res.attemptId, { now: later })).toEqual({
      ok: false,
      error: "not_undoable",
    });
  });

  it("never removes results the student gave in their account", async () => {
    const student = await makeStudent("ana@example.com");
    const start = await startOrResumeAttempt(db, student, "interests", now);
    if (!start.ok) throw new Error(start.error);
    await saveResponses(db, student, start.attempt.id, answers);
    await completeAttempt(db, student, start.attempt.id, new Date(now.getTime() + 8 * 60_000));
    expect(await undoableImport(db, student, later)).toBeNull();
    expect(await removeImportedAssessment(db, student, student, start.attempt.id, { now: later })).toEqual({
      ok: false,
      error: "not_undoable",
    });
    expect(await db.select().from(schema.assessmentAttempts)).toHaveLength(1);
  });

  it("only for a while, and only the import named", async () => {
    const student = await makeStudent("ana@example.com");
    const res = await importSavedAssessment(db, student, student, saved, { via: "signup", now });
    if (!res.ok) throw new Error(res.error);
    const tooLate = new Date(now.getTime() + IMPORT_UNDO_DAYS * 24 * 60 * 60 * 1000);
    expect(await undoableImport(db, student, tooLate)).toBeNull();
    expect(await removeImportedAssessment(db, student, student, res.attemptId, { now: tooLate })).toMatchObject({ ok: false });
    for (const wrong of ["00000000-0000-4000-8000-000000000000", "not-a-uuid"]) {
      expect(await removeImportedAssessment(db, student, student, wrong, { now: later })).toMatchObject({ ok: false });
    }
    expect(await db.select().from(schema.assessmentAttempts)).toHaveLength(1);
  });

  it("only by the student or a linked parent", async () => {
    const parent = await registerParent(db, { displayName: "Maria", email: "maria@example.com", password: "correct horse battery" });
    if (!parent.ok) throw new Error();
    const child = await createChildAccount(
      db,
      parent.value.userId,
      { displayName: "Leo", username: "leo15", password: "correct horse battery", birthDate: "2011-01-15", grade: 10 },
      null,
      now,
    );
    if (!child.ok) throw new Error(child.error);
    const res = await importSavedAssessment(db, parent.value.userId, child.value.userId, saved, { via: "parent", now });
    if (!res.ok) throw new Error(res.error);

    const stranger = await makeStudent("bo@example.com");
    expect(await removeImportedAssessment(db, stranger, child.value.userId, res.attemptId, { now: later })).toEqual({
      ok: false,
      error: "not_allowed",
    });
    expect(await db.select().from(schema.assessmentAttempts)).toHaveLength(1);
    expect(await removeImportedAssessment(db, parent.value.userId, child.value.userId, res.attemptId, { now: later })).toEqual({ ok: true });
    expect(await db.select().from(schema.assessmentAttempts)).toHaveLength(0);
  });
});
