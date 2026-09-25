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

  it("names what will count before there are matches", async () => {
    await finish("personality", personality(3));
    expect(await strengthsInMatches(db, null, (await latestResult(db, userId, "personality"))!)).toEqual({
      state: "none",
      counted: ["extraversion", "agreeableness", "conscientiousness", "intellect"],
    });
  });
});
