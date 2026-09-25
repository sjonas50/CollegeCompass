import { beforeEach, describe, expect, it } from "vitest";
import { type Db, createTestDb, schema } from "@/db";
import { registerStudent } from "@/lib/accounts";
import { INTEREST_ITEMS, PERSONALITY_ITEMS, RIASEC } from "../assessments/instruments";
import { SCORING_VERSION } from "../assessments/scoring";
import { completeAttempt, saveResponses, startOrResumeAttempt } from "../assessments/service";
import { WORK_STYLES } from "../reference/work-styles";
import { PERSONALITY_WEIGHT } from "./match";
import { latestResult } from "../assessments/service";
import { computeMatches, latestMatchRun, loadOccupationProfiles, strengthsInMatches, updateMatchesForStrengths } from "./service";

// computeMatches passes the student's personality through to ranking, when work styles are loaded.

let db: Db;
let userId: string;

const OCCUPATIONS = [
  ["19-2031.00", "Chemists", { I: 7, R: 4 }],
  ["19-1029.00", "Biologists", { I: 7, R: 3, S: 2 }],
  ["15-2041.00", "Statisticians", { I: 6, C: 5 }],
  ["25-1052.00", "Chemistry Teachers, Postsecondary", { I: 6, S: 5 }],
] as const;

beforeEach(async () => {
  db = await createTestDb();
  await db.insert(schema.occupations).values(OCCUPATIONS.map(([code, title]) => ({ code, title, jobZone: 5, description: "" })));
  await db.insert(schema.occupationInterests).values(
    OCCUPATIONS.flatMap(([code, , i]) => RIASEC.map((interest) => ({ occupationCode: code, interest, score: (i as Record<string, number>)[interest] ?? 1 }))),
  );
  await db.insert(schema.occupationWorkStyles).values(
    OCCUPATIONS.flatMap(([code], k) => WORK_STYLES.map((s, j) => ({ occupationCode: code, style: s.id, impact: ((j * (k + 1)) % 5) - 1, distinctiveRank: null }))),
  );
  await loadOccupationProfiles(db, { fresh: true });
  const res = await registerStudent(db, { displayName: "Ana", email: "ana@example.com", password: "correct horse battery", birthDate: "2010-01-15", grade: 10 });
  if (!res.ok) throw new Error(res.error);
  userId = res.value.userId;
});

async function finish(instrument: "interests" | "personality", responses: Record<string, number>) {
  const start = await startOrResumeAttempt(db, userId, instrument);
  if (!start.ok) throw new Error();
  await saveResponses(db, userId, start.attempt.id, responses);
  await completeAttempt(db, userId, start.attempt.id);
  return start.attempt.id;
}

const scores = async () => new Map((await latestMatchRun(db, userId))!.matches.map((m) => [m.occupationCode, m.score]));
/** Every trait "Very accurate", with the mood statements answered `mood`. */
const personality = (mood: number) =>
  Object.fromEntries(PERSONALITY_ITEMS.map((i) => [i.id, i.factor === "neuroticism" ? (i.keyed === 1 ? mood : 6 - mood) : i.keyed === 1 ? 5 : 1]));

describe("computing matches with personality", () => {
  it("counts personality lightly, records it, and never reads emotional stability", async () => {
    await finish("interests", Object.fromEntries(INTEREST_ITEMS.map((i) => [i.id, i.area === "I" ? 5 : 2])));
    await computeMatches(db, userId);
    const before = await scores();
    expect((await latestMatchRun(db, userId))!.personalityAttemptId).toBeNull();

    const attemptId = await finish("personality", personality(1));
    await computeMatches(db, userId);
    const run = (await latestMatchRun(db, userId))!;
    expect(run).toMatchObject({ personalityAttemptId: attemptId, scoringVersion: SCORING_VERSION });
    expect(await strengthsInMatches(db, run, (await latestResult(db, userId, "personality"))!)).toEqual({
      state: "boosted",
      counted: ["extraversion", "agreeableness", "conscientiousness", "intellect"],
    });
    const calm = await scores();
    for (const [code, score] of calm) {
      expect(score - before.get(code)!).toBeGreaterThanOrEqual(0);
      expect(score - before.get(code)!).toBeLessThanOrEqual(PERSONALITY_WEIGHT * 100);
    }
    expect([...calm].some(([code, score]) => score > before.get(code)!)).toBe(true);

    // Retaken later with every mood statement the other way: the same matches.
    await db.update(schema.assessmentAttempts).set({ completedAt: new Date(Date.now() - 100 * 86_400_000) });
    await finish("personality", personality(5));
    await computeMatches(db, userId);
    expect(await scores()).toEqual(calm);
  });
});

