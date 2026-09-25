import { describe, expect, it } from "vitest";
import { type BigFive, RIASEC, type Riasec, WORK_VALUES } from "../assessments/instruments";
import { MAPPED_TRAITS, type MappedTrait, TRAIT_WORK_STYLES, WORK_STYLES, type WorkStyle, traitForStyle } from "../reference/work-styles";
import {
  DEMAND_CAP,
  type OccupationProfile,
  PERSONALITY_WEIGHT,
  type StudentProfile,
  VALUES_WEIGHT,
  isMatchable,
  occupationTraitDemands,
  pathwayFor,
  pearson,
  personalityFit,
  rankForStudent,
  rankOccupations,
  scoreOccupation,
  shownMatches,
  strengthsThatCount,
  withTraitDemands,
} from "./match";
import { NOT_MATCHED_FOR_MINORS, matchFamily } from "./minors";

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
// Careers for minors
// ---------------------------------------------------------------------------

describe("matches for minors", () => {
  const people = { interests: { R: 10, I: 12, A: 20, S: 38, E: 30, C: 8 } };
  const zone = (jobZone: number, o: OccupationProfile) => ({ ...o, jobZone });

  it("never matches careers for adults only, however well they fit", () => {
    // Profiles shaped exactly like the student's, so each would come first.
    const bartenders = zone(2, occ("35-3011.00", "Bartenders", { R: 3, I: 3.2, A: 4.2, S: 7, E: 6, C: 2.8 }));
    const dealers = zone(2, occ("39-3011.00", "Gambling Dealers", { R: 3, I: 3.2, A: 4.2, S: 7, E: 6, C: 2.8 }));
    const managers = occ("11-9071.00", "Gambling Managers", { R: 3, I: 3.2, A: 4.2, S: 7, E: 6, C: 2.8 });
    const waiters = zone(2, occ("35-3031.00", "Waiters and Waitresses", { S: 6, E: 5, R: 3 }));
    expect(scoreOccupation(people, bartenders).score).toBe(100);

    const all = [bartenders, dealers, managers, waiters, teacher, zone(2, accountant)];
    const ranked = rankForStudent(people, all);
    expect(ranked.map((r) => r.code)).toEqual([teacher.code, waiters.code, accountant.code]);
    expect(rankOccupations(people, all).map((r) => r.code)).not.toContain(bartenders.code);
    for (const code of Object.keys(NOT_MATCHED_FOR_MINORS)) {
      expect(isMatchable({ code, title: NOT_MATCHED_FOR_MINORS[code].title })).toBe(false);
    }
  });

  it("shows the best college teaching job in each group, and the next careers fill the freed places", () => {
    // The student's own shape on O*NET's 1–7 scale fits perfectly (100); the others a little less.
    const shape = { R: 2.5, I: 2.8, A: 4, S: 6.7, E: 5.5, C: 2.2 };
    const english = occ("25-1123.00", "English Language and Literature Teachers, Postsecondary", shape);
    const history = occ("25-1125.00", "History Teachers, Postsecondary", { ...shape, E: 4.5 }); // 99
    const art = occ("25-1121.00", "Art, Drama, and Music Teachers, Postsecondary", { ...shape, E: 4 }); // 97
    const counselors = occ("21-1012.00", "Educational, Guidance, and Career Advisors", { ...shape, E: 3 }); // 92
    const careerTech = zone(3, occ("25-1194.00", "Career/Technical Education Teachers, Postsecondary", { ...shape, E: 4.5 }));
    const coaches = zone(3, occ("27-2022.00", "Coaches and Scouts", { ...shape, E: 4, R: 4 })); // 93
    const all = [english, history, art, careerTech, counselors, teacher, coaches, accountant];
    const score = (o: OccupationProfile) => scoreOccupation(people, o).score;
    expect([english, history, art, teacher, counselors].map(score)).toEqual([100, 99, 97, 96, 92]);

    const ranked = rankForStudent(people, all);
    const degree = ranked.filter((r) => pathwayFor(r.jobZone) === "degree").map((r) => r.title);
    const training = ranked.filter((r) => pathwayFor(r.jobZone) === "training").map((r) => r.title);
    expect(degree).toEqual([english.title, teacher.title, counselors.title, accountant.title]);
    // A group of its own: the training path can show one too.
    expect(training).toEqual([careerTech.title, coaches.title]);
    // Skipped careers don't use up their field's places under perGroup: at most 2 from 25-1 here.
    const assistants = occ("25-1999.00", "Graduate Teaching Assistants", { ...shape, E: 3 });
    expect(rankOccupations(people, [history, art, english, assistants], { perGroup: 2 }).map((r) => r.title)).toEqual([
      english.title,
      assistants.title,
    ]);
  });

  it("shows at most one modeling career, keeping the order of everything else", () => {
    const models = zone(2, occ("41-9012.00", "Models", { A: 7, E: 6, S: 5 }));
    const fashion = zone(2, occ("41-9012.01", "Fashion Models", { A: 7, E: 6, S: 5.1 }));
    const promoters = zone(2, occ("41-9011.00", "Demonstrators and Product Promoters", { E: 6, S: 5, A: 4 }));
    const artsy = { interests: { R: 5, I: 8, A: 38, S: 25, E: 32, C: 5 } };
    const ranked = rankOccupations(artsy, [models, fashion, promoters]).map((r) => r.title);
    expect(ranked).toEqual(["Fashion Models", "Demonstrators and Product Promoters"]);
    expect(matchFamily(models)).toBe("model");
    expect(matchFamily(promoters)).toBeNull();
  });

  it("keeps the ranking otherwise unchanged", () => {
    const { profiles } = syntheticOccupations();
    // Careers left out, each a copy of a synthetic career's profile under a listed code.
    const leftOut = Object.entries(NOT_MATCHED_FOR_MINORS).map(([code, { title }], i) => ({ ...profiles[i * 7], code, title }));
    const rand = random(17);
    for (let i = 0; i < 20; i++) {
      const s = randomStudent(rand);
      expect(rankForStudent(s, [...leftOut, ...profiles])).toEqual(rankForStudent(s, profiles));
      // None of the synthetic careers is in a family: without the field caps, the plain order by score.
      const ranked = rankOccupations(s, profiles, { limit: 120, perGroup: 120 });
      expect(ranked.map((r) => r.code)).toEqual(
        profiles
          .map((p) => scoreOccupation(s, p))
          .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
          .map((r) => r.code),
      );
    }
  });
});

