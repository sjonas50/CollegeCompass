import { beforeEach, describe, expect, it } from "vitest";
import { type Db, createTestDb, schema } from "@/db";
import { registerStudent } from "@/lib/accounts";
import { INTEREST_ITEMS, PERSONALITY_ITEMS, RIASEC } from "../assessments/instruments";
import { SCORING_VERSION } from "../assessments/scoring";
import { completeAttempt, saveResponses, startOrResumeAttempt } from "../assessments/service";
import { WORK_STYLES } from "../reference/work-styles";
import { PERSONALITY_WEIGHT } from "./match";
import { computeMatches, latestMatchRun, loadOccupationProfiles, runUsedPersonality } from "./service";

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
    expect(runUsedPersonality((await latestMatchRun(db, userId))!)).toBe(false);

    const attemptId = await finish("personality", personality(1));
    await computeMatches(db, userId);
    const run = (await latestMatchRun(db, userId))!;
    expect(run).toMatchObject({ personalityAttemptId: attemptId, scoringVersion: SCORING_VERSION });
    expect(runUsedPersonality(run)).toBe(true);
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