describe("updating matches made before strengths counted", () => {
  const interests = () => finish("interests", Object.fromEntries(INTEREST_ITEMS.map((i) => [i.id, i.area === "I" ? 5 : 2])));
  const state = async () => strengthsInMatches(db, await latestMatchRun(db, userId), (await latestResult(db, userId, "personality"))!);

  it("recomputes matches from before this scoring version, once", async () => {
    await interests();
    await finish("personality", personality(3));
    await computeMatches(db, userId);
    // Made before personality counted (version 1 recorded the attempt without using it).
    await db.update(schema.matchRuns).set({ scoringVersion: "1" });
    const old = (await latestMatchRun(db, userId))!;
    expect(await state()).toMatchObject({ state: "stale" });

    expect(await updateMatchesForStrengths(db, userId)).toBe(true);
    const run = (await latestMatchRun(db, userId))!;
    expect(run.id).not.toBe(old.id);
    expect(run.scoringVersion).toBe(SCORING_VERSION);
    expect(await state()).toMatchObject({ state: "boosted" });
    expect(await updateMatchesForStrengths(db, userId)).toBe(false);
    expect((await latestMatchRun(db, userId))!.id).toBe(run.id);
  });

  it("recomputes matches made before the latest personality result", async () => {
    await interests();
    await computeMatches(db, userId);
    // Finished without matches being updated (finishing an activity normally updates them).
    await finish("personality", personality(3));
    expect(await state()).toMatchObject({ state: "stale" });
    expect(await updateMatchesForStrengths(db, userId)).toBe(true);
    expect(await state()).toMatchObject({ state: "boosted" });
  });

  it("does nothing, and promises nothing, when no work styles are loaded", async () => {
    await db.delete(schema.occupationWorkStyles);
    await loadOccupationProfiles(db, { fresh: true });
    await interests();
    await finish("personality", personality(3));
    await computeMatches(db, userId);
    const run = (await latestMatchRun(db, userId))!;
    expect(run).toMatchObject({ scoringVersion: SCORING_VERSION, personalityAttemptId: null });
    expect(await state()).toEqual({ state: "unchanged", counted: [] });
    // Even for matches from before this scoring version.
    await db.update(schema.matchRuns).set({ scoringVersion: "1" });
    expect(await state()).toEqual({ state: "unchanged", counted: [] });
    expect(await updateMatchesForStrengths(db, userId)).toBe(false);
    expect((await latestMatchRun(db, userId))!.id).toBe(run.id);
  });

  it("does nothing when no strength is above the middle, or there's nothing to update", async () => {
    expect(await updateMatchesForStrengths(db, userId)).toBe(false);
    await interests();
    await computeMatches(db, userId);
    expect(await updateMatchesForStrengths(db, userId)).toBe(false);
    // Every statement "Neither accurate nor inaccurate": every trait at the middle.
    await finish("personality", Object.fromEntries(PERSONALITY_ITEMS.map((i) => [i.id, 3])));
    await db.update(schema.matchRuns).set({ scoringVersion: "1" });
    expect(await state()).toEqual({ state: "unchanged", counted: [] });
    expect(await updateMatchesForStrengths(db, userId)).toBe(false);
  });

  it("still counts strengths in matches made under an earlier version that counted them", async () => {
    await interests();
    await finish("personality", personality(3));
    await computeMatches(db, userId);
    // Version 2 counted personality too; version 3 changed only which careers can be matches.
    await db.update(schema.matchRuns).set({ scoringVersion: "2" });
    expect(await state()).toMatchObject({ state: "boosted" });
    const run = (await latestMatchRun(db, userId))!;
    expect(await updateMatchesForStrengths(db, userId)).toBe(false);
    expect((await latestMatchRun(db, userId))!.id).toBe(run.id);
  });

  it("names what will count before there are matches", async () => {
    await finish("personality", personality(3));
    expect(await strengthsInMatches(db, null, (await latestResult(db, userId, "personality"))!)).toEqual({
      state: "none",
      counted: ["extraversion", "agreeableness", "conscientiousness", "intellect"],
    });
  });
});