describe("stored matches", () => {
  const stored = (occupationCode: string, title: string, jobZone: number) => ({ occupationCode, title, jobZone });

  it("leave out careers no longer matched, and all but the first of a family in each pathway", () => {
    const old = [
      stored("25-1123.00", "English Language and Literature Teachers, Postsecondary", 5),
      stored("27-3043.00", "Writers and Authors", 4),
      stored("25-1125.00", "History Teachers, Postsecondary", 5),
      stored("41-9012.00", "Models", 2),
      stored("35-3011.00", "Bartenders", 2),
      stored("25-1194.00", "Career/Technical Education Teachers, Postsecondary", 3),
      stored("39-3011.00", "Gambling Dealers", 2),
      stored("41-9012.01", "Fashion Models", 2),
    ];
    expect(shownMatches(old).map((m) => m.title)).toEqual([
      "English Language and Literature Teachers, Postsecondary",
      "Writers and Authors",
      "Models",
      "Career/Technical Education Teachers, Postsecondary",
    ]);
    // Matches made under these rules come back unchanged.
    expect(shownMatches(shownMatches(old))).toEqual(shownMatches(old));
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

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** A standard normal number from `rand` (Box–Muller). */
function normal(rand: () => number) {
  return Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
}

/**
 * Made-up occupations shaped like the O*NET work styles: every style is rated higher at higher Job
 * Zones (curiosity's styles most, as in the real data), each occupation has its own general level
 * (some jobs are rated high on everything), and under that sits what it truly calls for (`truth`).
 */
function zoneDrivenOccupations(seed = 1, n = 600) {
  const rand = random(seed);
  const rise: Partial<Record<MappedTrait, number>> = { intellect: 0.9, extraversion: 0.6, conscientiousness: 0.5, agreeableness: 0.4 };
  const profiles: OccupationProfile[] = [];
  const impacts = new Map<string, Partial<Record<WorkStyle, number>>>();
  const truth = new Map<string, Record<MappedTrait, number>>();
  const general = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const code = `${String(11 + (i % 40)).padStart(2, "0")}-${String(1000 + i)}.00`;
    const jobZone = 1 + (i % 5);
    const g = normal(rand);
    const t = Object.fromEntries(MAPPED_TRAITS.map((trait) => [trait, normal(rand)])) as Record<MappedTrait, number>;
    profiles.push({ code, title: `Occupation ${i}`, jobZone, interests: { R: 4, I: 4, A: 4, S: 4, E: 4, C: 4 }, values: {} });
    impacts.set(
      code,
      Object.fromEntries(
        WORK_STYLES.map((s) => {
          const trait = traitForStyle(s.id);
          return [s.id, (trait ? rise[trait]! : 0.3) * jobZone + 0.6 * g + (trait ? 0.5 * t[trait] : 0) + 0.3 * normal(rand)];
        }),
      ),
    );
    truth.set(code, t);
    general.set(code, g);
  }
  return { profiles, impacts, truth, general };
}

/** The average personality fit a student gets at each Job Zone. */
function fitByZone(profiles: OccupationProfile[], traits: Record<BigFive, number>) {
  const zones = [...new Set(profiles.map((p) => p.jobZone!))].sort();
  return new Map(zones.map((z) => [z, avg(profiles.filter((p) => p.jobZone === z).map((p) => personalityFit(traits, p.traitDemand!)))]));
}

const EVERY_STRENGTH: Record<BigFive, number> = { extraversion: 80, agreeableness: 80, conscientiousness: 80, neuroticism: 50, intellect: 80 };

describe("occupation trait demand", () => {
  it("compares each career with others at its Job Zone, on the same scale for every trait", () => {
    const { profiles } = syntheticOccupations();
    for (const zone of [1, 2, 3, 4, 5]) {
      for (const t of MAPPED_TRAITS) {
        const d = profiles.filter((p) => p.jobZone === zone).map((p) => p.traitDemand![t]);
        const m = avg(d);
        expect(m).toBeCloseTo(0, 6);
        expect(Math.sqrt(avg(d.map((x) => (x - m) ** 2)))).toBeCloseTo(1, 6);
      }
    }
  });

  it("follows the mapped styles", () => {
    const { profiles, impacts } = syntheticOccupations();
    const code = profiles[0].code;
    const social = new Map(impacts).set(code, { ...impacts.get(code), social_orientation: 3, leadership_orientation: 3 });
    const before = occupationTraitDemands(impacts).get(code)!;
    const after = occupationTraitDemands(social).get(code)!;
    expect(after.extraversion).toBeGreaterThan(before.extraversion + 0.5);
  });

  it("counts styles no trait is linked to, like stress tolerance, only toward a job's general level", () => {
    const { profiles, impacts } = syntheticOccupations();
    const code = profiles[0].code;
    const before = occupationTraitDemands(impacts).get(code)!;
    for (const style of WORK_STYLES.filter((s) => !traitForStyle(s.id)).map((s) => s.id)) {
      // Rated as high as possible on a style no trait is linked to: no trait is called for more.
      const after = occupationTraitDemands(new Map(impacts).set(code, { ...impacts.get(code), [style]: 3 })).get(code)!;
      for (const t of MAPPED_TRAITS) expect(after[t]).toBeLessThanOrEqual(before[t] + 1e-9);
    }
  });

  it("doesn't let a job rated high on every style call for every trait", () => {
    const { profiles, impacts, truth, general } = zoneDrivenOccupations(2);
    const inZone = profiles.filter((p) => p.jobZone === 3);
    const demands = occupationTraitDemands(new Map(inZone.map((p) => [p.code, impacts.get(p.code)!])));
    const g = inZone.map((p) => general.get(p.code)!);
    for (const t of MAPPED_TRAITS) {
      // The raw ratings of a trait's styles mostly follow the job's general level…
      const raw = inZone.map((p) => avg(TRAIT_WORK_STYLES[t].map((s) => impacts.get(p.code)![s]!)));
      expect(pearson(raw, g)).toBeGreaterThan(0.5);
      // …but its demand follows what the job truly calls for.
      const d = inZone.map((p) => demands.get(p.code)![t]);
      expect(pearson(d, inZone.map((p) => truth.get(p.code)![t]))).toBeGreaterThan(0.6);
      expect(Math.abs(pearson(d, g))).toBeLessThan(0.3);
    }
    // The four traits don't all rise together.
    const pairs = MAPPED_TRAITS.flatMap((a, i) => MAPPED_TRAITS.slice(i + 1).map((b) => [a, b] as const));
    for (const [a, b] of pairs) {
      expect(pearson(inZone.map((p) => demands.get(p.code)![a]), inZone.map((p) => demands.get(p.code)![b]))).toBeLessThan(0.3);
    }
  });

  it("lifts careers at every Job Zone about equally, even when O*NET rates higher zones higher on every style", () => {
    const { profiles, impacts } = zoneDrivenOccupations();
    const curious = { ...MIDPOINT, intellect: 80 };
    // The made-up data really is zone-driven: compared across all zones at once, a curious
    // student's lift would climb with the Job Zone.
    const acrossZones = occupationTraitDemands(impacts);
    const naive = fitByZone(profiles.map((p) => ({ ...p, traitDemand: acrossZones.get(p.code) })), curious);
    expect(PERSONALITY_WEIGHT * (naive.get(5)! - naive.get(1)!)).toBeGreaterThan(0.5);

    const withDemand = withTraitDemands(profiles, impacts);
    for (const traits of [EVERY_STRENGTH, ...MAPPED_TRAITS.map((t) => ({ ...MIDPOINT, [t]: 80 }))]) {
      const fits = fitByZone(withDemand, traits);
      for (const zones of [[1, 2, 3], [4, 5]]) {
        // Within each path, well inside the half point `npm run check:matching` allows on real data.
        const lifts = zones.map((z) => PERSONALITY_WEIGHT * fits.get(z)!);
        expect(Math.max(...lifts) - Math.min(...lifts)).toBeLessThan(0.15);
      }
    }
  });

  it("gives no demand to occupations missing any style", () => {
    const { profiles, impacts } = syntheticOccupations();
    const partial = new Map(impacts);
    partial.set(profiles[0].code, { ...partial.get(profiles[0].code), empathy: undefined });
    partial.set(profiles[1].code, { ...partial.get(profiles[1].code), integrity: undefined });
    const again = withTraitDemands(profiles, partial);
    expect(again[0].traitDemand).toBeUndefined();
    expect(again[1].traitDemand).toBeUndefined();
    expect(again[2].traitDemand).toBeDefined();
    // The profiles passed in aren't changed.
    expect(profiles[0].traitDemand).toBeDefined();
  });

  it("gives a career alone at its Job Zone no demand", () => {
    const { profiles, impacts } = syntheticOccupations();
    const alone = withTraitDemands([{ ...profiles[0], jobZone: null }, ...profiles.slice(1)], impacts);
    expect(alone[0].traitDemand).toEqual({ extraversion: 0, agreeableness: 0, conscientiousness: 0, intellect: 0 });
  });
});

describe("strengths that count", () => {
  it("are the four career traits a student rated above the middle, highest first", () => {
    expect(strengthsThatCount({ extraversion: 20, agreeableness: 70, conscientiousness: 51, neuroticism: 95, intellect: 90 })).toEqual([
      "intellect",
      "agreeableness",
      "conscientiousness",
    ]);
    expect(strengthsThatCount(MIDPOINT)).toEqual([]);
    expect(strengthsThatCount({ ...MIDPOINT, neuroticism: 0 })).toEqual([]);
  });

  it("are exactly the traits that can raise a career", () => {
    const calls: Record<MappedTrait, number> = { extraversion: DEMAND_CAP, agreeableness: DEMAND_CAP, conscientiousness: DEMAND_CAP, intellect: DEMAND_CAP };
    for (const t of MAPPED_TRAITS) {
      for (const score of [0, 40, 50, 51, 75, 100]) {
        const traits = { ...MIDPOINT, [t]: score };
        expect(personalityFit(traits, calls) > 0).toBe(strengthsThatCount(traits).includes(t));
      }
    }
    expect(Object.values(TRAIT_WORK_STYLES).flat()).toHaveLength(12);
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
