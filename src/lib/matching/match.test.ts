import { describe, expect, it } from "vitest";
import { type BigFive, RIASEC, type Riasec, WORK_VALUES } from "../assessments/instruments";
import { MAPPED_TRAITS, WORK_STYLES, type WorkStyle } from "../reference/work-styles";
import {
  DEMAND_CAP,
  type OccupationProfile,
  PERSONALITY_WEIGHT,
  type StudentProfile,
  VALUES_WEIGHT,
  occupationTraitDemands,
  pathwayFor,
  pearson,
  personalityFit,
  rankForStudent,
  rankOccupations,
  scoreOccupation,
  withTraitDemands,
} from "./match";

function occ(code: string, title: string, interests: Partial<Record<Riasec, number>>, values = {}): OccupationProfile {
  return {
    code,
    title,
    jobZone: 4,
    interests: { R: 1, I: 1, A: 1, S: 1, E: 1, C: 1, ...interests },
    values,
  };
}

const chemist = occ("19-2031.00", "Chemists", { I: 7, R: 4, C: 3 });
const teacher = occ("25-2031.00", "Secondary School Teachers", { S: 7, A: 3, E: 3 });
const accountant = occ("13-2011.00", "Accountants and Auditors", { C: 7, E: 4, I: 3 });

describe("pearson", () => {
  it("is 1 for identical shapes and -1 for opposite shapes", () => {
    expect(pearson([1, 2, 3], [2, 4, 6])).toBeCloseTo(1);
    expect(pearson([1, 2, 3], [3, 2, 1])).toBeCloseTo(-1);
    expect(pearson([2, 2, 2], [1, 2, 3])).toBe(0);
  });
});

