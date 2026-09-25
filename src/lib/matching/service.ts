import { desc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { careerMatches, matchRuns, occupationInterests, occupationValues, occupationWorkStyles, occupations, users } from "@/db/schema";
import type { BigFive, Riasec, WorkValue } from "../assessments/instruments";
import { type LatestResult, latestResult, resultOfAttempt } from "../assessments/service";
import { PERSONALITY_COUNTS_SINCE, SCORING_VERSION } from "../assessments/scoring";
import type { MappedTrait, WorkStyle } from "../reference/work-styles";
import { type OccupationProfile, rankForStudent, shownMatches, strengthsThatCount, withTraitDemands } from "./match";
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
 *   personality counted (a SCORING_VERSION before PERSONALITY_COUNTS_SINCE) or before this result.
 *   updateMatchesForStrengths would boost careers that call for `counted`.
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
  const current =
    run !== null && Number(run.scoringVersion) >= PERSONALITY_COUNTS_SINCE && run.personalityAttemptId === personality.attemptId;
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
  return storeMatches(db, userId, { interests, values, personality });
}

type MatchInputs = {
  interests: LatestResult<"interests">;
  values: LatestResult<"values"> | null;
  personality: LatestResult<"personality"> | null;
};

/**
 * Ranks careers for these results and stores them as the student's latest match run. With
 * `replacing`, only while that run is still their latest, so a run made meanwhile from newer
 * results stays the latest; null otherwise. Runs for one student are stored one at a time (the
 * student's row is locked), so that check holds.
 */
async function storeMatches(
  db: Db,
  userId: string,
  { interests, values, personality }: MatchInputs,
  { replacing }: { replacing?: string } = {},
): Promise<string | null> {
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
    // "No key update" doesn't hold up rows elsewhere that point at the student.
    const [student] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("no key update");
    if (!student) return null;
    if (replacing && (await latestRun(tx, userId))?.id !== replacing) return null;
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
  if (runId) await forgetSavedContexts(db, userId);
  return runId;
}

async function latestRun(db: Db, userId: string) {
  const [run] = await db
    .select()
    .from(matchRuns)
    .where(eq(matchRuns.userId, userId))
    .orderBy(desc(matchRuns.createdAt))
    .limit(1);
  return run ?? null;
}

async function storedMatches(db: Db, runId: string) {
  return db.select().from(careerMatches).where(eq(careerMatches.runId, runId)).orderBy(careerMatches.rank);
}

/**
 * The student's latest matches, as pages and the counselor may show them: runs stored before
 * SCORING_VERSION 3 get today's rules for which careers can be matches (see shownMatches). An
 * explanation written for a career no longer shown could name it, so it's dropped and written
 * again for the careers shown (see explainLatestMatches). The data export reads the stored rows.
 */
export async function latestMatchRun(db: Db, userId: string) {
  const run = await latestRun(db, userId);
  if (!run) return null;
  const matches = shownMatches(await storedMatches(db, run.id));
  const shown = new Set(matches.map((m) => m.occupationCode));
  const explanation = run.explanation?.careers.some((c) => !shown.has(c.code)) ? null : run.explanation;
  return { ...run, explanation, matches };
}

/**
 * Remakes the student's latest matches when today's rules leave out some of the careers stored in
 * them (see shownMatches): runs stored before SCORING_VERSION 3, or before a later change to
 * ./minors. latestMatchRun hides those careers, but a run stores only its top careers, so the list
 * would stay short until the student's next assessment.
 *
 * The new run is ranked from the same results as the old one, under today's rules, so the next
 * careers down fill the freed places. Personality counts only if it counted in the old run, so a
 * run made before it counted still offers "Update my matches" (see strengthsInMatches). The new
 * run has no explanation yet: one is written for its careers when the student next looks (see
 * explainLatestMatches). The old run is kept, like every earlier run. Returns whether it made a new
 * run, or with `dryRun`, whether it would.
 */
export async function refillMatches(db: Db, userId: string, { dryRun = false } = {}): Promise<boolean> {
  const run = await latestRun(db, userId);
  if (!run) return false;
  const stored = await storedMatches(db, run.id);
  if (shownMatches(stored).length === stored.length) return false;
  if (dryRun) return true;

  const personalityCounted = Number(run.scoringVersion) >= PERSONALITY_COUNTS_SINCE ? run.personalityAttemptId : null;
  const [interests, values, personality] = await Promise.all([
    resultOfAttempt(db, userId, "interests", run.interestsAttemptId),
    run.valuesAttemptId ? resultOfAttempt(db, userId, "values", run.valuesAttemptId) : null,
    personalityCounted ? resultOfAttempt(db, userId, "personality", personalityCounted) : null,
  ]);
  if (!interests) return false;
  return (await storeMatches(db, userId, { interests, values, personality }, { replacing: run.id })) !== null;
}

/**
 * refillMatches for every student with matches (`npm run matches:refill`). Returns how many
 * students' latest matches were checked and how many were remade (or, with `dryRun`, need it).
 */
export async function refillAllMatches(db: Db, { dryRun = false } = {}): Promise<{ checked: number; remade: number }> {
  const students = await db.selectDistinct({ userId: matchRuns.userId }).from(matchRuns);
  let remade = 0;
  for (const { userId } of students) {
    if (await refillMatches(db, userId, { dryRun })) remade++;
  }
  return { checked: students.length, remade };
}
