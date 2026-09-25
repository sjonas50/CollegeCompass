import { desc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { careerMatches, matchRuns, occupationInterests, occupationValues, occupationWorkStyles, occupations } from "@/db/schema";
import type { BigFive, Riasec, WorkValue } from "../assessments/instruments";
import { latestResult } from "../assessments/service";
import { SCORING_VERSION } from "../assessments/scoring";
import type { MappedTrait, WorkStyle } from "../reference/work-styles";
import { type OccupationProfile, rankForStudent, strengthsThatCount, withTraitDemands } from "./match";
import { forgetSavedContexts } from "../counselor/saved-context";

let profileCache: { at: number; profiles: OccupationProfile[] } | undefined;
const CACHE_MS = 60 * 60 * 1000;

/**
 * All occupations that have a complete O*NET interest profile, with how much each calls for each
 * personality trait where O*NET has work styles for it (compared with the others at its Job Zone,
 * see withTraitDemands). Cached: reference data rarely changes.
 */
export async function loadOccupationProfiles(db: Db, { fresh = false } = {}): Promise<OccupationProfile[]> {
  if (!fresh && profileCache && Date.now() - profileCache.at < CACHE_MS) return profileCache.profiles;

  const [occs, interests, values, styles] = await Promise.all([
    db.select().from(occupations),
    db.select().from(occupationInterests),
    db.select().from(occupationValues),
    db
      .select({ occupationCode: occupationWorkStyles.occupationCode, style: occupationWorkStyles.style, impact: occupationWorkStyles.impact })
      .from(occupationWorkStyles),
  ]);
  const byCode = new Map<string, OccupationProfile>();
  for (const o of occs) {
    byCode.set(o.code, { code: o.code, title: o.title, jobZone: o.jobZone, interests: {} as Record<Riasec, number>, values: {} });
  }
  for (const i of interests) {
    const p = byCode.get(i.occupationCode);
    if (p) p.interests[i.interest] = i.score;
  }
  for (const v of values) {
    const p = byCode.get(v.occupationCode);
    if (p) p.values[v.value as WorkValue] = v.score;
  }
  const impacts = new Map<string, Partial<Record<WorkStyle, number>>>();
  for (const s of styles) {
    const entry = impacts.get(s.occupationCode) ?? {};
    entry[s.style as WorkStyle] = s.impact;
    impacts.set(s.occupationCode, entry);
  }
  const profiles = withTraitDemands(
    [...byCode.values()].filter((p) => Object.keys(p.interests).length === 6),
    impacts,
  );
  profileCache = { at: Date.now(), profiles };
  return profiles;
}

/** Whether personality can count in matches at all: some careers have work styles loaded. */
export async function personalityCanCount(db: Db) {
  return (await loadOccupationProfiles(db)).some((p) => p.traitDemand);
}

/**
 * What a student's personality result does to their matches, so pages say only what the code does:
 *
 * - "none": no matches yet (interests aren't done).
 * - "boosted": the latest matches give a small boost to careers that call for `counted`.
 * - "stale": the latest matches don't count this result yet, because they were made before
 *   personality counted (an older SCORING_VERSION) or before this result. updateMatchesForStrengths
 *   would boost careers that call for `counted`.
 * - "unchanged": the result doesn't change the matches: no trait is above the middle of the scale,
 *   or no work styles are loaded.
 *
 * `counted` is the strengths that count (see strengthsThatCount), or would once there are matches;
 * empty when personality can't count.
 */
export type StrengthsInMatches = { state: "none" | "boosted" | "stale" | "unchanged"; counted: MappedTrait[] };

export async function strengthsInMatches(
  db: Db,
  run: { personalityAttemptId: string | null; scoringVersion: string } | null,
  personality: { attemptId: string; scores: { traits: Record<BigFive, number> } },
): Promise<StrengthsInMatches> {
  // Since scoring version 2 a run records the personality attempt only when it counted (see computeMatches).
  const current = run !== null && run.scoringVersion === SCORING_VERSION && run.personalityAttemptId === personality.attemptId;
  const counted = current || (await personalityCanCount(db)) ? strengthsThatCount(personality.scores.traits) : [];
  if (!run) return { state: "none", counted };
  if (counted.length === 0) return { state: "unchanged", counted };
  return { state: current ? "boosted" : "stale", counted };
}

/**
 * Recomputes a student's matches when they don't yet count their personality result but would
 * (state "stale"), such as matches made before personality counted. Otherwise it does nothing, so
 * pressing "Update my matches" twice makes one new set. Returns whether it made new matches.
 */
export async function updateMatchesForStrengths(db: Db, userId: string): Promise<boolean> {
  const [personality, run] = await Promise.all([latestResult(db, userId, "personality"), latestMatchRun(db, userId)]);
  if (!personality || !run || (await strengthsInMatches(db, run, personality)).state !== "stale") return false;
  return (await computeMatches(db, userId)) !== null;
}

/**
 * Computes and stores a fresh set of matches from the student's latest interest (and, if taken,
 * values and personality) results. Returns null until the interests assessment is complete.
 */
export async function computeMatches(db: Db, userId: string) {
  const interests = await latestResult(db, userId, "interests");
  if (!interests) return null;
  const [values, personality] = await Promise.all([
    latestResult(db, userId, "values"),
    latestResult(db, userId, "personality"),
  ]);

  const profiles = await loadOccupationProfiles(db);
  if (profiles.length === 0) throw new Error("Reference data not loaded. Run `npm run data:load`.");
  // Personality counts only where work styles are loaded; the run records it only when it counted,
  // so pages never say strengths shaped matches they didn't (see strengthsInMatches).
  const usedPersonality = personality && profiles.some((p) => p.traitDemand) ? personality : null;
  const ranked = rankForStudent(
    { interests: interests.scores.areas, valuesRanking: values?.scores.ranking, personality: usedPersonality?.scores.traits },
    profiles,
  );

  const runId = await db.transaction(async (tx) => {
    const [run] = await tx
      .insert(matchRuns)
      .values({
        userId,
        interestsAttemptId: interests.attemptId,
        valuesAttemptId: values?.attemptId ?? null,
        personalityAttemptId: usedPersonality?.attemptId ?? null,
        scoringVersion: SCORING_VERSION,
      })
      .returning({ id: matchRuns.id });
    await tx.insert(careerMatches).values(
      ranked.map((r, i) => ({
        runId: run.id,
        rank: i + 1,
        occupationCode: r.code,
        title: r.title,
        jobZone: r.jobZone,
        score: r.score,
        interestFit: r.interestFit,
        valuesFit: r.valuesFit,
      })),
    );
    return run.id;
  });
  await forgetSavedContexts(db, userId);
  return runId;
}

export async function latestMatchRun(db: Db, userId: string) {
  const [run] = await db
    .select()
    .from(matchRuns)
    .where(eq(matchRuns.userId, userId))
    .orderBy(desc(matchRuns.createdAt))
    .limit(1);
  if (!run) return null;
  const matches = await db
    .select()
    .from(careerMatches)
    .where(eq(careerMatches.runId, run.id))
    .orderBy(careerMatches.rank);
  return { ...run, matches };
}
