import { desc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { careerMatches, matchRuns, occupationInterests, occupationValues, occupations } from "@/db/schema";
import type { Riasec, WorkValue } from "../assessments/instruments";
import { latestResult } from "../assessments/service";
import { SCORING_VERSION } from "../assessments/scoring";
import { type OccupationProfile, rankForStudent } from "./match";

let profileCache: { at: number; profiles: OccupationProfile[] } | undefined;
const CACHE_MS = 60 * 60 * 1000;

/** All occupations that have a complete O*NET interest profile. Cached: reference data rarely changes. */
export async function loadOccupationProfiles(db: Db, { fresh = false } = {}): Promise<OccupationProfile[]> {
  if (!fresh && profileCache && Date.now() - profileCache.at < CACHE_MS) return profileCache.profiles;

  const [occs, interests, values] = await Promise.all([
    db.select().from(occupations),
    db.select().from(occupationInterests),
    db.select().from(occupationValues),
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
  const profiles = [...byCode.values()].filter((p) => Object.keys(p.interests).length === 6);
  profileCache = { at: Date.now(), profiles };
  return profiles;
}

/**
 * Computes and stores a fresh set of matches from the student's latest interest (and, if taken,
 * values) results. Returns null until the interests assessment is complete.
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
  const ranked = rankForStudent(
    { interests: interests.scores.areas, valuesRanking: values?.scores.ranking },
    profiles,
  );

  return db.transaction(async (tx) => {
    const [run] = await tx
      .insert(matchRuns)
      .values({
        userId,
        interestsAttemptId: interests.attemptId,
        valuesAttemptId: values?.attemptId ?? null,
        personalityAttemptId: personality?.attemptId ?? null,
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