describe("matches for minors", () => {
  const scientist = () => finish("interests", Object.fromEntries(INTEREST_ITEMS.map((i) => [i.id, i.area === "I" ? 5 : 2])));

  it("never stores careers for adults only, and one college teaching job per group", async () => {
    // A casino job shaped like the student's interests, and a second college teaching job.
    const extra = [
      ["39-3011.00", "Gambling Dealers", { I: 7, R: 4 }],
      ["25-1054.00", "Physics Teachers, Postsecondary", { I: 6.5, S: 5 }],
    ] as const;
    await db.insert(schema.occupations).values(extra.map(([code, title]) => ({ code, title, jobZone: 5, description: "" })));
    await db.insert(schema.occupationInterests).values(
      extra.flatMap(([code, , i]) => RIASEC.map((interest) => ({ occupationCode: code, interest, score: (i as Record<string, number>)[interest] ?? 1 }))),
    );
    await loadOccupationProfiles(db, { fresh: true });
    await scientist();
    await computeMatches(db, userId);
    const stored = await db.select({ code: schema.careerMatches.occupationCode, title: schema.careerMatches.title }).from(schema.careerMatches);
    expect(stored.map((m) => m.code)).not.toContain("39-3011.00");
    expect(stored.filter((m) => m.title.endsWith("Teachers, Postsecondary"))).toHaveLength(1);
    expect((await latestMatchRun(db, userId))!.matches).toHaveLength(stored.length);
  });

  it("shows matches stored before these rules without the careers they now leave out", async () => {
    await scientist();
    await computeMatches(db, userId);
    const run = (await latestMatchRun(db, userId))!;
    // As an older run could have stored them: a casino job and a second college teaching job.
    await db.update(schema.matchRuns).set({ scoringVersion: "2" });
    await db.insert(schema.careerMatches).values([
      { runId: run.id, rank: 90, occupationCode: "39-3011.00", title: "Gambling Dealers", jobZone: 2, score: 99, interestFit: 99, valuesFit: null },
      { runId: run.id, rank: 91, occupationCode: "25-1054.00", title: "Physics Teachers, Postsecondary", jobZone: 5, score: 90, interestFit: 90, valuesFit: null },
    ]);
    const shownCodes = run.matches.map((m) => m.occupationCode);
    const explanation = (codes: string[]) => ({ source: "ai" as const, overview: "Overview.", careers: codes.map((code) => ({ code, why: "Why." })) });

    // An explanation written for the old list could name a career no longer shown: it's written again.
    await db.update(schema.matchRuns).set({ explanation: explanation([...shownCodes, "39-3011.00", "25-1054.00"]) });
    const old = (await latestMatchRun(db, userId))!;
    expect(old.matches.map((m) => m.occupationCode)).toEqual(shownCodes);
    expect(old.explanation).toBeNull();

    // One written for the careers shown is kept.
    await db.update(schema.matchRuns).set({ explanation: explanation(shownCodes) });
    expect((await latestMatchRun(db, userId))!.explanation).toEqual(explanation(shownCodes));
  });
});