describe("matching", () => {
  it("ranks the occupation whose profile matches the student's first", () => {
    const scientist = { interests: { R: 20, I: 38, A: 10, S: 8, E: 4, C: 14 } };
    const ranked = rankOccupations(scientist, [teacher, accountant, chemist]);
    expect(ranked.map((r) => r.title)).toEqual(["Chemists", "Accountants and Auditors", "Secondary School Teachers"]);
    expect(ranked[0].score).toBeGreaterThan(85);
  });

  it("still separates careers when a student likes everything about equally", () => {
    const flat = { interests: { R: 30, I: 31, A: 30, S: 29, E: 30, C: 30 } };
    const scores = [chemist, teacher, accountant].map((o) => scoreOccupation(flat, o).score);
    expect(scores.every((s) => s >= 0 && s <= 100)).toBe(true);
  });

  it("lets values nudge but not override interests", () => {
    const helper = { interests: { R: 5, I: 10, A: 20, S: 38, E: 18, C: 8 }, valuesRanking: ["relationships", "support", "achievement", "independence", "working_conditions", "recognition"] as const };
    const helpingTeacher = { ...teacher, values: { relationships: 7, support: 6, achievement: 5, independence: 3, working_conditions: 4, recognition: 2 } };
    const withValues = scoreOccupation({ ...helper, valuesRanking: [...helper.valuesRanking] }, helpingTeacher);
    const without = scoreOccupation({ interests: helper.interests }, helpingTeacher);
    expect(withValues.valuesFit).toBeGreaterThan(90);
    expect(Math.abs(withValues.score - without.score)).toBeLessThanOrEqual(15);
  });

  it("drops catch-all categories and caps each field", () => {
    const many = Array.from({ length: 8 }, (_, i) => occ(`19-10${i}0.00`, `Scientist ${i}`, { I: 7 }));
    const ranked = rankOccupations(
      { interests: { R: 0, I: 40, A: 0, S: 0, E: 0, C: 0 } },
      [...many, occ("19-4099.00", "Life, Physical, and Social Science Technicians, All Other", { I: 7 }), teacher],
      { perGroup: 4 },
    );
    expect(ranked.filter((r) => r.code.startsWith("19"))).toHaveLength(4);
    expect(ranked.some((r) => r.title.endsWith("All Other"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Personality
// ---------------------------------------------------------------------------

/** A small deterministic random number generator (mulberry32), so these tests never flake. */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 120 made-up occupations with interest profiles, work values and all 21 work style impacts. */
function syntheticOccupations(seed = 1) {
  const rand = random(seed);
  const profiles: OccupationProfile[] = [];
  const impacts = new Map<string, Partial<Record<WorkStyle, number>>>();
  for (let i = 0; i < 120; i++) {
    const code = `${String(11 + (i % 40)).padStart(2, "0")}-${String(1000 + i)}.00`;
    profiles.push({
      code,
      title: `Occupation ${String(i).padStart(3, "0")}`,
      jobZone: 1 + (i % 5),
      interests: Object.fromEntries(RIASEC.map((a) => [a, 1 + rand() * 6])) as Record<Riasec, number>,
      values: Object.fromEntries(WORK_VALUES.map((v) => [v, 1 + rand() * 6])),
    });
    impacts.set(code, Object.fromEntries(WORK_STYLES.map((s) => [s.id, -1 + rand() * 4])));
  }
  return { profiles: withTraitDemands(profiles, impacts), impacts };
}

function randomStudent(rand: () => number): StudentProfile & { personality: Record<BigFive, number> } {
  return {
    interests: Object.fromEntries(RIASEC.map((a) => [a, Math.round(rand() * 40)])) as Record<Riasec, number>,
    valuesRanking: [...WORK_VALUES].sort(() => rand() - 0.5),
    personality: {
      extraversion: Math.round(rand() * 100),
      agreeableness: Math.round(rand() * 100),
      conscientiousness: Math.round(rand() * 100),
      neuroticism: Math.round(rand() * 100),
      intellect: Math.round(rand() * 100),
    },
  };
}

const MIDPOINT: Record<BigFive, number> = { extraversion: 50, agreeableness: 50, conscientiousness: 50, neuroticism: 50, intellect: 50 };
const helperInterests = { R: 5, I: 10, A: 20, S: 38, E: 18, C: 8 };

describe("occupation trait demand", () => {
  it("averages each trait's standardized work styles, then standardizes across occupations", () => {
    const { profiles } = syntheticOccupations();
    for (const t of MAPPED_TRAITS) {
      const d = profiles.map((p) => p.traitDemand![t]);
      const m = d.reduce((a, b) => a + b, 0) / d.length;
      const sd = Math.sqrt(d.reduce((a, b) => a + (b - m) ** 2, 0) / d.length);
      expect(m).toBeCloseTo(0, 6);
      expect(sd).toBeCloseTo(1, 6);
    }
  });

  it("follows the mapped styles and ignores the rest, including stress tolerance and self-control", () => {
    const base = Object.fromEntries(WORK_STYLES.map((s) => [s.id, 1])) as Record<WorkStyle, number>;
    const impacts = new Map([
      ["a", { ...base, social_orientation: 3, leadership_orientation: 3 }],
      ["b", { ...base, stress_tolerance: 3, self_control: 3, integrity: 3 }],
      ["c", base],
    ]);
    const d = occupationTraitDemands(impacts);
    expect(d.get("a")!.extraversion).toBeGreaterThan(1);
    // Styles no trait is linked to leave b just like c.
    expect(d.get("b")).toEqual(d.get("c"));
  });

  it("gives no demand to occupations missing a mapped style", () => {
    const { profiles, impacts } = syntheticOccupations();
    const partial = new Map(impacts);
    partial.set(profiles[0].code, { ...partial.get(profiles[0].code), empathy: undefined });
    const again = withTraitDemands(profiles, partial);
    expect(again[0].traitDemand).toBeUndefined();
    expect(again[1].traitDemand).toBeDefined();
    // The profiles passed in aren't changed.
    expect(profiles[0].traitDemand).toBeDefined();
  });
});

describe("personality fit", () => {
  it("counts only strengths the student reports, where the career calls for them", () => {
    const demand = { extraversion: DEMAND_CAP, agreeableness: DEMAND_CAP / 2, conscientiousness: -1, intellect: 0 };
    expect(personalityFit(MIDPOINT, demand)).toBe(0);
    expect(personalityFit({ ...MIDPOINT, extraversion: 0, agreeableness: 10 }, demand)).toBe(0);
    // A full strength ("Moderately accurate" on average, 75) where the career fully calls for it.
    expect(personalityFit({ ...MIDPOINT, extraversion: 75 }, demand)).toBe(25);
    expect(personalityFit({ ...MIDPOINT, extraversion: 100 }, demand)).toBe(25);
    expect(personalityFit({ ...MIDPOINT, agreeableness: 75 }, demand)).toBe(13); // half the cap
    // Being organized adds nothing to a career that needs less organization than most.
    expect(personalityFit({ ...MIDPOINT, conscientiousness: 100 }, demand)).toBe(0);
    const everything = { extraversion: 100, agreeableness: 100, conscientiousness: 100, neuroticism: 50, intellect: 100 };
    expect(personalityFit(everything, { extraversion: 3, agreeableness: 3, conscientiousness: 3, intellect: 3 })).toBe(100);
  });

  it("never reads emotional stability", () => {
    const { profiles } = syntheticOccupations();
    const rand = random(7);
    for (let i = 0; i < 20; i++) {
      const s = randomStudent(rand);
      const calm = rankForStudent({ ...s, personality: { ...s.personality, neuroticism: 0 } }, profiles);
      const stressed = rankForStudent({ ...s, personality: { ...s.personality, neuroticism: 100 } }, profiles);
      expect(stressed).toEqual(calm);
    }
  });

  it("adds at most the weight, and never lowers a score", () => {
    const { profiles } = syntheticOccupations();
    const rand = random(42);
    for (let i = 0; i < 50; i++) {
      const s = randomStudent(rand);
      for (const occ of profiles) {
        const without = scoreOccupation({ ...s, personality: undefined }, occ);
        const withP = scoreOccupation(s, occ);
        expect(withP.personalityFit).toBeGreaterThanOrEqual(0);
        expect(withP.personalityFit).toBeLessThanOrEqual(100);
        expect(withP.score - without.score).toBeGreaterThanOrEqual(0);
        expect(withP.score - without.score).toBeLessThanOrEqual(PERSONALITY_WEIGHT * 100);
        expect(withP.score).toBeLessThanOrEqual(100);
        expect(withP.interestFit).toBe(without.interestFit);
        expect(withP.valuesFit).toBe(without.valuesFit);
      }
    }
    // The most it can add: every strength at its fullest, in a career that calls for all of them.
    const max = { extraversion: 100, agreeableness: 100, conscientiousness: 100, neuroticism: 50, intellect: 100 };
    const occ = { ...chemist, traitDemand: { extraversion: 3, agreeableness: 3, conscientiousness: 3, intellect: 3 } };
    const withMax = scoreOccupation({ interests: helperInterests, personality: max }, occ);
    expect(withMax.score - scoreOccupation({ interests: helperInterests }, occ).score).toBe(PERSONALITY_WEIGHT * 100);
  });

  it("is lighter than values", () => {
    expect(PERSONALITY_WEIGHT).toBeLessThanOrEqual(0.1);
    expect(PERSONALITY_WEIGHT).toBeLessThan(VALUES_WEIGHT);
  });

  it("gives the same ranking every time, whatever order the occupations come in", () => {
    const { profiles, impacts } = syntheticOccupations();
    const s = randomStudent(random(3));
    const first = rankForStudent(s, profiles);
    expect(first.some((m) => (m.personalityFit ?? 0) > 0)).toBe(true);
    expect(rankForStudent(s, profiles)).toEqual(first);
    const reversed = withTraitDemands([...profiles].reverse(), new Map([...impacts].reverse()));
    expect(rankForStudent(s, reversed)).toEqual(first);
  });

  it("changes nothing without personality, for careers without work styles, or at the midpoint", () => {
    const { profiles } = syntheticOccupations();
    const s = randomStudent(random(5));
    const without = rankForStudent({ ...s, personality: undefined }, profiles);
    expect(without.every((m) => m.personalityFit === null)).toBe(true);
    // The same scores as before personality counted: interests blended with values.
    for (const m of without) {
      expect(m.score).toBe(Math.round((1 - VALUES_WEIGHT) * m.interestFit + VALUES_WEIGHT * m.valuesFit!));
    }
    const noStyles = profiles.map((p) => ({ ...p, traitDemand: undefined }));
    expect(rankForStudent(s, noStyles)).toEqual(without);
    const middle = rankForStudent({ ...s, personality: MIDPOINT }, profiles);
    expect(middle.map((m) => [m.code, m.score])).toEqual(without.map((m) => [m.code, m.score]));
  });

  it("never lowers a career for a low trait: a quiet student keeps their teaching match", () => {
    const socialTeacher = { ...teacher, traitDemand: { extraversion: 1.5, agreeableness: 1.5, conscientiousness: 0.5, intellect: 0.5 } };
    const quiet = { ...MIDPOINT, extraversion: 5, agreeableness: 40 };
    const withP = scoreOccupation({ interests: helperInterests, personality: quiet }, socialTeacher);
    expect(withP.personalityFit).toBe(0);
    expect(withP.score).toBe(scoreOccupation({ interests: helperInterests }, socialTeacher).score);
  });

  it("changes the ranking only a little", () => {
    const { profiles } = syntheticOccupations();
    const rand = random(11);
    const all = { degree: 120, training: 120 };
    for (let i = 0; i < 30; i++) {
      const s = randomStudent(rand);
      const before = new Map(rankForStudent({ ...s, personality: undefined }, profiles, all).map((m) => [m.code, m.score]));
      const after = rankForStudent(s, profiles, all);
      // Within each path, a career can only move ahead of one that scored at most the weight's worth above it.
      for (let a = 0; a < after.length; a++) {
        for (let b = a + 1; b < after.length; b++) {
          if (pathwayFor(after[a].jobZone) !== pathwayFor(after[b].jobZone)) continue;
          expect(before.get(after[b].code)! - before.get(after[a].code)!).toBeLessThanOrEqual(PERSONALITY_WEIGHT * 100);
        }
      }
    }
  });
});
