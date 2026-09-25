import { and, eq, inArray } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { type Db, createTestDb, schema } from "@/db";
import { registerStudent } from "@/lib/accounts";
import { INTEREST_ITEMS, PERSONALITY_ITEMS, RIASEC } from "../assessments/instruments";
import { SCORING_VERSION } from "../assessments/scoring";
import { completeAttempt, saveResponses, startOrResumeAttempt } from "../assessments/service";
import { WORK_STYLES } from "../reference/work-styles";
import { PERSONALITY_WEIGHT, rankForStudent } from "./match";
import { latestResult } from "../assessments/service";
import {
  computeMatches,
  latestMatchRun,
  loadOccupationProfiles,
  refillAllMatches,
  refillMatches,
  strengthsInMatches,
  updateMatchesForStrengths,
} from "./service";

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

describe("refilling matches stored before these rules", () => {
  // 16 more degree careers in four SOC minor groups, so a list of 12 leaves some out.
  const MORE = Array.from({ length: 16 }, (_, i) => ({
    code: `${["11-1", "13-1", "15-1", "17-2"][i % 4]}0${10 + i}.00`,
    title: `Research Career ${String(i + 1).padStart(2, "0")}`,
    interests: { I: 7 - i * 0.2, R: 3 + (i % 3) * 0.5 } as Record<string, number>,
  }));

  beforeEach(async () => {
    await db.insert(schema.occupations).values(MORE.map((o) => ({ code: o.code, title: o.title, jobZone: 4, description: "" })));
    await db.insert(schema.occupationInterests).values(
      MORE.flatMap((o) => RIASEC.map((interest) => ({ occupationCode: o.code, interest, score: o.interests[interest] ?? 1 }))),
    );
    await loadOccupationProfiles(db, { fresh: true });
  });

  const scientist = (strength = 5) => finish("interests", Object.fromEntries(INTEREST_ITEMS.map((i) => [i.id, i.area === "I" ? strength : 2])));
  const codes = (run: { matches: { occupationCode: string }[] } | null) => run!.matches.map((m) => m.occupationCode);
  const runCount = async () => (await db.select().from(schema.matchRuns)).length;
  const state = async () => strengthsInMatches(db, await latestMatchRun(db, userId), (await latestResult(db, userId, "personality"))!);

  /**
   * Makes the latest run look like one stored under `version` whose two lowest degree places went to
   * careers now left out for minors, with an explanation that names them.
   */
  async function makeOld(version: string) {
    const run = (await latestMatchRun(db, userId))!;
    const lost = run.matches.filter((m) => (m.jobZone ?? 0) >= 4).slice(-2);
    await db
      .delete(schema.careerMatches)
      .where(and(eq(schema.careerMatches.runId, run.id), inArray(schema.careerMatches.rank, lost.map((m) => m.rank))));
    const leftOut = [
      ["39-3011.00", "Gambling Dealers"],
      ["35-3011.00", "Bartenders"],
    ];
    await db
      .insert(schema.careerMatches)
      .values(lost.map((m, i) => ({ ...m, occupationCode: leftOut[i][0], title: leftOut[i][1] })));
    const named = [...codes(run), "39-3011.00", "35-3011.00"].map((code) => ({ code, why: "Why." }));
    await db.update(schema.matchRuns).set({ scoringVersion: version, explanation: { source: "ai", overview: "Overview.", careers: named } });
    const old = (await latestMatchRun(db, userId))!;
    expect(old.matches).toHaveLength(run.matches.length - 2);
    return { old, full: codes(run) };
  }

  it("remakes the list from the same results, so the next careers fill the freed places, once", async () => {
    await scientist();
    const personalityId = await finish("personality", personality(3));
    await computeMatches(db, userId);
    const { old, full } = await makeOld("2");

    expect(await refillMatches(db, userId, { dryRun: true })).toBe(true);
    expect(await runCount()).toBe(1);
    expect(await refillMatches(db, userId)).toBe(true);
    const run = (await latestMatchRun(db, userId))!;
    expect(run.id).not.toBe(old.id);
    expect(run).toMatchObject({
      scoringVersion: SCORING_VERSION,
      interestsAttemptId: old.interestsAttemptId,
      personalityAttemptId: personalityId,
      explanation: null,
    });
    // Twelve degree careers again: the ten shown before, then the next two down.
    expect(codes(run)).toEqual(full);
    expect(codes(run).slice(0, 10)).toEqual(codes(old));
    const stored = await db.select().from(schema.careerMatches).where(eq(schema.careerMatches.runId, run.id));
    expect(stored).toHaveLength(run.matches.length);
    // Strengths still count, and the old run is kept.
    expect(await state()).toMatchObject({ state: "boosted" });
    expect(await runCount()).toBe(2);

    // Nothing left to refill.
    expect(await refillMatches(db, userId)).toBe(false);
    expect((await latestMatchRun(db, userId))!.id).toBe(run.id);
  });

  it("uses the old list's results, not newer ones, and doesn't count strengths it didn't count", async () => {
    const interestsId = await scientist();
    await finish("personality", personality(3));
    await computeMatches(db, userId);
    // Version 1 recorded the personality attempt without counting it.
    await makeOld("1");
    expect(await state()).toMatchObject({ state: "stale" });
    // A later interests result that the matches weren't updated for.
    await db.update(schema.assessmentAttempts).set({ completedAt: new Date(Date.now() - 100 * 86_400_000) });
    await scientist(3);

    expect(await refillMatches(db, userId)).toBe(true);
    const run = (await latestMatchRun(db, userId))!;
    expect(run).toMatchObject({ interestsAttemptId: interestsId, personalityAttemptId: null, scoringVersion: SCORING_VERSION });
    const [interests] = await db.select().from(schema.assessmentResults).where(eq(schema.assessmentResults.attemptId, interestsId));
    const areas = (interests.scores as { areas: Record<(typeof RIASEC)[number], number> }).areas;
    expect(codes(run)).toEqual(rankForStudent({ interests: areas }, await loadOccupationProfiles(db)).map((r) => r.code));
    // "Update my matches" is still offered, as before.
    expect(await state()).toMatchObject({ state: "stale" });
  });

  it("keeps matches made meanwhile from newer results", async () => {
    await scientist();
    await computeMatches(db, userId);
    await makeOld("2");
    // The student finishes an activity while the refill is ranking: a newer run is stored first.
    let newer: string | null = null;
    const racing = new Proxy(db, {
      get(target, key) {
        if (key !== "transaction") return Reflect.get(target, key);
        return async (...args: Parameters<Db["transaction"]>) => {
          newer ??= await computeMatches(target, userId);
          return target.transaction(...args);
        };
      },
    });
    expect(await refillMatches(racing, userId)).toBe(false);
    expect((await latestMatchRun(db, userId))!.id).toBe(newer);
    expect(await runCount()).toBe(2);
  });

  it("refills every student's latest list that needs it, and only those", async () => {
    await scientist();
    await computeMatches(db, userId);
    await makeOld("2");
    const other = await registerStudent(db, { displayName: "Ben", email: "ben@example.com", password: "correct horse battery", birthDate: "2011-03-02", grade: 9 });
    if (!other.ok) throw new Error(other.error);
    const first = userId;
    userId = other.value.userId;
    await scientist();
    await computeMatches(db, userId);
    userId = first;

    expect(await refillAllMatches(db, { dryRun: true })).toEqual({ checked: 2, remade: 1 });
    expect(await runCount()).toBe(2);
    expect(await refillAllMatches(db)).toEqual({ checked: 2, remade: 1 });
    expect(await runCount()).toBe(3);
    expect((await latestMatchRun(db, userId))!.matches).toHaveLength(12);
    expect(await refillAllMatches(db)).toEqual({ checked: 2, remade: 0 });
  });
});
