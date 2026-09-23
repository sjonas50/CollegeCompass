import { describe, expect, it } from "vitest";
import type { Riasec } from "../assessments/instruments";
import { type OccupationProfile, pearson, rankOccupations, scoreOccupation } from "./match";

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
