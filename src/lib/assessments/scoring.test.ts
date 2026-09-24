import { describe, expect, it } from "vitest";
import { INTEREST_ITEMS, PERSONALITY_ITEMS, RIASEC } from "./instruments";
import { missingItems, score } from "./scoring";

function allInterests(value: number) {
  return Object.fromEntries(INTEREST_ITEMS.map((i) => [i.id, value]));
}

describe("instruments", () => {
  it("has 10 interest items per RIASEC area and 4 personality items per trait", () => {
    for (const area of RIASEC) expect(INTEREST_ITEMS.filter((i) => i.area === area)).toHaveLength(10);
    const byFactor = Object.groupBy(PERSONALITY_ITEMS, (i) => i.factor);
    for (const items of Object.values(byFactor)) expect(items).toHaveLength(4);
    expect(new Set(INTEREST_ITEMS.map((i) => i.id)).size).toBe(60);
  });
});

describe("interest scoring", () => {
  it("scores each area 0–40", () => {
    expect(score("interests", allInterests(1)).areas).toEqual({ R: 0, I: 0, A: 0, S: 0, E: 0, C: 0 });
    expect(score("interests", allInterests(5)).areas).toEqual({ R: 40, I: 40, A: 40, S: 40, E: 40, C: 40 });
  });

  it("matches a hand-computed answer key", () => {
    // Strongly like all Investigative, like all Artistic, dislike Social, strongly dislike the rest.
    const responses = allInterests(1);
    for (const item of INTEREST_ITEMS) {
      if (item.area === "I") responses[item.id] = 5;
      if (item.area === "A") responses[item.id] = 4;
      if (item.area === "S") responses[item.id] = 2;
    }
    responses.S1 = 5; // one strong Social like: S = 9×1 + 4 = 13
    expect(score("interests", responses)).toEqual({
      areas: { R: 0, I: 40, A: 30, S: 13, E: 0, C: 0 },
      code: "IAS",
    });
  });

  it("breaks ties in RIASEC order", () => {
    expect(score("interests", allInterests(3)).code).toBe("RIA");
  });

  it("refuses to score incomplete responses", () => {
    const responses = allInterests(3);
    delete responses.C10;
    expect(missingItems("interests", responses)).toEqual(["C10"]);
    expect(() => score("interests", responses)).toThrow("C10");
  });
});

describe("personality scoring", () => {
  it("reverse-keys negatively keyed items", () => {
    // Answer "very accurate" to everything: + items score 5, − items score 1. Four traits have
    // two of each (mean 3 → 50); intellect has one + and three − items (mean 2 → 25).
    const responses = Object.fromEntries(PERSONALITY_ITEMS.map((i) => [i.id, 5]));
    expect(score("personality", responses).traits).toEqual({
      extraversion: 50, agreeableness: 50, conscientiousness: 50, neuroticism: 50, intellect: 25,
    });
  });

  it("gives 100 when every answer points the keyed direction", () => {
    const responses = Object.fromEntries(PERSONALITY_ITEMS.map((i) => [i.id, i.keyed === 1 ? 5 : 1]));
    expect(Object.values(score("personality", responses).traits)).toEqual([100, 100, 100, 100, 100]);
  });
});

describe("values scoring", () => {
  it("orders values by rank", () => {
    const ranking = score("values", {
      relationships: 1, achievement: 2, support: 3, independence: 4, working_conditions: 5, recognition: 6,
    }).ranking;
    expect(ranking).toEqual(["relationships", "achievement", "support", "independence", "working_conditions", "recognition"]);
  });

  it("rejects duplicate ranks", () => {
    expect(() =>
      score("values", { relationships: 1, achievement: 1, support: 3, independence: 4, working_conditions: 5, recognition: 6 }),
    ).toThrow();
  });
});
